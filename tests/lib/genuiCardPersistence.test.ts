/**
 * 卡片随会话持久化的往返与预算（票 05 第 1、5、6 条）。
 *
 * 只断言「存进去再读出来看到什么」：位置、顺序、已提交只读状态是否一致，超预算的会话
 * 是否仍保存成功并留下可见过期占位，损坏 metadata 是否兜底而不阻塞会话打开。
 * 渲染侧的占位文案归组件用例，这里钉的是数据形状。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSessionsFromStorage, saveSessionsToStorage } from '@/services/sessionPersistence'
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import {
  GENUI_SESSION_CARD_BUDGET_BYTES,
  applyGenuiCardBudget,
} from '@/lib/genui/cardLifecycle'
import type { GenuiCardRecord } from '@/types/genui'
import type { Session } from '@/types'

const KB = 1024

function card(id: string, schemaBytes: number, overrides: Partial<GenuiCardRecord> = {}): GenuiCardRecord {
  return {
    id,
    schema: { componentName: 'TinyForm', pad: 'x'.repeat(Math.max(0, schemaBytes - 34)) },
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    ...overrides,
  }
}

function sessionOf(messages: Session['messages']): Session {
  return {
    id: 'sess-genui',
    title: '卡片会话',
    messages,
    createdAt: 1,
    updatedAt: 2,
    workingDirectory: 'D:/repo',
    processStatus: 'none',
    isTabOpen: false,
    lastActivityAt: 2,
    expandedView: 'none',
    teammateTranscripts: {},
    mode: 'code',
  } as unknown as Session
}

function cardsOf(message: Session['messages'][number]): GenuiCardRecord[] {
  return message.metadata?.genUiCards ?? []
}

function savedCards(): GenuiCardRecord[] {
  const [, assistant] = loadSessionsFromStorage()[0].messages
  return cardsOf(assistant)
}

function heavySession(count: number, perCardBytes: number, first?: Partial<GenuiCardRecord>): Session {
  const cards = Array.from({ length: count }, (_, index) =>
    card(`m1:card:${index}`, perCardBytes, index === 0 ? (first ?? {}) : {}),
  )
  return sessionOf([
    { id: 'u1', role: 'user', content: '给我一个表单', timestamp: 1 },
    { id: 'm1', role: 'assistant', content: '这是表单', timestamp: 2, metadata: { genUiCards: cards } },
  ])
}

beforeEach(() => {
  localStorage.clear()
})

describe('卡片随消息 metadata 往返', () => {
  it('保存再读出：位置、顺序与已提交只读状态一致', () => {
    const cards = [
      card('m1:card:0', 200, { submitted: { summary: '已提交卡片「报名表」，共 2 个字段', submittedAt: 9 } }),
      card('m1:card:1', 200),
    ]

    expect(saveSessionsToStorage([sessionOf([
      { id: 'u1', role: 'user', content: '给我一个表单', timestamp: 1 },
      { id: 'm1', role: 'assistant', content: '这是表单', timestamp: 2, metadata: { genUiCards: cards } },
    ])])).toBe(true)

    expect(savedCards()).toEqual(cards)
    expect(loadSessionsFromStorage()[0].messages[1].content).toBe('这是表单')
  })

  it('提交后的卡片即使整条会话重新落盘，只读状态也跟着回来', () => {
    saveSessionsToStorage([heavySession(1, 200)])
    const [only] = savedCards()

    saveSessionsToStorage([sessionOf([
      { id: 'u1', role: 'user', content: '给我一个表单', timestamp: 1 },
      {
        id: 'm1',
        role: 'assistant',
        content: '这是表单',
        timestamp: 2,
        metadata: {
          genUiCards: [{ ...only, submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 42 } }],
        },
      },
    ])])

    expect(savedCards()[0].submitted).toEqual({ summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 42 })
  })
})

describe('超预算驱逐后的持久化', () => {
  /** 单卡贴着 64KB 限额：9 张就顶穿 512KB 的会话预算，正是长会话的形状。 */
  const perCard = 64 * KB
  const overBudget = Math.ceil(GENUI_SESSION_CARD_BUDGET_BYTES / perCard) + 1

  it('会话保存成功，最旧的卡片以可见过期占位退出', () => {
    expect(saveSessionsToStorage([heavySession(overBudget, perCard)])).toBe(true)

    const stored = savedCards()
    expect(stored).toHaveLength(overBudget)
    expect(stored[0]).toMatchObject({ id: 'm1:card:0', schema: null, expired: true })
    expect(stored[overBudget - 1].schema).not.toBeNull()
    // 预算是「存得下」的约束，驱逐后必须回到限额之内
    const session = loadSessionsFromStorage()[0]
    expect(applyGenuiCardBudget(session).evicted).toEqual([])
  })

  it('已提交卡片被驱逐时只丢内容，摘要与提交时刻保留', () => {
    const mark = { summary: '已提交卡片「报名表」，共 3 个字段', submittedAt: 7 }
    saveSessionsToStorage([heavySession(overBudget, perCard, { submitted: mark })])

    const stored = savedCards()
    expect(stored[0]).toMatchObject({ schema: null, expired: true, submitted: mark })
  })

  it('驱逐后再保存一次结果稳定，不会随保存次数继续吃卡片', () => {
    saveSessionsToStorage([heavySession(overBudget, perCard)])
    const afterFirst = savedCards()

    saveSessionsToStorage(loadSessionsFromStorage())

    expect(savedCards()).toEqual(afterFirst)
  })

  it('预算内的会话一个字节都不动', () => {
    const session = heavySession(3, 2 * KB)
    const before = cardsOf(session.messages[1])

    saveSessionsToStorage([session])

    expect(savedCards()).toEqual(before)
  })

  it('会话其余内容照常保存：正文与别的消息不受卡片预算牵连', () => {
    saveSessionsToStorage([heavySession(overBudget, perCard)])

    const saved = loadSessionsFromStorage()[0]
    expect(saved.title).toBe('卡片会话')
    expect(saved.messages).toHaveLength(2)
    expect(saved.messages[0].content).toBe('给我一个表单')
    expect(saved.messages[1].content).toBe('这是表单')
  })
})

