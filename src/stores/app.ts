import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import { MessageSquare, Terminal as TerminalIcon, FileCode, FileText, FileDiff, Globe, TextSearch } from 'lucide-vue-next'
import { useChatStore } from './chat'
import { useTerminalStore } from './terminal'

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

export type InfoPanelTabType = 'file' | 'markdown' | 'diff' | 'tool-diff' | 'webview'

export interface InfoPanelTab {
  id: string
  type: InfoPanelTabType
  title: string
  icon: any
  data: FileInfo | ToolDiffData | WebviewTabData | null
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

export type ThemeId = 'light' | 'dark' | 'anthropic' | 'anthropic-dark'

export const THEME_CYCLE: ThemeId[] = ['light', 'dark', 'anthropic', 'anthropic-dark']

export const useAppStore = defineStore('app', () => {
  const theme = ref<ThemeId>('light')
  const sidebarCollapsed = ref(false)
  const infoPanelVisible = ref(false)
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

  const showSkillsManager = ref(false)
  const showTraceViewer = ref(false)
  const showSettings = ref(false)
  const showMCPManager = ref(false)

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

  function toggleSettings() {
    showSettings.value = !showSettings.value
    if (showSettings.value) {
      showTraceViewer.value = false
    }
  }

  function openInfoTab(tab: InfoPanelTab) {
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
    const api = (window as any).electronAPI
    if (!api?.readFile) {
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

  function openTerminalTab(autoCommand?: string, env?: Record<string, string>, cwd?: string) {
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
      }
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
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}(\.\d{1,3}){3})(:\d+)?/i.test(trimmed)
    return (isLocal ? 'http://' : 'https://') + trimmed
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

  function openScmDiff(filePath: string) {
    const tabId = `diff::${filePath}`
    const existing = infoPanelTabs.value.find(t => t.id === tabId)
    if (existing) {
      activeInfoTabId.value = existing.id
      infoPanelVisible.value = true
      return
    }

    openInfoTab({
      id: tabId,
      type: 'diff',
      title: filePath.split(/[\\/]/).pop() || filePath,
      icon: markRaw(FileDiff),
      data: null,
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
    showSkillsManager,
    showTraceViewer,
    showSettings,
    showMCPManager,
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
    toggleSettings,
    showInfoPanel,
    hideInfoPanel,
    showToolDiff,
    markToolActionCompleted,
    setCurrentFile,
    openFile,
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
    navigateWebview,
    goBackWebview,
    goForwardWebview,
    closeWebview,
    setWebviewLoading,
    setWebviewTitle,
    openInfoTab,
    closeInfoTab,
    closeAllInfoTabs,
    openScmDiff
  }
})
