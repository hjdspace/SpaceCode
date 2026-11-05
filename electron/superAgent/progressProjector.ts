/**
 * 轻量卡片投影（T06 #76）：主进程归一化 + 1 秒节流的 progressProjector。
 *
 * 两条投影通道（设计 §10.1）：
 *  - ticket.updated：领域事实变化即发（不节流），携带 fromSeq/toSeq 水位与
 *    全量卡片。Renderer 发现 fromSeq 与本地水位不一致即判定领域断档，全量
 *    重拉；payload 直接应用即幂等。
 *  - ticket.progress：只由 progress Report 的轻量事实驱动，1 秒节流（首个
 *    立即发、窗口内合并、只发最新事实），seq 独立编号；丢弃中间进度不重放、
 *    不触发重拉。
 *
 * 卡片身份是 ticketId：Report 只更新现有卡片，不重复发气泡。`preparing` 是
 * 本投影维护的子态（pending Assignment 已占槽、launch 尚未回报），不新增
 * 领域阶段；领域阶段由 stage.ts 派生，此处只做卡片状态映射。
 */
import type {
  SuperAgentTicketCard,
  SuperAgentTicketCardState,
  SuperAgentTicketProgress,
  SuperAgentTicketUpdateEvent,
} from '@/shared/channels/superAgent'
import { canRetryTicket, latestAssignmentOf, type TicketStageFacts } from './stage'
import type { SuperAgentDomain } from './domain'

export interface SuperAgentReportProgressInput {
  currentTool?: string | null
  toolCalls?: number | null
  elapsedMs?: number | null
}

export interface SuperAgentProgressProjectorOptions {
  domain: SuperAgentDomain
  repoRoot: string
  onTicketUpdated: (event: SuperAgentTicketUpdateEvent) => void
  onTicketProgress: (progress: SuperAgentTicketProgress) => void
  /** 毫秒时钟；缺省 Date.now（测试可用 fake timers 接管）。 */
  nowMs?: () => number
  /** 节流窗口；设计要求 1 秒。 */
  throttleMs?: number
  /** 定时器接缝；缺省 setTimeout/clearTimeout。 */
  schedule?: (fn: () => void, ms: number) => () => void
}

export interface SuperAgentProgressProjector {
  /** 领域事实可能变化后调用：有变化则发 ticket.updated，返回事件或 null。 */
  sync(): SuperAgentTicketUpdateEvent | null
  /** 标记/清除 preparing 子态（Scheduler 占槽回调）。 */
  setPreparing(ticketId: string, preparing: boolean): void
  /** 记录 progress Report 的轻量事实（currentTool/toolCalls/elapsedMs）。 */
  recordProgress(ticketId: string, facts: SuperAgentReportProgressInput): void
  /** 最近一次同步后的卡片缓存（tickets 通道读取用）。 */
  cards(): SuperAgentTicketCard[]
}

const DEFAULT_THROTTLE_MS = 1_000

function mapStageToCardState(
  stage: string,
  preparing: boolean,
): SuperAgentTicketCardState {
  if (stage === 'working/queued') return preparing ? 'preparing' : 'queued'
  if (stage === 'working') return 'working'
  if (stage === 'idle') return 'idle'
  if (stage === 'person/delivery') return 'delivery'
  if (stage === 'person/answer') return 'answer'
  if (stage === 'person/review') return 'review'
  if (stage === 'person/blocked') return 'blocked'
  if (stage === 'person/failed') return 'failed'
  if (stage === 'stopped') return 'stopped'
  if (stage === 'dropped') return 'dropped'
  return 'completed'
}

