/**
 * StreamingMessage — Placeholder message + editMessageText loop
 *
 * Manages a Telegram message that gets progressively updated as
 * streaming text arrives from the engine.
 *
 * Flow:
 * 1. On first content_delta: send a placeholder message "💭..."
 * 2. On subsequent deltas: accumulate via MessageBuffer
 * 3. MessageBuffer flushes → editMessageText with accumulated text
 * 4. On message_complete: final edit + done indicator
 *
 * Telegram editMessageText has rate limits (~30/min for same message),
 * so we throttle to minimum 1.5s between edits.
 */

import type { TelegramBot } from './telegramBot'
import { MessageBuffer } from '../common/message-buffer'
import { splitMessage, convertMarkdownTablesToBullets } from '../common/format'
import { createLogger } from '../common/logger'

const log = createLogger('StreamingMessage')

const MIN_EDIT_INTERVAL_MS = 1500
const TELEGRAM_MSG_MAX_LEN = 4096

export class StreamingMessage {
  private messageId: number | null = null
  private chatId: number
  private bot: TelegramBot
  private buffer: MessageBuffer
  private fullText: string = ''
  private lastEditTime: number = 0
  private editTimer: ReturnType<typeof setTimeout> | null = null
  private done: boolean = false

  constructor(bot: TelegramBot, chatId: number) {
    this.bot = bot
    this.chatId = chatId

    this.buffer = new MessageBuffer(
      {
        onFlush: (text, isComplete) => this.handleFlush(text, isComplete),
      },
      { intervalMs: 500, charThreshold: 200 }
    )
  }

  /** Append streaming text delta. */
  append(text: string): void {
    if (this.done) return
    this.fullText += text
    this.buffer.append(text)
  }

  /** Signal that streaming is complete. */
  async complete(): Promise<void> {
    this.done = true
    if (this.editTimer) {
      clearTimeout(this.editTimer)
      this.editTimer = null
    }
    await this.buffer.complete()
  }

  /** Reset state for a new message. */
  reset(): void {
    this.messageId = null
    this.fullText = ''
    this.lastEditTime = 0
    this.done = false
    if (this.editTimer) {
      clearTimeout(this.editTimer)
      this.editTimer = null
    }
    this.buffer.reset()
  }

  /** Get the current message ID if a placeholder was created. */
  getMessageId(): number | null {
    return this.messageId
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private async handleFlush(text: string, isComplete: boolean): Promise<void> {
    // Create placeholder message on first content
    if (this.messageId === null && this.fullText) {
      try {
        const result = await this.bot.sendMessage(this.chatId, '💭...')
        this.messageId = result.message_id
      } catch (err) {
        log.error('handleFlush', `Failed to send placeholder message: ${String(err)}`)
        return
      }
    }

    if (this.messageId === null) return

    // Throttle edits to avoid Telegram rate limits
    const now = Date.now()
    const elapsed = now - this.lastEditTime

    if (!isComplete && elapsed < MIN_EDIT_INTERVAL_MS) {
      // Schedule a delayed edit
      if (this.editTimer) clearTimeout(this.editTimer)
      const remaining = MIN_EDIT_INTERVAL_MS - elapsed
      this.editTimer = setTimeout(() => {
        this.editTimer = null
        this.doEdit(false)
      }, remaining)
      return
    }

    await this.doEdit(isComplete)
  }

  private async doEdit(isComplete: boolean): Promise<void> {
    if (this.messageId === null) return

    this.lastEditTime = Date.now()

    let text = convertMarkdownTablesToBullets(this.fullText)

    // Truncate if too long
    if (text.length > TELEGRAM_MSG_MAX_LEN) {
      text = text.slice(0, TELEGRAM_MSG_MAX_LEN - 20) + '\n…(truncated)'
    }

    if (isComplete) {
      // Add done indicator
      const suffix = '\n\n✅'
      if (text.length + suffix.length <= TELEGRAM_MSG_MAX_LEN) {
        text += suffix
      }
    }

    try {
      await this.bot.editMessageText(this.chatId, this.messageId, text, {
        parse_mode: undefined, // Plain text to avoid Markdown parsing issues
      })
    } catch (err) {
      log.error('doEdit', `Failed to edit message: ${String(err)}`)
    }
  }
}
