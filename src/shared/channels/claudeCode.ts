/**
 * ClaudeCode Channel 定义 — claudeCode 命名空间 IPC 的单一真相源。
 *
 * 本文件定义了所有 `claude-code:*` channel 的三要素（名、参数类型、返回类型）
 * 与事件订阅（channel 后缀 + 回调参数元组），preload bridge、renderer API 类型、
 * handler 注册均从此派生。
 *
 * 迁移自：
 *   - preload.ts 中 claudeCode: {...} 的手写 invoke/on（52 个成员）
 *   - electron.d.ts 中 ElectronClaudeCodeAPI 接口的手写签名（onError 由此变为必选，落实 ADR-0005）
 *   - claudeCodeIPC.ts / main.ts 中内联字符串 channel 名
 *
 * 注意：notifyEngineSourceChanged 的 wire channel 名是 'claude-code:engineSourceChanged'，
 * 与方法名不一致（历史遗留），用 channel 字段显式覆盖。
 */
import { defineNamespace } from '@/shared/channelMap'
import type { DeriveRendererApi, DeriveEventApi } from '@/shared/channelMap'
import type { EffortLevel } from '@/shared/effort'
import type {
  CliDetectionResult,
  EnvironmentCheckResult,
  InstallProgress,
  ProxyStatus,
} from '@/services/electronAPI'

// ── 事件 payload 类型 ──────────────────────────────────────────
// data 字段保持 any：TypeScript 逆变限制，具体事件类型（如 PermissionRequest）
// 无法赋值给 unknown/Record<string, unknown>（沿用 electron.d.ts 原注释的决策）。

/** 大多数引擎事件的 payload：{ sessionId, data } */
export interface EngineEvent {
  sessionId: string
  data: any
}

export interface EngineLogEvent {
  sessionId: string
  data: string
}

export interface EngineExitEvent {
  sessionId: string
  data: number | null | { code?: number | null; signal?: string | null; stderr?: string }
}

export interface EngineSuspendedEvent {
  sessionId: string
  data: { reason: string }
}

export interface EngineEvictionBlockedEvent {
  sessionId: string
  data: { reason: string; pendingTools: number }
}

/**
 * pi 扩展对话框 (`extension_ui_request`) 里会 await 宿主回帧的四类方法。
 * 口径见 @earendil-works/pi-coding-agent 的 docs/rpc-extension-ui.md：`confirm` 在
 * pi 的 RPC 适配层里也是发 `select([确认项, 取消项])`，所以真正高频的是 select。
 */
export type ExtensionDialogMethod = 'select' | 'confirm' | 'input' | 'editor'

/** 引擎问用户的一句话；`dialogId` 是 pi 自己的 UUID，与 toolUseId 无关 */
export interface ExtensionDialogRequest {
  dialogId: string
  method: ExtensionDialogMethod
  title: string
  /** confirm 的正文 */
  message?: string
  /** select 的可选项，原样回传其中一条即为应答 */
  options?: string[]
  /** input 的占位文案 */
  placeholder?: string
  /** editor 的初始正文 */
  prefill?: string
}

/** 对话框不再需要应答：用户答了、被取消、超时，或进程没了 */
export interface ExtensionDialogClosedEvent {
  dialogId: string
  method: ExtensionDialogMethod
  reason: ExtensionDialogCloseReason
}

/**
 * 对话框怎么退的。`timeout` = pi 自己按帧上的 timeout 解掉了；`watchdog` = 帧没带
 * timeout 又一直没人应答，宿主按 #45 那条「绝不挂死」兜的底。两者对扩展侧都是 cancelled，
 * 但界面上得区分：前者是「引擎没再问」，后者是「这题过期了」。
 */
export type ExtensionDialogCloseReason =
  | 'answered'
  | 'cancelled'
  | 'timeout'
  | 'watchdog'
  | 'aborted'
  | 'suspended'
  | 'process_exit'
  | 'process_restart'

/** 渲染层答回来的值；`kind` 与发起的 method 对应，cancel 表示「没有答案」 */
export type ExtensionDialogAnswer =
  | { kind: 'value'; value: string }
  | { kind: 'confirmed'; confirmed: boolean }
  | { kind: 'cancel' }

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

/**
 * 引擎为什么不能用 (issue #52)。界面按它选文案，不再自己猜：
 * `version-unknown` / `version-too-old` 都算不可用 —— 版本无从核验，就等于不能声称能力可用。
 */
export type EngineUnavailableReason = 'ok' | 'not-found' | 'version-unknown' | 'version-too-old'

export interface EngineAvailability {
  available: boolean
  reason: EngineUnavailableReason
  /** 真正会 spawn 的引擎版本；null = 该引擎不回版本（claude-code）或无从核验 */
  version: string | null
  /**
   * 「装一下就能用」是否成立。打包版只认随产物走的那份 pi，让用户去装全局 pi
   * 只会多一个永远用不到的副本 (#52)。
   */
  installable: boolean
}

