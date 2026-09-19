/**
 * ImSidecarManager — Sidecar process orchestration
 *
 * Manages the lifecycle of:
 * 1. IM Server sidecar (HTTP+WS server running in Electron main process)
 * 2. Platform adapters (running in-process, e.g., Telegram, WeChat, Feishu)
 *
 * Features:
 * - Dynamic port allocation (find available port, track usage)
 * - Health check polling (30s interval)
 * - Graceful start/stop
 * - In-process adapter lifecycle management
 */

import * as net from 'net'
import { ImServer } from './imServer/imServer'
import { loadConfig, saveConfig, desensitizeConfig } from './im/adapters/common/config'
import type { PlatformName, AdapterConfig } from './im/adapters/common/config'
import { info, warn, error as logError } from './logger'

// Adapter & Bot imports (in-process)
import { TelegramBot } from './im/adapters/telegram/telegramBot'
import { TelegramAdapter } from './im/adapters/telegram/telegramAdapter'
import { FeishuBot } from './im/adapters/feishu/feishuBot'
import { FeishuAdapter } from './im/adapters/feishu/feishuAdapter'
import { DingtalkBot } from './im/adapters/dingtalk/dingtalkBot'
import { DingtalkAdapter } from './im/adapters/dingtalk/dingtalkAdapter'
import { WechatBot } from './im/adapters/wechat/wechatBot'
import { WechatAdapter } from './im/adapters/wechat/wechatAdapter'
import { WhatsappBot } from './im/adapters/whatsapp/whatsappBot'
import { WhatsappAdapter } from './im/adapters/whatsapp/whatsappAdapter'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface ServerPlan {
  port: number
  host: string
}

/** Common interface for all platform adapters — start/stop lifecycle. */
interface RunnableAdapter {
  start(): Promise<void>
  stop(): Promise<void>
}

/** Tracks a running in-process adapter instance. */
interface AdapterInstance {
  adapter: RunnableAdapter
  startedAt: number
}

export interface SidecarStatus {
  running: boolean
  port?: number
  healthy?: boolean
  startedAt?: number
}

// ──────────────────────────────────────────────────────────────────────────
// WeChat QR Login Types
// ──────────────────────────────────────────────────────────────────────────

export type WechatQrStatus = 'waiting' | 'scanned' | 'confirmed' | 'expired'

export interface WechatQrLoginResult {
  qrcodeUrl: string
  qrcodeId: string
}

export interface WechatQrStatusResult {
  status: WechatQrStatus
  accountId?: string
  botToken?: string
  baseUrl?: string
  userId?: string
}

// ──────────────────────────────────────────────────────────────────────────
// ImSidecarManager
// ──────────────────────────────────────────────────────────────────────────

const HEALTH_CHECK_INTERVAL_MS = 30_000
const PORT_RANGE_START = 40000
const PORT_RANGE_END = 41000

const WECHAT_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'

export class ImSidecarManager {
  private imServer: ImServer | null = null
  private serverPort: number = 0
  private adapterInstances: Map<PlatformName, AdapterInstance> = new Map()
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private usedPorts: Set<number> = new Set()

  // ────────────────────────────────────────────────────────────────────────
  // Server management
  // ────────────────────────────────────────────────────────────────────────

  /** Create a plan for starting the IM Server. */
  async createServerPlan(): Promise<ServerPlan> {
    const port = await this.findAvailablePort()
    return { port, host: '127.0.0.1' }
  }

  /** Start the IM Server sidecar. */
  async startServer(): Promise<ServerPlan> {
    if (this.imServer) {
      warn('ImSidecarManager', 'IM Server is already running')
      return { port: this.serverPort, host: '127.0.0.1' }
    }

    const plan = await this.createServerPlan()

    this.imServer = new ImServer()
    const { port, host } = await this.imServer.start(plan.port, plan.host)
    this.serverPort = port
    this.usedPorts.add(port)

    info('ImSidecarManager', `IM Server started on ${host}:${port}`)

    // Start health check
    this.startHealthCheck()

    return { port, host }
  }

  /** Stop the IM Server sidecar. */
  stopServer(): void {
    this.stopHealthCheck()

    // Stop all adapter instances
    for (const platform of this.adapterInstances.keys()) {
      this.stopAdapter(platform)
    }

    if (this.imServer) {
      this.imServer.stop()
      this.imServer = null
      this.usedPorts.delete(this.serverPort)
      info('ImSidecarManager', `IM Server stopped (port ${this.serverPort})`)
      this.serverPort = 0
    }
  }

