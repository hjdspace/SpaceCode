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

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

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
      res: null as unknown as boolean,
    },
    installPiSdk: {
      req: [] as unknown as [],
      res: null as unknown as { success: boolean; error?: string },
    },
    updateThinkingLevel: {
      req: [] as unknown as [sessionId: string, enabled: boolean],
      res: null as unknown as void,
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
    onInstallProgress: { channel: 'installProgress', args: [] as unknown as [progress: InstallProgress] },
  },
})

export type ClaudeCodeChannelMap = typeof claudeCodeNamespace.channels
export type ClaudeCodeEventMap = typeof claudeCodeNamespace.events
export type ClaudeCodeRendererApi = DeriveRendererApi<ClaudeCodeChannelMap>
export type ClaudeCodeEventApi = DeriveEventApi<ClaudeCodeEventMap>
