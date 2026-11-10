/**
 * Eval 驱动闭环（T16 #86 的执行器，T19 #99 接线）。
 *
 * 职责边界：
 *  - 候选 → Domain.startEval（按 Thread 串行建批，领域侧负责 Gate、去重与计数）；
 *  - 评估卡 → Router 中继队列（真正开轮时才 deliverEval，deadline 从送达起算）；
 *  - Router 回复 → 严格解析 `super-agent:eval` 围栏 → Domain.submitEvalDecision；
 *  - 定时 sweep：delivered 超时重排，queued 不计时，暂停不超时；
 *  - 旧版本/迟到回复不落地。
 *
 * 这里只做编排，所有状态判断与审计链仍以 Domain 为准；observe/auto 的差异也由
 * Domain 的 submitEvalDecision 实现，本文件不复制那套规则。
 */
import { SUPER_AGENT_EVAL_FENCE } from '@/shared/channels/superAgent'
import { createSuperAgentContextReader } from './contextReader'
import type { SuperAgentDomain } from './domain'
import { isSuperAgentDomainError, superAgentError } from './errors'
import type { SuperAgentEval } from './model'
import { renderSuperAgentEvalCard, type SuperAgentEvalCardTicket } from './prompts'

export type SuperAgentEvalAction = 'accept' | 'stop' | 'ignore' | 'unavailable'

/** 严格解析后的评估结论（字段与 `super-agent:eval` 协议一一对应）。 */
export interface SuperAgentEvalDecisionPayload {
  version: 1
  evalId: string
  action: SuperAgentEvalAction
  matchedRules: string[]
  reason: string
}

/**
 * Router 评估轮的接缝：由 routerRunner 实现。
 *
 * `onDeliver` 只有在这一轮真正开始（模型即将看到卡片）时才调用，因此 deadline
 * 从此刻起算；`isStale` 在轮到该条队列项时检查，策略变更/已处置的批次不占一轮。
 */
export interface SuperAgentEvalRouterTurn {
  text: string
  isStale?(): boolean
  onDeliver?(): void
  onResult(text: string): void
}

export interface SuperAgentEvalRouter {
  evaluate(turn: SuperAgentEvalRouterTurn): void
}

/** sweep 定时器的注入点（测试用假定时器，生产用 setInterval）。 */
export type SuperAgentEvalScheduler = (
  run: () => void,
  intervalMs: number,
) => () => void

export interface SuperAgentEvalDriverOptions {
  domain: SuperAgentDomain
  repoRoot: string
  router: SuperAgentEvalRouter
  /** 领域事实变化（建单/处置/重排）后的投影与调度同步。 */
  onChanged?: () => void
  /** 协议失败或不可用等稳定错误码（供健康面板）。 */
  onFailure?: (code: string, evalId: string) => void
  /** 一轮评估成功落 Decision（非 unavailable）时回调，供健康恢复。 */
  onDecided?: (evalId: string) => void
  sweepIntervalMs?: number
  schedule?: SuperAgentEvalScheduler
}

export interface SuperAgentEvalDriver {
  /** 扫描所有 Thread，为有待评候选且不在评估中的 Thread 开新一轮。 */
  pump(): void
  /** 处理已到期的 delivered Eval；返回本轮处理掉的条数。 */
  sweep(): number
  start(): void
  stop(): void
}

const EVAL_BLOCK_PATTERN = new RegExp(
  `(^|\\n)[ \\t]*\`\`\`${SUPER_AGENT_EVAL_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?\`\`\``,
  'g',
)

const EVAL_FIELDS = new Set(['version', 'evalId', 'action', 'matchedRules', 'reason'])
const EVAL_ACTIONS = new Set<SuperAgentEvalAction>(['accept', 'stop', 'ignore', 'unavailable'])
const DEFAULT_SWEEP_INTERVAL_MS = 1_000

function errorCodeOf(err: unknown): string {
  return isSuperAgentDomainError(err) ? err.code : 'unknown'
}

function invalid(field: string): never {
  throw superAgentError('evalInvalid', { field })
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalid(field)
  return value.trim()
}

function parseMatchedRules(value: unknown): string[] {
  if (!Array.isArray(value)) invalid('matchedRules')
  const rules: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') invalid('matchedRules')
    const name = item.trim()
    if (rules.includes(name)) invalid('matchedRules')
    rules.push(name)
  }
  return rules
}

/**
 * 严格解析 Router 的评估回复：恰好一个 `super-agent:eval` 围栏块。
 *
 * 与 route 协议不同，评估轮没有「纯闲聊」这种正常空结果 —— 没有块就是协议失败，
 * 不猜意图、不按自由文本推断。
 */
