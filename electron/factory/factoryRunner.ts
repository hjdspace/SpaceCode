/**
 * Factory 运行编排：启动前校验 → 工作树 → 提示词 → 后台实现 → 停止/事件。
 *
 * 校验顺序保证「不满足条件不创建任何目录」：配置、任务、仓库、脏工作区、
 * 基础分支全部通过后才 `git worktree add`。所有任务迁移仍只经 runtime。
 */
import { existsSync } from 'fs'
import { join } from 'path'
import {
  FACTORY_RUNS_PATH,
  type FactoryConfig,
  type FactoryEvent,
  type FactoryEventPush,
  type FactoryRunControlResult,
  type FactoryMergeExecuteInput,
  type FactoryMergePreflightResult,
  type FactoryMergeResult,
  type FactoryReviewComment,
  type FactoryReviewCommentInput,
  type FactoryRunStopResult,
  type FactoryStageConfig,
  type FactoryStageKey,
  type FactoryTask,
  type FactoryTaskActionResult,
  type FactoryTaskConfigSnapshot,
  type FactoryTaskStartError,
  type FactoryTaskStartInput,
  type FactoryTaskStartResult,
  type FactoryWorktreeRevealResult,
} from '@/shared/factory'
import { mergeEligibility, pendingComments, updateReviewComment } from '@/shared/factoryReview'
import { readFactoryConfig } from './config'
import { readLatestRun, readRunSnapshot } from './runs'
import { clampConcurrency, dependenciesMet, dispatchDecision } from './scheduler'
import { patchTask, transitionTask, updateRun } from './runtime'
import {
  defaultGitRunner,
  mapGitFailure,
  prepareWorktree,
  worktreeAbsolutePath,
  type GitRunner,
  type WorktreeGitError,
} from './worktree'
import {
  buildFixPrompt,
  buildImplementPrompt,
  buildReviewPrompt,
  type BuildPromptInput,
  type BuildPromptResult,
} from './prompt'
import { appendRawLog, openEventLog, readEvents as readEventLog, type FactoryEventInput } from './events'
import { runImplementation, type ImplementInput, type ImplementationResult } from './implementer'
import { runReview, type ReviewInput, type ReviewResult } from './reviewer'
import { executeMerge, runMergePreflight, type MergeWriteBackPayload } from './merge'
import type { AgentPort } from './agentEngineGateway'

const LOGS_DIR = '.spacecode/factory/logs'

export interface FactoryRunnerDeps {
  now?: () => Date
  git?: GitRunner
  agentFactory?: () => Promise<AgentPort>
  buildPrompt?: (input: BuildPromptInput) => Promise<BuildPromptResult>
  buildReviewPrompt?: (input: BuildPromptInput) => Promise<BuildPromptResult>
  buildFixPrompt?: (input: BuildPromptInput) => Promise<BuildPromptResult>
  runImplementation?: (input: ImplementInput) => Promise<ImplementationResult>
  runReview?: (input: ReviewInput) => Promise<ReviewResult>
  revealPath?: (path: string) => void | Promise<void>
  /** 06 接 GitHub 评论/关闭：合并成功后的可替换回写钩子。 */
  mergeWriteBack?: (payload: MergeWriteBackPayload) => void | Promise<void>
}

export interface FactoryRunner {
  startTask(
    repoRoot: string,
    runId: string,
    taskId: string,
    input?: FactoryTaskStartInput,
  ): Promise<FactoryTaskStartResult>
  stopTask(repoRoot: string, runId: string, taskId: string): Promise<FactoryTaskActionResult>
  /** 暂停：不再领取新任务，当前回合自然结束。 */
  pauseRun(repoRoot: string, runId: string): Promise<FactoryRunControlResult>
  /** 恢复：继续领取；已停止的运行拒绝恢复。 */
  resumeRun(repoRoot: string, runId: string): Promise<FactoryRunControlResult>
  stopRun(repoRoot: string, runId: string): Promise<FactoryRunStopResult>
  approveTask(repoRoot: string, runId: string, taskId: string): Promise<FactoryTaskActionResult>
  requestChanges(repoRoot: string, runId: string, taskId: string): Promise<FactoryTaskActionResult>
  fixTask(repoRoot: string, runId: string, taskId: string): Promise<FactoryTaskActionResult>
  updateComment(
    repoRoot: string,
    runId: string,
    taskId: string,
    input: FactoryReviewCommentInput,
  ): Promise<FactoryTaskActionResult>
  mergePreflight(repoRoot: string, runId: string, taskId: string): Promise<FactoryMergePreflightResult>
  mergeTask(
    repoRoot: string,
    runId: string,
    taskId: string,
    input: FactoryMergeExecuteInput,
  ): Promise<FactoryMergeResult>
  readEvents(repoRoot: string, runId: string, taskId?: string | null): FactoryEvent[]
  revealWorktree(repoRoot: string, runId: string, taskId: string): Promise<FactoryWorktreeRevealResult>
  /** 配置保存后给当前未结束运行记一条事件；新值只影响之后领取的任务。 */
  recordConfigChange(
    repoRoot: string,
    revision: number,
    options?: { maxConcurrency?: number },
  ): void
  isRunning(taskId: string): boolean
  /** 测试与关闭流程用：等待指定运行的后台实现全部收口。 */
  whenIdle(runId: string): Promise<void>
  onPush(listener: (push: FactoryEventPush) => void): () => void
  dispose(): Promise<void>
}

