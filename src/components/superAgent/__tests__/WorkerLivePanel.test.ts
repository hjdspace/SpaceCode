/**
 * WorkerLivePanel 只读镜像契约（T07 #77）：
 *  - 面板从激活 worker 标签取 ticketId，镜像缺失时幂等挂 workerBind；
 *  - 复用 AgentTimeline 渲染 Worker 稳定会话，readonly 恒为 true，
 *    loading 跟随最新 Assignment 是否执行中；
 *  - 代次分段以时间线上方薄层区块叠加，按 generation 升序（复用不新分段、重试新分段）；
 *  - 只读提示可见：默认只读，不自动接管。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuperAgentWorkerMirror } from '@/shared/channels/superAgent'

const probe = vi.hoisted(() => ({
  projectRoot: 'D:/repo',
  /** 标签打开时打的项目根；与实时 projectRoot 分开，才能测出"跟着实时指针漂移"的回归。 */
  tabRepoRoot: 'D:/repo',
  ticketId: 'ticket-1' as string | null,
  mirror: null as SuperAgentWorkerMirror | null,
  bindWorker: vi.fn().mockResolvedValue(undefined),
  takeoverTicketId: null as string | null,
  takeoverWorker: vi.fn().mockResolvedValue(undefined),
  releaseWorker: vi.fn().mockResolvedValue(true),
  sendWorkerMessage: vi.fn().mockResolvedValue({
    inputId: 'input-1',
    ticketId: 'ticket-1',
    status: 'delivered',
    delivered: true,
    gated: false,
    duplicate: false,
  }),
  messages: [] as unknown[],
}))

vi.mock('vue-i18n', () => ({
  createI18n: vi.fn(),
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (params && typeof params.n === 'number') return `${key}:${params.n}`
    return key
  } }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    get projectRoot() { return probe.projectRoot },
    get activeInfoTab() {
      if (!probe.ticketId) return null
      return {
        id: `worker:${probe.ticketId}`,
        type: 'worker',
        title: '工单',
        icon: null,
        data: { ticketId: probe.ticketId, repoRoot: probe.tabRepoRoot },
        closeable: true,
      }
    },
  }),
  // 与实现同源的收窄辅助：直接复刻 store 侧判别逻辑
  workerTabData: (tab: { type?: string; data?: { ticketId?: string; repoRoot?: string } | null } | null) =>
    tab && tab.type === 'worker' ? (tab.data ?? null) : null,
}))

vi.mock('@/stores/superAgent', () => ({
  useSuperAgentStore: () => ({
    get workerMirrors() {
      return probe.mirror ? { [probe.mirror.ticketId]: probe.mirror } : {}
    },
    get takeoverTicketId() { return probe.takeoverTicketId },
    bindWorker: probe.bindWorker,
    takeoverWorker: probe.takeoverWorker,
    releaseWorker: probe.releaseWorker,
    sendWorkerMessage: probe.sendWorkerMessage,
  }),
}))

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => ({
    getDisplayMessages: () => probe.messages,
  }),
}))

import WorkerLivePanel from '../WorkerLivePanel.vue'
import AgentTimeline from '@/components/chat/AgentTimeline.vue'
import ChatInput from '@/components/chat/ChatInput.vue'

function workerMirror(overrides: Partial<SuperAgentWorkerMirror> = {}): SuperAgentWorkerMirror {
  return {
    repoRoot: 'D:/repo',
    ticketId: 'ticket-1',
    title: '修复登录',
    sessionId: 'superagent-worker-ticket-1',
    running: false,
    ticketState: 'queued',
    takenOver: false,
    segments: [
      {
        assignmentId: 'assignment-1',
        generation: 1,
        state: 'pending',
        endedReason: null,
        createdAt: '2026-01-01T00:00:00Z',
        startedAt: null,
        endedAt: null,
        reportKind: null,
        reportSummary: null,
      },
    ],
    ...overrides,
  }
}

