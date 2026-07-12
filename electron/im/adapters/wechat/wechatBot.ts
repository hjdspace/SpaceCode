/**
 * WechatBot — Lightweight WeChat Bot API client
 *
 * Uses HTTP long-polling to receive messages from the WeChat gateway.
 * WeChat doesn't support native streaming or media upload.
 *
 * Key features:
 * - HTTP long-polling for incoming messages
 * - Send text messages
 * - Typing indicator (5s re-send)
 * - AES-128-ECB media decryption for downloaded files
 * - context_token management
 *
 * API reference: WeChat gateway documentation
 */

import { createLogger } from '../common/logger'
import * as crypto from 'crypto'

const log = createLogger('WechatBot')
const WECHAT_CHANNEL_VERSION = 'spacecode'
const WECHAT_TEXT_ITEM_TYPE = 1
const WECHAT_BOT_MESSAGE_TYPE = 2
const WECHAT_FINISHED_MESSAGE_STATE = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface WechatMessage {
  fromUserId: string
  toUserId: string
  msgId: string
  msgType: string
  content: string
  contextToken?: string
  createTime: number
}

export interface WechatSendResult {
  msgId: string
  contextToken?: string
}

export class WechatBot {
  private readonly accountId: string
  private readonly botToken: string
  private readonly baseUrl: string
  private readonly userId: string
  private readonly timeout: number
  private contextToken: string = ''
  private getUpdatesBuf: string = ''

  constructor(
    accountId: string,
    botToken: string,
    userId: string,
    opts?: { baseUrl?: string; timeout?: number }
  ) {
    this.accountId = accountId
    this.botToken = botToken
    this.userId = userId
    this.baseUrl = (opts?.baseUrl ?? 'https://ilinkai.weixin.qq.com').replace(/\/+$/, '')
    this.timeout = opts?.timeout ?? 35_000
  }

  /** Send a text message to a user. */
  async sendTextMessage(toUserId: string, text: string): Promise<WechatSendResult> {
    const clientId = `spacecode-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
    await this.request('POST', `${this.baseUrl}/ilink/bot/sendmessage`, {
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: clientId,
        message_type: WECHAT_BOT_MESSAGE_TYPE,
        message_state: WECHAT_FINISHED_MESSAGE_STATE,
        context_token: this.contextToken || undefined,
        item_list: [{ type: WECHAT_TEXT_ITEM_TYPE, text_item: { text } }],
      },
      base_info: this.buildBaseInfo(),
    })

    return {
      msgId: clientId,
      contextToken: this.contextToken || undefined,
    }
  }

  /** Send typing indicator. WeChat requires re-sending every 5s. */
  async sendTyping(toUserId: string): Promise<void> {
    try {
      await this.request('POST', `${this.baseUrl}/ilink/bot/send_typing`, {
        account_id: this.accountId,
        bot_token: this.botToken,
        user_id: toUserId,
        context_token: this.contextToken,
      })
    } catch (err) {
      // Typing is best-effort
      log.debug('sendTyping', `Typing indicator failed: ${String(err)}`)
    }
  }

  /** Long-poll for new messages. Errors propagate to caller for retry handling. */
  async getMessages(): Promise<WechatMessage[]> {
    const url = `${this.baseUrl}/ilink/bot/getupdates`
    const result = await this.request('POST', url, {
      get_updates_buf: this.getUpdatesBuf,
      base_info: this.buildBaseInfo(),
    })

    if (typeof result.get_updates_buf === 'string') {
      this.getUpdatesBuf = result.get_updates_buf
    }

    const messages: WechatMessage[] = []
    const rawMessages = Array.isArray(result.msgs) ? result.msgs : []
    for (const rawMessage of rawMessages) {
      if (!isRecord(rawMessage)) continue

      const items = Array.isArray(rawMessage.item_list) ? rawMessage.item_list : []
      const textItem = items.find((item) => {
        return isRecord(item) && item.type === WECHAT_TEXT_ITEM_TYPE && isRecord(item.text_item)
      })
      const content = isRecord(textItem) && isRecord(textItem.text_item)
        ? textItem.text_item.text
        : undefined
      if (typeof content !== 'string' || !content) continue

      messages.push({
        fromUserId: typeof rawMessage.from_user_id === 'string' ? rawMessage.from_user_id : '',
        toUserId: typeof rawMessage.to_user_id === 'string' ? rawMessage.to_user_id : this.userId,
        msgId: String(rawMessage.message_id ?? rawMessage.client_id ?? rawMessage.seq ?? ''),
        msgType: 'text',
        content,
        contextToken: typeof rawMessage.context_token === 'string' ? rawMessage.context_token : undefined,
        createTime: typeof rawMessage.create_time_ms === 'number' ? rawMessage.create_time_ms : 0,
      })
    }

    return messages
  }

  /** Download and decrypt a media file from WeChat. */
  async downloadAndDecryptMedia(
    downloadUrl: string,
    encryptKey: string,
    destDir: string,
    fileName?: string
  ): Promise<string> {
    const fs = await import('fs')
    const path = await import('path')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(downloadUrl, { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`Download failed: HTTP ${res.status}`)
      }

      const encryptedBuffer = Buffer.from(await res.arrayBuffer())

      // AES-128-ECB decryption
      const key = crypto.createHash('md5').update(encryptKey).digest().slice(0, 16)
      const decipher = crypto.createDecipheriv('aes-128-ecb', key, Buffer.alloc(0))
      const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()])

      const name = fileName ?? `wechat_file_${Date.now()}`
      const localPath = path.join(destDir, name)

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      fs.writeFileSync(localPath, decrypted)

      return localPath
    } finally {
      clearTimeout(timer)
    }
  }

  /** Get the current context token. */
  getContextToken(): string {
    return this.contextToken
  }

  /** Set the context token (from incoming message). */
  setContextToken(token: string): void {
    if (token) {
      this.contextToken = token
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private buildBaseInfo(): Record<string, string> {
    return { channel_version: WECHAT_CHANNEL_VERSION }
  }

  private async request(
    method: 'GET' | 'POST',
    url: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
          AuthorizationType: 'ilink_bot_token',
          'X-WECHAT-UIN': Buffer.from(
            String(crypto.randomBytes(4).readUInt32BE(0)),
            'utf-8'
          ).toString('base64'),
          'iLink-App-ClientVersion': '1',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`WeChat API HTTP ${res.status} ${res.statusText}`)
      }

      const text = await res.text()
      if (!text || text.trim() === '') {
        throw new Error('WeChat API returned empty response')
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`WeChat API returned non-JSON response: ${text.slice(0, 200)}`)
      }

      if (!isRecord(parsed)) {
        throw new Error('WeChat API returned invalid JSON response')
      }

      const data = isRecord(parsed.data) ? parsed.data : parsed

      const code = data.ret ?? data.code
      if (code !== undefined && code !== 0 && code !== '0') {
        throw new Error(`WeChat API error: ${data.errmsg ?? data.message ?? data.msg ?? 'unknown'} (code: ${code})`)
      }

      return data
    } finally {
      clearTimeout(timer)
    }
  }
}
