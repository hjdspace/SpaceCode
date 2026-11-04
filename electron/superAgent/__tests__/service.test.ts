// @vitest-environment node
/**
 * Super Agent 主进程服务契约（T01 #71）：
 *  - state 在没有 bind 时返回空快照，但必须带 seq/asOf/staleAfterMs 水位；
 *  - routerBind 每个项目只建一次会话，重复调用返回同一 sessionId 且不递增 seq；
 *  - 不同 repoRoot 的 Router 会话互不串扰。
 */
import { describe, it, expect } from 'vitest'
import { createSuperAgentService } from '../service'

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
