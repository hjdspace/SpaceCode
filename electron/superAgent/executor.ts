/**
 * Worker Executor：把 Scheduler 的 `WorkerLauncher` 接缝接到真实引擎会话。
 *
 * 之前 launcher 一直是 null（工单只排队不干活），本模块补上那一环。语义约束
 * 来自调度器契约（scheduler.ts:59）：`launch()` 的 Promise 覆盖整段活动 ——
 * 引擎接受首条消息不等于任务完成，Promise 只在最终 Report 落地或这一轮彻底
 * 结束后 resolve，槽位才随之释放（设计 §7.1、§7.2）。
 *
 * 事实来源是主进程自己订阅的引擎事件（`result` / `error` / `exit`），不是渲染端
 * turn store —— 渲染端关掉也不能影响工单推进（设计 §3.2 第 1 条）。
 *
 * Worker 会话 id 由 ticketId 稳定派生（sessionId.ts），跨代次与重启同一个 id，
 * 引擎按已有 transcript 自动 `--resume`。Worker 一律以 bypassPermissions 起：它是
 * 后台自主执行，逐次权限请求会把人钉在审批卡上；权限 Attention 通路仍保留兜底。
 */
import {
  SUPER_AGENT_WORKER_ROLE_PROMPT,
  renderSuperAgentAssignmentIdentity,
} from './prompts'
import { wrapSuperAgentHostContext } from '@/shared/promptEnvelope'
import type { SuperAgentEngineBridge } from './engineBridge'
import { superAgentWorkerEngineSessionId } from './sessionId'
import type { WorkerLaunchRequest } from './scheduler'
import type { SuperAgentReportKind } from './model'
import {
  classifySuperAgentBackgroundEvent,
  type SuperAgentBackgroundJobEvent,
  type SuperAgentBackgroundJobKind,
} from './backgroundJobs'
import type {
  SuperAgentWorkerDeliveryOutcome,
  SuperAgentWorkerDeliveryRequest,
} from './service'

/** Worker 一轮结束后的领域回灌结果。 */
export interface SuperAgentExecutorIngestResult {
  /** 是否拿到了最终（handoff 类）Report —— 决定槽位能否释放。 */
  final: boolean
  kind: SuperAgentReportKind | null
  summary: string | null
  ticketId: string | null
}

export interface SuperAgentPermissionRequestContext {
  ticketId: string
  assignmentId: string
  /** 引擎会话与请求 id：Attention 的审计锚点与回答投递地址。 */
  sessionId: string
  requestId: string
  question: string
}

export interface SuperAgentPermissionCancelledContext {
  ticketId: string
  assignmentId: string
  sessionId: string
  requestId: string
  reason: string
}

export interface SuperAgentExecutorHooks {
  /** 活动状态已更新；包括启动失败、停止与后台 hold 释放。 */
  onStatusChanged?(ticketId: string): void
  /** 严格解析并落地 Report；协议失败由实现方记健康，不在此抛穿。 */
  ingest(text: string): SuperAgentExecutorIngestResult
  /** turn 结束但没有最终 Report（协议失败）：实现方负责卡片与健康上报。 */
  onProtocolFailure(context: SuperAgentExecutorTurnContext): void
  /** 引擎中断（error/exit）且这一轮还没有收尾。 */
  onInterrupted(context: { ticketId: string; assignmentId: string; reason: string }): void
  /** 最终 Report 中继给 Router（可缺省：不中继时工单只更新卡片）。 */
  relay?(info: { ticketId: string; kind: SuperAgentReportKind; summary: string }): void
  /** 引擎权限请求：这一轮没有结束，只是等人在 Attention 上回答。 */
  onPermissionRequest?(context: SuperAgentPermissionRequestContext): void
  /** 引擎撤回权限请求（中止/进程退出等）：对应 Attention 撤回，不留下永久气泡。 */
  onPermissionCancelled?(context: SuperAgentPermissionCancelledContext): void
  /** #104：引擎事件里识别出的后台作业登记/完成，交给 BackgroundJobs 注册表。 */
  onBackgroundJob?(context: {
    ticketId: string
    assignmentId: string
    sessionId: string
    event: SuperAgentBackgroundJobEvent
  }): void
  /**
   * #104：turn 结束时是否仍有占槽后台工作。为 true 时这一轮的 launch promise
   * 不落定（槽位不释放），等注册表通知 `releaseBackgroundHold` 再收尾。
   */
  hasBackgroundWork?(ticketId: string): boolean
  /** #104：即将交还槽位前的通知（service 借此调 scheduler.handoff）。 */
  onBackgroundHandoff?(ticketId: string): void
}

