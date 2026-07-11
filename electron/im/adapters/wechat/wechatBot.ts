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
  private lastPollTime: number = 0

  constructor(
    accountId: string,
    botToken: string,
    userId: string,
    opts?: { baseUrl?: string; timeout?: number }
  ) {
    this.accountId = accountId
    this.botToken = botToken
    this.userId = userId
    this.baseUrl = opts?.baseUrl ?? 'https://ilinkai.weixin.qq.com'
    this.timeout = opts?.timeout ?? 35_000
  }

  /** Get bot info. */
  async getBotInfo(): Promise<{ account_id: string; user_id: string }> {
    const url = `${this.baseUrl}/api/bot/info`
    const result = await this.request('GET', url)
    return { account_id: result.account_id, user_id: result.user_id }
  }

  /** Send a text message to a user. */
  async sendTextMessage(toUserId: string, text: string): Promise<WechatSendResult> {
    const result = await this.request('POST', `${this.baseUrl}/api/bot/send`, {
      account_id: this.accountId,
      bot_token: this.botToken,
      user_id: toUserId,
      msg_type: 'text',
      content: text,
      context_token: this.contextToken,
    })

    if (result.context_token) {
      this.contextToken = result.context_token
    }

    return {
      msgId: result.msg_id ?? '',
      contextToken: result.context_token,
    }
  }

  /** Send typing indicator. WeChat requires re-sending every 5s. */
  async sendTyping(toUserId: string): Promise<void> {
    try {
      await this.request('POST', `${this.baseUrl}/api/bot/typing`, {
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

  /** Long-poll for new messages. */
  async getMessages(): Promise<WechatMessage[]> {
    const url = `${this.baseUrl}/api/bot/messages`
    const params: Record<string, unknown> = {
      account_id: this.accountId,
      bot_token: this.botToken,
      user_id: this.userId,
    }

    if (this.lastPollTime > 0) {
      params.since = this.lastPollTime
    }

    try {
      const result = await this.request('GET', `${url}?${new URLSearchParams(params as Record<string, string>).toString()}`)

      const messages: WechatMessage[] = (result.messages ?? []).map((m: Record<string, unknown>) => ({
        fromUserId: m.from_user_id as string,
        toUserId: m.to_user_id as string,
        msgId: m.msg_id as string,
        msgType: m.msg_type as string,
        content: m.content as string,
        contextToken: m.context_token as string | undefined,
        createTime: m.create_time as number,
      }))

      if (messages.length > 0) {
        this.lastPollTime = messages[messages.length - 1].createTime
      }

      return messages
    } catch (err) {
      log.error('getMessages', `Polling error: ${String(err)}`)
      return []
    }
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

  private async request(method: string, url: string, body?: Record<string, unknown>): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      const data = await res.json()

      if (data.code && data.code !== 0 && data.code !== '0') {
        throw new Error(`WeChat API error: ${data.message ?? data.msg ?? 'unknown'} (code: ${data.code})`)
      }

      return data.data ?? data
    } finally {
      clearTimeout(timer)
    }
  }
}
