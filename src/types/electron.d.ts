/**
 * ElectronAPI — preload.ts 中通过 contextBridge.exposeInMainWorld('electronAPI', ...)
 * 暴露给渲染进程的完整类型声明。
 *
 * 渲染进程通过 window.electronAPI 访问，无需 (window as any) 强制转换。
 */
import type {
  FileEntry,
  FileStat,
  FileSearchEntry,
  DebugFileEntry,
  TraceSessionEntry,
  AgentTraceEvent,
  TokenStatsResult,
  ExternalEditor,
  GitDiffResult,
  GitFullDiffResult,
  GitStatus,
  GitBranch,
  GitLogEntry,
  CronTask,
  CronRunEntry,
  CliDetectionResult,
  EnvironmentCheckResult,
  ProxyStatus,
  InstallProgress,
  ArtifactEntry,
  DesignSystemSummary,
} from '@/services/electronAPI'

import type {
  TraceSessionList,
  TraceSession,
  TraceCallRecord,
} from '@/types/trace'

import type {
  SessionTurnCheckpoint,
  TurnCheckpointDiffResult,
} from '@/types/turnCheckpoint'

import type {
  CuaDriverStatus,
  CuaDriverUpdateInfo,
  CuaDriverPermissions,
  HealthCheck,
  McpToolResult,
} from '@/types/computerUse'

import type {
  BrowserUseStatus,
  BrowserUseUpdateInfo,
  BrowserUseHealthCheck,
  BrowserUseInstallProgress,
  BrowserUseInstallOptions,
  BrowserUseToolResult,
  BrowserUseLiveSnapshot,
  BrowserUseAgentConfig,
} from '@/types/browserUse'

// ── 子接口定义 ──────────────────────────────────────────────────

export interface ElectronWindowAPI {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximizeChanged: (callback: (maximized: boolean) => void) => () => void
}

export interface ElectronTerminalAPI {
  create: (options?: { cwd?: string; command?: string; env?: Record<string, string> }) =>
    Promise<{ id: string | null; shell?: string; error?: string }>
  write: (id: string, data: string) => void
  resize: (id: string, cols: number, rows: number) => void
  kill: (id: string) => void
  runCommand: (id: string, command: string) => void
  onData: (callback: (id: string, data: string) => void) => () => void
  onExit: (callback: (id: string, exitCode: number) => void) => () => void
}

export interface ElectronGitAPI {
  isRepo: (cwd: string) => Promise<boolean>
  getRoot: (cwd: string) => Promise<string | null>
  getStatus: (cwd: string) => Promise<GitStatus | null>
  stage: (cwd: string, paths: string[]) => Promise<boolean>
  unstage: (cwd: string, paths: string[]) => Promise<boolean>
  stageAll: (cwd: string) => Promise<boolean>
  unstageAll: (cwd: string) => Promise<boolean>
  commit: (cwd: string, message: string, amend?: boolean) => Promise<{ success: boolean; hash?: string; error?: string }>
  getDiff: (cwd: string, path: string, staged?: boolean) => Promise<GitDiffResult | null>
  getFullDiff: (cwd: string) => Promise<GitFullDiffResult | null>
  getStagedDiff: (cwd: string) => Promise<string>
  showFile: (cwd: string, path: string) => Promise<string | null>
  getBranches: (cwd: string) => Promise<GitBranch[]>
  checkout: (cwd: string, ref: string) => Promise<{ success: boolean; error?: string }>
  createBranch: (cwd: string, name: string, checkoutTo?: boolean) => Promise<{ success: boolean; error?: string }>
  deleteBranch: (cwd: string, name: string, force?: boolean) => Promise<{ success: boolean; error?: string }>
  getLog: (cwd: string, count?: number) => Promise<GitLogEntry[]>
  discardChanges: (cwd: string, paths: string[]) => Promise<boolean>
  pull: (cwd: string) => Promise<{ success: boolean; error?: string }>
  push: (cwd: string) => Promise<{ success: boolean; error?: string }>
  stash: (cwd: string) => Promise<{ success: boolean; error?: string }>
  stashPop: (cwd: string) => Promise<{ success: boolean; error?: string }>
  fetchAll: (cwd: string) => Promise<{ success: boolean; error?: string }>
  watchProject: (cwd: string) => Promise<boolean>
  stopWatch: () => Promise<boolean>
  onStatusChanged: (callback: () => void) => () => void
}

