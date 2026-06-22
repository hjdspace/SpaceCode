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

export interface TokenStatsDailyEntry {
  date: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  sessionCount: number
  messageCount: number
  tokensByModel: Record<string, number>
}

export interface TokenStatsSummary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  sessionCount: number
  messageCount: number
}

export interface TokenStatsResult {
  generatedAt: string
  sourceDir: string
  firstDate: string | null
  lastDate: string | null
  today: TokenStatsSummary
  yesterday: TokenStatsSummary
  last30Days: TokenStatsSummary
  allTime: TokenStatsSummary
  daily: TokenStatsDailyEntry[]
  modelUsage: Record<string, TokenStatsSummary>
}

export type ExternalEditor =
  | 'vscode'
  | 'visualstudio'
  | 'cursor'
  | 'fileExplorer'
  | 'terminal'
  | 'gitBash'
  | 'wsl'
  | 'androidStudio'

export const api = {
  sendMessage: (text: string) => electronAPI?.sendMessage(text) || Promise.resolve({ success: false }),
  onMessage: (callback: (msg: any) => void) => electronAPI?.onMessage(callback),
  getAppState: () => electronAPI?.getAppState() || Promise.resolve({ sessions: [], currentSessionId: null, theme: 'dark' }),
  readDir: (dirPath: string): Promise<FileEntry[]> => electronAPI?.readDir(dirPath) || Promise.resolve([]),
  readFile: (filePath: string): Promise<string | null> => electronAPI?.readFile(filePath) || Promise.resolve(null),
  readFileAsBase64: (filePath: string): Promise<string | null> => electronAPI?.readFileAsBase64(filePath) || Promise.resolve(null),
  writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.writeFile(filePath, content) || Promise.resolve({ success: false, error: 'writeFile not available' }),
  stat: (filePath: string): Promise<FileStat | null> => electronAPI?.stat(filePath) || Promise.resolve(null),
  searchFiles: (dirPath: string, query: string, options?: { maxResults?: number }): Promise<FileSearchEntry[]> => {
    if (electronAPI?.searchFiles) {
      return electronAPI.searchFiles(dirPath, query, options)
    }
    return Promise.resolve([])
  },

  // File operations for context menu
  copyFile: (srcPath: string, destPath: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.copyFile(srcPath, destPath) || Promise.resolve({ success: false, error: 'copyFile not available' }),
  moveFile: (srcPath: string, destPath: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.moveFile(srcPath, destPath) || Promise.resolve({ success: false, error: 'moveFile not available' }),
  renameFile: (filePath: string, newName: string): Promise<{ success: boolean; error?: string; newPath?: string }> =>
    electronAPI?.renameFile(filePath, newName) || Promise.resolve({ success: false, error: 'renameFile not available' }),
  deleteFile: (filePath: string, permanent?: boolean): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.deleteFile(filePath, permanent) || Promise.resolve({ success: false, error: 'deleteFile not available' }),

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
  openInEditor: (editor: ExternalEditor, targetPath: string): Promise<{ success: boolean; error?: string }> => {
    if (electronAPI?.openInEditor) {
      return electronAPI.openInEditor(editor, targetPath)
    }
    return Promise.resolve({ success: false, error: 'openInEditor not available' })
  },
  httpFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }): Promise<{ ok: boolean; status: number; data: string; error?: string } | null> => {
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
  injectGuiModelsToSettings: (models: { primaryModel: string; haikuModel?: string | undefined; sonnetModel?: string | undefined; opusModel?: string | undefined; effortLevel?: 'low' | 'medium' | 'high' | 'max'; permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' }): Promise<{ success: boolean; error?: string }> => {
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

  loadHooksSettings: (scope?: string): Promise<{ success: boolean; data: string | null; error?: string }> => {
    if (electronAPI?.loadHooksSettings) {
      return electronAPI.loadHooksSettings(scope)
    }
    return Promise.resolve({ success: false, data: null, error: 'loadHooksSettings not available' })
  },
  saveHooksSettings: (hooksJson: string, scope?: string): Promise<{ success: boolean; error?: string }> => {
    if (electronAPI?.saveHooksSettings) {
      return electronAPI.saveHooksSettings(hooksJson, scope)
    }
    return Promise.resolve({ success: false, error: 'saveHooksSettings not available' })
  },

  getBuiltinHooksRoot: (): Promise<{ success: boolean; path?: string; error?: string }> => {
    if (electronAPI?.getBuiltinHooksRoot) {
      return electronAPI.getBuiltinHooksRoot()
    }
    return Promise.resolve({ success: false, error: 'getBuiltinHooksRoot not available' })
  },
  checkNode: (): Promise<{ success: boolean; version?: string; error?: string }> => {
    if (electronAPI?.checkNode) {
      return electronAPI.checkNode()
    }
    return Promise.resolve({ success: false, error: 'checkNode not available' })
  },

  getTokenUsageStats: (): Promise<{ success: boolean; data?: TokenStatsResult; error?: string }> => {
    if (electronAPI?.getTokenUsageStats) {
      return electronAPI.getTokenUsageStats()
    }
    return Promise.resolve({ success: false, error: 'getTokenUsageStats not available' })
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
    getFullDiff: (cwd: string): Promise<any> =>
      electronAPI?.git?.getFullDiff(cwd) || Promise.resolve(null),
    getStagedDiff: (cwd: string): Promise<string> =>
      electronAPI?.git?.getStagedDiff(cwd) || Promise.resolve(''),
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
    watchProject: (cwd: string): Promise<boolean> =>
      electronAPI?.git?.watchProject(cwd) || Promise.resolve(false),
    stopWatch: (): Promise<boolean> =>
      electronAPI?.git?.stopWatch() || Promise.resolve(false),
    onStatusChanged: (callback: () => void): (() => void) => {
      if (electronAPI?.git?.onStatusChanged) {
        return electronAPI.git.onStatusChanged(callback)
      }
      return () => {}
    },
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

  getContextUsage: (sessionId: string): Promise<Record<string, unknown> | undefined> => {
    if (electronAPI?.claudeCode?.getContextUsage) {
      return electronAPI.claudeCode.getContextUsage(sessionId)
    }
    return Promise.resolve(undefined)
  },

  detectInstalledCli: (): Promise<any> => {
    if (electronAPI?.claudeCode?.detectInstalledCli) {
      return electronAPI.claudeCode.detectInstalledCli()
    }
    return Promise.resolve(null)
  },

  checkEnvironment: (): Promise<any> => {
    if (electronAPI?.claudeCode?.checkEnvironment) {
      return electronAPI.claudeCode.checkEnvironment()
    }
    return Promise.resolve(null)
  },

  installCli: (): Promise<any> => {
    if (electronAPI?.claudeCode?.installCli) {
      return electronAPI.claudeCode.installCli()
    }
    return Promise.resolve(null)
  },

  onInstallProgress: (callback: (progress: any) => void): (() => void) => {
    if (electronAPI?.claudeCode?.onInstallProgress) {
      return electronAPI.claudeCode.onInstallProgress(callback)
    }
    return () => {}
  },

  getProxyStatus: (): Promise<any> => {
    if (electronAPI?.claudeCode?.getProxyStatus) {
      return electronAPI.claudeCode.getProxyStatus()
    }
    return Promise.resolve(null)
  },

  isProxyRunning: (): Promise<boolean> => {
    if (electronAPI?.claudeCode?.isProxyRunning) {
      return electronAPI.claudeCode.isProxyRunning()
    }
    return Promise.resolve(false)
  },

  notifyEngineSourceChanged: (source: string): Promise<void> => {
    if (electronAPI?.claudeCode?.notifyEngineSourceChanged) {
      return electronAPI.claudeCode.notifyEngineSourceChanged(source)
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

  // Trace API — fully replicated from cc-haha
  trace: {
    event: (event: AgentTraceEvent) => electronAPI?.trace?.event(event),
    /** 获取 trace 会话列表（cc-haha 兼容接口） */
    list: (params?: { limit?: number; offset?: number; query?: string }): Promise<import('@/types/trace').TraceSessionList> => {
      if (electronAPI?.trace?.list) return electronAPI.trace.list(params)
      // 降级：从现有 debug API 构建
      return (async () => {
        const sessions = await (electronAPI?.debug?.listTraceSessions() || Promise.resolve([]))
        return {
          traces: sessions.map((s: import('./electronAPI').TraceSessionEntry) => ({
            sessionId: s.sessionId,
            session: null,
            summary: { apiCalls: 0, failedCalls: 0, totalDurationMs: 0, totalInputTokens: 0, totalOutputTokens: 0, models: [], updatedAt: null },
            fileSize: s.size,
            fileUpdatedAt: new Date(s.modifiedAt).toISOString(),
          })),
          total: sessions.length,
          storageDir: '',
          settings: { enabled: true, storageDir: '' },
        }
      })()
    },
    /** 获取单个 trace 会话详情 */
    getTrace: (sessionId: string): Promise<{ success: boolean; data?: import('@/types/trace').TraceSession; error?: string }> => {
      if (electronAPI?.trace?.getTrace) return electronAPI.trace.getTrace(sessionId)
      return Promise.resolve({ success: false, error: 'Not available' })
    },
    /** 获取单个 call 的完整详情 */
    getTraceCall: (sessionId: string, callId: string): Promise<{ call?: import('@/types/trace').TraceCallRecord } | null> => {
      if (electronAPI?.trace?.getTraceCall) return electronAPI.trace.getTraceCall(sessionId, callId)
      return Promise.resolve(null)
    },
    /** 获取 trace 采集设置 */
    getSettings: (): Promise<import('@/types/trace').TraceCaptureSettings | null> => {
      if (electronAPI?.trace?.getSettings) return electronAPI.trace.getSettings()
      return Promise.resolve(null)
    },
    /** 更新 trace 采集设置 */
    updateSettings: (settings: { enabled: boolean }): Promise<{ success: boolean; error?: string }> => {
      if (electronAPI?.trace?.updateSettings) return electronAPI.trace.updateSettings(settings)
      return Promise.resolve({ success: false, error: 'Not available' })
    },
    /** 在独立窗口中打开 trace 详情 */
    openWindow: (sessionId: string): void => {
      if (electronAPI?.trace?.openWindow) electronAPI.trace.openWindow(sessionId)
    },
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
  },

  // Turn Checkpoint API - 轮次变更追踪
  session: {
    getTurnCheckpoints: (sessionId: string, projectPath?: string): Promise<{
      ok: boolean
      checkpoints: import('@/types').SessionTurnCheckpoint[]
      error: string | null
    }> =>
      electronAPI?.session?.getTurnCheckpoints(sessionId, projectPath) ||
      Promise.resolve({ ok: false, checkpoints: [], error: 'Session API not available' }),

    getTurnRewindPreviewFiles: (
      sessionId: string,
      targetUserMessageId: string,
      userMessageIndex?: number,
      projectPath?: string
    ): Promise<{ ok: boolean; files: string[]; error: string | null }> =>
      electronAPI?.session?.getTurnRewindPreviewFiles(
        sessionId,
        targetUserMessageId,
        userMessageIndex,
        projectPath
      ) ||
      Promise.resolve({ ok: false, files: [], error: 'Session API not available' }),

    getTurnCheckpointDiff: (
      sessionId: string,
      targetUserMessageId: string,
      filePath: string,
      userMessageIndex?: number,
      projectPath?: string
    ): Promise<import('@/types').TurnCheckpointDiffResult> =>
      electronAPI?.session?.getTurnCheckpointDiff(
        sessionId,
        targetUserMessageId,
        filePath,
        userMessageIndex,
        projectPath
      ) ||
      Promise.resolve({
        state: 'error',
        path: filePath,
        error: 'Session API not available'
      }),

    rewindTurn: (
      sessionId: string,
      options: { targetUserMessageId: string; userMessageIndex?: number },
      projectPath?: string
    ): Promise<{ ok: boolean; error: string | null }> =>
      electronAPI?.session?.rewindTurn(sessionId, options, projectPath) ||
      Promise.resolve({ ok: false, error: 'Session API not available' }),
  },

  mobile: {
    startServer: () => {
      if (electronAPI?.mobile?.startServer) {
        return electronAPI.mobile.startServer()
      }
      return Promise.resolve({ url: '', token: '', port: 0, ip: '' })
    },
    stopServer: () => {
      if (electronAPI?.mobile?.stopServer) {
        return electronAPI.mobile.stopServer()
      }
      return Promise.resolve()
    },
    getStatus: () => {
      if (electronAPI?.mobile?.getStatus) {
        return electronAPI.mobile.getStatus()
      }
      return Promise.resolve({ running: false, connected: false })
    },
    onConnected: (cb: (clientInfo: string) => void) =>
      electronAPI?.mobile?.onConnected(cb) ?? (() => {}),
    onDisconnected: (cb: () => void) =>
      electronAPI?.mobile?.onDisconnected(cb) ?? (() => {}),
  },

  // ClaudeCode API — direct access to the claudeCode IPC bridge
  // Used by chat.ts for session lifecycle, streaming, and permission management.
  // Returns null when running outside Electron (SSR / unit tests).
  get claudeCode() {
    return electronAPI?.claudeCode ?? null
  },

  // Image API — direct access to the image IPC bridge
  get image() {
    return electronAPI?.image ?? null
  },

  // Logger API — direct access to the logger IPC bridge
  get logger() {
    return electronAPI?.logger ?? null
  },

  // getCwd — get current working directory from main process
  getCwd: (): Promise<string> => {
    if (electronAPI?.getCwd) {
      return electronAPI.getCwd()
    }
    return Promise.resolve('/')
  },

  // Auto Update API
  update: {
    check: (): Promise<{ success: boolean; error?: string }> => {
      if (electronAPI?.update?.check) {
        return electronAPI.update.check()
      }
      return Promise.resolve({ success: false, error: 'Update API not available' })
    },
    download: (): Promise<{ success: boolean; error?: string }> => {
      if (electronAPI?.update?.download) {
        return electronAPI.update.download()
      }
      return Promise.resolve({ success: false, error: 'Update API not available' })
    },
    installAndRestart: () => {
      if (electronAPI?.update?.installAndRestart) {
        electronAPI.update.installAndRestart()
      }
    },
    onAvailable: (callback: (info: { version: string; releaseDate: string; releaseNotes: any; releaseName?: string }) => void): (() => void) => {
      if (electronAPI?.update?.onAvailable) {
        return electronAPI.update.onAvailable(callback)
      }
      return () => {}
    },
    onNotAvailable: (callback: () => void): (() => void) => {
      if (electronAPI?.update?.onNotAvailable) {
        return electronAPI.update.onNotAvailable(callback)
      }
      return () => {}
    },
    onDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): (() => void) => {
      if (electronAPI?.update?.onDownloadProgress) {
        return electronAPI.update.onDownloadProgress(callback)
      }
      return () => {}
    },
    onDownloaded: (callback: (info: { version: string }) => void): (() => void) => {
      if (electronAPI?.update?.onDownloaded) {
        return electronAPI.update.onDownloaded(callback)
      }
      return () => {}
    },
    onError: (callback: (error: string) => void): (() => void) => {
      if (electronAPI?.update?.onError) {
        return electronAPI.update.onError(callback)
      }
      return () => {}
    },
  },

  // Changelog API
  changelog: {
    getReleaseNotes: (version: string): Promise<{ content: string; source: 'local' | 'remote' } | null> => {
      if (electronAPI?.changelog?.getReleaseNotes) {
        return electronAPI.changelog.getReleaseNotes(version)
      }
      return Promise.resolve(null)
    },
  },

  // App version
  getAppVersion: (): Promise<string> => {
    if (electronAPI?.getAppVersion) {
      return electronAPI.getAppVersion()
    }
    return Promise.resolve('0.0.0')
  },

  // Cron API
  cron: {
    list: (projectRoot: string): Promise<any[]> =>
      electronAPI?.cron?.list(projectRoot) || Promise.resolve([]),
    create: (projectRoot: string, task: any): Promise<any> =>
      electronAPI?.cron?.create(projectRoot, task) || Promise.resolve(null),
    update: (projectRoot: string, id: string, updates: any): Promise<void> =>
      electronAPI?.cron?.update(projectRoot, id, updates) || Promise.resolve(),
    delete: (projectRoot: string, id: string): Promise<void> =>
      electronAPI?.cron?.delete(projectRoot, id) || Promise.resolve(),
    run: (projectRoot: string, id: string): Promise<any> =>
      electronAPI?.cron?.run(projectRoot, id) || Promise.resolve(null),
    runs: (projectRoot: string, limit?: number): Promise<any[]> =>
      electronAPI?.cron?.runs(projectRoot, limit) || Promise.resolve([]),
    taskRuns: (projectRoot: string, taskId: string): Promise<any[]> =>
      electronAPI?.cron?.taskRuns(projectRoot, taskId) || Promise.resolve([]),
    validate: (cron: string): Promise<{ valid: boolean; error?: string }> =>
      electronAPI?.cron?.validate(cron) || Promise.resolve({ valid: false, error: 'Cron API not available' }),
    describe: (cron: string): Promise<string> =>
      electronAPI?.cron?.describe(cron) || Promise.resolve(cron),
    onTaskFired: (callback: (data: any) => void): (() => void) | null =>
      electronAPI?.cron?.onTaskFired(callback) || null,
    onRunCompleted: (callback: (data: any) => void): (() => void) | null =>
      electronAPI?.cron?.onRunCompleted(callback) || null,
  },
}
