import { defineComponent, nextTick } from 'vue'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const MessageListStub = defineComponent({
  name: 'MessageList',
  props: {
    messages: { type: Array, required: true },
    loading: { type: Boolean, required: true },
  },
  template: '<div data-test="message-list" />',
})

vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      locale: { value: 'en-US' },
      t: (key: string) => key,
    },
  }),
  useI18n: () => ({
    t: (key: string) => key,
    locale: { value: 'en-US' },
    tm: (key: string) => (key === 'chat.defaultTasks' ? [] : undefined),
  }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: null,
    image: null,
    trace: { event: vi.fn() },
    getCwd: vi.fn().mockResolvedValue('D:/repo'),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(''),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
    h5Access: { setMirrorSession: vi.fn().mockResolvedValue(undefined) },
    git: {
      getStatus: vi.fn().mockResolvedValue(null),
      getFullDiff: vi.fn().mockResolvedValue(null),
      getRoot: vi.fn().mockResolvedValue(null),
      isRepo: vi.fn().mockResolvedValue(false),
    },
    artifacts: {
      list: vi.fn().mockResolvedValue({ artifacts: [] }),
    },
  },
}))

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn().mockResolvedValue(undefined),
  updateConfig: vi.fn(),
  llmState: {
    provider: { value: 'anthropic' },
    isConfigured: { value: true },
  },
}))

vi.mock('@/services/h5ApiClient', () => ({
  isH5Mode: () => true,
}))

vi.mock('@/composables/useChatCommands', () => ({
  useChatCommands: () => ({
    executeCommand: vi.fn(),
  }),
}))

vi.mock('@/composables/useWorkRouter', () => ({
  useWorkRouter: () => ({
    route: vi.fn(() => ({ type: 'none' })),
  }),
}))

vi.mock('@/utils/recentProjectRoots', () => ({
  pathsEqual: (a: string, b: string) => a === b,
}))

vi.mock('@/components/chat/MessageList.vue', () => ({ default: MessageListStub }))

const componentStub = { template: '<div />' }
vi.mock('@/components/chat/RecommendedPrompts.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/WelcomeHero.vue', () => ({ default: componentStub }))
vi.mock('@/components/work/WorkAssistantShortcuts.vue', () => ({ default: componentStub }))
vi.mock('@/components/work/WorkAssistantPicker.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/TeamStatusBar.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/TeammateTranscriptHeader.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/ChatInput.vue', () => ({ default: componentStub }))
vi.mock('@/components/terminal/TerminalPanel.vue', () => ({ default: componentStub }))
vi.mock('@/components/layout/NoProjectHome.vue', () => ({ default: componentStub }))
vi.mock('@/components/common/ToastNotification.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/RewindDialog.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/CodeRewindConfirmDialog.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/MessageSelector.vue', () => ({ default: componentStub }))
vi.mock('@/components/explorer/HistorySessionList.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/ContextUsageChip.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/ContextUsageWarningBar.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/ContextUsageModal.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/DiffExplorer.vue', () => ({ default: componentStub }))
vi.mock('@/components/session-context/SessionContextEnvPanel.vue', () => ({ default: componentStub }))
vi.mock('@/components/session-context/SessionContextTaskPanel.vue', () => ({ default: componentStub }))
vi.mock('@/components/session-context/SessionContextCommitDialog.vue', () => ({ default: componentStub }))
vi.mock('@/components/session-context/SessionContextCreateBranchDialog.vue', () => ({ default: componentStub }))
vi.mock('@/components/session-context/SessionContextGitGraphModal.vue', () => ({ default: componentStub }))
vi.mock('@/components/session-context/SessionContextPushDialog.vue', () => ({ default: componentStub }))

