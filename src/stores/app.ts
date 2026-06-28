import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import { MessageSquare, Terminal as TerminalIcon, FileCode, FileText, FileDiff, Globe, TextSearch, Package } from 'lucide-vue-next'
import { useChatStore } from './chat'
import { useTerminalStore } from './terminal'
import { useSplitLayoutStore } from './splitLayout'
import { api } from '@/services/electronAPI'

export interface FileInfo {
  path: string
  name: string
  content: string
  language: string
}

export interface ToolDiffData {
  type: 'edit' | 'write' | 'read' | 'webfetch' | 'grep'
  filePath: string
  originalContent: string
  modifiedContent: string
  toolCallId: string
  language: string
  displayContent?: string
  searchQuery?: string
  actionCompleted?: boolean
}

export interface WebviewTabData {
  url: string
  history: string[]
  historyIndex: number
  title: string
}

export interface ScmDiffTabData {
  filePath: string
  staged: boolean
}

/** 由工作台(截图/框选)推送到聊天输入框的内容载荷 */
export interface InputInjectPayload {
  /** 追加到输入框的文字(如结构化改稿描述) */
  text?: string
  /** 图片附件(复用聊天输入框的 ImageAttachment 结构) */
  image?: {
    id: string
    name: string
    type: 'image'
    mimeType: string
    previewUrl: string
    data: string
  }
}

export type InfoPanelTabType = 'file' | 'markdown' | 'diff' | 'tool-diff' | 'webview' | 'terminal' | 'artifacts' | 'office-preview'

export interface InfoPanelTab {
  id: string
  type: InfoPanelTabType
  title: string
  icon: any
  data: FileInfo | ToolDiffData | WebviewTabData | ScmDiffTabData | null
  closeable: boolean
}

export interface CenterTab {
  id: string
  label: string
  icon: any
  closable: boolean
  sessionId?: string
}

const PROJECT_ROOT_STORAGE_KEY = 'app_project_root'
const SHOW_HIDDEN_FILES_STORAGE_KEY = 'app_show_hidden_files'
const MODE_STORAGE_KEY = 'app_mode'
const WORK_WORKSPACE_STORAGE_KEY = 'app_work_workspace'
const WORK_WORKSPACE_CONFIRMED_STORAGE_KEY = 'app_work_workspace_confirmed'

/** 工作模式：code = 编码模式（默认）；work = 办公助手模式 */
export type AppMode = 'work' | 'code'

export type ThemeId = 'light' | 'dark' | 'anthropic' | 'anthropic-dark'

export const THEME_CYCLE: ThemeId[] = ['light', 'dark', 'anthropic', 'anthropic-dark']

