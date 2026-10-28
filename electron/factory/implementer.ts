/**
 * 实现阶段的迭代循环。
 *
 * 同一个会话内反复续跑，直到 Agent 以 `<promise>COMPLETE</promise>` 收尾；
 * 收尾后在工作树里执行运行配置的验证命令：通过则进入审查，失败就把尾部
 * 失败详情发回同一会话继续修，直到通过或达到迭代上限。
 * 达到上限、被停止或引擎报错时转 `blocked`，但始终保留工作树与提交。
 * 每轮结束都采集 diff/commits 与 token 用量写回任务投影。
 */
import type { FactoryPermissionMode, FactoryTask, FactoryTestRun } from '@/shared/factory'
import { collectWorktreeState, type WorktreeState } from './worktree'
import { patchTask, transitionTask } from './runtime'
import { projectAgentEvent, type FactoryEventInput } from './events'
import { runVerification, type VerifyInput, type VerifyResult } from './verify'
import type { AgentPort } from './agentEngineGateway'

const COMPLETE_SIGNAL = /<\s*promise\s*>\s*COMPLETE\s*<\s*\/\s*promise\s*>/i
const CONTINUE_PROMPT =
  'Continue the task. When the whole task is finished, end your turn with exactly:\n<promise>COMPLETE</promise>'

export type VerifyFn = (input: VerifyInput) => Promise<VerifyResult>

export interface ImplementerDeps {
  agent: AgentPort
  collectState?: (repoRoot: string, taskId: string, baseBranch: string) => Promise<WorktreeState | null>
  emit?: (event: FactoryEventInput) => void
  appendLog?: (taskId: string, text: string) => void
  now?: () => Date
  verify?: VerifyFn
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
  /** 运行配置里的验证命令；缺失时跳过验证（保持既有行为）。 */
  verifyCommand?: string
  verifyTimeoutMs?: number
  deps: ImplementerDeps
}

export type ImplementationOutcome =
  | 'completed'
  | 'limit'
  | 'stopped'
  | 'error'
  | 'tests-failed'
  | 'tests-timeout'

export interface ImplementationResult {
  outcome: ImplementationOutcome
  iterations: number
  inputTokens: number
  outputTokens: number
  message?: string
  /** 完成并已通过验证；runner 据此自动发起审查。 */
  verified?: boolean
  tests?: FactoryTestRun
}

function toTestRun(result: VerifyResult): FactoryTestRun {
  return {
    status: result.status,
    command: result.command,
    at: result.at,
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    ...(result.detail ? { detail: result.detail } : {}),
  }
}

function failurePrompt(result: VerifyResult): string {
  const reason = result.status === 'timeout' ? 'The verify command timed out.' : 'The verify command failed.'
  const detail = result.detail ? `\n\n${result.detail}` : ''
  return `${reason}${detail}\n\nFix the failures above, then finish again with exactly:\n<promise>COMPLETE</promise>`
}

export async function runImplementation(input: ImplementInput): Promise<ImplementationResult> {
  const { deps, task } = input
  const emit = deps.emit ?? (() => {})
  const collect = deps.collectState ?? ((repoRoot, taskId, baseBranch) =>
    collectWorktreeState(repoRoot, taskId, baseBranch))
  const verify = deps.verify ?? ((request: VerifyInput) => runVerification(request))
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
  let verified = false
  let tests: FactoryTestRun | undefined
  let resumePrompt = CONTINUE_PROMPT

  emit({ taskId: task.id, stage: 'implement', code: 'task.implementation.started', level: 'info' })

  try {
    for (let attempt = 1; attempt <= maxIterations; attempt++) {
      if (aborted) {
        outcome = 'stopped'
        break
      }

      iterations = attempt
      const prompt = attempt === 1 ? input.prompt : resumePrompt
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

      if (!COMPLETE_SIGNAL.test(turn.text)) continue
      if (!input.verifyCommand) {
        outcome = 'completed'
        break
      }

      // 进入验证阶段（stage 3）：先迁移再跑命令，让进度条与事件对齐。
      transitionTask(input.repoRoot, input.runId, task.id, { lane: 'implementing', stageIdx: 3 }, 'tests.started', {}, {
        ...(deps.now ? { now: deps.now } : {}),
      })
      emit({
        taskId: task.id,
        stage: 'verify',
        code: 'tests.started',
        level: 'info',
        params: { command: input.verifyCommand },
      })

      const result = await verify({
        command: input.verifyCommand,
        cwd: input.worktreeAbsolute,
        signal: input.signal,
        ...(input.verifyTimeoutMs !== undefined ? { timeoutMs: input.verifyTimeoutMs } : {}),
      })
      tests = toTestRun(result)
      patchTask(input.repoRoot, input.runId, task.id, { tests })

      if (aborted || result.status === 'stopped') {
        outcome = 'stopped'
        break
      }

      if (result.status === 'pass') {
        verified = true
        outcome = 'completed'
        emit({
          taskId: task.id,
          stage: 'verify',
          code: 'tests.passed',
          level: 'ok',
          params: { command: result.command },
        })
        break
      }

      const timedOut = result.status === 'timeout'
      emit({
        taskId: task.id,
        stage: 'verify',
        code: timedOut ? 'tests.timeout' : 'tests.failed',
        level: 'warn',
        params: { command: result.command },
      })

      if (attempt >= maxIterations) {
        outcome = timedOut ? 'tests-timeout' : 'tests-failed'
        break
      }

      // 失败回传同一会话：回到实现阶段（stage 2），下一轮带上失败详情。
      transitionTask(
        input.repoRoot,
        input.runId,
        task.id,
        { lane: 'implementing', stageIdx: 2 },
        timedOut ? 'tests.timeout' : 'tests.failed',
        {},
        { ...(deps.now ? { now: deps.now } : {}) },
      )
      resumePrompt = failurePrompt(result)
    }
  } finally {
    input.signal.removeEventListener('abort', onAbort)
    unsubscribe()
    await stopSession()
  }

  const reason =
    outcome === 'completed'
      ? verified
        ? 'tests.passed'
        : 'implementation.complete'
      : outcome === 'stopped'
        ? 'stopped'
        : outcome === 'limit'
          ? 'iteration.limit'
          : outcome === 'tests-failed'
            ? 'tests.failed'
            : outcome === 'tests-timeout'
              ? 'tests.timeout'
              : 'agent.error'

  transitionTask(
    input.repoRoot,
    input.runId,
    task.id,
    outcome === 'completed'
      ? verified
        ? { lane: 'reviewing', stageIdx: 4 }
        : { lane: 'implementing', stageIdx: 2 }
      : { lane: 'blocked' },
    reason,
    {},
    { ...(deps.now ? { now: deps.now } : {}) },
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
  } else if (outcome === 'tests-failed' || outcome === 'tests-timeout') {
    // 具体原因已由上方的 tests.failed / tests.timeout 事件记录。
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
    ...(verified ? { verified } : {}),
    ...(tests ? { tests } : {}),
  }
}
