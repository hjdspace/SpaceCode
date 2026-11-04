/**
 * SuperAgentView Router 对话接线契约（T04 #74）：
 *  - 复用主聊天 Composer/MessageList：session-id 绑定 Router 会话（草稿域随之隔离）、
 *    场景化 placeholder、宿主裁剪（隐藏 work 画廊入口与 UI 绑定命令）；
 *  - 发送走共享 buildOutgoingMessage：@"引用 marker 与主聊天逐字一致；
 *  - 中止/typing 只按 routerSessionId 寻址，不触碰其它会话（Worker）；
 *  - 斜杠命令的本地子集在 Router 会话内落消息，全局命令与主聊天同源；
 *  - 无项目根时保持 T01 的空态且不做 IPC；
 *  - 健康上报（T13 #83）：bind 后拉取并订阅健康报告，顶部入口只显示汇总计数，
 *    点击只开关只读面板（无任何处置按钮）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuperAgentHealthItem } from '@/shared/channels/superAgent'

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
  updateAppearance: vi.fn(),
  // ── 健康上报（T13）──
  loadHealth: vi.fn().mockResolvedValue(undefined),
  watchHealth: vi.fn().mockReturnValue(() => {}),
  toggleHealthPanel: vi.fn(),
  healthPanelOpen: false,
  healthProblemCount: 0,
  healthProblems: [] as SuperAgentHealthItem[],
}))

vi.mock('vue-i18n', () => ({
  createI18n: vi.fn(),
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    get projectRoot() { return probe.projectRoot },
    openTerminalTab: probe.openTerminalTab,
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
  }),
}))

import SuperAgentView from '../SuperAgentView.vue'
import ChatInput from '../../chat/ChatInput.vue'
import MessageList from '../../chat/MessageList.vue'

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
