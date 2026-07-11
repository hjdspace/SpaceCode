/**
 * FeishuBot — Lightweight Feishu (Lark) Bot API client
 *
 * Wraps the Feishu Open Platform HTTP API without requiring @larksuiteoapi/node-sdk.
 * Uses long-polling via the events endpoint to receive messages.
 *
 * Key features:
 * - tenant_access_token management (auto-refresh)
 * - Send text and interactive card messages
 * - CardKit create/patch/update/finalize for streaming cards
 * - Download media files (im.messageResource.get)
 * - Upload images (im.image.create)
 *
 * API reference: https://open.feishu.cn/document
 */

import { createLogger } from '../common/logger'

const log = createLogger('FeishuBot')

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

export interface FeishuMessage {
  message_id: string
  chat_id: string
  sender: {
    sender_id: {
      open_id: string
      user_id: string
      union_id: string
    }
    sender_type: string
  }
  message_type: string
  content: string
  create_time: string
}

export interface FeishuEvent {
  ts: string
  uuid: string
  event: {
    message?: FeishuMessage
    sender?: {
      sender_id: {
        open_id: string
        user_id: string
      }
      sender_type: string
    }
  }
  type: string
}

export interface FeishuUser {
  open_id: string
  name: string
}

export interface FeishuSendResult {
  message_id: string
}

export interface CardElement {
  tag: string
  [key: string]: unknown
}

export interface FeishuCard {
  schema: string
  config?: Record<string, unknown>
  body?: {
    elements?: CardElement[]
  }
  header?: {
    title?: { tag: string; content: string }
  }
}

export class FeishuBot {
  private readonly appId: string
  private readonly appSecret: string
  private readonly apiBase: string
  private tenantAccessToken: string = ''
  private tokenExpiresAt: number = 0
  private readonly timeout: number

  constructor(appId: string, appSecret: string, opts?: { apiBase?: string; timeout?: number }) {
    this.appId = appId
    this.appSecret = appSecret
    this.apiBase = opts?.apiBase ?? FEISHU_API_BASE
    this.timeout = opts?.timeout ?? 30_000
  }

