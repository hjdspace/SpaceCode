// src/stores/turn/eventHandlers/index.ts
// 装配层：把 opts 与闭包状态组装成 EventHandlerContext，再按域创建 handler。
// 各域只依赖 context，彼此互不 import；跨域调用（如 result → error）留在同一域内。

import { FILE_TOOLS } from '../types'
import { createContentHelpers } from './content'
import { createStreamHandlers } from './stream'
import { createAssistantHandlers } from './assistant'
import { createToolHandlers } from './tool'
import { createUserHandlers } from './user'
import { createTurnEndHandlers } from './turnEnd'
import { extractAutoPreviewTarget } from './helpers'
import type { EventHandlerContext, EventReducer, EventReducerOptions } from './types'

// 对外符号：既有调用方（turn/index.ts、tests）按原路径导入，形状不变。
export { isSyntheticApiErrorAssistant, extractAutoPreviewTarget } from './helpers'
export type {
  Logger,
  TraceEventFn,
  ClaudeCodeApi,
  ArtifactsApi,
  EventReducerOptions,
  EventReducer,
} from './types'

export function createEventHandlers(opts: EventReducerOptions): EventReducer {
  const { sink, stateMachine, timeline, streamingContents, fileWriteLedger, getProjectRoot, openArtifactPreview } = opts
  const { turnStates, beginTurn, endTurn } = stateMachine

  /**
   * 流水线观察会话：引擎由主进程流水线驱动，渲染层只是镜像。
   * 通知、自动重试、产物预览这类"有副作用"的分支一律绕开 —— 否则
   * 一个后台任务会在观察面板里抢焦点，甚至和流水线自己的重试打架。
   */
  const isObserved = (sessionId: string): boolean => sink.get(sessionId)?.observedSession === true
  /** 已经自动预览过的交付物，避免每轮结束都把同一个文件重新弹一次。 */
  const autoPreviewedPaths = new Set<string>()

  /**
   * 写文件工具成功落盘后记入账本。路径口径与会话改动列表必须一致，所以复用
   * store 里的解析（含工作目录补全与仓库相对化）。
   */
  const recordWriteToLedger = (sessionId: string, toolName: string, input: Record<string, any> | undefined) => {
    if (!FILE_TOOLS.has(toolName)) return
    fileWriteLedger.recordToolWrite({
      projectRoot: getProjectRoot(),
      sessionId,
      toolName,
      input,
      workingDirectory: sink.get(sessionId)?.workingDirectory,
    })
  }

  /**
   * 工具成功完成后，若产出值得预览的交付物，立即送右侧预览 —— 不等 turn 结束。
   * officecli 技能没有输出目录约定，且 watch 模式能读到 officecli resident 的
   * 内存态，创建即打开的时机比 turn 结束的产物扫描更贴近"实时预览"。
   * design 模式有自己的预览区，不抢。
   */
  function maybeAutoPreviewArtifact(sessionId: string, toolName: string, toolInput: any): void {
    const s = sink.get(sessionId)
    if (!s || s.mode === 'design' || !openArtifactPreview) return
    const target = extractAutoPreviewTarget(toolName, toolInput, s.workingDirectory)
    if (!target || autoPreviewedPaths.has(target)) return
    autoPreviewedPaths.add(target)
    openArtifactPreview(target)
  }

  const ctx: EventHandlerContext = {
    ...opts,
    turnStates,
    beginTurn,
    endTurn,
    isObserved,
    autoPreviewedPaths,
    recordWriteToLedger,
    maybeAutoPreviewArtifact,
    ...createContentHelpers({ sink, streamingContents, timeline }),
  }

  const { handleStreamEvent } = createStreamHandlers(ctx)
  const { handleAssistant } = createAssistantHandlers(ctx)
  const { handleToolUse, handleToolResult } = createToolHandlers(ctx)
  const { handleRemoteUserMessage, handleUser } = createUserHandlers(ctx)
  const { handleResult, handleError, handleExit } = createTurnEndHandlers(ctx)

  return {
    handleRemoteUserMessage,
    handleStreamEvent,
    handleAssistant,
    handleToolUse,
    handleToolResult,
    handleUser,
    handleResult,
    handleError,
    handleExit,
  }
}
