/**
 * DingtalkBot — Lightweight DingTalk Bot API client
 *
 * Wraps the DingTalk Stream SDK API without requiring dingtalk-stream package.
 * Uses HTTP API for sending messages and AI card management.
 *
 * Key features:
 * - Access token management (auto-refresh via oapi)
 * - Send text and AI card messages
 * - AI card streaming updates (PUT /card/streaming)
 * - QPS token bucket (20 QPS limit with backoff)
 * - Download media files
 * - sessionWebhook management (72h expiry handling)
 *
 * API reference: https://open.dingtalk.com/document
 */

import { createLogger } from '../common/logger'

const log = createLogger('DingtalkBot')

const DINGTALK_API_BASE = 'https://api.dingtalk.com'
const DINGTALK_OAPI_BASE = 'https://oapi.dingtalk.com'

export interface DingtalkMessage {
  senderId: string
  senderNick: string
  conversationId: string
  chatbotUserId: string
  msgId: string
  text: { content: string }
  msgtype: string
  sessionWebhook: string
  sessionWebhookExpiredTime: number
}

export interface DingtalkSendResult {
  messageId?: string
  processQueryKey?: string
}

export interface AiCardData {
  templateId: string
  cardData: {
    cardParamMap: Record<string, string>
  }
}

export class DingtalkBot {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly apiBase: string
  private accessToken: string = ''
  private tokenExpiresAt: number = 0
  private readonly timeout: number

  // QPS token bucket
  private qpsTokens: number = 20
  private qpsLastRefill: number = Date.now()
  private qpsBackoffUntil: number = 0
  private readonly qpsMax: number = 20
  private readonly qpsRefillIntervalMs: number = 1000

  constructor(clientId: string, clientSecret: string, opts?: { apiBase?: string; timeout?: number }) {
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.apiBase = opts?.apiBase ?? DINGTALK_API_BASE
    this.timeout = opts?.timeout ?? 30_000
  }

  /** Get/refresh access token. */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken
    }

    const url = `${this.apiBase}/v1.0/oauth2/accessToken`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appKey: this.clientId,
          appSecret: this.clientSecret,
        }),
        signal: controller.signal,
      })
      const data = await res.json()

      this.accessToken = data.accessToken as string
      this.tokenExpiresAt = Date.now() + (data.expireIn as number) * 1000

      log.info('getAccessToken', 'Token refreshed')
      return this.accessToken
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Send a text message via sessionWebhook.
   * sessionWebhook is provided in each incoming message and is valid for 72h.
   */
  async sendTextMessage(sessionWebhook: string, text: string): Promise<void> {
    await this.sendViaWebhook(sessionWebhook, {
      msgtype: 'text',
      text: { content: text },
    })
  }

  /**
   * Send an AI card message via sessionWebhook.
   * Returns the processQueryKey for streaming updates.
   */
  async sendAiCardMessage(
    sessionWebhook: string,
    templateId: string,
    cardParams: Record<string, string>
  ): Promise<DingtalkSendResult> {
    const result = await this.sendViaWebhook(sessionWebhook, {
      msgtype: 'actionCard',
      actionCard: {
        type: 'streaming',
        cardTemplateId: templateId,
        cardData: {
          cardParamMap: cardParams,
        },
      },
    })
    return {
      processQueryKey: result?.processQueryKey,
      messageId: result?.messageId,
    }
  }

  /**
   * Update a streaming AI card.
   * PUT /v1.0/card/instances (streaming mode)
   */
  async updateStreamingCard(
    processQueryKey: string,
    templateId: string,
    cardParams: Record<string, string>
  ): Promise<void> {
    await this.waitForQpsToken()

    const token = await this.getAccessToken()
    const url = `${this.apiBase}/v1.0/card/instances`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'x-acs-dingtalk-access-token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cardTemplateId: templateId,
          outTrackId: processQueryKey,
          cardData: {
            cardParamMap: cardParams,
          },
          streamingMode: true,
        }),
        signal: controller.signal,
      })

      const data = await res.json()

      // Check for QPS limit
      if (res.status === 403 && JSON.stringify(data).includes('QpsLimit')) {
        this.triggerQpsBackoff()
        throw new Error('QPS limit exceeded, backing off')
      }

      if (!res.ok) {
        throw new Error(`DingTalk card update failed: ${JSON.stringify(data)}`)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Finalize a streaming AI card (close streaming mode).
   */
  async finalizeStreamingCard(
    processQueryKey: string,
    templateId: string,
    cardParams: Record<string, string>
  ): Promise<void> {
    await this.waitForQpsToken()

    const token = await this.getAccessToken()
    const url = `${this.apiBase}/v1.0/card/instances`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'x-acs-dingtalk-access-token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cardTemplateId: templateId,
          outTrackId: processQueryKey,
          cardData: {
            cardParamMap: cardParams,
          },
          streamingMode: false,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(`DingTalk card finalize failed: ${JSON.stringify(data)}`)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Download a media file from DingTalk. Returns the local file path. */
  async downloadFile(downloadUrl: string, destDir: string, fileName?: string): Promise<string> {
    const fs = await import('fs')
    const path = await import('path')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(downloadUrl, { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`Download failed: HTTP ${res.status}`)
      }

      const buffer = Buffer.from(await res.arrayBuffer())
      const name = fileName ?? `dingtalk_file_${Date.now()}`
      const localPath = path.join(destDir, name)

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      fs.writeFileSync(localPath, buffer)

      return localPath
    } finally {
      clearTimeout(timer)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // QPS Token Bucket
  // ────────────────────────────────────────────────────────────────────────

  /** Wait for an available QPS token. */
  private async waitForQpsToken(): Promise<void> {
    // If in backoff, wait
    if (Date.now() < this.qpsBackoffUntil) {
      const wait = this.qpsBackoffUntil - Date.now()
      log.info('waitForQpsToken', `QPS backoff, waiting ${wait}ms`)
      await new Promise((r) => setTimeout(r, wait))
    }

    // Refill tokens
    this.refillQpsTokens()

    if (this.qpsTokens <= 0) {
      const wait = this.qpsRefillIntervalMs
      await new Promise((r) => setTimeout(r, wait))
      this.refillQpsTokens()
    }

    this.qpsTokens--
  }

  /** Refill QPS tokens based on elapsed time. */
  private refillQpsTokens(): void {
    const now = Date.now()
    const elapsed = now - this.qpsLastRefill
    const refilled = Math.floor(elapsed / this.qpsRefillIntervalMs)
    if (refilled > 0) {
      this.qpsTokens = Math.min(this.qpsMax, this.qpsTokens + refilled)
      this.qpsLastRefill = now
    }
  }

  /** Trigger QPS backoff. */
  private triggerQpsBackoff(): void {
    const QPS_BACKOFF_MS = 2000
    this.qpsBackoffUntil = Date.now() + QPS_BACKOFF_MS
    log.warn('triggerQpsBackoff', `QPS backoff triggered for ${QPS_BACKOFF_MS}ms`)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  /** Send a message via sessionWebhook. */
  private async sendViaWebhook(sessionWebhook: string, body: Record<string, unknown>): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(sessionWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const data = await res.json()

      if (data.errcode && data.errcode !== 0) {
        throw new Error(`DingTalk webhook error: ${data.errmsg ?? 'unknown'} (code: ${data.errcode})`)
      }

      return data
    } finally {
      clearTimeout(timer)
    }
  }
}
