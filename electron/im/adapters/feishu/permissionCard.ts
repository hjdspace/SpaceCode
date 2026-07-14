/**
 * PermissionCard — Feishu Schema 2.0 permission card
 *
 * When the engine requests permission for a tool, this module:
 * 1. Builds a Schema 2.0 card with a column_set containing 3 buttons
 * 2. Sends the card to the user
 * 3. Tracks pending requests per chatId
 * 4. Handles button callback actions
 *
 * Button action format: permit:{requestId}:{yes|always|no}
 *
 * Path safety: if the tool writes outside the work directory,
 * the card shows a red warning.
 */

import type { FeishuBot, FeishuCard } from './feishuBot'
import { buildPermissionCallback } from '../common/permission'
import { formatPermissionRequest } from '../common/format'
import { createLogger } from '../common/logger'

const log = createLogger('FeishuPermissionCard')

interface PendingPermission {
  requestId: string
  toolName: string
  messageId?: string
  receiveId: string
  createdAt: number
}

export class FeishuPermissionCard {
  private pending: Map<string, PendingPermission[]> = new Map()

  constructor(private bot: FeishuBot) {}

  /**
   * Send a permission request card.
   * @param receiveId Feishu open_id or chat_id
   * @param receiveIdType 'open_id' | 'chat_id'
   * @param requestId Engine permission request ID
   * @param toolName Tool name
   * @param input Tool input parameters
   * @param description Optional description
   * @param workDir Current working directory (for path safety check)
   */
  async send(
    receiveId: string,
    receiveIdType: string,
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    description?: string,
    workDir?: string
  ): Promise<void> {
    const text = formatPermissionRequest(toolName, input, description)
    const isPathUnsafe = this.checkPathSafety(toolName, input, workDir)

    const card = this.buildPermissionCard(text, requestId, isPathUnsafe)

    try {
      const result = await this.bot.sendCardMessage(receiveIdType, receiveId, card)

      const list = this.pending.get(receiveId) ?? []
      list.push({
        requestId,
        toolName,
        messageId: result.message_id,
        receiveId,
        createdAt: Date.now(),
      })
      this.pending.set(receiveId, list)

      log.info('send', `Permission card sent for ${requestId} to ${receiveId}`)
    } catch (err) {
      log.error('send', `Failed to send permission card: ${String(err)}`)
      // Fallback: send text
      try {
        await this.bot.sendTextMessage(receiveIdType, receiveId, text)
      } catch {
        // Give up
      }
    }
  }

  /**
   * Handle a button action callback.
   * Returns parsed permission action if it was a permission button.
   */
  handleCallback(
    receiveId: string,
    actionValue: string
  ): { requestId: string; action: 'allow' | 'always' | 'deny' } | null {
    // Parse action value: permit:{requestId}:{yes|always|no}
    const match = actionValue.match(/^permit:([a-zA-Z0-9_-]+):(yes|always|no)$/)
    if (!match) return null

    const [, requestId, actionStr] = match
    const action = actionStr === 'yes' ? 'allow' : actionStr === 'no' ? 'deny' : 'always'

    // Remove from pending list
    const list = this.pending.get(receiveId)
    if (list) {
      const idx = list.findIndex((p) => p.requestId === requestId)
      if (idx !== -1) {
        list.splice(idx, 1)
      }
    }

    return { requestId, action }
  }

  /** Get pending permission count. */
  getPendingCount(receiveId: string): number {
    return this.pending.get(receiveId)?.length ?? 0
  }

  /** Get the single pending requestId if exactly one is pending. */
  getSinglePendingRequestId(receiveId: string): string | undefined {
    const list = this.pending.get(receiveId)
    if (list && list.length === 1) {
      return list[0].requestId
    }
    return undefined
  }

  /** Clear all pending permissions. */
  clear(receiveId: string): void {
    this.pending.delete(receiveId)
  }

  /** Clean up expired pending permissions (older than 5 minutes). */
  cleanupExpired(): void {
    const now = Date.now()
    const TTL = 5 * 60 * 1000

    for (const [receiveId, list] of this.pending) {
      const fresh = list.filter((p) => now - p.createdAt < TTL)
      if (fresh.length === 0) {
        this.pending.delete(receiveId)
      } else {
        this.pending.set(receiveId, fresh)
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  /** Build a Schema 2.0 card with permission buttons. */
  private buildPermissionCard(text: string, requestId: string, isPathUnsafe: boolean): FeishuCard {
    const warningElements = isPathUnsafe
      ? [
          {
            tag: 'column_set',
            columns: [
              {
                tag: 'column',
                elements: [
                  {
                    tag: 'markdown',
                    content: '⚠️ **警告：此操作涉及工作目录外的路径**',
                  },
                ],
              },
            ],
          },
        ]
      : []

    return {
      schema: '2.0',
      config: { streaming_mode: false },
      header: {
        title: { tag: 'plain_text', content: '🔐 权限请求' },
      },
      body: {
        elements: [
          ...warningElements,
          {
            tag: 'markdown',
            content: text,
          },
          {
            tag: 'column_set',
            flex_mode: 'stretch',
            columns: [
              {
                tag: 'column',
                width: 'weighted',
                weight: 1,
                elements: [
                  {
                    tag: 'button',
                    text: { tag: 'plain_text', content: '✅ 允许' },
                    type: 'primary',
                    value: { key: buildPermissionCallback(requestId, 'allow') },
                  },
                ],
              },
              {
                tag: 'column',
                width: 'weighted',
                weight: 1,
                elements: [
                  {
                    tag: 'button',
                    text: { tag: 'plain_text', content: '♾️ 永久允许' },
                    type: 'primary',
                    value: { key: buildPermissionCallback(requestId, 'always') },
                  },
                ],
              },
              {
                tag: 'column',
                width: 'weighted',
                weight: 1,
                elements: [
                  {
                    tag: 'button',
                    text: { tag: 'plain_text', content: '❌ 拒绝' },
                    type: 'danger',
                    value: { key: buildPermissionCallback(requestId, 'deny') },
                  },
                ],
              },
            ],
          },
        ],
      },
    }
  }

  /** Check if the tool writes outside the working directory. */
  private checkPathSafety(
    toolName: string,
    input: Record<string, unknown>,
    workDir?: string
  ): boolean {
    if (!workDir) return false

    // Check file paths in tool input
    const pathFields = ['file_path', 'path', 'command', 'cwd']
    for (const field of pathFields) {
      const val = input[field]
      if (typeof val === 'string' && val.startsWith('/')) {
        // Check if it's outside workDir
        const path = val
        if (!path.startsWith(workDir)) {
          return true
        }
      }
    }

    return false
  }
}
