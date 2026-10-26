/**
 * 卡片动作的白名单与 payload 校验（票 03 第 1、4、6 条）。
 *
 * 这是宿主的信任边界：沙箱是不可信代码，只有这里认下的动作才会被路由到平台适配器。
 * 用例只断言「给一条消息，得到哪个动作或被哪条规则拒绝」，不碰 DOM 与平台 API。
 */
import { describe, it, expect } from 'vitest'
import {
  GENUI_MAX_BRIDGE_MESSAGE_BYTES,
  GENUI_MAX_COPY_BYTES,
  GENUI_MAX_SUBMIT_BYTES,
} from '@/shared/genuiSandbox'
import { parseCardAction } from '../cardActions'

function action(overrides: Record<string, unknown> = {}) {
  return { type: 'genui:action', nonce: 'n', action: 'copy', payload: { text: 'hi' }, ...overrides }
}

describe('白名单动作', () => {
  it('copy 带文本时被接受并规范化成 { action, text }', () => {
    expect(parseCardAction(action())).toEqual({ ok: true, action: { action: 'copy', text: 'hi' } })
  })

  it('expand 不要求 payload', () => {
    expect(parseCardAction(action({ action: 'expand', payload: undefined }))).toEqual({
      ok: true,
      action: { action: 'expand' },
    })
  })

  it('openLink 只把安全的绝对 http(s) URL 交给宿主', () => {
    expect(parseCardAction(action({ action: 'openLink', payload: { url: 'https://example.com/a?b=1' } }))).toEqual({
      ok: true,
      action: { action: 'openLink', url: 'https://example.com/a?b=1' },
    })
    expect(parseCardAction(action({ action: 'openLink', payload: { url: 'http://example.com' } }))).toEqual({
      ok: true,
      action: { action: 'openLink', url: 'http://example.com' },
    })
  })

  it('submit 只保留对象 payload（本条票不定义用户消息格式）', () => {
    expect(parseCardAction(action({ action: 'submit', payload: { name: 'x' } }))).toEqual({
      ok: true,
      action: { action: 'submit', payload: { name: 'x' } },
    })
  })
})

describe('拒绝路径', () => {
  it('非对象消息一律丢弃', () => {
    for (const value of [null, 'copy', 42, true, [], undefined]) {
      expect(parseCardAction(value)).toEqual({ ok: false, reason: 'not-an-object' })
    }
  })

  it('白名单之外的动作被拒绝，且不抛错', () => {
    for (const name of ['shell', 'exec', 'eval', 'submitForm', '']) {
      expect(parseCardAction(action({ action: name }))).toEqual({ ok: false, reason: 'unknown-action' })
    }
  })

  it('copy 缺少文本或文本非字符串时拒绝', () => {
    for (const payload of [undefined, {}, { text: 42 }, { text: null }]) {
      expect(parseCardAction(action({ payload }))).toEqual({ ok: false, reason: 'invalid-payload' })
    }
  })

  it('copy 文本超过 64KB 按超限拒绝', () => {
    const text = 'x'.repeat(GENUI_MAX_COPY_BYTES + 1)
    expect(parseCardAction(action({ payload: { text } }))).toEqual({ ok: false, reason: 'oversized' })
  })

  it('整条桥消息超过 1MB 按超限拒绝', () => {
    const payload = { blob: 'x'.repeat(GENUI_MAX_BRIDGE_MESSAGE_BYTES) }
    expect(parseCardAction(action({ action: 'submit', payload }))).toEqual({ ok: false, reason: 'oversized' })
  })

  it('超限阈值可注入，默认阈值之外的行为不受影响', () => {
    expect(parseCardAction(action(), { maxBytes: 10 })).toEqual({ ok: false, reason: 'oversized' })
    expect(parseCardAction(action(), { maxBytes: 10_000 })).toEqual({
      ok: true,
      action: { action: 'copy', text: 'hi' },
    })
  })

  it('循环引用等不可序列化的 payload 被拒绝而不是抛错', () => {
    const payload: Record<string, unknown> = {}
    payload.self = payload
    expect(parseCardAction(action({ action: 'submit', payload }))).toEqual({
      ok: false,
      reason: 'unserializable',
    })
  })

  it('submit 的 payload 必须是对象', () => {
    for (const payload of [undefined, 'text', 42, []]) {
      expect(parseCardAction(action({ action: 'submit', payload }))).toEqual({
        ok: false,
        reason: 'invalid-payload',
      })
    }
  })

  it('submit payload 超过 64KB 按超限拒绝', () => {
    const payload = { blob: 'x'.repeat(GENUI_MAX_SUBMIT_BYTES) }
    expect(parseCardAction(action({ action: 'submit', payload }))).toEqual({
      ok: false,
      reason: 'oversized',
    })
  })

  it('submit payload 恰好等于 64KB 时仍被放行', () => {
    // 限额算的是 payload 序列化后的整体，`{"blob":""}` 这层壳也要占位；补齐后正好压在限额上
    const shell = JSON.stringify({ blob: '' }).length
    const payload = { blob: 'x'.repeat(GENUI_MAX_SUBMIT_BYTES - shell) }
    expect(parseCardAction(action({ action: 'submit', payload }))).toMatchObject({ ok: true })
  })
})

describe('外链协议闸门', () => {
  it('openLink 的非法协议归到 invalid-payload', () => {
    expect(parseCardAction(action({ action: 'openLink', payload: { url: 'javascript:alert(1)' } }))).toEqual({
      ok: false,
      reason: 'invalid-payload',
    })
    expect(parseCardAction(action({ action: 'openLink', payload: { url: 'file:///etc/passwd' } }))).toEqual({
      ok: false,
      reason: 'invalid-payload',
    })
  })
})
