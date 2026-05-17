import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import { MessageSquare, Terminal as TerminalIcon } from 'lucide-vue-next'
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
  const infoPanelMode = ref<'diff' | 'file' | 'markdown' | 'tool-diff' | 'webview'>('diff')
  const currentFile = ref<FileInfo | null>(null)
  const toolDiffData = ref<ToolDiffData | null>(null)
  const completedToolActions = ref<Set<string>>(new Set())
  const currentLine = ref<number>(0)
  const currentEndLine = ref<number>(0)
  const centerTabs = ref<CenterTab[]>([
    { id: 'chat', label: 'Chat', icon: markRaw(MessageSquare), closable: false }
  ])
  const activeCenterTab = ref<string>('chat')

  // Restore persisted project root from localStorage on init
  let _initialProjectRoot = ''
  try {
    _initialProjectRoot = localStorage.getItem(PROJECT_ROOT_STORAGE_KEY) || ''
  } catch { /* ignore */ }
  const projectRoot = ref<string>(_initialProjectRoot)

  // Skills manager modal visibility
  const showSkillsManager = ref(false)
  const showTraceViewer = ref(false)
  const showSettings = ref(false)

  // Webview 相关状态
  const webviewUrl = ref<string>('')
  const webviewHistory = ref<string[]>([])
  const currentHistoryIndex = ref<number>(-1)
  const webviewTitle = ref<string>('')
  const isLoading = ref<boolean>(false)

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

  function showInfoPanel(mode: 'diff' | 'file' | 'markdown' | 'tool-diff' | 'webview') {
    infoPanelMode.value = mode
    infoPanelVisible.value = true
  }

  function hideInfoPanel() {
    infoPanelVisible.value = false
    toolDiffData.value = null
  }

  function showToolDiff(data: ToolDiffData) {
    if (completedToolActions.value.has(data.toolCallId)) {
      data.actionCompleted = true
    }
    toolDiffData.value = data
    infoPanelMode.value = 'tool-diff'
    infoPanelVisible.value = true
  }

  function markToolActionCompleted(toolCallId: string) {
    completedToolActions.value.add(toolCallId)
  }

  function setCurrentFile(file: FileInfo | null) {
    currentFile.value = file
  }

  async function openFile(filePath: string, line?: number, endLine?: number) {
    const api = (window as any).electronAPI
    if (!api?.readFile) {
      console.error('[AppStore] readFile API not available')
      return
    }

    // Resolve relative paths against the current project root so links
    // produced by the LLM (which usually uses repo-relative paths) work.
    const resolvedPath = resolveFilePath(filePath)

    try {
      let content = await api.readFile(resolvedPath)
      // Fallback: try the original path in case it was already absolute in an
      // unexpected form (e.g. the user pasted a full path from another OS).
      if (content === null && resolvedPath !== filePath) {
        content = await api.readFile(filePath)
      }
      if (content !== null) {
        const fileName = resolvedPath.split(/[\\/]/).pop() || resolvedPath
        const language = getLanguageFromPath(resolvedPath)
        currentLine.value = line || 0
        currentEndLine.value = endLine || 0
        const isMarkdown = language === 'markdown'
        setCurrentFile({
          path: resolvedPath,
          name: fileName,
          content: content,
          language: language
        })
        // Markdown files open in preview mode by default, like the sidebar does.
        // When a specific line is requested we fall back to the code view so
        // the user actually sees the highlighted line.
        showInfoPanel(isMarkdown && !line ? 'markdown' : 'file')
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
    // Absolute paths: POSIX (/foo) or Windows (C:\foo, C:/foo, \\server\share)
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

      // If it's a terminal tab, notify terminal store
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
      // Get the actual session title from chatStore
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
    currentFile.value = null
    infoPanelVisible.value = false
  }

  function openWebview(url: string) {
    let normalizedUrl = url.trim()
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl
    }

    if (webviewHistory.value.length === 0 || currentHistoryIndex.value === -1) {
      webviewHistory.value = [normalizedUrl]
      currentHistoryIndex.value = 0
    } else {
      webviewHistory.value = webviewHistory.value.slice(0, currentHistoryIndex.value + 1)
      webviewHistory.value.push(normalizedUrl)
      currentHistoryIndex.value = webviewHistory.value.length - 1
    }

    webviewUrl.value = normalizedUrl
    infoPanelMode.value = 'webview'
    infoPanelVisible.value = true

    console.log('[AppStore] Webview opened:', normalizedUrl)
  }

  function navigateWebview(url: string) {
    let normalizedUrl = url.trim()
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl
    }

    webviewHistory.value = webviewHistory.value.slice(0, currentHistoryIndex.value + 1)
    webviewHistory.value.push(normalizedUrl)
    currentHistoryIndex.value = webviewHistory.value.length - 1
    webviewUrl.value = normalizedUrl

    console.log('[AppStore] Webview navigated to:', normalizedUrl)
  }

  function goBackWebview() {
    if (currentHistoryIndex.value > 0) {
      currentHistoryIndex.value--
      webviewUrl.value = webviewHistory.value[currentHistoryIndex.value]
      console.log('[AppStore] Webview go back to:', webviewUrl.value)
    }
  }

  function goForwardWebview() {
    if (currentHistoryIndex.value < webviewHistory.value.length - 1) {
      currentHistoryIndex.value++
      webviewUrl.value = webviewHistory.value[currentHistoryIndex.value]
      console.log('[AppStore] Webview go forward to:', webviewUrl.value)
    }
  }

  function closeWebview() {
    webviewUrl.value = ''
    webviewHistory.value = []
    currentHistoryIndex.value = -1
    webviewTitle.value = ''
    isLoading.value = false
    hideInfoPanel()
    console.log('[AppStore] Webview closed')
  }

  function setWebviewLoading(loading: boolean) {
    isLoading.value = loading
  }

  function setWebviewTitle(title: string) {
    webviewTitle.value = title
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
    projectRoot,
    showSkillsManager,
    showTraceViewer,
    showSettings,
    webviewUrl,
    webviewHistory,
    currentHistoryIndex,
    webviewTitle,
    isLoading,
    isDark,
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
    setWebviewTitle
  }
})
