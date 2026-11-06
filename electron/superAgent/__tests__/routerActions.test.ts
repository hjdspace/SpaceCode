// @vitest-environment node
/**
 * Router 路由协议的严格解析（T21）。
 *
 * 与 Worker 的 Report 协议同一取向：只认带 info string 的围栏块，不解析自由
 * 文本里的 JSON；没有块是正常路径（纯闲聊），多个块是矛盾指令必须拒绝，
 * 字段越界/未知字段一律按协议失败，不猜意图。
 *
 * 协议形状是 `routes[]`（accept/attach/stop/ignore）而不是建单清单：工单目标
 * 由宿主带上人的原话，Router 只能给标题与 ≤30 字的路由说明。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_ROUTE_NOTE_CHARS,
  MAX_ROUTER_ROUTES,
  findSuperAgentRouteBlocks,
  parseSuperAgentRouteText,
} from '../routerActions'
import { isSuperAgentDomainError } from '../errors'

function fence(payload: unknown): string {
  return ['```super-agent:route', JSON.stringify(payload), '```'].join('\n')
}

describe('parseSuperAgentRouteText', () => {
  it('returns no routes for an ordinary reply', () => {
    expect(parseSuperAgentRouteText('你好，需要我做什么？')).toEqual({ routes: [], raw: null })
  })

  it('reads every kind and trims the fields', () => {
    const parsed = parseSuperAgentRouteText(
      `已安排。\n\n${fence({
        version: 2,
        routes: [
          { kind: ' accept ', title: ' 收口校验 ', note: ' 人点名了 validateField ' },
          { kind: 'attach', ticketId: ' ticket-1 ', note: '同一条追问' },
          { kind: 'stop', ticketId: 'ticket-2' },
          { kind: 'ignore', reason: '普通讨论' },
        ],
      })}`,
    )
    expect(parsed.routes).toEqual([
      { kind: 'accept', title: '收口校验', note: '人点名了 validateField' },
      { kind: 'attach', ticketId: 'ticket-1', note: '同一条追问' },
      { kind: 'stop', ticketId: 'ticket-2', note: null },
      { kind: 'ignore', reason: '普通讨论' },
    ])
    expect(parsed.raw).toContain('收口校验')
  })

  it('carries the external source triggerId on attach and rejects a blank one', () => {
    expect(
      parseSuperAgentRouteText(
        fence({ version: 2, routes: [{ kind: 'attach', ticketId: 'ticket-1', triggerId: ' trigger-9 ' }] }),
      ).routes,
    ).toEqual([{ kind: 'attach', ticketId: 'ticket-1', note: null, triggerId: 'trigger-9' }])

    expect(() =>
      parseSuperAgentRouteText(
        fence({ version: 2, routes: [{ kind: 'attach', ticketId: 'ticket-1', triggerId: '  ' }] }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'routeInvalid' }))
  })

  it('omits the note when the router gives none', () => {
    expect(parseSuperAgentRouteText(fence({ version: 2, routes: [{ kind: 'accept', title: 'a' }] })))
      .toMatchObject({ routes: [{ kind: 'accept', title: 'a', note: null }] })
  })

  it('rejects more than one block instead of choosing one', () => {
    const text = `${fence({ version: 2, routes: [{ kind: 'accept', title: 'a' }] })}\n\n${fence({
      version: 2,
      routes: [{ kind: 'accept', title: 'c' }],
    })}`
    const err = (() => {
      try {
        parseSuperAgentRouteText(text)
        return null
      } catch (caught) {
        return caught
      }
    })()
    expect(isSuperAgentDomainError(err)).toBe(true)
    expect((err as { code: string }).code).toBe('routeNotUnique')
  })

  it('rejects unparsable JSON, a stale version and unknown fields', () => {
    const codes = [
      'routeUnparsable',
      'routeInvalid',
      'routeInvalid',
      'routeInvalid',
      'routeInvalid',
      'routeInvalid',
    ]
    const payloads: string[] = [
      '```super-agent:route\n{not json}\n```',
      // version 1 的建单清单：目标写在 text 里，正是这次收掉的转述通道
      '```super-agent:route\n{"version":1,"tickets":[{"title":"a","text":"b"}]}\n```',
      '```super-agent:route\n{"version":2,"routes":[]}\n```',
      '```super-agent:route\n{"version":2,"routes":[{"kind":"accept"}]}\n```',
      '```super-agent:route\n{"version":2,"routes":[{"kind":"accept","title":"a","text":"b"}]}\n```',
      '```super-agent:route\n{"version":2,"routes":[{"kind":"accept","title":"a"}],"extra":1}\n```',
    ]
    payloads.forEach((raw, index) => {
      expect(() => parseSuperAgentRouteText(raw)).toThrowError()
      try {
        parseSuperAgentRouteText(raw)
      } catch (caught) {
        expect((caught as { code: string }).code).toBe(codes[index])
      }
    })
  })

  it('rejects a kind that is unknown or mismatched with its fields', () => {
    const payloads = [
      { version: 2, routes: [{ kind: 'reopen', ticketId: 'ticket-1' }] },
      // attach/stop 没有工单号就无处可去；accept 的标题不能空
      { version: 2, routes: [{ kind: 'attach', note: '顺手挂上' }] },
      { version: 2, routes: [{ kind: 'stop' }] },
      { version: 2, routes: [{ kind: 'accept', title: '  ' }] },
    ]
    payloads.forEach((payload) => {
      expect(() => parseSuperAgentRouteText(fence(payload))).toThrowError()
    })
  })

  it('refuses a note long enough to carry an implementation plan', () => {
    const note = 'x'.repeat(MAX_ROUTE_NOTE_CHARS + 1)
    const err = (() => {
      try {
        parseSuperAgentRouteText(fence({ version: 2, routes: [{ kind: 'accept', title: 'a', note }] }))
        return null
      } catch (caught) {
        return caught
      }
    })()
    expect((err as { code: string; params?: Record<string, string> }).code).toBe('routeInvalid')
    expect((err as { params: Record<string, string> }).params?.field).toContain('note')
  })

  it('rejects more routes than the cap allows', () => {
    const routes = Array.from({ length: MAX_ROUTER_ROUTES + 1 }, (_, i) => ({
      kind: 'accept',
      title: `t${i}`,
    }))
    expect(() => parseSuperAgentRouteText(fence({ version: 2, routes }))).toThrowError()
  })

  it('finds every block for auditing without validating them', () => {
    expect(findSuperAgentRouteBlocks('no block here')).toEqual([])
    expect(findSuperAgentRouteBlocks(fence({ version: 2, routes: [] }))).toHaveLength(1)
  })
})
