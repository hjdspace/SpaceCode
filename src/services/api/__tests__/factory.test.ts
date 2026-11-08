/**
 * factory renderer api 的两路行为：electronAPI 在场 → 直通主进程 / 缺席 → 回落默认值或 noop 退订。
 *
 * 驱动方式与 shell.test.ts 一致：mock 掉 ../_context 的 electronAPI getter，
 * 在 importFresh 之前切换 H.electronAPI，让 createRendererApi 捕获到目标值。
 * 方法名与事件名从共享 channel 定义表枚举，而不是手写一份平行清单。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { factoryNamespace } from '@/shared/channels/factory'

const CHANNELS = Object.keys(factoryNamespace.channels)
const EVENTS = Object.keys(factoryNamespace.events)

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

type FactoryModule = typeof import('../factory')

async function importFresh(): Promise<FactoryModule> {
  vi.resetModules()
  return import('../factory')
}

function makeFake() {
  const m: Record<string, (...a: unknown[]) => unknown> = {}
  for (const k of CHANNELS) m[k] = vi.fn((...a: unknown[]) => Promise.resolve({ ok: true, __args: a }))
  for (const k of EVENTS) m[k] = vi.fn((...a: unknown[]) => () => {})
  H.electronAPI = { factory: m }
  return m
}

beforeEach(() => {
  H.electronAPI = null
  H.isH5 = false
})

describe('factory renderer api', () => {
  it('electronAPI 在场时每个 invoke 方法按原参直通主进程', async () => {
    const fake = makeFake()
    const { factory } = await importFresh()
    const arg = { repoRoot: '/repo' }
    for (const k of CHANNELS) {
      ;(factory as unknown as Record<string, (...a: unknown[]) => unknown>)[k](arg)
      expect(fake[k]).toHaveBeenCalledWith(arg)
    }
  })

  it('electronAPI 在场时事件订阅转发主进程并返回退订函数', async () => {
    const fake = makeFake()
    const { factory } = await importFresh()
    for (const k of EVENTS) {
      const cb = vi.fn()
      const unsub = (factory as unknown as Record<string, (cb: unknown) => () => void>)[k](cb)
      expect(fake[k]).toHaveBeenCalledWith(cb)
      expect(typeof unsub).toBe('function')
    }
  })

  it('electronAPI 缺席时 invoke 方法回落默认值，不静默 undefined', async () => {
    const { factory } = await importFresh()
    for (const k of CHANNELS) {
      const p = (factory as unknown as Record<string, (...a: unknown[]) => unknown>)[k]({})
      expect(Promise.resolve(p)).toBeInstanceOf(Promise)
    }
  })

  it('electronAPI 缺席时事件订阅退化为 noop 退订', async () => {
    const { factory } = await importFresh()
    for (const k of EVENTS) {
      const unsub = (factory as unknown as Record<string, (cb: unknown) => () => void>)[k](() => {})
      expect(typeof unsub).toBe('function')
      unsub()
    }
  })

  it('electronAPI 缺席时关键默认值形状正确', async () => {
    const { factory } = await importFresh()
    const f = factory as unknown as Record<string, (...a: unknown[]) => unknown>
    await expect(f.state({})).resolves.toMatchObject({ configured: false, config: null })
    await expect(f.clearGithubToken({})).resolves.toEqual({ ok: false })
    await expect(f.runGet({})).resolves.toBeNull()
    await expect(f.backlogList({})).resolves.toEqual([])
  })
})
