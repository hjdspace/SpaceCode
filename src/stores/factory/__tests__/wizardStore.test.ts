/**
 * 向导 store 的跨进程边界：送进 IPC 的草稿必须是可结构化克隆的纯对象。
 * 回归的是 “An object could not be cloned” —— 直接传 Vue 的响应式 Proxy 会让
 * 预检永远失败、完成按钮永久禁用。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { FactoryPreflightResult, FactorySetupContext, FactorySetupDraft } from '@/shared/factory'

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
import { buildFactoryConfig } from '@electron/factory/config'

const passingPreflight: FactoryPreflightResult = { items: [], blocking: false }

/** 让响应晚一点落地，用来造出「旧的那条后到」的重叠窗口。 */
function delayed<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms)
  })
}

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

  /**
   * 改一次验证命令就会重跑一次预检，两条 IPC 因此在路上重叠。慢的那条属于旧草稿：
   * 让它后落地也不许覆盖新结果，否则「完成配置」会被一条已经作废的通过顶开。
   */
  it('drops a stale preflight result that lands after a newer one', async () => {
    const blocking: FactoryPreflightResult = { items: [{ id: 'verifyCommand', level: 'error' }], blocking: true }
    factoryApi.preflight
      .mockImplementationOnce(() => delayed(blocking, 40))
      .mockResolvedValueOnce(passingPreflight)
    const store = useFactoryStore()

    const stale = store.runPreflight('/repo')
    await store.runPreflight('/repo')
    expect(store.preflight).toEqual(passingPreflight)
    await stale
    expect(store.preflight).toEqual(passingPreflight)
    expect(store.blocking).toBe(false)
    expect(store.preflightRunning).toBe(false)
  })

  it('keeps a good result when a stale preflight rejects', async () => {
    factoryApi.preflight
      .mockImplementationOnce(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('stale boom')), 40)),
      )
      .mockResolvedValueOnce(passingPreflight)
    const store = useFactoryStore()

    const stale = store.runPreflight('/repo')
    await store.runPreflight('/repo')
    await stale

    expect(store.preflight).toEqual(passingPreflight)
    expect(store.preflightError).toBeNull()
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

/** 一份各步都校验通过的草稿，供步骤导航与会话用例共用。 */
const filledDraft: FactorySetupDraft = {
  agent: { engineType: 'claude-code' },
  sandbox: { type: 'worktree' },
  tracker: { type: 'local', mergeMode: 'local' },
  commands: { verify: 'npm run test:changed' },
}

/** 整页向导的步骤条：跳步由 store 把关，落在第 4 步时补跑一次预检。 */
describe('wizard step navigation', () => {
  it('jumps to a step whose earlier steps all pass and preflights on arrival at step 4', async () => {
    const store = useFactoryStore()
    store.context = setupContext
    store.draft = filledDraft
    store.step = 3

    await store.goToStep(1, '/repo')
    expect(store.step).toBe(1)

    await store.goToStep(4, '/repo')
    expect(store.step).toBe(4)
    expect(factoryApi.preflight).toHaveBeenCalledWith('/repo', filledDraft)
  })

  it('refuses a jump that would cross a step which no longer validates', async () => {
    const store = useFactoryStore()
    store.context = setupContext
    store.draft = { ...filledDraft, agent: {} }
    store.step = 1

    await store.goToStep(3, '/repo')
    expect(store.step).toBe(1)
    expect(factoryApi.preflight).not.toHaveBeenCalled()
  })
})

/**
 * 向导是看板区域里的一个页面：保存后停在就绪页，回看板不丢草稿，
 * 再进入时要么接着上次的草稿，要么回填磁盘上的既有配置。
 */
