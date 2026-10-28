/**
 * 实现阶段的迭代循环。
 *
 * 同一个会话内反复续跑，直到 Agent 以 `<promise>COMPLETE</promise>` 收尾；
 * 达到迭代上限、被停止或引擎报错时转 `blocked`，但始终保留工作树与提交。
 * 每轮结束都采集 diff/commits 与 token 用量写回任务投影。
 */
import type { FactoryPermissionMode, FactoryTask } from '@/shared/factory'
import { collectWorktreeState, type WorktreeState } from './worktree'
import { patchTask, transitionTask } from './runtime'
import { projectAgentEvent, type FactoryEventInput } from './events'
import type { AgentPort } from './agentEngineGateway'

const COMPLETE_SIGNAL = /<\s*promise\s*>\s*COMPLETE\s*<\s*\/\s*promise\s*>/i
const CONTINUE_PROMPT =
  'Continue the task. When the whole task is finished, end your turn with exactly:\n<promise>COMPLETE</promise>'

export interface ImplementerDeps {
  agent: AgentPort
  collectState?: (repoRoot: string, taskId: string, baseBranch: string) => Promise<WorktreeState | null>
  emit?: (event: FactoryEventInput) => void
  appendLog?: (taskId: string, text: string) => void
  now?: () => Date
}

export interface ImplementInput {
  repoRoot: string
  runId: string
  task: FactoryTask
  prompt: string
  worktreeAbsolute: string
  baseBranch: string
  sessionId: string
  model?: string
  permissionMode: FactoryPermissionMode
  agent?: string
  signal: AbortSignal
  maxIterations?: number
  deps: ImplementerDeps
}

export type ImplementationOutcome = 'completed' | 'limit' | 'stopped' | 'error'

export interface ImplementationResult {
  outcome: ImplementationOutcome
  iterations: number
  inputTokens: number
  outputTokens: number
  message?: string
}

export async function runImplementation(input: ImplementInput): Promise<ImplementationResult> {
  const { deps, task } = input
  const emit = deps.emit ?? (() => {})
  const collect = deps.collectState ?? ((repoRoot, taskId, baseBranch) =>
    collectWorktreeState(repoRoot, taskId, baseBranch))
  const maxIterations = Math.max(1, input.maxIterations ?? task.maxIterations ?? 1)

  let aborted = input.signal.aborted
  let sessionStopped = false
  const stopSession = async (): Promise<void> => {
    if (sessionStopped) return
    sessionStopped = true
    try {
      await deps.agent.stop(input.sessionId)
    } catch {
      // 停止失败不掩盖任务的 blocked 状态；进程会在下次启动时被扫描降级。
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
        stage: 'implement',
        code: projected.code,
        level: projected.level,
        ...(projected.params ? { params: projected.params } : {}),
      })
    }
  })

  let iterations = 0
  let inputTokens = 0
  let outputTokens = 0
  let outcome: ImplementationOutcome = 'limit'
  let message: string | undefined

  emit({ taskId: task.id, stage: 'implement', code: 'task.implementation.started', level: 'info' })

  try {
    for (let attempt = 1; attempt <= maxIterations; attempt++) {
      if (aborted) {
        outcome = 'stopped'
        break
      }

      iterations = attempt
      const prompt = attempt === 1 ? input.prompt : CONTINUE_PROMPT
      const turn = await deps.agent.run(input.sessionId, prompt, {
        cwd: input.worktreeAbsolute,
        permissionMode: input.permissionMode,
        ...(input.model ? { model: input.model } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
      })

      inputTokens += turn.inputTokens
      outputTokens += turn.outputTokens
      patchTask(input.repoRoot, input.runId, task.id, {
        iteration: attempt,
        usage: { inputTokens, outputTokens },
      })

      const state = await collect(input.repoRoot, task.id, input.baseBranch)
      if (state) {
        patchTask(input.repoRoot, input.runId, task.id, {
          diff: state.diff,
          commits: state.commits,
        })
      }

      if (aborted) {
        outcome = 'stopped'
        break
      }

      if (turn.isError) {
        outcome = 'error'
        message = turn.text
        break
      }

      if (COMPLETE_SIGNAL.test(turn.text)) {
        outcome = 'completed'
        break
      }
    }
  } finally {
    input.signal.removeEventListener('abort', onAbort)
    unsubscribe()
    await stopSession()
  }

  const reason =
    outcome === 'completed'
      ? 'implementation.complete'
      : outcome === 'stopped'
        ? 'stopped'
        : outcome === 'limit'
          ? 'iteration.limit'
          : 'agent.error'

  transitionTask(
    input.repoRoot,
    input.runId,
    task.id,
    outcome === 'completed' ? { lane: 'implementing', stageIdx: 2 } : { lane: 'blocked' },
    reason,
  )

  if (outcome === 'completed') {
    emit({ taskId: task.id, stage: 'implement', code: 'task.implementation.completed', level: 'ok' })
  } else if (outcome === 'limit') {
    emit({
      taskId: task.id,
      stage: 'implement',
      code: 'task.iteration.limit',
      level: 'warn',
      params: { iterations },
    })
  } else if (outcome === 'stopped') {
    emit({ taskId: task.id, stage: 'implement', code: 'task.stopped', level: 'warn' })
  } else {
    emit({
      taskId: task.id,
      stage: 'implement',
      code: 'task.agent.error',
      level: 'error',
      ...(message ? { params: { message } } : {}),
    })
  }

  return {
    outcome,
    iterations,
    inputTokens,
    outputTokens,
    ...(message ? { message } : {}),
  }
}
