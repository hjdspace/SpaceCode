/**
 * WhatsappBot — Lightweight WhatsApp Bot API client
 *
 * Wraps the WhatsApp Web protocol without requiring @whiskeysockets/baileys.
 * Uses the WhatsApp Business API (or a simplified local HTTP interface).
 *
 * Key features:
 * - Send text and media messages
 * - Presence (composing) indicators
 * - Download media files
 * - QR code generation for authentication
 * - Auth state management (multi-file)
 *
 * In production, this would use Baileys for the WhatsApp Web protocol.
 * For now, we provide an HTTP-based abstraction that can be backed by
 * either the Business API or a Baileys wrapper.
 *
 * API reference: https://business.whatsapp.com/developers/developer-hub
 */

import { createLogger } from '../common/logger'
import * as fs from 'fs'
import * as path from 'path'

const log = createLogger('WhatsappBot')

export interface WhatsappMessage {
  key: {
    remoteJid: string
    fromMe: boolean
    id: string
  }
  message: {
    conversation?: string
    imageMessage?: {
      url: string
      mimetype: string
      caption?: string
    }
    videoMessage?: {
      url: string
      mimetype: string
      caption?: string
    }
    documentMessage?: {
      url: string
      mimetype: string
      fileName: string
    }
    extendedTextMessage?: {
      text: string
    }
  }
  messageTimestamp: number
  pushName?: string
}

export interface WhatsappSendResult {
  key: { id: string; remoteJid: string }
}

export interface QrCodeResult {
  qr: string
  timeout: number
}

export class WhatsappBot {
  private readonly accountJid: string
  private readonly authDir: string
  private readonly baseUrl: string
  private readonly timeout: number
  private connected: boolean = false
  private qrCallback: ((qr: string) => void) | null = null
  private messageCallback: ((msg: WhatsappMessage) => void) | null = null

  constructor(accountJid: string, opts?: { authDir?: string; baseUrl?: string; timeout?: number }) {
    this.accountJid = accountJid
    this.authDir = opts?.authDir ?? path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.claude', 'whatsapp-auth', 'default')
    this.baseUrl = opts?.baseUrl ?? 'http://127.0.0.1:3000'
    this.timeout = opts?.timeout ?? 30_000
  }

  /** Check if the auth state exists. */
  isAuthStateExists(): boolean {
    const credsPath = path.join(this.authDir, 'creds.json')
    return fs.existsSync(credsPath)
  }

  /** Start the WhatsApp connection. Requires QR scan if not authenticated. */
  async start(): Promise<void> {
    if (this.connected) return

    // Ensure auth directory exists
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true })
    }

    // In production, this would initialize Baileys with multi-file auth state.
    // For now, we just mark as connected if auth exists.
    if (this.isAuthStateExists()) {
      this.connected = true
      log.info('start', 'WhatsApp connected with existing auth state')
    } else {
      // Need QR scan
      log.info('start', 'WhatsApp needs QR scan')
    }
  }

  /** Register a QR code callback. */
  onQrCode(callback: (qr: string) => void): void {
    this.qrCallback = callback
  }

  /** Register a message callback. */
  onMessage(callback: (msg: WhatsappMessage) => void): void {
    this.messageCallback = callback
  }

  /** Get the QR code for authentication. */
  async getQrCode(): Promise<QrCodeResult | null> {
    if (this.isAuthStateExists()) return null

    // In production, Baileys would generate a QR code.
    // For now, simulate one.
    const qr = `whatsapp-qr-${Date.now()}-${this.accountJid}`
    if (this.qrCallback) {
      this.qrCallback(qr)
    }
    return { qr, timeout: 60000 }
  }

  /** Send a text message. */
  async sendTextMessage(to: string, text: string): Promise<WhatsappSendResult> {
    const result = await this.request('POST', '/send/text', {
      to,
      text,
    })
    return { key: { id: result.key?.id ?? '', remoteJid: to } }
  }

  /** Send a media file (image/video/document). */
  async sendMediaMessage(
    to: string,
    mediaPath: string,
    type: 'image' | 'video' | 'document',
    caption?: string
  ): Promise<WhatsappSendResult> {
    const formData = new FormData()
    formData.append('to', to)
    formData.append('type', type)
    formData.append('media', new Blob([fs.readFileSync(mediaPath)]), mediaPath.split(/[/\\]/).pop() ?? 'media')
    if (caption) {
      formData.append('caption', caption)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(`${this.baseUrl}/send/media`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      const data = await res.json()
      return { key: { id: data.key?.id ?? '', remoteJid: to } }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Send presence (composing) indicator. */
  async sendPresence(to: string, presence: 'composing' | 'available' | 'unavailable'): Promise<void> {
    try {
      await this.request('POST', '/presence', { to, presence })
    } catch (err) {
      log.debug('sendPresence', `Presence failed: ${String(err)}`)
    }
  }

  /** Download a media file from a WhatsApp message. */
  async downloadMedia(url: string, destDir: string, fileName?: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`Download failed: HTTP ${res.status}`)
      }

      const buffer = Buffer.from(await res.arrayBuffer())
      const name = fileName ?? `whatsapp_file_${Date.now()}`
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

  /** Check if the bot is connected. */
  isConnected(): boolean {
    return this.connected
  }

  /** Get the account JID. */
  getAccountJid(): string {
    return this.accountJid
  }

  /** Simulate receiving a message (for testing). */
  simulateMessage(msg: WhatsappMessage): void {
    if (this.messageCallback) {
      this.messageCallback(msg)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private async request(method: string, endpoint: string, body?: Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }
}
