/**
 * app store 的 webview / 终端面板 / 中心标签行为契约：
 *
 * 1. normalizeWebUrl 补全协议：localhost / 127.0.0.1 / 内网 IP 默认 http，
 *    其余默认 https；已带协议（http/https/file）原样保留。
 * 2. openFileInWebview 优先走本地预览服务（api.preview.getUrl），拿不到时回退
 *    file:// 协议（Windows 路径先归一为正斜杠，非 / 开头补 file:///）。
 * 3. webview 历史栈：navigate 截断前进分支再追加；goBack/goForward 受边界约束。
 * 4. 终端停靠面板：展开时无标签自动建一个；所有终端标签关闭后自动收起并卸载；
 *    高度钳制在 [80, 500]。
 * 5. closeCenterTab：非 closable（chat）不可关；terminal-* tab 连带
 *    terminalStore.closeTab；分屏 leaves 同步清理（clearLeavesForTab）。
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { nextTick, reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const probe = vi.hoisted(() => ({
  api: {
    cron: { setProjectRoot: vi.fn() },
    readFile: vi.fn(),
    preview: { getUrl: vi.fn() },
  },
  session: null as any,
  terminal: null as any,
  split: null as any,
  termCount: 0,
}))

vi.mock('@/services/electronAPI', () => ({ api: probe.api }))

vi.mock('../chatSession', () => ({
  useChatSessionStore: () => probe.session,
}))

vi.mock('../terminal', () => ({
  useTerminalStore: () => probe.terminal,
}))

vi.mock('../splitLayout', () => ({
  useSplitLayoutStore: () => probe.split,
}))

vi.mock('@/i18n', () => ({
  i18n: { global: { t: (key: string) => key } },
}))

import { useAppStore } from '../app'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  probe.termCount = 0
  probe.api.cron.setProjectRoot.mockClear()
  probe.api.readFile.mockReset().mockResolvedValue('content')
  probe.api.preview.getUrl.mockReset().mockResolvedValue(null)
  probe.session = reactive({
    currentSessionId: 'main-session' as string | null,
    workingDirectory: '',
    currentProjectRoot: '',
    createSession: vi.fn(() => ({ id: `eph-${probe.termCount + 1}` })),
    deleteSession: vi.fn(),
  })
  probe.terminal = reactive({
    tabs: [] as Array<{ id: string; label: string }>,
    createTab: vi.fn(() => {
      const id = `terminal-${++probe.termCount}`
      probe.terminal.tabs.push({ id, label: `Terminal ${probe.termCount}` })
      return id
    }),
    closeTab: vi.fn(),
  })
  probe.split = { clearLeavesForTab: vi.fn() }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('normalizeWebUrl 协议补全', () => {
  it('已带协议的 URL 原样保留', () => {
    const store = useAppStore()
    expect(store.openWebview('http://a.dev/')).toBeUndefined()
    expect(store.webviewUrl).toBe('http://a.dev/')
    store.closeWebview()
    store.openWebview('https://a.dev/')
    expect(store.webviewUrl).toBe('https://a.dev/')
    store.closeWebview()
    store.openWebview('file:///x/y.html')
    expect(store.webviewUrl).toBe('file:///x/y.html')
  })

  it('本机/内网地址补 http，其余补 https，前后空白先去除', () => {
    const store = useAppStore()
    const cases: Array<[string, string]> = [
      ['localhost:3000/app', 'http://localhost:3000/app'],
      ['127.0.0.1:8080', 'http://127.0.0.1:8080'],
      ['192.168.1.5/page', 'http://192.168.1.5/page'],
      ['example.com', 'https://example.com'],
      ['  example.com  ', 'https://example.com'],
    ]
    for (const [input, expected] of cases) {
      store.closeWebview()
      store.openWebview(input)
      expect(store.webviewUrl, input).toBe(expected)
    }
  })
})

describe('openWebview / openFileInWebview', () => {
  it('openWebview：新 tab 初始化历史栈；同 URL 去重激活', () => {
    const store = useAppStore()
    store.openWebview('example.com')
    expect(store.activeInfoTabId).toBe('webview::https://example.com')
    expect(store.webviewHistory).toEqual(['https://example.com'])
    expect(store.currentHistoryIndex).toBe(0)
    store.openWebview('example.com')
    expect(store.infoPanelTabs.filter((t) => t.type === 'webview')).toHaveLength(1)
  })

  it('openFileInWebview：预览服务可用时直接用其 URL', async () => {
    const store = useAppStore()
    probe.api.preview.getUrl.mockResolvedValue('http://127.0.0.1:9527/preview/a.html')
    await store.openFileInWebview('C:\\out\\a.html')
    expect(probe.api.preview.getUrl).toHaveBeenCalledWith('C:\\out\\a.html')
    expect(store.webviewUrl).toBe('http://127.0.0.1:9527/preview/a.html')
  })

  it('openFileInWebview：预览服务不可用时回退 file://（Windows 路径归一）', async () => {
    const store = useAppStore()
    probe.api.preview.getUrl.mockResolvedValue(null)
    await store.openFileInWebview('C:\\out\\a.html')
    expect(store.webviewUrl).toBe('file:///C:/out/a.html')

    store.closeWebview()
    await store.openFileInWebview('/srv/out/b.html')
    expect(store.webviewUrl).toBe('file:///srv/out/b.html')
  })

  it('openFileInWebview：不再把整个项目根交给预览服务', async () => {
    const store = useAppStore()
    store.setProjectRoot('/root')
    probe.api.preview.getUrl.mockResolvedValue(null)
    await store.openFileInWebview('/a.html')
    expect(probe.api.preview.getUrl).toHaveBeenCalledWith('/a.html')
  })
})

describe('webview 历史栈', () => {
  async function openTwoPages(store: ReturnType<typeof useAppStore>) {
    store.openWebview('u1.dev')
    store.navigateWebview('u2.dev')
  }

  it('navigateWebview：截断前进分支再追加，更新 index 与 url', async () => {
    const store = useAppStore()
    await openTwoPages(store)
    store.goBackWebview()
    store.navigateWebview('u3.dev')
    expect(store.webviewHistory).toEqual(['https://u1.dev', 'https://u3.dev'])
    expect(store.currentHistoryIndex).toBe(1)
    expect(store.webviewUrl).toBe('https://u3.dev')
  })

  it('navigateWebview：激活 tab 不是 webview 时不动历史', () => {
    const store = useAppStore()
    store.setCurrentFile({ path: 'a.ts', name: 'a.ts', content: '', language: 'typescript' })
    store.navigateWebview('u2.dev')
    expect(store.infoPanelTabs.filter((t) => t.type === 'webview')).toHaveLength(0)
  })

  it('goBack/goForward 受历史边界约束', async () => {
    const store = useAppStore()
    await openTwoPages(store)
    expect(store.currentHistoryIndex).toBe(1)
    store.goBackWebview()
    expect(store.webviewUrl).toBe('https://u1.dev')
    store.goBackWebview()
    expect(store.currentHistoryIndex).toBe(0)
    store.goForwardWebview()
    expect(store.webviewUrl).toBe('https://u2.dev')
    store.goForwardWebview()
    expect(store.currentHistoryIndex).toBe(1)
  })

  it('closeWebview：关闭激活 webview tab；非 webview 激活时不动 tabs', () => {
    const store = useAppStore()
    store.openWebview('u1.dev')
    store.closeWebview()
    expect(store.infoPanelTabs).toHaveLength(0)

    store.setCurrentFile({ path: 'a.ts', name: 'a.ts', content: '', language: 'typescript' })
    store.closeWebview()
    expect(store.infoPanelTabs).toHaveLength(1)
  })

  it('setWebviewTitle：更新 data.title 与 tab.title；空标题保留 tab.title', () => {
    const store = useAppStore()
    store.openWebview('u1.dev')
    store.setWebviewTitle('Doc Site')
    expect(store.webviewTitle).toBe('Doc Site')
    expect(store.activeInfoTab?.title).toBe('Doc Site')

    store.setWebviewTitle('')
    expect(store.webviewTitle).toBe('')
    expect(store.activeInfoTab?.title).toBe('Doc Site')
  })

  it('setWebviewTitle：激活 tab 非 webview 时无操作；setWebviewLoading 切 isLoading', () => {
    const store = useAppStore()
    store.setCurrentFile({ path: 'a.ts', name: 'a.ts', content: '', language: 'typescript' })
    expect(() => store.setWebviewTitle('x')).not.toThrow()
    expect(store.activeInfoTab?.title).toBe('a.ts')

    store.setWebviewLoading(true)
    expect(store.isLoading).toBe(true)
    store.setWebviewLoading(false)
    expect(store.isLoading).toBe(false)
  })
})

describe('终端停靠面板', () => {
  it('createTerminalTab 的 cwd：会话目录 > 项目根 > work 工作区 > undefined', () => {
    const store = useAppStore()
    store.createTerminalTab()
    expect(probe.terminal.createTab).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: undefined }))
    store.setWorkWorkspace('/ww')
    store.createTerminalTab()
    expect(probe.terminal.createTab).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: '/ww' }))
    store.setProjectRoot('/root')
    store.createTerminalTab()
    expect(probe.terminal.createTab).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: '/root' }))
    probe.session.workingDirectory = '/sess'
    store.createTerminalTab()
    expect(probe.terminal.createTab).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: '/sess' }))
  })

  it('toggleTerminalDock：无标签时自动建一个，再展开；收起只藏不卸载', () => {
    const store = useAppStore()
    store.toggleTerminalDock()
    expect(probe.terminal.createTab).toHaveBeenCalledTimes(1)
    expect(store.terminalDockVisible).toBe(true)
    expect(store.terminalDockMounted).toBe(true)

    store.toggleTerminalDock()
    expect(store.terminalDockVisible).toBe(false)
    expect(store.terminalDockMounted).toBe(true)

    store.toggleTerminalDock()
    expect(probe.terminal.createTab).toHaveBeenCalledTimes(1)
    expect(store.terminalDockVisible).toBe(true)
  })

  it('所有终端标签关闭后自动收起并卸载停靠面板', async () => {
    const store = useAppStore()
    store.toggleTerminalDock()
    await nextTick()
    expect(store.terminalDockVisible).toBe(true)
    probe.terminal.tabs.splice(0)
    await nextTick()
    expect(store.terminalDockVisible).toBe(false)
    expect(store.terminalDockMounted).toBe(false)
  })

  it('setTerminalDockHeight 钳制在 [80, 500]', () => {
    const store = useAppStore()
    store.setTerminalDockHeight(50)
    expect(store.terminalDockHeight).toBe(80)
    store.setTerminalDockHeight(1000)
    expect(store.terminalDockHeight).toBe(500)
    store.setTerminalDockHeight(300)
    expect(store.terminalDockHeight).toBe(300)
  })
})

describe('终端中心标签', () => {
  it('createTerminalTab：显式 cwd 优先，否则用生效工作目录', () => {
    const store = useAppStore()
    store.createTerminalTab({ cwd: '/given' })
    expect(probe.terminal.createTab).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/given' }))

    store.setProjectRoot('/root')
    store.createTerminalTab()
    expect(probe.terminal.createTab).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: '/root' }))
  })

  it('openTerminalTab：关闭遮挡视图、加中心标签并激活', () => {
    const store = useAppStore()
    store.toggleSettings()
    expect(store.showSettings).toBe(true)
    store.openTerminalTab('npm test')
    expect(store.showSettings).toBe(false)
    const terminalId = `terminal-${probe.termCount}`
    expect(store.centerTabs.map((t) => t.id)).toContain(terminalId)
    expect(store.activeCenterTab).toBe(terminalId)
    expect(probe.terminal.createTab).toHaveBeenCalledWith(expect.objectContaining({ autoCommand: 'npm test' }))
  })

  it('openTerminalTab：终端标签创建失败时不加中心标签', () => {
    const store = useAppStore()
    probe.terminal.createTab.mockImplementationOnce(() => null)
    store.openTerminalTab()
    expect(store.activeCenterTab).toBe('chat')
    expect(store.centerTabs).toHaveLength(1)
  })

  it('openOrchestrationTab：重复调用激活既有编排标签', () => {
    const store = useAppStore()
    store.openOrchestrationTab()
    const first = store.activeCenterTab
    expect(first).toMatch(/^orchestration-/)
    store.openOrchestrationTab()
    expect(store.activeCenterTab).toBe(first)
    expect(store.centerTabs.filter((t) => t.id.startsWith('orchestration-'))).toHaveLength(1)
  })

  it('closeCenterTab：chat 不可关闭；terminal-* 连带关终端标签并清理分屏', () => {
    const store = useAppStore()
    store.closeCenterTab('chat')
    expect(store.centerTabs.map((t) => t.id)).toContain('chat')

    store.openTerminalTab()
    const terminalId = `terminal-${probe.termCount}`
    store.closeCenterTab(terminalId)
    expect(probe.terminal.closeTab).toHaveBeenCalledWith(terminalId)
    expect(probe.split.clearLeavesForTab).toHaveBeenCalledWith(terminalId)
    expect(store.centerTabs.map((t) => t.id)).not.toContain(terminalId)
    expect(store.activeCenterTab).toBe('chat')
  })

  it('closeCenterTab：关闭非激活 tab 不改激活；未知 id 无操作', () => {
    const store = useAppStore()
    store.openOrchestrationTab()
    const orch = store.activeCenterTab as string
    store.openOrchestrationTab()
    store.closeCenterTab('ghost-id')
    expect(store.centerTabs.map((t) => t.id)).toContain(orch)

    store.closeCenterTab(orch)
    expect(probe.terminal.closeTab).not.toHaveBeenCalledWith(orch)
    expect(store.activeCenterTab).toBe('chat')
    expect(probe.split.clearLeavesForTab).toHaveBeenCalledWith(orch)
  })
})
