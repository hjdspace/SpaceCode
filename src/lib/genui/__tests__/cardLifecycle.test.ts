/**
 * 卡片生命周期：确定性 id、渲染形状、会话预算与损坏 metadata 兜底（票 05）。
 *
 * 只断言外部可观察行为：给一批卡片记录，最终哪些还能渲染、哪些被驱逐、顺序是什么；
 * 给一份坏 metadata，读出来的是可用形状还是被丢掉。不碰 DOM，不碰 store。
 */
import { describe, it, expect } from 'vitest'
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import {
  GENUI_SESSION_CARD_BUDGET_BYTES,
  applyGenuiCardBudget,
  genuiCardStorageBytes,
  sanitizeGenuiSession,
  toRenderableCard,
} from '../cardLifecycle'
import { buildGenuiCardId, cardIdParts, mergeGenuiCardRecords } from '../cardProjection'
import type { GenuiCardRecord } from '@/types/genui'
import type { Message, Session } from '@/types'

/** 约 bytes 字节的 schema：够大到能被预算数出来，又不至于让测试跑不动。 */
function schemaOf(bytes: number): Record<string, unknown> {
  return { componentName: 'TinyForm', pad: 'x'.repeat(Math.max(0, bytes - 30)) }
}

function card(id: string, overrides: Partial<GenuiCardRecord> = {}): GenuiCardRecord {
  return {
    id,
    schema: schemaOf(200),
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    ...overrides,
  }
}

function messageOf(id: string, cards: GenuiCardRecord[]): Message {
  return { id, role: 'assistant', content: '正文', timestamp: 1, metadata: { genUiCards: cards } }
}

function sessionOf(messages: Message[]): Session {
  return {
    id: 'sess-1',
    title: 't',
    messages,
    createdAt: 1,
    updatedAt: 1,
    workingDirectory: 'D:/repo',
    processStatus: 'none',
    isTabOpen: false,
    lastActivityAt: 1,
    expandedView: 'none',
    teammateTranscripts: {},
    mode: 'code',
  } as unknown as Session
}

describe('确定性 id', () => {
  it('id 由消息 id 与围栏序号拼出，能原样反解回去', () => {
    const id = buildGenuiCardId('m1', 3)
    expect(id).toBe('m1:card:3')
    expect(cardIdParts(id)).toEqual({ messageId: 'm1', index: 3 })
  })

  it('消息 id 里带分隔符片段时仍按最后一个序号解析', () => {
    expect(cardIdParts('a:card:b:card:2')).toEqual({ messageId: 'a:card:b', index: 2 })
  })

  it('不是卡片 id 的形状就返回 null', () => {
    for (const bad of ['m1', 'm1:card:', 'm1:card:x', 'm1:fallback:0', '']) {
      expect(cardIdParts(bad)).toBeNull()
    }
  })
})

describe('渲染形状', () => {
  it('完整记录原样通过，字段缺省与类型不对的一律判为不可渲染', () => {
    expect(toRenderableCard(card('m1:card:0'))).toMatchObject({ id: 'm1:card:0' })
    const bad = [
      null,
      undefined,
      'm1:card:0',
      {},
      { id: '', schema: {}, protocolVersion: 1 },
      { id: 42, schema: {}, protocolVersion: 1 },
      { id: 'm1:card:0', schema: null, protocolVersion: 1 },
      { id: 'm1:card:0', schema: [1, 2], protocolVersion: 1 },
      { id: 'm1:card:0', schema: 'json', protocolVersion: 1 },
      { id: 'm1:card:0', schema: {} },
      { id: 'm1:card:0', schema: {}, protocolVersion: '1' },
    ]
    for (const value of bad) {
      expect(toRenderableCard(value)).toBeNull()
    }
  })

  it('已提交标记形状不对时丢掉标记，卡片本身仍可渲染', () => {
    const damaged = card('m1:card:0', { submitted: { summary: 1, submittedAt: 'x' } as unknown as GenuiCardRecord['submitted'] })
    const rendered = toRenderableCard(damaged)
    expect(rendered?.id).toBe('m1:card:0')
    expect(rendered?.submitted).toBeUndefined()
  })

  it('expired 记录不要求 schema：payload 已被预算丢弃', () => {
    expect(toRenderableCard({ id: 'm1:card:0', schema: null, protocolVersion: 1, expired: true })).toMatchObject({
      id: 'm1:card:0',
      expired: true,
    })
  })

  it('submitted 与 expired 同时存在时两者都保留（内容丢了但提交结果还在）', () => {
    const both = {
      id: 'm1:card:0',
      schema: null,
      protocolVersion: 1,
      expired: true,
      submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 5 },
    }
    expect(toRenderableCard(both)).toEqual(both)
  })
})

