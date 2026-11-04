/**
 * Super Agent 健康模型（T13 #83）。
 *
 * 每个项目一个 tracker，按类别记录同类连续失败：到阈值（默认 3 次）才升级
 * error，单次网络抖动只算 degraded，不打扰人；一次成功即清零并移出报告。
 *
 * 类别覆盖设计 §10.4 的六类：Effect 各类（launch/delivery/relay/reply/
 * reviewReminder）、Source 游标与读取、Eval 的 unavailable、引擎/模型可用性、
 * 项目锁、迁移；未知错误码累计到 `unknownError`。
 *
 * delivery 永久失败已由工单卡片（person/delivery 阶段）呈现，携带工单的项
 * 标记 reflectedOnTicket，不重复计入系统问题汇总。MVP 只读上报：本模块不提供
 * 重试/忽略等处置入口。
 */
import type {
  SuperAgentHealthCategory,
  SuperAgentHealthItem,
  SuperAgentHealthReport,
  SuperAgentHealthStatus,
} from '@/shared/channels/superAgent'
import { superAgentErrorI18nKey } from './errors'

/** 同类连续失败达到该次数才升级 error（沿用原型 effects.ts 的阈值）。 */
export const FAILURES_BEFORE_ERROR = 3

/** 永久投递失败以工单卡片呈现的类别；无工单可归属时才计入系统问题。 */
const REFLECTED_ON_TICKET_CATEGORY = 'effect:delivery'

export interface SuperAgentHealthFailureInput {
  /** 稳定错误码；未知 code 只用于审计展示，文案键由本模块统一回退。 */
  code?: string | null
  /** 关联工单（delivery 永久失败等）。 */
  ticketId?: string | null
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
  report(): SuperAgentHealthReport
  subscribe(listener: SuperAgentHealthListener): () => void
}

interface HealthEntry {
  category: SuperAgentHealthCategory
  consecutiveFailures: number
  code: string | null
  lastFailedAt: string | null
  ticketId: string | null
  reflectedOnTicket: boolean
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
  const entries = new Map<SuperAgentHealthCategory, HealthEntry>()
  const listeners = new Set<SuperAgentHealthListener>()

  function itemOf(entry: HealthEntry): SuperAgentHealthItem {
    return {
      category: entry.category,
      status: statusOf(entry.consecutiveFailures, threshold),
      consecutiveFailures: entry.consecutiveFailures,
      code: entry.code,
      codeI18nKey: entry.code === null ? 'superAgent.errors.unknown' : superAgentErrorI18nKey(entry.code),
      lastFailedAt: entry.lastFailedAt,
      ticketId: entry.ticketId,
      reflectedOnTicket: entry.reflectedOnTicket,
    }
  }

  function buildReport(): SuperAgentHealthReport {
    const items = [...entries.values()]
      .filter((entry) => entry.consecutiveFailures > 0)
      .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0))
      .map(itemOf)
    let problemCount = 0
    let degradedCount = 0
    for (const item of items) {
      if (item.reflectedOnTicket) continue
      if (item.status === 'error') problemCount += 1
      else degradedCount += 1
    }
    return { repoRoot, problemCount, degradedCount, items, updatedAt: now().toISOString() }
  }

  function notify(): void {
    const report = buildReport()
    for (const listener of listeners) listener(report)
  }

  return {
    recordSuccess(category) {
      if (!entries.has(category)) return
      entries.delete(category)
      notify()
    },

    recordFailure(category, input = {}) {
      const at = input.at ?? now().toISOString()
      const ticketId = input.ticketId ?? null
      const entry = entries.get(category) ?? {
        category,
        consecutiveFailures: 0,
        code: null,
        lastFailedAt: null,
        ticketId: null,
        reflectedOnTicket: false,
      }
      entry.consecutiveFailures += 1
      entry.code = input.code ?? null
      entry.lastFailedAt = at
      entry.ticketId = ticketId
      entry.reflectedOnTicket = category === REFLECTED_ON_TICKET_CATEGORY && ticketId !== null
      entries.set(category, entry)
      notify()
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
