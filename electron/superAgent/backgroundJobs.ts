/**
 * Worker 后台作业注册表与生命周期（#104；设计 §7.1 handoff、§7.2 槽位）。
 *
 * 能力边界（如实标注，不猜）：
 *  - 当前两个引擎都没有会话级作业枚举能力，`engineGateway.getSessionJobs` 只能答
 *    `unknown`（不是 0）。所以本模块的真源是**宿主侧事件注册表**：Executor 从引擎
 *    事件里识别 Worker 发起的后台 shell 作业（Bash + run_in_background）与 subagent
 *    （Task/Agent）；完成由引擎事件（task_notification / tool_result）回灌。
 *  - Bash 的 tool_result 只是「已在后台启动」的确认，不是完成；没有
 *    `task_notification` 的引擎上，shell 作业只能靠 30 分钟上限或 Assignment 结束收口。
 *  - subagent 的 tool_result 是完成信号；Completion 不唤醒 Worker（下次 turn 读取）。
 *
 * 槽位口径（与设计 §7.2 一致）：
 *  - 只有**运行中的作业**占槽；turn 结束时 handoff 种类为 `ready` 的 shell 作业是
 *    验收支撑（dev server 类），允许继续、不占槽、不受 30 分钟上限。
 *  - 其余运行中的 shell/subagent 在 turn 结束后占槽（Executor 借此不落定 launch
 *    promise），完成或超时才释放。
 *
 * 上限口径：默认 30 分钟常量，`options.maxAgeMs` 是测试/未来项目级配置的注入接缝，
 * 不暴露 UI 开关。超时的 shell 作业走 `onKill`（引擎 stopEngineTask）并上报
 * `onTimeout`（service 落 waiting Report）；subagent 不杀，只释放归属（允许自行
 * 收尾），同样计入 `onTimeout` 供报告写明。
 */
import { closeSync, openSync, readSync, statSync } from 'fs'
import type { SuperAgentReportKind } from './model'

/** 后台作业上限：turn 结束后最多 30 分钟（设计 §7.2）。 */
export const SUPER_AGENT_MAX_BACKGROUND_JOB_MS = 30 * 60 * 1000
/** 周期扫描间隔：超时判定不需要秒级精度，一分钟一次足够。 */
export const SUPER_AGENT_BACKGROUND_SWEEP_INTERVAL_MS = 60 * 1000
/** 读输出文件尾部时最多读这么多字节（只取摘录，不把大文件读进内存）。 */
const MAX_OUTPUT_TAIL_BYTES = 8 * 1024
/** 报告里输出摘录的最大字符数。 */
const MAX_OUTPUT_TAIL_CHARS = 300

export type SuperAgentBackgroundJobKind = 'shell' | 'subagent'
/**
 * killed = 超时/Assignment 结束时被宿主中止；
 * released = subagent 超过上限或 Assignment 结束，宿主不再认领但允许它自行收尾。
 */
export type SuperAgentBackgroundJobState = 'running' | 'completed' | 'killed' | 'released'

export interface SuperAgentBackgroundJob {
  jobId: string
  ticketId: string
  assignmentId: string
  sessionId: string
  kind: SuperAgentBackgroundJobKind
  state: SuperAgentBackgroundJobState
  startedAt: number
  endedAt: number | null
  /** 首次 turn 结束时间；30 分钟上限与「handoff 后仍活跃」口径共用，null = 仍在 turn 内。 */
  turnEndedAt: number | null
  /** 最近一次 turn 结束时的 handoff 种类；`ready` 的 shell 作业是验收支撑。 */
  handoffKind: SuperAgentReportKind | null
  /** 引擎侧输出文件指针（目前只有 task_started 帧可能带）；未知为 null。 */
  outputPath: string | null
  /** 引擎事件带回的输出摘录（task_notification 等）；未知为 null。 */
  outputTail: string | null
  /** 终止/释放的可读原因，便于审计。 */
  detail: string | null
}