describe('ChatPanel loading state', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(36).slice(2)}`),
    })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
  })

  it('passes turn-store loading to MessageList while a turn is active', async () => {
    const { default: ChatPanel } = await import('../ChatPanel.vue')
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const { useTurnStore } = await import('@/stores/turn')
    const { useAppStore } = await import('@/stores/app')
    const { api } = await import('@/services/electronAPI')

    const sessionStore = useChatSessionStore()
    const turnStore = useTurnStore()
    const appStore = useAppStore()

    const session = sessionStore.createSession('Test', 'D:/repo', 'sess-loading')
    sessionStore.selectSession(session.id)
    appStore.projectRoot = 'D:/repo'
    sessionStore.addMessage({ role: 'user', content: 'hello' }, session.id)
    vi.mocked(api.git.getStatus).mockClear()
    const ts = (turnStore as any).beginTurn(session.id, { isAutonomous: false })

    const wrapper = shallowMount(ChatPanel, {
      props: { sessionId: session.id },
      global: {
        plugins: [pinia],
      },
    })
    await nextTick()

    expect(wrapper.findComponent(MessageListStub).props('loading')).toBe(true)
    expect(api.git.getStatus).toHaveBeenCalledWith('D:/repo')

    ;(turnStore as any).endTurn(session.id, ts)
  }, 30000)

  it('does not scan git status or full diff for an empty conversation', async () => {
    const { default: ChatPanel } = await import('../ChatPanel.vue')
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const { useAppStore } = await import('@/stores/app')
    const { api } = await import('@/services/electronAPI')

    const sessionStore = useChatSessionStore()
    const appStore = useAppStore()
    const session = sessionStore.createSession('New Chat', 'D:/repo', 'sess-empty')
    appStore.projectRoot = 'D:/repo'
    vi.mocked(api.git.getStatus).mockClear()
    vi.mocked(api.git.getFullDiff).mockClear()

    shallowMount(ChatPanel, {
      props: { sessionId: session.id },
      global: { plugins: [pinia] },
    })
    await nextTick()

    expect(api.git.getStatus).not.toHaveBeenCalled()
    expect(api.git.getFullDiff).not.toHaveBeenCalled()
  }, 30000)

  it('shows the rendered session\'s agent, not the last global selection', async () => {
    localStorage.clear()
    const { default: ChatPanel } = await import('../ChatPanel.vue')
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const sessionStore = useChatSessionStore()

    const reviewer = sessionStore.createSession('Reviewer', 'D:/repo', 'badge-reviewer')
    reviewer.agent = 'reviewer'
    reviewer.agentUnapplied = 'reviewer'
    const other = sessionStore.createSession('Other', 'D:/repo', 'badge-other')
    other.agent = 'planner'
    // A 会话的未生效账不能挂到 B 的名字上 (#46)
    other.agentUnapplied = 'reviewer'
    const plain = sessionStore.createSession('Plain', 'D:/repo', 'badge-plain')
    // 全局默认是新会话的起点，不能代表任何一个已有会话
    sessionStore.currentAgent = 'reviewer'

    const reviewerView = shallowMount(ChatPanel, {
      props: { sessionId: reviewer.id },
      global: { plugins: [pinia] },
    })
    await nextTick()
    expect(reviewerView.find('.agent-badge').text()).toBe('reviewer')
    expect(reviewerView.find('.agent-badge').classes()).toContain('agent-unapplied')
    reviewerView.unmount()

    const otherView = shallowMount(ChatPanel, {
      props: { sessionId: other.id },
      global: { plugins: [pinia] },
    })
    await nextTick()
    expect(otherView.find('.agent-badge').text()).toBe('planner')
    expect(otherView.find('.agent-badge').classes()).not.toContain('agent-unapplied')
    otherView.unmount()

    const plainView = shallowMount(ChatPanel, {
      props: { sessionId: plain.id },
      global: { plugins: [pinia] },
    })
    await nextTick()
    expect(plainView.find('.agent-badge').exists()).toBe(false)
    plainView.unmount()
  }, 30000)

  it('shows the pending default only while no session exists', async () => {
    localStorage.clear()
    const { default: ChatPanel } = await import('../ChatPanel.vue')
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const sessionStore = useChatSessionStore()
    // 先建会话（此时默认值为空），再设默认值：避免 createSession 的播种掩盖回退
    const plain = sessionStore.createSession('Plain', 'D:/repo', 'badge-no-fallback')
    sessionStore.currentSessionId = null
    sessionStore.currentAgent = 'reviewer'

    const newChatView = shallowMount(ChatPanel, { global: { plugins: [pinia] } })
    await nextTick()
    expect(newChatView.find('.agent-badge').text()).toBe('reviewer')
    newChatView.unmount()

    // 一旦有了会话，哪怕它没选过 agent，也不能再借全局默认亮徽章
    const plainView = shallowMount(ChatPanel, {
      props: { sessionId: plain.id },
      global: { plugins: [pinia] },
    })
    await nextTick()
    expect(plainView.find('.agent-badge').exists()).toBe(false)
    plainView.unmount()
  }, 30000)
})
