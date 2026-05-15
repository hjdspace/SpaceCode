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

export interface MessageMetadata {
  model?: string
  inputTokens?: number
  outputTokens?: number
  duration?: number
  warning?: string
  error?: ClassifiedError
}

export type ProcessStatus = 'none' | 'starting' | 'active' | 'idle' | 'suspended' | 'exited'

export type SessionEngineType = 'claude-code' | 'pi'

export interface Session {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  workingDirectory?: string
  engineSessionId?: string
  /** Engine that currently owns the live process for this session (if any). */
  engineType?: SessionEngineType
  processStatus: ProcessStatus
  isTabOpen: boolean
  lastActivityAt: number
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
  kind?: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command'
  immediate?: boolean
  aliases?: string[]
}

export interface CommandBadge {
  command: string
  label: string
  description: string
  kind: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command'
}

// ─── Agent Types ──────────────────────────────────────────────────

export interface AgentInfo {
  agentType: string
  description: string
  source: 'built-in' | 'user' | 'project' | 'plugin'
  model?: string
  color?: string
}