/**
 * 思考开关落到引擎进程的时间点。
 *
 * `--thinking` 只在 spawn 时读一次，所以「改成功了」有两种真值：空闲时当场挂起进程、
 * 下一条消息就带新参数（now）；轮次进行中不打断，本轮跑完才生效（next-turn）。
 * 界面据此决定要不要提示用户，而不是自己猜会话是否忙。
 */
export type ThinkingUpdateTiming = 'now' | 'next-turn'

// ── 权限规则变更（can_use_tool 的 permission_suggestions / 应答的 updatedPermissions）──
// 形状对齐引擎侧 PermissionUpdateSchema（engine/src/utils/permissions/PermissionUpdateSchema.ts）。
// 宿主不解释、不重构这些对象，只把引擎发来的原样回传 —— 引擎用 zod discriminated union
// 校验并对畸形项整体降级为 undefined，所以这里保持同一判别式即可，不要放宽成 Record。

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg'

/** `setMode` 可写入的模式，比用户可选的 PermissionMode 宽（引擎另有 dontAsk）。 */
export type PermissionUpdateMode =
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'dontAsk'
  | 'plan'

export interface PermissionRuleValue {
  toolName: string
  ruleContent?: string
}

export type PermissionUpdate =
  | {
      type: 'addRules' | 'replaceRules' | 'removeRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: 'allow' | 'deny' | 'ask'
    }
  | {
      type: 'setMode'
      destination: PermissionUpdateDestination
      mode: PermissionUpdateMode
    }
  | {
      type: 'addDirectories' | 'removeDirectories'
      destination: PermissionUpdateDestination
      directories: string[]
    }

export interface EngineAgentInfo {
  agentType: string
  description: string
  source: string
  model?: string
  color?: string
}

// ── channel 定义 ───────────────────────────────────────────────