export function createSuperAgentProgressProjector(
  options: SuperAgentProgressProjectorOptions,
): SuperAgentProgressProjector {
  const {
    domain,
    repoRoot,
    onTicketUpdated,
    onTicketProgress,
    nowMs = () => Date.now(),
    throttleMs = DEFAULT_THROTTLE_MS,
    schedule = (fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
  } = options

  let lastSeq = 0
  let progressSeq = 0
  let lastProgressEmitAt = Number.NEGATIVE_INFINITY
  let cancelTimer: (() => void) | null = null
  const pendingTickets = new Set<string>()
  const preparingIds = new Set<string>()
  const progressFacts = new Map<
    string,
    { currentTool: string | null; toolCalls: number | null; elapsedMs: number | null; lastActivityAt: string }
  >()
  const cardCache = new Map<string, string>()

  function cardOf(ticketId: string): SuperAgentTicketCard | null {
    const ticket = domain.state.tickets[ticketId]
    if (!ticket) return null
    const assignment = latestAssignmentOf(
      ticket.assignmentIds.map((id) => domain.state.assignments[id]),
    )
    const mandate = domain.state.mandates[ticket.mandateId]
    const stage = domain.stageOf(ticketId)
    const report = assignment?.report ?? null

    const updatedAtCandidates = [ticket.createdAt]
    if (ticket.ended) updatedAtCandidates.push(ticket.ended.at)
    if (assignment) {
      updatedAtCandidates.push(assignment.createdAt)
      if (assignment.startedAt) updatedAtCandidates.push(assignment.startedAt)
      if (assignment.endedAt) updatedAtCandidates.push(assignment.endedAt)
    }
    if (report) updatedAtCandidates.push(report.at)
    const updatedAt = updatedAtCandidates.reduce((max, at) => (at > max ? at : max))

    // T10 #80：重试闸门与 review 提醒水位随卡片下发（与阶段派生同一事实源）。
    const facts: TicketStageFacts = {
      ticket,
      assignments: ticket.assignmentIds.map((id) => domain.state.assignments[id]),
      inputs: ticket.inputIds.map((id) => domain.state.inputs[id]),
      attentions: Object.values(domain.state.attentions).filter(
        (attention) => attention.ticketId === ticketId,
      ),
    }

    return {
      ticketId: ticket.ticketId,
      title: ticket.title,
      state: mapStageToCardState(stage, preparingIds.has(ticketId)),
      assignmentId: assignment?.assignmentId ?? null,
      generation: assignment?.generation ?? 0,
      scopePaths: mandate ? [...mandate.scope.paths] : [],
      createdAt: ticket.createdAt,
      updatedAt,
      ended: ticket.ended
        ? {
            outcome: ticket.ended.outcome,
            by: ticket.ended.by,
            reason: ticket.ended.reason,
            at: ticket.ended.at,
          }
        : null,
      reviewRemindedAt: ticket.reviewRemindedAt,
      canRetry: canRetryTicket(facts),
    }
  }

  function buildProgress(ticketId: string): SuperAgentTicketProgress | null {
    const card = cardOf(ticketId)
    if (!card) return null
    const facts = progressFacts.get(ticketId)
    let elapsedMs = facts?.elapsedMs ?? null
    if (elapsedMs === null && card.assignmentId) {
      const assignment = domain.state.assignments[card.assignmentId]
      if (assignment?.startedAt) {
        elapsedMs = Math.max(0, nowMs() - Date.parse(assignment.startedAt))
      }
    }
    progressSeq += 1
    return {
      repoRoot,
      seq: progressSeq,
      ticketId,
      state: card.state,
      assignmentId: card.assignmentId,
      currentTool: facts?.currentTool ?? null,
      elapsedMs,
      toolCalls: facts?.toolCalls ?? null,
      lastActivityAt: facts?.lastActivityAt ?? card.updatedAt,
    }
  }

  function flushProgress(): void {
    cancelTimer = null
    if (pendingTickets.size === 0) return
    lastProgressEmitAt = nowMs()
    for (const ticketId of pendingTickets) {
      const payload = buildProgress(ticketId)
      if (payload) onTicketProgress(payload)
    }
    pendingTickets.clear()
  }

  function scheduleProgress(ticketId: string): void {
    pendingTickets.add(ticketId)
    if (cancelTimer !== null) return
    const sinceEmit = nowMs() - lastProgressEmitAt
    if (sinceEmit >= throttleMs) {
      flushProgress()
      return
    }
    cancelTimer = schedule(flushProgress, throttleMs - sinceEmit)
  }

  function sync(): SuperAgentTicketUpdateEvent | null {
    const toSeq = domain.state.seq
    const ticketIds = Object.keys(domain.state.tickets)
    const cards: SuperAgentTicketCard[] = []
    const nextCache = new Map<string, string>()
    let changed = toSeq !== lastSeq

    for (const ticketId of ticketIds) {
      const card = cardOf(ticketId)
      if (!card) continue
      cards.push(card)
      const serialized = JSON.stringify(card)
      nextCache.set(ticketId, serialized)
      if (cardCache.get(ticketId) !== serialized) changed = true
    }
    if (cardCache.size !== nextCache.size) changed = true
    if (!changed) return null

    cards.sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.ticketId.localeCompare(b.ticketId)
        : a.createdAt < b.createdAt
          ? -1
          : 1,
    )

    const event: SuperAgentTicketUpdateEvent = {
      repoRoot,
      fromSeq: lastSeq,
      toSeq,
      tickets: cards,
    }
    lastSeq = toSeq
    cardCache.clear()
    for (const [ticketId, serialized] of nextCache) cardCache.set(ticketId, serialized)
    onTicketUpdated(event)
    return event
  }

  function setPreparing(ticketId: string, preparing: boolean): void {
    if (preparing) preparingIds.add(ticketId)
    else preparingIds.delete(ticketId)
  }

  function recordProgress(ticketId: string, facts: SuperAgentReportProgressInput): void {
    const previous = progressFacts.get(ticketId)
    progressFacts.set(ticketId, {
      currentTool: facts.currentTool ?? previous?.currentTool ?? null,
      toolCalls: facts.toolCalls ?? previous?.toolCalls ?? null,
      elapsedMs: facts.elapsedMs ?? previous?.elapsedMs ?? null,
      lastActivityAt: new Date(nowMs()).toISOString(),
    })
    scheduleProgress(ticketId)
  }

  function cards(): SuperAgentTicketCard[] {
    return [...cardCache.keys()]
      .map((ticketId) => {
        const serialized = cardCache.get(ticketId)
        return serialized ? (JSON.parse(serialized) as SuperAgentTicketCard) : null
      })
      .filter((card): card is SuperAgentTicketCard => card !== null)
  }

  return { sync, setPreparing, recordProgress, cards }
}

export type SuperAgentProgressProjectorInstance = ReturnType<typeof createSuperAgentProgressProjector>