describe('wizard session', () => {
  it('stays on the wizard showing the ready page after a successful save', async () => {
    const store = useFactoryStore()
    store.context = setupContext
    store.wizardOpen = true
    store.step = 4
    store.draft = filledDraft

    await store.save('/repo')

    expect(store.wizardOpen).toBe(true)
    expect(store.wizardDone).toBe(true)
    expect(factoryApi.state).toHaveBeenCalledWith('/repo')
  })

  it('leaving the wizard for the board keeps the half-filled draft and drops the ready page', () => {
    const store = useFactoryStore()
    store.context = setupContext
    store.wizardOpen = true
    store.wizardDone = true
    store.step = 3
    store.draft = { ...filledDraft, tracker: { type: 'github-issues', mergeMode: 'local', repo: 'a/b', label: 'mine' } }

    store.closeWizard()

    expect(store.wizardOpen).toBe(false)
    expect(store.wizardDone).toBe(false)
    expect(store.step).toBe(3)
    expect(store.draft.tracker).toMatchObject({ type: 'github-issues', repo: 'a/b', label: 'mine' })
  })

  it('keeps the token typed into the wizard across a tab close and drops it after a save', async () => {
    const store = useFactoryStore()
    store.context = setupContext
    store.draft = filledDraft
    store.wizardToken = 'ghp_still-typed'

    store.closeWizard()
    expect(store.wizardToken).toBe('ghp_still-typed')

    await store.save('/repo')
    expect(store.wizardToken).toBe('')
  })

  it('re-entering the wizard resumes the draft that was left behind', async () => {
    const store = useFactoryStore()
    store.draft = {
      ...filledDraft,
      tracker: { type: 'github-issues', mergeMode: 'local', repo: 'mine/keep', label: 'mine' },
    }
    store.step = 2
    store.closeWizard()

    await store.openWizard('/repo')

    expect(store.wizardOpen).toBe(true)
    expect(store.step).toBe(2)
    expect(store.draft.tracker).toMatchObject({ repo: 'mine/keep', label: 'mine' })
  })

  it('re-runs preflight when the session resumes on the preflight step', async () => {
    const store = useFactoryStore()
    store.context = setupContext
    store.draft = filledDraft
    store.step = 4
    store.closeWizard()

    await store.openWizard('/repo')

    expect(store.step).toBe(4)
    expect(store.preflight).toEqual(passingPreflight)
    expect(store.blocking).toBe(false)
  })

  it('backfills a fresh session from the config already on disk instead of an empty draft', async () => {
    const built = buildFactoryConfig(
      {
        agent: { engineType: 'claude-code' },
        sandbox: { type: 'worktree' },
        tracker: {
          type: 'github-issues',
          repo: 'hjdspace/SpaceCode',
          label: 'agent-doing',
          auth: 'gh',
          mergeMode: 'pr',
          commentIssue: true,
          closeIssue: false,
        },
        commands: { verify: 'npm run build' },
      },
      { baseBranch: 'main' },
    )
    if (!built.ok) throw new Error('fixture invalid')
    factoryApi.context.mockResolvedValue({ ...setupContext, existingConfig: built.config })
    const store = useFactoryStore()

    await store.openWizard('/repo')

    expect(store.draft.tracker).toMatchObject({
      type: 'github-issues',
      repo: 'hjdspace/SpaceCode',
      label: 'agent-doing',
      mergeMode: 'pr',
      closeIssue: false,
    })
    expect(store.draft.commands?.verify).toBe('npm run build')
  })
})

/**
 * 配置弹窗的「重新初始化」：向导从第 1 步重走；取消时回到配置弹窗，
 * 未保存的配置编辑还在，而不是把用户丢回看板。
 */
describe('wizard restart from the config modal', () => {
  function diskConfig() {
    const built = buildFactoryConfig(
      {
        agent: { engineType: 'claude-code' },
        sandbox: { type: 'worktree' },
        tracker: { type: 'local', mergeMode: 'local' },
        commands: { verify: 'npm run test:changed' },
      },
      { baseBranch: 'main' },
    )
    if (!built.ok) throw new Error('fixture invalid')
    return built.config
  }

  function seeded(step: 1 | 2 | 3 | 4) {
    const config = diskConfig()
    const store = useFactoryStore()
    store.config = config
    store.context = { ...setupContext, existingConfig: config }
    store.openConfig()
    // 上次向导残留的草稿与步骤不应带进「重新初始化」。
    store.draft = { agent: { engineType: 'pi' } }
    store.step = step
    return store
  }

  it('opens step 1 with a draft backfilled from disk and returns to the config modal on cancel', async () => {
    const store = seeded(4)
    store.updateStage('implement', { maxIterations: 9 })

    await store.restartWizard('/repo')

    expect(store.configOpen).toBe(false)
    expect(store.wizardOpen).toBe(true)
    expect(store.step).toBe(1)
    expect(store.draft.agent?.engineType).toBe('claude-code')
    expect(store.draft.commands?.verify).toBe('npm run test:changed')

    store.cancelWizard()

    expect(store.wizardOpen).toBe(false)
    expect(store.configOpen).toBe(true)
    // 取消返回后，弹窗里没保存的编辑还在。
    expect(store.configDraft?.stages.implement.maxIterations).toBe(9)
  })

  it('leaves the config modal closed once the restarted wizard saves', async () => {
    const store = seeded(2)
    await store.restartWizard('/repo')
    store.draft = filledDraft

    await store.save('/repo')
    expect(store.wizardDone).toBe(true)

    store.closeWizard()
    expect(store.configOpen).toBe(false)
  })

  it('leaves the config modal open when the wizard cannot start', async () => {
    const store = seeded(2)
    store.context = null
    factoryApi.context.mockResolvedValue(null)

    await store.restartWizard('/repo')

    expect(store.wizardOpen).toBe(false)
    expect(store.configOpen).toBe(true)
  })

  it('does not open the config modal for a wizard started from the board', () => {
    const store = useFactoryStore()
    store.context = setupContext
    store.draft = filledDraft
    store.wizardOpen = true

    store.cancelWizard()

    expect(store.wizardOpen).toBe(false)
    expect(store.configOpen).toBe(false)
  })
})