export const claudeCodeNamespace = defineNamespace({
  channels: {
    // ── 会话生命周期 ──
    startSession: {
      req: [] as unknown as [sessionId: string, config: unknown],
      res: null as unknown,
    },
    sendMessage: {
      req: [] as unknown as [sessionId: string, content: string, images?: unknown[]],
      res: null as unknown,
    },
    abort: { req: [] as unknown as [sessionId: string], res: null as unknown },
    stop: { req: [] as unknown as [sessionId: string], res: null as unknown },
    suspendSession: { req: [] as unknown as [sessionId: string], res: null as unknown },
    resumeSession: { req: [] as unknown as [sessionId: string], res: null as unknown },
    getSessionStatus: {
      req: [] as unknown as [sessionId: string],
      res: null as unknown as Record<string, unknown>,
    },
    getActiveSessions: {
      req: [] as unknown as [],
      res: null as unknown as Array<{ sessionId: string }>,
    },
    isSessionActive: {
      req: [] as unknown as [sessionId?: string],
      res: null as unknown as boolean,
    },
    listAgents: {
      req: [] as unknown as [cwd?: string, engineType?: string],
      res: null as unknown as EngineAgentInfo[],
    },
    isEngineAvailable: {
      req: [] as unknown as [engineType: string],
      res: null as unknown as EngineAvailability,
    },
    installPiSdk: {
      req: [] as unknown as [],
      res: null as unknown as { success: boolean; error?: string },
    },
    updateThinkingLevel: {
      req: [] as unknown as [sessionId: string, enabled: boolean],
      res: null as unknown as ThinkingUpdateTiming,
    },
    updateEffortLevel: {
      req: [] as unknown as [sessionId: string, level: EffortLevel],
      res: null as unknown as ThinkingUpdateTiming,
    },
    // ── 会话历史 ──
    listProjectSessions: {
      req: [] as unknown as [cwd: string],
      res: null as unknown as unknown[],
    },
    listAllSessions: { req: [] as unknown as [], res: null as unknown as unknown[] },
    getFullSession: {
      req: [] as unknown as [projectPath: string, sessionId: string],
      res: null as unknown as Record<string, unknown>,
    },
    resolveAgentTranscriptPath: {
      req: [] as unknown as [projectPath: string, sessionId: string, agentId: string],
      res: null as unknown,
    },
    findAgentTranscriptByToolUse: {
      req: [] as unknown as [projectPath: string, sessionId: string, toolUseId: string],
      res: null as unknown as string | null,
    },
    restoreSession: {
      req: [] as unknown as [sessionId: string, projectPath: string],
      res: null as unknown as Record<string, unknown>,
    },
    // ── 工具 / 权限 ──
    submitToolAnswer: {
      req: [] as unknown as [sessionId: string, toolCallId: string, answers: Record<string, string>],
      res: null as unknown,
    },
    skipToolAnswer: {
      req: [] as unknown as [sessionId: string, toolCallId: string],
      res: null as unknown,
    },
    allowPermission: {
      req: [] as unknown as [
        sessionId: string,
        requestId: string,
        updatedInput?: Record<string, unknown>,
        decisionClassification?: 'user_temporary' | 'user_permanent',
        updatedPermissions?: PermissionUpdate[],
      ],
      res: null as unknown,
    },
    denyPermission: {
      req: [] as unknown as [
        sessionId: string,
        requestId: string,
        message?: string,
        options?: { interrupt?: boolean },
      ],
      res: null as unknown,
    },
    respondPermission: {
      req: [] as unknown as [sessionId: string, requestId: string, decision: unknown],
      res: null as unknown,
    },
    respondExtensionDialog: {
      req: [] as unknown as [sessionId: string, dialogId: string, answer: ExtensionDialogAnswer],
      res: null as unknown,
    },
    setPermissionMode: {
      req: [] as unknown as [sessionId: string, mode: PermissionMode],
      res: null as unknown,
    },
    setModel: {
      req: [] as unknown as [sessionId: string, model: string | undefined],
      res: null as unknown,
    },
    // ── 查询 / 设置 ──
    getMcpStatus: { req: [] as unknown as [sessionId: string], res: null as unknown },
    getContextUsage: {
      req: [] as unknown as [sessionId: string],
      res: null as unknown as Record<string, unknown> | undefined,
    },
    getSettings: { req: [] as unknown as [sessionId: string], res: null as unknown },
    stopEngineTask: {
      req: [] as unknown as [sessionId: string, taskId: string],
      res: null as unknown,
    },
    getPendingPermissionRequestIds: {
      req: [] as unknown as [sessionId: string],
      res: null as unknown,
    },
    // ── CLI / 环境 / 代理 ──
    detectInstalledCli: {
      req: [] as unknown as [],
      res: null as unknown as CliDetectionResult | null,
    },
    checkEnvironment: {
      req: [] as unknown as [],
      res: null as unknown as EnvironmentCheckResult | null,
    },
    installCli: {
      req: [] as unknown as [],
      res: null as unknown as { success: boolean; error?: string } | null,
    },
    getProxyStatus: { req: [] as unknown as [], res: null as unknown as ProxyStatus | null },
    isProxyRunning: { req: [] as unknown as [], res: null as unknown as boolean },
    // wire channel 名为 'claude-code:engineSourceChanged'（历史遗留，显式覆盖）
    notifyEngineSourceChanged: {
      req: [] as unknown as [source: string],
      res: null as unknown as void,
      channel: 'engineSourceChanged',
    },
  },
  events: {
    onAssistant: { channel: 'assistant', args: [] as unknown as [data: EngineEvent] },
    onUser: { channel: 'user', args: [] as unknown as [data: EngineEvent] },
    onSystem: { channel: 'system', args: [] as unknown as [data: EngineEvent] },
    onToolUse: { channel: 'tool_use', args: [] as unknown as [data: EngineEvent] },
    onToolResult: { channel: 'tool_result', args: [] as unknown as [data: EngineEvent] },
    onResult: { channel: 'result', args: [] as unknown as [data: EngineEvent] },
    onStreamEvent: { channel: 'stream_event', args: [] as unknown as [data: EngineEvent] },
    onLog: { channel: 'log', args: [] as unknown as [data: EngineLogEvent] },
    onExit: { channel: 'exit', args: [] as unknown as [data: EngineExitEvent] },
    onError: { channel: 'error', args: [] as unknown as [data: EngineEvent] },
    onSuspended: { channel: 'suspended', args: [] as unknown as [data: EngineSuspendedEvent] },
    onEvictionBlocked: { channel: 'eviction_blocked', args: [] as unknown as [data: EngineEvictionBlockedEvent] },
    onPermissionRequest: { channel: 'permission_request', args: [] as unknown as [data: EngineEvent] },
    onPermissionRequestCancelled: { channel: 'permission_request_cancelled', args: [] as unknown as [data: EngineEvent] },
    onElicitationRequest: { channel: 'elicitation_request', args: [] as unknown as [data: EngineEvent] },
    onExtensionDialogRequest: { channel: 'extension_dialog_request', args: [] as unknown as [data: EngineEvent] },
    onExtensionDialogClosed: { channel: 'extension_dialog_closed', args: [] as unknown as [data: EngineEvent] },
    onInstallProgress: { channel: 'installProgress', args: [] as unknown as [progress: InstallProgress] },
  },
})

export type ClaudeCodeChannelMap = typeof claudeCodeNamespace.channels
export type ClaudeCodeEventMap = typeof claudeCodeNamespace.events
export type ClaudeCodeRendererApi = DeriveRendererApi<ClaudeCodeChannelMap>
export type ClaudeCodeEventApi = DeriveEventApi<ClaudeCodeEventMap>
