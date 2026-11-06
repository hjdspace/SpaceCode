/**
 * Source Ingestor：游标续读、断档全量重拉、Intake fan-out、建单候选、
 * 坏事件隔离与限流退避（T15 #85）。
 *
 * Intake 顺序遵循设计 §6.2：存 Trigger → 更新 Thread → fan-out 给既有订阅 →
 * 程序层 Gate（T16 #86，纯函数，不耗模型）决定 explicit / inferred / 不进入：
 * 准入的未被订阅消费 Trigger 连同判定结果交给 onCandidate；
 * 不准入的直接落 disposition.filtered 原因码，不把正文送入 Router。
 *
 * 游标只在整批事件成功进入领域后推进；断档（gap）时丢弃当前页并从头全量重拉，
 * 事件键幂等（domain.intakeTrigger）保证重放不重复建单、fan-out 的 requestId
 * 保证不重复投递。轮询失败按指数退避，全部基于定时器与异步 IO，不阻塞主进程。
 */
import type { SuperAgentDomain, TriggerDraft } from '../domain'
import type {
  SuperAgentMandateBasis,
  SuperAgentMandateStrength,
  SuperAgentTrigger,
  SuperAgentTriggerAddress,
} from '../model'
import { gateTrigger } from '../policy'
import type { SourceQuarantine, SourceQuarantineEntry } from './quarantine'
import type { SourceCursorStore } from './cursorStore'
import { parseSourceEvent, parseSourceThreadDone } from './types'
import type { ExternalSource, SourceThreadDone } from './types'

/**
 * 建单候选：经程序层 Gate 准入（@SuperAgent / 显式引用 → explicit，
 * 名单或 bot → inferred）且未被任何订阅消费的 Trigger。
 */
export interface SourceCandidate {
  trigger: SuperAgentTrigger
  /** 触发方式（addressed 类型）；名单/bot 的未 @ 候选为 null。 */
  reason: SuperAgentTriggerAddress | null
  /** T16 #86：Gate 判定强度（explicit/inferred）。 */
  strength: SuperAgentMandateStrength
  /** T16 #86：Gate 判定依据（addressed/admission/bot）。 */
  basis: SuperAgentMandateBasis
  /** T16 #86：是否来自 bot 名单（最多 inferred、不能显式请求/停止）。 */
  bot: boolean
}

export interface SourceStatus {
  sourceId: string
  running: boolean
  cursor: string | null
  consecutiveFailures: number
  lastError: string | null
  quarantined: number
  lastPolledAt: string | null
}

export interface SourceIngestorOptions {
  domain: SuperAgentDomain
  sources: ExternalSource[]
  cursorStore: SourceCursorStore
  quarantine: SourceQuarantine
  /** 建单候选回调；重复重放不重复回调，但跨重启仍可能重发，下游须按事件键幂等。 */
  onCandidate?: (candidate: SourceCandidate) => void
  /**
   * T24 #93：每次轮询成功/失败后的状态快照回调。Service 据此把读取失败
   * 计入 health 的 `source:<id>` 类别（不额外引入事件总线）。
   */
  onStatus?: (status: SourceStatus) => void
  /** 成功轮询之间的最小间隔。 */
  pollIntervalMs?: number
  /** 失败退避基数，指数递增直到 backoffCapMs。 */
  backoffBaseMs?: number
  backoffCapMs?: number
  /** 单次 poll 的页大小。 */
  pollLimit?: number
  /** 单次 pollOnce 内最多翻页/重拉次数，防止断档风暴造成无限循环。 */
  maxPagesPerPoll?: number
  now?: () => Date
}

export interface SourceIngestor {
  start(): void
  stop(): void
  /** 执行一轮完整轮询（游标读取 → 翻页/断档重拉 → 事件摄入 → 游标保存）。 */
  pollOnce(sourceId: string): Promise<void>
  status(): SourceStatus[]
  quarantineReport(): SourceQuarantineEntry[]
}

