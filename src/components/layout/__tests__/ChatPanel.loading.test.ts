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
  useI18n: () => ({ t: (key: string) => key }),
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
vi.mock('@/components/work/WorkAssistantShortcuts.vue', () => ({ default: componentStub }))
vi.mock('@/components/work/WorkAssistantPicker.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/TeamStatusBar.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/TeammateTranscriptHeader.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/ChatInput.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/SessionTabBar.vue', () => ({ default: componentStub }))
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
    const { useChatSessionStore, useTurnStore } = await import('@/stores/chat')
    const { useAppStore } = await import('@/stores/app')

    const sessionStore = useChatSessionStore()
    const turnStore = useTurnStore()
    const appStore = useAppStore()

    const session = sessionStore.createSession('Test', 'D:/repo', 'sess-loading')
    sessionStore.selectSession(session.id)
    appStore.projectRoot = 'D:/repo'
    sessionStore.addMessage({ role: 'user', content: 'hello' }, session.id)
    const ts = (turnStore as any).beginTurn(session.id, { isAutonomous: false })

    const wrapper = shallowMount(ChatPanel, {
      props: { sessionId: session.id },
      global: {
        plugins: [pinia],
      },
    })
    await nextTick()

    expect(wrapper.findComponent(MessageListStub).props('loading')).toBe(true)

    ;(turnStore as any).endTurn(session.id, ts)
  })
})
