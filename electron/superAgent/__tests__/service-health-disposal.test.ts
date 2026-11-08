// @vitest-environment node
/**
 * 健康与 Eval 处置命令的 Service 编排（T20 #90）。
 *
 * 覆盖验收：
 *  - health() 把领域里未处置的 unavailable Eval 对账为 eval 主体健康项；
 *  - evalReevaluate：Trigger 回队 + 健康项解除 + reevaluated 审计；
 *  - problemDismiss：eval 主体同时释放领域 Eval（忽略后不再提示），
 *    系统级问题隐藏直到恢复；
 *  - healthRetry：清零计数 + retry 审计，返回最新报告（状态回显）；
 *  - 24 小时处置窗口：过期自动释放（dismiss 审计），重新评估被拒绝；
 *  - 处置不影响 Thread 串行推进（忽略/重评后 Thread 可开新一轮评估）。
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSuperAgentService } from '../service'
import { createSuperAgentDomain } from '../domain'
import { openProjectStore } from '../store'
import type { SuperAgentDomainState } from '../model'

const TTL_MS = 60_000
const T0 = '2026-01-01T00:00:00.000Z'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/** store.openProjectStore 会对 repoRoot 做 realpath，测试用真实临时目录。 */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function at(ms: number): string {
  return new Date(Date.parse(T0) + ms).toISOString()
}

/** 构造一个带 unavailable Eval 的领域快照（走满 3 次连续超时）。 */
function seedUnavailableState(): { state: SuperAgentDomainState; evalId: string; triggerId: string } {
  let counter = 0
  const domain = createSuperAgentDomain({
    now: () => new Date(T0),
    newId: (kind: string) => `${kind}-${++counter}`,
    evalTtlMs: TTL_MS,
  })
  domain.setPolicy({
    acceptMode: 'observe',
    rules: [],
    admissions: [
      { source: 'feishu-im', channels: [], allowlist: [], bots: [] },
    ],
  })
  const { triggerId } = domain.intakeTrigger({
    key: 'e1',
    source: 'feishu-im',
    threadIds: ['th1'],
    actor: 'feishu:user:u1',
    human: true,
    addressed: 'mention',
    text: '消息 e1',
  }).trigger
  let evalId = ''
  for (let round = 0; round < 3; round++) {
    const started = domain.startEval({ threadId: 'th1', at: at(round * TTL_MS) })
    evalId = started.evalId
    domain.deliverEval({ evalId, at: at(round * TTL_MS) })
    domain.expireEval({ evalId, at: at((round + 1) * TTL_MS) })
  }
  expect(domain.state.evals[evalId].state).toBe('unavailable')
  return { state: JSON.parse(JSON.stringify(domain.state)) as SuperAgentDomainState, evalId, triggerId }
}

/**
 * 用持久化 Store 种出 unavailable Eval，再经 userDataDir 打开 Service ——
 * 与生产路径同一重水化链路（openPersistedSuperAgentProject）。
 */
function makeHarness(clock: () => Date, state: SuperAgentDomainState): {
  service: ReturnType<typeof createSuperAgentService>
  repoRoot: string
} {
  const userDataDir = tempDir('superagent-t20-data-')
  const repoRoot = tempDir('superagent-t20-repo-')
  const store = openProjectStore<SuperAgentDomainState>({
    userDataDir,
    repoRoot,
    initialState: createSuperAgentDomain().state,
    reduce: (prev, tx) =>
      Array.isArray(tx.events) ? (tx.events[0] as SuperAgentDomainState) : prev,
  })
  store.commit({ events: [state] })
  store.close()
  const service = createSuperAgentService({ userDataDir, now: clock })
  return { service, repoRoot }
}

