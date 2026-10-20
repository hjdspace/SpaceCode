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
  /**
   * 后台任务在本次取数快照**之后**到达的终态，由 task_notification 回填。
   * 只作旁挂事实，绝不写进 output —— output 是模型当时看到的快照。
   */
  taskFinalStatus?: 'completed' | 'failed'
  /** 该终态通知的到达时间（ms） */
  taskFinalAt?: number
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

/** 回合窗口内检测到、但无直接写文件事件归属的改动（见 MessageMetadata.commandFiles）。 */
export interface SessionCommandFile {
  /** 相对仓库根的路径，正斜杠 */
  path: string
  /** 检测到改动的时间（文件 mtime） */
  at: number
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
  /** 从实际错误中提取的展示用错误码（如 "429"、"500"、"网络错误"） */
  errorCode?: string
  /** 本次退避延迟（ms） */
  delayMs: number
  /** 重试发起时间戳 */
  startedAt: number
  /** 用户是否手动取消重试 */
  aborted: boolean
  /** 触发本次重试的助手消息 ID，用于在 onAssistant 中识别重试是否已成功完成 */
  assistantMessageId?: string
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
  // (input + cache_creation + cache_read + output).
  apiCallUsage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
  duration?: number
  warning?: string
  error?: ClassifiedError
  kind?: 'task-notification' | 'teammate-message' | 'goal-notice' | 'skill-invocation'
  agentTaskId?: string
  agentName?: string
  teamName?: string
  status?: TeammateStatus
  /** 技能调用消息：记录被调用的技能名 */
  skillName?: string
  /** 本回合新生成/修改的产物文件（回合结算时按会话工作目录收集，见 utils/artifactScope）。 */
  artifacts?: ArtifactSummaryEntry[]
  /**
   * 本回合期间被改过、但没有直接 Write/Edit 事件可归属的文件
   * （Bash、格式化、子代理写入）。判据是文件 mtime 落在回合窗口内。
   *
   * 置信度低于工具事件：同仓库并行会话在窗口内的写入也会落在这里，
   * 由 fileWriteLedger 裁决最后写入者。存进消息 metadata 是为了重启后
   * 仍能还原 —— 这类信息无法从 JSONL 历史反推。
   */
  commandFiles?: SessionCommandFile[]
  /** 自动重试状态：供内部重试流程跟踪，不直接展示给用户 */
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
  /** Engine source (bundled vs installed) used when starting this session. */
  engineSource?: 'bundled' | 'installed'
  processStatus: ProcessStatus
  isTabOpen: boolean
  lastActivityAt: number
  /** Temporary: set when switching engines to resume the previous session on the new engine. */
  _resumeSessionId?: string
  /** Work / Code / Design 模式归属（旧会话无此字段时视为 'code'）。 */
  mode?: 'work' | 'code' | 'design'
  /** Work 模式下绑定的专业助手 id。 */
  assistantId?: string
  /** 用户在当前会话中选择的模型（来自输入框下拉框）。 */
  model?: string
  /**
   * 本会话的权限模式。缺省 = 该会话从没主动切过，取全局默认。
   * 刻意按会话存：一个会话切模式不得改写另一个会话正在跑的模式。
   */
  permissionMode?: import('@/shared/channels/claudeCode').PermissionMode
  /** Provider/base URL used by the live engine process for this session. */
  provider?: string
  baseUrl?: string
  /**
   * 上次 startSession 实际下发的启动配置指纹（systemPrompt / agent / 凭据）。
   * 只存哈希，不存提示词栈原文与 API Key 明文；运行中会话据此判断是否需要重启。
   */
  startupFingerprint?: SessionStartupFingerprint
  /**
   * 引擎回报「没能按这个 agent 运行」时，记下那个 agent 的名字。缺省 = 没有未生效的账要还。
   * 存名字而不是布尔：徽章展示的是全局所选的 agent，只有同名时才许给它加未生效的样式，
   * 否则就是把 A 会话的失败挂到 B 会话的名字上 (#46)。
   */
  agentUnapplied?: string
  /** 侧边任务会话：不落盘、不出现在会话列表，关闭应用即消失。 */
  ephemeral?: boolean
}

export interface SessionStartupFingerprint {
  systemPrompt: string
  agent: string
  /** 代理模式下引擎侧是占位 Key，凭据由本地代理层对账，故为 undefined。 */
  credential?: string
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
