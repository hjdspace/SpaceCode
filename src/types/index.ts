export enum ErrorCategory {
  RATE_LIMIT = 'rate_limit',
  SERVER_ERROR = 'server_error',
  AUTH_ERROR = 'auth_error',
  NETWORK_ERROR = 'network_error',
  TIMEOUT = 'timeout',
  PROCESS_ERROR = 'process_error',
  DATA_ERROR = 'data_error',
  CONFIG_ERROR = 'config_error',
  BASE_URL_ERROR = 'base_url_error',
  UNKNOWN = 'unknown',
}

export interface ClassifiedError {
  category: ErrorCategory
  title: string
  message: string
  technicalDetail: string
  retryable: boolean
  retryDelay?: number
  originalError: any
  timestamp: number
}

export interface ErrorContext {
  sessionId?: string
  provider?: string
  model?: string
  baseUrl?: string
  phase?: 'init' | 'send' | 'stream' | 'tool'
}

export interface ToastItem {
  id: string
  category: ErrorCategory
  title: string
  message: string
  autoDismiss: boolean
  dismissAfter: number
  createdAt: number
}

export interface ErrorLogEntry {
  id: string
  category: ErrorCategory
  title: string
  technicalDetail: string
  timestamp: number
  sessionId?: string
  resolved: boolean
}

export interface ImageAttachment {
  id: string
  name: string
  type: 'image'
  mimeType: string
  previewUrl: string
  data: string // Base64 encoded image data
}

export interface Attachment {
  name: string
  path: string
  isFolder: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  reasoning?: ReasoningBlock
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timelineEvents?: MessageTimelineEvent[]
  metadata?: MessageMetadata
  attachments?: (Attachment | ImageAttachment)[]
  imageAttachments?: ImageAttachment[]
}

export interface MessageTimelineEvent {
  id: string
  type: 'reasoning' | 'text' | 'tool_call' | 'metadata'
  timestamp: number
  status: 'pending' | 'running' | 'completed' | 'error'
  content?: string
  toolCallId?: string
}

export interface ReasoningBlock {
  content: string
  startTime: number
  endTime?: number
  isExpanded?: boolean
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
  output?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  startTime?: number
  endTime?: number
  terminalId?: string
  isInteractive?: boolean
}

export interface ToolResult {
  id: string
  output: string
  isError?: boolean
}

/** 产物汇总卡片的单条文件项（与 electronAPI 的 ArtifactEntry 形态一致，随消息持久化）。 */
export interface ArtifactSummaryEntry {
  name: string
  path: string
  ext: string
  size: number
  mtime: number
}

/** 自动重试状态：遇到可恢复错误时在聊天页展示错误信息 + "正在重试 (n/m)"。 */
export interface RetryState {
  /** 当前重试次数（1-based，0 表示尚未重试） */
  attempt: number
  /** 最大重试次数 */
  maxRetries: number
  /** 触发重试的错误分类（用于 UI 颜色 / 图标） */
  errorCategory: ErrorCategory
  /** 错误标题（如"请求过于频繁"），展示给用户 */
  errorTitle: string
  /** 错误描述（如"API 返回 429 速率限制错误"），展示给用户 */
  errorMessage: string
  /** 本次退避延迟（ms） */
  delayMs: number
  /** 重试发起时间戳 */
  startedAt: number
  /** 用户是否手动取消重试 */
  aborted: boolean
}

export interface MessageMetadata {
  model?: string
  // Cumulative-per-turn usage from SDK `result.usage`. Suitable for
  // session-wide totals (sums across messages give grand totals), but NOT
  // suitable for context-fill calculation because cache reads accumulate
  // across iterations within one turn.
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  // Per-API-call usage from the LAST `assistant` event of the turn. This
  // mirrors what claude-code's `getCurrentUsage` returns and is the
  // authoritative source for context-fill calculation
  // (input + cache_creation + cache_read).
  apiCallUsage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
  duration?: number
  warning?: string
  error?: ClassifiedError
  kind?: 'task-notification' | 'teammate-message'
  agentTaskId?: string
  agentName?: string
  teamName?: string
  status?: TeammateStatus
  /** 办公模式：本回合新生成/修改的产物文件（仅 work 模式会话写入）。 */
  artifacts?: ArtifactSummaryEntry[]
  /** 自动重试状态：非空时 UI 渲染 RetryIndicator 组件 */
  retryState?: RetryState
}

export type ProcessStatus = 'none' | 'starting' | 'active' | 'idle' | 'suspended' | 'exited'

export type SessionEngineType = 'claude-code' | 'pi'

export type AgentColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan'

export type TeammateStatus = 'running' | 'completed' | 'failed' | 'idle'

export interface TeamContext {
  teamName: string
  isLeader: boolean
  teammates: Record<string, {
    name: string
    agentType?: string
    status: TeammateStatus
    color: AgentColor
    messageCount: number
  }>
}

export interface Session {
  id: string
  title: string
  messages: Message[]
  teamContext?: TeamContext
  expandedView?: 'none' | 'tasks' | 'teammates'
  viewingAgentTaskId?: string
  teammateTranscripts?: Record<string, Message[]>
  createdAt: number
  updatedAt: number
  workingDirectory?: string
  engineSessionId?: string
  /** Engine that currently owns the live process for this session (if any). */
  engineType?: SessionEngineType
  processStatus: ProcessStatus
  isTabOpen: boolean
  lastActivityAt: number
  /** Temporary: set when switching engines to resume the previous session on the new engine. */
  _resumeSessionId?: string
  /** Work / Code 模式归属（旧会话无此字段时视为 'code'）。 */
  mode?: 'work' | 'code'
  /** Work 模式下绑定的专业助手 id。 */
  assistantId?: string
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  isExpanded?: boolean
}

export interface DiffInfo {
  oldPath: string
  newPath: string
  oldContent: string
  newContent: string
  hunks: DiffHunk[]
}

export interface DiffHunk {
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldNumber?: number
  newNumber?: number
}

// ─── Slash Command Types ─────────────────────────────────────────

// Re-export CommandKind from constants to avoid duplication
export type { CommandKind } from '@/lib/constants/commands'

export interface SlashCommand {
  name: string
  description: string
  icon: string
  kind?: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command' | 'mcp_tool'
  immediate?: boolean
  aliases?: string[]
  source?: 'builtin' | 'bundled' | 'global' | 'project' | 'plugin' | 'mcp'
}

export interface CommandBadge {
  command: string
  label: string
  description: string
  kind: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command' | 'mcp_tool'
  source?: 'builtin' | 'bundled' | 'global' | 'project' | 'plugin' | 'mcp'
}

// ─── Agent Types ──────────────────────────────────────────────────

export interface AgentInfo {
  agentType: string
  description: string
  source: 'built-in' | 'user' | 'project' | 'plugin'
  model?: string
  color?: string
}

export * from './turnCheckpoint'
export * from './rewind'