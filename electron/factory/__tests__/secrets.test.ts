// @vitest-environment node
/**
 * 凭据存储：只允许 safeStorage 加密后的密文落盘；加密不可用时拒绝保存，
 * 让向导退回 gh CLI 登录。明文绝不能出现在文件里。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createFactorySecretStore, type FactorySecretCrypto } from '../secrets'

function fakeCrypto(available = true): FactorySecretCrypto {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const raw = buf.toString('utf-8')
      if (!raw.startsWith('enc:')) throw new Error('bad cipher')
      return raw.slice(4)
    },
  }
}

let dir: string
let filePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-secrets-'))
  filePath = join(dir, 'factory-secrets.json')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createFactorySecretStore', () => {
  it('stores only decrypted-at-read ciphertext', () => {
    const store = createFactorySecretStore({ filePath, crypto: fakeCrypto(true) })
    expect(store.saveGithubToken('ghp_secret')).toEqual({ ok: true })
    expect(store.hasGithubToken()).toBe(true)
    expect(store.readGithubToken()).toBe('ghp_secret')

    const onDisk = readFileSync(filePath, 'utf-8')
    expect(onDisk).not.toContain('ghp_secret')
    const stored = JSON.parse(onDisk) as { githubToken: string }
    expect(Buffer.from(stored.githubToken, 'base64').toString('utf-8')).toBe('enc:ghp_secret')
  })

  it('refuses to store when encryption is unavailable and writes nothing', () => {
    const store = createFactorySecretStore({ filePath, crypto: fakeCrypto(false) })
    expect(store.saveGithubToken('ghp_secret')).toEqual({ ok: false, reason: 'encryption-unavailable' })
    expect(existsSync(filePath)).toBe(false)
    expect(store.readGithubToken()).toBeNull()
  })

  it('rejects an empty token', () => {
    const store = createFactorySecretStore({ filePath, crypto: fakeCrypto(true) })
    expect(store.saveGithubToken('   ')).toEqual({ ok: false, reason: 'invalid-token' })
  })

  it('returns null for corrupt or undecryptable files', () => {
    writeFileSync(filePath, '{not json', 'utf-8')
    expect(createFactorySecretStore({ filePath, crypto: fakeCrypto(true) }).readGithubToken()).toBeNull()

    writeFileSync(filePath, JSON.stringify({ githubToken: Buffer.from('plain').toString('base64') }), 'utf-8')
    expect(createFactorySecretStore({ filePath, crypto: fakeCrypto(true) }).readGithubToken()).toBeNull()
  })

  it('clears the stored token', () => {
    const store = createFactorySecretStore({ filePath, crypto: fakeCrypto(true) })
    store.saveGithubToken('ghp_secret')
    store.clearGithubToken()
    expect(store.hasGithubToken()).toBe(false)
    expect(store.readGithubToken()).toBeNull()
  })

  it('reports write failures instead of throwing', () => {
    mkdirSync(filePath, { recursive: true })
    const debug = vi.fn()
    const store = createFactorySecretStore({ filePath, crypto: fakeCrypto(true), log: debug })
    expect(store.saveGithubToken('ghp_secret')).toEqual({ ok: false, reason: 'write-failed' })
    expect(debug).toHaveBeenCalled()
  })
})
