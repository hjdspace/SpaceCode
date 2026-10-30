/**
 * 规划阶段：一次只读的 Agent 回合，产出 `<plan>` JSON。
 *
 * 协议对齐 sandcastle：模板来自 `prompts.plan`，候选任务以变量注入，
 * 命令在工作树（仓库根）展开；解析取最后一个 `<plan>` 块，容忍代码围栏，
 * 失败时在同一会话里续跑一次反馈重发。规划不落运行、不写文件，
 * 结果交给渲染层预览，用户确认后才创建运行。
 */
import type {
  FactoryConfig,
  FactoryPlanCandidate,
  FactoryPlanResult,
  FactoryPlanTask,
  FactoryPlanWarning,
} from '@/shared/factory'
import { buildPlanPrompt, type PlanPromptData } from './prompt'
import { createDefaultAgentPort, type AgentPort } from './agentEngineGateway'

const PLAN_TAG = 'plan'
const PLAN_MAX_RETRIES = 1
const DEFAULT_MAX_TASKS = 10
const PLANNER_TIMEOUT_MS = 10 * 60_000
const RAW_FEEDBACK_LIMIT = 4000

export interface PlannerDeps {
  /** 测试注入；生产走 agentFactory。 */
  agent?: AgentPort
  agentFactory?: () => Promise<AgentPort>
  now?: () => Date
  appendLog?: (text: string) => void
  timeoutMs?: number
}

export interface PlannerInput {
  repoRoot: string
  config: FactoryConfig
  candidates: FactoryPlanCandidate[]
  signal?: AbortSignal
  deps?: PlannerDeps
}

export type PlanParseFailure = { ok: false; detail: string; raw?: string }
export type PlanParseResult =
  | { ok: true; tasks: FactoryPlanTask[]; warnings: FactoryPlanWarning[] }
  | PlanParseFailure

function findLastTagContent(text: string, tag: string): string | undefined {
  const openTag = `<${tag}>`
  const closeTag = `</${tag}>`
  let lastContent: string | undefined
  let searchFrom = 0

  while (true) {
    const openIdx = text.indexOf(openTag, searchFrom)
    if (openIdx === -1) break
    const contentStart = openIdx + openTag.length
    const closeIdx = text.indexOf(closeTag, contentStart)
    if (closeIdx === -1) break
    lastContent = text.slice(contentStart, closeIdx)
    searchFrom = closeIdx + closeTag.length
  }

  return lastContent
}

function unwrapFences(text: string): string {
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/)
  return fence ? fence[1]!.trim() : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 依赖成环会让调度器永远等不到可领取任务，必须在规划阶段拦下。 */
function findCycle(tasks: readonly FactoryPlanTask[]): string | null {
  const graph = new Map(tasks.map((task) => [task.id, task.dependsOn]))
  const state = new Map<string, 1 | 2>()

  const visit = (id: string): string | null => {
    const current = state.get(id)
    if (current === 1) return id
    if (current === 2) return null
    state.set(id, 1)
    for (const dependency of graph.get(id) ?? []) {
      const cycle = visit(dependency)
      if (cycle !== null) return cycle
    }
    state.set(id, 2)
    return null
  }

  for (const task of tasks) {
    const cycle = visit(task.id)
    if (cycle !== null) return cycle
  }
  return null
}

function normalizeDependency(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return `issue-${value}`
  return null
}

/**
 * 解析并校验 `<plan>`。只接受候选清单里的 id；依赖必须指向本次计划内
 * 的任务，且不允许成环。超出上限时截断并给出告警，而不是丢整份计划。
 */