export interface ElectronClaudeCodeAPI {
  startSession: (sessionId: string, config: unknown) => Promise<unknown>
  sendMessage: (sessionId: string, content: string, images?: unknown[]) => Promise<unknown>
  abort: (sessionId: string) => Promise<unknown>
  stop: (sessionId: string) => Promise<unknown>
  suspendSession: (sessionId: string) => Promise<unknown>
  resumeSession: (sessionId: string) => Promise<unknown>
  getSessionStatus: (sessionId: string) => Promise<Record<string, unknown>>
  getActiveSessions: () => Promise<Array<{ sessionId: string }>>
  isSessionActive: (sessionId?: string) => Promise<boolean>
  listAgents: (cwd?: string, engineType?: string) => Promise<Array<{ agentType: string; description: string; source: string; model?: string; color?: string }>>
  isEngineAvailable: (engineType: string) => Promise<boolean>
  installPiSdk: () => Promise<{ success: boolean; error?: string }>
  updateThinkingLevel: (sessionId: string, enabled: boolean) => Promise<void>
  listProjectSessions: (cwd: string) => Promise<unknown[]>
  listAllSessions: () => Promise<unknown[]>
  getFullSession: (projectPath: string, sessionId: string) => Promise<Record<string, unknown>>
  resolveAgentTranscriptPath: (projectPath: string, sessionId: string, agentId: string) => Promise<unknown>
  restoreSession: (sessionId: string, projectPath: string) => Promise<Record<string, unknown>>
  // 事件回调的 data 字段使用 any，与 preload.ts 保持一致；
  // 因 TypeScript 逆变限制，具体类型（如 PermissionRequest）无法赋值给 unknown/Record<string, unknown>。
  onAssistant: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  onUser: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  onSystem: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  onToolUse: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  onToolResult: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  onResult: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  onStreamEvent: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  onLog: (callback: (data: { sessionId: string; data: string }) => void) => () => void
  onExit: (callback: (data: { sessionId: string; data: number | null | { code?: number | null; signal?: string | null; stderr?: string } }) => void) => () => void
  onSuspended: (callback: (data: { sessionId: string; data: { reason: string } }) => void) => () => void
  onEvictionBlocked: (callback: (data: { sessionId: string; data: { reason: string; pendingTools: number } }) => void) => () => void
  submitToolAnswer: (sessionId: string, toolCallId: string, answers: Record<string, string>) => Promise<unknown>
  skipToolAnswer: (sessionId: string, toolCallId: string) => Promise<unknown>
  allowPermission: (sessionId: string, requestId: string, updatedInput?: Record<string, unknown>, decisionClassification?: 'user_temporary' | 'user_permanent') => Promise<unknown>
  denyPermission: (sessionId: string, requestId: string, message?: string, options?: { interrupt?: boolean }) => Promise<unknown>
  respondPermission: (sessionId: string, requestId: string, decision: unknown) => Promise<unknown>
  setPermissionMode: (sessionId: string, mode: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions') => Promise<unknown>
  setModel: (sessionId: string, model: string | undefined) => Promise<unknown>
  getMcpStatus: (sessionId: string) => Promise<unknown>
  getContextUsage: (sessionId: string) => Promise<Record<string, unknown> | undefined>
  getSettings: (sessionId: string) => Promise<unknown>
  stopEngineTask: (sessionId: string, taskId: string) => Promise<unknown>
  getPendingPermissionRequestIds: (sessionId: string) => Promise<unknown>
  onPermissionRequest: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  onPermissionRequestCancelled: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  onElicitationRequest: (callback: (data: { sessionId: string; data: any }) => void) => () => void
  detectInstalledCli: () => Promise<CliDetectionResult | null>
  checkEnvironment: () => Promise<EnvironmentCheckResult | null>
  installCli: () => Promise<{ success: boolean; error?: string } | null>
  onInstallProgress: (callback: (progress: InstallProgress) => void) => () => void
  getProxyStatus: () => Promise<ProxyStatus | null>
  isProxyRunning: () => Promise<boolean>
  notifyEngineSourceChanged: (source: string) => Promise<void>
}

export interface ElectronArtifactsAPI {
  list: (workingDir: string) => Promise<{ artifacts: ArtifactEntry[] }>
  open: (filePath: string) => Promise<{ success: boolean; error?: string }>
  reveal: (filePath: string) => Promise<{ success: boolean }>
  startWatch: (artifactsDir: string) => Promise<boolean>
  stopWatch: () => Promise<boolean>
  onChanged: (callback: (data: { eventType: string; filename: string }) => void) => () => void
}

export interface ElectronOfficeCLIAPI {
  version: () => Promise<string>
  checkInstalled: () => Promise<boolean>
  exec: (options: { args: string[]; cwd?: string; timeout?: number; env?: Record<string, string> }) => Promise<unknown>
  viewHtml: (filePath: string, outputDir?: string) => Promise<string>
  viewScreenshot: (filePath: string, outputDir: string, page?: number) => Promise<string[]>
  watchStart: (filePath: string, port?: number) => Promise<{ id: string; filePath: string; port: number; url: string }>
  watchStop: (watchId: string) => Promise<boolean>
  watchStopAll: () => Promise<number>
  watchList: () => Promise<Array<{ id: string; filePath: string; url: string }>>
  readImageAsDataURL: (filePath: string) => Promise<string>
}

export interface ElectronImageAPI {
  save: (id: string, dataUrl: string) => Promise<{ success: boolean; error?: string }>
  load: (id: string) => Promise<string | null>
}

export interface ElectronLoggerAPI {
  debug: (scope: string, message: string, data?: unknown) => void
  info: (scope: string, message: string, data?: unknown) => void
  warn: (scope: string, message: string, data?: unknown) => void
  error: (scope: string, message: string, data?: unknown) => void
}

export interface ElectronDebugAPI {
  listFiles: () => Promise<DebugFileEntry[]>
  readFile: (filePath: string, maxBytes?: number) => Promise<{ success: boolean; content?: string; error?: string }>
  listTraceSessions: () => Promise<TraceSessionEntry[]>
  readTraceEvents: (sessionId: string, maxEvents?: number) => Promise<{ success: boolean; events?: AgentTraceEvent[]; error?: string }>
}

export interface ElectronTraceAPI {
  event: (event: AgentTraceEvent) => void
  list: (params?: { limit?: number; offset?: number; query?: string }) => Promise<TraceSessionList>
  getTrace: (sessionId: string) => Promise<{ success: boolean; data?: TraceSession; error?: string }>
  getTraceCall: (sessionId: string, callId: string) => Promise<{ call?: TraceCallRecord } | null>
  getSettings: () => Promise<{ enabled: boolean; storageDir: string } | null>
  updateSettings: (settings: { enabled: boolean }) => Promise<{ success: boolean; error?: string }>
  openWindow: (sessionId: string) => void
}

export interface ElectronSessionAPI {
  getTurnCheckpoints: (sessionId: string, projectPath?: string) => Promise<{
    ok: boolean
    checkpoints: SessionTurnCheckpoint[]
    error: string | null
  }>
  getTurnRewindPreviewFiles: (
    sessionId: string,
    targetUserMessageId: string,
    userMessageIndex: number | undefined,
    projectPath?: string
  ) => Promise<{ ok: boolean; files: string[]; error: string | null }>
  getTurnCheckpointDiff: (
    sessionId: string,
    targetUserMessageId: string,
    filePath: string,
    userMessageIndex?: number,
    projectPath?: string
  ) => Promise<TurnCheckpointDiffResult>
  rewindTurn: (
    sessionId: string,
    options: { targetUserMessageId: string; userMessageIndex?: number },
    projectPath?: string
  ) => Promise<{ ok: boolean; error: string | null }>
}

export interface ElectronMcpAPI {
  getServers: () => Promise<unknown>
  addServer: (name: string, server: unknown) => Promise<void>
  updateServers: (servers: Record<string, unknown>) => Promise<void>
  deleteServer: (name: string) => Promise<void>
  toggleEnabled: (name: string, enabled: boolean) => Promise<void>
  reconnectServer: (sessionId: string, serverName: string) => Promise<void>
  toggleServerRuntime: (sessionId: string, serverName: string, enabled: boolean) => Promise<void>
  probeServer: (config: unknown) => Promise<unknown>
  checkDependency: (command: string) => Promise<unknown>
  installDependency: (command: 'uv') => Promise<unknown>
  onInstallProgress: (callback: (progress: unknown) => void) => () => void
  getActiveMcpNames: () => Promise<string[]>
}

export interface ElectronComputerUseAPI {
  getStatus: () => Promise<CuaDriverStatus>
  install: () => Promise<{ success: boolean; error?: string }>
  onInstallProgress: (callback: (progress: { stage: string; message: string; percent: number }) => void) => () => void
  doctor: () => Promise<{ ok: boolean; checks: HealthCheck[] }>
  getPermissions: () => Promise<CuaDriverPermissions>
  grantPermissions: () => Promise<{ success: boolean; error?: string }>
  checkUpdate: () => Promise<CuaDriverUpdateInfo>
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>
}

export interface ElectronBrowserUseAPI {
  getStatus: () => Promise<BrowserUseStatus>
  install: (options?: BrowserUseInstallOptions) => Promise<{ success: boolean; error?: string }>
  onInstallProgress: (callback: (progress: BrowserUseInstallProgress) => void) => () => void
  doctor: () => Promise<{ ok: boolean; checks: BrowserUseHealthCheck[] }>
  checkUpdate: () => Promise<BrowserUseUpdateInfo>
  callTool: (name: string, args: Record<string, unknown>) => Promise<BrowserUseToolResult>
  config: (config?: Record<string, unknown>) => Promise<BrowserUseAgentConfig | null>
  navigate: (url: string) => Promise<BrowserUseToolResult>
  getLiveSnapshot: () => Promise<BrowserUseLiveSnapshot | null>
  onLiveSnapshot: (callback: (snapshot: BrowserUseLiveSnapshot) => void) => () => void
}

export interface ElectronSkillsAPI {
  getSkills: (cwd?: string) => Promise<unknown>
  getBundledSkills: () => Promise<unknown>
  createSkill: (name: string, scope: string, content: string, cwd?: string) => Promise<unknown>
  saveSkill: (skill: unknown, content: string) => Promise<unknown>
  deleteSkill: (filePath: string) => Promise<void>
  searchMarketplace: (query: string) => Promise<unknown>
  installMarketplaceSkill: (source: string, skillId: string, global: boolean, cwd?: string) => Promise<unknown>
  uninstallMarketplaceSkill: (skillName: string, global: boolean, cwd?: string) => Promise<void>
  fetchMarketplaceReadme: (source: string, skillId: string) => Promise<string | null>
  scanLocalLibrary: (dirPaths: string[], cwd?: string) => Promise<unknown>
  installLocal: (skillName: string, scope: string, cwd?: string, skillPath?: string) => Promise<void>
  uninstallLocal: (skillName: string, cwd?: string) => Promise<void>
  installLocalBundle: (bundleId: string, scope: string, cwd?: string) => Promise<void>
  uninstallLocalBundle: (bundleName: string, cwd?: string) => Promise<void>
  getCustomDirs: () => Promise<unknown>
  addCustomDir: (dirPath: string) => Promise<void>
  removeCustomDir: (dirPath: string) => Promise<void>
}

export interface ElectronAgentsAPI {
  scanLibrary: (cwd?: string) => Promise<unknown>
  install: (agentName: string, scope: string, cwd?: string) => Promise<void>
  uninstall: (agentName: string, scope: string, cwd?: string) => Promise<void>
  getInstalled: (cwd?: string) => Promise<unknown>
  listWorkflows: () => Promise<unknown>
  saveWorkflow: (workflow: unknown) => Promise<void>
  deleteWorkflow: (id: string) => Promise<void>
  exportWorkflow: (id: string, scope: string, cwd?: string) => Promise<unknown>
  saveCustom: (agentName: string, content: string) => Promise<{ success: boolean; path: string }>
}

export interface ElectronMobileAPI {
  startServer: () => Promise<{ url: string; token: string; port: number; ip: string }>
  stopServer: () => Promise<void>
  getStatus: () => Promise<{ running: boolean; connected: boolean }>
  onConnected: (cb: (clientInfo: string) => void) => () => void
  onDisconnected: (cb: () => void) => () => void
}

export interface ElectronH5AccessAPI {
  enable: () => Promise<{ status: { running: boolean; port: number; ip: string; publicUrl: string | null; connectedClients: number }; token: string }>
  disable: () => Promise<void>
  regenerateToken: () => Promise<{ status: { running: boolean; port: number; ip: string; publicUrl: string | null; connectedClients: number }; token: string }>
  getStatus: () => Promise<{ running: boolean; port: number; ip: string; publicUrl: string | null; connectedClients: number }>
  getSettings: () => Promise<{ enabled: boolean; token: string | null; tokenPreview: string | null; publicBaseUrl: string | null; fixedPort: number | null }>
  updateSettings: (input: Partial<Pick<{ publicBaseUrl: string | null; fixedPort: number | null }, 'publicBaseUrl' | 'fixedPort'>>) => Promise<{ enabled: boolean; token: string | null; tokenPreview: string | null; publicBaseUrl: string | null; fixedPort: number | null }>
  setMirrorSession: (sessionId: string | null, projectPath: string | null) => Promise<void>
  checkBuild: () => Promise<{ built: boolean; path: string }>
}

export interface RtkStatus {
  binaryInstalled: boolean
  version: string | null
  hookInstalled: boolean
  platform: NodeJS.Platform
  binaryPath: string
  isWindows: boolean
}

export interface RtkGainStats {
  totalCommands?: number
  totalSavedTokens?: number
  totalSavedUsd?: number
  saveRate?: number
  daily?: Array<{ date: string; commands: number; savedTokens: number }>
  byCommand?: Record<string, { commands: number; savedTokens: number }>
}

export interface RtkUpdateInfo {
  current: string | null
  latest: string
  hasUpdate: boolean
}

export interface ElectronRtkAPI {
  getStatus: () => Promise<RtkStatus>
  enable: () => Promise<{ success: boolean; error?: string; status: RtkStatus }>
  disable: () => Promise<{ success: boolean; error?: string; status: RtkStatus }>
  downloadBinary: () => Promise<{ success: boolean; error?: string; status?: RtkStatus }>
  getStats: () => Promise<RtkGainStats | null>
  checkUpdate: () => Promise<RtkUpdateInfo | null>
  getBinaryPath: () => Promise<string>
  onDownloadProgress: (callback: (progress: { downloaded: number; total: number; percent: number }) => void) => () => void
}

export interface ElectronUpdateAPI {
  check: () => Promise<{ success: boolean; error?: string }>
  download: () => Promise<{ success: boolean; error?: string }>
  installAndRestart: () => void
  onAvailable: (callback: (info: { version: string; releaseDate: string; releaseNotes: string; releaseName?: string }) => void) => () => void
  onNotAvailable: (callback: () => void) => () => void
  onDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void
  onDownloaded: (callback: (info: { version: string }) => void) => () => void
  onError: (callback: (error: string) => void) => () => void
}

export interface ElectronCronAPI {
  list: (projectRoot: string) => Promise<CronTask[]>
  create: (projectRoot: string, task: Omit<CronTask, 'id'>) => Promise<CronTask | null>
  update: (projectRoot: string, id: string, updates: Partial<CronTask>) => Promise<void>
  delete: (projectRoot: string, id: string) => Promise<void>
  run: (projectRoot: string, id: string) => Promise<{ success: boolean; error?: string } | null>
  runs: (projectRoot: string, limit?: number) => Promise<CronRunEntry[]>
  taskRuns: (projectRoot: string, taskId: string) => Promise<CronRunEntry[]>
  validate: (cron: string) => Promise<{ valid: boolean; error?: string }>
  describe: (cron: string) => Promise<string>
  onTaskFired: (callback: (data: { taskId: string; taskName: string; [key: string]: unknown }) => void) => () => void
  onRunCompleted: (callback: (data: { runId: string; taskId: string; status: string; [key: string]: unknown }) => void) => () => void
}

// ── 主接口 ──────────────────────────────────────────────────────

export interface ElectronAPI {
  platform: string

