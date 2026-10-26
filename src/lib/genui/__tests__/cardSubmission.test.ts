/**
 * 卡片提交回环的宿主规则（票 04）。
 *
 * 这里钉住四件宿主侧的事：payload 校验（对象 / 可序列化 / ≤ 64KB）、确定性摘要、
 * 用户消息正文里的完整围栏 JSON、以及「发送失败不写只读状态、重复提交只发一次」。
 * 纯逻辑不碰 DOM 与 Pinia；落库链路的用例在 cardSubmission.runtime.test.ts。
 */
import { describe, it, expect, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { messages } from '@/i18n'
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import type { GenuiCardRecord } from '@/types/genui'
import type { Message } from '@/types'
import {
  GENUI_MAX_SUBMIT_BYTES,
  buildGenuiCardSubmission,
  createGenuiCardSubmissionHost,
  resolveUserMessageDisplay,
  type GenuiSubmissionTurnPort,
} from '../cardSubmission'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages,
})

function translate(locale: 'zh-CN' | 'en-US') {
  i18n.global.locale.value = locale
  return (key: string, params?: Record<string, unknown>) =>
    (i18n.global.t as unknown as (k: string, p?: Record<string, unknown>) => string)(key, params ?? {})
}

function card(overrides: Partial<GenuiCardRecord> = {}): GenuiCardRecord {
  return {
    id: 'm1:card:0',
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    schema: { componentName: 'TinyForm', props: { title: '报名表' } },
    ...overrides,
  }
}

function build(payload: unknown, locale: 'zh-CN' | 'en-US' = 'zh-CN', record = card()) {
  return buildGenuiCardSubmission(record, payload, { translate: translate(locale) })
}

describe('提交内容校验', () => {
  it('非对象 payload 被拒绝', () => {
    for (const payload of [null, undefined, 'text', 42, true, [1, 2]]) {
      expect(build(payload)).toEqual({ ok: false, reason: 'invalid-payload' })
    }
  })

  it('循环引用等不可序列化的 payload 被拒绝而不是抛错', () => {
    const payload: Record<string, unknown> = {}
    payload.self = payload
    expect(build(payload)).toEqual({ ok: false, reason: 'unserializable' })
  })

  it('超过 64KB 的 payload 被拒绝', () => {
    const payload = { blob: 'x'.repeat(GENUI_MAX_SUBMIT_BYTES) }
    expect(build(payload)).toEqual({ ok: false, reason: 'oversized' })
  })

  it('恰好等于 64KB 的 payload 仍被接受', () => {
    // 限额按序列化后的整体算：`{"blob":""}` 这层壳占 11 字节，补齐后正好压在限额上
    const shell = JSON.stringify({ blob: '' }).length
    const payload = { blob: 'x'.repeat(GENUI_MAX_SUBMIT_BYTES - shell) }
    const result = build(payload)
    expect(result.ok).toBe(true)
  })
})

describe('确定性摘要与完整 payload', () => {
  it('摘要包含卡片标识与字段数量，正文追加完整围栏 JSON', () => {
    const payload = { name: '张三', email: 'a@b.c', note: '无' }
    const result = build(payload)
    if (!result.ok) throw new Error(result.reason)

    expect(result.draft.summary).toBe('已提交卡片「报名表」，共 3 个字段')
    expect(result.draft.content.startsWith(result.draft.summary)).toBe(true)
    expect(result.draft.content).toContain('```json')
    expect(result.draft.content).toContain(JSON.stringify(payload, null, 2))
    expect(result.draft.metadata).toEqual({
      cardId: 'm1:card:0',
      summary: result.draft.summary,
      payload,
      collapsed: true,
    })
  })

  it('payload 只有一个数组字段时按条目数计', () => {
    const result = build({ rows: [{}, {}, {}] })
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.summary).toBe('已提交卡片「报名表」，共 3 个条目')
  })

  it('同一输入产生相同摘要（确定性）', () => {
    const payload = { a: 1, b: 2 }
    const again = build({ b: 2, a: 1 })
    const first = build(payload)
    if (!first.ok || !again.ok) throw new Error('build failed')
    expect(again.draft.summary).toBe(first.draft.summary)
  })

  it('摘要随 locale 本地化', () => {
    const result = build({ name: 'x' }, 'en-US')
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.summary).toBe('Submitted card "报名表" with 1 fields')
  })

  it('缺少 props.title 时退回 componentName 作为卡片标识', () => {
    const result = build({ a: 1 }, 'zh-CN', card({ schema: { componentName: 'TinyForm' } }))
    if (!result.ok) throw new Error(result.reason)
    expect(result.draft.summary).toContain('TinyForm')
  })
})