export function parseSuperAgentEvalText(text: string): SuperAgentEvalDecisionPayload {
  EVAL_BLOCK_PATTERN.lastIndex = 0
  const blocks: string[] = []
  let match: RegExpExecArray | null
  while ((match = EVAL_BLOCK_PATTERN.exec(text)) !== null) blocks.push(match[2] ?? '')
  if (blocks.length === 0) throw superAgentError('evalMissing')
  if (blocks.length > 1) throw superAgentError('evalNotUnique')

  let parsed: unknown
  try {
    parsed = JSON.parse(blocks[0]!.trim())
  } catch {
    throw superAgentError('evalUnparsable')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid('root')
  }
  const record = parsed as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!EVAL_FIELDS.has(key)) invalid(key)
  }
  if (record.version !== 1) invalid('version')
  if (typeof record.action !== 'string' || !EVAL_ACTIONS.has(record.action as SuperAgentEvalAction)) {
    invalid('action')
  }
  return {
    version: 1,
    evalId: requireNonEmptyString(record.evalId, 'evalId'),
    action: record.action as SuperAgentEvalAction,
    matchedRules: parseMatchedRules(record.matchedRules),
    reason: requireNonEmptyString(record.reason, 'reason'),
  }
}

function defaultSchedule(run: () => void, intervalMs: number): () => void {
  const timer = setInterval(run, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

/** 工单卡片排序：open 在前，其余保持订阅顺序。 */
function relatedTickets(domain: SuperAgentDomain, evalRecord: SuperAgentEval): SuperAgentEvalCardTicket[] {
  const state = domain.state
  const thread = state.threads[evalRecord.threadId]
  if (!thread) return []
  const tickets = thread.subscriptions
    .map((subscription) => state.tickets[subscription.ticketId])
    .filter((ticket): ticket is NonNullable<typeof ticket> => ticket !== undefined)
  const openFirst = [...tickets].sort((left, right) => {
    const leftOpen = left.state === 'open' ? 0 : 1
    const rightOpen = right.state === 'open' ? 0 : 1
    return leftOpen - rightOpen
  })
  return openFirst.map((ticket) => ({
    ticketId: ticket.ticketId,
    title: ticket.title,
    state: ticket.state,
  }))
}

export function createSuperAgentEvalDriver(
  options: SuperAgentEvalDriverOptions,
): SuperAgentEvalDriver {
  const { domain, repoRoot, router, onChanged, onFailure, onDecided } = options
  // #102：候选不只看工单快照 —— 评估卡附带经 contextReader 组装的有界 Thread 窗口。
  const contextReader = createSuperAgentContextReader({ domain })
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
  const schedule = options.schedule ?? defaultSchedule
  let cancelSweep: (() => void) | null = null
  let pumpGuard = false

  /** 交回 Eval 的人消息原文：卡片要让 Router 看到 Worker 为什么把这条交回来。 */
  function handbackReasons(): Map<string, string> {
    const reasons = new Map<string, string>()
    // #100：Worker 用 handback 围栏给出的原因优先（同族快照旧记录没有这条）。
    for (const action of domain.state.workerActions ?? []) {
      if (action.kind !== 'handback' || !action.triggerId || !action.reason) continue
      reasons.set(action.triggerId, action.reason)
    }
    for (const inputId of domain.state.handbacks) {
      const input = domain.state.inputs[inputId]
      if (!input?.triggerId || reasons.has(input.triggerId)) continue
      const reason = (input.text ?? input.note ?? '').trim()
      if (reason !== '') reasons.set(input.triggerId, reason)
    }
    return reasons
  }

  function buildCard(evalRecord: SuperAgentEval): string {
    const state = domain.state
    const thread = state.threads[evalRecord.threadId]
    const handedBack = handbackReasons()
    const card = renderSuperAgentEvalCard({
      evalId: evalRecord.evalId,
      threadId: evalRecord.threadId,
      threadTitle: thread?.title ?? null,
      policyVersion: evalRecord.policyVersion,
      acceptMode: state.policy.acceptMode,
      strength: evalRecord.strength,
      basis: evalRecord.basis,
      actor: evalRecord.actor,
      bot: evalRecord.bot,
      triggers: evalRecord.triggerIds
        .map((triggerId) => state.triggers[triggerId])
        .filter((trigger): trigger is NonNullable<typeof trigger> => trigger !== undefined)
        .map((trigger) => ({
          triggerId: trigger.triggerId,
          source: trigger.source,
          actor: trigger.actor,
          human: trigger.human,
          addressed: trigger.addressed,
          channel: trigger.channel,
          url: trigger.url,
          text: trigger.text,
          handedBack: trigger.disposition.handedBack,
          handedBackReason: handedBack.get(trigger.triggerId) ?? null,
          requeued: trigger.disposition.requeued,
          filtered: trigger.disposition.filtered,
        })),
      tickets: relatedTickets(domain, evalRecord),
      rules: state.policy.rules,
    })
    // 开头若干条 + 候选前后各若干条；截断处带续读指针（trigger/<id>）。
    const window = contextReader.renderEvalThreadWindow(evalRecord.threadId, evalRecord.triggerIds)
    return window === null ? card : `${card}\n\n${window.text}`
  }

  /** 真正开轮时记账：只有仍处于 queued 的批次才转 delivered（重试幂等）。 */
  function deliver(evalId: string): void {
    const record = domain.state.evals[evalId]
    if (!record || record.state !== 'queued') return
    try {
      domain.deliverEval({ evalId })
    } catch (err) {
      // 策略变更/处置在 await 间隙抢跑会让这里 conflict：批次已由领域收敛，
      // 这一轮的结果会被 settle 守卫丢弃，不属于健康故障。
      const code = errorCodeOf(err)
      if (code !== 'conflict') onFailure?.(code, evalId)
    }
  }

  /** 结算一轮评估：只处理仍 delivered 的批次，迟到/已废弃的结果直接丢弃。 */
  function settle(evalId: string, text: string): void {
    const record = domain.state.evals[evalId]
    if (!record || record.state !== 'delivered') return

    let payload: SuperAgentEvalDecisionPayload
    try {
      payload = parseSuperAgentEvalText(text)
    } catch (err) {
      onFailure?.(errorCodeOf(err), evalId)
      return
    }
    if (payload.evalId !== evalId) {
      onFailure?.('evalInvalid', evalId)
      return
    }

    try {
      const result = domain.submitEvalDecision({
        evalId,
        action: payload.action,
        matchedRules: payload.matchedRules,
        reason: payload.reason,
        repoRoot,
      })
      if (result.eval.state === 'unavailable') {
        onFailure?.('evalUnavailable', evalId)
      } else {
        onDecided?.(evalId)
      }
    } catch (err) {
      const code = errorCodeOf(err)
      // 策略已变更 / 已被处置：旧结论不落地，也不当成协议失败。
      if (code !== 'evalPolicyStale' && code !== 'evalNotDelivered') {
        onFailure?.(code, evalId)
      }
      return
    }
    onChanged?.()
    pump()
  }

  function pump(): void {
    if (pumpGuard) return
    const state = domain.state
    if (state.paused || state.policy.acceptMode === 'off') return
    pumpGuard = true
    try {
      for (const thread of Object.values(state.threads)) {
        if (thread.evaluating || thread.pendingTriggerIds.length === 0) continue
        let evalRecord: SuperAgentEval
        try {
          evalRecord = domain.startEval({ threadId: thread.threadId })
        } catch (err) {
          const code = errorCodeOf(err)
          // 没有可准入候选 / 已经忙 / 线程消失：都是正常竞态，不报健康。
          if (code !== 'evalEmpty' && code !== 'evalBusy' && code !== 'threadNotFound') {
            onFailure?.(code, '')
          }
          continue
        }
        const evalId = evalRecord.evalId
        router.evaluate({
          text: buildCard(evalRecord),
          isStale: () => {
            const current = domain.state.evals[evalId]
            return current === undefined || current.state !== 'queued'
          },
          onDeliver: () => deliver(evalId),
          onResult: (text) => settle(evalId, text),
        })
      }
    } finally {
      pumpGuard = false
    }
  }

  function sweep(): number {
    const state = domain.state
    let expired = 0
    for (const record of Object.values(state.evals)) {
      if (record.state !== 'delivered') continue
      let outcome: 'requeued' | 'unavailable' | 'ignored'
      try {
        outcome = domain.expireEval({ evalId: record.evalId }).outcome
      } catch (err) {
        onFailure?.(errorCodeOf(err), record.evalId)
        continue
      }
      if (outcome === 'ignored') continue
      expired += 1
      if (outcome === 'unavailable') onFailure?.('evalUnavailable', record.evalId)
    }
    if (expired > 0) {
      onChanged?.()
      pump()
    }
    return expired
  }

  return {
    pump,
    sweep,
    start() {
      if (cancelSweep) return
      cancelSweep = schedule(() => {
        try {
          sweep()
        } catch (err) {
          onFailure?.(errorCodeOf(err), '')
        }
      }, sweepIntervalMs)
    },
    stop() {
      cancelSweep?.()
      cancelSweep = null
    },
  }
}