export interface SuperAgentExecutorOptions {
  /** 引擎接缝（生产由 IPC 层注入真实通路；测试注入 fake，绝不打真 CLI）。 */
  bridge: SuperAgentEngineBridge
  hooks: SuperAgentExecutorHooks
  /** 代次号（写进指派身份块）；由 service 按 assignment 领域事实给出。 */
  resolveGeneration?(assignmentId: string): number
  /** 会话标题（渲染端会话名）。 */
  titleOf?(ticketId: string): string
  modelOf?(ticketId: string): string | undefined
  /** 已收尾或重启后追问，仍跟踪同一代 Assignment 的新 turn。 */
  assignmentIdOf?(ticketId: string): string | undefined
  humanInputIds?(ticketId: string): string[]
}

export interface SuperAgentWorkerRun {
  ticketId: string
  assignmentId: string
  sessionId: string
  repoRoot: string
  /** 这一轮是否还在活动（决定 launch promise 是否仍持有槽位）。 */
  active: boolean
  /** 首条消息已被接受（失败时用于区分 launch 失败与执行失败）。 */
  started: boolean
  /** #104：turn 已结束但仍有占槽后台工作，保留活动状态等它收尾。 */
  awaitingBackground: boolean
  /** #104：按会话记 toolUseId → 作业类型，用于识别完成帧。 */
  jobKinds: Map<string, SuperAgentBackgroundJobKind>
  resolve: () => void
  promise: Promise<void>
}

/**
 * Worker 权限档：完全信任。bypass 只能由 spawn 参数打开（见 sessionProcess.buildArgs），
 * 引擎于是不再为写文件/执行命令发 permission_request。
 */
const WORKER_PERMISSION_MODE = 'bypassPermissions' as const

/** handoff 类 Report 才释放槽位；progress 只是进展。 */
const HANDOFF_KINDS = new Set<SuperAgentReportKind>([
  'waiting',
  'ready',
  'blocked',
  'failed',
  'dropped',
])

/** 该 Report 是否算一次执行的收尾（调度槽位与中继判定的共用口径）。 */
export function isSuperAgentHandoffReport(kind: SuperAgentReportKind): boolean {
  return HANDOFF_KINDS.has(kind)
}

/** 一轮结束的上下文：协议失败时要知道是哪次执行。 */
export interface SuperAgentExecutorTurnContext {
  ticketId: string
  assignmentId: string
  text: string
  /** #100：解析失败时的稳定错误码，供健康上报使用（缺省按 reportInvalid）。 */
  code?: string | null
}

function resultText(data: unknown): string {
  const record = data as { result?: unknown } | null | undefined
  return typeof record?.result === 'string' ? record.result : ''
}

function eventRecord(data: unknown): Record<string, unknown> {
  return (data ?? {}) as Record<string, unknown>
}

/** 权限请求气泡文案：工具名 + 引擎给的描述，缺一不可时仍保留工具名。 */
function permissionQuestion(data: unknown): string {
  const record = eventRecord(data)
  const toolName = typeof record.toolName === 'string' && record.toolName ? record.toolName : '工具'
  const detail = ['description', 'title', 'displayName']
    .map((key) => record[key])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '')
  return detail ? `权限请求：${toolName}（${detail}）` : `权限请求：${toolName}`
}

function permissionRequestId(data: unknown): string | null {
  const record = eventRecord(data)
  return typeof record.requestId === 'string' && record.requestId ? record.requestId : null
}

