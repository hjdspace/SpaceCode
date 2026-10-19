import type { BrowserWindow } from 'electron'
import type { PermissionUpdate, ThinkingUpdateTiming } from '@/shared/channels/claudeCode'
import type { EffortLevel } from '@/shared/effort'

// 引擎实现统一从本模块取协议类型；定义仍在 src/shared（IPC 单一真相源）。
export type { PermissionUpdate, ThinkingUpdateTiming }
export type { EffortLevel }

export type EngineType = 'claude-code' | 'pi'

export interface EngineSessionConfig {
  cwd: string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  thinkingEnabled?: boolean
  effortLevel?: EffortLevel
  systemPrompt?: string
  appendSystemPrompt?: string
  agent?: string
  engineType?: EngineType
  resumeSessionId?: string
  engineSource?: 'bundled' | 'installed'
  installedCliPath?: string
  /** 会话起始权限模式；sessionProcess 据此下发 --permission-mode（只有 bypass 才额外带 --dangerously-skip-permissions） */
  permissionMode?: PermissionMode
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
  /** 引擎是否已确认运行在 permissionMode 上；null/undefined = 无从核验，按 spawn 参数采信 */
  permissionModeVerified?: boolean | null
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
      updatedPermissions?: PermissionUpdate[]
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
  onRouteEvent?(listener: (sessionId: string, eventType: string, data: any) => void): () => void
  submitToolAnswer?(sessionId: string, toolCallId: string, answers: Record<string, string>): Promise<void>
  skipToolAnswer?(sessionId: string, toolCallId: string): Promise<void>

  // ── can_use_tool / control_request 协议（可选；目前仅 Claude Code 引擎实现）──
  respondPermission?(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>
  allowPermission?(
    sessionId: string,
    requestId: string,
    updatedInput?: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
    updatedPermissions?: PermissionUpdate[],
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
  /**
   * 切换思考等级。失败必须抛出 —— 界面靠它把开关退回点击前的状态，
   * 抹平成 resolve(undefined) 就等于告诉用户「切成功了」。
   *
   * @returns now = 已落到进程；next-turn = 当前这一轮跑完才生效。
   */
  updateThinkingLevel?(sessionId: string, enabled: boolean): Promise<ThinkingUpdateTiming>
  /**
   * 运行中改推理深度。与 thinking 开关同构：`--effort` 同样只在 spawn 时读一次，
   * 生效时机由引擎答复，界面不能自己猜。
   */
  updateEffortLevel?(sessionId: string, level: EffortLevel): Promise<ThinkingUpdateTiming>
}

export interface AgentInfo {
  agentType: string
  description: string
  source: 'built-in' | 'user' | 'project' | 'plugin'
  model?: string
  color?: string
}
