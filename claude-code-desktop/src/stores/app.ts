import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import { MessageSquare, Terminal as TerminalIcon } from 'lucide-vue-next'

export interface FileInfo {
  path: string
  name: string
  content: string
  language: string
}

export interface CenterTab {
  id: string
  label: string
  icon: any
  closable: boolean
}

const PROJECT_ROOT_STORAGE_KEY = 'app_project_root'

export const useAppStore = defineStore('app', () => {
  // 默认使用亮色主题以提供更好的可读性和现代感
  const theme = ref<'light' | 'dark'>('light')
  const sidebarCollapsed = ref(false)
  const infoPanelVisible = ref(false)
  const infoPanelMode = ref<'diff' | 'file' | 'markdown'>('diff')
  const currentFile = ref<FileInfo | null>(null)
  const centerTabs = ref<CenterTab[]>([
    { id: 'chat', label: 'Chat', icon: markRaw(MessageSquare), closable: false }
  ])
  const activeCenterTab = ref<string>('chat')
  const terminalAutoCommand = ref<string | undefined>(undefined)
  const terminalEnv = ref<Record<string, string> | undefined>(undefined)
  const terminalKey = ref(0)
  const terminalCwd = ref<string | undefined>(undefined)

  // Restore persisted project root from localStorage on init
  let _initialProjectRoot = ''
  try {
    _initialProjectRoot = localStorage.getItem(PROJECT_ROOT_STORAGE_KEY) || ''
  } catch { /* ignore */ }
  const projectRoot = ref<string>(_initialProjectRoot)
  
  const isDark = computed(() => theme.value === 'dark')
  
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', theme.value)
  }
  
  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }
  
  function showInfoPanel(mode: 'diff' | 'file' | 'markdown') {
    infoPanelMode.value = mode
    infoPanelVisible.value = true
  }
  
  function hideInfoPanel() {
    infoPanelVisible.value = false
  }

  function setCurrentFile(file: FileInfo | null) {
    currentFile.value = file
  }

  function openTerminalTab(autoCommand?: string, env?: Record<string, string>, cwd?: string) {
    const existing = centerTabs.value.find(t => t.id === 'terminal')
    if (!existing) {
      centerTabs.value.push({
        id: 'terminal',
        label: 'Terminal',
        icon: markRaw(TerminalIcon),
        closable: true
      })
    }
    terminalAutoCommand.value = autoCommand
    terminalEnv.value = env
    terminalCwd.value = cwd
    // If env is provided, force recreate the terminal to apply new environment variables
    if (env) {
      terminalKey.value++
    }
    activeCenterTab.value = 'terminal'
  }

  function closeCenterTab(tabId: string) {
    const index = centerTabs.value.findIndex(t => t.id === tabId)
    if (index > -1 && centerTabs.value[index].closable) {
      centerTabs.value.splice(index, 1)
      if (activeCenterTab.value === tabId) {
        activeCenterTab.value = centerTabs.value[0]?.id || 'chat'
      }
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
      'sv': 'systemverilog',
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
    centerTabs,
    activeCenterTab,
    terminalAutoCommand,
    terminalEnv,
    terminalKey,
    terminalCwd,
    projectRoot,
    isDark,
    toggleTheme,
    toggleSidebar,
    showInfoPanel,
    hideInfoPanel,
    setCurrentFile,
    getLanguageFromPath,
    openTerminalTab,
    closeCenterTab,
    setProjectRoot,
    closeProject
  }
})