/** Executor 从引擎事件里识别出来的作业动作（纯数据，便于单测）。 */
export interface SuperAgentBackgroundJobEvent {
  action: 'register' | 'complete'
  jobId: string
  kind: SuperAgentBackgroundJobKind
  outputPath?: string | null
  outputTail?: string | null
}

export interface SuperAgentBackgroundJobRegistration {
  ticketId: string
  assignmentId: string
  sessionId: string
  jobId: string
  kind: SuperAgentBackgroundJobKind
  outputPath?: string | null
}

export type SuperAgentBackgroundJobsSnapshot =
  | { availability: 'unknown' }
  | {
      availability: 'known'
      running: { shell: number; subagent: number }
      jobs: SuperAgentBackgroundJob[]
    }

/** 超时汇总：service 据此落 waiting Report（写明被中止作业与已释放 subagent）。 */
export interface SuperAgentBackgroundTimeout {
  ticketId: string
  killed: SuperAgentBackgroundJob[]
  released: SuperAgentBackgroundJob[]
  at: number
}

export interface SuperAgentBackgroundJobsOptions {
  now?: () => number
  maxAgeMs?: number
  sweepIntervalMs?: number
  /** 中止通路（引擎 stopEngineTask）；失败由实现方记健康，本模块不猜成功。 */
  onKill?: (job: SuperAgentBackgroundJob) => void
  /** shell 作业完成：service 可据此转成新 Input 唤醒空闲 Worker。 */
  onCompleted?: (job: SuperAgentBackgroundJob) => void
  /** 超时汇总（被杀的 shell + 释放的 subagent）。 */
  onTimeout?: (event: SuperAgentBackgroundTimeout) => void
  /** 该工单已无占槽后台工作：Executor 交还槽位。 */
  onDrained?: (ticketId: string) => void
}

export interface SuperAgentBackgroundJobs {
  register(input: SuperAgentBackgroundJobRegistration): SuperAgentBackgroundJob | null
  apply(input: {
    ticketId: string
    assignmentId: string
    sessionId: string
    event: SuperAgentBackgroundJobEvent
  }): void
  /** 引擎事件 → 注册/完成事件；`toolKinds` 由调用方按会话持有，用于识别完成帧。 */
  complete(jobId: string, info?: { outputTail?: string | null }): SuperAgentBackgroundJob | null
  /** turn 结束（最终 Report 落地）：开始计算 30 分钟上限并记录 handoff 种类。 */
  markTurnEnded(ticketId: string, handoffKind: SuperAgentReportKind): void
  /** 新 turn 开始（投递成功/重新唤醒）：停止计时。 */
  markTurnStarted(ticketId: string): void
  /** 是否仍有占槽后台工作（Executor 据此决定是否保留槽位）。 */
  hasBackgroundWork(ticketId: string): boolean
  jobsOf(ticketId: string): SuperAgentBackgroundJob[]
  /** 只读快照：没有登记事实时如实 unknown，绝不写成 0。 */
  snapshot(ticketId: string): SuperAgentBackgroundJobsSnapshot
  /**
   * Assignment 结束：不再接受新的作业冠名；已运行的 shell 中止、subagent 释放
   * （允许自行收尾）；迟到完成只留历史，不再唤醒。
   */
  endAssignment(input: { ticketId: string; assignmentId?: string | null }): void
  sweep(): SuperAgentBackgroundTimeout[]
  start(): void
  stop(): void
}

