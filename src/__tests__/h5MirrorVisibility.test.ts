import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const wsHandlers = new Map<string, (event: { sessionId: string; data: any }) => void>()

const componentStub = { template: '<div />' }

vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn().mockResolvedValue(undefined),
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,test'),
  },
}))

vi.mock('@/composables/useShortcuts', () => ({
  useShortcuts: () => ({ register: vi.fn() }),
}))

vi.mock('@/composables/useOpenProjectWorkflow', () => ({
  useOpenProjectWorkflow: () => ({ openProjectByPath: vi.fn() }),
}))

vi.mock('@/composables/useResizablePanel', () => ({
  useResizablePanel: () => ({
    size: 300,
    isResizing: false,
    onMousedown: vi.fn(),
  }),
}))

vi.mock('@/components/layout/TitleBar.vue', () => ({ default: componentStub }))
vi.mock('@/components/layout/Sidebar.vue', () => ({ default: componentStub }))
vi.mock('@/components/layout/SplitContainer.vue', () => ({ default: componentStub }))
vi.mock('@/components/design/DesignPage.vue', () => ({ default: componentStub }))
vi.mock('@/components/layout/InfoPanel.vue', () => ({ default: componentStub }))
vi.mock('@/components/terminal/TerminalTabBar.vue', () => ({ default: componentStub }))
vi.mock('@/components/terminal/TerminalPanel.vue', () => ({ default: componentStub }))
vi.mock('@/components/debug/TraceViewer.vue', () => ({ default: componentStub }))
vi.mock('@/components/settings/SettingsPanel.vue', () => ({ default: componentStub }))
vi.mock('@/components/skills/SkillsManager.vue', () => ({ default: componentStub }))
vi.mock('@/components/agents/AgentManager.vue', () => ({ default: componentStub }))
vi.mock('@/components/mcp/McpManager.vue', () => ({ default: componentStub }))
vi.mock('@/components/cron/CronManager.vue', () => ({ default: componentStub }))
vi.mock('@/components/work/WorkAssistantGallery.vue', () => ({ default: componentStub }))
vi.mock('@/components/work/WorkspaceOnboarding.vue', () => ({ default: componentStub }))
vi.mock('@/components/mobile/ConnectMobileDialog.vue', () => ({ default: componentStub }))
vi.mock('@/components/layout/FileQuickOpen.vue', () => ({ default: componentStub }))
vi.mock('@/components/common/DialogProvider.vue', () => ({ default: componentStub }))

vi.mock('@/services/h5ApiClient', () => ({
  isH5Mode: () => true,
  h5ApiClient: {
    listProjectSessions: vi.fn().mockResolvedValue([]),
    restoreSession: vi.fn().mockResolvedValue({ messages: [] }),
    setMirrorSession: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

vi.mock('@/services/h5Bootstrap', () => ({
  getCachedDesktopConfig: () => ({
    guiSettings: null,
    mirrorSessionId: 'session-old',
    mirrorProjectPath: 'D:/repo',
    activeSessions: [],
  }),
}))

vi.mock('@/services/h5WebSocketClient', () => ({
  h5WebSocketClient: {
    on: vi.fn((eventType: string, callback: (event: { sessionId: string; data: any }) => void) => {
      wsHandlers.set(eventType, callback)
      return () => {}
    }),
  },
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: null,
    h5Access: null,
    image: null,
    trace: { event: vi.fn() },
    getCwd: vi.fn().mockResolvedValue('D:/repo'),
    getAppVersion: vi.fn().mockResolvedValue('0.0.0'),
    onMenuOpenFolder: vi.fn(),
    onMenuCloseFolder: vi.fn(),
    getAppState: vi.fn().mockResolvedValue({ sessions: [], currentSessionId: null, theme: 'dark' }),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
  },
}))

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0))

describe('H5 mirror visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wsHandlers.clear()
    localStorage.clear()
    window.history.replaceState({}, '', '/?token=h5_testtoken1234567890')
    setActivePinia(createPinia())
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(36).slice(2)}`),
    })
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    localStorage.setItem('app_split_layout', JSON.stringify({
      type: 'leaf',
      id: 'pane-old',
      content: { kind: 'session', tabId: 'session-old' },
    }))
  })

  it('reveals the desktop mirror session in the active tab and pane when session_changed arrives', async () => {
    const { default: App } = await import('@/App.vue')
    const { useAppStore } = await import('@/stores/app')
    const { useChatSessionStore } = await import('@/stores/chat')
    const { useSplitLayoutStore } = await import('@/stores/splitLayout')

    mount(App, {
      global: {
        stubs: {
          TitleBar: true,
          Sidebar: true,
          SplitContainer: true,
          DesignPage: true,
          InfoPanel: true,
          TerminalTabBar: true,
          TerminalPanel: true,
          TraceViewer: true,
          SettingsPanel: true,
          SkillsManager: true,
          AgentManager: true,
          McpManager: true,
          CronManager: true,
          WorkAssistantGallery: true,
          WorkspaceOnboarding: true,
          ConnectMobileDialog: true,
          FileQuickOpen: true,
          DialogProvider: true,
        },
      },
    })

    await flushPromises()
    wsHandlers.get('session_changed')?.({
      sessionId: '',
      data: { sessionId: 'session-new', projectPath: 'D:/repo' },
    })
    await flushPromises()

    const appStore = useAppStore()
    const sessionStore = useChatSessionStore()
    const splitLayout = useSplitLayoutStore()

    expect(sessionStore.currentSessionId).toBe('session-new')
    expect(appStore.activeCenterTab).toBe('session-session-new')
    expect(splitLayout.activePane?.content).toEqual({
      kind: 'session',
      tabId: 'session-session-new',
    })
  })
})
