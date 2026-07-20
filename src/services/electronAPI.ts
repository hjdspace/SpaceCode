/**
 * electronAPI — 渲染进程访问 Electron 主进程 IPC 桥接的统一聚合层。
 *
 * 本模块是 thin aggregator：
 * - 类型定义集中在此文件（被 src/types/electron.d.ts 等消费）
 * - 按领域拆分的命名空间位于 ./api/*.ts（每个 < 100 行）
 * - 共享运行时状态（electronAPI、_isH5Mode、h5Adapter）位于 ./api/_context.ts
 * - 扁平方法（无子命名空间的方法）保留在此文件
 * - 通过 spread 组合命名空间对象到 api 导出
 */
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

export type {
  CuaDriverStatus,
  CuaDriverUpdateInfo,
  CuaDriverPermissions,
  HealthCheck,
  McpToolResult,
} from '@/types/computerUse'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface ArtifactEntry {
  name: string
  path: string
  ext: string
  size: number
  mtime: number
}

export interface PreviewPage {
  path: string
  role: string
  title: string
}

export interface DesignSystemSwatch {
  name: string
  value: string
}

export interface DesignSystemSummary {
  id: string
  name: string
  category: string
  description?: string
  previewPages: PreviewPage[]
  swatches?: DesignSystemSwatch[]
  officialUrl?: string
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

export interface GitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  content?: string
  [key: string]: unknown
}

export interface GitDiffResult {
  path?: string
  hunks?: GitDiffHunk[]
  additions?: number
  deletions?: number
  [key: string]: unknown
}

export interface GitFullDiffFileStats {
  path: string
  linesAdded: number
  linesRemoved: number
  isBinary: boolean
  isUntracked?: boolean
  isStaged?: boolean
  [key: string]: unknown
}

export interface GitFullDiffResult {
  stats: {
    filesCount: number
    linesAdded: number
    linesRemoved: number
  }
  files: GitFullDiffFileStats[]
  hunks: Record<string, GitDiffHunk[]>
  [key: string]: unknown
}

export interface GitStatusFile {
  path: string
  originalPath?: string
  index?: string
  working_dir?: string
  statusCode: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored' | 'conflict'
  staged: boolean
  isTracked: boolean
  [key: string]: unknown
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  upstream?: string | null
  ahead: number
  behind: number
  staged: GitStatusFile[]
  unstaged: GitStatusFile[]
  untracked: GitStatusFile[]
  conflicted: GitStatusFile[]
  [key: string]: unknown
}

export interface GitBranch {
  name: string
  current: boolean
  isRemote: boolean
  commit?: string
  upstream?: string
  ahead?: number
  behind?: number
  [key: string]: unknown
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  subject: string
  message: string
  author: string
  date: string
  refs: string
  [key: string]: unknown
}

export interface CronTask {
  id: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: number
  recurring?: boolean
  permanent?: boolean
  name?: string
  description?: string
  enabled?: boolean
  frequency?: string
  scheduledTime?: string
  command?: string
  projectRoot?: string
  [key: string]: unknown
}

export interface CronRunEntry {
  id: string
  taskId: string
  taskName: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  startedAt: string
  completedAt?: string
  prompt: string
  output?: string
  error?: string
  durationMs?: number
  sessionId?: string
  [key: string]: unknown
}

export interface CliDetectionResult {
  available: boolean
  path: string | null
  version: string | null
  versionCompatible?: boolean
  [key: string]: unknown
}

export interface EnvironmentCheckResult {
  node: { available: boolean; version: string | null; path: string | null }
  npm: { available: boolean; version: string | null; path: string | null }
  git: { available: boolean; version: string | null; path: string | null }
  [key: string]: unknown
}

export interface ProxyStatus {
  running: boolean
  port: number
  pid?: number
  requestsProcessed: number
  errorsCount: number
  lastError?: string
  [key: string]: unknown
}

export interface InstallProgress {
  stage: 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  message: string
  percent?: number
  [key: string]: unknown
}

// ── 共享运行时状态（由 _context.ts 初始化 H5 适配器） ──
import { electronAPI, _isH5Mode, h5Adapter } from './api/_context'
import { h5ApiClient } from './h5ApiClient'
import type { ElectronClaudeCodeAPI } from '@/types/electron'

