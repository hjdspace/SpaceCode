import { defineComponent } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
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

const ChatInputStub = defineComponent({
  name: 'ChatInput',
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

  async function holdMessageFrom(sourceSessionId: string) {
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const store = useChatSessionStore()
    store.holdWorkFirstMessage({
      sessionId: sourceSessionId,
      content: '帮我做个可编辑的 PPT',
      messageContent: '帮我做个可编辑的 PPT',
      userContent: undefined,
      attachments: {
        files: [{ name: 'outline.md', path: 'D:/repo/outline.md', isFolder: false }],
        images: [],
      },
      at: Date.now() - 1000,
    })
  }

  it('sends the held message into the freshly bound assistant session', async () => {
    const { default: ChatPanel } = await import('../ChatPanel.vue')
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const { useTurnStore } = await import('@/stores/turn')
    const { useAppStore } = await import('@/stores/app')

    const appStore = useAppStore()
    appStore.mode = 'work'
    appStore.setWorkWorkspace('D:/repo')
    appStore.projectRoot = 'D:/repo'

    const store = useChatSessionStore()
    const source = store.createSession('新对话', 'D:/repo')
    await holdMessageFrom(source.id)

    // 画廊点选 → startWorkAssistantSession 创建的新会话
    const picked = store.createSession('ppt-creator', 'D:/repo')
    picked.assistantId = 'ppt-creator'
    store.selectSession(picked.id)

    const turnStore = useTurnStore()
    const sendMessage = vi.spyOn(turnStore, 'sendMessage').mockResolvedValue(undefined)

    shallowMount(ChatPanel, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(sendMessage).toHaveBeenCalledWith(
      '帮我做个可编辑的 PPT',
      undefined,
      expect.objectContaining({
        files: [expect.objectContaining({ path: 'D:/repo/outline.md' })],
        images: [],
      }),
    )
    expect(store.pendingWorkFirstMessage).toBeNull()
  }, 30000)

  it('clears the held message when the gallery is closed without picking', async () => {
    const { default: ChatPanel } = await import('../ChatPanel.vue')
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const { useTurnStore } = await import('@/stores/turn')
    const { useAppStore } = await import('@/stores/app')

    const appStore = useAppStore()
    appStore.mode = 'work'
    appStore.setWorkWorkspace('D:/repo')
    appStore.projectRoot = 'D:/repo'

    const store = useChatSessionStore()
    const source = store.createSession('新对话', 'D:/repo')
    await holdMessageFrom(source.id)

    const turnStore = useTurnStore()
    const sendMessage = vi.spyOn(turnStore, 'sendMessage').mockResolvedValue(undefined)

    shallowMount(ChatPanel, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(sendMessage).not.toHaveBeenCalled()
    expect(store.pendingWorkFirstMessage).toBeNull()
  }, 30000)

  it('does not replay a stale held message into an unrelated empty assistant session', async () => {
    const { default: ChatPanel } = await import('../ChatPanel.vue')
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const { useTurnStore } = await import('@/stores/turn')
    const { useAppStore } = await import('@/stores/app')

    const appStore = useAppStore()
    appStore.mode = 'work'
    appStore.setWorkWorkspace('D:/repo')
    appStore.projectRoot = 'D:/repo'

    const store = useChatSessionStore()
    const source = store.createSession('新对话', 'D:/repo')
    // 旧会话：创建时间早于扣住时刻，不属于本次点选
    const oldBound = store.createSession('docx-writer', 'D:/repo')
    oldBound.assistantId = 'docx-writer'
    oldBound.createdAt = Date.now() - 10_000
    await holdMessageFrom(source.id)
    store.selectSession(oldBound.id)

    const turnStore = useTurnStore()
    const sendMessage = vi.spyOn(turnStore, 'sendMessage').mockResolvedValue(undefined)

    shallowMount(ChatPanel, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(sendMessage).not.toHaveBeenCalled()
    expect(store.pendingWorkFirstMessage).toBeNull()
  }, 30000)
})
