/**
 * SuperAgentView Router 对话接线契约（T04 #74）：
 *  - 复用主聊天 Composer/MessageList：session-id 绑定 Router 会话（草稿域随之隔离）、
 *    场景化 placeholder、宿主裁剪（隐藏 work 画廊入口与 UI 绑定命令）；
 *  - 发送走共享 buildOutgoingMessage：@"引用 marker 与主聊天逐字一致；
 *  - 中止/typing 只按 routerSessionId 寻址，不触碰其它会话（Worker）；
 *  - 斜杠命令的本地子集在 Router 会话内落消息，全局命令与主聊天同源；
 *  - 无项目根时保持 T01 的空态且不做 IPC；
 *  - 健康上报（T13 #83）：bind 后拉取并订阅健康报告，顶部入口只显示汇总计数，
 *    点击只开关只读面板（无任何处置按钮）；
 *  - 显式派工（T05 #75）：「新建工单」独立动作（普通发送不建单）、
 *    表单校验与幂等 requestId、派工结果提示、队列现状（执行中/排队/脏区）可见；
 *  - Worker 只读标签（T07 #77）：点击队列条目打开 worker:<ticketId> 只读标签。
 *  - review 出口与超时提醒（T10 #80）：提醒气泡复用原气泡（key=ticketId）、
 *    点击打开只读标签；卡片三出口/重试经 store 委托主进程，失败给出非模态提示。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SuperAgentAttentionView,
  SuperAgentDispatchResult,
  SuperAgentHealthItem,
  SuperAgentQueueSnapshot,
  SuperAgentTicketBoard,
} from '@/shared/channels/superAgent'

const probe = vi.hoisted(() => ({
  bind: vi.fn().mockResolvedValue(undefined),
  loadState: vi.fn().mockResolvedValue(undefined),
  projectRoot: 'D:/repo',
  routerSessionId: 'router-1' as string | null,
  sendMessage: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  getIsLoading: vi.fn(() => false),
  addMessage: vi.fn().mockResolvedValue(undefined),
  getDisplayMessages: vi.fn(() => []),
  getSessionMessages: vi.fn(() => []),
  getSession: vi.fn(() => null),
  switchAgent: vi.fn().mockResolvedValue(undefined),
  openTerminalTab: vi.fn(),
  openWorkerTab: vi.fn(),
  updateAppearance: vi.fn(),
  // ── 健康上报（T13）──
  loadHealth: vi.fn().mockResolvedValue(undefined),
  watchHealth: vi.fn().mockReturnValue(() => {}),
  toggleHealthPanel: vi.fn(),
  healthPanelOpen: false,
  healthProblemCount: 0,
  healthProblems: [] as SuperAgentHealthItem[],
  // ── 显式派工与队列（T05）──
  dispatch: vi.fn().mockResolvedValue({
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    decisionId: 'decision-1',
    mandateId: 'mandate-1',
    queuePosition: 1,
    duplicate: false,
  } as SuperAgentDispatchResult),
  loadQueue: vi.fn().mockResolvedValue(undefined),
  watchQueue: vi.fn().mockReturnValue(() => {}),
  queue: null as SuperAgentQueueSnapshot | null,
  // ── Attention 气泡（T08 #78，并发会话维护）：仅补桩保证挂载流程可跑 ──
  loadAttentions: vi.fn().mockResolvedValue(undefined),
  watchAttentions: vi.fn().mockReturnValue(() => {}),
  attentionBubbles: [] as SuperAgentAttentionView[],
  attentionCount: 0,
  // ── 工单看板（T06 #76，并发会话维护）：仅补桩保证挂载流程可跑 ──
  loadTickets: vi.fn().mockResolvedValue(undefined),
  watchTickets: vi.fn().mockReturnValue(() => {}),
  ticketBoard: null as SuperAgentTicketBoard | null,
  ticketProgress: {} as Record<string, never>,
  // ── review 出口与超时提醒（T10 #80）──
  acceptTicket: vi.fn().mockResolvedValue({
    repoRoot: 'D:/repo',
    ticketId: 'ticket-1',
    outcome: 'completed',
    endedAt: '2026-01-02T00:00:00.000Z',
  }),
  stopTicket: vi.fn().mockResolvedValue({
    repoRoot: 'D:/repo',
    ticketId: 'ticket-1',
    outcome: 'stopped',
    endedAt: '2026-01-02T00:00:00.000Z',
  }),
  messageTicket: vi.fn().mockResolvedValue({
    inputId: 'input-1',
    ticketId: 'ticket-1',
    status: 'delivered',
    delivered: true,
    gated: false,
    duplicate: false,
  }),
  retryTicket: vi.fn().mockResolvedValue({
    ticketId: 'ticket-1',
    assignmentId: 'assignment-2',
    generation: 2,
    queuePosition: 1,
  }),
  reviewReminders: [] as Array<{ ticketId: string; title: string; remindedAt: string }>,
  reviewRemindedCount: 0,
}))

vi.mock('vue-i18n', () => ({
  createI18n: vi.fn(),
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    get projectRoot() { return probe.projectRoot },
    openTerminalTab: probe.openTerminalTab,
    openWorkerTab: probe.openWorkerTab,
  }),
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    lastSelectedModel: 'sonnet',
    config: { model: 'sonnet' },
    appearance: { theme: 'light' },
    updateAppearance: probe.updateAppearance,
    saveSettings: vi.fn(),
  }),
}))

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => ({
    getDisplayMessages: probe.getDisplayMessages,
    getSessionMessages: probe.getSessionMessages,
    getSession: probe.getSession,
    getWorkingDirectory: () => 'D:/repo',
    addMessage: probe.addMessage,
    switchAgent: probe.switchAgent,
  }),
}))

vi.mock('@/stores/turn', () => ({
  useTurnStore: () => ({
    sendMessage: probe.sendMessage,
    abort: probe.abort,
    getIsLoading: probe.getIsLoading,
    hasPendingPermissionForToolUse: () => false,
    allowPermission: vi.fn(),
    denyPermission: vi.fn(),
    submitToolAnswer: vi.fn(),
    skipToolAnswer: vi.fn(),
  }),
}))

vi.mock('@/stores/superAgent', () => ({
  useSuperAgentStore: () => ({
    bind: probe.bind,
    loadState: probe.loadState,
    get boundSessionId() { return probe.routerSessionId },
    loadHealth: probe.loadHealth,
    watchHealth: probe.watchHealth,
    toggleHealthPanel: probe.toggleHealthPanel,
    get healthPanelOpen() { return probe.healthPanelOpen },
    get healthProblemCount() { return probe.healthProblemCount },
    get healthProblems() { return probe.healthProblems },
    dispatch: probe.dispatch,
    loadQueue: probe.loadQueue,
    watchQueue: probe.watchQueue,
    get queue() { return probe.queue },
    loadTickets: probe.loadTickets,
    watchTickets: probe.watchTickets,
    get ticketBoard() { return probe.ticketBoard },
    get ticketProgress() { return probe.ticketProgress },
    acceptTicket: probe.acceptTicket,
    stopTicket: probe.stopTicket,
    messageTicket: probe.messageTicket,
    retryTicket: probe.retryTicket,
    get reviewReminders() { return probe.reviewReminders },
    get reviewRemindedCount() { return probe.reviewRemindedCount },
    loadAttentions: probe.loadAttentions,
    watchAttentions: probe.watchAttentions,
    get attentionBubbles() { return probe.attentionBubbles },
    get attentionCount() { return probe.attentionCount },
  }),
}))

import SuperAgentView from '../SuperAgentView.vue'
import ChatInput from '../../chat/ChatInput.vue'
import MessageList from '../../chat/MessageList.vue'
import WorkerTaskCard from '../WorkerTaskCard.vue'

function mountView() {
  return mount(SuperAgentView, {
    global: {
      // 只替换渲染层，保留组件引用与 props 供断言
      stubs: { ChatInput: true, MessageList: true },
    },
  })
}

beforeEach(() => {
  probe.bind.mockClear()
  probe.loadState.mockClear()
  probe.openWorkerTab.mockClear()
  probe.sendMessage.mockClear()
  probe.abort.mockClear()
  probe.addMessage.mockClear()
  probe.getIsLoading.mockReturnValue(false)
  probe.projectRoot = 'D:/repo'
  probe.routerSessionId = 'router-1'
  probe.loadHealth.mockClear()
  probe.watchHealth.mockClear()
  probe.toggleHealthPanel.mockClear()
  probe.healthPanelOpen = false
  probe.healthProblemCount = 0
  probe.healthProblems = []
  probe.dispatch.mockClear()
  probe.dispatch.mockResolvedValue({
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    decisionId: 'decision-1',
    mandateId: 'mandate-1',
    queuePosition: 1,
    duplicate: false,
  } as SuperAgentDispatchResult)
  probe.loadQueue.mockClear()
  probe.watchQueue.mockClear()
  probe.queue = null
  probe.loadTickets.mockClear()
  probe.watchTickets.mockClear()
  probe.ticketBoard = null
  probe.acceptTicket.mockClear()
  probe.acceptTicket.mockResolvedValue({
    repoRoot: 'D:/repo',
    ticketId: 'ticket-1',
    outcome: 'completed',
    endedAt: '2026-01-02T00:00:00.000Z',
  })
  probe.stopTicket.mockClear()
  probe.stopTicket.mockResolvedValue({
    repoRoot: 'D:/repo',
    ticketId: 'ticket-1',
    outcome: 'stopped',
    endedAt: '2026-01-02T00:00:00.000Z',
  })
  probe.messageTicket.mockClear()
  probe.messageTicket.mockResolvedValue({
    inputId: 'input-1',
    ticketId: 'ticket-1',
    status: 'delivered',
    delivered: true,
    gated: false,
    duplicate: false,
  })
  probe.retryTicket.mockClear()
  probe.retryTicket.mockResolvedValue({
    ticketId: 'ticket-1',
    assignmentId: 'assignment-2',
    generation: 2,
    queuePosition: 1,
  })
  probe.reviewReminders = []
  probe.reviewRemindedCount = 0
})

describe('SuperAgentView empty state', () => {
  it('无项目根时保持空态且不做 IPC', async () => {
    probe.projectRoot = ''
    probe.routerSessionId = null
    const wrapper = mountView()

    expect(wrapper.text()).toContain('superAgent.emptyTitle')
    await flushPromises()
    expect(probe.bind).not.toHaveBeenCalled()
    expect(probe.loadState).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('SuperAgentView router conversation wiring', () => {
  it('Composer 与时间线都绑定 Router 会话，草稿域与普通会话天然隔离', async () => {
    const wrapper = mountView()
    await flushPromises()

    const composer = wrapper.findComponent(ChatInput)
    const timeline = wrapper.findComponent(MessageList)

    expect(composer.props('sessionId')).toBe('router-1')
    expect(timeline.props('sessionId')).toBe('router-1')
    // 场景化 placeholder 走 i18n
    expect(composer.props('placeholder')).toBe('superAgent.composerPlaceholder')
    wrapper.unmount()
  })

  it('宿主裁剪：隐藏 work 画廊入口与依赖主聊天 UI 的斜杠命令', async () => {
    const wrapper = mountView()
    await flushPromises()

    const composer = wrapper.findComponent(ChatInput)
    expect(composer.props('showWorkGalleryAction')).toBe(false)
    expect(composer.props('excludedCommands')).toEqual(['context', 'diff', 'rewind', 'checkpoint'])
    wrapper.unmount()
  })

  it('发送走共享正文组装：@"引用 marker 与主聊天逐字一致，且按 Router 会话寻址', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findComponent(ChatInput).vm.$emit('send', '看下这个', {
      files: [{ path: 'D:/repo/a.png', name: 'a.png', isFolder: false, source: 'upload' }],
      images: [],
    })

    expect(probe.sendMessage).toHaveBeenCalledTimes(1)
    const [messageContent, , , options] = probe.sendMessage.mock.calls[0]
    expect(messageContent.startsWith('@"D:/repo/a.png"')).toBe(true)
    expect(messageContent).toContain('看下这个')
    expect(options).toEqual({ sessionId: 'router-1' })
    wrapper.unmount()
  })

  it('中止只作用于 Router turn，不触碰其它会话', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findComponent(ChatInput).vm.$emit('stop')

    expect(probe.abort).toHaveBeenCalledTimes(1)
    expect(probe.abort).toHaveBeenCalledWith('router-1')
    wrapper.unmount()
  })

  it('Router turn 进行中：typing（MessageList loading）与 Composer 停止按钮同源驱动', async () => {
    probe.getIsLoading.mockReturnValue(true)
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findComponent(MessageList).props('loading')).toBe(true)
    const composer = wrapper.findComponent(ChatInput)
    expect(composer.props('isSending')).toBe(true)
    expect(composer.props('disabled')).toBe(true)
    wrapper.unmount()
  })

  it('斜杠命令在 Router 会话内落消息：clear 中止 Router 并清空，UI 绑定命令给出宿主提示', async () => {
    const wrapper = mountView()
    await flushPromises()
    probe.addMessage.mockClear()

    await wrapper.findComponent(ChatInput).vm.$emit('slash-command', 'clear', '', { files: [], images: [] })
    await flushPromises()

    // 用户命令气泡与 assistant 回复都写进 Router 会话
    expect(probe.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: '/clear' }),
      'router-1',
    )
    expect(probe.abort).toHaveBeenCalledWith('router-1')
    expect(probe.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'chatPanel.commandCleared' }),
      'router-1',
    )

    // rewind 依赖主聊天本地 UI：给出宿主提示而不是静默
    probe.addMessage.mockClear()
    await wrapper.findComponent(ChatInput).vm.$emit('slash-command', 'rewind', '', { files: [], images: [] })
    await flushPromises()
    expect(probe.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'superAgent.commandNotAvailableHere' }),
      'router-1',
    )
    wrapper.unmount()
  })

  it('sdk 命令透传给 Router 引擎（能力不裁剪）', async () => {
    const wrapper = mountView()
    await flushPromises()
    probe.sendMessage.mockClear()

    await wrapper.findComponent(ChatInput).vm.$emit('slash-command', 'compact', '', { files: [], images: [] })
    await flushPromises()

    expect(probe.sendMessage).toHaveBeenCalledWith('/compact', '/compact', { files: [], images: [] }, { sessionId: 'router-1' })
    wrapper.unmount()
  })
})

describe('SuperAgentView health entry（T13 #83）', () => {
  it('bind 后拉取健康报告并订阅 health.changed，卸载时退订', async () => {
    const unsubscribe = vi.fn()
    probe.watchHealth.mockReturnValue(unsubscribe)
    const wrapper = mountView()
    await flushPromises()

    expect(probe.loadHealth).toHaveBeenCalledWith('D:/repo')
    expect(probe.watchHealth).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('无项目根时不做健康 IPC', async () => {
    probe.projectRoot = ''
    probe.routerSessionId = null
    const wrapper = mountView()
    await flushPromises()

    expect(probe.loadHealth).not.toHaveBeenCalled()
    expect(probe.watchHealth).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('系统健康时：入口无徽章、面板默认收起', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="super-agent-health-entry"]').exists()).toBe(true)
    expect(wrapper.find('.count').exists()).toBe(false)
    expect(wrapper.find('[data-testid="super-agent-health"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('顶部入口只显示汇总计数徽章', async () => {
    probe.healthProblemCount = 2
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.count').text()).toBe('2')
    wrapper.unmount()
  })

  it('点击入口只开关只读面板：面板内无任何按钮', async () => {
    probe.healthPanelOpen = true
    probe.healthProblemCount = 1
    probe.healthProblems = [
      {
        category: 'engine',
        status: 'error',
        consecutiveFailures: 3,
        code: 'slotUnavailable',
        codeI18nKey: 'superAgent.errors.slotUnavailable',
        lastFailedAt: '2026-01-01T00:00:00Z',
        ticketId: null,
        reflectedOnTicket: false,
      },
    ]
    const wrapper = mountView()
    await flushPromises()

    const panel = wrapper.find('[data-testid="super-agent-health"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('superAgent.health.categories.engine')
    // 面板只读：处置操作在后续版本提供
    expect(panel.findAll('button')).toHaveLength(0)

    await wrapper.find('[data-testid="super-agent-health-entry"]').trigger('click')
    expect(probe.toggleHealthPanel).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

describe('SuperAgentView dispatch & queue（T05 #75）', () => {
  it('bind 后拉取队列并订阅 queue-changed，卸载时退订', async () => {
    const unsubscribe = vi.fn()
    probe.watchQueue.mockReturnValue(unsubscribe)
    const wrapper = mountView()
    await flushPromises()

    expect(probe.loadQueue).toHaveBeenCalledWith('D:/repo')
    expect(probe.watchQueue).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('「新建工单」是独立动作：默认不显示表单，点击展开，普通发送不建单', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="super-agent-dispatch-form"]').exists()).toBe(false)
    await wrapper.find('[data-testid="super-agent-dispatch-open"]').trigger('click')
    expect(wrapper.find('[data-testid="super-agent-dispatch-form"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('空标题提交只提示校验文案，不调用派工', async () => {
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('[data-testid="super-agent-dispatch-open"]').trigger('click')

    await wrapper.find('[data-testid="super-agent-dispatch-form"]').trigger('submit')

    expect(probe.dispatch).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="super-agent-dispatch-hint"]').text()).toBe(
      'superAgent.dispatch.requireTitle',
    )
    wrapper.unmount()
  })

  it('提交派工：requestId 幂等键非空、携带标题与目标，结果提示排队位置', async () => {
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('[data-testid="super-agent-dispatch-open"]').trigger('click')

    await wrapper.find('[data-testid="super-agent-dispatch-title"]').setValue('修复登录')
    await wrapper.find('[data-testid="super-agent-dispatch-text"]').setValue('登录按钮无响应')
    await wrapper.find('[data-testid="super-agent-dispatch-form"]').trigger('submit')
    await flushPromises()

    expect(probe.dispatch).toHaveBeenCalledTimes(1)
    const [repoRoot, command] = probe.dispatch.mock.calls[0]
    expect(repoRoot).toBe('D:/repo')
    expect(command.requestId).not.toBe('')
    expect(command.title).toBe('修复登录')
    expect(command.text).toBe('登录按钮无响应')
    expect(wrapper.find('[data-testid="super-agent-dispatch-hint"]').text()).toContain(
      'superAgent.dispatch.queuedHint',
    )
    wrapper.unmount()
  })

  it('重复派工请求返回幂等提示文案', async () => {
    probe.dispatch.mockResolvedValue({
      ticketId: 'ticket-1',
      assignmentId: 'assignment-1',
      decisionId: 'decision-1',
      mandateId: 'mandate-1',
      queuePosition: 0,
      duplicate: true,
    } as SuperAgentDispatchResult)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('[data-testid="super-agent-dispatch-open"]').trigger('click')

    await wrapper.find('[data-testid="super-agent-dispatch-title"]').setValue('修复登录')
    await wrapper.find('[data-testid="super-agent-dispatch-text"]').setValue('登录按钮无响应')
    await wrapper.find('[data-testid="super-agent-dispatch-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="super-agent-dispatch-hint"]').text()).toBe(
      'superAgent.dispatch.duplicateHint',
    )
    wrapper.unmount()
  })

  it('队列非空时展示执行中/排队条目与脏区提示', async () => {
    probe.queue = {
      repoRoot: 'D:/repo',
      maxWorkers: 1,
      running: [
        { ticketId: 'ticket-1', title: '工单一', position: 0, state: 'running', dirty: true },
      ],
      queued: [
        { ticketId: 'ticket-2', title: '工单二', position: 1, state: 'queued', dirty: null },
      ],
    }
    const wrapper = mountView()
    await flushPromises()

    const queuePanel = wrapper.find('[data-testid="super-agent-queue"]')
    expect(queuePanel.exists()).toBe(true)
    expect(queuePanel.text()).toContain('工单一')
    expect(queuePanel.text()).toContain('superAgent.queue.running')
    expect(queuePanel.text()).toContain('工单二')
    expect(queuePanel.text()).toContain('superAgent.queue.position')
    expect(queuePanel.text()).toContain('superAgent.queue.dirtyHint')
    wrapper.unmount()
  })

  it('派工被拒时显示失败提示文案', async () => {
    probe.dispatch.mockRejectedValue(new Error('engine down'))
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('[data-testid="super-agent-dispatch-open"]').trigger('click')

    await wrapper.find('[data-testid="super-agent-dispatch-title"]').setValue('修复登录')
    await wrapper.find('[data-testid="super-agent-dispatch-text"]').setValue('登录按钮无响应')
    await wrapper.find('[data-testid="super-agent-dispatch-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="super-agent-dispatch-hint"]').text()).toBe(
      'superAgent.dispatch.failedHint',
    )
    wrapper.unmount()
  })

  it('点击队列条目在右侧打开 Worker 只读标签（T07 #77）：多标签并存、只读不接管', async () => {
    probe.queue = {
      repoRoot: 'D:/repo',
      maxWorkers: 1,
      running: [
        { ticketId: 'ticket-1', title: '工单一', position: 0, state: 'running', dirty: true },
      ],
      queued: [
        { ticketId: 'ticket-2', title: '工单二', position: 1, state: 'queued', dirty: null },
      ],
    }
    probe.openWorkerTab.mockClear()
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('[data-testid="super-agent-queue-entry-ticket-1"]').trigger('click')
    expect(probe.openWorkerTab).toHaveBeenCalledWith('ticket-1', '工单一')

    // 回车同样可打开（键盘可达）
    await wrapper.find('[data-testid="super-agent-queue-entry-ticket-2"]').trigger('keydown.enter')
    expect(probe.openWorkerTab).toHaveBeenCalledWith('ticket-2', '工单二')
    wrapper.unmount()
  })

  it('队列为空时不渲染队列面板', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="super-agent-queue"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('SuperAgentView review outlets & reminders（T10 #80）', () => {
  function reviewBoard(): SuperAgentTicketBoard {
    return {
      repoRoot: 'D:/repo',
      seq: 3,
      tickets: [
        {
          ticketId: 'ticket-1',
          title: '修复登录',
          state: 'review',
          assignmentId: 'assignment-1',
          generation: 1,
          scopePaths: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          ended: null,
          reviewRemindedAt: '2026-01-02T00:00:00.000Z',
          canRetry: false,
        },
        {
          ticketId: 'ticket-2',
          title: '修复注册',
          state: 'failed',
          assignmentId: 'assignment-2',
          generation: 1,
          scopePaths: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          ended: null,
          reviewRemindedAt: null,
          canRetry: true,
        },
      ],
    }
  }

  it('renders one reminder bubble per overdue ticket and opens the read-only tab on click', async () => {
    probe.reviewReminders = [{ ticketId: 'ticket-1', title: '修复登录', remindedAt: '2026-01-02T00:00:00.000Z' }]
    probe.reviewRemindedCount = 1
    probe.openWorkerTab.mockClear()
    const wrapper = mountView()
    await flushPromises()

    // 同一工单复用原气泡（key=ticketId），不弹 modal
    const bubbles = wrapper.findAll('[data-testid="super-agent-review-reminder-ticket-1"]')
    expect(bubbles).toHaveLength(1)
    expect(wrapper.find('[data-testid="super-agent-review-reminded-count"]').exists()).toBe(true)

    await bubbles[0].trigger('click')
    expect(probe.openWorkerTab).toHaveBeenCalledWith('ticket-1', '修复登录')
    wrapper.unmount()
  })

  it('delegates card outlets to the store: accept/stop/retry with repoRoot and ticketId', async () => {
    probe.ticketBoard = reviewBoard()
    const wrapper = mountView()
    await flushPromises()

    const card = wrapper.getComponent(WorkerTaskCard)
    card.vm.$emit('accept', 'ticket-1')
    await flushPromises()
    expect(probe.acceptTicket).toHaveBeenCalledWith('D:/repo', 'ticket-1')

    card.vm.$emit('stop', 'ticket-1')
    await flushPromises()
    expect(probe.stopTicket).toHaveBeenCalledWith('D:/repo', 'ticket-1')

    card.vm.$emit('retry', 'ticket-2')
    await flushPromises()
    expect(probe.retryTicket).toHaveBeenCalledWith('D:/repo', 'ticket-2')
    wrapper.unmount()
  })

  it('delegates the follow-up message with a fresh requestId idempotency key', async () => {
    probe.ticketBoard = reviewBoard()
    const wrapper = mountView()
    await flushPromises()

    wrapper.getComponent(WorkerTaskCard).vm.$emit('message', { ticketId: 'ticket-1', text: '再改一版' })
    await flushPromises()

    expect(probe.messageTicket).toHaveBeenCalledTimes(1)
    const [repoRoot, command] = probe.messageTicket.mock.calls[0]
    expect(repoRoot).toBe('D:/repo')
    expect(command.ticketId).toBe('ticket-1')
    expect(command.text).toBe('再改一版')
    expect(command.requestId).not.toBe('')
    wrapper.unmount()
  })

  it('shows a non-modal hint when an outlet action fails', async () => {
    probe.ticketBoard = reviewBoard()
    probe.acceptTicket.mockRejectedValue(new Error('notReady'))
    const wrapper = mountView()
    await flushPromises()

    wrapper.getComponent(WorkerTaskCard).vm.$emit('accept', 'ticket-1')
    await flushPromises()

    const hint = wrapper.find('[data-testid="super-agent-ticket-action-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('superAgent.ticket.actionFailedHint')
    wrapper.unmount()
  })

  it('hides the reminder section when no ticket is overdue', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="super-agent-review-reminders"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="super-agent-review-reminded-count"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