describe('service 健康与 Eval 处置（T20 #90）', () => {
  it('health() surfaces an undisposed unavailable eval as an eval subject problem', () => {
    const seed = seedUnavailableState()
    const h = makeHarness(() => new Date(T0), seed.state)

    const report = h.service.health(h.repoRoot)

    const item = report.items.find((entry) => entry.category === 'eval')
    expect(item).toMatchObject({
      subjectId: seed.evalId,
      status: 'error',
      code: 'evalUnavailable',
    })
    expect(report.problemCount).toBe(1)
  })

  it('evalReevaluate requeues triggers, clears the health item and audits the disposal', () => {
    const seed = seedUnavailableState()
    const h = makeHarness(() => new Date(T0), seed.state)

    const result = h.service.evalReevaluate(h.repoRoot, { evalId: seed.evalId })

    expect(result.evalId).toBe(seed.evalId)
    expect(result.requeuedTriggerIds).toEqual([seed.triggerId])
    const report = h.service.health(h.repoRoot)
    expect(report.items).toEqual([])
    expect(report.problemCount).toBe(0)
    expect(report.dispositions).toEqual([
      { category: 'eval', subjectId: seed.evalId, action: 'reevaluated', at: T0 },
    ])
  })

  it('problemDismiss on an eval subject releases the domain eval and stops prompting', () => {
    const seed = seedUnavailableState()
    const h = makeHarness(() => new Date(T0), seed.state)
    expect(h.service.health(h.repoRoot).items).toHaveLength(1)

    const report = h.service.problemDismiss(h.repoRoot, { category: 'eval', subjectId: seed.evalId })

    expect(report.items).toEqual([])
    expect(report.dispositions).toEqual([
      { category: 'eval', subjectId: seed.evalId, action: 'dismiss', at: T0 },
    ])
    // 忽略后不再重复提示：领域已释放，后续 health() 不再上报。
    expect(h.service.health(h.repoRoot).items).toEqual([])
  })

  it('problemDismiss on a system category hides it until recovery re-arms prompting', () => {
    const seed = seedUnavailableState()
    const h = makeHarness(() => new Date(T0), seed.state)
    for (let i = 0; i < 3; i++) {
      h.service.recordHealthFailure(h.repoRoot, 'engine', { code: 'slotUnavailable' })
    }
    expect(h.service.health(h.repoRoot).problemCount).toBe(2) // eval 主体 + engine

    const report = h.service.problemDismiss(h.repoRoot, { category: 'engine' })

    expect(report.items.map((item) => item.category)).toEqual(['eval'])
    // 失败仍在继续也不重新提示（忽略后不再重复提示）。
    h.service.recordHealthFailure(h.repoRoot, 'engine', { code: 'slotUnavailable' })
    expect(h.service.health(h.repoRoot).items.map((item) => item.category)).toEqual(['eval'])
    // 恢复后重新武装。
    h.service.recordHealthSuccess(h.repoRoot, 'engine')
    h.service.recordHealthFailure(h.repoRoot, 'engine', { code: 'slotUnavailable' })
    const revived = h.service.health(h.repoRoot).items.find((item) => item.category === 'engine')
    expect(revived?.status).toBe('degraded')
  })

  it('healthRetry resets the streak, audits and echoes the latest report', () => {
    const seed = seedUnavailableState()
    const h = makeHarness(() => new Date(T0), seed.state)
    for (let i = 0; i < 3; i++) {
      h.service.recordHealthFailure(h.repoRoot, 'engine', { code: 'slotUnavailable' })
    }

    const report = h.service.healthRetry(h.repoRoot, { category: 'engine' })

    expect(report.items.map((item) => item.category)).toEqual(['eval'])
    expect(report.dispositions).toEqual([
      { category: 'engine', subjectId: null, action: 'retry', at: T0 },
    ])
    h.service.recordHealthFailure(h.repoRoot, 'engine', { code: 'slotUnavailable' })
    expect(
      h.service.health(h.repoRoot).items.find((item) => item.category === 'engine')?.status,
    ).toBe('degraded')
  })

  it('auto-releases an unavailable eval past the 24-hour window and refuses reevaluation', () => {
    const seed = seedUnavailableState()
    const unavailableAt = Date.parse(T0) + 3 * TTL_MS
    const beyondWindow = () => new Date(unavailableAt + 24 * 60 * 60 * 1000 + 1)
    const h = makeHarness(beyondWindow, seed.state)

    const report = h.service.health(h.repoRoot)

    expect(report.items).toEqual([])
    expect(report.dispositions).toEqual([
      {
        category: 'eval',
        subjectId: seed.evalId,
        action: 'dismiss',
        at: beyondWindow().toISOString(),
      },
    ])
    expect(() => h.service.evalReevaluate(h.repoRoot, { evalId: seed.evalId })).toThrowError(
      expect.objectContaining({ code: 'evalNotUnavailable' }),
    )
  })

  it('refuses reevaluation of unknown or already-disposed evals with stable codes', () => {
    const seed = seedUnavailableState()
    const h = makeHarness(() => new Date(T0), seed.state)

    expect(() => h.service.evalReevaluate(h.repoRoot, { evalId: 'missing' })).toThrowError(
      expect.objectContaining({ code: 'evalNotFound' }),
    )
    h.service.evalReevaluate(h.repoRoot, { evalId: seed.evalId })
    expect(() => h.service.evalReevaluate(h.repoRoot, { evalId: seed.evalId })).toThrowError(
      expect.objectContaining({ code: 'evalNotUnavailable' }),
    )
  })
})
