// @vitest-environment node
/**
 * Super Agent 主进程服务契约（T01 #71、T13 #83、T05 #75）：
 *  - state 在没有 bind 时返回空快照，但必须带 seq/asOf/staleAfterMs 水位；
 *  - routerBind 每个项目只建一次会话，重复调用返回同一 sessionId 且不递增 seq；
 *  - 不同 repoRoot 的 Router 会话互不串扰；
 *  - health：每项目独立 tracker、3 次阈值、变化回调 onHealthChanged；
 *  - noteError：未知 code 计入健康（unknownError），已知 code 不计；
 *  - dispatch（T05）：幂等键透传、审计链四件套（ticket/assignment/decision/mandate）、
 *    无 Executor 时工单保持排队；queue 返回带 maxWorkers 的可见队列；
 *    队列变化经 onQueueChanged 广播。
 */
import { describe, it, expect, vi } from 'vitest'
import { createSuperAgentService } from '../service'
import { superAgentError } from '../errors'
import { superAgentWorkerEngineSessionId } from '../sessionId'

describe('createSuperAgentService', () => {
  it('returns an empty snapshot with a seq watermark before any bind', () => {
    const service = createSuperAgentService()

    const snapshot = service.state('/repo/a')

    expect(snapshot.repoRoot).toBe('/repo/a')
    expect(snapshot.seq).toBe(0)
    expect(snapshot.router).toBeNull()
    expect(snapshot.attention).toEqual({ unanswered: 0 })
    expect(snapshot.asOf).toBeTypeOf('number')
    expect(snapshot.staleAfterMs).toBeGreaterThan(0)
  })

  it('binds the router once and reuses the same session on repeated binds', () => {
    const service = createSuperAgentService()

    const first = service.routerBind('/repo/a')
    const second = service.routerBind('/repo/a')

    expect(first.sessionId).toBeTruthy()
    expect(first.running).toBe(false)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.snapshot.seq).toBe(first.snapshot.seq)
    expect(second.snapshot.router).toEqual({ sessionId: first.sessionId, running: false })
  })

  it('reports the bound router in later state queries', () => {
    const service = createSuperAgentService()
    expect(service.state('/repo/a').seq).toBe(0)

    const bound = service.routerBind('/repo/a')

    expect(bound.snapshot.seq).toBe(1)
    expect(service.state('/repo/a')).toMatchObject({
      seq: bound.snapshot.seq,
      router: { sessionId: bound.sessionId, running: false },
    })
  })

  it('keeps router bindings isolated per repo root', () => {
    const service = createSuperAgentService()

    const a = service.routerBind('/repo/a')
    const b = service.routerBind('/repo/b')

    expect(a.sessionId).not.toBe(b.sessionId)
    expect(service.state('/repo/a').router?.sessionId).toBe(a.sessionId)
    expect(service.state('/repo/b').router?.sessionId).toBe(b.sessionId)
  })
})

describe('createSuperAgentService health', () => {
  it('returns an empty health report before any failure', () => {
    const service = createSuperAgentService()

    const report = service.health('/repo/a')

    expect(report.repoRoot).toBe('/repo/a')
    expect(report.items).toEqual([])
    expect(report.problemCount).toBe(0)
  })

  it('escalates a category to error only after three consecutive failures', () => {
    const service = createSuperAgentService()

    service.recordHealthFailure('/repo/a', 'engine')
    service.recordHealthFailure('/repo/a', 'engine')
    expect(service.health('/repo/a').problemCount).toBe(0)

    service.recordHealthFailure('/repo/a', 'engine')
    const report = service.health('/repo/a')
    expect(report.problemCount).toBe(1)
    expect(report.items[0].status).toBe('error')
  })

  it('clears a category on recordHealthSuccess', () => {
    const service = createSuperAgentService()

    service.recordHealthFailure('/repo/a', 'source')
    service.recordHealthSuccess('/repo/a', 'source')

    expect(service.health('/repo/a').items).toEqual([])
  })

  it('keeps health isolated per repo root', () => {
    const service = createSuperAgentService()

    service.recordHealthFailure('/repo/a', 'engine')

    expect(service.health('/repo/a').items).toHaveLength(1)
    expect(service.health('/repo/b').items).toHaveLength(0)
  })

  it('notifies onHealthChanged with the repoRoot and report', () => {
    const onHealthChanged = vi.fn()
    const service = createSuperAgentService({ onHealthChanged })

    service.recordHealthFailure('/repo/a', 'engine')

    expect(onHealthChanged).toHaveBeenCalledTimes(1)
    const [repoRoot, report] = onHealthChanged.mock.calls[0]
    expect(repoRoot).toBe('/repo/a')
    expect(report.repoRoot).toBe('/repo/a')
    expect(report.problemCount).toBe(0)
  })

  it('notifies again when a problem escalates', () => {
    const onHealthChanged = vi.fn()
    const service = createSuperAgentService({ onHealthChanged })

    service.recordHealthFailure('/repo/a', 'engine')
    service.recordHealthFailure('/repo/a', 'engine')
    service.recordHealthFailure('/repo/a', 'engine')

    const [, escalated] = onHealthChanged.mock.calls[2]
    expect(escalated.problemCount).toBe(1)
  })
})

