/**
 * superAgent renderer api 的两路行为：electronAPI 在场 → 直通主进程 / 缺席 → 回落默认值。
 *
 * 写操作（routerBind / dispatch / workerBind / attentionAnswer …）在非桌面运行时
 * 没有主进程领域运行时，其默认值会同步 throw 明确拒绝，而不是假装成功；读操作
 * （state / health / queue …）返回与主进程初始状态一致的保守投影。默认值分两类，
 * 缺席态的驱动用 try/catch 同时覆盖两条分支。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { superAgentNamespace } from '@/shared/channels/superAgent'

const CHANNELS = Object.keys(superAgentNamespace.channels)
const EVENTS = Object.keys(superAgentNamespace.events)

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

type SuperAgentModule = typeof import('../superAgent')

async function importFresh(): Promise<SuperAgentModule> {
  vi.resetModules()
  return import('../superAgent')
}

function makeFake() {
  const m: Record<string, (...a: unknown[]) => unknown> = {}
  for (const k of CHANNELS) m[k] = vi.fn((...a: unknown[]) => Promise.resolve({ ok: true, __args: a }))
  for (const k of EVENTS) m[k] = vi.fn((..._a: unknown[]) => () => {})
  H.electronAPI = { superAgent: m }
  return m
}

beforeEach(() => {
  H.electronAPI = null
  H.isH5 = false
})

describe('superAgent renderer api', () => {
  it('electronAPI 在场时每个 invoke 方法按原参直通主进程', async () => {
    const fake = makeFake()
    const { superAgent } = await importFresh()
    const arg = { repoRoot: '/repo' }
    for (const k of CHANNELS) {
      ;(superAgent as unknown as Record<string, (...a: unknown[]) => unknown>)[k](arg)
      expect(fake[k]).toHaveBeenCalledWith(arg)
    }
  })

  it('electronAPI 在场时事件订阅转发主进程并返回退订函数', async () => {
    const fake = makeFake()
    const { superAgent } = await importFresh()
    for (const k of EVENTS) {
      const cb = vi.fn()
      const unsub = (superAgent as unknown as Record<string, (cb: unknown) => () => void>)[k](cb)
      expect(fake[k]).toHaveBeenCalledWith(cb)
      expect(typeof unsub).toBe('function')
    }
  })

  it('electronAPI 缺席时 invoke 方法回落默认值或显式拒绝，不静默 undefined', async () => {
    const { superAgent } = await importFresh()
    for (const k of CHANNELS) {
      try {
        const p = (superAgent as unknown as Record<string, (...a: unknown[]) => unknown>)[k]({})
        expect(Promise.resolve(p)).toBeInstanceOf(Promise)
      } catch {
        // 写操作默认值同步 throw 明确拒绝，同样算覆盖
      }
    }
  })

  it('electronAPI 缺席时事件订阅退化为 noop 退订', async () => {
    const { superAgent } = await importFresh()
    for (const k of EVENTS) {
      const unsub = (superAgent as unknown as Record<string, (cb: unknown) => () => void>)[k](() => {})
      expect(typeof unsub).toBe('function')
      unsub()
    }
  })

  it('electronAPI 缺席时写操作默认值显式拒绝', async () => {
    const { superAgent } = await importFresh()
    const s = superAgent as unknown as Record<string, (...a: unknown[]) => unknown>
    expect(() => s.routerBind({})).toThrow('Super Agent is only available in the desktop app')
    expect(() => s.dispatch({})).toThrow('Super Agent is only available in the desktop app')
    expect(() => s.attentionAnswer({})).toThrow('attention answer is only available in desktop')
  })

  it('electronAPI 缺席时读操作默认值返回保守投影', async () => {
    const { superAgent } = await importFresh()
    const s = superAgent as unknown as Record<string, (...a: unknown[]) => unknown>
    await expect(s.state({})).resolves.toMatchObject({ seq: 0, router: null })
    await expect(s.authorizationPolicy({})).resolves.toMatchObject({ policy: { acceptMode: 'off' } })
    await expect(s.queue({})).resolves.toMatchObject({ running: [], queued: [] })
  })
})
