/**
 * Factory 凭据存储 — GitHub token 只以 safeStorage 密文落盘。
 *
 * 文件固定在 Electron `userData` 下（由调用方传入路径），不写项目目录、
 * 不进配置文件、不进日志。加密不可用时只允许 gh CLI 登录。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { FactorySecretSaveResult } from '@/shared/factory'

export type { FactorySecretSaveResult }

export interface FactorySecretCrypto {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface FactorySecretStore {
  readonly encryptionAvailable: boolean
  saveGithubToken(token: string): FactorySecretSaveResult
  hasGithubToken(): boolean
  readGithubToken(): string | null
  clearGithubToken(): void
}

interface SecretFile {
  githubToken?: string
  savedAt?: string
}

export interface FactorySecretStoreOptions {
  filePath: string
  crypto: FactorySecretCrypto
  /** 失败时只记录，不抛出；默认 no-op，便于测试注入。 */
  log?: (message: string, error?: unknown) => void
}

export function createFactorySecretStore(options: FactorySecretStoreOptions): FactorySecretStore {
  const { filePath, crypto, log } = options
  const encryptionAvailable = crypto.isEncryptionAvailable()

  function readFileSafe(): SecretFile | null {
    try {
      if (!existsSync(filePath)) return null
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
      return typeof parsed === 'object' && parsed !== null ? (parsed as SecretFile) : null
    } catch {
      return null
    }
  }

  function readGithubToken(): string | null {
    const data = readFileSafe()
    if (!data?.githubToken) return null
    try {
      return crypto.decryptString(Buffer.from(data.githubToken, 'base64'))
    } catch (err) {
      log?.('Failed to decrypt factory github token', err)
      return null
    }
  }

  function saveGithubToken(token: string): FactorySecretSaveResult {
    const trimmed = token.trim()
    if (!trimmed) return { ok: false, reason: 'invalid-token' }
    if (!encryptionAvailable) return { ok: false, reason: 'encryption-unavailable' }

    try {
      const encrypted = crypto.encryptString(trimmed)
      mkdirSync(dirname(filePath), { recursive: true })
      const payload: SecretFile = {
        githubToken: encrypted.toString('base64'),
        savedAt: new Date().toISOString(),
      }
      writeFileSync(filePath, JSON.stringify(payload), { encoding: 'utf-8', mode: 0o600 })
      try {
        chmodSync(filePath, 0o600)
      } catch {
        // Windows 上 chmod 基本无效；文件仍受 userData 目录权限保护。
      }
      return { ok: true }
    } catch (err) {
      log?.('Failed to persist factory github token', err)
      return { ok: false, reason: 'write-failed' }
    }
  }

  function clearGithubToken(): void {
    try {
      if (existsSync(filePath)) unlinkSync(filePath)
    } catch (err) {
      log?.('Failed to clear factory github token', err)
    }
  }

  return {
    encryptionAvailable,
    saveGithubToken,
    hasGithubToken: () => readGithubToken() !== null,
    readGithubToken,
    clearGithubToken,
  }
}