  sendMessage: (text: string) => Promise<unknown>
  onMessage: (callback: (msg: unknown) => void) => void
  getAppState: () => Promise<unknown>

  window: ElectronWindowAPI

  readDir: (dirPath: string) => Promise<FileEntry[]>
  readFile: (filePath: string) => Promise<string | null>
  readFileAsBase64: (filePath: string) => Promise<string | null>
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  stat: (filePath: string) => Promise<FileStat | null>
  searchFiles: (dirPath: string, query: string, options?: { maxResults?: number }) => Promise<FileSearchEntry[]>
  copyFile: (srcPath: string, destPath: string) => Promise<{ success: boolean; error?: string }>
  moveFile: (srcPath: string, destPath: string) => Promise<{ success: boolean; error?: string }>
  renameFile: (filePath: string, newName: string) => Promise<{ success: boolean; error?: string; newPath?: string }>
  deleteFile: (filePath: string, permanent?: boolean) => Promise<{ success: boolean; error?: string }>

  getEnv: (key: string) => Promise<string | undefined>

  showDiff: (diff: unknown) => void
  onDiffRequested: (callback: (diff: unknown) => void) => void

  showInfoPanel: (mode: 'diff' | 'file' | 'markdown' | 'tool-diff' | 'webview') => void
  hideInfoPanel: () => void
  onShowInfoPanel: (callback: (mode: string) => void) => void
  onHideInfoPanel: (callback: () => void) => void

