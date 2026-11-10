// src/stores/turn/eventHandlers/types.ts
// 事件处理的对外接口。原先住在 eventHandlers.ts 顶部，拆分后独立成模块，
// 供 index.ts 与各 handler 域共用。

import type { Ref } from 'vue'
import type { SessionSink } from '../../turnSink'
import type { TurnState } from '../types'
import type { TurnStateMachine } from '../turnStateMachine'
import type { TimelineAssembler } from '../timelineAssembler'
import type { UseAutoRetryReturn } from '@/composables/useAutoRetry'
import type { ErrorCategory, ToolCall } from '@/types'
import type { errorHandler as defaultErrorHandler } from '@/services/errorHandler'

export interface Logger {
  debug: (scope: string, message: string, data?: any) => void
  info: (scope: string, message: string, data?: any) => void
  warn: (scope: string, message: string, data?: any) => void
  error: (scope: string, message: string, data?: any) => void
}

export interface TraceEventFn {
  (event: {
    sessionId: string
    messageId?: string
    actor: 'user' | 'assistant' | 'tool' | 'system'
    type: string
    status?: 'started' | 'running' | 'completed' | 'failed'
    title?: string
    input?: unknown
    output?: unknown
    artifacts?: Array<{ kind: string; path?: string; content?: string }>
    evidence?: Array<{ kind: string; result?: string; detail: string }>
    metadata?: Record<string, unknown>
    error?: { message: string; stack?: string }
  }): void
}

export interface ClaudeCodeApi {
  abort: (sessionId: string) => void
}

export interface ArtifactsApi {
  list: (workingDir: string, options?: { scanWorkspaceRoot?: boolean }) => Promise<{ artifacts: any[] }>
}

export interface EventReducerOptions {
  sink: SessionSink
  stateMachine: TurnStateMachine
  timeline: TimelineAssembler
  streamingContents: Ref<Map<string, string>>
  loadingSessions: Ref<Map<string, boolean>>
  pendingSendMessages: Set<string>
  userAbortedSessions: Set<string>
  logger: Logger
  traceEvent: TraceEventFn
  selectSession: (sessionId: string) => void
  getCurrentSessionId: () => string | undefined
  updateTaskStateFromToolResult: (toolCalls: ToolCall[], resultToolUseId: string, resultOutput: string) => void
  loadTurnCheckpoints: (sessionId: string, projectPathOverride?: string, force?: boolean) => void
  getModel: () => string | undefined
  getProvider: () => string | undefined
  getBaseUrl: () => string | undefined
  autoRetry: UseAutoRetryReturn
  initiateAutoRetry: (
    sessionId: string,
    ts: TurnState,
    errorCategory: ErrorCategory,
    errorTitle: string,
    errorMessage: string,
    retryDelayHint?: number,
    errorCode?: string,
  ) => Promise<void>
  contextUsage: {
    applyFallback: (sessionId: string) => void
    refresh: (sessionId: string) => void
  }
  errorHandler: typeof defaultErrorHandler
  getClaudeCode: () => ClaudeCodeApi | null
  getArtifactsApi: () => ArtifactsApi | null
  /**
   * 仓库根的取值口径 —— 会话工作目录可能是子目录，而 git 侧的所有路径口径
   * （scm.fileStats / getFullDiff）都以项目根为准。回合窗口扫描必须用同一个基准，
   * 否则同一文件会出现两份路径。
   */
  getProjectRoot: () => string | null
  /**
   * 写文件工具落盘后记账，供会话改动的展示层分辨"被其他会话覆盖过"。
   * 与 getProjectRoot 一样走注入：turn store 不直接依赖面板态 store。
   */
  fileWriteLedger: {
    recordToolWrite: (args: {
      projectRoot: string | null
      sessionId: string
      toolName: string
      input: Record<string, any> | undefined
      workingDirectory?: string
    }) => void
  }
  /**
   * 把新生成的交付物送进右侧预览（办公文档走 officecli，HTML 走内置浏览器）。
   * 由调用方注入，因为这住在 turn store 里，而面板状态归 appStore。
   */
  openArtifactPreview?: (filePath: string) => void
  /** Returns true if task-complete notification sound is enabled. */
  isSoundOnTaskComplete: () => boolean
  /** Returns true if desktop system notification on task-complete is enabled. */
  isDesktopNotifyOnTaskComplete: () => boolean
  /** Returns the display title of a session (used in desktop notifications). */
  getSessionTitle: (sessionId: string) => string
  /**
   * Turn 成功结算后的回调（endTurn 之后触发）。
   * 用于 goal 续跑等跨 turn 编排 — 传入本轮最终输出文本。
   */
  onTurnCompleted?: (sessionId: string, finalText: string) => void
  /**
   * Turn 结局订阅点 — 区分 settled / failed / aborted 三种结局。
   * 编排引擎订阅此信号作为节点完成信号源。
   */
  onTurnOutcome?: (sessionId: string, outcome: 'settled' | 'failed' | 'aborted') => void
}

export interface EventReducer {
  handleRemoteUserMessage: (sessionId: string, data: any) => void
  handleStreamEvent: (sessionId: string, ts: TurnState, streamEvent: any) => void
  handleAssistant: (sessionId: string, ts: TurnState, assistant: any) => void
  handleToolUse: (sessionId: string, ts: TurnState, toolUse: any) => void
  handleToolResult: (sessionId: string, ts: TurnState, toolResult: any) => void
  handleUser: (sessionId: string, ts: TurnState, userMsg: any) => void
  handleResult: (sessionId: string, ts: TurnState, result: any) => void
  handleError: (sessionId: string, ts: TurnState, error: any) => void
  handleExit: (sessionId: string, ts: TurnState, data: number | null | { code?: number | null; signal?: string | null; stderr?: string }) => void
}

/** 正文/时间线写入的公共工具，由 content 域创建后注入各 handler。 */
export interface ContentHelpers {
  syncCardProjection: (sessionId: string, ts: TurnState, message: any, final: boolean) => { content: string; blockText: string }
  flushContentPatch: (sessionId: string, ts: TurnState, final?: boolean) => void
  scheduleContentPatch: (sessionId: string, ts: TurnState) => void
  scheduleEarlyInputPatch: (sessionId: string, ts: TurnState, toolId: string) => void
  flushEarlyInputPatch: (sessionId: string, ts: TurnState, toolId: string) => void
  /** 单个 text 块的可见正文：与整条消息同一套围栏判定，只是不产卡片记录。 */
  visibleBlock: (ts: TurnState, rawBlock: string, final?: boolean) => string
}

/**
 * 各 handler 域共享的运行时上下文。
 * 除 EventReducerOptions 原样透传外，还携带由 index.ts 组装的闭包状态
 * （turn map、已预览集合、记账/预览函数）与 content 域的写入工具。
 */
export interface EventHandlerContext extends EventReducerOptions, ContentHelpers {
  turnStates: Map<string, TurnState>
  beginTurn: TurnStateMachine['beginTurn']
  endTurn: TurnStateMachine['endTurn']
  /** 流水线观察会话：引擎由主进程流水线驱动，渲染层只是镜像。 */
  isObserved: (sessionId: string) => boolean
  /** 已经自动预览过的交付物，避免每轮结束都把同一个文件重新弹一次。 */
  autoPreviewedPaths: Set<string>
  recordWriteToLedger: (sessionId: string, toolName: string, input: Record<string, any> | undefined) => void
  maybeAutoPreviewArtifact: (sessionId: string, toolName: string, toolInput: any) => void
}
