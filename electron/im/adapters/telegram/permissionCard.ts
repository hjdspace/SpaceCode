/**
 * PermissionCard — InlineKeyboard 3-button permission card
 *
 * When the engine requests permission for a tool, this module:
 * 1. Formats a permission request message
 * 2. Sends it with an InlineKeyboard (3 buttons)
 * 3. Tracks pending requests per chatId
 * 4. Handles callback_query from button presses
 *
 * Button callback_data format: permit:{requestId}:{yes|always|no}
 */

import type { TelegramBot, InlineKeyboardMarkup } from './telegramBot'
import { buildPermissionCallback } from '../common/permission'
import { formatPermissionRequest } from '../common/format'
import { createLogger } from '../common/logger'

const log = createLogger('PermissionCard')

interface PendingPermission {
  requestId: string
  toolName: string
  messageId?: number
  chatId: number
  createdAt: number
}

export class PermissionCard {
  private pending: Map<number, PendingPermission[]> = new Map()

  constructor(private bot: TelegramBot) {}

  /**
   * Send a permission request card to the user.
   * @param chatId Telegram chat ID
   * @param requestId Engine permission request ID
   * @param toolName Tool name (e.g., "Bash", "Write")
   * @param input Tool input parameters
   * @param description Optional description from the engine
   */
  async send(
    chatId: number,
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    description?: string
  ): Promise<void> {
    const text = formatPermissionRequest(toolName, input, description)

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '✅ 允许', callback_data: buildPermissionCallback(requestId, 'allow') },
          { text: '♾️ 永久允许', callback_data: buildPermissionCallback(requestId, 'always') },
          { text: '❌ 拒绝', callback_data: buildPermissionCallback(requestId, 'deny') },
        ],
      ],
    }

    try {
      const result = await this.bot.sendMessage(chatId, text, {
        reply_markup: keyboard,
      })

      // Track pending
      const list = this.pending.get(chatId) ?? []
      list.push({
        requestId,
        toolName,
        messageId: result.message_id,
        chatId,
        createdAt: Date.now(),
      })
      this.pending.set(chatId, list)

      log.info('send', `Permission card sent for ${requestId} in chat ${chatId}`)
    } catch (err) {
      log.error('send', `Failed to send permission card: ${String(err)}`)
    }
  }

  /**
   * Handle a callback_query from a permission button.
   * Returns the parsed permission action if it was a permission button.
   */
  async handleCallback(
    chatId: number,
    callbackData: string,
    callbackQueryId: string
  ): Promise<{ requestId: string; action: 'allow' | 'always' | 'deny' } | null> {
    // Parse callback data: permit:{requestId}:{yes|always|no}
    const match = callbackData.match(/^permit:([a-zA-Z0-9_-]+):(yes|always|no)$/)
    if (!match) return null

    const [, requestId, actionStr] = match
    const action = actionStr === 'yes' ? 'allow' : actionStr === 'no' ? 'deny' : 'always'

    // Answer callback query to remove loading state
    await this.bot.answerCallbackQuery(callbackQueryId)

    // Remove from pending list
    const list = this.pending.get(chatId)
    if (list) {
      const idx = list.findIndex((p) => p.requestId === requestId)
      if (idx !== -1) {
        const pending = list[idx]
        list.splice(idx, 1)

        // Edit the permission message to show the decision
        if (pending.messageId) {
          const decisionEmoji = action === 'allow' ? '✅' : action === 'always' ? '♾️' : '❌'
          const decisionText = action === 'allow' ? '已允许' : action === 'always' ? '已永久允许' : '已拒绝'
          try {
            await this.bot.editMessageText(
              chatId,
              pending.messageId,
              `🔐 权限请求 — ${decisionEmoji} ${decisionText}\n\n工具: ${pending.toolName}\n请求ID: ${requestId.slice(0, 8)}...`
            )
          } catch (err) {
            log.error('handleCallback', `Failed to edit permission card after decision: ${String(err)}`)
          }
        }
      }
    }

    return { requestId, action }
  }

  /** Get pending permission count for a chat. */
  getPendingCount(chatId: number): number {
    return this.pending.get(chatId)?.length ?? 0
  }

  /** Get the single pending requestId if exactly one is pending. */
  getSinglePendingRequestId(chatId: number): string | undefined {
    const list = this.pending.get(chatId)
    if (list && list.length === 1) {
      return list[0].requestId
    }
    return undefined
  }

  /** Clear all pending permissions for a chat. */
  clear(chatId: number): void {
    this.pending.delete(chatId)
  }

  /** Clean up expired pending permissions (older than 5 minutes). */
  cleanupExpired(): void {
    const now = Date.now()
    const TTL = 5 * 60 * 1000

    for (const [chatId, list] of this.pending) {
      const fresh = list.filter((p) => now - p.createdAt < TTL)
      if (fresh.length === 0) {
        this.pending.delete(chatId)
      } else {
        this.pending.set(chatId, fresh)
      }
    }
  }
}
