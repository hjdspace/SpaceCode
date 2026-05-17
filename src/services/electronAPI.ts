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

export interface FileSearchEntry {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  isFile: boolean
}

export interface DebugFileEntry {
  name: string
  path: string
  size: number
  modifiedAt: number
  kind: 'app' | 'session' | 'trace'
}

export interface TraceSessionEntry {
  sessionId: string
  path: string
  size: number
  modifiedAt: number
  eventCount: number
}

export interface AgentTraceEvent {
  id?: string
  sessionId: string
  engineSessionId?: string
  turnId?: string
  messageId?: string
  timestamp?: string
  source?: 'renderer' | 'electron' | 'engine'
  actor?: 'user' | 'assistant' | 'tool' | 'system'
  type: string
  status?: 'started' | 'running' | 'completed' | 'failed'
  title?: string
  input?: unknown
  output?: unknown
  artifacts?: Array<{ kind: string; path?: string; content?: string }>
  evidence?: Array<{ kind: string; result?: string; detail: string }>
  error?: { message: string; stack?: string }
  metadata?: Record<string, unknown>
}

export const api = {
  sendMessage: (text: string) => electronAPI?.sendMessage(text) || Promise.resolve({ success: false }),
  onMessage: (callback: (msg: any) => void) => electronAPI?.onMessage(callback),
  getAppState: () => electronAPI?.getAppState() || Promise.resolve({ sessions: [], currentSessionId: null, theme: 'dark' }),
  readDir: (dirPath: string): Promise<FileEntry[]> => electronAPI?.readDir(dirPath) || Promise.resolve([]),
  readFile: (filePath: string): Promise<string | null> => electronAPI?.readFile(filePath) || Promise.resolve(null),
  writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.writeFile(filePath, content) || Promise.resolve({ success: false, error: 'writeFile not available' }),
  stat: (filePath: string): Promise<FileStat | null> => electronAPI?.stat(filePath) || Promise.resolve(null),
  searchFiles: (dirPath: string, query: string, options?: { maxResults?: number }): Promise<FileSearchEntry[]> => {
    if (electronAPI?.searchFiles) {
      return electronAPI.searchFiles(dirPath, query, options)
    }
    return Promise.resolve([])
  },
  getEnv: (key: string): Promise<string | undefined> => {
    if (electronAPI?.getEnv) {
      return electronAPI.getEnv(key)
    }
    return Promise.resolve(undefined)
  },
  showDiff: (diff: any) => electronAPI?.showDiff(diff),
  onDiffRequested: (callback: (diff: any) => void) => electronAPI?.onDiffRequested(callback),
  showInfoPanel: (mode: 'diff' | 'file' | 'markdown' | 'tool-diff' | 'webview') => electronAPI?.showInfoPanel(mode),
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
  getPiCliPath: (): Promise<string | null> => {
    if (electronAPI?.getPiCliPath) {
      return electronAPI.getPiCliPath()
    }
    return Promise.resolve(null)
  },
  injectGuiModelsToSettings: (models: { primaryModel: string; haikuModel?: string | undefined; sonnetModel?: string | undefined; opusModel?: string | undefined; effortLevel?: 'low' | 'medium' | 'high' | 'max' }): Promise<{ success: boolean; error?: string }> => {
    if (electronAPI?.injectGuiModelsToSettings) {
      return electronAPI.injectGuiModelsToSettings(models)
    }
    return Promise.resolve({ success: false, error: 'injectGuiModelsToSettings not available' })
  },
  saveGuiSettings: (data: string): Promise<{ success: boolean; error?: string }> => {
    if (electronAPI?.saveGuiSettings) {
      return electronAPI.saveGuiSettings(data)
    }
    return Promise.resolve({ success: false, error: 'saveGuiSettings not available' })
  },
  loadGuiSettings: (): Promise<{ success: boolean; data: string | null; error?: string }> => {
    if (electronAPI?.loadGuiSettings) {
      return electronAPI.loadGuiSettings()
    }
    return Promise.resolve({ success: false, data: null, error: 'loadGuiSettings not available' })
  },

  // Folder selection dialog
  selectFolder: (): Promise<{ canceled: boolean; filePaths: string[] }> => {
    if (electronAPI?.selectFolder) {
      return electronAPI.selectFolder()
    }
    return Promise.resolve({ canceled: true, filePaths: [] })
  },

  // File selection dialog
  selectFiles: (): Promise<{ canceled: boolean; filePaths: string[] }> => {
    if (electronAPI?.selectFiles) {
      return electronAPI.selectFiles()
    }
    return Promise.resolve({ canceled: true, filePaths: [] })
  },

  // Prompt Optimizer API
  optimizePrompt: (
    prompt: string,
    options?: { workingDirectory?: string },
  ): Promise<{ success: boolean; result?: string; error?: string }> => {
    if (electronAPI?.optimizePrompt) {
      return electronAPI.optimizePrompt(prompt, options)
    }
    return Promise.resolve({ success: false, error: 'Prompt optimizer not available' })
  },

  // Git/SCM API
  git: {
    isRepo: (cwd: string): Promise<boolean> =>
      electronAPI?.git?.isRepo(cwd) || Promise.resolve(false),
    getRoot: (cwd: string): Promise<string | null> =>
      electronAPI?.git?.getRoot(cwd) || Promise.resolve(null),
    getStatus: (cwd: string): Promise<any> =>
      electronAPI?.git?.getStatus(cwd) || Promise.resolve(null),
    stage: (cwd: string, paths: string[]): Promise<boolean> =>
      electronAPI?.git?.stage(cwd, paths) || Promise.resolve(false),
    unstage: (cwd: string, paths: string[]): Promise<boolean> =>
      electronAPI?.git?.unstage(cwd, paths) || Promise.resolve(false),
    stageAll: (cwd: string): Promise<boolean> =>
      electronAPI?.git?.stageAll(cwd) || Promise.resolve(false),
    unstageAll: (cwd: string): Promise<boolean> =>
      electronAPI?.git?.unstageAll(cwd) || Promise.resolve(false),
    commit: (cwd: string, message: string, amend?: boolean): Promise<{ success: boolean; hash?: string; error?: string }> =>
      electronAPI?.git?.commit(cwd, message, amend) || Promise.resolve({ success: false, error: 'Git API not available' }),
    getDiff: (cwd: string, path: string, staged?: boolean): Promise<any> =>
      electronAPI?.git?.getDiff(cwd, path, staged) || Promise.resolve(null),
    showFile: (cwd: string, path: string): Promise<string | null> =>
      electronAPI?.git?.showFile(cwd, path) || Promise.resolve(null),
    getBranches: (cwd: string): Promise<any[]> =>
      electronAPI?.git?.getBranches(cwd) || Promise.resolve([]),
    checkout: (cwd: string, ref: string): Promise<{ success: boolean; error?: string }> =>
      electronAPI?.git?.checkout(cwd, ref) || Promise.resolve({ success: false, error: 'Git API not available' }),
    createBranch: (cwd: string, name: string, checkoutTo?: boolean): Promise<{ success: boolean; error?: string }> =>
      electronAPI?.git?.createBranch(cwd, name, checkoutTo) || Promise.resolve({ success: false, error: 'Git API not available' }),
    deleteBranch: (cwd: string, name: string, force?: boolean): Promise<{ success: boolean; error?: string }> =>
      electronAPI?.git?.deleteBranch(cwd, name, force) || Promise.resolve({ success: false, error: 'Git API not available' }),
    getLog: (cwd: string, count?: number): Promise<any[]> =>
      electronAPI?.git?.getLog(cwd, count) || Promise.resolve([]),
    discardChanges: (cwd: string, paths: string[]): Promise<boolean> =>
      electronAPI?.git?.discardChanges(cwd, paths) || Promise.resolve(false),
    pull: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      electronAPI?.git?.pull(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
    push: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      electronAPI?.git?.push(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
    stash: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      electronAPI?.git?.stash(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
    stashPop: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      electronAPI?.git?.stashPop(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
    fetchAll: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      electronAPI?.git?.fetchAll(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
  },

  // Agent API
  agents: {
    listAgents: (cwd?: string): Promise<Array<{ agentType: string; description: string; source: string; model?: string; color?: string }>> => {
      if (electronAPI?.claudeCode?.listAgents) {
        return electronAPI.claudeCode.listAgents(cwd)
      }
      return Promise.resolve([])
    },
  },

  updateThinkingLevel: (sessionId: string, enabled: boolean): Promise<void> => {
    if (electronAPI?.claudeCode?.updateThinkingLevel) {
      return electronAPI.claudeCode.updateThinkingLevel(sessionId, enabled)
    }
    return Promise.resolve()
  },

  // Debug API
  debug: {
    listFiles: (): Promise<DebugFileEntry[]> => electronAPI?.debug?.listFiles() || Promise.resolve([]),
    readFile: (filePath: string, maxBytes?: number): Promise<{ success: boolean; content?: string; error?: string }> =>
      electronAPI?.debug?.readFile(filePath, maxBytes) || Promise.resolve({ success: false, error: 'Debug API not available' }),
    listTraceSessions: (): Promise<TraceSessionEntry[]> => electronAPI?.debug?.listTraceSessions() || Promise.resolve([]),
    readTraceEvents: (sessionId: string, maxEvents?: number): Promise<{ success: boolean; events?: AgentTraceEvent[]; error?: string }> =>
      electronAPI?.debug?.readTraceEvents(sessionId, maxEvents) || Promise.resolve({ success: false, error: 'Debug API not available' }),
  },

  // Trace API
  trace: {
    event: (event: AgentTraceEvent) => electronAPI?.trace?.event(event),
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