/**
 * Attention 投影（T08 #78）：把领域 Attention 状态投影成非模态气泡视图。
 *
 * 三条事件（设计 §10.1 在桌面端的落地）：
 *  - attention.asked：question 新建 Attention，或 open 期间视图刷新
 *    （如人就地回答后补充了 answers）；
 *  - attention.answered：Worker 用 answers 认领后关闭，气泡折叠保留审计；
 *  - attention.withdrawn：被替换/结束时撤回，旧气泡移除。
 *
 * payload 携带全量视图与按工单去重的待处理数（徽章/顶部计数联动），
 * Renderer 直接应用即幂等，不需要水位对账。
 */
import type {
  SuperAgentAttentionBoard,
  SuperAgentAttentionEvent,
  SuperAgentAttentionView,
} from '@/shared/channels/superAgent'
import type { SuperAgentDomain } from './domain'
import type { SuperAgentAttention } from './model'

export interface SuperAgentAttentionProjectorOptions {
  domain: SuperAgentDomain
  repoRoot: string
  onAttentionEvent: (event: SuperAgentAttentionEvent) => void
}

export interface SuperAgentAttentionProjector {
  /** 全量同步：返回并广播本次所有变化事件（无变化为空数组）。 */
  sync(): SuperAgentAttentionEvent[]
  /** 全量视图（含已回答的审计折叠项），按提问时间升序。 */
  views(): SuperAgentAttentionView[]
  /** 按工单去重的待处理数：徽章与顶部计数都用它。 */
  pendingTickets(): number
  /** 看板快照，attentions 通道直接返回。 */
  board(): SuperAgentAttentionBoard
}

export function createSuperAgentAttentionProjector(
  options: SuperAgentAttentionProjectorOptions,
): SuperAgentAttentionProjector {
  const cache = new Map<string, string>()

  function viewOf(attention: SuperAgentAttention): SuperAgentAttentionView {
    const ticket = options.domain.state.tickets[attention.ticketId]
    return {
      attentionId: attention.attentionId,
      ticketId: attention.ticketId,
      ticketTitle: ticket?.title ?? attention.ticketId,
      assignmentId: attention.assignmentId,
      kind: attention.kind,
      question: attention.question,
      askedAt: attention.askedAt,
      status: attention.status,
      answers: [...attention.answers],
      answeredAt: attention.answeredAt,
      sessionId: attention.sessionId ?? null,
      requestId: attention.requestId ?? null,
    }
  }

  function views(): SuperAgentAttentionView[] {
    // 按提问时间升序；同毫秒保持领域插入序（先撤回的旧问题在前）。
    // 不能用 attentionId 随机后缀做 tie-break——全量并发下两条 Attention
    // 同毫秒创建时事件顺序会抖动（T08 曾出现 ['asked','withdrawn'] 乱序）。
    // JS sort 是稳定排序，省去比较器即得插入序。
    return Object.values(options.domain.state.attentions)
      .map(viewOf)
      .sort((a, b) => (a.askedAt < b.askedAt ? -1 : a.askedAt > b.askedAt ? 1 : 0))
  }

  function pendingTickets(): number {
    return new Set(
      Object.values(options.domain.state.attentions)
        .filter((attention) => attention.status === 'open')
        .map((attention) => attention.ticketId),
    ).size
  }

  function sync(): SuperAgentAttentionEvent[] {
    const next = views()
    const events: SuperAgentAttentionEvent[] = []
    const count = pendingTickets()
    for (const view of next) {
      const serialized = JSON.stringify(view)
      const before = cache.get(view.attentionId)
      if (before === serialized) continue
      const beforeStatus = before ? (JSON.parse(before) as { status: string }).status : null
      const reason: SuperAgentAttentionEvent['reason'] =
        beforeStatus && beforeStatus !== view.status && view.status !== 'open'
          ? (view.status as 'answered' | 'withdrawn')
          : 'asked'
      cache.set(view.attentionId, serialized)
      const event: SuperAgentAttentionEvent = {
        repoRoot: options.repoRoot,
        reason,
        attention: view,
        attentions: next,
        pendingTickets: count,
      }
      events.push(event)
    }
    for (const event of events) options.onAttentionEvent(event)
    return events
  }

  function board(): SuperAgentAttentionBoard {
    return { repoRoot: options.repoRoot, attentions: views(), pendingTickets: pendingTickets() }
  }

  return { sync, views, pendingTickets, board }
}
