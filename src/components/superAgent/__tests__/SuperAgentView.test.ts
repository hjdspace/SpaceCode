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
import { nextTick, reactive } from 'vue'
import type { Message } from '@/types'
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
  // ── Router 对话改走主进程 RouterRunner（T21）──
  sendRouterMessage: vi.fn().mockResolvedValue({ sessionId: 'router-1', running: true }),
  abortRouter: vi.fn().mockResolvedValue(undefined),
  watchRouterStatus: vi.fn().mockReturnValue(() => {}),
  routerRunning: false,
  getIsLoading: vi.fn(() => false),
  addMessage: vi.fn().mockResolvedValue(undefined),
  getDisplayMessages: vi.fn<() => Message[]>(() => []),
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
  // ── 健康处置（T20 #90）──
  reevaluateEval: vi.fn().mockResolvedValue({ evalId: 'eval-1', requeuedTriggerIds: [] }),
  dismissProblem: vi.fn().mockResolvedValue(undefined),
  retryHealthProblem: vi.fn().mockResolvedValue(undefined),
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
  // ── 执行策略与检查点（T12 #82，并发会话维护）：仅补桩保证挂载流程可跑 ──
  loadPolicy: vi.fn().mockResolvedValue(undefined),
  setPolicy: vi.fn().mockResolvedValue(undefined),
  loadCheckpoint: vi.fn().mockResolvedValue(undefined),
  rollbackCheckpointFiles: vi.fn().mockResolvedValue({ rolled: [], skipped: [] }),
  executionPolicy: null as { repoRoot: string; policy: { mode: 'serial' | 'parallel'; maxWorkers: number; worktree: 'none' | 'per-ticket' } } | null,
  checkpointInfo: null as { repoRoot: string; checkpoint: { savedAt: string; head: string | null; entries: string[] } | null; changedFiles: string[] } | null,
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
    currentSessionId: null,
    turnChangeCards: [],
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
    isEngineStarting: () => false,
    getMcpFailures: () => [],
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
    sendRouterMessage: probe.sendRouterMessage,
    abortRouter: probe.abortRouter,
    watchRouterStatus: probe.watchRouterStatus,
    get routerRunning() { return probe.routerRunning },
    loadHealth: probe.loadHealth,
    watchHealth: probe.watchHealth,
    toggleHealthPanel: probe.toggleHealthPanel,
    get healthPanelOpen() { return probe.healthPanelOpen },
    get healthProblemCount() { return probe.healthProblemCount },
    get healthProblems() { return probe.healthProblems },
    reevaluateEval: probe.reevaluateEval,
    dismissProblem: probe.dismissProblem,
    retryHealthProblem: probe.retryHealthProblem,
    dispatch: probe.dispatch,
    loadQueue: probe.loadQueue,
    watchQueue: probe.watchQueue,
    get queue() { return probe.queue },
    // ── 执行策略与检查点（T12 #82，并发会话维护）：仅补桩保证挂载流程可跑 ──
    loadPolicy: probe.loadPolicy,
    setPolicy: probe.setPolicy,
    loadCheckpoint: probe.loadCheckpoint,
    rollbackCheckpointFiles: probe.rollbackCheckpointFiles,
    get executionPolicy() { return probe.executionPolicy },
    get checkpointInfo() { return probe.checkpointInfo },
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
      // 真实 MessageList 与 WorkerTaskCard：不能由测试桩发明宿主不存在的 slot。
      stubs: {
        ChatInput: true,
        MessageItem: true,
        AgentTimeline: {
          props: ['messages'],
          template: '<div class="assistant-reply">{{ messages.map(m => m.content).join(" ") }}</div>',
        },
        DesignBlocks: true,
        GenuiCardGroup: true,
        CurrentTurnChangeCard: true,
        ArtifactSummaryCard: true,
        ConversationMinimap: true,
        LoadingState: true,
        ExtensionDialogCard: true,
      },
    },
  })
}

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn()
  probe.getDisplayMessages.mockReturnValue([])
  probe.bind.mockClear()
  probe.loadState.mockClear()
  probe.openWorkerTab.mockClear()
  probe.sendMessage.mockClear()
  probe.abort.mockClear()
  probe.sendRouterMessage.mockClear()
  probe.abortRouter.mockClear()
  probe.watchRouterStatus.mockClear()
  probe.routerRunning = false
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
  probe.reevaluateEval.mockClear()
  probe.reevaluateEval.mockResolvedValue({ evalId: 'eval-1', requeuedTriggerIds: [] })
  probe.dismissProblem.mockClear()
  probe.dismissProblem.mockResolvedValue(undefined)
  probe.retryHealthProblem.mockClear()
  probe.retryHealthProblem.mockResolvedValue(undefined)
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
  probe.loadAttentions.mockClear()
  probe.watchAttentions.mockClear()
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
  probe.attentionBubbles = []
  probe.attentionCount = 0
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

  it('发送走 Router 通路：正文组装与主聊天逐字一致，不碰 turnStore（T21）', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findComponent(ChatInput).vm.$emit('send', '看下这个', {
      files: [{ path: 'D:/repo/a.png', name: 'a.png', isFolder: false, source: 'upload' }],
      images: [],
    })

    // 走 turnStore 就等于让 Router 变成一条带全套写工具的普通聊天 —— 那正是
    // 「让它派活它自己干了」的根因，这里把它钉住。
    expect(probe.sendMessage).not.toHaveBeenCalled()
    expect(probe.sendRouterMessage).toHaveBeenCalledTimes(1)
    const [repoRoot, command] = probe.sendRouterMessage.mock.calls[0]
    expect(repoRoot).toBe('D:/repo')
    expect(command.text.startsWith('@"D:/repo/a.png"')).toBe(true)
    expect(command.text).toContain('看下这个')
    expect(command.requestId).toBeTruthy()
    wrapper.unmount()
  })

  it('图片附件随 Router 消息一起投递，不被静默丢弃', async () => {
    const wrapper = mountView()
    await flushPromises()
    const images = [{ id: 'i1', name: 'shot.png', type: 'image', mimeType: 'image/png', previewUrl: '', data: 'x' }]

    await wrapper.findComponent(ChatInput).vm.$emit('send', '这个界面不对', { files: [], images })

    const [, command] = probe.sendRouterMessage.mock.calls[0]
    expect(command.images).toEqual(images)
    wrapper.unmount()
  })

  it('输入框选的模型随消息下发 —— 不带它 Router 只会用设置页的槽位模型', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findComponent(ChatInput).vm.$emit('send', '第一句', { files: [], images: [] })
    expect(probe.sendRouterMessage.mock.calls[0][1].model).toBe('sonnet')

    wrapper.findComponent(ChatInput).vm.$emit('update:model', 'glm-5-3-flash')
    await flushPromises()
    await wrapper.findComponent(ChatInput).vm.$emit('send', '第二句', { files: [], images: [] })
    expect(probe.sendRouterMessage.mock.calls[1][1].model).toBe('glm-5-3-flash')
    wrapper.unmount()
  })

  it('中止只作用于 Router 这一轮，不触碰 Worker 会话', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findComponent(ChatInput).vm.$emit('stop')

    expect(probe.abortRouter).toHaveBeenCalledTimes(1)
    expect(probe.abortRouter).toHaveBeenCalledWith('D:/repo')
    expect(probe.abort).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('Router turn 进行中：typing 与 Composer 停止按钮读主进程状态，不读本地 turn', async () => {
    probe.routerRunning = true
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findComponent(MessageList).props('loading')).toBe(true)
    const composer = wrapper.findComponent(ChatInput)
    expect(composer.props('isSending')).toBe(true)
    expect(composer.props('disabled')).toBe(true)
    wrapper.unmount()
  })

  it('Router 气泡流走 IM 展示模式（同一渲染器，只减展示面）', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findComponent(MessageList).props('presentation')).toBe('im')
    wrapper.unmount()
  })

  it('斜杠命令在 Router 会话内落消息：clear 走 Router 中止，UI 绑定命令给出宿主提示', async () => {
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
    expect(probe.abortRouter).toHaveBeenCalledWith('D:/repo')
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

  it('sdk 命令仍走 Router 通路（能力不裁剪，但不换掉这条会话的配置）', async () => {
    const wrapper = mountView()
    await flushPromises()
    probe.sendRouterMessage.mockClear()

    await wrapper.findComponent(ChatInput).vm.$emit('slash-command', 'compact', '', { files: [], images: [] })
    await flushPromises()

    expect(probe.sendMessage).not.toHaveBeenCalled()
    expect(probe.sendRouterMessage).toHaveBeenCalledWith('D:/repo', expect.objectContaining({
      text: '/compact',
      displayText: '/compact',
    }))
    wrapper.unmount()
  })
})