describe('createSuperAgentService noteError', () => {
  it('returns the stable payload for a known domain error without touching health', () => {
    const onHealthChanged = vi.fn()
    const service = createSuperAgentService({ onHealthChanged })

    const payload = service.noteError('/repo/a', superAgentError('ticketEnded', { ticketId: 'ticket-1' }))

    expect(payload.known).toBe(true)
    expect(payload.code).toBe('ticketEnded')
    expect(onHealthChanged).not.toHaveBeenCalled()
    expect(service.health('/repo/a').items).toEqual([])
  })

  it('counts an unknown error code into health under unknownError', () => {
    const service = createSuperAgentService()

    const payload = service.noteError(
      '/repo/a',
      Object.assign(new Error('boom'), { code: 'someFutureCode' }),
    )

    expect(payload.known).toBe(false)
    const report = service.health('/repo/a')
    expect(report.items[0].category).toBe('unknownError')
    expect(report.items[0].code).toBe('someFutureCode')
    expect(report.items[0].codeI18nKey).toBe('superAgent.errors.unknown')
  })

  it('escapes raw exception messages through the generic payload', () => {
    const service = createSuperAgentService()

    const payload = service.noteError('/repo/a', new Error('english detail'))

    expect(payload.i18nKey).toBe('superAgent.errors.unknown')
    expect(JSON.stringify(payload)).not.toContain('english detail')
  })
})

describe('createSuperAgentService dispatch & queue（T05 #75）', () => {
  it('dispatch returns the audit chain ids and keeps the ticket queued without an executor', () => {
    const service = createSuperAgentService()

    const result = service.dispatch('/repo/a', {
      requestId: 'dispatch-1',
      title: '修复登录',
      text: '登录按钮点击后无响应',
    })

    expect(result.duplicate).toBe(false)
    expect(result.queuePosition).toBe(1)
    expect(result.ticketId).not.toBe('')
    expect(result.assignmentId).not.toBe('')
    expect(result.decisionId).not.toBe('')
    expect(result.mandateId).not.toBe('')

    // Executor 未接入（launcher 为 null）：工单保持排队，队列可见
    const queue = service.queue('/repo/a')
    expect(queue.maxWorkers).toBe(1)
    expect(queue.running).toEqual([])
    expect(queue.queued).toEqual([
      expect.objectContaining({ ticketId: result.ticketId, title: '修复登录', position: 1 }),
    ])
  })

  it('dispatch is idempotent on the same requestId and queues later tickets FIFO', () => {
    const service = createSuperAgentService()
    const command = { requestId: 'dispatch-1', title: '修复登录', text: '目标' }

    const first = service.dispatch('/repo/a', command)
    const duplicate = service.dispatch('/repo/a', command)
    const second = service.dispatch('/repo/a', {
      requestId: 'dispatch-2',
      title: '优化构建',
      text: '目标',
    })

    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.ticketId).toBe(first.ticketId)
    expect(second.duplicate).toBe(false)
    expect(second.queuePosition).toBe(2)

    const queue = service.queue('/repo/a')
    expect(queue.queued.map((entry) => entry.title)).toEqual(['修复登录', '优化构建'])
    expect(queue.queued.map((entry) => entry.position)).toEqual([1, 2])
  })

  it('rejects a conflicting payload on the same requestId with the stable conflict code', () => {
    const service = createSuperAgentService()

    service.dispatch('/repo/a', { requestId: 'dispatch-1', title: '修复登录', text: '目标' })
    expect(() =>
      service.dispatch('/repo/a', { requestId: 'dispatch-1', title: '改标题', text: '目标' }),
    ).toThrowError(expect.objectContaining({ code: 'conflict' }))
  })

  it('keeps dispatch state isolated per repo root', () => {
    const service = createSuperAgentService()

    const a = service.dispatch('/repo/a', { requestId: 'd1', title: '工单A', text: '目标' })
    service.dispatch('/repo/b', { requestId: 'd1', title: '工单B', text: '目标' })

    const queueA = service.queue('/repo/a')
    const queueB = service.queue('/repo/b')
    expect(queueA.queued.map((entry) => entry.title)).toEqual(['工单A'])
    expect(queueB.queued.map((entry) => entry.title)).toEqual(['工单B'])
    expect(a.ticketId).not.toBe(queueB.queued[0].ticketId)
  })

  it('notifies onQueueChanged with the repoRoot and snapshot on dispatch', () => {
    const onQueueChanged = vi.fn()
    const service = createSuperAgentService({ onQueueChanged })

    service.dispatch('/repo/a', { requestId: 'd1', title: '修复登录', text: '目标' })

    expect(onQueueChanged).toHaveBeenCalled()
    const calls = onQueueChanged.mock.calls
    const [repoRoot, snapshot] = calls[calls.length - 1] as [string, { repoRoot: string }]
    expect(repoRoot).toBe('/repo/a')
    expect(snapshot.repoRoot).toBe('/repo/a')
  })
})

