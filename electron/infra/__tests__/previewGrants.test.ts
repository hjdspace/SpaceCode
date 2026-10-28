// @vitest-environment node
/**
 * 预览 grant 的有效期与会话归属（Issue #64 第 1 项）。
 *
 * 桌面 token 随应用生命周期；H5 签发的 token 必须能自己过期，且不同会话
 * 不复用同一份登记 —— 否则一个会话的预览 URL 会在另一个会话里继续可读。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PreviewGrants } from '../previewGrants'

let dir: string
let file: string

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  dir = mkdtempSync(join(tmpdir(), 'preview-grants-'))
  file = join(dir, 'index.html')
  writeFileSync(file, '<h1>grant</h1>')
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('token 有效期', () => {
  it('不传 ttl 的桌面 token 不会过期', () => {
    const grants = new PreviewGrants()
    const grant = grants.register(file)!

    vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000)

    expect(grants.rootFor(grant.token)).toBe(grant.root)
    const decision = grants.authorize(grant.root, grant.rel)
    expect('serve' in decision).toBe(true)
    if ('serve' in decision) {
      expect(readFileSync(decision.serve).toString()).toContain('grant')
    }
  })

  it('带 ttl 的 token 到期后 rootFor 返回 undefined，并顺手删除', () => {
    const grants = new PreviewGrants()
    const grant = grants.register(file, { ttlMs: 1000, sessionId: 's1' })!

    vi.setSystemTime(Date.now() + 1001)

    expect(grants.rootFor(grant.token)).toBeUndefined()
    // 删除后重新登记是另一枚 token
    const again = grants.register(file, { ttlMs: 1000, sessionId: 's1' })!
    expect(again.token).not.toBe(grant.token)
  })

  it('同一会话重复登记会续期，不换 token', () => {
    const grants = new PreviewGrants()
    const first = grants.register(file, { ttlMs: 1000, sessionId: 's1' })!

    vi.setSystemTime(Date.now() + 800)
    const refreshed = grants.register(file, { ttlMs: 1000, sessionId: 's1' })!

    expect(refreshed.token).toBe(first.token)

    // 距首次已 1100ms，但距续期只有 300ms，仍然有效
    vi.setSystemTime(Date.now() + 300)
    expect(grants.rootFor(first.token)).toBe(first.root)

    vi.setSystemTime(Date.now() + 701)
    expect(grants.rootFor(first.token)).toBeUndefined()
  })
})

describe('登记根', () => {
  it('登记目录本身时以目录为根，不会把可读面抬到父目录', () => {
    const grants = new PreviewGrants()
    const grant = grants.register(dir)!

    expect(grant.root).toBe(realpathSync(dir))
  })
})

describe('会话归属', () => {
  it('同一目录下不同会话各拿一枚 token', () => {
    const grants = new PreviewGrants()
    const first = grants.register(file, { ttlMs: 1000, sessionId: 's1' })!
    const second = grants.register(file, { ttlMs: 1000, sessionId: 's2' })!

    expect(second.token).not.toBe(first.token)
    expect(second.root).toBe(first.root)
  })

  it('桌面登记（无会话）与 H5 会话登记不复用', () => {
    const grants = new PreviewGrants()
    const desktop = grants.register(file)!
    const remote = grants.register(file, { ttlMs: 1000, sessionId: 's1' })!

    expect(remote.token).not.toBe(desktop.token)
  })
})