export const useAppStore = defineStore('app', () => {
  const theme = ref<ThemeId>('light')
  const sidebarCollapsed = ref(false)
  const infoPanelVisible = ref(false)
  // 右侧面板「启动器」状态：为真时面板显示 4 个工具入口，而非具体标签内容
  const panelHome = ref(false)
  // 文件模糊搜索快速打开弹窗
  const showFileQuickOpen = ref(false)
  const completedToolActions = ref<Set<string>>(new Set())
  const currentLine = ref<number>(0)
  const currentEndLine = ref<number>(0)
  const centerTabs = ref<CenterTab[]>([
    { id: 'chat', label: 'Chat', icon: markRaw(MessageSquare), closable: false }
  ])
  const activeCenterTab = ref<string>('chat')

  const infoPanelTabs = ref<InfoPanelTab[]>([])
  const activeInfoTabId = ref<string | null>(null)
  const isLoading = ref<boolean>(false)

  // 工作台 -> 输入框 的一次性注入载荷(截图/框选元素整合)。
  // ChatInput 监听该值, 消费后置空。
  const pendingInputInjection = ref<InputInjectPayload | null>(null)

  let _initialProjectRoot = ''
  try {
    _initialProjectRoot = localStorage.getItem(PROJECT_ROOT_STORAGE_KEY) || ''
  } catch { /* ignore */ }
  const projectRoot = ref<string>(_initialProjectRoot)

  let _initialShowHiddenFiles = false
  try {
    _initialShowHiddenFiles = localStorage.getItem(SHOW_HIDDEN_FILES_STORAGE_KEY) === 'true'
  } catch { /* ignore */ }
  const showHiddenFiles = ref<boolean>(_initialShowHiddenFiles)

  // ── Work / Code 模式状态 ──────────────────────────────
  let _initialMode: AppMode = 'code'
  try {
    _initialMode = localStorage.getItem(MODE_STORAGE_KEY) === 'work' ? 'work' : 'code'
  } catch { /* ignore */ }
  const mode = ref<AppMode>(_initialMode)

  let _initialWorkWorkspace = ''
  try {
    _initialWorkWorkspace = localStorage.getItem(WORK_WORKSPACE_STORAGE_KEY) || ''
  } catch { /* ignore */ }
  const workWorkspace = ref<string>(_initialWorkWorkspace)

  let _initialWorkConfirmed = false
  try {
    _initialWorkConfirmed = localStorage.getItem(WORK_WORKSPACE_CONFIRMED_STORAGE_KEY) === 'true'
  } catch { /* ignore */ }
  const workWorkspaceConfirmed = ref<boolean>(_initialWorkConfirmed)

  const showSkillsManager = ref(false)
  const showTraceViewer = ref(false)
  const showSettings = ref(false)
  const showMCPManager = ref(false)
  const showAgentManager = ref(false)
  const showConnectMobile = ref(false)
  const showCronManager = ref(false)
  // Work 模式：专业助手画廊 / 工作区引导
  const showWorkGallery = ref(false)
  const showWorkOnboarding = ref(false)

  // ── Office 文件预览状态 ──
  const officePreviewFile = ref<string>('')
  const officePreviewMode = ref<'html' | 'screenshots' | 'watch'>('html')

  const activeInfoTab = computed<InfoPanelTab | null>(() => {
    if (!activeInfoTabId.value) return null
    return infoPanelTabs.value.find(t => t.id === activeInfoTabId.value) || null
  })

  const infoPanelMode = computed<InfoPanelTabType>(() => {
    return activeInfoTab.value?.type ?? 'file'
  })

  const currentFile = computed<FileInfo | null>(() => {
    const tab = activeInfoTab.value
    if (tab && (tab.type === 'file' || tab.type === 'markdown')) {
      return tab.data as FileInfo
    }
    return null
  })

  const toolDiffData = computed<ToolDiffData | null>(() => {
    const tab = activeInfoTab.value
    if (tab && tab.type === 'tool-diff') {
      return tab.data as ToolDiffData
    }
    return null
  })

  const webviewUrl = computed<string>(() => {
    const tab = activeInfoTab.value
    if (tab && tab.type === 'webview') {
      return (tab.data as WebviewTabData).url
    }
    return ''
  })

  const webviewHistory = computed<string[]>(() => {
    const tab = activeInfoTab.value
    if (tab && tab.type === 'webview') {
      return (tab.data as WebviewTabData).history
    }
    return []
  })

  const currentHistoryIndex = computed<number>(() => {
    const tab = activeInfoTab.value
    if (tab && tab.type === 'webview') {
      return (tab.data as WebviewTabData).historyIndex
    }
    return -1
  })

  const webviewTitle = computed<string>(() => {
    const tab = activeInfoTab.value
    if (tab && tab.type === 'webview') {
      return (tab.data as WebviewTabData).title
    }
    return ''
  })

  const isDark = computed(() => theme.value === 'dark' || theme.value === 'anthropic-dark')

  function toggleTheme() {
    const currentIndex = THEME_CYCLE.indexOf(theme.value)
    const nextIndex = (currentIndex + 1) % THEME_CYCLE.length
    theme.value = THEME_CYCLE[nextIndex]
    document.documentElement.setAttribute('data-theme', theme.value)
  }

  function setTheme(newTheme: ThemeId) {
    theme.value = newTheme
    document.documentElement.setAttribute('data-theme', newTheme)
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function toggleShowHiddenFiles() {
    showHiddenFiles.value = !showHiddenFiles.value
    try {
      localStorage.setItem(SHOW_HIDDEN_FILES_STORAGE_KEY, String(showHiddenFiles.value))
    } catch { /* ignore */ }
  }

  function toggleSettings() {
    showSettings.value = !showSettings.value
    if (showSettings.value) {
      showTraceViewer.value = false
    }
  }

  function openInfoTab(tab: InfoPanelTab) {
    panelHome.value = false
    const existing = infoPanelTabs.value.find(t => t.id === tab.id)
    if (existing) {
      activeInfoTabId.value = existing.id
      infoPanelVisible.value = true
      return
    }
    infoPanelTabs.value.push(tab)
    activeInfoTabId.value = tab.id
    infoPanelVisible.value = true
  }

  function closeInfoTab(tabId: string) {
    const index = infoPanelTabs.value.findIndex(t => t.id === tabId)
    if (index === -1) return

    infoPanelTabs.value.splice(index, 1)

    if (activeInfoTabId.value === tabId) {
      if (infoPanelTabs.value.length === 0) {
        activeInfoTabId.value = null
        infoPanelVisible.value = false
      } else {
        const nextIndex = Math.min(index, infoPanelTabs.value.length - 1)
        activeInfoTabId.value = infoPanelTabs.value[nextIndex].id
      }
    }
  }

  function closeAllInfoTabs() {
    infoPanelTabs.value = []
    activeInfoTabId.value = null
    infoPanelVisible.value = false
  }

  function showInfoPanel(mode: InfoPanelTabType) {
    if (activeInfoTab.value && activeInfoTab.value.type === mode) {
      infoPanelVisible.value = true
      return
    }
    infoPanelVisible.value = true
  }

  function hideInfoPanel() {
    closeAllInfoTabs()
  }

  // ── 底部终端面板（VSCODE 风格） ─────────────────────────────
  const terminalDockVisible = ref(false)
  const terminalDockHeight = ref(200)
  const TERMINAL_DOCK_MIN = 80
  const TERMINAL_DOCK_MAX = 500

  function toggleTerminalDock() {
    if (terminalDockVisible.value) {
      terminalDockVisible.value = false
    } else {
      // 确保至少有一个终端标签
      const terminalStore = useTerminalStore()
      if (terminalStore.tabs.length === 0) {
        terminalStore.createTab()
      }
      terminalDockVisible.value = true
    }
  }

  function setTerminalDockHeight(h: number) {
    terminalDockHeight.value = Math.min(Math.max(h, TERMINAL_DOCK_MIN), TERMINAL_DOCK_MAX)
  }

  /** 标题栏面板按钮：切换右侧面板显隐；打开时进入启动器 */
  function toggleInfoPanel() {
    if (infoPanelVisible.value) {
      infoPanelVisible.value = false
    } else {
      infoPanelVisible.value = true
      panelHome.value = true
    }
  }

  /** 回到右侧面板启动器（4 个工具入口） */
  function goPanelHome() {
    infoPanelVisible.value = true
    panelHome.value = true
  }

  /** 在右侧面板打开 Work 产物（Artifacts）面板 */
  function openArtifactsPanel() {
    openInfoTab({
      id: 'artifacts-panel',
      type: 'artifacts',
      title: 'Artifacts',
      icon: markRaw(Package),
      data: null,
      closeable: true
    })
  }

  /** 在右侧面板打开终端 */
  function openTerminalInPanel() {
    // 确保至少有一个终端标签存在
    const terminalStore = useTerminalStore()
    if (terminalStore.tabs.length === 0) {
      terminalStore.createTab()
    }
    openInfoTab({
      id: 'terminal-panel',
      type: 'terminal',
      title: 'Terminal',
      icon: markRaw(TerminalIcon),
      data: null,
      closeable: true
    })
  }

  /** 在右侧面板打开一个空白浏览器标签，用户在地址栏输入网址 */
  function openBlankWebview() {
    const tabId = 'webview::new'
    const existing = infoPanelTabs.value.find(t => t.id === tabId)
    if (existing) {
      panelHome.value = false
      activeInfoTabId.value = existing.id
      infoPanelVisible.value = true
      return
    }
    const webviewData: WebviewTabData = {
      url: '',
      history: [],
      historyIndex: -1,
      title: ''
    }
    openInfoTab({
      id: tabId,
      type: 'webview',
      title: 'New Tab',
      icon: markRaw(Globe),
      data: webviewData,
      closeable: true
    })
  }

  function showToolDiff(data: ToolDiffData) {
    if (completedToolActions.value.has(data.toolCallId)) {
      data.actionCompleted = true
    }
    const tabId = `tool-diff::${data.toolCallId}`
    const icon = data.type === 'grep' ? markRaw(TextSearch) : markRaw(FileDiff)
    openInfoTab({
      id: tabId,
      type: 'tool-diff',
      title: data.filePath,
      icon,
      data,
      closeable: true
    })
  }

  function markToolActionCompleted(toolCallId: string) {
    completedToolActions.value.add(toolCallId)
    const tab = infoPanelTabs.value.find(t => t.id === `tool-diff::${toolCallId}`)
    if (tab && tab.data) {
      (tab.data as ToolDiffData).actionCompleted = true
    }
  }

  function setCurrentFile(file: FileInfo | null) {
    if (!file) return
    const isMarkdown = file.language === 'markdown'
    const tabType: InfoPanelTabType = isMarkdown ? 'markdown' : 'file'
    const tabId = `${tabType}::${file.path}`
    const icon = isMarkdown ? markRaw(FileText) : markRaw(FileCode)
    openInfoTab({
      id: tabId,
      type: tabType,
      title: file.name,
      icon,
      data: file,
      closeable: true
    })
  }

  async function openFile(filePath: string, line?: number, endLine?: number) {
    if (!api.readFile) {
      console.error('[AppStore] readFile API not available')
      return
    }

    const resolvedPath = resolveFilePath(filePath)

    try {
      let content = await api.readFile(resolvedPath)
      if (content === null && resolvedPath !== filePath) {
        content = await api.readFile(filePath)
      }
      if (content !== null) {
        const fileName = resolvedPath.split(/[\\/]/).pop() || resolvedPath
        const language = getLanguageFromPath(resolvedPath)
        currentLine.value = line || 0
        currentEndLine.value = endLine || 0
        const isMarkdown = language === 'markdown'
        const tabType: InfoPanelTabType = isMarkdown && !line ? 'markdown' : 'file'
        const tabId = `${tabType}::${resolvedPath}`
        const icon = tabType === 'markdown' ? markRaw(FileText) : markRaw(FileCode)

        const existing = infoPanelTabs.value.find(t => t.id === tabId)
        if (existing) {
          existing.data = {
            path: resolvedPath,
            name: fileName,
            content: content,
            language: language
          }
          activeInfoTabId.value = existing.id
          infoPanelVisible.value = true
        } else {
          openInfoTab({
            id: tabId,
            type: tabType,
            title: fileName,
            icon,
            data: {
              path: resolvedPath,
              name: fileName,
              content: content,
              language: language
            },
            closeable: true
          })
        }
      } else {
        console.warn('[AppStore] Failed to open file (not found):', filePath)
      }
    } catch (error) {
      console.error('[AppStore] Failed to open file:', filePath, error)
    }
  }

  function resolveFilePath(filePath: string): string {
    const trimmed = filePath.trim()
    if (!trimmed) return trimmed
    const isAbsolute = /^([a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(trimmed)
    if (isAbsolute || !projectRoot.value) return trimmed

    const root = projectRoot.value.replace(/[\\/]+$/, '')
    const rel = trimmed.replace(/^[.\\/]+/, '')
    const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
    return `${root}${sep}${rel}`
  }

  /**
   * 将工具卡片里的相对路径（如 outputs/x.html）解析为绝对路径。
   * 优先使用当前会话的工作目录（Work 模式下为工作区），回退到 projectRoot。
   * 供 Read/Edit/Write 等工具卡片的「在面板查看」使用。
   */
  function resolveSessionPath(filePath: string): string {
    const trimmed = (filePath || '').trim()
    if (!trimmed) return trimmed
    const isAbsolute = /^([a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(trimmed)
    if (isAbsolute) return trimmed
    const chatStore = useChatStore()
    const base = (chatStore.workingDirectory || projectRoot.value || '').replace(/[\\/]+$/, '')
    if (!base) return trimmed
    const rel = trimmed.replace(/^[.\\/]+/, '')
    const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
    return `${base}${sep}${rel}`
  }

  function openTerminalTab(autoCommand?: string, env?: Record<string, string>, cwd?: string) {
    // 关闭所有可能阻塞中央面板的全屏视图，确保终端能被用户看到
    showSettings.value = false
    showSkillsManager.value = false
    showAgentManager.value = false
    showMCPManager.value = false
    showCronManager.value = false
    showTraceViewer.value = false

    const terminalStore = useTerminalStore()
    const tabId = terminalStore.createTab({ autoCommand, env, cwd })
    if (tabId) {
      const tab = terminalStore.tabs.find(t => t.id === tabId)
      if (tab) {
        centerTabs.value.push({
          id: tabId,
          label: tab.label,
          icon: markRaw(TerminalIcon),
          closable: true
        })
      }
      activeCenterTab.value = tabId
    }
  }

  function closeCenterTab(tabId: string) {
    const index = centerTabs.value.findIndex(t => t.id === tabId)
    if (index > -1 && centerTabs.value[index].closable) {
      centerTabs.value.splice(index, 1)

      if (tabId.startsWith('terminal-')) {
        const terminalStore = useTerminalStore()
        terminalStore.closeTab(tabId)
      }

      if (activeCenterTab.value === tabId) {
        const nextSessionTab = centerTabs.value.find(t => t.sessionId)
        activeCenterTab.value = nextSessionTab?.id || centerTabs.value[0]?.id || 'chat'

        // 关闭当前激活的会话标签后，需同步 chatStore.currentSessionId 到新激活的会话，
        // 否则主内容区仍显示已关闭会话的内容（仅单 leaf 模式需要：分屏模式由
        // SplitContainer 的 activePane watcher 负责将 pane 内容同步到全局）。
        const newActiveTab = nextSessionTab || centerTabs.value[0]
        if (newActiveTab?.sessionId) {
          try {
            const splitLayout = useSplitLayoutStore()
            if (splitLayout.isSingleLeaf) {
              const chatStore = useChatStore()
              if (chatStore.currentSessionId !== newActiveTab.sessionId) {
                chatStore.selectSession(newActiveTab.sessionId)
              }
            }
          } catch { /* defensive */ }
        }
      }

      // 分屏联动：清理所有引用该 tab 的 pane（避免悬空显示已关闭的内容）
      try {
        useSplitLayoutStore().clearLeavesForTab(tabId)
      } catch { /* defensive */ }
    }
  }

  function openSessionTab(sessionId: string, title: string) {
    const existingTab = centerTabs.value.find(t => t.sessionId === sessionId)
    if (existingTab) {
      activeCenterTab.value = existingTab.id
      return
    }
    const tabId = `session-${sessionId}`
    centerTabs.value.push({
      id: tabId,
      label: title || 'New Chat',
      icon: markRaw(MessageSquare),
      closable: true,
      sessionId
    })
    activeCenterTab.value = tabId
  }

  function closeSessionTab(tabId: string) {
    closeCenterTab(tabId)
  }

  function switchToSessionTab(sessionId: string) {
    const tab = centerTabs.value.find(t => t.sessionId === sessionId)
    if (tab) {
      activeCenterTab.value = tab.id
    } else {
      const chatStore = useChatStore()
      const session = chatStore.sessions.find(s => s.id === sessionId)
      const sessionTitle = session?.title || 'New Chat'
      openSessionTab(sessionId, sessionTitle)
    }
  }

  function updateSessionTabTitle(sessionId: string, title: string) {
    const tab = centerTabs.value.find(t => t.sessionId === sessionId)
    if (tab) {
      tab.label = title
    }
  }

  function setProjectRoot(path: string) {
    projectRoot.value = path
    try {
      localStorage.setItem(PROJECT_ROOT_STORAGE_KEY, path)
    } catch { /* ignore */ }
  }

  function setMode(m: AppMode) {
    mode.value = m
    try {
      localStorage.setItem(MODE_STORAGE_KEY, m)
    } catch { /* ignore */ }
  }

  function setWorkWorkspace(path: string) {
    workWorkspace.value = path
    workWorkspaceConfirmed.value = true
    try {
      localStorage.setItem(WORK_WORKSPACE_STORAGE_KEY, path)
      localStorage.setItem(WORK_WORKSPACE_CONFIRMED_STORAGE_KEY, 'true')
    } catch { /* ignore */ }
  }

  function clearWorkWorkspace() {
    workWorkspace.value = ''
    workWorkspaceConfirmed.value = false
    try {
      localStorage.removeItem(WORK_WORKSPACE_STORAGE_KEY)
      localStorage.removeItem(WORK_WORKSPACE_CONFIRMED_STORAGE_KEY)
    } catch { /* ignore */ }
  }

  function closeProject() {
    projectRoot.value = ''
    try {
      localStorage.removeItem(PROJECT_ROOT_STORAGE_KEY)
    } catch { /* ignore */ }
    closeAllInfoTabs()
  }

  function pushToInput(payload: InputInjectPayload) {
    pendingInputInjection.value = payload
  }

  function consumeInputInjection(): InputInjectPayload | null {
    const p = pendingInputInjection.value
    pendingInputInjection.value = null
    return p
  }

  /** 补全协议: localhost/127.0.0.1/内网 IP 默认 http, 其余默认 https */
  function normalizeWebUrl(url: string): string {
    const trimmed = url.trim()
    if (/^(https?|file):\/\//i.test(trimmed)) return trimmed
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}(\.\d{1,3}){3})(:\d+)?/i.test(trimmed)
    return (isLocal ? 'http://' : 'https://') + trimmed
  }

  /** 将本地文件路径转为 file:// URL 并在内置浏览器打开（用于预览 .html 等产物） */
  function openFileInWebview(filePath: string) {
    const normalized = filePath.replace(/\\/g, '/')
    const url = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
    openWebview(url)
  }

  function openWebview(url: string) {
    const normalizedUrl = normalizeWebUrl(url)

    const tabId = `webview::${normalizedUrl}`
    const existing = infoPanelTabs.value.find(t => t.id === tabId)
    if (existing) {
      activeInfoTabId.value = existing.id
      infoPanelVisible.value = true
      return
    }

    const webviewData: WebviewTabData = {
      url: normalizedUrl,
      history: [normalizedUrl],
      historyIndex: 0,
      title: ''
    }

    openInfoTab({
      id: tabId,
      type: 'webview',
      title: normalizedUrl,
      icon: markRaw(Globe),
      data: webviewData,
      closeable: true
    })

    console.log('[AppStore] Webview opened:', normalizedUrl)
  }

  function navigateWebview(url: string) {
    const normalizedUrl = normalizeWebUrl(url)

    const tab = activeInfoTab.value
    if (tab && tab.type === 'webview') {
      const data = tab.data as WebviewTabData
      data.history = data.history.slice(0, data.historyIndex + 1)
      data.history.push(normalizedUrl)
      data.historyIndex = data.history.length - 1
      data.url = normalizedUrl
    }

    console.log('[AppStore] Webview navigated to:', normalizedUrl)
  }

  function goBackWebview() {
    const tab = activeInfoTab.value
    if (tab && tab.type === 'webview') {
      const data = tab.data as WebviewTabData
      if (data.historyIndex > 0) {
        data.historyIndex--
        data.url = data.history[data.historyIndex]
        console.log('[AppStore] Webview go back to:', data.url)
      }
    }
  }

  function goForwardWebview() {
    const tab = activeInfoTab.value
    if (tab && tab.type === 'webview') {
      const data = tab.data as WebviewTabData
      if (data.historyIndex < data.history.length - 1) {
        data.historyIndex++
        data.url = data.history[data.historyIndex]
        console.log('[AppStore] Webview go forward to:', data.url)
      }
    }
  }

  function closeWebview() {
    const tab = activeInfoTab.value
    if (tab && tab.type === 'webview') {
      closeInfoTab(tab.id)
    }
    console.log('[AppStore] Webview closed')
  }

  /** 在右侧面板打开 Office 文件预览（PPT/Word/Excel/PDF） */
  function openOfficePreview(filePath: string, previewMode: 'html' | 'screenshots' | 'watch' = 'html') {
    officePreviewFile.value = filePath
    officePreviewMode.value = previewMode
    const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath
    openInfoTab({
      id: 'office-preview',
      type: 'office-preview',
      title: fileName,
      icon: markRaw(FileText),
      data: { filePath, mode: previewMode } as any,
      closeable: true,
    })
  }

  /** 关闭 Office 文件预览 */
  function closeOfficePreview() {
    officePreviewFile.value = ''
    closeInfoTab('office-preview')
  }

  function setWebviewLoading(loading: boolean) {
    isLoading.value = loading
  }

  function setWebviewTitle(title: string) {
    const tab = activeInfoTab.value
    if (tab && tab.type === 'webview') {
      const data = tab.data as WebviewTabData
      data.title = title
      tab.title = title || tab.title
    }
  }

  function openScmDiff(filePath: string, isStaged: boolean = false) {
    const tabId = `diff::${filePath}`
    const existing = infoPanelTabs.value.find(t => t.id === tabId)
    if (existing) {
      activeInfoTabId.value = existing.id
      infoPanelVisible.value = true
      // Keep staged status fresh in case the file was staged/unstaged since the tab was opened
      if (existing.data) {
        (existing.data as ScmDiffTabData).staged = isStaged
      }
      return
    }

    openInfoTab({
      id: tabId,
      type: 'diff',
      title: filePath.split(/[\\/]/).pop() || filePath,
      icon: markRaw(FileDiff),
      data: { filePath, staged: isStaged },
      closeable: true
    })
  }

  function getLanguageFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const languageMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'c': 'c',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'sv': 'verilog',
      'svh': 'verilog',
      'svi': 'verilog',
      'v': 'verilog',
      'vh': 'verilog',
      'md': 'markdown',
      'json': 'json',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'sh': 'bash',
      'bash': 'bash',
      'sql': 'sql',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'kt': 'kotlin',
      'swift': 'swift',
      'rb': 'ruby',
      'php': 'php',
      'vue': 'vue',
      'svelte': 'svelte'
    }
    return languageMap[ext] || 'plaintext'
  }

  return {
    theme,
    sidebarCollapsed,
    infoPanelVisible,
    panelHome,
    showFileQuickOpen,
    infoPanelMode,
    currentFile,
    currentLine,
    currentEndLine,
    toolDiffData,
    completedToolActions,
    centerTabs,
    activeCenterTab,
    infoPanelTabs,
    activeInfoTabId,
    activeInfoTab,
    projectRoot,
    showHiddenFiles,
    mode,
    workWorkspace,
    workWorkspaceConfirmed,
    setMode,
    setWorkWorkspace,
    clearWorkWorkspace,
    showSkillsManager,
    showTraceViewer,
    showSettings,
    showMCPManager,
    showAgentManager,
    showConnectMobile,
    showCronManager,
    showWorkGallery,
    showWorkOnboarding,
    webviewUrl,
    webviewHistory,
    currentHistoryIndex,
    webviewTitle,
    isLoading,
    isDark,
    pendingInputInjection,
    pushToInput,
    consumeInputInjection,
    toggleTheme,
    setTheme,
    toggleSidebar,
    toggleShowHiddenFiles,
    toggleSettings,
    showInfoPanel,
    hideInfoPanel,
    toggleInfoPanel,
    goPanelHome,
    openTerminalInPanel,
    openArtifactsPanel,
    openBlankWebview,
    showToolDiff,
    markToolActionCompleted,
    setCurrentFile,
    openFile,
    resolveSessionPath,
    getLanguageFromPath,
    openTerminalTab,
    closeCenterTab,
    openSessionTab,
    closeSessionTab,
    switchToSessionTab,
    updateSessionTabTitle,
    setProjectRoot,
    closeProject,
    openWebview,
    openFileInWebview,
    navigateWebview,
    goBackWebview,
    goForwardWebview,
    closeWebview,
    setWebviewLoading,
    setWebviewTitle,
    openInfoTab,
    closeInfoTab,
    closeAllInfoTabs,
    openScmDiff,
    officePreviewFile,
    officePreviewMode,
    openOfficePreview,
    closeOfficePreview,
    terminalDockVisible,
    terminalDockHeight,
    toggleTerminalDock,
    setTerminalDockHeight
  }
})
