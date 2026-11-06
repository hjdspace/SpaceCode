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
 * 引擎按已有 transcript 自动 `--resume`；权限档是 bypassPermissions —— 工单是
 * 人显式派出去的，逐次点授权卡会把后台执行变成人工陪跑，脏区风险改由首条消息
 * 与检查点承担（scheduler 已在 launch 前落检查点）。
 */
import {
  SUPER_AGENT_WORKER_ROLE_PROMPT,
  renderSuperAgentAssignmentIdentity,
} from './prompts'
import type { SuperAgentEngineBridge } from './engineBridge'
import { superAgentWorkerEngineSessionId } from './sessionId'
import type { WorkerLaunchRequest } from './scheduler'
import type { SuperAgentReportKind } from './model'
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

export interface SuperAgentExecutorHooks {
  /** 严格解析并落地 Report；协议失败由实现方记健康，不在此抛穿。 */
  ingest(text: string): SuperAgentExecutorIngestResult
  /** turn 结束但没有最终 Report（协议失败）：实现方负责卡片与健康上报。 */
  onProtocolFailure(context: SuperAgentExecutorTurnContext): void
  /** 引擎中断（error/exit）且这一轮还没有收尾。 */
  onInterrupted(context: { ticketId: string; assignmentId: string; reason: string }): void
  /** 最终 Report 中继给 Router（可缺省：不中继时工单只更新卡片）。 */
  relay?(info: { ticketId: string; kind: SuperAgentReportKind; summary: string }): void
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
  resolve: () => void
  promise: Promise<void>
}

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
}

function resultText(data: unknown): string {
  const record = data as { result?: unknown } | null | undefined
  return typeof record?.result === 'string' ? record.result : ''
}

export interface SuperAgentExecutor {
  /** 注入 Scheduler 的 launcher。 */
  launch(request: WorkerLaunchRequest): Promise<void>
  /** 注入 service 的 workerDeliverer：接管输入与追问的投递接缝。 */
  deliver(request: SuperAgentWorkerDeliveryRequest): Promise<SuperAgentWorkerDeliveryOutcome>
  /** 工单停止：先 abort 在跑的一轮，再停会话（transcript 保留）。 */
  stopTicket(ticketId: string): Promise<void>
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
      permissionMode: 'bypassPermissions' as const,
      appendSystemPrompt: SUPER_AGENT_WORKER_ROLE_PROMPT,
      ...(model ? { model: bridge.resolveModelAlias(model, base.engineType) } : {}),
    }
  }

  function finish(run: SuperAgentWorkerRun): void {
    if (!run.active) return
    run.active = false
    run.resolve()
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
          hooks.onProtocolFailure({ ticketId: run.ticketId, assignmentId: run.assignmentId, text })
          finish(run)
        })
        return
      }
      hooks.onProtocolFailure({ ticketId: run.ticketId, assignmentId: run.assignmentId, text })
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
      finish(run)
      return
    }
    // 只有 progress（或没有 Report）：这一轮已经结束，槽位不能白占。
    hooks.onProtocolFailure({ ticketId: run.ticketId, assignmentId: run.assignmentId, text })
    finish(run)
  }

  const unsubscribe = bridge.onRouteEvent((sessionId, eventType, data) => {
    const run = runs.get(sessionId)
    if (!run || !run.active) return
    if (eventType === 'result') {
      handleTurnEnd(run, resultText(data))
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

  function register(run: SuperAgentWorkerRun): void {
    runs.set(run.sessionId, run)
    byTicket.set(run.ticketId, run)
  }

  function forget(run: SuperAgentWorkerRun): void {
    if (runs.get(run.sessionId) === run) runs.delete(run.sessionId)
    if (byTicket.get(run.ticketId) === run) byTicket.delete(run.ticketId)
  }

  return {
    async launch(request: WorkerLaunchRequest): Promise<void> {
      const sessionId = superAgentWorkerEngineSessionId(request.ticketId)
      let resolveLaunch: () => void = () => {}
      const promise = new Promise<void>((resolve) => {
        resolveLaunch = resolve
      })
      const run: SuperAgentWorkerRun = {
        ticketId: request.ticketId,
        assignmentId: request.assignmentId,
        sessionId,
        repoRoot: request.repoRoot,
        active: true,
        started: false,
        resolve: resolveLaunch,
        promise,
      }
      register(run)

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
        projectPath: request.repoRoot,
        permissionMode: 'bypassPermissions',
        model: request.model,
      })

      try {
        await bridge.startSession(sessionId, workerConfig(request.repoRoot, request.model))
        run.started = true
        await bridge.sendMessage(sessionId, firstMessage)
      } catch (err) {
        forget(run)
        throw err
      }
      await promise
      forget(run)
    },

    async deliver(request: SuperAgentWorkerDeliveryRequest): Promise<SuperAgentWorkerDeliveryOutcome> {
      const sessionId = request.sessionId
      const run = runs.get(sessionId)
      const repoRoot = request.repoRoot ?? run?.repoRoot
      if (!repoRoot) return 'unknown'
      try {
        if (!run?.started) {
          // 重启后或工单空闲期：会话不在，按稳定 id 重新拉起（引擎自己 --resume 历史）。
          await bridge.startSession(sessionId, workerConfig(repoRoot, options.modelOf?.(request.ticketId)))
        }
        await bridge.sendMessage(sessionId, `${request.text}\n\n[人消息身份] inputId: ${request.inputId}；需要提问时 askedBy 引用此值。`)
        return 'accepted'
      } catch {
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
