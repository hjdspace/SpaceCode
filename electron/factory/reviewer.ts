/**
 * 审查阶段：用全新引擎会话读任务分支的 diff，只接受 `<review>` 包裹的 JSON。
 *
 * 解析失败时在同一会话里要求重发一次；连续失败转 `blocked` 并保留原始输出。
 * 结论落 `task.review`，旧意见按新一轮结果合并为已解决或保留。
 * 审查者不做合并 —— 批准只是把任务留在审查泳道等待人工确认。
 */
import type { FactoryPermissionMode, FactoryReview, FactoryTask } from '@/shared/factory'
import { patchTask, transitionTask } from './runtime'
import { projectAgentEvent, type FactoryEventInput } from './events'
import { mergeReviewComments, parseReviewOutput, REVIEW_RETRY_PROMPT } from './reviewParse'
import type { AgentPort, AgentRunOptions } from './agentEngineGateway'

export interface ReviewerDeps {
  agent: AgentPort
  emit?: (event: FactoryEventInput) => void
  appendLog?: (taskId: string, text: string) => void
  now?: () => Date
  parse?: typeof parseReviewOutput
}

export interface ReviewInput {
  repoRoot: string
  runId: string
  task: FactoryTask
  prompt: string
  worktreeAbsolute: string
  sessionId: string
  model?: string
  permissionMode: FactoryPermissionMode
  agent?: string
  signal: AbortSignal
  deps: ReviewerDeps
}

export type ReviewOutcome = 'approved' | 'needs-changes' | 'parse-failed' | 'error' | 'stopped'

export interface ReviewResult {
  outcome: ReviewOutcome
  review?: FactoryReview
  message?: string
}

export async function runReview(input: ReviewInput): Promise<ReviewResult> {
  const { deps, task } = input
  const emit = deps.emit ?? (() => {})
  const parse = deps.parse ?? parseReviewOutput
  const now = deps.now ?? (() => new Date())
  const at = now().toISOString()

  let sessionStopped = false
  let aborted = input.signal.aborted
  const stopSession = async (): Promise<void> => {
    if (sessionStopped) return
    sessionStopped = true
    try {
      await deps.agent.stop(input.sessionId)
    } catch {
      // 停止失败不掩盖 blocked 状态。
    }
  }
  const onAbort = (): void => {
    aborted = true
    void stopSession()
  }
  input.signal.addEventListener('abort', onAbort, { once: true })

  const unsubscribe = deps.agent.onEvent((sessionId, eventType, data) => {
    if (sessionId !== input.sessionId) return
    if (eventType === 'log') {
      if (typeof data === 'string') deps.appendLog?.(task.id, data)
      return
    }
    const projected = projectAgentEvent(eventType, data)
    if (projected) {
      emit({
        taskId: task.id,
        stage: 'review',
        code: projected.code,
        level: projected.level,
        ...(projected.params ? { params: projected.params } : {}),
      })
    }
  })

  emit({ taskId: task.id, stage: 'review', code: 'review.started', level: 'info' })

  const options: AgentRunOptions = {
    cwd: input.worktreeAbsolute,
    permissionMode: input.permissionMode,
    ...(input.model ? { model: input.model } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
  }

  let outcome: ReviewOutcome | null = null
  let review: FactoryReview | undefined
  let message: string | undefined

  try {
    if (aborted) {
      outcome = 'stopped'
    } else {
      let reply = await deps.agent.run(input.sessionId, input.prompt, options)

      if (aborted) {
        outcome = 'stopped'
      } else if (reply.isError) {
        outcome = 'error'
        message = reply.text
      } else {
        let parsed = parse(reply.text)

        if (!parsed.ok) {
          emit({
            taskId: task.id,
            stage: 'review',
            code: 'review.parse_failed',
            level: 'warn',
            ...(parsed.detail ? { params: { detail: parsed.detail } } : {}),
          })
          reply = await deps.agent.run(input.sessionId, REVIEW_RETRY_PROMPT, options)
          if (aborted) {
            outcome = 'stopped'
          } else if (reply.isError) {
            outcome = 'error'
            message = reply.text
          } else {
            parsed = parse(reply.text)
          }
        }

        if (outcome === null) {
          if (!parsed.ok) {
            emit({
              taskId: task.id,
              stage: 'review',
              code: 'review.parse_failed',
              level: 'warn',
              ...(parsed.detail ? { params: { detail: parsed.detail } } : {}),
            })
            review = { verdict: 'needs_changes', summary: '', comments: [], at, raw: reply.text }
            outcome = 'parse-failed'
          } else {
            const comments = mergeReviewComments(
              task.review?.comments ?? [],
              parsed.review.comments,
              parsed.review.verdict,
            )
            review = {
              verdict: parsed.review.verdict,
              summary: parsed.review.summary,
              comments,
              at,
            }
            outcome = parsed.review.verdict === 'approved' ? 'approved' : 'needs-changes'
          }
        }
      }
    }
  } finally {
    input.signal.removeEventListener('abort', onAbort)
    unsubscribe()
    await stopSession()
  }

  const finalOutcome: ReviewOutcome = outcome ?? 'stopped'

  if (review) patchTask(input.repoRoot, input.runId, task.id, { review })

  const reason =
    finalOutcome === 'approved'
      ? 'review.approved'
      : finalOutcome === 'needs-changes'
        ? 'review.needs_changes'
        : finalOutcome === 'parse-failed'
          ? 'review.parse_failed'
          : finalOutcome === 'stopped'
            ? 'stopped'
            : 'review.error'

  if (input.signal.reason !== 'takeover') {
    transitionTask(
      input.repoRoot,
      input.runId,
      task.id,
      finalOutcome === 'approved' ? { lane: 'reviewing', stageIdx: 4 } : { lane: 'blocked' },
      reason,
      {},
      { now },
    )
  }

  if (finalOutcome === 'approved') {
    emit({ taskId: task.id, stage: 'review', code: 'review.approved', level: 'ok' })
  } else if (finalOutcome === 'needs-changes') {
    emit({ taskId: task.id, stage: 'review', code: 'review.needs_changes', level: 'warn' })
  } else if (finalOutcome === 'error') {
    emit({
      taskId: task.id,
      stage: 'review',
      code: 'review.error',
      level: 'error',
      ...(message ? { params: { message } } : {}),
    })
  } else if (finalOutcome === 'stopped') {
    emit({ taskId: task.id, stage: 'review', code: 'task.stopped', level: 'warn' })
  }

  return {
    outcome: finalOutcome,
    ...(review ? { review } : {}),
    ...(message ? { message } : {}),
  }
}