/** 读输出文件尾部（有界读取，失败返回 null —— 摘录拿不到不影响报告）。 */
export function readBackgroundOutputTail(
  path: string | null | undefined,
  maxChars = MAX_OUTPUT_TAIL_CHARS,
): string | null {
  if (!path) return null
  try {
    const size = statSync(path).size
    if (size <= 0) return null
    const start = Math.max(0, size - MAX_OUTPUT_TAIL_BYTES)
    const length = size - start
    const fd = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, start)
      const text = buffer.toString('utf8').replace(/\r\n/g, '\n').trim()
      if (text === '') return null
      return text.length > maxChars ? `…${text.slice(-maxChars)}` : text
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 从 tool_result 内容里认出引擎给后台 shell 的 task id（Claude Code 的 bash_1 形态）。 */
function extractBackgroundTaskId(record: Record<string, unknown>): string | null {
  const structured = record.backgroundTaskId ?? record.background_task_id ?? record.task_id
  const direct = stringOf(structured)
  if (direct) return direct
  const content = record.content
  if (typeof content === 'string') {
    const match = /running in background with ID:\s*([A-Za-z0-9_-]+)/i.exec(content)
    return match?.[1] ?? null
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      const text = stringOf(recordOf(block).text)
      if (!text) continue
      const match = /running in background with ID:\s*([A-Za-z0-9_-]+)/i.exec(text)
      if (match?.[1]) return match[1]
    }
  }
  return null
}

/**
 * 从引擎事件识别后台作业动作（#104）。
 *
 * 只认能证明的信号，不把「没有事件」当成「没有作业」：
 *  - Bash + input.run_in_background → shell 作业；
 *  - Task / Agent → subagent；
 *  - tool_result（或 user 消息里的 tool_result block）只结束 subagent；
 *    shell 的 tool_result 是启动确认；
 *  - system.task_started / task_notification → 引擎自报的作业生命周期。
 */
export function classifySuperAgentBackgroundEvent(
  eventType: string,
  data: unknown,
  toolKinds: Map<string, SuperAgentBackgroundJobKind>,
): SuperAgentBackgroundJobEvent[] {
  const record = recordOf(data)
  const events: SuperAgentBackgroundJobEvent[] = []

  const complete = (toolUseId: unknown): void => {
    if (typeof toolUseId !== 'string' || !toolUseId) return
    const kind = toolKinds.get(toolUseId)
    if (kind === 'subagent') {
      toolKinds.delete(toolUseId)
      events.push({ action: 'complete', jobId: toolUseId, kind })
    }
    // shell 的 tool_result 只是「已转入后台」的确认，不是完成。
  }

  /**
   * Bash 的 tool_result 才带引擎真正的 task id（如 bash_1）。作业以它登记，
   * 后续 task_notification / stopEngineTask 才对得上；tool_use 阶段只记倾向。
   */
  const registerShellFromResult = (record: Record<string, unknown>): void => {
    const toolUseId = record.tool_use_id
    if (typeof toolUseId !== 'string') return
    const taskId = extractBackgroundTaskId(record) ?? toolUseId
    if (!taskId || toolKinds.get(taskId) === 'shell') return
    toolKinds.delete(toolUseId)
    toolKinds.set(taskId, 'shell')
    events.push({ action: 'register', jobId: taskId, kind: 'shell' })
  }

  if (eventType === 'tool_use') {
    const payload = recordOf(record.tool_use)
    const id = record.id ?? payload.id
    const name = record.name ?? payload.name
    const input = recordOf(record.input ?? payload.input)
    if (typeof id !== 'string' || !id) return events
    if (name === 'Bash' && input.run_in_background === true) {
      // 先只记倾向：真正的 task id 在 tool_result 里（见 registerShellFromResult）。
      toolKinds.set(id, 'shell')
    } else if (name === 'Task' || name === 'Agent') {
      toolKinds.set(id, 'subagent')
      events.push({ action: 'register', jobId: id, kind: 'subagent' })
    }
    return events
  }

  if (eventType === 'tool_result') {
    const toolUseId = record.tool_use_id ?? recordOf(record.tool_result).tool_use_id
    if (typeof toolUseId === 'string' && toolKinds.get(toolUseId) === 'shell') {
      registerShellFromResult(record)
      return events
    }
    complete(toolUseId)
    return events
  }

  if (eventType === 'user') {
    const content = recordOf(record.message).content
    if (Array.isArray(content)) {
      for (const block of content) {
        const blockRecord = recordOf(block)
        if (blockRecord.type !== 'tool_result') continue
        if (typeof blockRecord.tool_use_id === 'string' && toolKinds.get(blockRecord.tool_use_id) === 'shell') {
          registerShellFromResult(blockRecord)
          continue
        }
        complete(blockRecord.tool_use_id)
      }
    }
    return events
  }

  if (eventType === 'system') {
    const subtype = record.subtype
    const taskId = record.task_id ?? record.taskId
    if (subtype === 'task_started' && typeof taskId === 'string' && taskId) {
      const toolUseId = record.tool_use_id
      if (typeof toolUseId === 'string') toolKinds.delete(toolUseId)
      if (!toolKinds.has(taskId)) {
        toolKinds.set(taskId, 'shell')
        events.push({
          action: 'register',
          jobId: taskId,
          kind: 'shell',
          outputPath: stringOf(record.output_file ?? record.outputFile),
        })
      }
    } else if (subtype === 'task_notification' && typeof taskId === 'string' && taskId) {
      const kind = toolKinds.get(taskId) ?? 'shell'
      toolKinds.delete(taskId)
      events.push({
        action: 'complete',
        jobId: taskId,
        kind,
        outputTail: stringOf(record.output ?? record.summary ?? record.result),
      })
    }
    return events
  }

  return events
}

