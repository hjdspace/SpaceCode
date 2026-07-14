/**
 * StreamState — DingTalk AI card streaming state management
 *
 * Manages the lifecycle of a DingTalk AI streaming card:
 * 1. Send initial AI card via sessionWebhook → get processQueryKey
 * 2. Periodically update card content via PUT /card/instances (streaming mode)
 * 3. On completion: finalize card (streamingMode=false)
 *
 * Throttle: 1200ms interval, 200 char threshold
 *
 * Also handles sessionWebhook expiry (72h limit):
 * - If webhook calls fail with specific errors, notifies user
 */

import type { DingtalkBot } from './dingtalkBot'
import { MessageBuffer } from '../common/message-buffer'
import { convertMarkdownTablesToBullets } from '../common/format'
import { createLogger } from '../common/logger'

const log = createLogger('DingtalkStreamState')

const DINGTALK_FLUSH_MS = 1200
const DINGTALK_CHAR_THRESHOLD = 200
const DINGTALK_CARD_MAX_LEN = 20000

type StreamState = 'idle' | 'creating' | 'streaming' | 'finalizing' | 'completed'

export class DingtalkStreamState {
  private bot: DingtalkBot
  private sessionWebhook: string
  private templateId: string
  private state: StreamState = 'idle'
  private processQueryKey: string | null = null
  private fullText: string = ''
  private buffer: MessageBuffer
  private consecutiveErrors: number = 0
  private webhookExpired: boolean = false

  constructor(bot: DingtalkBot, sessionWebhook: string, templateId: string) {
    this.bot = bot
    this.sessionWebhook = sessionWebhook
    this.templateId = templateId

    this.buffer = new MessageBuffer(
      {
        onFlush: (text, isComplete) => this.handleFlush(text, isComplete),
      },
      { intervalMs: DINGTALK_FLUSH_MS, charThreshold: DINGTALK_CHAR_THRESHOLD }
    )
  }

  /** Append streaming text delta. */
  append(text: string): void {
    if (this.state === 'completed' || this.state === 'finalizing') return
    this.fullText += text
    this.buffer.append(text)
  }

  /** Signal that streaming is complete. */
  async complete(): Promise<void> {
    if (this.state === 'completed') return

    this.state = 'finalizing'
    await this.buffer.complete()

    // Finalize the card (streamingMode=false)
    if (this.processQueryKey) {
      try {
        const content = this.formatContent(this.fullText, true)
        await this.bot.finalizeStreamingCard(this.processQueryKey, this.templateId, {
          content,
        })
      } catch (err) {
        log.error('complete', `Failed to finalize card: ${String(err)}`)
      }
    }

    this.state = 'completed'
  }

  /** Reset state. */
  reset(): void {
    this.state = 'idle'
    this.processQueryKey = null
    this.fullText = ''
    this.consecutiveErrors = 0
    this.webhookExpired = false
    this.buffer.reset()
  }

  /** Check if webhook has expired. */
  isWebhookExpired(): boolean {
    return this.webhookExpired
  }

  /** Get the processQueryKey. */
  getProcessQueryKey(): string | null {
    return this.processQueryKey
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private async handleFlush(text: string, isComplete: boolean): Promise<void> {
    if (this.state === 'completed') return

    // Create AI card on first content
    if (this.state === 'idle' && this.fullText) {
      this.state = 'creating'
      try {
        const content = this.formatContent(this.fullText, false)
        const result = await this.bot.sendAiCardMessage(
          this.sessionWebhook,
          this.templateId,
          { content }
        )
        this.processQueryKey = result.processQueryKey ?? null
        this.state = 'streaming'
        log.info('handleFlush', `AI card created: processQueryKey=${this.processQueryKey}`)
      } catch (err) {
        log.error('handleFlush', `Failed to create AI card: ${String(err)}`)
        // Check if webhook expired
        if (this.isWebhookExpiryError(err)) {
          this.webhookExpired = true
        }
        // Fallback to text
        try {
          await this.bot.sendTextMessage(this.sessionWebhook, this.fullText)
        } catch {
          // Give up
        }
        this.state = 'idle'
        return
      }
    }

    if (!this.processQueryKey || this.state !== 'streaming') return

    // Update streaming card
    try {
      const content = this.formatContent(this.fullText, isComplete)
      await this.bot.updateStreamingCard(this.processQueryKey, this.templateId, {
        content,
      })
      this.consecutiveErrors = 0
    } catch (err) {
      this.consecutiveErrors++
      log.warn('handleFlush', `Card update error (${this.consecutiveErrors}): ${String(err)}`)

      if (this.isWebhookExpiryError(err)) {
        this.webhookExpired = true
        log.warn('handleFlush', 'sessionWebhook appears to have expired')
        return
      }

      if (this.consecutiveErrors >= 3) {
        log.warn('handleFlush', '3 consecutive errors, falling back to text')
        try {
          await this.bot.sendTextMessage(this.sessionWebhook, this.fullText)
        } catch {
          // Give up
        }
      }
    }
  }

  /** Format content for the card. */
  private formatContent(text: string, isComplete: boolean): string {
    let formatted = convertMarkdownTablesToBullets(text)

    if (formatted.length > DINGTALK_CARD_MAX_LEN) {
      formatted = formatted.slice(0, DINGTALK_CARD_MAX_LEN - 20) + '\n…(truncated)'
    }

    if (isComplete) {
      formatted += '\n\n✅'
    }

    return formatted
  }

  /** Check if an error indicates webhook expiry. */
  private isWebhookExpiryError(err: unknown): boolean {
    const errStr = String(err)
    return errStr.includes('sessionwebhook.expired') ||
      errStr.includes('40078') ||
      errStr.includes('webhook has expired')
  }
}