  onToolResult: (callback: (result: unknown) => void) => void

  onMenuNewChat: (callback: () => void) => void
  onMenuOpenFolder: (callback: (path: string) => void) => void
  onMenuCloseFolder: (callback: () => void) => void

  openExternal: (url: string) => Promise<void>
  openInEditor: (editor: ExternalEditor, targetPath: string) => Promise<{ success: boolean; error?: string }>

  httpFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) =>
    Promise<{ ok: boolean; status: number; data: string; error?: string } | null>

  getCwd: () => Promise<string>
  getClaudeCliPath: () => Promise<string | null>
  getPiCliPath: () => Promise<string | null>

  injectGuiModelsToSettings: (models: {
    primaryModel: string
    haikuModel?: string
    sonnetModel?: string
    opusModel?: string
    effortLevel?: 'low' | 'medium' | 'high' | 'max'
    permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'
  }) => Promise<{ success: boolean; error?: string }>

  saveGuiSettings: (data: string) => Promise<{ success: boolean; error?: string }>
  loadGuiSettings: () => Promise<{ success: boolean; data: string | null; error?: string }>

  loadHooksSettings: (scope?: string) => Promise<{ success: boolean; data: string | null; error?: string }>
  saveHooksSettings: (hooksJson: string, scope?: string) => Promise<{ success: boolean; error?: string }>
  getBuiltinHooksRoot: () => Promise<{ success: boolean; path?: string; error?: string }>
  checkNode: () => Promise<{ success: boolean; version?: string; error?: string }>