describe('createSuperAgentService worker mirror（T07 #77）', () => {
  function dispatchTicket(service: ReturnType<typeof createSuperAgentService>, title: string) {
    return service.dispatch('/repo/a', { requestId: `req-${title}`, title, text: '目标' })
  }

  it('returns a readonly mirror with the derived stable session id and one pending segment', () => {
    const service = createSuperAgentService()
    const dispatched = dispatchTicket(service, '修复登录')

    const mirror = service.workerBind('/repo/a', dispatched.ticketId)

    expect(mirror.ticketId).toBe(dispatched.ticketId)
    expect(mirror.title).toBe('修复登录')
    // 引擎会话 id：由 ticketId 稳定派生的 UUID（CLI 只认 UUID，可读标签会被拒），
    // 跨 Assignment、重试与重启都不变。
    expect(mirror.sessionId).toBe(superAgentWorkerEngineSessionId(dispatched.ticketId))
    expect(mirror.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(service.workerBind('/repo/a', dispatched.ticketId).sessionId).toBe(mirror.sessionId)
    expect(mirror.running).toBe(false)
    // Executor 未接入：Assignment 保持 pending，代次 1；Report 留给 T06
    expect(mirror.segments).toHaveLength(1)
    expect(mirror.segments[0]).toMatchObject({
      assignmentId: dispatched.assignmentId,
      generation: 1,
      state: 'pending',
      endedReason: null,
      reportKind: null,
      reportSummary: null,
    })
  })

  it('rebinds return the same mirror: session id never drifts across generations', () => {
    const service = createSuperAgentService()
    const dispatched = dispatchTicket(service, '修复登录')

    const first = service.workerBind('/repo/a', dispatched.ticketId)
    const second = service.workerBind('/repo/a', dispatched.ticketId)

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.segments).toEqual(first.segments)
  })

  it('rejects binding an unknown ticket with the stable ticketNotFound code', () => {
    const service = createSuperAgentService()

    expect(() => service.workerBind('/repo/a', 'ticket-missing')).toThrowError(
      expect.objectContaining({ code: 'ticketNotFound' }),
    )
  })

  it('unbind only stops the mirror: rebinding afterwards returns the same snapshot', () => {
    const service = createSuperAgentService()
    const dispatched = dispatchTicket(service, '修复登录')
    const before = service.workerBind('/repo/a', dispatched.ticketId)

    expect(service.workerUnbind('/repo/a', dispatched.ticketId)).toBe(true)
    // 幂等：未绑定的 unbind 不抛错
    expect(service.workerUnbind('/repo/a', dispatched.ticketId)).toBe(true)

    const after = service.workerBind('/repo/a', dispatched.ticketId)
    expect(after).toEqual(before)
  })

  it('keeps worker mirrors isolated per repo root', () => {
    const service = createSuperAgentService()
    const a = service.dispatch('/repo/a', { requestId: 'd1', title: '工单A', text: '目标' })
    service.dispatch('/repo/b', { requestId: 'd2', title: '工单B', text: '目标' })

    const mirrorA = service.workerBind('/repo/a', a.ticketId)
    const queueB = service.queue('/repo/b')

    expect(mirrorA.title).toBe('工单A')
    expect(queueB.queued[0].ticketId).not.toBe(mirrorA.ticketId)
    expect(() => service.workerBind('/repo/b', mirrorA.ticketId)).toThrowError(
      expect.objectContaining({ code: 'ticketNotFound' }),
    )
  })
})
