/**
 * 阶段回合的自动重试。
 *
 * 主聊天在渲染层 abort→重发恢复 429；流水线阶段跑在主进程，没有人替它重发，
 * 所以在这里补上同一套策略：可恢复判定与退避算法都取自 `@/shared/agentRetry`
 * （与 useAutoRetry 同源），重试动作是「在同一个引擎会话上再发一轮」。
 *
 * 不 stop 会话：stage 会话没有 resume id，进程一旦被杀重启就接不回上下文；
 * 429/5xx/超时都是回合已结算、进程仍活着的情形，直接续发即可。
 */
import { computeRetryDelayMs, extractRetryAfterMs, isRetryableAgentFailure, MAX_RETRIES } from '@/shared/agentRetry'
import type { AgentTurn } from './agentEngineGateway'

export interface AgentRetryNotice {
  /** 第几次重试（1 起）。 */
  attempt: number
  max: number
  delayMs: number
  /** 触发重试的原始错误文本。 */
  reason: string
}

export interface RunTurnWithRetryOptions {
  run: () => Promise<AgentTurn>
  signal: AbortSignal
  onRetry?: (notice: AgentRetryNotice) => void
  onRecovered?: (attempts: number) => void
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
  random?: () => number
}

export interface RunTurnWithRetryResult {
  turn: AgentTurn
  /** 实际重试次数（不含首次）。 */
  retries: number
  /** 中止发生在重试等待/续发期间，调用方应按 stopped 收场。 */
  stopped: boolean
}

/** 退避等待可被 abort 立即打断，停止/接管不必等满 60 秒。 */
export function waitAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export async function runTurnWithRetry(options: RunTurnWithRetryOptions): Promise<RunTurnWithRetryResult> {
  let retries = 0
  for (;;) {
    const turn = await options.run()
    if (!turn.isError) {
      if (retries > 0) options.onRecovered?.(retries)
      return { turn, retries, stopped: false }
    }
    if (options.signal.aborted) return { turn, retries, stopped: true }
    if (!isRetryableAgentFailure(turn.text)) return { turn, retries, stopped: false }
    if (retries >= MAX_RETRIES) return { turn, retries, stopped: false }

    const delayMs = computeRetryDelayMs(retries, {
      hintMs: extractRetryAfterMs(turn.text),
      ...(options.random ? { random: options.random } : {}),
    })
    retries += 1
    options.onRetry?.({ attempt: retries, max: MAX_RETRIES, delayMs, reason: turn.text })
    await (options.wait ?? waitAbortable)(delayMs, options.signal)
    if (options.signal.aborted) return { turn, retries, stopped: true }
  }
}