const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_BACKOFF_BASE_MS = 1_000
const DEFAULT_BACKOFF_CAP_MS = 60_000
const DEFAULT_POLL_LIMIT = 50
const DEFAULT_MAX_PAGES_PER_POLL = 100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createSourceIngestor(options: SourceIngestorOptions): SourceIngestor {
  const domain = options.domain
  const sources = [...options.sources]
  const cursorStore = options.cursorStore
  const quarantine = options.quarantine
  const onCandidate = options.onCandidate
  const onStatus = options.onStatus
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
  const backoffCapMs = options.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS
  const pollLimit = options.pollLimit ?? DEFAULT_POLL_LIMIT
  const maxPagesPerPoll = options.maxPagesPerPoll ?? DEFAULT_MAX_PAGES_PER_POLL
  const now = options.now ?? (() => new Date())

  const sourceById = new Map<string, ExternalSource>(sources.map((source) => [source.id, source]))

  /** 每 Source 的运行时状态（游标副本、失败计数与隔离计数等）。 */
  interface SourceRuntimeState {
    running: boolean
    cursor: string | null
    consecutiveFailures: number
    lastError: string | null
    quarantined: number
    lastPolledAt: string | null
  }

  const runtime = new Map<string, SourceRuntimeState>()

  function stateOf(sourceId: string): SourceRuntimeState {
    let state = runtime.get(sourceId)
    if (!state) {
      state = {
        running: false,
        cursor: null,
        consecutiveFailures: 0,
        lastError: null,
        quarantined: 0,
        lastPolledAt: null,
      }
      runtime.set(sourceId, state)
    }
    return state
  }

  /** 本进程内已发过候选的事件键；跨重启由下游按事件键幂等兜底。 */
  const emittedCandidateKeys = new Set<string>()

  let stopped = false

  function requireSource(sourceId: string): ExternalSource {
    const source = sourceById.get(sourceId)
    if (!source) throw new Error(`unknown source: ${sourceId}`)
    return source
  }

  /** 存 Trigger → 更新 Thread → fan-out 给既有订阅 → 候选。 */
  function intakeEvent(sourceId: string, raw: unknown): void {
    const parsed = parseSourceEvent(raw)
    if (!parsed.ok) {
      quarantine.record(sourceId, parsed.reason, JSON.stringify(raw))
      stateOf(sourceId).quarantined += 1
      return
    }
    // SourceEvent 与 TriggerDraft 字段一一对齐，展开即可。
    const draft: TriggerDraft = { ...parsed.event }
    const { trigger } = domain.intakeTrigger(draft)
    fanOut(trigger)
  }

  /**
   * fan-out 的投递策略（哪些消息只作上下文、哪些可唤醒）是 Source Intake
   * 的职责（设计 §6.2），刻意留在 Ingestor；domain 只提供订阅与输入原语。
   */
  function fanOut(trigger: SuperAgentTrigger): void {
    for (const threadId of trigger.threadIds) {
      const thread = domain.state.threads[threadId]
      if (!thread) continue
      for (const subscription of thread.subscriptions) {
        const ticket = domain.state.tickets[subscription.ticketId]
        if (!ticket) continue
        if (ticket.state !== 'open') {
          // T25 #98：已结束但未停止的工单被人消息按原 Mandate 恢复。
          // bot/CI 与 contextOnly 订阅永不恢复；revalidate 不通过时消息
          // 继续落到 Gate / Eval 候选路径，不被静默吞掉。
          if (!trigger.human || subscription.contextOnly) continue
          if (
            trigger.disposition.ticketIds.includes(ticket.ticketId) ||
            trigger.disposition.contextTicketIds.includes(ticket.ticketId)
          ) {
            continue
          }
          domain.wakeTicket({
            ticketId: ticket.ticketId,
            triggerId: trigger.triggerId,
            requestId: `source:${trigger.key}:${ticket.ticketId}:resumed`,
          })
          continue
        }
        // 已被建单消费的 Trigger 不再投递，避免来源事件与 fan-out 双写。
        if (
          trigger.disposition.ticketIds.includes(ticket.ticketId) ||
          trigger.disposition.contextTicketIds.includes(ticket.ticketId)
        ) {
          continue
        }
        // T17 #87：人消息归所有可裁决订阅（不再要求 addressed，由 Worker 判断
        // scope，越权走 handback 交回）；bot/CI 与 contextOnly 订阅只作上下文。
        const context = subscription.contextOnly || !trigger.human
        domain.addInput({
          ticketId: ticket.ticketId,
          requestId: `source:${trigger.key}:${ticket.ticketId}:${context ? 'ctx' : 'in'}`,
          kind: 'trigger',
          human: trigger.human,
          context,
          text: trigger.text,
          triggerId: trigger.triggerId,
        })
      }
    }

    // 程序层 Gate（T16 #86）：纯函数判定，不消耗模型。不进入的落原因码
    // 并退出 Eval 候选；准入的交给 onCandidate，由语义 Eval（按 Thread 串行）
    // 与 Policy 三模式接管后续。
    const gate = gateTrigger(domain.state.policy, trigger)
    if (!gate.admitted) {
      domain.filterTrigger({ triggerId: trigger.triggerId, reason: gate.filtered })
      return
    }
    // T17 #87 fast path：已被存活可裁决订阅消费的同 Thread 后续消息直达
    // Worker，不再进 Eval —— 不重复建单。
    if (domain.fastPathConsumed(trigger.triggerId)) return
    if (
      trigger.disposition.ticketIds.length === 0 &&
      !emittedCandidateKeys.has(trigger.key)
    ) {
      emittedCandidateKeys.add(trigger.key)
      onCandidate?.({
        trigger,
        reason: trigger.addressed,
        strength: gate.strength,
        basis: gate.basis,
        bot: gate.bot,
      })
    }
  }

  /**
   * T19 #89：Thread 终止信号（PR 合并/关闭）—— 校验后调 followsDone 结束
   * 跟随该 Thread 的开放工单（merged/closed 原样落库，follows 保留审计）。
   * 幂等：followsDone 跳过已结束工单，游标重放不会重复结束。
   */
  function intakeThreadDone(sourceId: string, entries: SourceThreadDone[]): void {
    for (const entry of entries) {
      const parsed = parseSourceThreadDone(entry)
      if (!parsed.ok) {
        quarantine.record(sourceId, parsed.reason, JSON.stringify(entry))
        stateOf(sourceId).quarantined += 1
        continue
      }
      domain.followsDone({
        threadId: parsed.done.threadId,
        outcome: parsed.done.outcome,
        reason: parsed.done.reason,
        at: parsed.done.at,
      })
    }
  }

  async function pollOnce(sourceId: string): Promise<void> {
    const source = requireSource(sourceId)
    // T17 #87：轮询前清理过期订阅 —— stopped 立即失效，已结束工单最多保留
    // 订阅寿命（缺省两周）；之后 Source 不再为该 Thread 轮询，只走普通 intake。
    domain.pruneExpiredSubscriptions()
    let cursor = cursorStore.load(sourceId)
    const state = stateOf(sourceId)
    state.cursor = cursor

    for (let pageGuard = 0; pageGuard < maxPagesPerPoll; pageGuard += 1) {
      const page = await source.poll(cursor, pollLimit)
      if (page.hasMore && !page.nextCursor) {
        throw new Error(`source "${sourceId}" returned hasMore without a cursor`)
      }
      if (page.gap) {
        // 断档：本页不可信，丢弃并从头全量重拉；已摄入事件靠幂等键去重。
        cursor = null
        continue
      }
      for (const raw of page.events) {
        intakeEvent(sourceId, raw)
      }
      intakeThreadDone(sourceId, page.threadDone ?? [])
      cursor = page.nextCursor
      state.lastPolledAt = now().toISOString()
      if (!page.hasMore) break
    }

    cursorStore.save(sourceId, cursor)
    state.cursor = cursor
  }

  function notifyStatus(sourceId: string): void {
    onStatus?.({ sourceId, ...stateOf(sourceId) })
  }

  function trackSuccess(sourceId: string): number {
    const state = stateOf(sourceId)
    state.consecutiveFailures = 0
    state.lastError = null
    notifyStatus(sourceId)
    return pollIntervalMs
  }

  function trackFailure(sourceId: string, err: unknown): number {
    const state = stateOf(sourceId)
    state.consecutiveFailures += 1
    state.lastError = err instanceof Error ? err.message : String(err)
    notifyStatus(sourceId)
    return Math.min(backoffBaseMs * 2 ** (state.consecutiveFailures - 1), backoffCapMs)
  }

  async function runLoop(source: ExternalSource): Promise<void> {
    try {
      while (!stopped) {
        let delay: number
        try {
          await pollOnce(source.id)
          delay = trackSuccess(source.id)
        } catch (err) {
          delay = trackFailure(source.id, err)
        }
        await sleep(delay)
      }
    } finally {
      stateOf(source.id).running = false
    }
  }

  return {
    start() {
      if (stopped) throw new Error('source ingestor is stopped')
      for (const source of sources) {
        const state = stateOf(source.id)
        if (state.running) continue
        state.running = true
        void runLoop(source)
      }
    },

    stop() {
      stopped = true
    },

    async pollOnce(sourceId) {
      try {
        await pollOnce(sourceId)
        trackSuccess(sourceId)
      } catch (err) {
        trackFailure(sourceId, err)
        throw err
      }
    },

    status() {
      return sources.map((source) => ({ sourceId: source.id, ...stateOf(source.id) }))
    },

    quarantineReport() {
      return quarantine.report()
    },
  }
}
