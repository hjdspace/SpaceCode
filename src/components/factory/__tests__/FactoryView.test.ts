/**
 * 看板装配：从运行头部打开新建运行弹窗，确认后创建运行、关闭弹窗并聚焦队列泳道；
 * 创建失败时保留弹窗并展示可读错误。走真实 store（只 mock IPC），子组件按需打桩。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  FACTORY_BACKLOG_PATH,
  FACTORY_SANDBOX_WORKTREE_ROOT,
  type FactoryBacklogItem,
  type FactoryConfig,
  type FactoryRun,
  type FactoryRunSnapshot,
  type FactorySetupContext,
} from '@/shared/factory'

const { factoryApi } = vi.hoisted(() => ({
  factoryApi: {
    state: vi.fn(),
    context: vi.fn(),
    backlogList: vi.fn(),
    githubIssues: vi.fn(),
    runList: vi.fn(),
    runGet: vi.fn(),
    taskEvents: vi.fn(),
    runCreate: vi.fn(),
    runResume: vi.fn(),
    runPause: vi.fn(),
    runStop: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: { factory: factoryApi } }))

// app store 会拉入完整 i18n 实例；这里只关心看板装配，直接给出项目根。
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ projectRoot: '/repo' }) }))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && Object.keys(params).length > 0 ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryView from '../FactoryView.vue'

const ROOT = '/repo'

function configFixture(): FactoryConfig {
  return {
    version: 1,
    revision: 1,
    repo: { root: '.', baseBranch: 'main' },
    template: 'parallel-planner-with-review',
    agent: { engineType: 'claude-code', model: 'sonnet', maxIterations: 5, maxConcurrency: 4 },
    sandbox: { type: 'worktree', root: FACTORY_SANDBOX_WORKTREE_ROOT },
    tracker: { type: 'local', backlogPath: FACTORY_BACKLOG_PATH, mergeMode: 'local' },
    stages: {
      plan: { enabled: true, permissionMode: 'plan', humanGate: false },
      implement: { enabled: true, permissionMode: 'acceptEdits', humanGate: false },
      verify: { enabled: true, permissionMode: 'default', humanGate: false },
      review: { enabled: true, permissionMode: 'acceptEdits', humanGate: true },
      merge: { enabled: true, permissionMode: 'default', humanGate: true },
    },
    commands: { verify: 'npm run test:changed' },
    prompts: {
      plan: '.spacecode/factory/prompts/plan.md',
      implement: '.spacecode/factory/prompts/implement.md',
      review: '.spacecode/factory/prompts/review.md',
      fix: '.spacecode/factory/prompts/fix.md',
      'merge-conflict': '.spacecode/factory/prompts/merge-conflict.md',
    },
    limits: { taskTimeoutSec: 3600, idleTimeoutSec: 600, keepDoneRuns: 20 },
  }
}

const context: FactorySetupContext = {
  repo: { isGitRepo: true, root: ROOT, baseBranch: 'main', dirty: false, gitVersion: '2.44.0' },
  engines: [],
  modelProfile: { configured: true, model: 'claude-sonnet-4-5' },
  models: { selectable: [] },
  dockerAvailable: false,
  encryptionAvailable: true,
  ghLoggedIn: false,
  existingConfig: configFixture(),
}

const backlog: FactoryBacklogItem[] = [
  { id: 'bl-1', title: '登录态在刷新后丢失', goal: '', createdAt: '2026-10-28T10:00:00Z', order: 0 },
  { id: 'bl-2', title: '合并预检失败', goal: '', createdAt: '2026-10-28T10:01:00Z', order: 1 },
]

function snapshot(id = 'run-1', status: FactoryRunSnapshot['run']['status'] = 'running'): FactoryRunSnapshot {
  return {
    run: {
      id,
      status,
      paused: false,
      createdAt: '2026-10-28T10:02:00Z',
      maxConcurrency: 4,
      spendUsd: 0,
      elapsedMs: 0,
    },
    tasks: [],
  }
}

const focusLane = vi.fn()

/** 看板只暴露 focusLane，用来确认创建成功后会滚到队列泳道。 */
const BoardStub = defineComponent({
  name: 'FactoryBoard',
  props: {
    nowMs: { type: Number, default: 0 },
    run: { type: Object as PropType<FactoryRun | null>, default: null },
  },
  setup(props, { expose }) {
    expose({ focusLane })
    return () =>
      h('div', {
        'data-board-stub': '',
        'data-board-now': String(props.nowMs),
        'data-board-run': props.run?.id ?? '',
      })
  },
})

const HeaderStub = defineComponent({
  name: 'FactoryRunHeader',
  setup(_, { emit }) {
    return () =>
      h('button', { 'data-header-new-run': '', onClick: () => emit('new-run') }, 'new run')
  },
})

const stubs = {
  FactoryRunHeader: HeaderStub,
  FactoryBoard: BoardStub,
  FactoryInspector: true,
  FactoryBacklogPanel: true,
  FactoryGithubPanel: true,
  FactoryMergeDialog: true,
  FactoryConfigModal: true,
  FactorySetupWizard: true,
}

