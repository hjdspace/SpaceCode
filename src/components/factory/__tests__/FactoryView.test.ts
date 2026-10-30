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
  type FactoryTask,
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
    taskCancel: vi.fn(),
    taskTakeover: vi.fn(),
    taskReturn: vi.fn(),
    mergePreflight: vi.fn(),
    runCreate: vi.fn(),
    runResume: vi.fn(),
    runPause: vi.fn(),
    runStop: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: { factory: factoryApi } }))

// 接管面板把聊天链路交给 ChatPanel；它拉入整套应用级依赖，这里按 NodeDrawer 的先例打桩。
vi.mock('@/components/layout/ChatPanel.vue', () => ({
  default: {
    name: 'ChatPanel',
    props: { sessionId: String, compact: Boolean },
    setup: () => () => [],
  },
}))

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

function snapshot(
  id = 'run-1',
  status: FactoryRunSnapshot['run']['status'] = 'running',
  tasks: FactoryTask[] = [],
): FactoryRunSnapshot {
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
    tasks,
  }
}

/** 实现中/已接管的看板任务：接管面板要能从任务上读到会话 id。 */
function boardTask(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'bl-1',
    runId: 'run-1',
    source: 'local',
    title: '登录态在刷新后丢失',
    goal: '修复恢复顺序',
    lane: 'implementing',
    stageIdx: 2,
    branch: 'agent/task-bl-1',
    worktree: '.spacecode/worktrees/bl-1',
    model: 'sonnet',
    iteration: 2,
    maxIterations: 5,
    diff: { additions: 0, deletions: 0 },
    timestamps: {},
    ...overrides,
  }
}

const focusLane = vi.fn()

/** 接管面板只报它收到的东西：真实聊天链路在 FactoryTakeoverPanel 自己的用例里验证。 */
const TakeoverPanelStub = defineComponent({
  name: 'FactoryTakeoverPanel',
  props: {
    task: { type: Object as PropType<FactoryTask>, required: true },
    returning: { type: Boolean, default: false },
    verifyFailed: { type: Boolean, default: false },
  },
  emits: ['close', 'return'],
  setup(props, { emit }) {
    return () =>
      h(
        'div',
        {
          'data-takeover-panel-stub': '',
          'data-panel-task': props.task.id,
          'data-panel-session': props.task.takeover?.sessionId ?? '',
          'data-panel-returning': String(props.returning),
          'data-panel-verify-failed': String(props.verifyFailed),
        },
        [
          h('button', { 'data-panel-close': '', onClick: () => emit('close') }),
          h('button', { 'data-panel-return': '', onClick: () => emit('return') }),
        ],
      )
  },
})

/** 看板只暴露 focusLane，并用 select/action 模拟点卡片；检查器只报收起/展开。 */
const BoardStub = defineComponent({
  name: 'FactoryBoard',
  props: {
    nowMs: { type: Number, default: 0 },
    run: { type: Object as PropType<FactoryRun | null>, default: null },
    selectedId: { type: String, default: null },
    readonly: { type: Boolean, default: false },
    busy: { type: String, default: null },
  },
  emits: ['select', 'action'],
  setup(props, { expose, emit }) {
    expose({ focusLane })
    return () =>
      h(
        'div',
        {
          'data-board-stub': '',
          'data-board-now': String(props.nowMs),
          'data-board-run': props.run?.id ?? '',
          'data-board-selected': props.selectedId ?? '',
          'data-board-readonly': String(props.readonly),
          'data-board-busy': props.busy ?? '',
        },
        [
          h('button', {
            'data-board-select': '',
            onClick: () => emit('select', 'bl-1'),
          }),
          h('button', {
            'data-board-cancel': '',
            onClick: () => emit('action', 'bl-1', 'cancel'),
          }),
          h('button', {
            'data-board-review': '',
            onClick: () => emit('action', 'bl-2', 'review'),
          }),
          h('button', {
            'data-board-takeover': '',
            onClick: () => emit('action', 'bl-1', 'takeover'),
          }),
          h('button', {
            'data-board-takeover-panel': '',
            onClick: () => emit('action', 'bl-1', 'takeover-panel'),
          }),
        ],
      )
  },
})

