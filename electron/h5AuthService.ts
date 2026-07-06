// electron/h5AuthService.ts
// H5 Token 管理（生成、验证、持久化）与局域网 IP 发现

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import os from 'os'
import type { H5AccessSettings } from './h5Types'

const TOKEN_PREFIX = 'h5_'
const TOKEN_REGEX = /^h5_[A-Za-z0-9_-]{16,512}$/

export class H5AuthService {
  private settingsPath: string
  private cachedSettings: H5AccessSettings | null = null

  constructor() {
    // 延迟调用 app.getPath — 仅在 Electron app ready 后使用
    this.settingsPath = join(app.getPath('userData'), 'h5-access.json')
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private createToken(): string {
    return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  }

  private createTokenPreview(token: string): string {
    return `${token.slice(0, 8)}...${token.slice(-4)}`
  }

  private readSettings(): H5AccessSettings {
    if (this.cachedSettings) return this.cachedSettings
    try {
      const raw = readFileSync(this.settingsPath, 'utf-8')
      this.cachedSettings = JSON.parse(raw)
    } catch {
      this.cachedSettings = {
        enabled: false,
        token: null,
        tokenPreview: null,
        publicBaseUrl: null,
        fixedPort: null,
      }
    }
    return this.cachedSettings!
  }

  private writeSettings(settings: H5AccessSettings): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true })
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    this.cachedSettings = settings
  }

  getSettings(): H5AccessSettings {
    return this.readSettings()
  }

  enable(): { settings: H5AccessSettings; token: string } {
    const current = this.readSettings()
    // 复用已有 token（已配对的手机不会断连）
    const token = current.token && TOKEN_REGEX.test(current.token)
      ? current.token
      : this.createToken()
    const next: H5AccessSettings = {
      ...current,
      enabled: true,
      token,
      tokenPreview: this.createTokenPreview(token),
    }
    this.writeSettings(next)
    return { settings: next, token }
  }

  disable(): H5AccessSettings {
    const current = this.readSettings()
    const next: H5AccessSettings = { ...current, enabled: false }
    this.writeSettings(next)
    return next
  }

  regenerateToken(): { settings: H5AccessSettings; token: string } {
    const current = this.readSettings()
    const token = this.createToken()
    const next: H5AccessSettings = {
      ...current,
      enabled: true,
      token,
      tokenPreview: this.createTokenPreview(token),
    }
    this.writeSettings(next)
    return { settings: next, token }
  }

  updateSettings(input: Partial<Pick<H5AccessSettings, 'publicBaseUrl' | 'fixedPort'>>): H5AccessSettings {
    const current = this.readSettings()
    const next: H5AccessSettings = { ...current, ...input }
    this.writeSettings(next)
    return next
  }

  /** timing-safe Token 验证 */
  validateToken(token: string | null | undefined): boolean {
    if (!token) return false
    const settings = this.readSettings()
    if (!settings.enabled || !settings.token) return false

    const providedHash = Buffer.from(this.hashToken(token), 'hex')
    const expectedHash = Buffer.from(this.hashToken(settings.token), 'hex')
    if (providedHash.length !== expectedHash.length) return false
    return timingSafeEqual(providedHash, expectedHash)
  }

  /** 发现局域网 IP（评分排序，物理接口优先） */
  findLanIP(): string {
    const interfaces = os.networkInterfaces()
    const candidates: Array<{ address: string; score: number }> = []

    for (const [name, entries] of Object.entries(interfaces)) {
      if (!entries) continue
      for (const entry of entries) {
        if (entry.family !== 'IPv4' || entry.internal) continue
        let score = 0
        if (/^(wi-?fi|wlan|ethernet|en\d+|eth\d+)/i.test(name)) score += 100
        if (/^(wsl|docker|hyper-?v|veth|virtual|vmware)/i.test(name)) score -= 200
        if (entry.address.startsWith('192.168.')) score += 30
        else if (entry.address.startsWith('10.')) score += 20
        else if (/^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)) score += 10
        if (/^169\.254\./.test(entry.address)) score -= 100
        candidates.push({ address: entry.address, score })
      }
    }

    candidates.sort((a, b) => b.score - a.score)
    return candidates[0]?.address ?? '127.0.0.1'
  }
}
