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

function hasInputAfter(
  facts: TicketStageFacts,
  ordinal: number,
  options: { humanOnly: boolean },
): boolean {
  return facts.inputs.some(
    (input) =>
      input.ticketId === facts.ticket.ticketId &&
      input.ordinal > ordinal &&
      // 仅上下文输入不投递、不唤醒执行，不能改变阶段。
      !input.context &&
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