const InspectorStub = defineComponent({
  name: 'FactoryInspector',
  props: {
    run: { type: Object as PropType<FactoryRun | null>, default: null },
  },
  emits: ['close', 'open-takeover'],
  setup(props, { emit }) {
    return () =>
      h(
        'div',
        { 'data-inspector-stub': '', 'data-inspector-run': props.run?.id ?? '' },
        [
          h('button', { 'data-inspector-close': '', onClick: () => emit('close') }),
          h('button', { 'data-inspector-open-takeover': '', onClick: () => emit('open-takeover') }),
        ],
      )
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
  FactoryInspector: InspectorStub,
  FactoryTakeoverPanel: TakeoverPanelStub,
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

describe('FactoryView card quick actions', () => {
  it('abandons through the same store action the inspector footer uses', async () => {
    factoryApi.taskCancel.mockResolvedValue({ ok: true, snapshot: snapshot('run-1') })
    const wrapper = await mountView()

    await wrapper.find('[data-board-cancel]').trigger('click')
    await flushPromises()

    expect(factoryApi.taskCancel).toHaveBeenCalledWith(ROOT, 'run-1', 'bl-1')
    // 成功不改动选中：卡片动作的意义就是不必先选中任务。
    expect(wrapper.find('[data-board-selected]').attributes('data-board-selected')).toBe('')
  })

  it('focuses the task when the action is refused so one surface explains why', async () => {
    factoryApi.taskCancel.mockResolvedValue({ ok: false, error: 'not-cancellable' })
    const wrapper = await mountView()

    await wrapper.find('[data-board-cancel]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-board-selected]').attributes('data-board-selected')).toBe('bl-1')
  })

  it('opens the inspector on the review tab for a reviewing card', async () => {
    const wrapper = await mountView()

    await wrapper.find('[data-board-review]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-board-selected]').attributes('data-board-selected')).toBe('bl-2')
  })

  it('hands the storage lock down to the board so cards disable their actions', async () => {
    factoryApi.state.mockResolvedValue({
      configured: true,
      config: configFixture(),
      configPath: '.spacecode/factory/config.json',
      storage: { writable: false, corrupt: [] },
    })
    const wrapper = await mountView()

    expect(wrapper.find('[data-board-readonly]').attributes('data-board-readonly')).toBe('true')
  })
})

describe('FactoryView takeover panel', () => {
  const takeoverTask = () =>
    boardTask({ takeover: { at: '2026-10-28T10:05:00Z', sessionId: 'fac-run-1-bl-1-takeover' } })

  it('接管成功后在看板内打开该任务的接管面板', async () => {
    factoryApi.taskTakeover.mockResolvedValue({
      ok: true,
      snapshot: snapshot('run-1', 'running', [takeoverTask()]),
      session: { sessionId: 'fac-run-1-bl-1-takeover' },
    })
    const wrapper = await mountView()

    await wrapper.find('[data-board-takeover]').trigger('click')
    await flushPromises()

    const panel = wrapper.find('[data-takeover-panel-stub]')
    expect(panel.exists()).toBe(true)
    expect(panel.attributes('data-panel-task')).toBe('bl-1')
    expect(panel.attributes('data-panel-session')).toBe('fac-run-1-bl-1-takeover')
  })

  it('关闭面板不交回：任务仍是接管中，角标能重新打开', async () => {
    factoryApi.taskTakeover.mockResolvedValue({
      ok: true,
      snapshot: snapshot('run-1', 'running', [takeoverTask()]),
      session: { sessionId: 'fac-run-1-bl-1-takeover' },
    })
    const wrapper = await mountView()

    await wrapper.find('[data-board-takeover]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-panel-close]').trigger('click')

    expect(wrapper.find('[data-takeover-panel-stub]').exists()).toBe(false)
    expect(factoryApi.taskReturn).not.toHaveBeenCalled()

    await wrapper.find('[data-board-takeover-panel]').trigger('click')

    expect(wrapper.find('[data-takeover-panel-stub]').attributes('data-panel-session')).toBe(
      'fac-run-1-bl-1-takeover',
    )
    // 重新打开只读看板状态，不再跑一次接管动作。
    expect(factoryApi.taskTakeover).toHaveBeenCalledTimes(1)
  })

  it('检查器里的接管入口重新打开同一个面板', async () => {
    factoryApi.runGet.mockImplementation((_root: string, id: string) =>
      Promise.resolve(snapshot(id, 'running', [takeoverTask()])),
    )
    const wrapper = await mountView()

    await wrapper.find('[data-inspector-open-takeover]').trigger('click')

    expect(wrapper.find('[data-takeover-panel-stub]').attributes('data-panel-task')).toBe('bl-1')
  })

  it('交回验证通过后面板收起并恢复流水线', async () => {
    factoryApi.runGet.mockImplementation((_root: string, id: string) =>
      Promise.resolve(snapshot(id, 'running', [takeoverTask()])),
    )
    factoryApi.taskReturn.mockResolvedValue({
      ok: true,
      snapshot: snapshot('run-1', 'running', [boardTask({ lane: 'reviewing', stageIdx: 4 })]),
      verified: true,
    })
    const wrapper = await mountView()
    await wrapper.find('[data-inspector-open-takeover]').trigger('click')

    await wrapper.find('[data-panel-return]').trigger('click')
    await flushPromises()

    expect(factoryApi.taskReturn).toHaveBeenCalledWith(ROOT, 'run-1', 'bl-1')
    expect(wrapper.find('[data-takeover-panel-stub]').exists()).toBe(false)
  })

  it('交回验证没过时面板留在原地并说明原因', async () => {
    factoryApi.runGet.mockImplementation((_root: string, id: string) =>
      Promise.resolve(snapshot(id, 'running', [takeoverTask()])),
    )
    factoryApi.taskReturn.mockResolvedValue({
      ok: true,
      snapshot: snapshot('run-1', 'running', [takeoverTask()]),
      verified: false,
    })
    const wrapper = await mountView()
    await wrapper.find('[data-inspector-open-takeover]').trigger('click')

    await wrapper.find('[data-panel-return]').trigger('click')
    await flushPromises()

    const panel = wrapper.find('[data-takeover-panel-stub]')
    expect(panel.exists()).toBe(true)
    expect(panel.attributes('data-panel-verify-failed')).toBe('true')
  })
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

describe('FactoryView inspector column', () => {
  it('hands the inspector the run its live agent row reads', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-inspector-stub]').attributes('data-inspector-run')).toBe('run-1')
  })

  it('gives the board the full width once the inspector collapses', async () => {
    const wrapper = await mountView()
    const columns = wrapper.find('[data-factory-columns]')

    expect(wrapper.find('[data-inspector-stub]').exists()).toBe(true)
    expect(columns.attributes('data-inspector-collapsed')).toBeUndefined()

    await wrapper.find('[data-inspector-close]').trigger('click')
    expect(wrapper.find('[data-inspector-stub]').exists()).toBe(false)
    expect(columns.attributes('data-inspector-collapsed')).toBe('true')

    await wrapper.find('[data-board-select]').trigger('click')
    expect(wrapper.find('[data-inspector-stub]').exists()).toBe(true)
    expect(columns.attributes('data-inspector-collapsed')).toBeUndefined()
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
