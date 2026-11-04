/**
 * T11 #81 启动恢复：主进程重启后，把磁盘上的领域状态对账回可继续推进的内存状态。
 *
 * 顺序（§9.3，WAL 重放由 Store 完成后）：
 *   1. running 标 interrupted —— 重启后不出现「进程已退出但 Assignment 仍 running」；
 *   2. delivered 未 read 的输入对账 —— 未读回队首并清会话副本（只投一次）；
 *      已 read 不重复投递；uncertain 保持并保留 Attention（不盲目重投）；
 *   3. busy 判定 —— 仍在执行未 handoff、或 handoff Report 后又有新 Input 的工单，
 *      按原 queueOrder（oldest first）建 generation+1 的恢复 Assignment；
 *      无后续输入的 waiting/ready/blocked/failed 与权限等待保持原 Assignment、
 *      Attention 与阶段，不自动 launch。
 *
 * 恢复幂等：恢复途中再次崩溃，下次启动重放后不重复建代次、不重复对账。
 * 每一步都经 Domain 命令落库（持久化包装负责 WAL 事务），不直接改内存。
 */
import type { SuperAgentAssignment, SuperAgentTicket } from './model'
import type { SuperAgentDomain } from './domain'

export interface StartupRecoveryInterrupted {
  ticketId: string
  assignmentId: string
}

export interface StartupRecoveryRequeued {
  ticketId: string
  inputId: string
}

export interface StartupRecoveryRecovered {
  ticketId: string
  assignmentId: string
  generation: number
}

export interface StartupRecoveryResult {
  /** 本次标 interrupted 的 running Assignment（重启前在跑的代次）。 */
  interrupted: StartupRecoveryInterrupted[]
  /** 本次对账回队首的 delivered 未读 Input。 */
  requeued: StartupRecoveryRequeued[]
  /** 本次为 busy 工单新建的 generation+1 恢复 Assignment。 */
  recovered: StartupRecoveryRecovered[]
}

function latestOf(
  domain: SuperAgentDomain,
  ticket: SuperAgentTicket,
): SuperAgentAssignment | null {
  const assignments = ticket.assignmentIds.map((id) => domain.state.assignments[id])
  const latest = assignments[assignments.length - 1]
  return latest ?? null
}

/**
 * busy 判定：最新代次因重启被标 interrupted，且当前派生阶段仍是 working ——
 * 即崩溃前仍在执行、未进入权限等待或其他人工 handoff（handoff 后又有新 Input
 * 的工单阶段同样回到 working）。
 */
function isBusyAfterInterrupt(
  domain: SuperAgentDomain,
  ticket: SuperAgentTicket,
  latest: SuperAgentAssignment,
): boolean {
  if (ticket.state !== 'open' || latest.state !== 'interrupted') return false
  return domain.stageOf(ticket.ticketId) === 'working'
}

export function runStartupRecovery(domain: SuperAgentDomain): StartupRecoveryResult {
  const interrupted: StartupRecoveryInterrupted[] = []
  const requeued: StartupRecoveryRequeued[] = []
  const recovered: StartupRecoveryRecovered[] = []

  // 1. running 标 interrupted（含上一轮恢复途中崩溃遗留的 running）
  const running = Object.values(domain.state.assignments)
    .filter((assignment) => assignment.state === 'running')
    .sort((a, b) => a.createdOrdinal - b.createdOrdinal)
  for (const assignment of running) {
    const ticket = domain.state.tickets[assignment.ticketId]
    if (!ticket || ticket.state !== 'open') continue
    domain.endAssignment({ assignmentId: assignment.assignmentId, reason: 'interrupted' })
    interrupted.push({ ticketId: ticket.ticketId, assignmentId: assignment.assignmentId })
  }

  // 2. delivered 未 read 的输入对账：未读回队首并清会话副本
  const interruptedTickets = Object.values(domain.state.tickets)
    .filter((ticket) => ticket.state === 'open')
    .map((ticket) => ({ ticket, latest: latestOf(domain, ticket) }))
    .filter(
      (item): item is { ticket: SuperAgentTicket; latest: SuperAgentAssignment } =>
        item.latest !== null && item.latest.state === 'interrupted',
    )
  for (const { ticket } of interruptedTickets) {
    for (const inputId of ticket.inputIds) {
      const input = domain.state.inputs[inputId]
      if (!input || input.status !== 'delivered' || input.readAt !== null) continue
      domain.requeueInput({ inputId })
      requeued.push({ ticketId: ticket.ticketId, inputId })
    }
  }

  // 3. busy 工单按原 queueOrder（oldest first）建 generation+1 恢复代次
  const busy = interruptedTickets
    .filter((item) => isBusyAfterInterrupt(domain, item.ticket, item.latest))
    .sort((a, b) => a.latest.createdOrdinal - b.latest.createdOrdinal)
  for (const { ticket } of busy) {
    const result = domain.recoverTicket({ ticketId: ticket.ticketId })
    recovered.push({
      ticketId: ticket.ticketId,
      assignmentId: result.assignment.assignmentId,
      generation: result.assignment.generation,
    })
  }

  return { interrupted, requeued, recovered }
}