  getTokenUsageStats: () => Promise<{ success: boolean; data?: TokenStatsResult; error?: string }>

  selectFolder: () => Promise<{ canceled: boolean; filePaths: string[] }>
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>

  ensureDefaultWorkspace: () => Promise<string>
  ensureDir: (dirPath: string) => Promise<boolean>

  optimizePrompt: (prompt: string, options?: { workingDirectory?: string }) =>
    Promise<{ success: boolean; result?: string; error?: string }>

  terminal: ElectronTerminalAPI
  git: ElectronGitAPI
  claudeCode: ElectronClaudeCodeAPI
  artifacts: ElectronArtifactsAPI
  officecli: ElectronOfficeCLIAPI
  image: ElectronImageAPI
  logger: ElectronLoggerAPI
  debug: ElectronDebugAPI
  trace: ElectronTraceAPI
  session: ElectronSessionAPI
  mcp: ElectronMcpAPI
  computerUse: ElectronComputerUseAPI
  browserUse: ElectronBrowserUseAPI
  skills: ElectronSkillsAPI
  agents: ElectronAgentsAPI
  mobile: ElectronMobileAPI
  h5Access: ElectronH5AccessAPI
  rtk: ElectronRtkAPI
  update: ElectronUpdateAPI
  cron: ElectronCronAPI

