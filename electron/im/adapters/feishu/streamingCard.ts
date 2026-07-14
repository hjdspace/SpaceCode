/**
 * StreamingCard — Feishu CardKit 5-step streaming card
 *
 * Manages a Feishu interactive card that gets progressively updated as
 * streaming text arrives from the engine.
 *
 * CardKit 5-step protocol:
 * 1. cardkit.v1.card.create() → card_id
 * 2. im.message.create(interactive, card_id) → message_id
 * 3. cardkit.v1.cardElement.content() × N → incremental updates (sequence monotonically increasing)
 * 4. cardkit.v1.card.settings(streaming_mode=false) → disable streaming (buttons need this)
 * 5. cardkit.v1.card.update() → full replace with final state
 *
 * State machine: idle → creating → streaming → finalizing → completed
 *
 * Throttle: CARDKIT_MS=100ms (content stream), PATCH_MS=1500ms (message patch fallback)
 */

import type { FeishuBot, CardElement } from './feishuBot'
import { MessageBuffer } from '../common/message-buffer'
import { convertMarkdownTablesToBullets } from '../common/format'
import { createLogger } from '../common/logger'

const log = createLogger('StreamingCard')

const CARDKIT_FLUSH_MS = 100
const CARDKIT_CHAR_THRESHOLD = 200
const FEISHU_CARD_MAX_LEN = 30000

type CardState = 'idle' | 'creating' | 'streaming' | 'finalizing' | 'completed'

export class StreamingCard {
  private bot: FeishuBot
  private receiveId: string
  private receiveIdType: string
  private state: CardState = 'idle'
  private cardId: string | null = null
  private messageId: string | null = null
  private elementId: string = 'streaming_text'
  private sequence: number = 0
  private fullText: string = ''
  private buffer: MessageBuffer
  private streamingDisabled: boolean = false
  private consecutiveErrors: number = 0

  constructor(bot: FeishuBot, receiveId: string, receiveIdType: string = 'open_id') {
    this.bot = bot
    this.receiveId = receiveId
    this.receiveIdType = receiveIdType

    this.buffer = new MessageBuffer(
      {
        onFlush: (text, isComplete) => this.handleFlush(text, isComplete),
      },
      { intervalMs: CARDKIT_FLUSH_MS, charThreshold: CARDKIT_CHAR_THRESHOLD }
    )
  }

  /** Append streaming text delta. */
  append(text: string): void {
    if (this.state === 'completed' || this.state === 'finalizing') return
    this.fullText += text
    this.buffer.append(text)
  }

  /** Signal that streaming is complete. Performs final card update. */
  async complete(): Promise<void> {
    if (this.state === 'completed') return

    this.state = 'finalizing'
    await this.buffer.complete()

    // Step 4: Disable streaming mode (so buttons become interactive)
    if (this.cardId && !this.streamingDisabled) {
      try {
        await this.bot.cardUpdateSettings(this.cardId, { streaming_mode: false })
        this.streamingDisabled = true
      } catch (err) {
        log.warn('complete', `Failed to disable streaming mode: ${String(err)}`)
      }
    }

    // Step 5: Full replace with final content
    if (this.cardId) {
      const elements = this.buildElements(this.fullText, true)
      try {
        await this.bot.cardUpdate(this.cardId, elements)
      } catch (err) {
        log.error('complete', `Failed to finalize card: ${String(err)}`)
        // Fallback: patch message
        await this.fallbackPatch()
      }
    }

    this.state = 'completed'
  }

  /** Reset state for a new message. */
  reset(): void {
    this.state = 'idle'
    this.cardId = null
    this.messageId = null
    this.sequence = 0
    this.fullText = ''
    this.streamingDisabled = false
    this.consecutiveErrors = 0
    this.buffer.reset()
  }

  /** Get the current card ID. */
  getCardId(): string | null {
    return this.cardId
  }

  /** Get the current message ID. */
  getMessageId(): string | null {
    return this.messageId
  }