// ── 按领域拆分的命名空间 ──
import { agents } from './api/agents'
import { artifacts } from './api/artifacts'
import { app as appApi } from './api/app'
import { browserUse } from './api/browserUse'
import { changelog } from './api/changelog'
import { computerUse } from './api/computerUse'
import { cron } from './api/cron'
import { debug } from './api/debug'
import { design } from './api/design'
import { git } from './api/git'
import { h5Access } from './api/h5Access'
import { mcp } from './api/mcp'
import { mobile } from './api/mobile'
import { officecli } from './api/officecli'
import { petApi } from './api/pet'
import { rtk } from './api/rtk'
import { session } from './api/session'
import { shell } from './api/shell'
import { skills } from './api/skills'
import { terminal } from './api/terminal'
import { trace } from './api/trace'
import { update } from './api/update'

export const api = {
  // ── 扁平方法（无子命名空间） ──
  sendMessage: (text: string) => electronAPI?.sendMessage(text) || Promise.resolve({ success: false }),
  onMessage: (callback: (msg: unknown) => void) => electronAPI?.onMessage(callback),
  getAppState: () => electronAPI?.getAppState() || Promise.resolve({ sessions: [], currentSessionId: null, theme: 'dark' }),
  readDir: (dirPath: string): Promise<FileEntry[]> => {
    if (electronAPI?.readDir) return electronAPI.readDir(dirPath)
    if (_isH5Mode) return h5ApiClient.readDir(dirPath)
    return Promise.resolve([])
  },
  readFile: (filePath: string): Promise<string | null> => {
    if (electronAPI?.readFile) return electronAPI.readFile(filePath)
    if (_isH5Mode) return h5ApiClient.readFile(filePath)
    return Promise.resolve(null)
  },
  readFileAsBase64: (filePath: string): Promise<string | null> => {
    if (electronAPI?.readFileAsBase64) return electronAPI.readFileAsBase64(filePath)
    if (_isH5Mode) return h5ApiClient.readFileAsBase64(filePath)
    return Promise.resolve(null)
  },
  writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.writeFile(filePath, content) || Promise.resolve({ success: false, error: 'writeFile not available' }),
  stat: (filePath: string): Promise<FileStat | null> => {
    if (electronAPI?.stat) return electronAPI.stat(filePath)
    if (_isH5Mode) return h5ApiClient.stat(filePath)
    return Promise.resolve(null)
  },
  searchFiles: (dirPath: string, query: string, options?: { maxResults?: number }): Promise<FileSearchEntry[]> => {
    if (electronAPI?.searchFiles) {
      return electronAPI.searchFiles(dirPath, query, options)
    }
    if (_isH5Mode) {
      return h5ApiClient.searchFiles(dirPath, query, options)
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
  showDiff: (diff: unknown) => electronAPI?.showDiff(diff),
  onDiffRequested: (callback: (diff: unknown) => void) => electronAPI?.onDiffRequested(callback),
  showInfoPanel: (mode: 'diff' | 'file' | 'markdown' | 'tool-diff' | 'webview') => electronAPI?.showInfoPanel(mode),
  hideInfoPanel: () => electronAPI?.hideInfoPanel(),
  onShowInfoPanel: (callback: (mode: string) => void) => electronAPI?.onShowInfoPanel(callback),
  onHideInfoPanel: (callback: () => void) => electronAPI?.onHideInfoPanel(callback),
  onToolResult: (callback: (result: unknown) => void) => electronAPI?.onToolResult(callback),
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
    if (_isH5Mode) {
      return h5ApiClient.httpFetch(url, options)
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
    // H5 模式：保存到 localStorage
    if (_isH5Mode) {
      localStorage.setItem('claude_desktop_settings', data)
      return Promise.resolve({ success: true })
    }
    return Promise.resolve({ success: false, error: 'saveGuiSettings not available' })
  },
  loadGuiSettings: (): Promise<{ success: boolean; data: string | null; error?: string }> => {
    if (electronAPI?.loadGuiSettings) {
      return electronAPI.loadGuiSettings()
    }
    // H5 模式：从 localStorage 读取（由 h5Bootstrap 注入）
    if (_isH5Mode) {
      const data = localStorage.getItem('claude_desktop_settings')
      return Promise.resolve({ success: true, data })
    }
    return Promise.resolve({ success: false, data: null, error: 'loadGuiSettings not available' })
  },
  profilesLoad: (): Promise<{ success: boolean; data: string | null; error?: string }> => {
    if (electronAPI?.profilesLoad) {
      return electronAPI.profilesLoad()
    }
    // H5 模式：从 localStorage 读取
    if (_isH5Mode) {
      const data = localStorage.getItem('spacecode_profiles')
      return Promise.resolve({ success: true, data })
    }
    return Promise.resolve({ success: false, data: null, error: 'profilesLoad not available' })
  },
  profilesSave: (data: string): Promise<{ success: boolean; error?: string }> => {
    if (electronAPI?.profilesSave) {
      return electronAPI.profilesSave(data)
    }
    // H5 模式：保存到 localStorage
    if (_isH5Mode) {
      localStorage.setItem('spacecode_profiles', data)
      return Promise.resolve({ success: true })
    }
    return Promise.resolve({ success: false, error: 'profilesSave not available' })
  },
  profilesBackupCorrupt: (data: string): Promise<{ success: boolean; backupPath?: string; error?: string }> => {
    if (electronAPI?.profilesBackupCorrupt) {
      return electronAPI.profilesBackupCorrupt(data)
    }
    if (_isH5Mode) {
      console.warn('[profiles] Corrupt data backup skipped in H5 mode')
      return Promise.resolve({ success: true })
    }
    return Promise.resolve({ success: false, error: 'profilesBackupCorrupt not available' })
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

  // Work workspace helpers
  ensureDefaultWorkspace: (): Promise<string> => {
    if (electronAPI?.ensureDefaultWorkspace) {
      return electronAPI.ensureDefaultWorkspace()
    }
    return Promise.resolve('')
  },
  ensureDir: (dirPath: string): Promise<boolean> => {
    if (electronAPI?.ensureDir) {
      return electronAPI.ensureDir(dirPath)
    }
    return Promise.resolve(false)
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

  // ClaudeCode bridge methods (flat, delegating to electronAPI.claudeCode)
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

  detectInstalledCli: (): Promise<CliDetectionResult | null> => {
    if (electronAPI?.claudeCode?.detectInstalledCli) {
      return electronAPI.claudeCode.detectInstalledCli()
    }
    return Promise.resolve(null)
  },

  checkEnvironment: (): Promise<EnvironmentCheckResult | null> => {
    if (electronAPI?.claudeCode?.checkEnvironment) {
      return electronAPI.claudeCode.checkEnvironment()
    }
    return Promise.resolve(null)
  },

  installCli: (): Promise<{ success: boolean; error?: string } | null> => {
    if (electronAPI?.claudeCode?.installCli) {
      return electronAPI.claudeCode.installCli()
    }
    return Promise.resolve(null)
  },

  onInstallProgress: (callback: (progress: InstallProgress) => void): (() => void) => {
    if (electronAPI?.claudeCode?.onInstallProgress) {
      return electronAPI.claudeCode.onInstallProgress(callback)
    }
    return () => {}
  },

  getProxyStatus: (): Promise<ProxyStatus | null> => {
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

  // App version
  getAppVersion: (): Promise<string> => {
    if (electronAPI?.getAppVersion) {
      return electronAPI.getAppVersion()
    }
    return Promise.resolve('0.0.0')
  },

  // getCwd — get current working directory from main process
  getCwd: (): Promise<string> => {
    if (electronAPI?.getCwd) {
      return electronAPI.getCwd()
    }
    return Promise.resolve('/')
  },

  // Notification API
  showNotification: (options: { title: string; message: string }): void => {
    if (electronAPI?.showNotification) {
      electronAPI.showNotification(options)
    }
  },

  // ── 命名空间对象（从 ./api/*.ts 导入） ──
  agents,
  artifacts,
  browserUse,
  changelog,
  computerUse,
  cron,
  debug,
  design,
  git,
  h5Access,
  mcp,
  mobile,
  officecli,
  pet: petApi,
  rtk,
  session,
  shell,
  skills,
  terminal,
  trace,
  update,
  app: appApi,

  // ── 直接访问器（getter） ──
  // ClaudeCode API — direct access to the claudeCode IPC bridge
  // Used by chat.ts for session lifecycle, streaming, and permission management.
  // Returns null when running outside Electron (SSR / unit tests).
  // In H5 mode, returns the H5 adapter instead of the IPC bridge.
  get claudeCode(): ElectronClaudeCodeAPI | null {
    if (h5Adapter) return h5Adapter
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
}