describe('重投影按 id 合并', () => {
  it('已有记录优先：同一 id 不会多出一张卡，也不冲掉前端特有状态', () => {
    const stored = card('m1:card:0', { submitted: { summary: '已提交', submittedAt: 1 } })
    const replay = card('m1:card:0', { schema: schemaOf(999) })

    const merged = mergeGenuiCardRecords([stored], [replay])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toBe(stored)
  })

  it('被预算驱逐过的卡重投影后不复活', () => {
    const evicted = card('m1:card:0', { schema: null, expired: true })
    const merged = mergeGenuiCardRecords([evicted], [card('m1:card:0')])
    expect(merged).toEqual([evicted])
  })

  it('按围栏序号去重：引擎重放换了一套消息 id，也不会把同一张卡画两遍', () => {
    // 会话记录里的 id 是 SpaceCode 的，重放用的是引擎 UUID —— 只有序号是同一件事
    const stored = card('sc-1:card:0', { submitted: { summary: '已提交', submittedAt: 1 } })
    const replayed = [card('eng-1:card:0'), card('eng-1:card:1')]

    const merged = mergeGenuiCardRecords([stored], replayed)

    expect(merged.map(item => cardIdParts(item.id)?.index)).toEqual([0, 1])
    expect(merged[0]).toBe(stored)
  })

  it('顺序按围栏序号，与消息正文里的位置一致', () => {
    const a = card('m1:card:0')
    const b = card('m1:card:1')
    // 已有记录只剩第二张（例如第一条被裁剪），重投影后仍按 0、1 排
    expect(mergeGenuiCardRecords([b], [a, b]).map(item => item.id)).toEqual(['m1:card:0', 'm1:card:1'])
    expect(mergeGenuiCardRecords([b], []).map(item => item.id)).toEqual(['m1:card:1'])
  })

  it('没有已有记录时按投影顺序原样返回', () => {
    const a = card('m1:card:0')
    const b = card('m1:card:1')
    expect(mergeGenuiCardRecords(undefined, [a, b])).toEqual([a, b])
  })
})

describe('会话卡片预算', () => {
  const KB = 1024
  /**
   * 用例按模块自己的口径算预算（localStorage 收 UTF-16 字节），而不是自己抄一遍「length × 2」——
   * 抄一份的话单位一改，测试会跟着一起算错。
   */
  const sizeOf = (record: unknown): number => genuiCardStorageBytes(record as GenuiCardRecord)
  /** 驱逐后留在 metadata 里的占位形状 —— 它也占体积，预算要按实际存下来的字节数。 */
  const placeholder = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    schema: null,
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    expired: true,
    ...extra,
  })
  const totalOf = (...records: unknown[]): number =>
    records.reduce<number>((sum, record) => sum + sizeOf(record), 0)
  /** 对照尺子：UTF-8 字节数（单卡限额用的那把），用来证明会话预算不是它。 */
  const utf8Size = (record: unknown): number => new TextEncoder().encode(JSON.stringify(record)).length

  it('计量口径是 localStorage 实际收费的 UTF-16 字节，不是字符数也不是 UTF-8 字节', () => {
    const ascii = card('m1:card:0', { schema: { componentName: 'TinyForm', pad: 'x'.repeat(100) } })
    const cjk = card('m1:card:1', { schema: { componentName: 'TinyForm', pad: '报名表'.repeat(34) } })

    expect(genuiCardStorageBytes(ascii)).toBe(JSON.stringify(ascii).length * 2)
    // 对照用的另一把尺子（单卡限额按 UTF-8 计）：ASCII 下 UTF-16 贵一倍，中文下反而便宜。
    // 口径若跟着 UTF-8 走，一屏英文卡片就会「显示得出却存不下」。
    expect(genuiCardStorageBytes(ascii)).toBeGreaterThan(utf8Size(ascii))
    expect(genuiCardStorageBytes(cjk)).toBeLessThan(utf8Size(cjk))
  })

  it('总量在预算内时一个字节都不动', () => {
    const cards = [card('m1:card:0'), card('m1:card:1')]
    const session = sessionOf([messageOf('m1', cards)])
    const before = JSON.stringify(cards)

    const result = applyGenuiCardBudget(session, { budgetBytes: totalOf(...cards) + 10 * KB })

    expect(result.evicted).toEqual([])
    expect(JSON.stringify(session.messages[0].metadata?.genUiCards)).toBe(before)
  })

  it('超预算时从最旧的卡片开始丢 payload，最新的内容保住', () => {
    const cards = [card('m1:card:0'), card('m1:card:1'), card('m1:card:2')]
    const session = sessionOf([messageOf('m1', cards)])
    // 预算刚好等于「两张占位 + 最后一张完整卡」：再多丢一张就富余，少丢一张就溢出
    const budget = totalOf(placeholder('m1:card:0'), placeholder('m1:card:1'), cards[2])

    const result = applyGenuiCardBudget(session, { budgetBytes: budget })

    expect(result.evicted.map(item => item.id)).toEqual(['m1:card:0', 'm1:card:1'])
    const stored = session.messages[0].metadata!.genUiCards!
    expect(stored[0]).toMatchObject({ id: 'm1:card:0', schema: null, expired: true })
    expect(stored[1]).toMatchObject({ id: 'm1:card:1', schema: null, expired: true })
    expect(stored[2].schema).not.toBeNull()
    expect(stored[2].expired).toBeUndefined()
  })

  it('跨消息也按时间顺序驱逐：旧消息里的卡先过期', () => {
    const old = card('m1:card:0')
    const recent = card('m2:card:0')
    const session = sessionOf([messageOf('m1', [old]), messageOf('m2', [recent])])

    const result = applyGenuiCardBudget(session, {
      budgetBytes: totalOf(placeholder('m1:card:0'), recent),
    })

    expect(result.evicted.map(item => item.id)).toEqual(['m1:card:0'])
    expect(session.messages[1].metadata!.genUiCards![0].schema).not.toBeNull()
  })

  it('已提交卡片被驱逐时只丢 schema，摘要与提交时刻保留', () => {
    const submitted = card('m1:card:0', { submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 7 } })
    const kept = card('m1:card:1')
    const session = sessionOf([messageOf('m1', [submitted, kept])])

    applyGenuiCardBudget(session, {
      budgetBytes: totalOf(placeholder('m1:card:0', { submitted: submitted.submitted }), kept),
    })

    expect(session.messages[0].metadata!.genUiCards![0]).toEqual({
      id: 'm1:card:0',
      schema: null,
      protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
      expired: true,
      submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 7 },
    })
  })

  it('已经过期的卡片不再计入完整体积，重复调用结果一致（幂等）', () => {
    const cards = [card('m1:card:0'), card('m1:card:1'), card('m1:card:2')]
    const session = sessionOf([messageOf('m1', cards)])
    const budget = totalOf(placeholder('m1:card:0'), placeholder('m1:card:1'), cards[2])

    const first = applyGenuiCardBudget(session, { budgetBytes: budget })
    const second = applyGenuiCardBudget(session, { budgetBytes: budget })

    expect(first.evicted.map(item => item.id)).toEqual(['m1:card:0', 'm1:card:1'])
    expect(second.evicted).toEqual([])
  })

  it('默认预算就是 PRD 里的 512KB', () => {
    expect(GENUI_SESSION_CARD_BUDGET_BYTES).toBe(512 * KB)
  })

  it('没有卡片的会话零开销通过', () => {
    const session = sessionOf([{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }])
    expect(applyGenuiCardBudget(session).evicted).toEqual([])
  })
})

