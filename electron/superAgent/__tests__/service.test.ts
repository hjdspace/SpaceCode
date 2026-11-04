// @vitest-environment node
/**
 * Super Agent 主进程服务契约（T01 #71、T13 #83）：
 *  - state 在没有 bind 时返回空快照，但必须带 seq/asOf/staleAfterMs 水位；
 *  - routerBind 每个项目只建一次会话，重复调用返回同一 sessionId 且不递增 seq；
 *  - 不同 repoRoot 的 Router 会话互不串扰；
 *  - health：每项目独立 tracker、3 次阈值、变化回调 onHealthChanged；
 *  - noteError：未知 code 计入健康（unknownError），已知 code 不计。
 */
import { describe, it, expect, vi } from 'vitest'
import { createSuperAgentService } from '../service'
import { superAgentError } from '../errors'

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