export function parsePlanOutput(
  text: string,
  candidates: readonly FactoryPlanCandidate[],
  maxTasks: number,
): PlanParseResult {
  const raw = findLastTagContent(text, PLAN_TAG)
  if (raw === undefined) {
    return { ok: false, detail: `structured output tag <${PLAN_TAG}> not found` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapFences(raw.trim()))
  } catch (error) {
    return {
      ok: false,
      detail: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      raw,
    }
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
    return { ok: false, detail: 'expected { "tasks": [...] }', raw }
  }

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const byNumber = new Map(
    candidates
      .filter((candidate) => typeof candidate.issueNumber === 'number')
      .map((candidate) => [candidate.issueNumber as number, candidate]),
  )

  // 先按出现顺序收敛 id；同一任务重复出现时以最后一次为准，但位置不变。
  const order: string[] = []
  const resolved = new Map<string, FactoryPlanTask>()

  for (const item of parsed.tasks) {
    if (!isRecord(item)) return { ok: false, detail: 'task must be an object', raw }

    const idText = typeof item.id === 'string' ? item.id.trim() : ''
    const number = typeof item.issueNumber === 'number' ? item.issueNumber : undefined
    const numberText = typeof item.issueNumber === 'string' ? item.issueNumber.trim() : ''
    const candidate = idText
      ? byId.get(idText)
      : number !== undefined
        ? byNumber.get(number)
        : numberText
          ? byId.get(numberText)
          : undefined
    if (!candidate) {
      const label = idText || numberText || (number !== undefined ? `issue-${number}` : '(missing id)')
      return { ok: false, detail: `unknown task: ${label}`, raw }
    }

    const dependsOn: string[] = []
    const rawDependencies = item.dependsOn
    if (rawDependencies !== undefined) {
      if (!Array.isArray(rawDependencies)) {
        return { ok: false, detail: `dependsOn must be an array for ${candidate.id}`, raw }
      }
      for (const value of rawDependencies) {
        const dependency = normalizeDependency(value)
        if (dependency === null) {
          return { ok: false, detail: `invalid dependency for ${candidate.id}`, raw }
        }
        if (!dependsOn.includes(dependency)) dependsOn.push(dependency)
      }
    }

    if (!resolved.has(candidate.id)) order.push(candidate.id)
    resolved.set(candidate.id, {
      id: candidate.id,
      title: candidate.title,
      ...(typeof candidate.issueNumber === 'number' ? { issueNumber: candidate.issueNumber } : {}),
      dependsOn,
      parallelizable: item.parallelizable !== false,
    })
  }

  const selected = order.map((id) => resolved.get(id)!)
  const planIds = new Set(order)
  const limit = Math.max(1, Math.floor(maxTasks))

  // 先按上限截断，再剔除依赖了被截掉任务的下游任务：
  // 否则运行创建时会静默丢掉依赖，让本该等待的任务提前开跑。
  let tasks = selected.slice(0, limit)
  let changed = true
  while (changed) {
    changed = false
    const kept = new Set(tasks.map((task) => task.id))
    const next = tasks.filter((task) => task.dependsOn.every((dependency) => kept.has(dependency)))
    if (next.length !== tasks.length) {
      tasks = next
      changed = true
    }
  }

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!planIds.has(dependency)) {
        return {
          ok: false,
          detail: `${task.id} depends on unplanned task ${dependency}`,
          raw,
        }
      }
    }
  }

  const cycle = findCycle(tasks)
  if (cycle !== null) {
    return { ok: false, detail: `dependency cycle at ${cycle}`, raw }
  }

  const warnings: FactoryPlanWarning[] =
    tasks.length < selected.length ? [{ code: 'truncated', max: limit }] : []

  return { ok: true, tasks, warnings }
}

function buildRetryFeedback(failure: PlanParseFailure): string {
  const raw =
    failure.raw === undefined
      ? '(no matching <plan> block was emitted)'
      : failure.raw.length > RAW_FEEDBACK_LIMIT
        ? `${failure.raw.slice(0, RAW_FEEDBACK_LIMIT)}…`
        : failure.raw

  return `Your previous response did not produce a valid <plan> block.

Problem:
${failure.detail}

Previous matched output:
${raw}

Emit only a corrected <plan> block that matches the requested schema.
Use task ids from the candidate list exactly. Do not run commands or change files.`
}

function toPlanError(
  result: { ok: false; error: 'prompt-missing' | 'prompt-error'; detail?: string },
): FactoryPlanResult {
  return {
    ok: false,
    error: result.error,
    ...(result.detail ? { detail: result.detail } : {}),
  }
}

