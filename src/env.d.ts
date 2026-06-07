/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

interface FileStat {
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: number
}

interface AgentDef {
  name: string
  description: string
  content: string
  tools?: string[]
  model?: string
  color?: string
  sourceDir: string
  agentPath: string
  isInstalled: boolean
  installedScope?: 'global' | 'project'
  category: string
}

interface Window {
  electronAPI: {
    platform: string
    sendMessage: (text: string) => Promise<any>
    onMessage: (callback: (msg: any) => void) => void
    getAppState: () => Promise<any>
    readDir: (dirPath: string) => Promise<FileEntry[]>
    readFile: (filePath: string) => Promise<string | null>
    stat: (filePath: string) => Promise<FileStat | null>
    getEnv: (key: string) => Promise<string | undefined>
    showDiff: (diff: any) => void
    onDiffRequested: (callback: (diff: any) => void) => void
    showInfoPanel: (mode: 'diff' | 'file' | 'markdown' | 'tool-diff' | 'webview') => void
    hideInfoPanel: () => void
    onShowInfoPanel: (callback: (mode: string) => void) => void
    onHideInfoPanel: (callback: () => void) => void
    onToolResult: (callback: (result: any) => void) => void
    onMenuNewChat: (callback: () => void) => void
    openExternal: (url: string) => Promise<void>
    git: {
      isRepo: (cwd: string) => Promise<boolean>
      getRoot: (cwd: string) => Promise<string | null>
      getStatus: (cwd: string) => Promise<any>
      stage: (cwd: string, paths: string[]) => Promise<boolean>
      unstage: (cwd: string, paths: string[]) => Promise<boolean>
      stageAll: (cwd: string) => Promise<boolean>
      unstageAll: (cwd: string) => Promise<boolean>
      commit: (cwd: string, message: string, amend?: boolean) => Promise<{ success: boolean; hash?: string; error?: string }>
      getDiff: (cwd: string, path: string, staged?: boolean) => Promise<any>
      getBranches: (cwd: string) => Promise<any[]>
      checkout: (cwd: string, ref: string) => Promise<{ success: boolean; error?: string }>
      createBranch: (cwd: string, name: string, checkoutTo?: boolean) => Promise<{ success: boolean; error?: string }>
      deleteBranch: (cwd: string, name: string, force?: boolean) => Promise<{ success: boolean; error?: string }>
      getLog: (cwd: string, count?: number) => Promise<any[]>
      discardChanges: (cwd: string, paths: string[]) => Promise<boolean>
      pull: (cwd: string) => Promise<{ success: boolean; error?: string }>
      push: (cwd: string) => Promise<{ success: boolean; error?: string }>
      stash: (cwd: string) => Promise<{ success: boolean; error?: string }>
      stashPop: (cwd: string) => Promise<{ success: boolean; error?: string }>
      fetchAll: (cwd: string) => Promise<{ success: boolean; error?: string }>
    }
    agents: {
      scanLibrary: (cwd?: string) => Promise<{ agents: AgentDef[] }>
      getInstalled: (cwd?: string) => Promise<{ agents: AgentDef[] }>
      install: (name: string, scope: 'global' | 'project', cwd?: string) => Promise<void>
      uninstall: (name: string, scope: 'global' | 'project', cwd?: string) => Promise<void>
    }
    terminal: {
      create: (options?: { cwd?: string; command?: string; env?: Record<string, string> }) => Promise<{ id: string | null; shell?: string; error?: string }>
      write: (id: string, data: string) => void
      resize: (id: string, cols: number, rows: number) => void
      kill: (id: string) => void
      runCommand: (id: string, command: string) => void
      onData: (callback: (id: string, data: string) => void) => () => void
      onExit: (callback: (id: string, exitCode: number) => void) => () => void
    }
  }
}