describe('SuperAgentView snapshot/subscription lifecycle', () => {
  it('慢快照加载期间的状态事件不会丢失，且所有订阅在快照之前就绪', async () => {
    const board = reactive<SuperAgentTicketBoard>({
      repoRoot: 'D:/repo', seq: 1,
      tickets: [{
        ticketId: 'ticket-live', title: '实时工单', state: 'queued', assignmentId: 'assignment-live',
        generation: 1, scopePaths: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        ended: null, reviewRemindedAt: null, canRetry: false, canStop: true,
      }],
    })
    probe.ticketBoard = board
    let publish: (() => void) | undefined
    const offTickets = vi.fn(() => { publish = undefined })
    probe.watchTickets.mockImplementationOnce(() => {
      publish = () => { board.tickets[0].state = 'working' }
      return offTickets
    })
    // Attention 快照比 Ticket 快照慢；这段期间主进程开始执行 Worker。
    probe.loadAttentions.mockImplementationOnce(async () => { publish?.() })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-testid="worker-task-card-state"]').text()).toBe('superAgent.ticket.states.working')
    for (const watch of [probe.watchHealth, probe.watchQueue, probe.watchTickets, probe.watchAttentions, probe.watchRouterStatus]) {
      expect(watch).toHaveBeenCalledBefore(probe.loadState)
    }
    wrapper.unmount()
    expect(offTickets).toHaveBeenCalledTimes(1)
  })

  it('快照仍在加载时卸载会清理全部订阅，返回后不会重新订阅', async () => {
    const watchers = [probe.watchHealth, probe.watchQueue, probe.watchTickets, probe.watchAttentions, probe.watchRouterStatus]
    const unsubscribes = watchers.map(watch => {
      const unsubscribe = vi.fn()
      watch.mockReturnValueOnce(unsubscribe)
      return unsubscribe
    })
    let resolveSnapshot!: () => void
    probe.loadAttentions.mockImplementationOnce(() => new Promise<void>(resolve => { resolveSnapshot = resolve }))
    const wrapper = mountView()
    await flushPromises()
    wrapper.unmount()
    for (const unsubscribe of unsubscribes) expect(unsubscribe).toHaveBeenCalledTimes(1)
    resolveSnapshot()
    await flushPromises()
    for (const watch of watchers) expect(watch).toHaveBeenCalledTimes(1)
  })

  it('绑定未完成就卸载，不继续加载也不创建泄漏的订阅', async () => {
    let resolveBind!: () => void
    probe.bind.mockImplementationOnce(() => new Promise<void>(resolve => { resolveBind = resolve }))
    const wrapper = mountView()
    wrapper.unmount()
    resolveBind()
    await flushPromises()

    expect(probe.loadState).not.toHaveBeenCalled()
    for (const watch of [probe.watchHealth, probe.watchQueue, probe.watchTickets, probe.watchAttentions, probe.watchRouterStatus]) {
      expect(watch).not.toHaveBeenCalled()
    }
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

  it('点击入口开关面板：面板可操作（重试/忽略/重新评估上抛到 store）', async () => {
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
        subjectId: null,
      },
    ]
    const wrapper = mountView()
    await flushPromises()

    const panel = wrapper.find('[data-testid="super-agent-health"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('superAgent.health.categories.engine')

    // T20：面板从只读升级为可操作 —— 重试直接委托 store
    await panel.find('[data-testid="super-agent-health-retry-engine"]').trigger('click')
    await flushPromises()
    expect(probe.retryHealthProblem).toHaveBeenCalledWith('D:/repo', 'engine', null)
    // 处置回显（成功提示）
    expect(wrapper.find('[data-testid="super-agent-health-action-hint"]').exists()).toBe(true)

    // 忽略走两步确认后委托 store
    await panel.find('[data-testid="super-agent-health-dismiss-engine"]').trigger('click')
    await panel.find('[data-testid="super-agent-health-dismiss-confirm-engine"]').trigger('click')
    await flushPromises()
    expect(probe.dismissProblem).toHaveBeenCalledWith('D:/repo', 'engine', null)

    await wrapper.find('[data-testid="super-agent-health-entry"]').trigger('click')
    expect(probe.toggleHealthPanel).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('unavailable Eval 主体项的重新评估委托 store 并回显', async () => {
    probe.healthPanelOpen = true
    probe.healthProblemCount = 1
    probe.healthProblems = [
      {
        category: 'eval',
        status: 'error',
        consecutiveFailures: 1,
        code: 'evalUnavailable',
        codeI18nKey: 'superAgent.errors.evalUnavailable',
        lastFailedAt: '2026-01-01T00:00:00Z',
        ticketId: null,
        reflectedOnTicket: false,
        subjectId: 'eval-1',
      },
    ]
    const wrapper = mountView()
    await flushPromises()

    const panel = wrapper.find('[data-testid="super-agent-health"]')
    await panel.find('[data-testid="super-agent-health-reevaluate-eval-eval-1"]').trigger('click')
    await flushPromises()

    expect(probe.reevaluateEval).toHaveBeenCalledWith('D:/repo', 'eval-1')
    expect(wrapper.find('[data-testid="super-agent-health-action-hint"]').exists()).toBe(true)
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

  it('派工入口已下线：不再有「新建工单」chip 与表单', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="super-agent-dispatch-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="super-agent-dispatch-form"]').exists()).toBe(false)
    expect(probe.dispatch).not.toHaveBeenCalled()
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
          canStop: true,
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
          canStop: true,
        },
      ],
    }
  }

  /** 卡片创建时间要晚于锚点助手回复，才会落进那条回复的时间线单位里。 */
  function anchoredBoard(board: SuperAgentTicketBoard): SuperAgentTicketBoard {
    return { ...board, tickets: board.tickets.map((t) => ({ ...t, createdAt: '2026-01-01T00:00:02Z' })) }
  }

  it('真实 MessageList 中的 Worker 卡片可见且点击打开右侧执行过程', async () => {
    probe.ticketBoard = reviewBoard()
    probe.getDisplayMessages.mockReturnValue([
      { id: 'a1', role: 'assistant', content: '已派 Worker 执行', timestamp: Date.parse('2025-12-31T23:59:59Z') },
    ])
    const wrapper = mountView()
    await flushPromises()

    const list = wrapper.getComponent(MessageList)
    expect(list.get('.assistant-reply').text()).toBe('已派 Worker 执行')
    const cards = list.findAll('[data-testid="worker-task-card"]')
    expect(cards).toHaveLength(2)
    await cards[1].trigger('click')
    expect(probe.openWorkerTab).toHaveBeenCalledWith('ticket-2', '修复注册')
    wrapper.unmount()
  })

  it('卡片归属最近的之前 assistant group，更新及新闲聊不移位、不重复，缺历史时 append', async () => {
    const history = reactive<Message[]>([
      { id: 'u1', role: 'user', content: '修复登录', timestamp: Date.parse('2026-01-01T00:00:00Z') },
      { id: 'a1', role: 'assistant', content: '正在派工', timestamp: Date.parse('2026-01-01T00:00:01Z') },
      { id: 'a1-more', role: 'assistant', content: '已派 Worker', timestamp: Date.parse('2026-01-01T00:00:03Z') },
      { id: 'u2', role: 'user', content: '修复注册', timestamp: Date.parse('2026-01-01T00:00:10Z') },
      { id: 'a2', role: 'assistant', content: '已派另一 Worker', timestamp: Date.parse('2026-01-01T00:00:11Z') },
    ])
    const board = reactive(reviewBoard())
    board.tickets[0].createdAt = '2026-01-01T00:00:02Z'
    // 时间相同也算之前/当前回复；第一张卡在组内后续 assistant 消息之前创建。
    board.tickets[1].createdAt = '2026-01-01T00:00:11Z'
    board.tickets.push({ ...board.tickets[0], ticketId: 'historic', title: '历史工单', createdAt: '2025-12-31T00:00:00Z' })
    probe.ticketBoard = board
    probe.getDisplayMessages.mockReturnValue(history)
    const wrapper = mountView()
    await flushPromises()

    const firstReply = wrapper.get('[data-minimap-id="a1"]')
    const firstCard = firstReply.get('[data-testid="worker-task-card"]')
    expect(firstCard.text()).toContain('修复登录')
    expect(firstReply.findAll('[data-testid="worker-task-card"]')).toHaveLength(1)
    expect(wrapper.get('[data-minimap-id="a2"]').get('[data-testid="worker-task-card"]').text()).toContain('修复注册')
    expect(firstReply.element.lastElementChild?.textContent).toContain('修复登录')

    board.tickets[0] = { ...board.tickets[0], state: 'completed', canStop: false, updatedAt: '2026-01-01T00:00:30Z' }
    history.push(
      { id: 'u3', role: 'user', content: '你好', timestamp: Date.parse('2026-01-01T00:01:00Z') },
      { id: 'a3', role: 'assistant', content: '你好！', timestamp: Date.parse('2026-01-01T00:01:01Z') },
    )
    await nextTick()

    expect(firstReply.get('[data-testid="worker-task-card"]').element).toBe(firstCard.element)
    expect(firstCard.attributes('data-state')).toBe('completed')
    expect(wrapper.get('[data-minimap-id="a3"]').find('[data-testid="worker-task-card"]').exists()).toBe(false)
    const cards = wrapper.findAll('[data-testid="worker-task-card"]')
    expect(cards).toHaveLength(3)
    expect(cards[2].text()).toContain('历史工单')
    expect(cards[2].element.closest('.minimap-anchor')).toBeNull()

    // 清空/缺失全部会话历史，工单仍可通过 fallback 打开。
    history.splice(0)
    await nextTick()
    expect(wrapper.findAll('[data-testid="worker-task-card"]')).toHaveLength(3)
    await wrapper.findAll('[data-testid="worker-task-card"]')[2].trigger('click')
    expect(probe.openWorkerTab).toHaveBeenCalledWith('historic', '历史工单')
    wrapper.unmount()
  })

  it('历史消息 id 重复时，同一张卡也只能属于一个 assistant group', async () => {
    probe.ticketBoard = reviewBoard()
    probe.getDisplayMessages.mockReturnValue([
      { id: 'reused', role: 'assistant', content: '派工回复', timestamp: Date.parse('2025-12-31T23:59:59Z') },
      { id: 'u2', role: 'user', content: '闲聊', timestamp: Date.parse('2026-01-01T00:01:00Z') },
      { id: 'reused', role: 'assistant', content: '闲聊回复', timestamp: Date.parse('2026-01-01T00:01:01Z') },
    ])
    const wrapper = mountView()
    await flushPromises()
    const replies = wrapper.findAll('[data-minimap-id="reused"]')
    expect(replies[0].findAll('[data-testid="worker-task-card"]')).toHaveLength(2)
    expect(replies[1].findAll('[data-testid="worker-task-card"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-testid="worker-task-card"]')).toHaveLength(2)
    wrapper.unmount()
  })

  it('待验收超时提醒跟着所属工单出现在时间线里，点击打开只读标签', async () => {
    probe.ticketBoard = anchoredBoard(reviewBoard())
    probe.getDisplayMessages.mockReturnValue([
      { id: 'u1', role: 'user', content: '修复登录', timestamp: Date.parse('2026-01-01T00:00:00Z') },
      { id: 'a1', role: 'assistant', content: '已派 Worker 修复登录', timestamp: Date.parse('2026-01-01T00:00:01Z') },
    ])
    probe.reviewReminders = [{ ticketId: 'ticket-1', title: '修复登录', remindedAt: '2026-01-02T00:00:00.000Z' }]
    probe.reviewRemindedCount = 1
    probe.openWorkerTab.mockClear()
    const wrapper = mountView()
    await flushPromises()

    // 同一工单复用原气泡（key=ticketId），不弹 modal，也不再挂顶部独立区块
    const bubbles = wrapper.findAll('[data-testid="super-agent-review-reminder-ticket-1"]')
    expect(bubbles).toHaveLength(1)
    expect(wrapper.find('[data-testid="super-agent-review-reminders"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="super-agent-review-reminded-count"]').exists()).toBe(false)

    // 气泡在 ticket-1 的工单位内，而该单位在消息时间线里
    const entry = wrapper.get('[data-testid="super-agent-ticket-entry-ticket-1"]')
    expect(entry.find('[data-testid="super-agent-review-reminder-ticket-1"]').exists()).toBe(true)
    expect(entry.element.closest('.minimap-anchor')).not.toBeNull()
    expect(entry.find('[data-testid="worker-task-card"]').text()).toContain('修复登录')

    await bubbles[0].trigger('click')
    expect(probe.openWorkerTab).toHaveBeenCalledWith('ticket-1', '修复登录')
    wrapper.unmount()
  })

  it('Worker 提问气泡同样随工单卡片进时间线；卡片不在看板时兜底落末尾', async () => {
    probe.ticketBoard = anchoredBoard(reviewBoard())
    probe.getDisplayMessages.mockReturnValue([
      { id: 'u1', role: 'user', content: '修复注册', timestamp: Date.parse('2026-01-01T00:00:00Z') },
      { id: 'a1', role: 'assistant', content: '已派 Worker 修复注册', timestamp: Date.parse('2026-01-01T00:00:01Z') },
    ])
    probe.attentionBubbles = [
      {
        attentionId: 'ask-2',
        ticketId: 'ticket-2',
        ticketTitle: '修复注册',
        assignmentId: 'assignment-2',
        kind: 'question',
        question: '注册页要一起改吗？',
        askedAt: '2026-01-02T00:00:00.000Z',
        status: 'open',
        answers: [],
        answeredAt: null,
      },
      {
        attentionId: 'ask-9',
        ticketId: 'ticket-9',
        ticketTitle: '已清理的工单',
        assignmentId: 'assignment-9',
        kind: 'question',
        question: '这条问题不能丢',
        askedAt: '2026-01-02T00:00:00.000Z',
        status: 'open',
        answers: [],
        answeredAt: null,
      },
    ]
    probe.attentionCount = 2
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="super-agent-attentions"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="super-agent-attention-count"]').exists()).toBe(false)

    const entry = wrapper.get('[data-testid="super-agent-ticket-entry-ticket-2"]')
    expect(entry.get('[data-testid="attention-bubble-question"]').text()).toBe('注册页要一起改吗？')
    expect(entry.element.closest('.minimap-anchor')).not.toBeNull()

    // ticket-9 已无卡片：问题仍在末尾出现，不静默消失
    const orphans = wrapper.findAll('[data-testid="attention-bubble-question"]')
    expect(orphans).toHaveLength(2)
    expect(orphans[1].text()).toBe('这条问题不能丢')
    expect(orphans[1].element.closest('.minimap-anchor')).toBeNull()
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

  it('点击卡片打开该工单的右侧面板 —— 队列里已经没有的失败工单也要有入口', async () => {
    probe.ticketBoard = reviewBoard()
    probe.openWorkerTab.mockClear()
    const wrapper = mountView()
    await flushPromises()

    const cards = wrapper.findAllComponents(WorkerTaskCard)
    cards[1].vm.$emit('open', 'ticket-2')
    await flushPromises()

    // ticket-2 是 failed：scheduler.queue() 早就不含它，卡片是唯一在场的入口
    expect(probe.openWorkerTab).toHaveBeenCalledWith('ticket-2', '修复注册')
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

  it('没有超时工单时工单位里只有卡片，不出现提醒气泡', async () => {
    probe.ticketBoard = anchoredBoard(reviewBoard())
    probe.getDisplayMessages.mockReturnValue([
      { id: 'a1', role: 'assistant', content: '已派工', timestamp: Date.parse('2026-01-01T00:00:01Z') },
    ])
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('[data-testid="super-agent-ticket-entry-ticket-1"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid^="super-agent-review-reminder-"]')).toHaveLength(0)
    wrapper.unmount()
  })
})
