import type { BrowserWindow } from 'electron'
import type { EngineAvailability, EngineUnavailableReason, ExtensionDialogAnswer, ExtensionDialogCloseReason, ExtensionDialogMethod, PermissionUpdate, ThinkingUpdateTiming } from '@/shared/channels/claudeCode'
import type { EffortLevel } from '@/shared/effort'

// 引擎实现统一从本模块取协议类型；定义仍在 src/shared（IPC 单一真相源）。
export type { EngineAvailability, EngineUnavailableReason, ExtensionDialogAnswer, ExtensionDialogCloseReason, ExtensionDialogMethod, PermissionUpdate, ThinkingUpdateTiming }
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
  /**
   * 界面在这条会话上能给用户选的模型真实 id（当前 provider 的 haiku/sonnet/opus 槽位）。
   *
   * 只有 pi 用得上：它的 compat provider 模型清单是宿主在 spawn 前手写的 models.json，
   * 而 `set_model` 只认这份启动时读到的快照、也没有重读命令。没登记进去的模型
   * 就换不过去（见 PiSessionProcess.compatRegistrableModelIds）。
   */
  selectableModels?: string[]
  /** 是否启用 RTK (Rust Token Killer) token 优化 */
  rtkEnabled?: boolean
  /**
   * 侧边任务上下文继承来源：主会话 id 及其引擎类型。startSession 时由
   * transcriptDigest 据此把主会话 transcript 压成快照文件（见 resolveSideTaskContextPath）。
   */
  sideTaskSourceSessionId?: string
  sideTaskSourceEngine?: EngineType
  /** 已解析出的快照文件路径；引擎在首条用户消息中包裹注入，注入后即清除（一次性）。 */
  sideTaskContextPath?: string
  /** 预热拉起的会话标记（仅 claude-code 池消费），见 SessionConfig.warmed。 */
  warmed?: boolean
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
    | 'extension_dialog_request'
    | 'extension_dialog_closed'
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
  /**
   * 真正 spawn 的那个引擎二进制的版本。null = 还没解析过，或无从核验。
   * 打包版曾经跑的是用户机器上的 pi，版本号由不得 package.json (#52)。
   */
  engineVersion?: string | null
  /** engineVersion 是否满足宿主侧的能力下限；null/false 时界面不得声称该引擎能力可用 */
  engineVersionCompatible?: boolean | null
  /**
   * 界面所选的 agent 有没有真的落到这条会话上。null = 本会话没选 agent（不适用），
   * false = 选了但落不上，undefined = 该引擎不报这个状态。
   * 选了没落地时，界面不得只留一个 agent 徽章当作已经生效 (#46)。
   */
  agentApplied?: boolean | null
  /**
   * 子代理扩展（委派能力）这次有没有真的随 spawn 装进来。选了 agent 却是 false 时，
   * 界面不得把它当成「什么都能委派」—— 静默无效正是 #46 要消除的形态。
   * undefined = 该引擎不报这个状态。
   */
  agentExtensionLoaded?: boolean
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
   * 应答一条在飞的扩展对话框（pi 的 `extension_ui_request`）。它不带 toolUseId，
   * 走的是引擎自己的对话框协议，与上面的 can_use_tool 是两条路。
   *
   * 会话已无此对话框时必须抛出：界面靠它把卡片退回可重试态，
   * 抹平成 resolve() 等于告诉用户「已经答上了」。
   */
  respondExtensionDialog?(sessionId: string, dialogId: string, answer: ExtensionDialogAnswer): void
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
