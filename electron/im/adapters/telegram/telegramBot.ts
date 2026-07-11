/**
 * TelegramBot — Lightweight Telegram Bot API client
 *
 * Wraps the Telegram Bot HTTP API without requiring grammY/telegraf.
 * Provides methods for sending/editing messages, managing commands,
 * downloading files, and handling inline keyboards.
 *
 * API reference: https://core.telegram.org/bots/api
 */

import { createLogger } from '../common/logger'

const log = createLogger('TelegramBot')

const TELEGRAM_API_BASE = 'https://api.telegram.org'

export interface TelegramMessage {
  message_id: number
  chat: TelegramChat
  text?: string
  photo?: TelegramPhotoSize[]
  document?: TelegramDocument
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

export interface TelegramPhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

export interface TelegramDocument {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

export interface TelegramUser {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage & {
    from?: TelegramUser
    text?: string
    caption?: string
  }
  callback_query?: {
    id: string
    from: TelegramUser
    message?: TelegramMessage
    data?: string
  }
}

export interface InlineKeyboardButton {
  text: string
  callback_data: string
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

export interface BotCommand {
  command: string
  description: string
}

export interface SendMessageOptions {
  parse_mode?: 'HTML' | 'MarkdownV2' | 'Markdown'
  reply_markup?: InlineKeyboardMarkup
  disable_web_page_preview?: boolean
}

export interface SendResult {
  message_id: number
}

export class TelegramBot {
  private readonly token: string
  private readonly apiBase: string
  private readonly timeout: number
  private offset: number = 0

  constructor(token: string, opts?: { apiBase?: string; timeout?: number }) {
    this.token = token
    this.apiBase = opts?.apiBase ?? TELEGRAM_API_BASE
    this.timeout = opts?.timeout ?? 30_000
  }

  /** Get bot info (for startup validation). */
  async getMe(): Promise<TelegramUser> {
    return this.request('getMe')
  }

  /** Set the bot's command menu. */
  async setMyCommands(commands: BotCommand[]): Promise<boolean> {
    return this.request('setMyCommands', { commands })
  }

  /** Send a text message. */
  async sendMessage(
    chatId: number,
    text: string,
    opts?: SendMessageOptions
  ): Promise<SendResult> {
    const result = await this.request('sendMessage', {
      chat_id: chatId,
      text,
      ...opts,
    })
    return { message_id: result.message_id }
  }

  /** Edit an existing message's text. */
  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts?: SendMessageOptions
  ): Promise<void> {
    try {
      await this.request('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...opts,
      })
    } catch (err) {
      // Telegram returns 400 "message is not modified" if text is the same
      const msg = String(err)
      if (msg.includes('not modified')) return
      throw err
    }
  }

  /** Send a photo by file path. */
  async sendPhoto(
    chatId: number,
    photoPath: string,
    caption?: string
  ): Promise<SendResult> {
    const fs = await import('fs')
    const formData = new FormData()

    formData.append('chat_id', String(chatId))
    formData.append('photo', new Blob([fs.readFileSync(photoPath)]), photoPath.split(/[/\\]/).pop() ?? 'photo')
    if (caption) {
      formData.append('caption', caption)
    }

    const result = await this.requestRaw('sendPhoto', formData)
    return { message_id: result.result.message_id }
  }

  /** Answer a callback query (removes loading state on button). */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.request('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    })
  }

  /** Delete a message. */
  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.request('deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    })
  }

  /** Get file info and download it. Returns the local file path. */
  async downloadFile(fileId: string, destDir: string, fileName?: string): Promise<string> {
    const fs = await import('fs')
    const path = await import('path')

    const fileInfo = await this.request('getFile', { file_id: fileId })
    const filePath = fileInfo.file_path as string

    // Download via HTTP
    const downloadUrl = `${this.apiBase}/file/bot${this.token}/${filePath}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(downloadUrl, { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`Download failed: HTTP ${res.status}`)
      }

      const buffer = Buffer.from(await res.arrayBuffer())
      const name = fileName ?? filePath.split('/').pop() ?? `file_${Date.now()}`
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

  /** Long-poll for updates. */
  async getUpdates(timeoutSec?: number): Promise<TelegramUpdate[]> {
    const params: Record<string, unknown> = {
      offset: this.offset,
      allowed_updates: ['message', 'callback_query'],
    }
    if (timeoutSec !== undefined) {
      params.timeout = timeoutSec
    }

    const updates = await this.request('getUpdates', params, timeoutSec ? (timeoutSec + 5) * 1000 : undefined)

    if (updates.length > 0) {
      this.offset = updates[updates.length - 1].update_id + 1
    }

    return updates
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private async request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<any> {
    const url = `${this.apiBase}/bot${this.token}/${method}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeout)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: params ? JSON.stringify(params) : undefined,
        signal: controller.signal,
      })

      const data = await res.json()

      if (!data.ok) {
        throw new Error(`Telegram API error: ${data.description ?? 'unknown'}`)
      }

      return data.result
    } finally {
      clearTimeout(timer)
    }
  }

  private async requestRaw(method: string, body: FormData): Promise<any> {
    const url = `${this.apiBase}/bot${this.token}/${method}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        method: 'POST',
        body,
        signal: controller.signal,
      })

      const data = await res.json()

      if (!data.ok) {
        throw new Error(`Telegram API error: ${data.description ?? 'unknown'}`)
      }

      return data
    } finally {
      clearTimeout(timer)
    }
  }
}