  changelog: {
    getReleaseNotes: (version: string) => Promise<{ content: string; source: 'local' | 'remote' } | null>
  }

  getAppVersion: () => Promise<string>

  app: {
    getPath: (name: string) => Promise<string>
  }

  shell: {
    openExternal: (url: string) => Promise<void>
    openPath: (path: string) => Promise<void>
  }

  showNotification: (options: { title: string; message: string }) => void

  design: {
    listSystems: () => Promise<DesignSystemSummary[]>
    getSystemPreview: (systemId: string, pagePath: string) => Promise<string>
    getSystemFile: (systemId: string, filePath: string) => Promise<string>
    getSystemShowcase: (systemId: string) => Promise<string>
    getSystemTokensHtml: (systemId: string) => Promise<string>
    composePromptStack: (input: {
      designSystemId?: string
      skillBody?: string
      skillName?: string
      locale: string
    }) => Promise<string>
    startFileWatcher: (sessionId: string, workspacePath: string) => Promise<void>
    stopFileWatcher: () => Promise<void>
    exportArtifact: (options: { filePath: string; format: 'html' | 'zip' | 'pdf' }) => Promise<void>
    onFileChanged: (callback: (event: { sessionId: string; filepath: string }) => void) => () => void
  }
}

// ── Window 全局声明 ─────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI: ElectronAPI | undefined
  }
}

export {}