  /** Get the IM Server status. */
  getServerStatus(): SidecarStatus {
    if (!this.imServer) {
      return { running: false }
    }
    return {
      running: true,
      port: this.serverPort,
      healthy: true, // If ImServer is running, it's healthy
      startedAt: Date.now(), // Approximate
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Adapter management (in-process)
  // ────────────────────────────────────────────────────────────────────────

  /** Start a platform adapter in-process. */
  async startAdapter(platform: PlatformName): Promise<void> {
    if (this.adapterInstances.has(platform)) {
      warn('ImSidecarManager', `Adapter ${platform} is already running`)
      return
    }

    if (!this.imServer) {
      throw new Error('IM Server must be started before adapters')
    }

    const config = loadConfig()

    // Check if platform is configured (has required credentials)
    if (!this.isPlatformConfigured(platform, config)) {
      throw new Error(`Platform ${platform} is not configured`)
    }

    const serverUrl = `ws://127.0.0.1:${this.serverPort}`
    const adapter = this.createAdapter(platform, config, serverUrl)

    try {
      await adapter.start()
    } catch (err) {
      logError('ImSidecarManager', `Failed to start adapter ${platform}: ${err}`)
      throw err
    }

    this.adapterInstances.set(platform, { adapter, startedAt: Date.now() })
    info('ImSidecarManager', `Adapter ${platform} started (in-process)`)
  }

  /** Stop a platform adapter. */
  stopAdapter(platform: PlatformName): void {
    const instance = this.adapterInstances.get(platform)
    if (!instance) return

    try {
      instance.adapter.stop()
      info('ImSidecarManager', `Adapter ${platform} stopped`)
    } catch (err) {
      logError('ImSidecarManager', `Failed to stop adapter ${platform}: ${err}`)
    }

    this.adapterInstances.delete(platform)
  }

  /** Get the status of a platform adapter. */
  getAdapterStatus(platform: PlatformName): SidecarStatus {
    const instance = this.adapterInstances.get(platform)
    if (!instance) {
      return { running: false }
    }
    return {
      running: true,
      port: this.serverPort,
      startedAt: instance.startedAt,
    }
  }

  /** Get all adapter statuses. */
  getAllAdapterStatuses(): Record<PlatformName, SidecarStatus> {
    const platforms: PlatformName[] = ['telegram', 'feishu', 'dingtalk', 'wechat', 'whatsapp']
    const result = {} as Record<PlatformName, SidecarStatus>
    for (const p of platforms) {
      result[p] = this.getAdapterStatus(p)
    }
    return result
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pairing management
  // ────────────────────────────────────────────────────────────────────────

  /** Generate a pairing code and save to config. */
  generatePairingCode(): { code: string; expiresAt: number } {
    const crypto = require('crypto') as typeof import('crypto')
    const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    const bytes = crypto.randomBytes(6)
    let code = ''
    for (let i = 0; i < 6; i++) {
      code += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length]
    }

    const now = Date.now()
    const expiresAt = now + 60 * 60 * 1000 // 60 minutes

    const config = loadConfig()
    config.pairing = {
      code,
      expiresAt,
      createdAt: now,
    }
    saveConfig(config)

    info('ImSidecarManager', `Pairing code generated: ${code}`)
    return { code, expiresAt }
  }

  /** Get current pairing code. */
  getPairingCode(): { code: string | null; expiresAt: number | null } {
    const config = loadConfig()
    return {
      code: config.pairing.code,
      expiresAt: config.pairing.expiresAt,
    }
  }

  /** Clear the pairing code. */
  clearPairingCode(): void {
    const config = loadConfig()
    config.pairing = { code: null, expiresAt: null, createdAt: null }
    saveConfig(config)
  }

  // ────────────────────────────────────────────────────────────────────────
  // WeChat QR Login
  // ────────────────────────────────────────────────────────────────────────

  /** Start WeChat QR login by fetching a QR code from the WeChat gateway. */
  async startWechatQrLogin(): Promise<WechatQrLoginResult> {
    const config = loadConfig()
    const baseUrl = config.wechat.baseUrl || WECHAT_DEFAULT_BASE_URL

    const response = await fetch(
      `${baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`,
    )
    if (!response.ok) {
      throw new Error(`Failed to get WeChat QR code: HTTP ${response.status}`)
    }

    const data = (await response.json()) as {
      qrcode?: string
      qrcode_img_content?: string
    }

    if (!data.qrcode) {
      throw new Error('No qrcode in WeChat gateway response')
    }

    info('ImSidecarManager', `WeChat QR login started (qrcodeId: ${data.qrcode})`)

    return {
      qrcodeUrl: data.qrcode_img_content || '',
      qrcodeId: data.qrcode,
    }
  }

  /** Check WeChat QR login status. Saves credentials to config when confirmed. */
  async checkWechatQrStatus(qrcodeId: string): Promise<WechatQrStatusResult> {
    const config = loadConfig()
    const baseUrl = config.wechat.baseUrl || WECHAT_DEFAULT_BASE_URL

    const response = await fetch(
      `${baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeId)}`,
      { headers: { 'iLink-App-ClientVersion': '1' } },
    )

    if (!response.ok) {
      throw new Error(`WeChat QR status check failed: HTTP ${response.status}`)
    }

    const data = (await response.json()) as {
      status?: string
      bot_token?: string
      ilink_bot_id?: string
      baseurl?: string
      ilink_user_id?: string
    }

    switch (data.status) {
      case 'confirmed': {
        // Save credentials to config
        const current = loadConfig()
        current.wechat.accountId = data.ilink_bot_id || current.wechat.accountId
        current.wechat.botToken = data.bot_token || current.wechat.botToken
        current.wechat.baseUrl = data.baseurl || current.wechat.baseUrl || WECHAT_DEFAULT_BASE_URL
        current.wechat.userId = data.ilink_user_id || current.wechat.userId
        saveConfig(current)

        info('ImSidecarManager', `WeChat QR login confirmed (accountId: ${data.ilink_bot_id})`)

        return {
          status: 'confirmed',
          accountId: data.ilink_bot_id,
          botToken: data.bot_token,
          baseUrl: data.baseurl,
          userId: data.ilink_user_id,
        }
      }
      case 'scaned':
        return { status: 'scanned' }
      case 'expired':
        return { status: 'expired' }
      case 'wait':
      default:
        return { status: 'waiting' }
    }
  }

  /** Unbind WeChat bot account — clears all wechat credentials and user data. */
  unbindWechat(): void {
    const config = loadConfig()
    config.wechat.accountId = ''
    config.wechat.botToken = ''
    config.wechat.userId = ''
    config.wechat.allowedUsers = []
    config.wechat.pairedUsers = []
    // Preserve baseUrl and defaultWorkDir
    saveConfig(config)

    // Stop the wechat adapter if running
    if (this.adapterInstances.has('wechat')) {
      this.stopAdapter('wechat')
    }

    info('ImSidecarManager', 'WeChat bot account unbound')
  }

  /** Check if WeChat bot account is bound. */
  isWechatBound(): boolean {
    const config = loadConfig()
    return !!config.wechat.accountId && !!config.wechat.botToken
  }

  // ────────────────────────────────────────────────────────────────────────
  // Config management
  // ────────────────────────────────────────────────────────────────────────

  /** Get adapter config (desensitized for UI). */
  getAdapterConfig(): AdapterConfig {
    return desensitizeConfig(loadConfig())
  }

  /** Update adapter config, preserving original secrets when desensitized marker is sent. */
  updateAdapterConfig(updates: Partial<AdapterConfig>): void {
    const current = loadConfig()

    // Merge top-level non-platform fields
    if (updates.serverUrl !== undefined) current.serverUrl = updates.serverUrl
    if (updates.defaultProjectDir !== undefined) current.defaultProjectDir = updates.defaultProjectDir
    if (updates.pairing) current.pairing = { ...current.pairing, ...updates.pairing }

    // Merge platform configs, preserving original secret values
    if (updates.telegram) {
      current.telegram = {
        ...current.telegram,
        ...updates.telegram,
        botToken: this.preserveSecret(current.telegram.botToken, updates.telegram.botToken),
      }
    }
    if (updates.feishu) {
      current.feishu = {
        ...current.feishu,
        ...updates.feishu,
        appSecret: this.preserveSecret(current.feishu.appSecret, updates.feishu.appSecret),
        encryptKey: this.preserveSecretOpt(current.feishu.encryptKey, updates.feishu.encryptKey),
        verificationToken: this.preserveSecretOpt(current.feishu.verificationToken, updates.feishu.verificationToken),
      }
    }
    if (updates.dingtalk) {
      current.dingtalk = {
        ...current.dingtalk,
        ...updates.dingtalk,
        clientSecret: this.preserveSecret(current.dingtalk.clientSecret, updates.dingtalk.clientSecret),
      }
    }
    if (updates.wechat) {
      current.wechat = {
        ...current.wechat,
        ...updates.wechat,
        botToken: this.preserveSecret(current.wechat.botToken, updates.wechat.botToken),
      }
    }
    if (updates.whatsapp) {
      current.whatsapp = { ...current.whatsapp, ...updates.whatsapp }
    }

    saveConfig(current)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Health check
  // ────────────────────────────────────────────────────────────────────────

  private startHealthCheck(): void {
    if (this.healthCheckTimer) return

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck()
    }, HEALTH_CHECK_INTERVAL_MS)

    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref()
    }
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  private async performHealthCheck(): Promise<void> {
    // Check server
    if (this.imServer && this.serverPort > 0) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.serverPort}/health`)
        if (!res.ok) {
          warn('ImSidecarManager', `Server health check returned ${res.status}`)
        }
      } catch {
        warn('ImSidecarManager', 'Server health check failed')
      }
    }

    // Adapters run in-process; no separate health check needed.
    // The IM Server health check above covers the shared server.
  }

  // ────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ────────────────────────────────────────────────────────────────────────

  /** Stop everything and clean up. */
  destroy(): void {
    this.stopServer()
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────

  private async findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          const port = addr.port
          server.close(() => resolve(port))
        } else {
          server.close()
          reject(new Error('Failed to find available port'))
        }
      })
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // In-process adapter factory
  // ────────────────────────────────────────────────────────────────────────

  /** Create a platform adapter instance with its bot client. */
  private createAdapter(platform: PlatformName, config: AdapterConfig, serverUrl: string): RunnableAdapter {
    switch (platform) {
      case 'telegram': {
        const pc = config.telegram
        const bot = new TelegramBot(pc.botToken)
        return new TelegramAdapter({ bot, config, serverUrl })
      }
      case 'feishu': {
        const pc = config.feishu
        const bot = new FeishuBot(pc.appId, pc.appSecret)
        return new FeishuAdapter({ bot, config, serverUrl })
      }
      case 'dingtalk': {
        const pc = config.dingtalk
        const bot = new DingtalkBot(pc.clientId, pc.clientSecret, { apiBase: pc.endpoint || undefined })
        return new DingtalkAdapter({ bot, config, serverUrl })
      }
      case 'wechat': {
        const pc = config.wechat
        const bot = new WechatBot(pc.accountId, pc.botToken, pc.userId, { baseUrl: pc.baseUrl || undefined })
        return new WechatAdapter({ bot, config, serverUrl })
      }
      case 'whatsapp': {
        const pc = config.whatsapp
        const bot = new WhatsappBot(pc.accountJid, { authDir: pc.authDir || undefined })
        return new WhatsappAdapter({ bot, config, serverUrl })
      }
      default:
        throw new Error(`Unknown platform: ${platform}`)
    }
  }

  private static readonly DESENSITIZED_MARKER = '******'

  /** Preserve original secret when incoming value is the desensitized marker. */
  private preserveSecret(original: string, updated: string | undefined): string {
    if (updated === ImSidecarManager.DESENSITIZED_MARKER && original) return original
    return updated ?? ''
  }

  /** Preserve original optional secret when incoming value is the desensitized marker. */
  private preserveSecretOpt(original: string | undefined, updated: string | undefined): string | undefined {
    if (updated === ImSidecarManager.DESENSITIZED_MARKER && original) return original
    return updated
  }

  private isPlatformConfigured(platform: PlatformName, config: AdapterConfig): boolean {
    switch (platform) {
      case 'telegram':
        return !!config.telegram.botToken
      case 'feishu':
        return !!config.feishu.appId && !!config.feishu.appSecret
      case 'dingtalk':
        return !!config.dingtalk.clientId && !!config.dingtalk.clientSecret
      case 'wechat':
        return !!config.wechat.accountId && !!config.wechat.botToken
      case 'whatsapp':
        return !!config.whatsapp.accountJid
      default:
        return false
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Singleton instance
// ──────────────────────────────────────────────────────────────────────────

let instance: ImSidecarManager | null = null

export function getImSidecarManager(): ImSidecarManager {
  if (!instance) {
    instance = new ImSidecarManager()
  }
  return instance
}