  /** Get/refresh tenant_access_token. */
  async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.tenantAccessToken
    }

    const url = `${this.apiBase}/auth/v3/tenant_access_token/internal`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
        signal: controller.signal,
      })
      const data = await res.json()

      if (data.code !== 0) {
        throw new Error(`Feishu auth error: ${data.msg ?? 'unknown'}`)
      }

      this.tenantAccessToken = data.tenant_access_token as string
      this.tokenExpiresAt = Date.now() + (data.expire as number) * 1000

      log.info('getTenantAccessToken', 'Token refreshed')
      return this.tenantAccessToken
    } finally {
      clearTimeout(timer)
    }
  }

  /** Get bot info. */
  async getBotInfo(): Promise<{ app_name: string; open_id: string }> {
    return this.request('GET', '/bot/v3/info')
  }

  /** Send a text message to a chat. */
  async sendTextMessage(receiveIdType: string, receiveId: string, text: string): Promise<FeishuSendResult> {
    const result = await this.request('POST', '/im/v1/messages', {
      receive_id_type: receiveIdType,
      content: JSON.stringify({ text }),
      msg_type: 'text',
      receive_id: receiveId,
    })
    return { message_id: result.message_id }
  }

  /** Send an interactive card message. */
  async sendCardMessage(receiveIdType: string, receiveId: string, card: FeishuCard): Promise<FeishuSendResult> {
    const result = await this.request('POST', '/im/v1/messages', {
      receive_id_type: receiveIdType,
      content: JSON.stringify(card),
      msg_type: 'interactive',
      receive_id: receiveId,
    })
    return { message_id: result.message_id }
  }

  /** Patch a message (for streaming updates). */
  async patchMessage(messageId: string, content: string): Promise<void> {
    await this.request('PATCH', `/im/v1/messages/${messageId}`, { content })
  }

  /** Update a message (full replace). */
  async updateMessage(messageId: string, content: string): Promise<void> {
    await this.request('PUT', `/im/v1/messages/${messageId}`, { content })
  }

  /** CardKit: Create a card. Returns card_id. */
  async cardCreate(elements: CardElement[]): Promise<string> {
    const result = await this.request('POST', '/cardkit/v1/cards', {
      type: 'raw',
      data: {
        schema: '2.0',
        body: { elements },
      },
    })
    return result.card_id as string
  }

  /** CardKit: Update card element content (streaming). */
  async cardStreamContent(cardId: string, elementId: string, content: string, sequence: number): Promise<void> {
    await this.request('POST', `/cardkit/v1/cards/${cardId}/elements/${elementId}/streaming_content`, {
      streaming_content: content,
      sequence,
    })
  }

  /** CardKit: Update card settings (e.g., disable streaming mode). */
  async cardUpdateSettings(cardId: string, settings: Record<string, unknown>): Promise<void> {
    await this.request('PATCH', `/cardkit/v1/cards/${cardId}`, { settings })
  }

  /** CardKit: Finalize card (full replace). */
  async cardUpdate(cardId: string, elements: CardElement[]): Promise<void> {
    await this.request('PUT', `/cardkit/v1/cards/${cardId}`, {
      type: 'raw',
      data: {
        schema: '2.0',
        body: { elements },
      },
    })
  }

  /** Download a media file from a message. Returns the local file path. */
  async downloadMessageResource(messageId: string, fileType: string, destDir: string, fileName?: string): Promise<string> {
    const fs = await import('fs')
    const path = await import('path')

    const token = await this.getTenantAccessToken()
    const url = `${this.apiBase}/im/v1/messages/${messageId}/resources/${fileType}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Download failed: HTTP ${res.status}`)
      }

      const buffer = Buffer.from(await res.arrayBuffer())
      const name = fileName ?? `feishu_file_${Date.now()}`
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

  /** Upload an image and return the image_key. */
  async uploadImage(imagePath: string): Promise<string> {
    const fs = await import('fs')
    const token = await this.getTenantAccessToken()
    const url = `${this.apiBase}/im/v1/images`
    const formData = new FormData()

    formData.append('image_type', 'message')
    formData.append('image', new Blob([fs.readFileSync(imagePath)]), imagePath.split(/[/\\]/).pop() ?? 'image')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: controller.signal,
      })
      const data = await res.json()

      if (data.code !== 0) {
        throw new Error(`Upload failed: ${data.msg ?? 'unknown'}`)
      }

      return data.data.image_key as string
    } finally {
      clearTimeout(timer)
    }
  }

  /** Send an image by image_key. */
  async sendImageMessage(receiveIdType: string, receiveId: string, imageKey: string): Promise<FeishuSendResult> {
    const result = await this.request('POST', '/im/v1/messages', {
      receive_id_type: receiveIdType,
      content: JSON.stringify({ image_key: imageKey }),
      msg_type: 'image',
      receive_id: receiveId,
    })
    return { message_id: result.message_id }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private async request(
    method: string,
    endpoint: string,
    params?: Record<string, unknown>
  ): Promise<any> {
    const token = await this.getTenantAccessToken()
    const url = endpoint.includes('?')
      ? `${this.apiBase}${endpoint}${endpoint.includes('?') ? '&' : '?'}`
      : `${this.apiBase}${endpoint}`

    // For endpoints with query params (like receive_id_type)
    let finalUrl = url
    let body: string | undefined

    if (method === 'GET' && params) {
      const query = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        query.append(k, String(v))
      }
      finalUrl += `?${query.toString()}`
    } else if (params) {
      body = JSON.stringify(params)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(finalUrl, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      })

      const data = await res.json()

      if (data.code !== 0) {
        throw new Error(`Feishu API error: ${data.msg ?? 'unknown'} (code: ${data.code})`)
      }

      return data.data ?? data
    } finally {
      clearTimeout(timer)
    }
  }
}