function mountPanel() {
  return mount(WorkerLivePanel, {
    global: {
      // 只替换渲染层，保留组件引用与 props 供断言
      stubs: { AgentTimeline: true, ChatInput: true },
    },
  })
}

beforeEach(() => {
  probe.projectRoot = 'D:/repo'
  probe.tabRepoRoot = 'D:/repo'
  probe.ticketId = 'ticket-1'
  probe.mirror = null
  probe.takeoverTicketId = null
  probe.messages = []
  probe.bindWorker.mockClear()
  probe.bindWorker.mockResolvedValue(undefined)
  probe.takeoverWorker.mockClear()
  probe.releaseWorker.mockClear().mockResolvedValue(true)
  probe.sendWorkerMessage.mockClear()
  probe.sendWorkerMessage.mockResolvedValue({
    inputId: 'input-1',
    ticketId: 'ticket-1',
    status: 'delivered',
    delivered: true,
    gated: false,
    duplicate: false,
  })
})

describe('WorkerLivePanel readonly mirror（T07 #77）', () => {
  it('shows pending acceptance and stops the real timeline loading prop while the ready assignment stays reusable', async () => {
    const segment = workerMirror().segments[0]!
    probe.mirror = workerMirror({
      running: false,
      ticketState: 'review',
      segments: [{ ...segment, state: 'running', reportKind: 'ready', reportSummary: '已完成' }],
    })
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.findComponent(AgentTimeline).props('loading')).toBe(false)
    expect(wrapper.get('[data-testid="worker-state"]').text()).toBe('superAgent.worker.pendingAcceptance')
    expect(wrapper.get('[data-testid="worker-segment-1"]').text()).toContain('superAgent.worker.pendingAcceptance')
    expect(probe.mirror.segments[0]?.state).toBe('running')
    wrapper.unmount()
  })

  it('shows running again for a same-generation follow-up despite the preceding ready report', async () => {
    probe.mirror = workerMirror({
      running: true,
      ticketState: 'working',
      segments: [{ ...workerMirror().segments[0]!, state: 'running', reportKind: 'ready' }],
    })
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.findComponent(AgentTimeline).props('loading')).toBe(true)
    expect(wrapper.get('[data-testid="worker-state"]').text()).toBe('superAgent.worker.running')
    expect(wrapper.get('[data-testid="worker-segment-1"]').text()).toContain('superAgent.worker.states.running')
    wrapper.unmount()
  })

  it('镜像缺失时挂载即幂等挂 workerBind，已有快照则不重复挂', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(probe.bindWorker).toHaveBeenCalledWith('D:/repo', 'ticket-1')

    // 镜像已在 store 中（例如从其他标签切回）时不再重复 IPC
    probe.bindWorker.mockClear()
    probe.mirror = workerMirror()
    const second = mountPanel()
    await flushPromises()
    expect(probe.bindWorker).not.toHaveBeenCalled()
    second.unmount()
    wrapper.unmount()
  })

  it('复用 AgentTimeline 渲染 Worker 稳定会话：readonly 恒 true，loading 跟随执行状态', async () => {
    probe.mirror = workerMirror({ running: true })
    const wrapper = mountPanel()
    await flushPromises()

    const timeline = wrapper.findComponent(AgentTimeline)
    expect(timeline.exists()).toBe(true)
    expect(timeline.props('sessionId')).toBe('superagent-worker-ticket-1')
    expect(timeline.props('readonly')).toBe(true)
    expect(timeline.props('loading')).toBe(true)
    expect(timeline.props('messages')).toEqual([])
    wrapper.unmount()
  })

  it('代次分段作为时间线上方薄层区块，按 generation 升序展示状态与 Report 摘要', async () => {
    probe.mirror = workerMirror({
      running: true,
      segments: [
        {
          assignmentId: 'assignment-1',
          generation: 1,
          state: 'ended',
          endedReason: 'completed',
          createdAt: '2026-01-01T00:00:00Z',
          startedAt: '2026-01-01T00:00:01Z',
          endedAt: '2026-01-01T00:10:00Z',
          reportKind: 'ready',
          reportSummary: '登录按钮已修复，等待复核',
        },
        {
          assignmentId: 'assignment-2',
          generation: 2,
          state: 'running',
          endedReason: null,
          createdAt: '2026-01-01T00:11:00Z',
          startedAt: '2026-01-01T00:11:01Z',
          endedAt: null,
          reportKind: 'progress',
          reportSummary: '正在补充测试',
        },
      ],
    })
    const wrapper = mountPanel()
    await flushPromises()

    const segments = wrapper.findAll('[data-testid^="worker-segment-"]')
    expect(segments).toHaveLength(2)
    // 复用不新分段（gen 1 保持），重试新分段（gen 2 追加），升序渲染
    expect(segments[0].attributes('data-testid')).toBe('worker-segment-1')
    expect(segments[0].text()).toContain('superAgent.worker.generation:1')
    expect(segments[0].text()).toContain('superAgent.worker.states.ended')
    expect(segments[0].text()).toContain('登录按钮已修复，等待复核')
    expect(segments[1].attributes('data-testid')).toBe('worker-segment-2')
    expect(segments[1].text()).toContain('superAgent.worker.states.running')
    wrapper.unmount()
  })

  it('默认只读不自动接管：只读提示可见，且最新分段高亮执行状态', async () => {
    probe.mirror = workerMirror({ running: true })
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('[data-testid="worker-readonly-hint"]').text()).toBe(
      'superAgent.worker.readonlyHint',
    )
    // 任务进度胶囊随输入框一起只在接管后出现
    expect(wrapper.findComponent(ChatInput).exists()).toBe(false)
    const head = wrapper.find('[data-testid="worker-state"]')
    expect(head.text()).toBe('superAgent.worker.running')
    expect(head.classes()).toContain('running')
    wrapper.unmount()
  })

  it('激活标签不是 worker 时保持空态且不做 IPC', async () => {
    probe.ticketId = null
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.findComponent(AgentTimeline).exists()).toBe(false)
    expect(probe.bindWorker).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('WorkerLivePanel takeover & giveback（T09 #79）', () => {
  it('接管入口悬浮在时间线底部，不再占用顶部标题栏', async () => {
    probe.mirror = workerMirror()
    const wrapper = mountPanel()
    await flushPromises()

    const dock = wrapper.get('[data-testid="worker-takeover-dock"]')
    expect(dock.find('[data-testid="worker-takeover-button"]').exists()).toBe(true)
    expect(wrapper.find('.worker-head [data-testid="worker-takeover-button"]').exists()).toBe(false)
    expect(wrapper.get('.worker-timeline').classes()).toContain('with-dock')
    wrapper.unmount()
  })

  it('标签缺少项目根时不渲染接管入口（寻址不全宁可不给按钮）', async () => {
    probe.tabRepoRoot = ''
    probe.mirror = workerMirror()
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('[data-testid="worker-takeover-dock"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('默认只读展示接管按钮：点击走 takeoverWorker(repoRoot, ticketId)，不自动接管', async () => {
    probe.mirror = workerMirror()
    const wrapper = mountPanel()
    await flushPromises()

    const button = wrapper.find('[data-testid="worker-takeover-button"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('superAgent.worker.takeover')
    expect(wrapper.find('[data-testid="worker-takeover-banner"]').exists()).toBe(false)

    await button.trigger('click')
    expect(probe.takeoverWorker).toHaveBeenCalledWith('D:/repo', 'ticket-1')
    wrapper.unmount()
  })

  it('接管后面板态切换：横幅可见、时间线可交互、输入框绑定 Worker 会话', async () => {
    probe.mirror = workerMirror({ running: true })
    probe.takeoverTicketId = 'ticket-1'
    const wrapper = mountPanel()
    await flushPromises()

    // 自动推进已暂停横幅 + 只读提示隐藏
    expect(wrapper.find('[data-testid="worker-takeover-banner"]').text()).toBe(
      'superAgent.worker.takeoverBanner',
    )
    expect(wrapper.find('[data-testid="worker-readonly-hint"]').exists()).toBe(false)

    // 时间线 readonly=false：授权确认等交互可用；交还按钮文案切换
    const timeline = wrapper.findComponent(AgentTimeline)
    expect(timeline.props('readonly')).toBe(false)
    const button = wrapper.find('[data-testid="worker-takeover-button"]')
    expect(button.text()).toBe('superAgent.worker.giveback')

    // 紧凑输入框复用主聊天组件：绑定 Worker 稳定会话（草稿域按 sessionId 隔离）
    const composer = wrapper.findComponent(ChatInput)
    expect(composer.exists()).toBe(true)
    expect(composer.props('sessionId')).toBe('superagent-worker-ticket-1')
    expect(composer.props('compact')).toBe(true)
    // 任务进度胶囊只在接管后出现（默认只读时不渲染 ChatInput）
    expect(composer.props('showStatusBar')).toBe(true)

    await button.trigger('click')
    expect(probe.releaseWorker).toHaveBeenCalledWith('D:/repo', 'ticket-1')
    wrapper.unmount()
  })

  it('接管输入经 sendWorkerMessage 先落库再投递，不直连引擎', async () => {
    probe.mirror = workerMirror()
    probe.takeoverTicketId = 'ticket-1'
    const wrapper = mountPanel()
    await flushPromises()

    wrapper.findComponent(ChatInput).vm.$emit('send', '请改用另一个方案', [])
    await flushPromises()

    expect(probe.sendWorkerMessage).toHaveBeenCalledWith(
      'D:/repo',
      expect.objectContaining({
        ticketId: 'ticket-1',
        text: '请改用另一个方案',
        requestId: expect.any(String),
      }),
    )
    wrapper.unmount()
  })

  it('接管态授权确认/跳过作为领域输入投递：结果不直连引擎', async () => {
    probe.mirror = workerMirror()
    probe.takeoverTicketId = 'ticket-1'
    const wrapper = mountPanel()
    await flushPromises()

    wrapper.findComponent(AgentTimeline).vm.$emit('toolSubmit', 'tool-1', { x: 1 })
    await flushPromises()
    expect(probe.sendWorkerMessage.mock.calls[0][1]).toMatchObject({
      ticketId: 'ticket-1',
      requestId: expect.any(String),
      note: 'permission-answer',
    })
    const allowed = JSON.parse(
      probe.sendWorkerMessage.mock.calls[0][1].text as string,
    ) as Record<string, unknown>
    expect(allowed).toMatchObject({ type: 'permission-answer', toolId: 'tool-1', decision: 'allow' })

    wrapper.findComponent(AgentTimeline).vm.$emit('toolSkip', 'tool-2')
    await flushPromises()
    const denied = JSON.parse(
      probe.sendWorkerMessage.mock.calls[1][1].text as string,
    ) as Record<string, unknown>
    expect(denied).toMatchObject({ type: 'permission-answer', toolId: 'tool-2', decision: 'deny' })
    wrapper.unmount()
  })

  it('交还后回到只读：无横幅、时间线 readonly、输入框卸载', async () => {
    probe.mirror = workerMirror()
    const wrapper = mountPanel()
    await flushPromises()

    // 未接管（接管态被其他面板交还后 store 广播清空）同样成立
    expect(wrapper.find('[data-testid="worker-takeover-banner"]').exists()).toBe(false)
    expect(wrapper.findComponent(AgentTimeline).props('readonly')).toBe(true)
    expect(wrapper.findComponent(ChatInput).exists()).toBe(false)
    wrapper.unmount()
  })

  it('中置页切到别的项目后，旧工单标签仍按标签打开时的项目根寻址', async () => {
    probe.tabRepoRoot = 'D:/repo'
    // 全局项目指针已经漂走：这张工单属于还没切过去的旧项目
    probe.projectRoot = 'D:/other-project'

    const wrapper = mountPanel()
    await flushPromises()

    expect(probe.bindWorker).toHaveBeenCalledWith('D:/repo', 'ticket-1')
    wrapper.unmount()
  })
})