interface RunningTask {
  runId: string
  sessionId: string
  controller: AbortController
  promise: Promise<void>
}

async function defaultAgentFactory(): Promise<AgentPort> {
  const [engine, factory, sessionConfig, gateway] = await Promise.all([
    import('../engine/engineGateway'),
    import('../engine/engines/EngineFactory'),
    import('../engine/engineSessionConfig'),
    import('./agentEngineGateway'),
  ])
  return gateway.createEngineAgentPort({
    loadSessionConfig: sessionConfig.loadEngineSessionConfig,
    resolveModelAlias: sessionConfig.resolveEngineModelAlias,
    startSession: (sessionId, config) => engine.engineGateway.startSession(sessionId, config),
    sendMessage: (sessionId, content) => engine.engineGateway.sendMessage(sessionId, content),
    stop: (sessionId) => engine.engineGateway.stop(sessionId),
    onRouteEvent: (listener) => factory.EngineFactory.onRouteEvent(listener),
  })
}

async function defaultReveal(path: string): Promise<void> {
  const { shell } = await import('electron')
  shell.showItemInFolder(path)
}

/** 工厂自己的目录不算用户脏改动，避免配置/待办落盘后阻断启动。 */
function userDirtyLines(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .filter((line) => {
      const path = line.slice(3).trim()
      return !path.startsWith('.spacecode/') && !path.startsWith('".spacecode/')
    })
}

function startError(error: WorktreeGitError, stdout = '', stderr = ''): FactoryTaskStartError {
  return error === 'branch-in-use' || error === 'not-git-repo' || error === 'path-too-long' || error === 'permission'
    ? error
    : 'git-error'
}

/** 任务领取时固化的运行参数；实现/审查/修复都只读这份值。 */
interface StageRuntime {
  stages: Record<FactoryStageKey, FactoryStageConfig>
  agentModel?: string
  maxIterations: number
  verifyCommand: string
  taskTimeoutSec: number
}

function cloneStages(
  stages: Record<FactoryStageKey, FactoryStageConfig>,
): Record<FactoryStageKey, FactoryStageConfig> {
  const cloned = {} as Record<FactoryStageKey, FactoryStageConfig>
  for (const key of Object.keys(stages) as FactoryStageKey[]) {
    cloned[key] = { ...stages[key] }
  }
  return cloned
}

export function buildTaskConfigSnapshot(config: FactoryConfig): FactoryTaskConfigSnapshot {
  return {
    revision: config.revision,
    engineType: config.agent.engineType,
    ...(config.agent.model ? { model: config.agent.model } : {}),
    maxIterations: config.agent.maxIterations,
    stages: cloneStages(config.stages),
    verifyCommand: config.commands.verify,
    ...(config.commands.install ? { installCommand: config.commands.install } : {}),
    taskTimeoutSec: config.limits.taskTimeoutSec,
  }
}

function stageRuntimeFor(task: FactoryTask, config: FactoryConfig): StageRuntime {
  const snapshot = task.configSnapshot
  if (snapshot) {
    return {
      stages: snapshot.stages,
      ...(snapshot.model ? { agentModel: snapshot.model } : {}),
      maxIterations: snapshot.maxIterations,
      verifyCommand: snapshot.verifyCommand,
      taskTimeoutSec: snapshot.taskTimeoutSec,
    }
  }
  return {
    stages: config.stages,
    ...(config.agent.model ? { agentModel: config.agent.model } : {}),
    maxIterations: config.agent.maxIterations,
    verifyCommand: config.commands.verify,
    taskTimeoutSec: config.limits.taskTimeoutSec,
  }
}

