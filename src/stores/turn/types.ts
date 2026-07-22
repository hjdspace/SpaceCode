// src/stores/turn/types.ts
// Turn 模块共享的类型、常量与工厂函数。
// 从 index.ts 抽出，供 timelineAssembler / turnStateMachine / index 共用。

// 单个会话当前进行中的 turn 状态。turnStates 中无此 sessionId 条目 === 该会话 idle。
export interface TurnState {
  assistantMessageId: string
  accumulatedContent: string
  currentTextEventId: string | null
  currentReasoningEventId: string | null
  streamingHandledThinking: boolean
  sendStartTime: number
  timeoutId: ReturnType<typeof setTimeout> | null
  isAutonomous: boolean
  settled: boolean
  resolve?: () => void
  reject?: (e: any) => void
  /** 流式期间正在生成的 tool_use ID（content_block_start → stop 窗口期） */
  currentStreamingToolId: string | null
  /** 累积每个工具的 input_json_delta 分片，content_block_stop 时整体解析 */
  streamingToolJson: Map<string, string>
}

export const REQUEST_TIMEOUT = 5 * 60 * 1000
export const AUTONOMOUS_REQUEST_TIMEOUT = 45 * 60 * 1000
export const MAX_INMEMORY_TOOL_OUTPUT = 30_000

export const FILE_TOOLS = new Set(['Write', 'FileWrite', 'Edit', 'FileEdit', 'MultiEdit'])
export const COMMAND_TOOLS = new Set(['Bash'])
export const VERIFICATION_PATTERNS = [/^\s*(npm\s+test|bun\s+test|pnpm\s+test|yarn\s+test|pytest|cargo\s+test|go\s+test|jest|vitest|mocha|npx\s+playwright|ruff|eslint|biome|prettier|tsc|vue-tsc|npm\s+run\s+(test|lint|check|build|typecheck))/i]

// 构造"已结算"的空 TurnState 占位对象。用于 ensureTurn 在应丢弃事件的窗口期
// （sendMessage 进行中 / 用户 abort / 空会话）返回——所有必填字段填入安全默认值，
// 使对象真正满足 TurnState 接口，不再依赖 as 断言绕过类型检查。调用方仍应通过
// ts.settled 早返回；此 helper 仅作类型诚实性与防御性兜底，避免未来调用方
// 忘记 settled 守卫时访问到 undefined 字段。
export function createSettledTurn(): TurnState {
  return {
    assistantMessageId: '',
    accumulatedContent: '',
    currentTextEventId: null,
    currentReasoningEventId: null,
    streamingHandledThinking: false,
    sendStartTime: 0,
    timeoutId: null,
    isAutonomous: false,
    settled: true,
    currentStreamingToolId: null,
    streamingToolJson: new Map(),
  }
}
