/**
 * SessionStatusQuery（设计 §8.3）：主进程内部的编排状态只读真源。
 *
 * 为什么要有它：Router 被人问"现在有哪些活"时，唯一诚实的事实源是领域 + 投影，
 * 不是引擎的 jsonl —— 那是引擎自己的会话转录，里面既没有工单阶段、也没有队列位
 * 与 Report。缺这个接缝时 Router 只能拿 Bash 去翻 git 历史猜进度。
 *
 * 约束（§8.3）：
 *  - 只读。不能 stop/abort/answer/建单/改 Policy；Scheduler 与投递路径不依赖它。
 *  - 拿不到的事实如实标 `unknown`，不写成 0 或"没有后台作业"。
 *  - 快照带 asOf/seq，调用方据此判断是否过期。
 */
import type {
  SuperAgentQueueSnapshot,
  SuperAgentTicketCard,
  SuperAgentTicketCardState,
  SuperAgentTicketProgress,
} from '@/shared/channels/superAgent'
import type { SuperAgentDomain } from './domain'
import type { SuperAgentReport, SuperAgentReportKind } from './model'

/** 阶段卡在等人回答/处置的卡片状态（§5.2 的 person/* 映射）。 */
const WAITING_FOR_HUMAN: SuperAgentTicketCardState[] = [
  'delivery',
  'answer',
  'review',
  'blocked',
  'failed',
]

/** 已结束的卡片状态：不再算"活跃工单"。 */
const ENDED_STATES: SuperAgentTicketCardState[] = ['completed', 'stopped', 'dropped']

export interface SuperAgentStatusEntry {
  ticketId: string
  title: string
  state: SuperAgentTicketCardState
  assignmentId: string | null
  generation: number
  /** 0 = 已占槽执行中；≥1 = FIFO 队列位；null = 不在队列里（已结束或尚未派生指派）。 */
  queuePosition: number | null
  currentTool: string | null
  elapsedMs: number | null
  lastActivityAt: string | null
  waitingForHuman: boolean
  /**
   * 最新一份非 progress 的 Report —— progress 只说明"还在动"，
   * 结论性事实（ready/blocked/failed/waiting）才是能向人交代的东西。
   */
  latestReport: { kind: SuperAgentReportKind; summary: string; at: string } | null
}

export interface SuperAgentStatusSnapshot {
  repoRoot: string
  asOf: string
  /** 领域事件水位；调用方据此判断快照是否已被后续变化超过。 */
  seq: number
  slots: { maxWorkers: number; running: number; queued: number }
  /** 引擎侧后台作业不在领域事实里，无法获知时按 §8.3 报 unknown，不能写成 0。 */
  backgroundJobs: 'unknown'
  /** 未回答的 Attention 数（按工单去重，与入口徽章同源）。 */
  pendingAttention: number
  /** 活跃（未结束）工单，按创建时间升序。 */
  tickets: SuperAgentStatusEntry[]
}

export interface SuperAgentSessionStatusQueryOptions {
  repoRoot: string
  domain: SuperAgentDomain
  /** 卡片投影（progressProjector.cards）。 */
  cards: () => SuperAgentTicketCard[]
  /** 队列投影（scheduler.queue）。 */
  queue: () => SuperAgentQueueSnapshot
  /** 单工单轻量进度（progressProjector.peekProgress）；无进度返回 null。 */
  progress: (ticketId: string) => SuperAgentTicketProgress | null
  nowMs?: () => number
}

export interface SuperAgentSessionStatusQuery {
  statusQuery(): SuperAgentStatusSnapshot
}

function latestConclusiveReport(
  domain: SuperAgentDomain,
  assignmentId: string | null,
): { kind: SuperAgentReportKind; summary: string; at: string } | null {
  if (!assignmentId) return null
  const report: SuperAgentReport | null = domain.state.assignments[assignmentId]?.report ?? null
  if (!report || report.kind === 'progress') return null
  return { kind: report.kind, summary: report.summary, at: report.at }
}

export function createSuperAgentSessionStatusQuery(
  options: SuperAgentSessionStatusQueryOptions,
): SuperAgentSessionStatusQuery {
  const { repoRoot, domain, cards, queue, progress, nowMs = () => Date.now() } = options

  function statusQuery(): SuperAgentStatusSnapshot {
    const snapshot = queue()
    // 队列里只有 running + queued，按 ticketId 反查队列位；已结束的自然查不到
    const positions = new Map<string, number>()
    for (const entry of snapshot.running) positions.set(entry.ticketId, entry.position)
    for (const entry of snapshot.queued) positions.set(entry.ticketId, entry.position)

    const openCards = cards().filter((card) => !ENDED_STATES.includes(card.state))
    const tickets: SuperAgentStatusEntry[] = openCards.map((card) => {
      const light = progress(card.ticketId)
      return {
        ticketId: card.ticketId,
        title: card.title,
        state: card.state,
        assignmentId: card.assignmentId,
        generation: card.generation,
        queuePosition: positions.get(card.ticketId) ?? null,
        currentTool: light?.currentTool ?? null,
        elapsedMs: light?.elapsedMs ?? null,
        lastActivityAt: light?.lastActivityAt ?? card.updatedAt,
        waitingForHuman: WAITING_FOR_HUMAN.includes(card.state),
        latestReport: latestConclusiveReport(domain, card.assignmentId),
      }
    })

    const pendingAttention = Object.values(domain.state.attentions).filter(
      (attention) => attention.status === 'open',
    ).length

    return {
      repoRoot,
      asOf: new Date(nowMs()).toISOString(),
      seq: domain.state.seq,
      slots: {
        maxWorkers: snapshot.maxWorkers,
        running: snapshot.running.length,
        queued: snapshot.queued.length,
      },
      backgroundJobs: 'unknown',
      pendingAttention,
      tickets,
    }
  }

  return { statusQuery }
}
