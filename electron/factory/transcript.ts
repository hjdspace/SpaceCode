/**
 * 任务的「观察」数据源：把流水线会话的转录读成渲染层能直接解析的消息流。
 *
 * 阶段会话 id 由 run/task/阶段派生（见 sessionId.ts），但「当前该看哪个会话」
 * 不写进任务投影：修复与重试各开新会话，审查每轮一个会话，投影里只留最终结论。
 * 这里枚举候选 id，按转录文件的 mtime 取最新的一份 —— 历史运行同样适用，
 * 不依赖投影里新增字段。
 */
import type { FactoryEngineType, FactoryTask } from '@/shared/factory'
import { factorySessionId } from './sessionId'

/** 审查轮次枚举上限：只用来找文件，轮次本身仍由 runner 决定。 */
const MAX_REVIEW_ROUNDS = 8

export interface TranscriptStat {
  (projectPath: string, sessionId: string, engineType: FactoryEngineType): number | null
}

export interface TranscriptRead {
  (projectPath: string, sessionId: string, engineType: FactoryEngineType): Promise<{ messages?: unknown[] } | null>
}

export interface TranscriptDeps {
  stat: TranscriptStat
  read: TranscriptRead
}

export type FactoryTranscriptResult =
  | { ok: true; sessionId: string; engineType: FactoryEngineType; messages: unknown[] }
  | { ok: false; error: 'no-session' | 'read-failed' }

export interface TranscriptInput {
  task: Pick<FactoryTask, 'id' | 'runId' | 'takeover'>
  worktreeAbsolute: string
  engineType: FactoryEngineType
  deps: TranscriptDeps
}

/** 候选会话 id：接管会话优先，其余按阶段各一份；没有顺序语义，靠 mtime 取最新。 */
export function transcriptSessionIds(runId: string, taskId: string, takeoverSessionId?: string): string[] {
  const labels = [
    `fac-${runId}-${taskId}-impl`,
    `fac-${runId}-${taskId}-retry`,
    `fac-${runId}-${taskId}-fix`,
    ...Array.from({ length: MAX_REVIEW_ROUNDS }, (_, index) => `fac-${runId}-${taskId}-review-${index + 1}`),
  ]
  const ids = labels.map(factorySessionId)
  if (takeoverSessionId) ids.unshift(takeoverSessionId)
  return ids
}

/** 转录按「工作树 + 会话」缓存：mtime 没变就不重复解析整份 JSONL。 */
const transcriptCache = new Map<string, { mtimeMs: number; messages: unknown[] }>()

export function resetTranscriptCache(): void {
  transcriptCache.clear()
}

export async function readTranscript(input: TranscriptInput): Promise<FactoryTranscriptResult> {
  const { task, worktreeAbsolute, engineType, deps } = input
  const candidates = transcriptSessionIds(task.runId, task.id, task.takeover?.sessionId)

  let sessionId: string | null = null
  let mtimeMs = -1
  for (const candidate of candidates) {
    const mtime = deps.stat(worktreeAbsolute, candidate, engineType)
    if (mtime !== null && mtime > mtimeMs) {
      sessionId = candidate
      mtimeMs = mtime
    }
  }
  if (!sessionId) return { ok: false, error: 'no-session' }

  const cacheKey = `${worktreeAbsolute}::${sessionId}`
  const cached = transcriptCache.get(cacheKey)
  if (cached && cached.mtimeMs === mtimeMs) {
    return { ok: true, sessionId, engineType, messages: cached.messages }
  }

  try {
    const full = await deps.read(worktreeAbsolute, sessionId, engineType)
    const messages = Array.isArray(full?.messages) ? full.messages : []
    transcriptCache.set(cacheKey, { mtimeMs, messages })
    return { ok: true, sessionId, engineType, messages }
  } catch {
    return { ok: false, error: 'read-failed' }
  }
}