describe('损坏 metadata 的兜底', () => {
  it('坏记录在读取时被丢掉，会话与其余消息仍然打得开', () => {
    const session = heavySession(1, 200)
    const cards = cardsOf(session.messages[1])
    cards.push(
      null as unknown as GenuiCardRecord,
      { id: 'm1:card:1' } as unknown as GenuiCardRecord,
      { id: 'm1:card:2', schema: '不是对象', protocolVersion: 1 } as unknown as GenuiCardRecord,
    )
    localStorage.setItem('chat_sessions_v2', JSON.stringify([session]))

    const loaded = loadSessionsFromStorage()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].messages).toHaveLength(2)
    expect(loaded[0].messages[1].content).toBe('这是表单')
    expect(cardsOf(loaded[0].messages[1])).toEqual([card('m1:card:0', 200)])
  })

  it('整条 genUiCards 不是数组时静默移除，消息本体不受影响', () => {
    const session = heavySession(1, 200)
    session.messages[1].metadata!.genUiCards = '一整段坏数据' as unknown as GenuiCardRecord[]
    localStorage.setItem('chat_sessions_v2', JSON.stringify([session]))

    const loaded = loadSessionsFromStorage()

    expect(loaded[0].messages[1].metadata?.genUiCards).toBeUndefined()
    expect(loaded[0].messages[1].content).toBe('这是表单')
  })

  it('已经过期的记录不会被兜底误删', () => {
    const session = sessionOf([
      { id: 'u1', role: 'user', content: '给我一个表单', timestamp: 1 },
      {
        id: 'm1',
        role: 'assistant',
        content: '这是表单',
        timestamp: 2,
        metadata: { genUiCards: [{ id: 'm1:card:0', schema: null, protocolVersion: 1, expired: true }] },
      },
    ])
    saveSessionsToStorage([session])

    expect(savedCards()).toEqual([{ id: 'm1:card:0', schema: null, protocolVersion: 1, expired: true }])
  })

  it('提交 metadata 坏了只丢掉这一条标记，气泡正文仍然在', () => {
    const session = sessionOf([
      {
        id: 'u1',
        role: 'user',
        content: '已提交卡片「报名表」，共 1 个字段',
        timestamp: 1,
        metadata: { genUiSubmission: '坏' } as unknown as Session['messages'][number]['metadata'],
      },
    ])
    localStorage.setItem('chat_sessions_v2', JSON.stringify([session]))

    const loaded = loadSessionsFromStorage()

    expect(loaded[0].messages[0].metadata?.genUiSubmission).toBeUndefined()
    expect(loaded[0].messages[0].content).toBe('已提交卡片「报名表」，共 1 个字段')
  })
})

/**
 * 票 09 第 7 条（升级路径）：卡片是后加的能力，旧版本落盘的会话里根本没有 `genUiCards` 这个键。
 * 读取时的卡片兜底不能顺手改动别的 metadata —— 旧会话打开后普通消息、推理与工具调用
 * 必须逐字不变，否则"升级后旧会话打不开"这类事只会在用户机器上暴露。
 */
describe('旧版本会话（不含卡片字段）照常打开', () => {
  it('没有 genUiCards 的 metadata 逐字保留，兜底不改动任何一条消息', () => {
    const legacy = sessionOf([
      { id: 'u1', role: 'user', content: '看看这个仓库', timestamp: 1 },
      {
        id: 'm1',
        role: 'assistant',
        content: '这是一个 Electron 项目',
        timestamp: 2,
        metadata: {
          gitBranch: 'main',
          reasoning: [{ text: '先读 package.json', duration: 120, endTime: 320 }],
          toolCalls: [{ id: 'tool-1', name: 'Read', input: { file_path: 'package.json' }, status: 'done' }],
          contextUsage: { input: 1200, output: 340 },
        } as unknown as Session['messages'][number]['metadata'],
      },
    ])
    localStorage.setItem('chat_sessions_v2', JSON.stringify([legacy]))

    const loaded = loadSessionsFromStorage()

    expect(loaded[0].messages).toEqual(legacy.messages)
    expect(loaded[0].messages[1].metadata).toEqual(legacy.messages[1].metadata)
  })

  it('连 metadata 都没有的旧消息也不会被补出卡片字段', () => {
    const bare = sessionOf([{ id: 'm1', role: 'assistant', content: '纯文本回复', timestamp: 2 }])
    localStorage.setItem('chat_sessions_v2', JSON.stringify([bare]))

    const loaded = loadSessionsFromStorage()

    expect(loaded[0].messages[0].metadata).toBeUndefined()
    expect(loaded[0].messages[0].content).toBe('纯文本回复')
  })
})
