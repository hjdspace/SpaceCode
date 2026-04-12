const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface FileStat {
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: number
}

export const api = {
  sendMessage: (text: string) => electronAPI?.sendMessage(text) || Promise.resolve({ success: false }),
  onMessage: (callback: (msg: any) => void) => electronAPI?.onMessage(callback),
  getAppState: () => electronAPI?.getAppState() || Promise.resolve({ sessions: [], currentSessionId: null, theme: 'dark' }),
  readDir: (dirPath: string): Promise<FileEntry[]> => electronAPI?.readDir(dirPath) || Promise.resolve([]),
  readFile: (filePath: string): Promise<string | null> => electronAPI?.readFile(filePath) || Promise.resolve(null),
  stat: (filePath: string): Promise<FileStat | null> => electronAPI?.stat(filePath) || Promise.resolve(null),
  getEnv: (key: string): Promise<string | undefined> => {
    if (electronAPI?.getEnv) {
      return electronAPI.getEnv(key)
    }
    return Promise.resolve(undefined)
  },
  showDiff: (diff: any) => electronAPI?.showDiff(diff),
  onDiffRequested: (callback: (diff: any) => void) => electronAPI?.onDiffRequested(callback),
  showInfoPanel: (mode: 'diff' | 'file' | 'markdown') => electronAPI?.showInfoPanel(mode),
  hideInfoPanel: () => electronAPI?.hideInfoPanel(),
  onShowInfoPanel: (callback: (mode: string) => void) => electronAPI?.onShowInfoPanel(callback),
  onHideInfoPanel: (callback: () => void) => electronAPI?.onHideInfoPanel(callback),
  onToolResult: (callback: (result: any) => void) => electronAPI?.onToolResult(callback),
  onMenuNewChat: (callback: () => void) => {
    if (electronAPI?.onMenuNewChat) {
      electronAPI.onMenuNewChat(callback)
    }
  },
  onMenuOpenFolder: (callback: (path: string) => void) => {
    if (electronAPI?.onMenuOpenFolder) {
      electronAPI.onMenuOpenFolder(callback)
    }
  },
  onMenuCloseFolder: (callback: () => void) => {
    if (electronAPI?.onMenuCloseFolder) {
      electronAPI.onMenuCloseFolder(callback)
    }
  },
  openExternal: (url: string) => electronAPI?.openExternal(url) || Promise.resolve(),
  httpFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; data: string; error?: string } | null> => {
    if (electronAPI?.httpFetch) {
      return electronAPI.httpFetch(url, options)
    }
    return Promise.resolve(null)
  },
  getClaudeCliPath: (): Promise<string | null> => {
    if (electronAPI?.getClaudeCliPath) {
      return electronAPI.getClaudeCliPath()
    }
    return Promise.resolve(null)
  },

  // Terminal API
  terminal: {
    create: (options?: { cwd?: string; command?: string; env?: Record<string, string> }): Promise<{ id: string | null; shell?: string; error?: string }> => {
      if (electronAPI?.terminal) {
        return electronAPI.terminal.create(options)
      }
      return Promise.resolve({ id: null, error: 'Terminal API not available' })
    },
    write: (id: string, data: string) => electronAPI?.terminal?.write(id, data),
    resize: (id: string, cols: number, rows: number) => electronAPI?.terminal?.resize(id, cols, rows),
    kill: (id: string) => electronAPI?.terminal?.kill(id),
    runCommand: (id: string, command: string) => electronAPI?.terminal?.runCommand(id, command),
    onData: (callback: (id: string, data: string) => void): (() => void) => {
      if (electronAPI?.terminal) {
        return electronAPI.terminal.onData(callback)
      }
      return () => {}
    },
    onExit: (callback: (id: string, exitCode: number) => void): (() => void) => {
      if (electronAPI?.terminal) {
        return electronAPI.terminal.onExit(callback)
      }
      return () => {}
    },
  }
}