/**
 * Super Agent 健康模型（T13 #83，T20 #90 升级为可处置）。
 *
 * 每个项目一个 tracker，按类别记录同类连续失败：到阈值（默认 3 次）才升级
 * error，单次网络抖动只算 degraded，不打扰人；一次成功即清零并移出报告。
 *
 * 类别覆盖设计 §10.4 的六类：Effect 各类（launch/delivery/relay/reply/
 * reviewReminder）、Source 游标与读取、Eval 的 unavailable、引擎/模型可用性、
 * 项目锁、迁移；未知错误码累计到 `unknownError`。
 *
 * delivery 永久失败已由工单卡片（person/delivery 阶段）呈现，携带工单的项
 * 标记 reflectedOnTicket，不重复计入系统问题汇总。
 *
 * T20 处置语义：
 *  - 条目按「类别 + subjectId」分键。subjectId 为 null 的是系统级问题
 *    （连续失败计数语义）；带 subjectId 的是主体问题（如某个 unavailable
 *    Eval），按事件计数、创建即 error（立即可处置），重复上报幂等刷新。
 *  - retry/resolve 清条目并落审计；dismiss 对系统级问题标记隐藏
 *    （忽略后不再重复提示，直到一次成功恢复后重新武装）、对主体问题
 *    直接移除（主体事实已在领域侧释放）。审计封顶保留最近若干条。
 */
import type {
  SuperAgentHealthCategory,
  SuperAgentHealthDisposition,
  SuperAgentHealthItem,
  SuperAgentHealthReport,
  SuperAgentHealthStatus,
} from '@/shared/channels/superAgent'
import { superAgentErrorI18nKey } from './errors'

/** 同类连续失败达到该次数才升级 error（沿用原型 effects.ts 的阈值）。 */
export const FAILURES_BEFORE_ERROR = 3

/** 处置审计封顶条数：只增不删的环形审计，防止高频处置撑爆报告。 */
export const MAX_DISPOSITIONS = 50

/** 永久投递失败以工单卡片呈现的类别；无工单可归属时才计入系统问题。 */
const REFLECTED_ON_TICKET_CATEGORY = 'effect:delivery'

export interface SuperAgentHealthFailureInput {
  /** 稳定错误码；未知 code 只用于审计展示，文案键由本模块统一回退。 */
  code?: string | null
  /** 关联工单（delivery 永久失败等）。 */
  ticketId?: string | null
  /** 处置主体（如 Eval id）；null/省略表示系统级问题。 */
  subjectId?: string | null
  /** 覆盖失败时间戳，主要用于测试。 */
  at?: string
}

export interface SuperAgentHealthTrackerOptions {
  /** 报告归属的项目，随 health.changed 一并广播。 */
  repoRoot: string
  now?: () => Date
  /** 连续失败升级阈值；仅测试可调，产品代码保持默认 3。 */
  failuresBeforeError?: number
}

export type SuperAgentHealthListener = (report: SuperAgentHealthReport) => void

export interface SuperAgentHealthTracker {
  recordSuccess(category: SuperAgentHealthCategory): void
  recordFailure(category: SuperAgentHealthCategory, input?: SuperAgentHealthFailureInput): void
  /** T20 #90：忽略问题 —— 系统级隐藏（恢复后重新提示），主体级移除；落审计。 */
  dismiss(category: SuperAgentHealthCategory, subjectId: string | null): void
  /** T20 #90：重试 —— 清零连续失败计数；落审计。 */
  retry(category: SuperAgentHealthCategory, subjectId: string | null): void
  /** T20 #90：主体问题已解决（如 Eval 已重新评估）—— 移除条目；落审计。 */
  resolve(category: SuperAgentHealthCategory, subjectId: string | null): void
  report(): SuperAgentHealthReport
  subscribe(listener: SuperAgentHealthListener): () => void
}

interface HealthEntry {
  category: SuperAgentHealthCategory
  /** 处置主体；null 表示系统级问题。 */
  subjectId: string | null
  consecutiveFailures: number
  code: string | null
  lastFailedAt: string | null
  ticketId: string | null
  reflectedOnTicket: boolean
  /** T20 #90：系统级问题被显式忽略的时间；null 表示未忽略。 */
  dismissedAt: string | null
}

type EntryKey = string

function entryKey(category: SuperAgentHealthCategory, subjectId: string | null): EntryKey {
  return subjectId === null ? `${category}\u0000` : `${category}\u0000${subjectId}`
}

function statusOf(failures: number, threshold: number): SuperAgentHealthStatus {
  if (failures <= 0) return 'ok'
  return failures >= threshold ? 'error' : 'degraded'
}