  /** Check if streaming has been disabled due to errors. */
  isStreamingDisabled(): boolean {
    return this.streamingDisabled
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private async handleFlush(text: string, isComplete: boolean): Promise<void> {
    if (this.state === 'completed') return

    // Step 1 & 2: Create card and send as message (on first content)
    if (this.state === 'idle' && this.fullText) {
      this.state = 'creating'
      try {
        const elements = this.buildElements(this.fullText, false)
        // Step 1: Create card
        this.cardId = await this.bot.cardCreate(elements)
        // Step 2: Send as interactive message
        const card = {
          schema: '2.0',
          type: 'raw',
          data: {
            template_id: '',
            template_variable: {},
            card: {
              type: 'raw',
              card_id: this.cardId,
            },
          },
        }
        const result = await this.bot.sendCardMessage(this.receiveIdType, this.receiveId, card)
        this.messageId = result.message_id
        this.state = 'streaming'
        log.info('handleFlush', `Card created: cardId=${this.cardId}, messageId=${this.messageId}`)
      } catch (err) {
        log.error('handleFlush', `Failed to create card: ${String(err)}`)
        this.state = 'idle'
        // Fallback to text message
        try {
          await this.bot.sendTextMessage(this.receiveIdType, this.receiveId, this.fullText)
        } catch {
          // Give up
        }
        return
      }
    }

    if (!this.cardId || this.state !== 'streaming') return

    // If streaming was disabled due to too many errors, skip
    if (this.streamingDisabled) return

    // Step 3: Stream content updates
    try {
      const content = this.formatContent(this.fullText, isComplete)
      this.sequence++
      await this.bot.cardStreamContent(this.cardId, this.elementId, content, this.sequence)
      this.consecutiveErrors = 0
    } catch (err) {
      this.consecutiveErrors++
      log.warn('handleFlush', `Stream content error (${this.consecutiveErrors}): ${String(err)}`)

      // Error 230020: skip this frame
      // Error 230099/11310: tables exceeded, disable streaming
      const errStr = String(err)
      if (errStr.includes('230099') || errStr.includes('11310')) {
        log.warn('handleFlush', 'Table limit exceeded, disabling streaming')
        this.streamingDisabled = true
      }

      // 3 consecutive errors: disable streaming
      if (this.consecutiveErrors >= 3) {
        log.warn('handleFlush', '3 consecutive errors, disabling streaming')
        this.streamingDisabled = true
        await this.fallbackPatch()
      }
    }
  }

  /** Build card elements for the current text. */
  private buildElements(text: string, isComplete: boolean): CardElement[] {
    let formatted = convertMarkdownTablesToBullets(text)

    // Truncate if too long
    if (formatted.length > FEISHU_CARD_MAX_LEN) {
      formatted = formatted.slice(0, FEISHU_CARD_MAX_LEN - 20) + '\n…(truncated)'
    }

    if (isComplete) {
      formatted += '\n\n✅'
    }

    return [
      {
        tag: 'markdown',
        content: formatted,
        element_id: this.elementId,
      },
    ]
  }

  /** Format content for streaming (lighter formatting). */
  private formatContent(text: string, isComplete: boolean): string {
    let formatted = convertMarkdownTablesToBullets(text)

    if (formatted.length > FEISHU_CARD_MAX_LEN) {
      formatted = formatted.slice(0, FEISHU_CARD_MAX_LEN - 20) + '\n…(truncated)'
    }

    if (isComplete) {
      formatted += '\n\n✅'
    }

    return formatted
  }

  /** Fallback: patch the message directly with text. */
  private async fallbackPatch(): Promise<void> {
    if (!this.messageId) return

    try {
      let text = convertMarkdownTablesToBullets(this.fullText)
      if (text.length > FEISHU_CARD_MAX_LEN) {
        text = text.slice(0, FEISHU_CARD_MAX_LEN - 20) + '\n…(truncated)'
      }
      text += '\n\n✅'

      const card = {
        schema: '2.0',
        config: { streaming_mode: false },
        body: {
          elements: [
            {
              tag: 'markdown',
              content: text,
            },
          ],
        },
      }
      await this.bot.patchMessage(this.messageId, JSON.stringify(card))
    } catch (err) {
      log.error('fallbackPatch', `Fallback patch failed: ${String(err)}`)
    }
  }
}
