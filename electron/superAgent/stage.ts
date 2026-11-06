/**
 * Ticket 阶段派生（T03 #73）。
 *
 * 阶段只由领域事实派生，不读写 `ticket.stage`，避免与 Report/Assignment 双写漂移。
 * 优先级严格按 docs/design/super-agent-implementation-plan.md §5.2：
 *   结束 > 投递失败 > 未回答 Attention > review > blocked/failed > queued > idle > working
 *
 * 「之后有没有新 Input」用 Input 的 `ordinal` 与 Report/Assignment 记录的水位比较：
 *   - blocked/failed 只认人消息解除（自动输入被闸门拦下，不应改变阶段）；
 *   - ready/waiting/ended 只要有任何新 Input 就说明又有工作待推进。
 */
import type {
  SuperAgentAssignment,
  SuperAgentAttention,
  SuperAgentInput,
  SuperAgentTicket,
  SuperAgentTicketOutcome,
  SuperAgentTicketStage,
} from './model'

export interface TicketStageFacts {
  ticket: SuperAgentTicket
  assignments: SuperAgentAssignment[]
  inputs: SuperAgentInput[]
  attentions: SuperAgentAttention[]
}

/** 按 `generation` 取最新一代（generation 只在新建 Assignment 时递增）。 */
export function latestAssignmentOf(assignments: SuperAgentAssignment[]): SuperAgentAssignment | null {
  let latest: SuperAgentAssignment | null = null
  for (const assignment of assignments) {
    if (!latest || assignment.generation > latest.generation) latest = assignment
  }
  return latest
}

/**
 * 「之后有没有新 Input」在代次已经没有活进程时只算**真的送到了执行方**的那些。
 *
 * 最新代次 ended/interrupted 时状态还是 pending/failed 的人消息是一条死信：Worker
 * 没读到它，也没有任何东西会再把它投出去。把它算成"人已经说过了"会同时骗到两处 ——
 * blocked/failed 闸门被它解除（阶段刷成 working、重试入口消失），idle 判定被它唤醒。
 *
 * 代次还活着时不这么判：崩溃恢复会把"已投递未读"的 Input 回队重投（recovery 第 3 步），
 * 那一刻它同样是 pending，但它确实到了 Worker 手上过 —— 所以恢复把 busy 判定排在
 * 回队之前，判定时它的状态还是 delivered。
 */
function isReachingWorker(input: SuperAgentInput, latest: SuperAgentAssignment | null): boolean {
  const noLiveExecution = latest !== null && (latest.state === 'ended' || latest.state === 'interrupted')
  if (!noLiveExecution) return true
  return input.status === 'delivered' || input.status === 'read' || input.status === 'uncertain'
}

function hasInputAfter(
  facts: TicketStageFacts,
  ordinal: number,
  options: { humanOnly: boolean },
): boolean {
  const latest = latestAssignmentOf(facts.assignments)
  return facts.inputs.some(
    (input) =>
      input.ticketId === facts.ticket.ticketId &&
      input.ordinal > ordinal &&
      // 仅上下文输入不投递、不唤醒执行，不能改变阶段。
      !input.context &&
      isReachingWorker(input, latest) &&
      (options.humanOnly ? input.human : true),
  )
}

function hasOpenAttention(facts: TicketStageFacts): boolean {
  return facts.attentions.some(
    (attention) => attention.ticketId === facts.ticket.ticketId && attention.status === 'open',
  )
}

function stageOfOutcome(outcome: SuperAgentTicketOutcome): SuperAgentTicketStage {
  // merged/closed 是 Phase 2 的 Thread 关闭结局，对用户等价于「已完成」。
  if (outcome === 'merged' || outcome === 'closed') return 'completed'
  return outcome
}

/**
 * blocked/failed 期间是否必须等人：
 * 最新 Report 为 blocked/failed，且报告之后没有新的**人**消息。
 * 阶段派生与 Input 投递闸门共用这条判定，避免两处条件漂移。
 */
export function waitsForPerson(facts: TicketStageFacts): boolean {
  if (facts.ticket.state === 'ended') return false
  const latest = latestAssignmentOf(facts.assignments)
  const report = latest?.report
  if (!report || (report.kind !== 'blocked' && report.kind !== 'failed')) return false
  return !hasInputAfter(facts, report.ordinal, { humanOnly: true })
}

export function deriveTicketStage(facts: TicketStageFacts): SuperAgentTicketStage {
  const { ticket } = facts
  if (ticket.state === 'ended') {
    return stageOfOutcome(ticket.ended?.outcome ?? 'completed')
  }

  if (ticket.delivery) return 'person/delivery'
  if (hasOpenAttention(facts)) return 'person/answer'

  const latest = latestAssignmentOf(facts.assignments)
  if (!latest) return 'working/queued'

  const report = latest.report
  if (report?.kind === 'ready' && !hasInputAfter(facts, report.ordinal, { humanOnly: false })) {
    return 'person/review'
  }

  if (
    report &&
    (report.kind === 'blocked' || report.kind === 'failed') &&
    !hasInputAfter(facts, report.ordinal, { humanOnly: true })
  ) {
    return report.kind === 'blocked' ? 'person/blocked' : 'person/failed'
  }

  if (latest.state === 'pending') return 'working/queued'

  if (report?.kind === 'waiting' && !hasInputAfter(facts, report.ordinal, { humanOnly: false })) {
    return 'idle'
  }

  if (
    latest.state === 'ended' &&
    latest.endedOrdinal !== null &&
    !hasInputAfter(facts, latest.endedOrdinal, { humanOnly: false })
  ) {
    return 'idle'
  }

  return 'working'
}

/**
 * T10 #80 人工重试闸门（设计 §7.4）：只有 open 且处于 person/delivery、
 * person/blocked、person/failed 的工单允许重试。人工消息已到达 blocked/failed
 * 时阶段已回到 working（消息交给执行方），自然不再开放；review/working/idle
 * 一律拒绝。与阶段派生共用同一事实源，避免两处条件漂移。
 */
export function canRetryTicket(facts: TicketStageFacts): boolean {
  if (facts.ticket.state !== 'open') return false
  const stage = deriveTicketStage(facts)
  return stage === 'person/delivery' || stage === 'person/blocked' || stage === 'person/failed'
}