export function createSuperAgentHealthTracker(
  options: SuperAgentHealthTrackerOptions,
): SuperAgentHealthTracker {
  const { repoRoot } = options
  const now = options.now ?? (() => new Date())
  const threshold = options.failuresBeforeError ?? FAILURES_BEFORE_ERROR
  const entries = new Map<EntryKey, HealthEntry>()
  const dispositions: SuperAgentHealthDisposition[] = []
  const listeners = new Set<SuperAgentHealthListener>()

  function itemOf(entry: HealthEntry): SuperAgentHealthItem {
    // 主体问题按事件计数：一个主体问题就是一次需要人工处置的事实，创建即 error。
    const status: SuperAgentHealthStatus =
      entry.subjectId !== null ? 'error' : statusOf(entry.consecutiveFailures, threshold)
    return {
      category: entry.category,
      status,
      consecutiveFailures: entry.consecutiveFailures,
      code: entry.code,
      codeI18nKey: entry.code === null ? 'superAgent.errors.unknown' : superAgentErrorI18nKey(entry.code),
      lastFailedAt: entry.lastFailedAt,
      ticketId: entry.ticketId,
      reflectedOnTicket: entry.reflectedOnTicket,
      subjectId: entry.subjectId,
    }
  }

  function buildReport(): SuperAgentHealthReport {
    const items = [...entries.values()]
      .filter((entry) => entry.consecutiveFailures > 0 && entry.dismissedAt === null)
      .sort((a, b) => {
        if (a.category !== b.category) return a.category < b.category ? -1 : 1
        const aSubject = a.subjectId ?? ''
        const bSubject = b.subjectId ?? ''
        return aSubject === bSubject ? 0 : aSubject < bSubject ? -1 : 1
      })
      .map(itemOf)
    let problemCount = 0
    let degradedCount = 0
    for (const item of items) {
      if (item.reflectedOnTicket) continue
      if (item.status === 'error') problemCount += 1
      else degradedCount += 1
    }
    return {
      repoRoot,
      problemCount,
      degradedCount,
      items,
      dispositions: [...dispositions],
      updatedAt: now().toISOString(),
    }
  }

  function notify(): void {
    const report = buildReport()
    for (const listener of listeners) listener(report)
  }

  function recordDisposition(
    category: SuperAgentHealthCategory,
    subjectId: string | null,
    action: SuperAgentHealthDisposition['action'],
  ): void {
    dispositions.push({ category, subjectId, action, at: now().toISOString() })
    if (dispositions.length > MAX_DISPOSITIONS) {
      dispositions.splice(0, dispositions.length - MAX_DISPOSITIONS)
    }
    notify()
  }

  return {
    recordSuccess(category) {
      // 成功恢复该类别的所有条目（系统级 + 各主体），被忽略的问题也重新武装。
      let touched = false
      for (const [key, entry] of entries) {
        if (entry.category !== category) continue
        entries.delete(key)
        touched = true
      }
      if (touched) notify()
    },

    recordFailure(category, input = {}) {
      const at = input.at ?? now().toISOString()
      const ticketId = input.ticketId ?? null
      const subjectId = input.subjectId ?? null
      const key = entryKey(category, subjectId)
      const existing = entries.get(key)
      if (existing !== undefined && subjectId !== null) {
        // 主体问题幂等刷新：同一事件的重复上报（如周期同步）只更新事实，
        // 不累计抖动计数。
        existing.code = input.code ?? null
        existing.lastFailedAt = at
        existing.ticketId = ticketId
      } else if (existing !== undefined) {
        // 系统级问题延续既有计数（保持 T13 连续失败语义）；被忽略的条目
        // 保持隐藏（忽略后不再重复提示），直到一次成功恢复。
        existing.consecutiveFailures += 1
        existing.code = input.code ?? null
        existing.lastFailedAt = at
        existing.ticketId = ticketId
        existing.reflectedOnTicket =
          category === REFLECTED_ON_TICKET_CATEGORY && ticketId !== null
      } else {
        entries.set(key, {
          category,
          subjectId,
          consecutiveFailures: 1,
          code: input.code ?? null,
          lastFailedAt: at,
          ticketId,
          reflectedOnTicket: category === REFLECTED_ON_TICKET_CATEGORY && ticketId !== null,
          dismissedAt: null,
        })
      }
      notify()
    },

    dismiss(category, subjectId) {
      const key = entryKey(category, subjectId)
      if (subjectId !== null) {
        // 主体事实已在领域侧释放，条目直接移除。
        entries.delete(key)
      } else {
        const entry = entries.get(key)
        if (entry !== undefined) entry.dismissedAt = now().toISOString()
      }
      recordDisposition(category, subjectId, 'dismiss')
    },

    retry(category, subjectId) {
      entries.delete(entryKey(category, subjectId))
      recordDisposition(category, subjectId, 'retry')
    },

    resolve(category, subjectId) {
      entries.delete(entryKey(category, subjectId))
      recordDisposition(category, subjectId, 'reevaluated')
    },

    report: buildReport,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