export function createSuperAgentBackgroundJobs(
  options: SuperAgentBackgroundJobsOptions = {},
): SuperAgentBackgroundJobs {
  const nowMs = options.now ?? (() => Date.now())
  const maxAgeMs = options.maxAgeMs ?? SUPER_AGENT_MAX_BACKGROUND_JOB_MS
  const sweepIntervalMs = options.sweepIntervalMs ?? SUPER_AGENT_BACKGROUND_SWEEP_INTERVAL_MS
  const jobs = new Map<string, SuperAgentBackgroundJob>()
  const closedAssignments = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null

  function jobsOf(ticketId: string): SuperAgentBackgroundJob[] {
    return [...jobs.values()].filter((job) => job.ticketId === ticketId)
  }

  function hasBackgroundWork(ticketId: string): boolean {
    return jobsOf(ticketId).some(
      (job) =>
        job.state === 'running' &&
        // ready 的 shell 作业是验收支撑（dev server 类）：可继续且不占槽。
        (job.kind === 'subagent' || job.handoffKind !== 'ready'),
    )
  }

  function notifyDrained(ticketId: string): void {
    if (!hasBackgroundWork(ticketId)) options.onDrained?.(ticketId)
  }

  function register(input: SuperAgentBackgroundJobRegistration): SuperAgentBackgroundJob | null {
    // Assignment 结束后不再接受新的作业冠名（避免迟到事件把已收尾的执行拉回活跃）。
    if (closedAssignments.has(input.assignmentId)) return null
    const existing = jobs.get(input.jobId)
    if (existing) return existing.state === 'running' ? existing : null
    const job: SuperAgentBackgroundJob = {
      jobId: input.jobId,
      ticketId: input.ticketId,
      assignmentId: input.assignmentId,
      sessionId: input.sessionId,
      kind: input.kind,
      state: 'running',
      startedAt: nowMs(),
      endedAt: null,
      turnEndedAt: null,
      handoffKind: null,
      outputPath: input.outputPath ?? null,
      outputTail: null,
      detail: null,
    }
    jobs.set(job.jobId, job)
    return job
  }

  function complete(
    jobId: string,
    info: { outputTail?: string | null } = {},
  ): SuperAgentBackgroundJob | null {
    const job = jobs.get(jobId)
    if (!job || job.state !== 'running') return null
    job.state = 'completed'
    job.endedAt = nowMs()
    if (info.outputTail !== undefined) job.outputTail = info.outputTail
    if (job.kind === 'shell') options.onCompleted?.(job)
    notifyDrained(job.ticketId)
    return job
  }

  function apply(input: {
    ticketId: string
    assignmentId: string
    sessionId: string
    event: SuperAgentBackgroundJobEvent
  }): void {
    const { event } = input
    if (event.action === 'register') {
      register({
        ticketId: input.ticketId,
        assignmentId: input.assignmentId,
        sessionId: input.sessionId,
        jobId: event.jobId,
        kind: event.kind,
        outputPath: event.outputPath,
      })
      return
    }
    complete(event.jobId, { outputTail: event.outputTail })
  }

  function markTurnEnded(ticketId: string, handoffKind: SuperAgentReportKind): void {
    const at = nowMs()
    for (const job of jobs.values()) {
      if (job.ticketId !== ticketId || job.state !== 'running') continue
      job.turnEndedAt = at
      job.handoffKind = handoffKind
    }
  }

  function markTurnStarted(ticketId: string): void {
    for (const job of jobs.values()) {
      if (job.ticketId !== ticketId || job.state !== 'running') continue
      job.turnEndedAt = null
      job.handoffKind = null
    }
  }

  function endAssignment(input: { ticketId: string; assignmentId?: string | null }): void {
    if (input.assignmentId) closedAssignments.add(input.assignmentId)
    const at = nowMs()
    for (const job of jobs.values()) {
      if (job.ticketId !== input.ticketId || job.state !== 'running') continue
      if (job.kind === 'shell') {
        job.state = 'killed'
        job.endedAt = at
        job.detail = 'Assignment 结束，后台 shell 作业已中止'
        options.onKill?.(job)
      } else {
        // subagent 不杀：允许自行收尾，只是宿主不再认领（释放归属）。
        job.state = 'released'
        job.endedAt = at
        job.detail = 'Assignment 结束，subagent 已释放归属（允许自行收尾）'
      }
    }
    notifyDrained(input.ticketId)
  }

  function sweep(): SuperAgentBackgroundTimeout[] {
    const at = nowMs()
    const grouped = new Map<
      string,
      { killed: SuperAgentBackgroundJob[]; released: SuperAgentBackgroundJob[] }
    >()
    for (const job of jobs.values()) {
      if (job.state !== 'running' || job.turnEndedAt === null) continue
      if (at - job.turnEndedAt < maxAgeMs) continue
      if (job.kind === 'shell') {
        // ready 是验收支撑的长进程：可继续且不受上限（设计 §7.2）。
        if (job.handoffKind === 'ready') continue
        job.state = 'killed'
        job.endedAt = at
        job.detail = '后台作业超过 30 分钟上限，已中止'
        options.onKill?.(job)
        const entry = grouped.get(job.ticketId) ?? { killed: [], released: [] }
        entry.killed.push(job)
        grouped.set(job.ticketId, entry)
      } else {
        // subagent 允许继续（其完成不唤醒），但不再占槽 —— 释放归属即达到上限。
        job.state = 'released'
        job.endedAt = at
        job.detail = 'subagent 超过 30 分钟上限，已释放归属（允许自行收尾）'
        const entry = grouped.get(job.ticketId) ?? { killed: [], released: [] }
        entry.released.push(job)
        grouped.set(job.ticketId, entry)
      }
    }

    const events: SuperAgentBackgroundTimeout[] = []
    for (const [ticketId, entry] of grouped) {
      const event: SuperAgentBackgroundTimeout = { ticketId, ...entry, at }
      events.push(event)
      options.onTimeout?.(event)
      notifyDrained(ticketId)
    }
    return events
  }

  function snapshot(ticketId: string): SuperAgentBackgroundJobsSnapshot {
    const of = jobsOf(ticketId)
    if (of.length === 0) {
      // 引擎没有枚举能力，本模块也没观察到任何作业 —— 未知，不是 0。
      return { availability: 'unknown' }
    }
    const running = of.filter((job) => job.state === 'running')
    return {
      availability: 'known',
      running: {
        shell: running.filter((job) => job.kind === 'shell').length,
        subagent: running.filter((job) => job.kind === 'subagent').length,
      },
      jobs: of,
    }
  }

  return {
    register,
    apply,
    complete,
    markTurnEnded,
    markTurnStarted,
    hasBackgroundWork,
    jobsOf,
    snapshot,
    endAssignment,
    sweep,
    start() {
      if (timer !== null) return
      timer = setInterval(() => sweep(), sweepIntervalMs)
    },
    stop() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}