async function mountView() {
  const wrapper = mount(FactoryView, { global: { stubs } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  factoryApi.state.mockResolvedValue({
    configured: true,
    config: configFixture(),
    configPath: '.spacecode/factory/config.json',
  })
  factoryApi.context.mockResolvedValue(context)
  factoryApi.backlogList.mockResolvedValue(backlog)
  factoryApi.taskEvents.mockResolvedValue([])
  factoryApi.runList.mockResolvedValue([snapshot('run-1').run])
  factoryApi.runGet.mockImplementation((_root: string, id: string) =>
    Promise.resolve(snapshot(id)),
  )
  factoryApi.runCreate.mockResolvedValue({ ok: true, snapshot: snapshot('run-2', 'pending') })
  factoryApi.runResume.mockResolvedValue({ ok: true, snapshot: snapshot('run-2', 'running') })
})

describe('FactoryView new run', () => {
  it('creates a run from the header plan and focuses the queue lane', async () => {
    const wrapper = await mountView()

    await wrapper.find('[data-header-new-run]').trigger('click')
    await flushPromises()

    const modal = wrapper.find('[data-new-run-modal]')
    expect(modal.exists()).toBe(true)
    expect(wrapper.find('[data-new-run-verify]').text()).toBe('npm run test:changed')
    expect(wrapper.find('[data-new-run-concurrency]').element).toHaveProperty('value', '4')

    await wrapper.find('[data-new-run-check="bl-1"]').setValue(true)
    await wrapper.find('[data-new-run-concurrency]').setValue('2')
    await wrapper.find('[data-new-run-confirm]').trigger('click')
    await flushPromises()

    expect(factoryApi.runCreate).toHaveBeenCalledWith(ROOT, {
      taskIds: ['bl-1'],
      concurrency: 2,
    })
    expect(wrapper.find('[data-new-run-modal]').exists()).toBe(false)
    // 挂载、打开弹窗、创建成功各刷新一次来源列表。
    expect(factoryApi.backlogList).toHaveBeenCalledTimes(3)
    expect(focusLane).toHaveBeenCalledWith('queued')

    // 新运行直接出现在页签条并成为当前页签，不需要再读一次运行列表。
    const tab = wrapper.find('[data-run-tab="run-2"]')
    expect(tab.exists()).toBe(true)
    expect(tab.attributes('data-run-tab-active')).toBe('true')
  })

  it('keeps the plan open and shows a readable error when creation fails', async () => {
    factoryApi.runCreate.mockResolvedValue({
      ok: false,
      error: 'duplicate-tasks',
      duplicates: ['bl-1'],
    })
    const wrapper = await mountView()

    await wrapper.find('[data-header-new-run]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-new-run-check="bl-1"]').setValue(true)
    await wrapper.find('[data-new-run-confirm]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-new-run-modal]').exists()).toBe(true)
    expect(wrapper.find('[data-new-run-error]').text()).toBe(
      'factory.run.errors.duplicate-tasks|{"ids":"bl-1"}',
    )
    expect(focusLane).not.toHaveBeenCalled()
  })
})

describe('FactoryView run tabs', () => {
  it('renders recent runs and loads the picked run when a tab is clicked', async () => {
    factoryApi.runList.mockResolvedValue([
      snapshot('run-2').run,
      snapshot('run-1', 'stopped').run,
    ])
    const wrapper = await mountView()

    expect(wrapper.findAll('[data-run-tab]')).toHaveLength(2)
    expect(wrapper.find('[data-run-tab="run-2"]').attributes('data-run-tab-active')).toBe('true')

    await wrapper.find('[data-run-tab="run-1"] .tab-main').trigger('click')
    await flushPromises()

    expect(factoryApi.runGet).toHaveBeenLastCalledWith(ROOT, 'run-1')
    expect(wrapper.find('[data-run-tab="run-1"]').attributes('data-run-tab-active')).toBe('true')
  })

  it('returns to the empty board after the last tab closes and keeps the add entry', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-run-tab="run-1"]').exists()).toBe(true)

    await wrapper.find('[data-run-tab-close="run-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-run-tab]')).toHaveLength(0)
    expect(wrapper.find('[data-run-tab-add]').exists()).toBe(true)
    expect(wrapper.find('[data-board-empty]').exists()).toBe(true)
    expect(wrapper.find('[data-header-new-run]').exists()).toBe(false)
  })

  it('opens the new-run plan from the tab strip add entry', async () => {
    const wrapper = await mountView()

    await wrapper.find('[data-run-tab-add]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-new-run-modal]').exists()).toBe(true)
  })

  it('hands the active run to the board so cards follow its state', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('[data-board-run]').attributes('data-board-run')).toBe('run-1')
  })

  it('ticks task timers while the active run is running', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(FactoryView, { global: { stubs } })
      await vi.advanceTimersByTimeAsync(0)

      const before = Number(wrapper.find('[data-board-now]').attributes('data-board-now'))
      await vi.advanceTimersByTimeAsync(1000)
      const after = Number(wrapper.find('[data-board-now]').attributes('data-board-now'))

      expect(after - before).toBe(1000)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