export interface SuperAgentExecutor {
  /** 注入 Scheduler 的 launcher。 */
  launch(request: WorkerLaunchRequest): Promise<void>
  /** 注入 service 的 workerDeliverer：接管输入与追问的投递接缝。 */
  deliver(request: SuperAgentWorkerDeliveryRequest): Promise<SuperAgentWorkerDeliveryOutcome>
  /** 工单停止：先 abort 在跑的一轮，再停会话（transcript 保留）。 */
  stopTicket(ticketId: string): Promise<void>
  /**
   * #104：占槽后台工作已收尾，允许这一轮真正落定并交还槽位。
   * 没有待释放的 hold 时返回 false（幂等，供注册表重复通知）。
   */
  releaseBackgroundHold(ticketId: string): boolean
  /** 该工单当前是否有活动中的引擎会话（workerMirror.running 的真源）。 */
  isRunning(ticketId: string): boolean
  /** 有界等待在跑 Worker 收尾（shutdown 语义）。 */
  settle(timeoutMs: number): Promise<boolean>
  /** 停止订阅（测试与项目关闭用）。 */
  dispose(): void
}

export function createSuperAgentExecutor(options: SuperAgentExecutorOptions): SuperAgentExecutor {
  const bridge = options.bridge
  const { hooks } = options
  const runs = new Map<string, SuperAgentWorkerRun>()
  const byTicket = new Map<string, SuperAgentWorkerRun>()
  const repairedQuestions = new WeakSet<SuperAgentWorkerRun>()

  const workerConfig = (repoRoot: string, model?: string) => {
    const base = bridge.loadConfig(repoRoot)
    return {
      ...base,
      cwd: repoRoot,
      permissionMode: WORKER_PERMISSION_MODE,
      appendSystemPrompt: SUPER_AGENT_WORKER_ROLE_PROMPT,
      // Worker 用 round 内的 ask/attempt 协议向 Router 汇报，不该再走主聊天的
      // AskUserQuestion 指引（那会把提问推给人而不是回给 Router，设计 §3.2 第 3 条）。
      askUserQuestionGuidance: false,
      ...(model ? { model: bridge.resolveModelAlias(model, base.engineType) } : {}),
    }
  }

  function finish(run: SuperAgentWorkerRun): void {
    if (!run.active) return
    run.active = false
    run.resolve()
    hooks.onStatusChanged?.(run.ticketId)
  }

  function handleTurnEnd(run: SuperAgentWorkerRun, text: string): void {
    let ingestResult: SuperAgentExecutorIngestResult
    try {
      ingestResult = hooks.ingest(text)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const inputIds = options.humanInputIds?.(run.ticketId) ?? []
      if ((code === 'askerWithoutQuestion' || code === 'notAsker') && inputIds.length && !repairedQuestions.has(run)) {
        repairedQuestions.add(run)
        void bridge.sendMessage(run.sessionId, [
          '[宿主汇报协议校正]',
          '上一份提问 Report 未被接受：askedBy 缺失或不属于本工单的人消息。',
          `可引用的 inputId：${JSON.stringify(inputIds)}`,
          `assignmentId 必须为 ${run.assignmentId}。`,
          '保留原来的问题和结论，只补正 askedBy 并输出一个完整 super-agent:report 围栏；不要重跑任务。',
        ].join('\n')).catch(() => {
          if (!run.active) return
          hooks.onProtocolFailure({ ticketId: run.ticketId, assignmentId: run.assignmentId, text, code })
          finish(run)
        })
        return
      }
      hooks.onProtocolFailure({ ticketId: run.ticketId, assignmentId: run.assignmentId, text, code })
      finish(run)
      return
    }
    if (ingestResult.final) {
      if (ingestResult.summary !== null && hooks.relay) {
        hooks.relay({
          ticketId: run.ticketId,
          kind: ingestResult.kind as SuperAgentReportKind,
          summary: ingestResult.summary,
        })
      }
      // #104：最终 Report 落地了，但后台作业还在跑时不释放槽位（launch promise 不落定）。
      // 注册表收尾后会调 releaseBackgroundHold，把这一轮真正结束掉。
      run.awaitingBackground = false
      if (hooks.hasBackgroundWork?.(run.ticketId) === true) {
        run.awaitingBackground = true
        return
      }
      hooks.onBackgroundHandoff?.(run.ticketId)
      finish(run)
      return
    }
    // 只有 progress（或没有 Report）：这一轮已经结束，槽位不能白占。
    run.awaitingBackground = false
    hooks.onProtocolFailure({ ticketId: run.ticketId, assignmentId: run.assignmentId, text, code: 'reportMissing' })
    finish(run)
  }

  const unsubscribe = bridge.onRouteEvent((sessionId, eventType, data) => {
    const run = runs.get(sessionId)
    if (!run) return
    // #104：后台作业事件要先于 active 判定处理 —— turn 已收尾但被 hold 住的会话
    // 仍要能收到完成帧（shell 完成即唤醒、subagent 完成即释放 hold）。
    const jobEvents = classifySuperAgentBackgroundEvent(eventType, data, run.jobKinds)
    for (const event of jobEvents) {
      hooks.onBackgroundJob?.({
        ticketId: run.ticketId,
        assignmentId: run.assignmentId,
        sessionId: run.sessionId,
        event,
      })
    }
    if (!run.active) return
    if (eventType === 'result') {
      handleTurnEnd(run, resultText(data))
    } else if (eventType === 'permission_request') {
      const requestId = permissionRequestId(data)
      if (!requestId) return
      hooks.onPermissionRequest?.({
        ticketId: run.ticketId,
        assignmentId: run.assignmentId,
        sessionId: run.sessionId,
        requestId,
        question: permissionQuestion(data),
      })
    } else if (eventType === 'permission_request_cancelled') {
      const requestId = permissionRequestId(data)
      if (!requestId) return
      const record = eventRecord(data)
      const reason = typeof record.reason === 'string' ? record.reason : 'cancelled'
      hooks.onPermissionCancelled?.({
        ticketId: run.ticketId,
        assignmentId: run.assignmentId,
        sessionId: run.sessionId,
        requestId,
        reason,
      })
    } else if (eventType === 'error') {
      const message = String((data as { message?: unknown })?.message ?? 'engine error')
      hooks.onInterrupted({ ticketId: run.ticketId, assignmentId: run.assignmentId, reason: message })
      finish(run)
    } else if (eventType === 'exit') {
      hooks.onInterrupted({
        ticketId: run.ticketId,
        assignmentId: run.assignmentId,
        reason: 'engine process exited before final report',
      })
      finish(run)
    }
  })

  function registerRun(ticketId: string, assignmentId: string, sessionId: string, repoRoot: string): SuperAgentWorkerRun {
    let resolveRun: () => void = () => {}
    const promise = new Promise<void>((resolve) => { resolveRun = resolve })
    const run: SuperAgentWorkerRun = {
      ticketId, assignmentId, sessionId, repoRoot,
      active: true,
      started: false,
      awaitingBackground: false,
      jobKinds: new Map(),
      resolve: resolveRun,
      promise,
    }
    runs.set(sessionId, run)
    byTicket.set(ticketId, run)
    hooks.onStatusChanged?.(ticketId)
    return run
  }

  function forget(run: SuperAgentWorkerRun): void {
    if (runs.get(run.sessionId) === run) runs.delete(run.sessionId)
    if (byTicket.get(run.ticketId) === run) byTicket.delete(run.ticketId)
  }

  return {
    async launch(request: WorkerLaunchRequest): Promise<void> {
      const sessionId = superAgentWorkerEngineSessionId(request.ticketId)
      const run = registerRun(request.ticketId, request.assignmentId, sessionId, request.repoRoot)

      const identity = renderSuperAgentAssignmentIdentity({
        ticketId: request.ticketId,
        assignmentId: request.assignmentId,
        generation: options.resolveGeneration?.(request.assignmentId) ?? 1,
        workDir: request.repoRoot,
        humanInputIds: options.humanInputIds?.(request.ticketId),
      })
      const firstMessage = `${request.firstMessage}\n\n${identity}`

      // 气泡先推再发：引擎不会回显宿主写进 stdin 的人消息，不推就只剩答复没有指派。
      bridge.pushUserMessage({
        sessionId,
        content: firstMessage,
        title: options.titleOf?.(request.ticketId) ?? request.ticketId,
        sessionType: 'superAgentWorker',
        projectPath: request.repoRoot,
        permissionMode: WORKER_PERMISSION_MODE,
        model: request.model,
      })

      try {
        await bridge.startSession(sessionId, workerConfig(request.repoRoot, request.model))
        run.started = true
        await bridge.sendMessage(sessionId, firstMessage)
      } catch (err) {
        finish(run)
        forget(run)
        throw err
      }
      await run.promise
      forget(run)
    },

    async deliver(request: SuperAgentWorkerDeliveryRequest): Promise<SuperAgentWorkerDeliveryOutcome> {
      const sessionId = request.sessionId
      let run = runs.get(sessionId)
      const repoRoot = request.repoRoot ?? run?.repoRoot
      if (!repoRoot) return 'unknown'
      const assignmentId = options.assignmentIdOf?.(request.ticketId) ?? run?.assignmentId
      let resumed: SuperAgentWorkerRun | undefined
      if (!run?.active && assignmentId) {
        resumed = registerRun(request.ticketId, assignmentId, sessionId, repoRoot)
        run = resumed
        void resumed.promise.then(() => forget(resumed!))
      }
      // 同一 hold 内唤醒也开始了新 turn，不能被迟到的后台完成通知提前释放。
      if (run) run.awaitingBackground = false
      try {
        if (!run?.started) {
          // 重启后或工单空闲期：会话不在，按稳定 id 重新拉起（引擎自己 --resume 历史）。
          await bridge.startSession(sessionId, workerConfig(repoRoot, options.modelOf?.(request.ticketId)))
          if (run) run.started = true
        }
        // 身份说明是宿主与 Worker 之间的东西，包进信封让回放侧能摘掉：
        // 否则重启后这条人消息的气泡里挂着 inputId 与 askedBy 规则。
        // #100：带 Trigger 的消息额外给出 triggerId，交回围栏只能引用这个值。
        const identity = request.triggerId
          ? `[人消息身份] inputId: ${request.inputId}；triggerId: ${request.triggerId}；需要提问时 askedBy 引用 inputId，交回时 handback 引用 triggerId。`
          : `[人消息身份] inputId: ${request.inputId}；需要提问时 askedBy 引用此值。`
        const hostContext = wrapSuperAgentHostContext([identity])
        await bridge.sendMessage(sessionId, [request.text, hostContext].filter(Boolean).join('\n\n'))
        return 'accepted'
      } catch {
        if (resumed) finish(resumed)
        // 无法证明引擎是否收下：交回 unknown，由 service 转 uncertain + Attention，
        // 禁止盲目重投（设计 §7.1）。
        return 'unknown'
      }
    },

    async stopTicket(ticketId: string): Promise<void> {
      const run = byTicket.get(ticketId)
      if (!run) return
      try {
        await bridge.abort(run.sessionId)
      } catch {
        // abort 失败也要停会话：现场由 stop 收尾
      }
      try {
        await bridge.stop(run.sessionId)
      } catch {
        // 停不掉只留日志痕迹：领域已经 stopped，进程随池回收
      }
      finish(run)
    },

    releaseBackgroundHold(ticketId: string): boolean {
      const run = byTicket.get(ticketId)
      if (!run || !run.active || !run.awaitingBackground) return false
      run.awaitingBackground = false
      hooks.onBackgroundHandoff?.(ticketId)
      finish(run)
      return true
    },

    isRunning(ticketId: string): boolean {
      const run = byTicket.get(ticketId)
      return run !== undefined && run.active
    },

    async settle(timeoutMs: number): Promise<boolean> {
      const active = [...runs.values()].filter((run) => run.active)
      if (active.length === 0) return true
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (active.every((run) => !run.active)) return true
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return false
    },

    dispose(): void {
      unsubscribe()
      for (const run of runs.values()) finish(run)
      runs.clear()
      byTicket.clear()
      unsubscribe()
    },
  }
}