describe('提交回环', () => {
  function assistantMessage(cards: GenuiCardRecord[]): Message {
    return { id: 'm1', role: 'assistant', content: '正文', timestamp: 1, metadata: { genUiCards: cards } }
  }

  type Deps = Parameters<typeof createGenuiCardSubmissionHost>[0]

  function makeDeps(overrides: Partial<Deps> = {}) {
    let list: Message[] = [assistantMessage([card()])]
    const sent: Array<{ content: string; metadata: Record<string, unknown>; sessionId: string }> = []
    const updateMessage = vi.fn()
    const turn: GenuiSubmissionTurnPort = {
      sendMessage: vi.fn(async (content: string, _display?: string, _attachments?: undefined, options?: {
        sessionId?: string
        userMessageMetadata?: Record<string, unknown>
        onDispatched?: (error?: unknown) => void
      }) => {
        sent.push({
          content,
          metadata: (options?.userMessageMetadata ?? {}) as Record<string, unknown>,
          sessionId: options?.sessionId ?? '',
        })
        options?.onDispatched?.()
      }),
    }
    const deps: Deps = {
      sessionId: () => 'sess-1',
      messages: () => list,
      translate: translate('zh-CN'),
      updateMessage,
      turn,
      now: () => 1234,
      ...overrides,
    }
    return {
      deps,
      sent,
      updateMessage,
      setMessages: (next: Message[]) => {
        list = next
      },
    }
  }

  it('成功提交：正文带完整 payload，metadata 写入卡片标识 / 摘要 / payload，卡片转为已提交', async () => {
    const { deps, sent, updateMessage } = makeDeps()
    const host = createGenuiCardSubmissionHost(deps)
    const payload = { name: '张三' }

    const result = await host.submit(card(), payload)

    expect(result).toEqual({ status: 'submitted', summary: '已提交卡片「报名表」，共 1 个字段' })
    expect(sent).toHaveLength(1)
    expect(sent[0].sessionId).toBe('sess-1')
    expect(sent[0].content).toContain(JSON.stringify(payload, null, 2))
    expect(sent[0].metadata.genUiSubmission).toEqual({
      cardId: 'm1:card:0',
      summary: '已提交卡片「报名表」，共 1 个字段',
      payload,
      collapsed: true,
    })

    expect(updateMessage).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ metadata: expect.objectContaining({ genUiCards: [
        expect.objectContaining({ id: 'm1:card:0', submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 1234 } }),
      ] }) }),
      'sess-1',
    )
  })

  it('同一张卡已提交后再提交被忽略，不产生第二条消息', async () => {
    const submitted = card({ submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 1 } })
    const { deps, sent, updateMessage } = makeDeps({ messages: () => [assistantMessage([submitted])] })
    const host = createGenuiCardSubmissionHost(deps)

    expect(await host.submit(submitted, { name: '张三' })).toEqual({ status: 'ignored' })
    expect(sent).toHaveLength(0)
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('并发的重复提交只发出一次', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { deps, sent } = makeDeps()
    deps.turn.sendMessage = vi.fn(async (_content, _display, _attachments, options) => {
      sent.push({ content: _content, metadata: {}, sessionId: options?.sessionId ?? '' })
      await gate
      options?.onDispatched?.()
    })
    const host = createGenuiCardSubmissionHost(deps)

    const first = host.submit(card(), { a: 1 })
    const second = host.submit(card(), { a: 2 })
    expect(await second).toEqual({ status: 'ignored' })
    release()
    expect((await first).status).toBe('submitted')
    expect(sent).toHaveLength(1)
  })

  it('发送失败时卡片保持可编辑：不写只读状态，返回可重试错误', async () => {
    const { deps, updateMessage } = makeDeps()
    deps.turn.sendMessage = vi.fn(async () => {
      throw new Error('engine unavailable')
    })
    const host = createGenuiCardSubmissionHost(deps)

    expect(await host.submit(card(), { a: 1 })).toEqual({ status: 'failed', reason: 'send-failed' })
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('校验失败时不发送、不写只读状态', async () => {
    const { deps, sent, updateMessage } = makeDeps()
    const host = createGenuiCardSubmissionHost(deps)

    expect(await host.submit(card(), 'not-an-object')).toEqual({ status: 'failed', reason: 'invalid-payload' })
    expect(sent).toHaveLength(0)
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('缺少会话时提交失败且不写只读状态', async () => {
    const { deps, updateMessage } = makeDeps({ sessionId: () => undefined })
    const host = createGenuiCardSubmissionHost(deps)

    expect(await host.submit(card(), { a: 1 })).toEqual({ status: 'failed', reason: 'session-unavailable' })
    expect(updateMessage).not.toHaveBeenCalled()
  })
})

describe('用户消息气泡的折叠展示', () => {
  const full = '已提交卡片「报名表」，共 1 个字段\n\n```json\n{\n  "name": "张三"\n}\n```'

  it('metadata 存在时只显示摘要', () => {
    const message: Message = {
      id: 'u1',
      role: 'user',
      content: full,
      timestamp: 1,
      metadata: {
        genUiSubmission: {
          cardId: 'm1:card:0',
          summary: '已提交卡片「报名表」，共 1 个字段',
          payload: { name: '张三' },
          collapsed: true,
        },
      },
    }
    expect(resolveUserMessageDisplay(message)).toBe('已提交卡片「报名表」，共 1 个字段')
  })

  it('metadata 丢失时退化为原文，围栏 JSON 仍然可读', () => {
    const message: Message = { id: 'u1', role: 'user', content: full, timestamp: 1 }
    expect(resolveUserMessageDisplay(message)).toBe(full)
  })
})
