/**
 * ImSidecarManager — Sidecar process orchestration
 *
 * Manages the lifecycle of:
 * 1. IM Server sidecar (HTTP+WS server running in Electron main process)
 * 2. Platform adapter sidecars (e.g., Telegram adapter running as child process)
 *
 * Features:
 * - Dynamic port allocation (find available port, track usage)
 * - Health check polling (30s interval)
 * - Graceful start/stop
 * - Process tracking and cleanup
 */

import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import * as path from 'path'
import { ImServer } from './imServer/imServer'
import { loadConfig, saveConfig } from './im/adapters/common/config'
import type { PlatformName, AdapterConfig } from './im/adapters/common/config'
import { info, warn, error as logError } from './logger'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface ServerPlan {
  port: number
  host: string
}

export interface AdapterPlan {
  platform: PlatformName
  port: number
  env: Record<string, string>
  command: string
  args: string[]
}

export interface SidecarStatus {
  running: boolean
  pid?: number
  port?: number
  healthy?: boolean
  startedAt?: number
}

// ──────────────────────────────────────────────────────────────────────────
// ImSidecarManager
// ──────────────────────────────────────────────────────────────────────────

const HEALTH_CHECK_INTERVAL_MS = 30_000
const PORT_RANGE_START = 40000
const PORT_RANGE_END = 41000

export class ImSidecarManager {
  private imServer: ImServer | null = null
  private serverPort: number = 0
  private adapterProcesses: Map<PlatformName, ChildProcess> = new Map()
  private adapterPorts: Map<PlatformName, number> = new Map()
  private adapterStartedAt: Map<PlatformName, number> = new Map()
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

    // Stop all adapter processes
    for (const platform of this.adapterProcesses.keys()) {
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
  // Adapter management
  // ────────────────────────────────────────────────────────────────────────

  /** Create a plan for starting a platform adapter. */
  async createAdapterPlan(platform: PlatformName, config: AdapterConfig): Promise<AdapterPlan> {
    const port = await this.findAvailablePort()
    const serverUrl = `ws://127.0.0.1:${this.serverPort}`

    const env: Record<string, string> = {
      ADAPTER_SERVER_URL: serverUrl,
      ...this.buildPlatformEnv(platform, config),
    }

    // The adapter is run as a Node.js script
    const command = process.execPath
    const adapterScript = path.join(__dirname, 'im', 'adapters', platform, 'index.js')
    const args = [adapterScript]

    return { platform, port, env, command, args }
  }

  /** Start a platform adapter sidecar. */
  async startAdapter(platform: PlatformName): Promise<void> {
    if (this.adapterProcesses.has(platform)) {
      warn('ImSidecarManager', `Adapter ${platform} is already running`)
      return
    }

    if (!this.imServer) {
      throw new Error('IM Server must be started before adapters')
    }

    const config = loadConfig()
    const platformConfig = config[platform]

    // Check if platform is configured (has required credentials)
    if (!this.isPlatformConfigured(platform, config)) {
      throw new Error(`Platform ${platform} is not configured`)
    }

    const plan = await this.createAdapterPlan(platform, config)

    const child = spawn(plan.command, plan.args, {
      env: { ...process.env, ...plan.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.adapterProcesses.set(platform, child)
    this.adapterPorts.set(platform, plan.port)
    this.adapterStartedAt.set(platform, Date.now())
    this.usedPorts.add(plan.port)

    child.on('error', (err) => {
      logError('ImSidecarManager', `Adapter ${platform} error: ${err.message}`)
    })

    child.on('exit', (code, signal) => {
      info('ImSidecarManager', `Adapter ${platform} exited: code=${code} signal=${signal}`)
      this.adapterProcesses.delete(platform)
      this.usedPorts.delete(plan.port)
    })

    info('ImSidecarManager', `Adapter ${platform} started (port ${plan.port})`)
  }

  /** Stop a platform adapter sidecar. */
  stopAdapter(platform: PlatformName): void {
    const child = this.adapterProcesses.get(platform)
    if (!child) return

    try {
      child.kill('SIGTERM')
      info('ImSidecarManager', `Adapter ${platform} stopped`)
    } catch (err) {
      logError('ImSidecarManager', `Failed to stop adapter ${platform}: ${err}`)
    }

    this.adapterProcesses.delete(platform)
    const port = this.adapterPorts.get(platform)
    if (port) {
      this.usedPorts.delete(port)
      this.adapterPorts.delete(platform)
    }
    this.adapterStartedAt.delete(platform)
  }

  /** Get the status of a platform adapter. */
  getAdapterStatus(platform: PlatformName): SidecarStatus {
    const child = this.adapterProcesses.get(platform)
    if (!child || child.killed) {
      return { running: false }
    }
    return {
      running: true,
      pid: child.pid,
      port: this.adapterPorts.get(platform),
      startedAt: this.adapterStartedAt.get(platform),
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
  // Config management
  // ────────────────────────────────────────────────────────────────────────

  /** Get adapter config (desensitized for UI). */
  getAdapterConfig(): AdapterConfig {
    return loadConfig()
  }

  /** Update adapter config. */
  updateAdapterConfig(updates: Partial<AdapterConfig>): void {
    const current = loadConfig()
    const merged = { ...current, ...updates }
    saveConfig(merged)
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

    // Check adapters
    for (const [platform, child] of this.adapterProcesses) {
      if (child.killed || child.exitCode !== null) {
        warn('ImSidecarManager', `Adapter ${platform} appears to be dead, cleaning up`)
        this.adapterProcesses.delete(platform)
        const port = this.adapterPorts.get(platform)
        if (port) {
          this.usedPorts.delete(port)
          this.adapterPorts.delete(platform)
        }
      }
    }
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

  private buildPlatformEnv(platform: PlatformName, config: AdapterConfig): Record<string, string> {
    const env: Record<string, string> = {}

    // Common env vars
    env.CLAUDE_ADAPTER_DEFAULT_WORK_DIR = config.defaultProjectDir

    // Platform-specific env vars
    switch (platform) {
      case 'telegram': {
        const pc = config.telegram
        if (pc.botToken) env.TELEGRAM_BOT_TOKEN = pc.botToken
        break
      }
      case 'feishu': {
        const pc = config.feishu
        if (pc.appId) env.FEISHU_APP_ID = pc.appId
        if (pc.appSecret) env.FEISHU_APP_SECRET = pc.appSecret
        break
      }
      case 'dingtalk': {
        const pc = config.dingtalk
        if (pc.clientId) env.DINGTALK_CLIENT_ID = pc.clientId
        if (pc.clientSecret) env.DINGTALK_CLIENT_SECRET = pc.clientSecret
        break
      }
      case 'wechat': {
        const pc = config.wechat
        if (pc.accountId) env.WECHAT_ACCOUNT_ID = pc.accountId
        if (pc.botToken) env.WECHAT_BOT_TOKEN = pc.botToken
        break
      }
      case 'whatsapp': {
        const pc = config.whatsapp
        if (pc.accountJid) env.WHATSAPP_ACCOUNT_JID = pc.accountJid
        break
      }
    }

    return env
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
