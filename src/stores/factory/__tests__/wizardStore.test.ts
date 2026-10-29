/**
 * 向导 store 的跨进程边界：送进 IPC 的草稿必须是可结构化克隆的纯对象。
 * 回归的是 “An object could not be cloned” —— 直接传 Vue 的响应式 Proxy 会让
 * 预检永远失败、完成按钮永久禁用。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { FactoryPreflightResult, FactorySetupContext } from '@/shared/factory'

const { factoryApi } = vi.hoisted(() => ({
  factoryApi: {
    preflight: vi.fn(),
    save: vi.fn(),
    context: vi.fn(),
    state: vi.fn(),
    githubRepos: vi.fn(),
    checkGhAuth: vi.fn(),
    startGhLogin: vi.fn(),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: { factory: factoryApi } }))

import { useFactoryStore } from '../index'

const passingPreflight: FactoryPreflightResult = { items: [], blocking: false }

const setupContext: FactorySetupContext = {
  repo: { isGitRepo: true, root: '/repo', baseBranch: 'main', dirty: false, gitVersion: '2.44.0' },
  engines: [{ engineType: 'claude-code', available: true, reason: 'ok', version: null, exposed: true }],
  modelProfile: { configured: true, model: 'claude-sonnet-4-5' },
  models: { selectable: ['claude-sonnet-4-5'], default: 'claude-sonnet-4-5' },
  dockerAvailable: false,
  encryptionAvailable: true,
  ghLoggedIn: false,
  existingConfig: null,
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  factoryApi.preflight.mockResolvedValue(passingPreflight)
  factoryApi.save.mockResolvedValue({ ok: true })
  factoryApi.context.mockResolvedValue(setupContext)
  factoryApi.githubRepos.mockResolvedValue({ ok: true, repos: [] })
  factoryApi.checkGhAuth.mockResolvedValue({ ok: false, reason: 'gh-not-logged-in' })
  factoryApi.startGhLogin.mockResolvedValue({ ok: true, reason: 'ok', code: 'ABCD-1234', url: 'https://github.com/login/device' })
  factoryApi.state.mockResolvedValue({ configured: false, config: null, configPath: '' })
})

describe('wizard store IPC boundary', () => {
  it('sends a structured-cloneable draft to preflight and save', async () => {
    const store = useFactoryStore()
    store.draft = {
      agent: { engineType: 'claude-code' },
      stages: { plan: { model: 'opus' } },
      sandbox: { type: 'worktree' },
      tracker: { type: 'local', mergeMode: 'local' },
      commands: { verify: 'npm run test:changed' },
    }

    await store.runPreflight('/repo')
    await store.save('/repo')

    const preflightDraft = factoryApi.preflight.mock.calls[0][1]
    const savedDraft = factoryApi.save.mock.calls[0][1]
    expect(() => structuredClone(preflightDraft)).not.toThrow()
    expect(() => structuredClone(savedDraft)).not.toThrow()
    expect(preflightDraft).toEqual({
      agent: { engineType: 'claude-code' },
      stages: { plan: { model: 'opus' } },
      sandbox: { type: 'worktree' },
      tracker: { type: 'local', mergeMode: 'local' },
      commands: { verify: 'npm run test:changed' },
    })
  })

  it('unblocks finish after preflight returns', async () => {
    const store = useFactoryStore()
    await store.runPreflight('/repo')
    expect(store.preflight).toEqual(passingPreflight)
    expect(store.blocking).toBe(false)
    expect(store.preflightError).toBeNull()
  })

  it('records preflight failures instead of leaving the wizard stuck', async () => {
    factoryApi.preflight.mockRejectedValue(new Error('boom'))
    const store = useFactoryStore()
    await store.runPreflight('/repo')
    expect(store.preflight).toBeNull()
    expect(store.preflightError).toContain('boom')
    expect(store.preflightRunning).toBe(false)
  })

  it('exposes gh login state and stops polling once auth succeeds', async () => {
    vi.useFakeTimers()
    try {
      const store = useFactoryStore()
      store.context = setupContext
      factoryApi.checkGhAuth.mockResolvedValue({ ok: true, reason: 'ok', login: 'hjdspace' })

      await store.startGhLogin()
      expect(store.ghLogin).toMatchObject({ running: true, code: 'ABCD-1234' })

      await vi.advanceTimersByTimeAsync(3000)
      expect(store.ghLogin.running).toBe(false)
      expect(store.context?.ghLoggedIn).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
