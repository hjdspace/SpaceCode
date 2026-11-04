/**
 * reviewReminder 持久化 scheduled effect（T10 #80，设计 §9.2）。
 *
 * 进入 person/review 的工单按 `hours`（项目级配置接缝；默认取
 * `DEFAULT_REVIEW_REMINDER_HOURS` = 提案 24 小时，待产品最终确认 ——
 * 本文件是默认值的唯一出处，不散落魔法数）排期；首次到点提醒一次，之后每
 * `REVIEW_REMINDER_REPEAT_HOURS`（24 小时）最多一次。每次外发把
 * `reviewRemindedAt` 写回领域状态（持久水位）：重启后 sweep 按 report.at 与
 * reviewRemindedAt 重建排期 —— 不重复补发、不重置为「从未提醒」；长时间无人
 * 验收只补一次提醒，不按错过次数风暴补发。
 *
 * 离开 review（验收 / 停止 / 继续追问）的工单自然不再被扫描；超时只提醒：
 * 不改变阶段、不自动 accept、不降级。提醒的外发渠道由 `onRemind` 注入
 * （当前为应用内气泡 + 徽章；后续 Outbox 接管多渠道）。
 */
import type { SuperAgentDomain } from './domain'
import { latestAssignmentOf } from './stage'

/** 首次提醒间隔（小时）。提案默认 24，待产品最终确认。 */
export const DEFAULT_REVIEW_REMINDER_HOURS = 24
/** 首次提醒后的重复间隔（小时）：之后每日最多一次。 */
export const REVIEW_REMINDER_REPEAT_HOURS = 24

export interface SuperAgentReviewReminderOptions {
  domain: SuperAgentDomain
  /** 首次提醒间隔（小时）；项目级配置接缝，缺省 24。 */
  hours?: number
  /** 外发提醒回调：写入水位后调用，service 在此驱动气泡/徽章投影。 */
  onRemind: (ticketId: string, at: string) => void
  now?: () => Date
  /** 周期扫描间隔；缺省 60 秒。 */
  sweepIntervalMs?: number
  /** 单次定时接缝（测试注入用）；缺省 setTimeout。 */
  schedule?: (fn: () => void, ms: number) => () => void
}

export interface SuperAgentReviewReminder {
  /** 扫描并外发到期待验收工单的提醒；返回本次外发数。 */
  sweep(): number
  /** 启动周期扫描：含一次即时扫描（重启重建语义：到期的只补一条）。 */
  start(): void
  stop(): void
}

const HOUR_MS = 3_600_000
const DEFAULT_SWEEP_INTERVAL_MS = 60_000

export function createSuperAgentReviewReminder(
  options: SuperAgentReviewReminderOptions,
): SuperAgentReviewReminder {
  const {
    domain,
    hours = DEFAULT_REVIEW_REMINDER_HOURS,
    onRemind,
    now = () => new Date(),
    sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
    schedule = (fn, ms) => {
      const timer = setTimeout(fn, ms)
      // 不阻塞进程退出（测试/应用关停时无需手动清理定时器）
      ;(timer as unknown as { unref?: () => void }).unref?.()
      return () => clearTimeout(timer)
    },
  } = options
  const firstDelayMs = hours * HOUR_MS
  const repeatDelayMs = REVIEW_REMINDER_REPEAT_HOURS * HOUR_MS

  function dueAtOf(ticketId: string): number | null {
    const ticket = domain.state.tickets[ticketId]
    if (!ticket || ticket.state !== 'open') return null
    if (domain.stageOf(ticketId) !== 'person/review') return null
    const latest = latestAssignmentOf(ticket.assignmentIds.map((id) => domain.state.assignments[id]))
    const report = latest?.report ?? null
    if (!report || report.kind !== 'ready') return null
    const base = ticket.reviewRemindedAt ?? report.at
    const delay = ticket.reviewRemindedAt === null ? firstDelayMs : repeatDelayMs
    return Date.parse(base) + delay
  }

  function sweep(): number {
    const nowMs = now().getTime()
    let fired = 0
    for (const ticketId of Object.keys(domain.state.tickets)) {
      const dueAt = dueAtOf(ticketId)
      if (dueAt === null || nowMs < dueAt) continue
      try {
        domain.markReviewReminded({ ticketId, at: new Date(nowMs).toISOString() })
      } catch {
        // 扫描与命令并发时工单可能刚好离开 review：跳过即可，水位不倒退。
        continue
      }
      onRemind(ticketId, new Date(nowMs).toISOString())
      fired += 1
    }
    return fired
  }

  let cancel: (() => void) | null = null

  function stop(): void {
    cancel?.()
    cancel = null
  }

  function start(): void {
    stop()
    // 重启重建：启动先扫一次，到期的只补一条（水位推进到当下）。
    sweep()
    const tick = (): void => {
      sweep()
      cancel = schedule(tick, sweepIntervalMs)
    }
    cancel = schedule(tick, sweepIntervalMs)
  }

  return { sweep, start, stop }
}
