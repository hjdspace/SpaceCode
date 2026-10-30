/**
 * 会话寻址的聊天动作（issue 09）。
 *
 * 接管面板用 `<ChatPanel :session-id compact>` 复用现有聊天链路，此时面板显示的
 * 会话并不是 currentSessionId。凡是回落到「当前会话」默认值的应答，都会把权限
 * 答复送到用户正在看的另一个会话上，接管会话里的引擎则永远等不到 control_response。
 */
import { defineComponent, nextTick } from 'vue'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { claudeCodeApi } = vi.hoisted(() => ({
  claudeCodeApi: {
    allowPermission: vi.fn().mockResolvedValue(undefined),
    denyPermission: vi.fn().mockResolvedValue(undefined),
  },
}))

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
    tm: () => undefined,
  }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      ...claudeCodeApi,
      onStreamEvent: () => () => {},
      onAssistant: () => () => {},
      onToolUse: () => () => {},
      onToolResult: () => () => {},
      onUser: () => () => {},
      onSystem: () => () => {},
      onResult: () => () => {},
      onExit: () => () => {},
      onError: () => () => {},
    },
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
    artifacts: { list: vi.fn().mockResolvedValue({ artifacts: [] }) },
  },
}))

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn().mockResolvedValue(undefined),
  updateConfig: vi.fn(),
  llmState: { provider: { value: 'anthropic' }, isConfigured: { value: true } },
}))

vi.mock('@/services/h5ApiClient', () => ({ isH5Mode: () => false }))
vi.mock('@/composables/useChatCommands', () => ({ useChatCommands: () => ({ executeCommand: vi.fn() }) }))
vi.mock('@/composables/useWorkRouter', () => ({ useWorkRouter: () => ({ route: vi.fn(() => ({ type: 'none' })) }) }))
vi.mock('@/utils/recentProjectRoots', () => ({ pathsEqual: (a: string, b: string) => a === b }))
vi.mock('@/components/chat/MessageList.vue', () => ({ default: MessageListStub }))

const componentStub = { template: '<div />' }

vi.mock('@/components/chat/RecommendedPrompts.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/WelcomeHero.vue', () => ({ default: componentStub }))
vi.mock('@/components/work/WorkAssistantShortcuts.vue', () => ({ default: componentStub }))
vi.mock('@/components/work/WorkAssistantPicker.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/TeamStatusBar.vue', () => ({ default: componentStub }))
vi.mock('@/components/chat/TeammateTranscriptHeader.vue', () => ({ default: componentStub }))
const ChatInputStub = defineComponent({
  name: 'ChatInput',
  template: '<div data-test="chat-input" />',
})

vi.mock('@/components/chat/ChatInput.vue', () => ({ default: ChatInputStub }))
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

const PANEL_SESSION = 'fac-run-1-bl-1-takeover'

describe('ChatPanel with an explicit session', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `uuid-${Math.random().toString(36).slice(2)}`) })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
  })

  /** 面板会话挂着一个待确认权限，而用户当前看的是另一条会话。 */
  async function mountPanelChat() {
    const { useChatSessionStore } = await import('@/stores/chatSession')
    const { useAppStore } = await import('@/stores/app')
    const { permissionService } = await import('@/services/permissionService')
    const sessionStore = useChatSessionStore()
    const appStore = useAppStore()
    // 没有项目根的会话会整片换成「无项目」欢迎页，MessageList 就不在树里了。
    appStore.projectRoot = 'D:/repo'
    const main = sessionStore.createSession('主会话', 'D:/repo')
    sessionStore.createSession('接管 · 登录态在刷新后丢失', 'D:/repo', PANEL_SESSION, { activate: false })
    permissionService.addPermissionRequest(PANEL_SESSION, {
      sessionId: PANEL_SESSION,
      requestId: 'req-1',
      toolName: 'Bash',
      toolUseId: 'tool-1',
      input: { command: 'npm run test:changed' },
    })

    const { default: ChatPanel } = await import('../ChatPanel.vue')
    const wrapper = shallowMount(ChatPanel, {
      props: { sessionId: PANEL_SESSION, compact: true },
      global: { plugins: [pinia] },
    })
    await nextTick()
    return { wrapper, main, sessionStore }
  }

  it('批准面板会话里的权限请求，而不是当前会话', async () => {
    const { wrapper, main, sessionStore } = await mountPanelChat()

    wrapper.findComponent(MessageListStub).vm.$emit('tool-submit', 'msg-1', 'tool-1', { answers: {} })
    await nextTick()

    expect(claudeCodeApi.allowPermission).toHaveBeenCalled()
    expect(claudeCodeApi.allowPermission.mock.calls[0][0]).toBe(PANEL_SESSION)
    expect(claudeCodeApi.allowPermission.mock.calls[0][1]).toBe('req-1')
    // 应答不改变用户正在看的会话。
    expect(sessionStore.currentSessionId).toBe(main.id)
  })

  it('面板里发送的消息进入接管会话', async () => {
    const { wrapper } = await mountPanelChat()
    const { useTurnStore } = await import('@/stores/turn')
    const turnStore = useTurnStore()
    const sent = vi.spyOn(turnStore, 'sendMessage').mockResolvedValue(undefined as never)

    wrapper.findComponent(ChatInputStub).vm.$emit('send', '先别动 auth store', { files: [], images: [] })
    await nextTick()

    expect(sent).toHaveBeenCalled()
    expect(sent.mock.calls[0][3]).toMatchObject({ sessionId: PANEL_SESSION })
  })

  it('跳过面板会话里的权限请求，同样定位到面板自己的会话', async () => {
    const { wrapper } = await mountPanelChat()

    wrapper.findComponent(MessageListStub).vm.$emit('tool-skip', 'msg-1', 'tool-1')
    await nextTick()

    expect(claudeCodeApi.denyPermission).toHaveBeenCalled()
    expect(claudeCodeApi.denyPermission.mock.calls[0][0]).toBe(PANEL_SESSION)
    expect(claudeCodeApi.denyPermission.mock.calls[0][1]).toBe('req-1')
  })
})
