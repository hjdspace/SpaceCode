/**
 * git renderer api 的两路行为：electronAPI 在场 → 直通主进程 / 缺席 → 回落默认值。
 *
 * invoke 方法从共享 channel 定义表枚举生成；onStatusChanged 是事件订阅（非 invoke），
 * 由 git.ts 手写，单独钉住其「转发 + noop 退订」两路。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { gitChannels } from '@/shared/channels/git'

const CHANNELS = Object.keys(gitChannels)

const H = vi.hoisted(() => ({
  electronAPI: null as Record<string, Record<string, (...a: unknown[]) => unknown>> | null,
  isH5: false,
}))

vi.mock('../_context', () => ({
  get electronAPI() {
    return H.electronAPI
  },
  get _isH5Mode() {
    return H.isH5
  },
}))

type GitModule = typeof import('../git')

async function importFresh(): Promise<GitModule> {
  vi.resetModules()
  return import('../git')
}

function makeFake() {
  const m: Record<string, (...a: unknown[]) => unknown> = {}
  for (const k of CHANNELS) m[k] = vi.fn((...a: unknown[]) => Promise.resolve({ ok: true, __args: a }))
  // 手写事件订阅：主进程侧同样暴露 onStatusChanged(callback) => unsubscribe
  m.onStatusChanged = vi.fn((..._a: unknown[]) => () => {})
  H.electronAPI = { git: m }
  return m
}

beforeEach(() => {
  H.electronAPI = null
  H.isH5 = false
})

describe('git renderer api', () => {
  it('electronAPI 在场时每个 invoke 方法按原参直通主进程', async () => {
    const fake = makeFake()
    const { git } = await importFresh()
    const arg = '/repo'
    for (const k of CHANNELS) {
      ;(git as unknown as Record<string, (...a: unknown[]) => unknown>)[k](arg)
      expect(fake[k]).toHaveBeenCalledWith(arg)
    }
  })

  it('electronAPI 在场时 onStatusChanged 转发主进程并返回退订函数', async () => {
    const fake = makeFake()
    const { git } = await importFresh()
    const cb = vi.fn()
    const unsub = git.onStatusChanged(cb)
    expect(fake.onStatusChanged).toHaveBeenCalledWith(cb)
    expect(typeof unsub).toBe('function')
  })

  it('electronAPI 缺席时 invoke 方法回落默认值，不静默 undefined', async () => {
    const { git } = await importFresh()
    for (const k of CHANNELS) {
      const p = (git as unknown as Record<string, (...a: unknown[]) => unknown>)[k]({})
      expect(Promise.resolve(p)).toBeInstanceOf(Promise)
    }
  })

  it('electronAPI 缺席时 onStatusChanged 退化为 noop 退订', async () => {
    const { git } = await importFresh()
    const unsub = git.onStatusChanged(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('electronAPI 缺席时关键默认值形状正确', async () => {
    const { git } = await importFresh()
    await expect(git.isRepo('/repo')).resolves.toBe(false)
    await expect(git.getRoot('/repo')).resolves.toBeNull()
    await expect(git.getBranches('/repo')).resolves.toEqual([])
    await expect(git.commit('/repo', 'msg')).resolves.toMatchObject({ success: false })
  })
})