describe('损坏 metadata 兜底', () => {
  it('卡片数组形状不对时整条丢掉，消息其余字段不动', () => {
    const message = messageOf('m1', [card('m1:card:0')])
    message.metadata!.genUiCards = ['坏记录', { id: 'm1:card:1' }] as unknown as GenuiCardRecord[]
    message.metadata!.duration = 12
    const session = sessionOf([message])

    const result = sanitizeGenuiSession(session)

    expect(result.droppedCards).toBe(2)
    expect(session.messages[0].metadata?.genUiCards).toBeUndefined()
    expect(session.messages[0].metadata?.duration).toBe(12)
  })

  it('部分记录可用时只丢坏的那条', () => {
    const good = card('m1:card:0')
    const message = messageOf('m1', [good, null as unknown as GenuiCardRecord])
    const session = sessionOf([message])

    expect(sanitizeGenuiSession(session).droppedCards).toBe(1)
    expect(session.messages[0].metadata?.genUiCards).toEqual([good])
  })

  it('降级说明与提交 metadata 一起兜底', () => {
    const message: Message = {
      id: 'u1',
      role: 'user',
      content: '正文',
      timestamp: 1,
      metadata: {
        genUiCardFallbacks: [{ id: 'm1:fallback:0', reason: 'malformed-json', componentName: '' }, 42],
        genUiSubmission: { cardId: 'm1:card:0', summary: '已提交', payload: { a: 1 }, collapsed: true },
      } as unknown as Message['metadata'],
    }
    const broken: Message = {
      id: 'u2',
      role: 'user',
      content: '正文',
      timestamp: 1,
      metadata: { genUiSubmission: '坏' } as unknown as Message['metadata'],
    }
    const session = sessionOf([message, broken])

    const result = sanitizeGenuiSession(session)

    expect(result.droppedFallbacks).toBe(1)
    expect(result.droppedSubmissions).toBe(1)
    expect(session.messages[0].metadata?.genUiCardFallbacks).toHaveLength(1)
    expect(session.messages[1].metadata?.genUiSubmission).toBeUndefined()
  })

  it('metadata 缺失或不是对象时不动它', () => {
    const session = sessionOf([
      { id: 'm1', role: 'assistant', content: 'x', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: 'x', timestamp: 1, metadata: undefined },
    ])
    expect(sanitizeGenuiSession(session)).toEqual({ droppedCards: 0, droppedFallbacks: 0, droppedSubmissions: 0 })
    expect(session.messages[0].metadata).toBeUndefined()
  })
})
