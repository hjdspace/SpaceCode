// @vitest-environment node
/**
 * 健康模型契约（T13 #83）：
 *  - 健康项覆盖设计要求的六类（Effect 各类 / Source / Eval / 引擎 / 项目锁 / 迁移）；
 *  - 同类连续失败 3 次才升级 error，单次抖动只算 degraded，成功即清零；
 *  - delivery 永久失败携带工单时已反映在工单卡片，不重复计入系统问题汇总；
 *  - 未知错误码回退通用文案键并计入健康（unknownError 类别）；
 *  - 健康变化触发 health.changed 订阅回调。
 */
import { describe, expect, it } from 'vitest'
import { SUPER_AGENT_HEALTH_CATEGORIES } from '@/shared/channels/superAgent'
import {
  FAILURES_BEFORE_ERROR,
  createSuperAgentHealthTracker,
} from '../health'

function failConsecutive(
  tracker: ReturnType<typeof createSuperAgentHealthTracker>,
  category: string,
  times: number,
): void {
  for (let i = 0; i < times; i++) tracker.recordFailure(category)
}

describe('createSuperAgentHealthTracker', () => {
  it('starts with an empty report before any failure', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    const report = tracker.report()

    expect(report.repoRoot).toBe('/repo/a')
    expect(report.items).toEqual([])
    expect(report.problemCount).toBe(0)
    expect(report.degradedCount).toBe(0)
    expect(report.updatedAt).toBeTruthy()
  })

  it('supports every category required by the design', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    for (const category of SUPER_AGENT_HEALTH_CATEGORIES) {
      tracker.recordFailure(category)
    }

    const seen = new Set(tracker.report().items.map((item) => item.category))
    for (const category of SUPER_AGENT_HEALTH_CATEGORIES) {
      expect(seen).toContain(category)
    }
  })

  it('escalates to error only after three consecutive failures in the same category', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    tracker.recordFailure('engine')
    expect(tracker.report().items[0].status).toBe('degraded')

    tracker.recordFailure('engine')
    expect(tracker.report().items[0].status).toBe('degraded')

    tracker.recordFailure('engine')
    const item = tracker.report().items[0]
    expect(item.status).toBe('error')
    expect(item.consecutiveFailures).toBe(FAILURES_BEFORE_ERROR)
    expect(tracker.report().problemCount).toBe(1)
  })

  it('resets the failure streak on success so a single jitter never escalates', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    tracker.recordFailure('source')
    tracker.recordFailure('source')
    tracker.recordSuccess('source')
    tracker.recordFailure('source')
    tracker.recordFailure('source')

    const item = tracker.report().items[0]
    expect(item.consecutiveFailures).toBe(2)
    expect(item.status).toBe('degraded')
  })

  it('drops items from the report once they recover', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    tracker.recordFailure('migration')
    tracker.recordSuccess('migration')

    expect(tracker.report().items).toEqual([])
  })

  it('tracks the stable error code with a localized i18n key per failure', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    tracker.recordFailure('engine', { code: 'slotUnavailable' })

    const item = tracker.report().items[0]
    expect(item.code).toBe('slotUnavailable')
    expect(item.codeI18nKey).toBe('superAgent.errors.slotUnavailable')
  })

  it('falls back to the generic i18n key for an unknown error code', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    tracker.recordFailure('engine', { code: 'engineExploded' })

    const item = tracker.report().items[0]
    expect(item.code).toBe('engineExploded')
    expect(item.codeI18nKey).toBe('superAgent.errors.unknown')
  })

  it('keeps failures isolated per category', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    tracker.recordFailure('effect:launch')
    tracker.recordFailure('source')
    tracker.recordFailure('source')

    const items = tracker.report().items
    expect(items.map((item) => item.category).sort()).toEqual(['effect:launch', 'source'])
    const source = items.find((item) => item.category === 'source')
    expect(source?.consecutiveFailures).toBe(2)
  })

  it('does not count a permanent delivery failure in system problems when it has a ticket', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    for (let i = 0; i < FAILURES_BEFORE_ERROR; i++) {
      tracker.recordFailure('effect:delivery', { code: 'assignmentEnded', ticketId: 'ticket-1' })
    }

    const report = tracker.report()
    const item = report.items[0]
    expect(item.status).toBe('error')
    expect(item.ticketId).toBe('ticket-1')
    expect(item.reflectedOnTicket).toBe(true)
    expect(report.problemCount).toBe(0)
  })

  it('still counts a delivery failure without a ticket', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    failConsecutive(tracker, 'effect:delivery', FAILURES_BEFORE_ERROR)

    const report = tracker.report()
    expect(report.items[0].reflectedOnTicket).toBe(false)
    expect(report.problemCount).toBe(1)
  })

  it('excludes reflected delivery items from the degraded summary too', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    tracker.recordFailure('effect:delivery', { ticketId: 'ticket-1' })

    expect(tracker.report().degradedCount).toBe(0)
  })

  it('counts error items with degraded jitters separately in the summary', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })

    failConsecutive(tracker, 'engine', FAILURES_BEFORE_ERROR)
    tracker.recordFailure('source')

    const report = tracker.report()
    expect(report.problemCount).toBe(1)
    expect(report.degradedCount).toBe(1)
  })

  it('notifies subscribers with the project report whenever health changes', () => {
    const reports: { repoRoot: string; problemCount: number }[] = []
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })
    tracker.subscribe((report) => reports.push({ repoRoot: report.repoRoot, problemCount: report.problemCount }))

    tracker.recordFailure('engine')
    tracker.recordSuccess('engine')
    tracker.recordSuccess('engine')

    expect(reports).toEqual([
      { repoRoot: '/repo/a', problemCount: 0 },
      { repoRoot: '/repo/a', problemCount: 0 },
    ])
  })

  it('does not notify when a success touches a healthy category', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a' })
    let calls = 0
    tracker.subscribe(() => {
      calls += 1
    })

    tracker.recordSuccess('engine')

    expect(calls).toBe(0)
  })

  it('honours a custom failure threshold for tests', () => {
    const tracker = createSuperAgentHealthTracker({ repoRoot: '/repo/a', failuresBeforeError: 2 })

    tracker.recordFailure('eval')
    tracker.recordFailure('eval')

    expect(tracker.report().items[0].status).toBe('error')
  })

  it('timestamps the latest failure, preferring the record time over now()', () => {
    const tracker = createSuperAgentHealthTracker({
      repoRoot: '/repo/a',
      now: () => new Date('2026-01-01T00:00:00Z'),
    })

    tracker.recordFailure('source', { at: '2026-01-02T03:04:05Z' })
    tracker.recordFailure('source')

    expect(tracker.report().items[0].lastFailedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
