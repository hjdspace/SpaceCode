import { defineComponent } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const MessageListStub = defineComponent({
  name: 'MessageList',
  props: {
    messages: { type: Array, required: true },
    loading: { type: Boolean, required: true },
    sessionId: { type: String, default: '' },
    readonly: { type: Boolean, default: false },
    heldMessage: { type: Object, default: null },
    workRoutingCard: { type: Object, default: null },
  },
  template: '<div data-test="message-list" />',
})

const ChatInputStub = defineComponent({
  name: 'ChatInput',
  props: {
    disabled: { type: Boolean, default: false },
    isSending: { type: Boolean, default: false },
    placeholder: { type: String, default: '' },
  },
  template: '<div data-test="chat-input" />',
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
    agents: {
      install: vi.fn().mockResolvedValue({ success: true }),
      getInstalled: vi.fn().mockResolvedValue({ agents: [] }),
      scanLibrary: vi.fn().mockResolvedValue({ agents: [] }),
    },
    skills: { installLocal: vi.fn().mockResolvedValue({ success: true }) },
    officecli: { checkInstalled: vi.fn().mockResolvedValue(true) },
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
  isH5Mode: () => false,
}))

vi.mock('@/composables/useChatCommands', () => ({
  useChatCommands: () => ({ executeCommand: vi.fn() }),
}))

vi.mock('@/utils/recentProjectRoots', () => ({
  pathsEqual: (a: string, b: string) => a === b,
}))

vi.mock('@/components/chat/MessageList.vue', () => ({ default: MessageListStub }))
vi.mock('@/components/chat/ChatInput.vue', () => ({ default: ChatInputStub }))

const componentStub = { template: '<div />' }
vi.mock('@/components/chat/RecommendedPrompts.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/WelcomeHero.vue', () => ({ default: componentStub }))
vi.mock('@/components/work/WorkAssistantShortcuts.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/TeamStatusBar.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/TeammateTranscriptHeader.vue', () => ({ default: componentStub }))
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

describe('ChatPanel held work message', () => {
  let pinia: Pinia

  beforeEach(() => {
    localStorage.clear()
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

  async function mountWithHeldMessage() {
    const { default: ChatPanel } = await import('../ChatPanel.vue')
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const { useTurnStore } = await import('@/stores/turn')
    const { useAppStore } = await import('@/stores/app')
    const { useAgentsStore } = await import('@/stores/agents')

    const appStore = useAppStore()
    appStore.mode = 'work'
    appStore.setWorkWorkspace('D:/repo')
    appStore.projectRoot = 'D:/repo'

    const agentsStore = useAgentsStore()
    agentsStore.libraryAgents = [{
      name: 'ppt-creator',
      description: 'editable decks',
      content: '',
      sourceDir: '',
      agentPath: '',
      isInstalled: false,
      category: 'office',
      mode: 'work',
    }]

    const store = useChatSessionStore()
    const session = store.createSession('新对话', 'D:/repo')
    store.beginWorkRouting({
      sessionId: session.id,
      content: '帮我做个可编辑的 PPT',
      messageContent: '帮我做个可编辑的 PPT',
      attachments: {
        files: [{ name: 'outline.md', path: 'D:/repo/outline.md', isFolder: false }],
        images: [],
      },
    })

    const turnStore = useTurnStore()
    const sendMessage = vi.spyOn(turnStore, 'sendMessage').mockResolvedValue(undefined)

    const wrapper = shallowMount(ChatPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    return { wrapper, store, session, sendMessage }
  }

  it('renders the held message and matching card while the composer is disabled', async () => {
    const { wrapper, store, session } = await mountWithHeldMessage()

    const list = wrapper.findComponent(MessageListStub)
    const input = wrapper.findComponent(ChatInputStub)

    expect(list.props('heldMessage')).toMatchObject({
      role: 'user',
      content: '帮我做个可编辑的 PPT',
      attachments: [expect.objectContaining({ path: 'D:/repo/outline.md' })],
    })
    expect(list.props('workRoutingCard')).toMatchObject({ phase: 'matching' })
    expect(input.props('disabled')).toBe(true)
    expect(input.props('placeholder')).toBe('work.routeMatching')
    expect(store.getPendingWorkRouting(session.id)?.phase).toBe('matching')
  })

  it('cancelling from the card turns the wait into the failure form', async () => {
    const { wrapper, store, session } = await mountWithHeldMessage()

    wrapper.findComponent(MessageListStub).vm.$emit('routing-cancel')
    await flushPromises()

    expect(store.getPendingWorkRouting(session.id)).toMatchObject({
      phase: 'candidates',
      failure: 'abort',
    })
  })

  it('picking a candidate binds and sends the held message', async () => {
    const { wrapper, store, session, sendMessage } = await mountWithHeldMessage()

    store.abortWorkRouting(session.id)
    await flushPromises()
    wrapper.findComponent(MessageListStub).vm.$emit('routing-pick', 'ppt-creator')
    await flushPromises()

    expect(session.assistantId).toBe('ppt-creator')
    expect(store.getPendingWorkRouting(session.id)).toBeUndefined()
    expect(sendMessage).toHaveBeenCalledWith(
      '帮我做个可编辑的 PPT',
      undefined,
      expect.objectContaining({
        files: [expect.objectContaining({ path: 'D:/repo/outline.md' })],
        images: [],
      }),
      { sessionId: session.id },
    )
  }, 30000)

  it('the general exit sends without binding an assistant', async () => {
    const { wrapper, store, session, sendMessage } = await mountWithHeldMessage()

    store.abortWorkRouting(session.id)
    await flushPromises()
    wrapper.findComponent(MessageListStub).vm.$emit('routing-general')
    await flushPromises()

    expect(session.assistantId).toBeUndefined()
    expect(session.workRouting).toMatchObject({ outcome: 'general' })
    expect(store.getPendingWorkRouting(session.id)).toBeUndefined()
    expect(sendMessage).toHaveBeenCalledWith(
      '帮我做个可编辑的 PPT',
      undefined,
      expect.objectContaining({ images: [] }),
      { sessionId: session.id },
    )
  }, 30000)
})
