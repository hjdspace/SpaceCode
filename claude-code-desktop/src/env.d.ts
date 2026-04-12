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

interface Window {
  electronAPI: {
    sendMessage: (text: string) => Promise<any>
    onMessage: (callback: (msg: any) => void) => void
    getAppState: () => Promise<any>
    readDir: (dirPath: string) => Promise<FileEntry[]>
    readFile: (filePath: string) => Promise<string | null>
    stat: (filePath: string) => Promise<FileStat | null>
    getEnv: (key: string) => Promise<string | undefined>
    showDiff: (diff: any) => void
    onDiffRequested: (callback: (diff: any) => void) => void
    showInfoPanel: (mode: 'diff' | 'file' | 'markdown') => void
    hideInfoPanel: () => void
    onShowInfoPanel: (callback: (mode: string) => void) => void
    onHideInfoPanel: (callback: () => void) => void
    onToolResult: (callback: (result: any) => void) => void
    onMenuNewChat: (callback: () => void) => void
    openExternal: (url: string) => Promise<void>
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