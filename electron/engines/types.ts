import type { BrowserWindow } from 'electron'

export type EngineType = 'claude-code' | 'pi'

export interface EngineSessionConfig {
  cwd: string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  thinkingEnabled?: boolean
  effortLevel?: string
  systemPrompt?: string
  appendSystemPrompt?: string
  agent?: string
  engineType?: EngineType
  resumeSessionId?: string
  engineSource?: 'bundled' | 'installed'
  installedCliPath?: string
  /** Per-model context window overrides (modelId → token count). */
  modelContextWindows?: Record<string, number>
  /** 是否启用 RTK (Rust Token Killer) token 优化 */
  rtkEnabled?: boolean
}

export interface UnifiedEngineEvent {
  sessionId: string
  type:
    | 'assistant'
    | 'tool_use'
    | 'tool_result'
    | 'stream_event'
    | 'result'
    | 'system'
    | 'error'
    | 'exit'
    | 'log'
    | 'suspended'
    | 'eviction_blocked'
    | 'user'
    | 'compact'
    | 'api_retry'
    | 'permission_request'
    | 'permission_request_cancelled'
    | 'elicitation_request'
  data: any
}

export interface EngineSessionStatus {
  sessionId: string
  engineSessionId: string | null
  status: 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
  isRunning: boolean
  permissionMode?: PermissionMode
}

export interface ImageAttachment {
  id: string
  name: string
  type: 'image'
  mimeType: string
  previewUrl: string
  data: string
}

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

export type PermissionDecision =
  | {
      behavior: 'allow'
      updatedInput: Record<string, unknown>
      updatedPermissions?: unknown[]
      decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
    }
  | {
      behavior: 'deny'
      message: string
      interrupt?: boolean
      decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
    }

export interface IEngine {
  readonly type: EngineType
  startSession(sessionId: string, config: EngineSessionConfig): Promise<void>
  sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void>
  abort(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  suspendSession?(sessionId: string): void
  resumeSession?(sessionId: string): Promise<void>
  getSessionStatus(sessionId: string): EngineSessionStatus | null
  getActiveSessions(): EngineSessionStatus[]
  listAgents?(cwd?: string): Promise<AgentInfo[]>
  setMainWindow(window: BrowserWindow): void
  submitToolAnswer?(sessionId: string, toolCallId: string, answers: Record<string, string>): Promise<void>
  skipToolAnswer?(sessionId: string, toolCallId: string): Promise<void>

  // ── can_use_tool / control_request 协议（可选；目前仅 Claude Code 引擎实现）──
  respondPermission?(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>
  allowPermission?(
    sessionId: string,
    requestId: string,
    updatedInput?: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
  ): Promise<void>
  denyPermission?(
    sessionId: string,
    requestId: string,
    message?: string,
    options?: { interrupt?: boolean },
  ): Promise<void>
  setPermissionMode?(sessionId: string, mode: PermissionMode): Promise<void>
  setModel?(sessionId: string, model: string | undefined): Promise<void>
  getMcpStatus?(sessionId: string): Promise<Record<string, unknown> | undefined>
  getContextUsage?(sessionId: string): Promise<Record<string, unknown> | undefined>
  getSettings?(sessionId: string): Promise<Record<string, unknown> | undefined>
  stopEngineTask?(sessionId: string, taskId: string): Promise<void>
  getPendingPermissionRequestIds?(sessionId: string): string[]
}

export interface AgentInfo {
  agentType: string
  description: string
  source: 'built-in' | 'user' | 'project' | 'plugin'
  model?: string
  color?: string
}
