/**
 * uuid 测试 — UUID 生成与 randomUUID 降级。
 *
 * createUuid 优先走 crypto.randomUUID，缺失时退回手写的 v4 拼装
 * （H5 页面在非安全上下文里没有 randomUUID）。installRandomUUIDFallback
 * 负责在全局 crypto 上补这个洞，所有分支都是 best-effort，失败静默。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createUuid, installRandomUUIDFallback } from '@/utils/uuid'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const originalCrypto = globalThis.crypto

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
})

function stubCrypto(value: unknown) {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true })
}

describe('createUuid', () => {
  it('delegates to crypto.randomUUID when available', () => {
    stubCrypto({ randomUUID: () => 'native-uuid' })
    expect(createUuid()).toBe('native-uuid')
  })

  it('falls back to a hand-rolled v4 UUID when randomUUID is missing', () => {
    stubCrypto({ getRandomValues: (bytes: Uint8Array) => bytes.fill(0) })
    const uuid = createUuid()
    // 全零字节也会被强制写上 version(4) 与 variant(8) 位
    expect(uuid).toBe('00000000-0000-4000-8000-000000000000')
    expect(uuid).toMatch(UUID_V4_RE)
  })

  it('produces valid v4 UUIDs without any crypto at all (Math.random path)', () => {
    stubCrypto(undefined)
    for (let i = 0; i < 50; i++) {
      expect(createUuid()).toMatch(UUID_V4_RE)
    }
  })

  it('generates distinct values on the fallback path', () => {
    stubCrypto(undefined)
    const a = createUuid()
    const b = createUuid()
    expect(a).not.toBe(b)
  })
})

describe('installRandomUUIDFallback', () => {
  it('does nothing when crypto.randomUUID already exists', () => {
    const native = () => 'native-uuid'
    stubCrypto({ randomUUID: native })
    installRandomUUIDFallback()
    expect((globalThis.crypto as { randomUUID: unknown }).randomUUID).toBe(native)
  })

  it('defines randomUUID on an existing crypto object that lacks it', () => {
    stubCrypto({ getRandomValues: (b: Uint8Array) => b })
    installRandomUUIDFallback()
    const uuid = (globalThis.crypto as { randomUUID: () => string }).randomUUID()
    expect(uuid).toMatch(UUID_V4_RE)
  })

  it('creates a crypto object when none exists', () => {
    stubCrypto(undefined)
    installRandomUUIDFallback()
    const uuid = (globalThis.crypto as { randomUUID: () => string }).randomUUID()
    expect(uuid).toMatch(UUID_V4_RE)
  })

  it('silently survives a non-configurable crypto global', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: false,
    })
    // 定义失败时只应静默返回，不得抛错
    expect(() => installRandomUUIDFallback()).not.toThrow()
  })
})
