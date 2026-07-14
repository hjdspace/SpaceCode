/**
 * PermissionCard — DingTalk AI card permission approval
 *
 * Uses DingTalk AI card template for permission requests.
 * If no templateId is configured, falls back to text-based approval.
 *
 * Button action format: permit:{requestId}:{yes|always|no}
 */

import type { DingtalkBot } from './dingtalkBot'
import { buildPermissionCallback } from '../common/permission'
import { formatPermissionRequest } from '../common/format'
import { createLogger } from '../common/logger'

const log = createLogger('DingtalkPermissionCard')

interface PendingPermission {
  requestId: string
  toolName: string
  createdAt: number
}

const DEFAULT_PERMISSION_CARD_TEMPLATE_ID = '02fcf2f4-2e3a-4de0-9b41-1c4de6a8b53e'

export class DingtalkPermissionCard {
  private pending: Map<string, PendingPermission[]> = new Map()

  constructor(
    private bot: DingtalkBot,
    private templateId: string = DEFAULT_PERMISSION_CARD_TEMPLATE_ID
  ) {}

  /**
   * Send a permission request card.
   * @param sessionWebhook The sessionWebhook from the incoming message
   * @param requestId Engine permission request ID
   * @param toolName Tool name
   * @param input Tool input parameters
   * @param description Optional description
   */
  async send(
    sessionWebhook: string,
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    description?: string
  ): Promise<void> {
    const text = formatPermissionRequest(toolName, input, description)

    try {
      if (this.templateId) {
        // Use AI card template
        await this.bot.sendAiCardMessage(sessionWebhook, this.templateId, {
          title: '🔐 权限请求',
          content: text,
          action_allow: buildPermissionCallback(requestId, 'allow'),
          action_always: buildPermissionCallback(requestId, 'always'),
          action_deny: buildPermissionCallback(requestId, 'deny'),
        })
      } else {
        // Fallback: text message
        await this.bot.sendTextMessage(sessionWebhook, text)
      }

      const list = this.pending.get(sessionWebhook) ?? []
      list.push({ requestId, toolName, createdAt: Date.now() })
      this.pending.set(sessionWebhook, list)

      log.info('send', `Permission card sent for ${requestId}`)
    } catch (err) {
      log.error('send', `Failed to send permission card: ${String(err)}`)
      // Fallback: text
      try {
        await this.bot.sendTextMessage(sessionWebhook, text)
      } catch {
        // Give up
      }
    }
  }

  /**
   * Handle a card action callback.
   */
  handleCallback(
    sessionWebhook: string,
    actionValue: string
  ): { requestId: string; action: 'allow' | 'always' | 'deny' } | null {
    const match = actionValue.match(/^permit:([a-zA-Z0-9_-]+):(yes|always|no)$/)
    if (!match) return null

    const [, requestId, actionStr] = match
    const action = actionStr === 'yes' ? 'allow' : actionStr === 'no' ? 'deny' : 'always'

    const list = this.pending.get(sessionWebhook)
    if (list) {
      const idx = list.findIndex((p) => p.requestId === requestId)
      if (idx !== -1) {
        list.splice(idx, 1)
      }
    }

    return { requestId, action }
  }

  /** Get pending permission count. */
  getPendingCount(sessionWebhook: string): number {
    return this.pending.get(sessionWebhook)?.length ?? 0
  }

  /** Get single pending requestId. */
  getSinglePendingRequestId(sessionWebhook: string): string | undefined {
    const list = this.pending.get(sessionWebhook)
    if (list && list.length === 1) {
      return list[0].requestId
    }
    return undefined
  }

  /** Clear all pending. */
  clear(sessionWebhook: string): void {
    this.pending.delete(sessionWebhook)
  }

  /** Clean up expired. */
  cleanupExpired(): void {
    const now = Date.now()
    const TTL = 5 * 60 * 1000

    for (const [key, list] of this.pending) {
      const fresh = list.filter((p) => now - p.createdAt < TTL)
      if (fresh.length === 0) {
        this.pending.delete(key)
      } else {
        this.pending.set(key, fresh)
      }
    }
  }
}