export async function runPlanner(input: PlannerInput): Promise<FactoryPlanResult> {
  const { config } = input
  if (!config.stages.plan.enabled) return { ok: false, error: 'plan-disabled' }
  if (input.candidates.length === 0) return { ok: false, error: 'no-candidates' }

  const deps = input.deps ?? {}
  const maxTasks = config.limits.maxTasksPerRun ?? DEFAULT_MAX_TASKS
  const plan: PlanPromptData = {
    candidates: input.candidates,
    maxTasks,
    tracker: config.tracker.type,
  }

  const built = await buildPlanPrompt({
    repoRoot: input.repoRoot,
    promptPath: config.prompts.plan,
    task: { title: 'Plan the next run', goal: 'Select tasks that can run in parallel' },
    sourceBranch: config.repo.baseBranch,
    targetBranch: config.repo.baseBranch,
    worktree: input.repoRoot,
    plan,
  })
  if (!built.ok) return toPlanError(built)
  // 与 sandcastle 一致：模板必须自己写明输出标签，避免配置错位时白跑一次。
  if (!built.text.includes(`<${PLAN_TAG}>`)) {
    return { ok: false, error: 'prompt-error', detail: 'plan-tag-missing' }
  }

  let agent: AgentPort
  try {
    agent = deps.agent ?? (await (deps.agentFactory ?? createDefaultAgentPort)())
  } catch (error) {
    return { ok: false, error: 'agent-error', detail: String((error as Error)?.message ?? error) }
  }

  const now = deps.now ?? (() => new Date())
  const sessionId = `fac-plan-${now().getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const stage = config.stages.plan
  const model = stage.model ?? config.agent.model

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, deps.timeoutMs ?? PLANNER_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  input.signal?.addEventListener('abort', onAbort, { once: true })

  const unsubscribe = agent.onEvent((sessionIdFromEvent, eventType, data) => {
    if (sessionIdFromEvent !== sessionId) return
    if (eventType === 'log' && typeof data === 'string') deps.appendLog?.(data)
  })

  let inputTokens = 0
  let outputTokens = 0

  const runTurn = async (prompt: string) => {
    if (controller.signal.aborted) throw new Error('planner aborted')
    const turnPromise = agent.run(sessionId, prompt, {
      cwd: input.repoRoot,
      permissionMode: 'plan',
      ...(model ? { model } : {}),
    })
    // 超时/取消必须让等待方立刻退出；底层回合随后由 stop 收口。
    void turnPromise.catch(() => {})
    let rejectAbort: (reason: Error) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject
    })
    const onAbort = (): void => rejectAbort(new Error('planner aborted'))
    if (controller.signal.aborted) onAbort()
    else controller.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const turn = await Promise.race([turnPromise, aborted])
      inputTokens += turn.inputTokens
      outputTokens += turn.outputTokens
      return turn
    } finally {
      controller.signal.removeEventListener('abort', onAbort)
    }
  }

  try {
    let turn = await runTurn(built.text)
    let parsed = parsePlanOutput(turn.text, input.candidates, maxTasks)

    for (let attempt = 0; attempt < PLAN_MAX_RETRIES; attempt++) {
      if (parsed.ok || turn.isError) break
      const failure = parsed
      turn = await runTurn(buildRetryFeedback(failure))
      parsed = parsePlanOutput(turn.text, input.candidates, maxTasks)
    }

    if (!parsed.ok) {
      return {
        ok: false,
        error: turn.isError ? 'agent-error' : 'plan-invalid',
        detail: turn.isError ? turn.text : parsed.detail,
      }
    }

    return {
      ok: true,
      tasks: parsed.tasks,
      usage: { inputTokens, outputTokens },
      warnings: parsed.warnings,
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        error: 'plan-timeout',
        detail: timedOut ? 'planner timed out' : 'planner aborted',
      }
    }
    return { ok: false, error: 'agent-error', detail: String((error as Error)?.message ?? error) }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
    unsubscribe()
    await agent.stop(sessionId).catch(() => {})
  }
}