export function createFactoryRunner(deps: FactoryRunnerDeps = {}): FactoryRunner {
  const now = deps.now ?? (() => new Date())
  const git = deps.git ?? defaultGitRunner
  const buildPrompt = deps.buildPrompt ?? buildImplementPrompt
  const buildReview = deps.buildReviewPrompt ?? buildReviewPrompt
  const buildFix = deps.buildFixPrompt ?? buildFixPrompt
  const implement = deps.runImplementation ?? runImplementation
  const review = deps.runReview ?? runReview
  const reveal = deps.revealPath ?? defaultReveal

  const running = new Map<string, RunningTask>()
  /** 每个运行的自动调度泵；同一运行同一时刻只跑一个，结束后按 pendingPumps 续跑。 */
  const pumps = new Map<string, { runId: string; promise: Promise<void> }>()
  const pendingPumps = new Set<string>()
  const sinks = new Map<string, ReturnType<typeof openEventLog>>()
  const listeners = new Set<(push: FactoryEventPush) => void>()
  /** 每个任务的审查轮次；同一进程内递增，重启后按已有 review 回到下一轮。 */
  const reviewRounds = new Map<string, number>()

  function eventsPath(repoRoot: string, runId: string): string {
    return join(repoRoot, FACTORY_RUNS_PATH, runId, 'events.jsonl')
  }

  function sinkFor(repoRoot: string, runId: string) {
    const key = `${repoRoot}::${runId}`
    const cached = sinks.get(key)
    if (cached) return cached
    const sink = openEventLog(eventsPath(repoRoot, runId), { runId, now })
    sinks.set(key, sink)
    return sink
  }

  function emit(repoRoot: string, runId: string, input: FactoryEventInput): FactoryEvent {
    const event = sinkFor(repoRoot, runId).append(input)
    const snapshot = readRunSnapshot(repoRoot, runId)
    if (snapshot) {
      const push: FactoryEventPush = { event, snapshot }
      for (const listener of listeners) listener(push)
    }
    return event
  }

  function taskOf(repoRoot: string, runId: string, taskId: string): FactoryTask | null {
    const snapshot = readRunSnapshot(repoRoot, runId)
    return snapshot?.tasks.find((task) => task.id === taskId) ?? null
  }

  /** 兜底：实现循环被外部取消/抛出时也要落到 blocked，保留现场。 */
  function safeBlock(repoRoot: string, runId: string, taskId: string, reason: string): void {
    const task = taskOf(repoRoot, runId, taskId)
    if (!task) return
    if (task.lane !== 'implementing' && task.lane !== 'reviewing') return
    transitionTask(repoRoot, runId, taskId, { lane: 'blocked' }, reason)
  }

  function nextReviewRound(repoRoot: string, runId: string, taskId: string, task: FactoryTask): number {
    const key = `${repoRoot}::${runId}::${taskId}`
    const base = reviewRounds.get(key) ?? (task.review ? 1 : 0)
    const round = base + 1
    reviewRounds.set(key, round)
    return round
  }

  /** 修复提示词里的意见清单：文件:行号 + 级别 + 内容，越界字段已被解析器降级掉。 */
  function formatReviewComments(comments: FactoryReviewComment[]): string {
    return comments
      .map((comment) => {
        const where = comment.file
          ? comment.line
            ? `${comment.file}:${comment.line}`
            : comment.file
          : ''
        return `- ${where ? `${where} ` : ''}[${comment.severity}] ${comment.body}`
      })
      .join('\n')
  }

  async function makeAgent(
    repoRoot: string,
    runId: string,
    taskId: string,
    stage: 'implement' | 'review',
  ): Promise<AgentPort | null> {
    try {
      return await (deps.agentFactory ?? defaultAgentFactory)()
    } catch (error) {
      safeBlock(repoRoot, runId, taskId, 'agent.error')
      emit(repoRoot, runId, {
        taskId,
        stage,
        code: 'task.agent.error',
        level: 'error',
        params: { message: String((error as Error)?.message ?? error) },
      })
      return null
    }
  }

  /** 实现验证通过后发起全新审查会话；审查自己负责迁移与事件，这里只管提示词与会话。 */
  async function startReview(
    repoRoot: string,
    runId: string,
    taskId: string,
    worktreeAbsolute: string,
    baseBranch: string,
    agent: AgentPort,
    controller: AbortController,
    config: FactoryConfig,
    runtime: StageRuntime,
  ): Promise<void> {
    const task = taskOf(repoRoot, runId, taskId)
    if (!task) return

    const prompt = await buildReview({
      repoRoot,
      promptPath: config.prompts.review,
      task: {
        title: task.title,
        goal: task.goal,
        ...(typeof task.issueNumber === 'number' ? { issueNumber: task.issueNumber } : {}),
      },
      sourceBranch: task.branch,
      targetBranch: baseBranch,
      worktree: worktreeAbsolute,
    })
    if (!prompt.ok) {
      transitionTask(repoRoot, runId, taskId, { lane: 'blocked' }, 'prompt.error')
      emit(repoRoot, runId, {
        taskId,
        stage: 'review',
        code: 'task.prompt.error',
        level: 'error',
        ...(prompt.detail ? { params: { detail: prompt.detail } } : {}),
      })
      return
    }
    for (const command of prompt.blocked) {
      emit(repoRoot, runId, {
        taskId,
        stage: 'review',
        code: 'prompt.command.blocked',
        level: 'warn',
        params: { command },
      })
    }

    const stageConfig = runtime.stages.review
    const round = nextReviewRound(repoRoot, runId, taskId, task)
    await review({
      repoRoot,
      runId,
      task,
      prompt: prompt.text,
      worktreeAbsolute,
      sessionId: `fac-${runId}-${taskId}-review-${round}`,
      ...(stageConfig.model ?? runtime.agentModel
        ? { model: stageConfig.model ?? runtime.agentModel }
        : {}),
      permissionMode: stageConfig.permissionMode,
      signal: controller.signal,
      deps: {
        agent,
        emit: (event) => {
          emit(repoRoot, runId, event)
        },
        appendLog: (id, text) => {
          appendRawLog(join(repoRoot, LOGS_DIR), id, text)
        },
        now,
      },
    })
  }

  /** 实现/修复共用：跑实现循环，验证通过时接一次审查。 */
  function runImplementationLoop(
    repoRoot: string,
    runId: string,
    taskId: string,
    worktreeAbsolute: string,
    baseBranch: string,
    agent: AgentPort,
    controller: AbortController,
    config: FactoryConfig,
    runtime: StageRuntime,
    input: ImplementInput,
  ): Promise<void> {
    return implement(input)
      .then(async (result) => {
        if (result.verified === true && !controller.signal.aborted) {
          await startReview(
            repoRoot,
            runId,
            taskId,
            worktreeAbsolute,
            baseBranch,
            agent,
            controller,
            config,
            runtime,
          )
        }
      })
      .catch((error: unknown) => {
        safeBlock(repoRoot, runId, taskId, 'agent.error')
        emit(repoRoot, runId, {
          taskId,
          stage: 'implement',
          code: 'task.agent.error',
          level: 'error',
          params: { message: String((error as Error)?.message ?? error) },
        })
      })
  }

  function activeTaskIds(repoRoot: string, runId: string): string[] {
    return [...running.entries()]
      .filter(([, entry]) => entry.runId === runId)
      .map(([id]) => id)
  }

  /** 一个运行的派发循环：领取 → 再判槽位，直到没有候选或没有空位。 */
  async function dispatchAvailable(repoRoot: string, runId: string): Promise<void> {
    while (true) {
      const snapshot = readRunSnapshot(repoRoot, runId)
      if (!snapshot) return
      const decision = dispatchDecision(snapshot, activeTaskIds(repoRoot, runId))
      if (!decision.taskId) {
        if (decision.waitingForSlot > 0) {
          emit(repoRoot, runId, {
            taskId: null,
            code: 'scheduler.waiting',
            level: 'info',
            params: { waiting: decision.waitingForSlot, active: decision.active, max: decision.max },
          })
        }
        return
      }
      const result = await startTaskInternal(repoRoot, runId, decision.taskId, {})
      if (!result.ok) {
        if (result.error !== 'not-queued' && result.error !== 'already-running') {
          emit(repoRoot, runId, {
            taskId: decision.taskId,
            code: 'scheduler.dispatch.failed',
            level: 'error',
            params: { reason: result.error },
          })
        }
        return
      }
    }
  }

  /**
   * 调度泵：同一运行同一时刻只跑一个；运行内任务收口时用 pendingPumps
   * 让正在退出的泵再跑一轮，避免「槽位刚空出来却没有下一次派发」。
   */
  function pumpRun(repoRoot: string, runId: string): Promise<void> {
    const key = `${repoRoot}::${runId}`
    const existing = pumps.get(key)
    if (existing) {
      pendingPumps.add(key)
      return existing.promise
    }
    const promise = (async () => {
      try {
        do {
          pendingPumps.delete(key)
          await dispatchAvailable(repoRoot, runId)
        } while (pendingPumps.has(key))
      } finally {
        pumps.delete(key)
      }
    })()
    pumps.set(key, { runId, promise })
    return promise
  }

  async function startTaskInternal(
    repoRoot: string,
    runId: string,
    taskId: string,
    input: FactoryTaskStartInput = {},
  ): Promise<FactoryTaskStartResult> {
    const config = readFactoryConfig(repoRoot)
    if (!config) return { ok: false, error: 'config-missing' }

    const snapshot = readRunSnapshot(repoRoot, runId)
    if (!snapshot) return { ok: false, error: 'task-not-found' }
    const task = snapshot.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: 'task-not-found' }

    // 停止后的运行不再领取任何任务，即使手动点击也不放行。
    if (snapshot.run.status === 'stopped') return { ok: false, error: 'not-queued' }
    if (running.has(taskId)) return { ok: false, error: 'already-running' }
    if (task.lane !== 'queued' && task.lane !== 'blocked') return { ok: false, error: 'not-queued' }

    // 手动领取与调度泵共用同一道闸门：依赖未完成或槽位已满都不放行。
    const byId = new Map(snapshot.tasks.map((item) => [item.id, item]))
    if (!dependenciesMet(task, byId)) return { ok: false, error: 'dependency-unmet' }
    if (activeTaskIds(repoRoot, runId).length >= clampConcurrency(snapshot.run.maxConcurrency)) {
      return { ok: false, error: 'no-slot' }
    }

    // 仓库检查：非仓库会在 status 上直接失败。
    const status = await git(['status', '--porcelain'], repoRoot)
    if (!status.ok) {
      const mapped = mapGitFailure(status.stderr)
      return { ok: false, error: startError(mapped), detail: status.stderr.trim() }
    }
    const dirty = userDirtyLines(status.stdout)
    if (dirty.length > 0 && input.confirmDirty !== true) {
      return { ok: false, error: 'dirty-worktree', detail: String(dirty.length) }
    }

    const baseBranch = config.repo.baseBranch
    const verifyBase = await git(['rev-parse', '--verify', baseBranch], repoRoot)
    if (!verifyBase.ok) {
      const mapped = mapGitFailure(verifyBase.stderr)
      return {
        ok: false,
        error: mapped === 'not-git-repo' ? 'not-git-repo' : 'base-branch-missing',
        detail: verifyBase.stderr.trim(),
      }
    }

    const prepared = await prepareWorktree(
      { repoRoot, taskId, branch: task.branch, baseBranch },
      { git },
    )
    if (!prepared.ok) {
      return {
        ok: false,
        error: prepared.error,
        ...(prepared.detail ? { detail: prepared.detail } : {}),
      }
    }
    const worktree = prepared.worktree

    // git/prompt 等待期间运行可能已被停止或任务已被取消：领取前再读一次。
    const fresh = readRunSnapshot(repoRoot, runId)
    if (!fresh || fresh.run.status === 'stopped') return { ok: false, error: 'not-queued' }
    const freshTask = fresh.tasks.find((item) => item.id === taskId)
    if (!freshTask || (freshTask.lane !== 'queued' && freshTask.lane !== 'blocked')) {
      return { ok: false, error: 'not-queued' }
    }

    // 领取时固化配置：此后保存的配置只影响新领取的任务。
    const configSnapshot = buildTaskConfigSnapshot(config)
    const implementStage = configSnapshot.stages.implement
    const moved = transitionTask(
      repoRoot,
      runId,
      taskId,
      { lane: 'implementing', stageIdx: 1 },
      'worktree.ready',
      {
        worktree: worktree.relative,
        branch: worktree.branch,
        model: implementStage.model ?? configSnapshot.model ?? '',
        maxIterations: implementStage.maxIterations ?? configSnapshot.maxIterations,
        configSnapshot,
      },
      { now },
    )
    if (!moved.ok) return { ok: false, error: 'task-not-found' }

    updateRun(
      repoRoot,
      runId,
      {
        status: fresh.run.paused ? 'paused' : 'running',
        configRevision: config.revision,
        ...(fresh.run.startedAt ? {} : { startedAt: now().toISOString() }),
      },
      { now },
    )

    emit(repoRoot, runId, {
      taskId,
      stage: 'implement',
      code: 'task.started',
      level: 'info',
      params: { branch: worktree.branch, path: worktree.relative },
    })
    emit(repoRoot, runId, {
      taskId,
      stage: 'implement',
      code: worktree.reused ? 'worktree.reused' : 'worktree.created',
      level: 'ok',
      params: { path: worktree.relative },
    })

    const prompt = await buildPrompt({
      repoRoot,
      promptPath: config.prompts.implement,
      task: {
        title: task.title,
        goal: task.goal,
        ...(typeof task.issueNumber === 'number' ? { issueNumber: task.issueNumber } : {}),
      },
      sourceBranch: worktree.branch,
      targetBranch: baseBranch,
      worktree: worktree.absolute,
    })
    if (!prompt.ok) {
      transitionTask(repoRoot, runId, taskId, { lane: 'blocked' }, 'prompt.error')
      emit(repoRoot, runId, {
        taskId,
        stage: 'implement',
        code: 'task.prompt.error',
        level: 'error',
        ...(prompt.detail ? { params: { detail: prompt.detail } } : {}),
      })
      return {
        ok: false,
        error: 'prompt-error',
        ...(prompt.detail ? { detail: prompt.detail } : {}),
      }
    }
    for (const command of prompt.blocked) {
      emit(repoRoot, runId, {
        taskId,
        stage: 'implement',
        code: 'prompt.command.blocked',
        level: 'warn',
        params: { command },
      })
    }

    const agent = await makeAgent(repoRoot, runId, taskId, 'implement')
    if (!agent) return { ok: false, error: 'agent-error' }

    const sessionId = `fac-${runId}-${taskId}-impl`
    const controller = new AbortController()
    const current = taskOf(repoRoot, runId, taskId) ?? task
    // 快照刚写下，这里读到的就是本次领取的配置；修复沿用同一份。
    const runtime = stageRuntimeFor(current, config)
    const stageConfig = runtime.stages.implement

    transitionTask(
      repoRoot,
      runId,
      taskId,
      { lane: 'implementing', stageIdx: 2 },
      'implementation.started',
      {},
      { now },
    )

    const promise: Promise<void> = runImplementationLoop(
      repoRoot,
      runId,
      taskId,
      worktree.absolute,
      baseBranch,
      agent,
      controller,
      config,
      runtime,
      {
        repoRoot,
        runId,
        task: current,
        prompt: prompt.text,
        worktreeAbsolute: worktree.absolute,
        baseBranch,
        sessionId,
        ...(stageConfig.model ?? runtime.agentModel
          ? { model: stageConfig.model ?? runtime.agentModel }
          : {}),
        permissionMode: stageConfig.permissionMode,
        signal: controller.signal,
        maxIterations: stageConfig.maxIterations ?? runtime.maxIterations,
        verifyCommand: runtime.verifyCommand,
        verifyTimeoutMs: runtime.taskTimeoutSec * 1000,
        deps: {
          agent,
          emit: (event) => {
            emit(repoRoot, runId, event)
          },
          appendLog: (id, text) => {
            appendRawLog(join(repoRoot, LOGS_DIR), id, text)
          },
          now,
        },
      },
    ).finally(() => {
      running.delete(taskId)
      void pumpRun(repoRoot, runId)
    })

    running.set(taskId, { runId, sessionId, controller, promise })

    emit(repoRoot, runId, {
      taskId,
      stage: 'implement',
      code: 'scheduler.claimed',
      level: 'info',
      params: { active: activeTaskIds(repoRoot, runId).length, max: snapshot.run.maxConcurrency },
    })

    const latest = readRunSnapshot(repoRoot, runId)
    return latest ? { ok: true, snapshot: latest } : { ok: false, error: 'task-not-found' }
  }

  return {
    async startTask(repoRoot, runId, taskId, input = {}) {
      const result = await startTaskInternal(repoRoot, runId, taskId, input)
      if (result.ok) void pumpRun(repoRoot, runId)
      return result
    },

    async stopTask(repoRoot, runId, taskId) {
      const entry = running.get(taskId)
      if (!entry || entry.runId !== runId) return { ok: false, error: 'not-running' }

      entry.controller.abort()
      try {
        await entry.promise
      } catch {
        return { ok: false, error: 'stop-failed' }
      }
      safeBlock(repoRoot, runId, taskId, 'stopped')

      const latest = readRunSnapshot(repoRoot, runId)
      return latest ? { ok: true, snapshot: latest } : { ok: false, error: 'task-not-found' }
    },

    async pauseRun(repoRoot, runId) {
      const snapshot = readRunSnapshot(repoRoot, runId)
      if (!snapshot) return { ok: false, error: 'run-not-found' }
      if (snapshot.run.status === 'stopped') return { ok: false, error: 'run-stopped' }

      updateRun(repoRoot, runId, { status: 'paused', paused: true }, { now })
      emit(repoRoot, runId, {
        taskId: null,
        code: 'run.paused',
        level: 'warn',
        params: { running: activeTaskIds(repoRoot, runId).length },
      })

      const latest = readRunSnapshot(repoRoot, runId)
      return latest ? { ok: true, snapshot: latest } : { ok: false, error: 'run-not-found' }
    },

    async resumeRun(repoRoot, runId) {
      const snapshot = readRunSnapshot(repoRoot, runId)
      if (!snapshot) return { ok: false, error: 'run-not-found' }
      if (snapshot.run.status === 'stopped') return { ok: false, error: 'run-stopped' }

      updateRun(
        repoRoot,
        runId,
        {
          status: 'running',
          paused: false,
          ...(snapshot.run.startedAt ? {} : { startedAt: now().toISOString() }),
        },
        { now },
      )
      emit(repoRoot, runId, { taskId: null, code: 'run.resumed', level: 'info' })
      void pumpRun(repoRoot, runId)

      const latest = readRunSnapshot(repoRoot, runId)
      return latest ? { ok: true, snapshot: latest } : { ok: false, error: 'run-not-found' }
    },

    async stopRun(repoRoot, runId) {
      const snapshot = readRunSnapshot(repoRoot, runId)
      if (!snapshot) return { ok: false, error: 'run-not-found' }

      // 先落 stopped 再中止：调度泵与在途领取都据此立即拒绝新任务。
      updateRun(
        repoRoot,
        runId,
        {
          status: 'stopped',
          paused: false,
          endedAt: now().toISOString(),
        },
        { now },
      )

      const entries = [...running.entries()].filter(([, entry]) => entry.runId === runId)
      for (const [, entry] of entries) entry.controller.abort()
      await Promise.all(entries.map(([, entry]) => entry.promise.catch(() => {})))
      // 泵可能已经读到旧的 running 状态，等它退出后再收口残留的领取。
      await Promise.all(
        [...pumps.values()]
          .filter((entry) => entry.runId === runId)
          .map((entry) => entry.promise.catch(() => {})),
      )

      const latestTasks = readRunSnapshot(repoRoot, runId)?.tasks ?? []
      for (const task of latestTasks) {
        if (task.lane === 'implementing' || task.lane === 'reviewing') {
          safeBlock(repoRoot, runId, task.id, 'stopped')
        }
      }

      emit(repoRoot, runId, {
        taskId: null,
        code: 'run.stopped',
        level: 'warn',
        params: { stopped: entries.length },
      })

      const latest = readRunSnapshot(repoRoot, runId)
      return latest ? { ok: true, snapshot: latest } : { ok: false, error: 'run-not-found' }
    },

    async approveTask(repoRoot, runId, taskId) {
      const task = taskOf(repoRoot, runId, taskId)
      if (!task) return { ok: false, error: 'task-not-found' }
      if (task.lane !== 'reviewing') return { ok: false, error: 'not-eligible' }
      if (!mergeEligibility(task).ok) return { ok: false, error: 'not-eligible' }

      const moved = transitionTask(
        repoRoot,
        runId,
        taskId,
        { lane: 'mergeable', stageIdx: 5 },
        'task.approved',
        {},
        { now },
      )
      if (!moved.ok) return { ok: false, error: 'not-eligible' }

      emit(repoRoot, runId, {
        taskId,
        stage: 'review',
        code: 'task.approved',
        level: 'ok',
      })

      const latest = readRunSnapshot(repoRoot, runId)
      return latest ? { ok: true, snapshot: latest } : { ok: false, error: 'task-not-found' }
    },

    async requestChanges(repoRoot, runId, taskId) {
      const task = taskOf(repoRoot, runId, taskId)
      if (!task) return { ok: false, error: 'task-not-found' }
      if (task.lane !== 'reviewing') return { ok: false, error: 'not-eligible' }

      const moved = transitionTask(
        repoRoot,
        runId,
        taskId,
        { lane: 'blocked' },
        'review.changes_requested',
        {},
        { now },
      )
      if (!moved.ok) return { ok: false, error: 'not-eligible' }

      emit(repoRoot, runId, {
        taskId,
        stage: 'review',
        code: 'task.changes_requested',
        level: 'warn',
      })

      const latest = readRunSnapshot(repoRoot, runId)
      return latest ? { ok: true, snapshot: latest } : { ok: false, error: 'task-not-found' }
    },

    async fixTask(repoRoot, runId, taskId) {
      const config = readFactoryConfig(repoRoot)
      if (!config) return { ok: false, error: 'config-missing' }

      const task = taskOf(repoRoot, runId, taskId)
      if (!task) return { ok: false, error: 'task-not-found' }
      if (!task.worktree) return { ok: false, error: 'no-worktree' }
      if (running.has(taskId)) return { ok: false, error: 'already-running' }
      if (task.lane !== 'blocked' && task.lane !== 'reviewing') {
        return { ok: false, error: 'not-fixable' }
      }

      const pending = pendingComments(task.review)
      if (pending.length === 0) return { ok: false, error: 'not-fixable' }

      const worktreeAbsolute = worktreeAbsolutePath(repoRoot, taskId)
      const prompt = await buildFix({
        repoRoot,
        promptPath: config.prompts.fix,
        task: {
          title: task.title,
          goal: task.goal,
          ...(typeof task.issueNumber === 'number' ? { issueNumber: task.issueNumber } : {}),
        },
        sourceBranch: task.branch,
        targetBranch: config.repo.baseBranch,
        worktree: worktreeAbsolute,
        reviewComments: formatReviewComments(pending),
      })
      if (!prompt.ok) {
        transitionTask(repoRoot, runId, taskId, { lane: 'blocked' }, 'prompt.error')
        emit(repoRoot, runId, {
          taskId,
          stage: 'implement',
          code: 'task.prompt.error',
          level: 'error',
          ...(prompt.detail ? { params: { detail: prompt.detail } } : {}),
        })
        return {
          ok: false,
          error: 'prompt-error',
          ...(prompt.detail ? { detail: prompt.detail } : {}),
        }
      }
      for (const command of prompt.blocked) {
        emit(repoRoot, runId, {
          taskId,
          stage: 'implement',
          code: 'prompt.command.blocked',
          level: 'warn',
          params: { command },
        })
      }

      const agent = await makeAgent(repoRoot, runId, taskId, 'implement')
      if (!agent) return { ok: false, error: 'agent-error' }

      const moved = transitionTask(
        repoRoot,
        runId,
        taskId,
        { lane: 'implementing', stageIdx: 2 },
        'fix.started',
        {},
        { now },
      )
      if (!moved.ok) return { ok: false, error: 'not-fixable' }

      emit(repoRoot, runId, {
        taskId,
        stage: 'implement',
        code: 'task.fix.started',
        level: 'info',
        params: { comments: pending.length },
      })

      const sessionId = `fac-${runId}-${taskId}-fix`
      const controller = new AbortController()
      const current = taskOf(repoRoot, runId, taskId) ?? task
      // 修复沿用任务领取时的快照，不跟随之后保存的配置。
      const runtime = stageRuntimeFor(current, config)
      const stageConfig = runtime.stages.implement

      const promise: Promise<void> = runImplementationLoop(
        repoRoot,
        runId,
        taskId,
        worktreeAbsolute,
        config.repo.baseBranch,
        agent,
        controller,
        config,
        runtime,
        {
          repoRoot,
          runId,
          task: current,
          prompt: prompt.text,
          worktreeAbsolute,
          baseBranch: config.repo.baseBranch,
          sessionId,
          ...(stageConfig.model ?? runtime.agentModel
            ? { model: stageConfig.model ?? runtime.agentModel }
            : {}),
          permissionMode: stageConfig.permissionMode,
          signal: controller.signal,
          maxIterations: stageConfig.maxIterations ?? runtime.maxIterations,
          verifyCommand: runtime.verifyCommand,
          verifyTimeoutMs: runtime.taskTimeoutSec * 1000,
          deps: {
            agent,
            emit: (event) => {
              emit(repoRoot, runId, event)
            },
            appendLog: (id, text) => {
              appendRawLog(join(repoRoot, LOGS_DIR), id, text)
            },
            now,
          },
        },
      ).finally(() => {
        running.delete(taskId)
        void pumpRun(repoRoot, runId)
      })

      running.set(taskId, { runId, sessionId, controller, promise })

      const latest = readRunSnapshot(repoRoot, runId)
      return latest ? { ok: true, snapshot: latest } : { ok: false, error: 'task-not-found' }
    },

    async updateComment(repoRoot, runId, taskId, input) {
      const task = taskOf(repoRoot, runId, taskId)
      if (!task) return { ok: false, error: 'task-not-found' }
      if (!task.review) return { ok: false, error: 'not-fixable' }

      const comment = task.review.comments.find((item) => item.id === input.commentId)
      if (!comment) return { ok: false, error: 'not-fixable' }
      if (input.action === 'ignore' && comment.severity === 'blocker' && input.confirm !== true) {
        return { ok: false, error: 'confirm-required' }
      }

      const review = updateReviewComment(task.review, input.commentId, input.action)
      if (!review) return { ok: false, error: 'not-fixable' }
      patchTask(repoRoot, runId, taskId, { review })

      emit(repoRoot, runId, {
        taskId,
        stage: 'review',
        code: input.action === 'accept' ? 'review.comment.accepted' : 'review.comment.ignored',
        level: input.action === 'accept' ? 'info' : 'warn',
        params: { commentId: comment.id },
      })

      const latest = readRunSnapshot(repoRoot, runId)
      return latest ? { ok: true, snapshot: latest } : { ok: false, error: 'task-not-found' }
    },

    async mergePreflight(repoRoot, runId, taskId) {
      return runMergePreflight(repoRoot, runId, taskId, { git, now })
    },

    async mergeTask(repoRoot, runId, taskId, input) {
      return executeMerge(repoRoot, runId, taskId, input, {
        git,
        now,
        emit: (event) => {
          emit(repoRoot, runId, event)
        },
        ...(deps.mergeWriteBack ? { writeBack: deps.mergeWriteBack } : {}),
      })
    },

    readEvents(repoRoot, runId, taskId) {
      return readEventLog(eventsPath(repoRoot, runId), {
        ...(taskId === undefined ? {} : { taskId }),
      })
    },

    async revealWorktree(repoRoot, runId, taskId) {
      const task = taskOf(repoRoot, runId, taskId)
      if (!task) return { ok: false, error: 'task-not-found' }
      if (!task.worktree) return { ok: false, error: 'no-worktree' }

      const absolute = worktreeAbsolutePath(repoRoot, taskId)
      if (!existsSync(absolute)) return { ok: false, error: 'no-worktree' }
      try {
        await reveal(absolute)
        return { ok: true }
      } catch {
        return { ok: false, error: 'reveal-failed' }
      }
    },

    recordConfigChange(repoRoot, revision, options = {}) {
      const latest = readLatestRun(repoRoot)
      if (!latest || latest.run.status === 'stopped') return

      const runId = latest.run.id
      updateRun(
        repoRoot,
        runId,
        {
          configRevision: revision,
          ...(options.maxConcurrency === undefined
            ? {}
            : { maxConcurrency: clampConcurrency(options.maxConcurrency) }),
        },
        { now },
      )
      emit(repoRoot, runId, {
        taskId: null,
        code: 'config.changed',
        level: 'info',
        params: { revision },
      })
      // 上限调高时立即补领取；调低只影响之后的领取，不打断在跑任务。
      void pumpRun(repoRoot, runId)
    },

    isRunning(taskId) {
      return running.has(taskId)
    },

    async whenIdle(runId) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const promises = [...running.values()]
          .filter((entry) => entry.runId === runId)
          .map((entry) => entry.promise)
        const pumping = [...pumps.values()]
          .filter((entry) => entry.runId === runId)
          .map((entry) => entry.promise)
        if (promises.length === 0 && pumping.length === 0) return
        await Promise.all([...promises, ...pumping])
      }
    },

    onPush(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async dispose() {
      const entries = [...running.values()]
      for (const entry of entries) entry.controller.abort()
      await Promise.all(entries.map((entry) => entry.promise.catch(() => {})))
      await Promise.all([...pumps.values()].map((entry) => entry.promise.catch(() => {})))
      running.clear()
      pumps.clear()
      pendingPumps.clear()
      listeners.clear()
      sinks.clear()
      reviewRounds.clear()
    },
  } satisfies FactoryRunner
}
