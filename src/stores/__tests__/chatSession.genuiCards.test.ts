import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 重新进入历史后的卡片状态（票 05 第 1、2 条）。
 *
 * selectSession 会用引擎 JSONL 重建消息，卡片随之重投影。这里钉住三件事：
 * 位置与顺序不变、已提交只读状态跟着回来、重投影不会把同一张卡画两遍。
 * JSONL 由引擎写，消息 id 与 SpaceCode 的不是一套，因此对齐只能靠围栏序号。
 */

const mocks = vi.hoisted(() => ({
  getFullSession: vi.fn(),
  getSessionStatus: vi.fn().mockResolvedValue(undefined),
  listAllSessions: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: mocks,
    image: null,
    trace: { event: vi.fn() },
    getCwd: vi.fn().mockResolvedValue(''),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

const SESSION = 'sess-genui-hydrate'
const SCHEMA = { componentName: 'TinyForm', props: { title: '报名表' } }
const FENCE = ['```schemaJson', JSON.stringify(SCHEMA), '```'].join('\n')

/** localStorage 里已经存过的会话：卡片带着提交后的只读状态。 */
function seedStoredSession(cards: unknown[]): void {
  localStorage.setItem('chat_sessions_v2', JSON.stringify([{
    id: SESSION,
    title: '卡片会话',
    messages: [
      { id: 'u1', role: 'user', content: '给我一个表单', timestamp: 1 },
      {
        id: 'sc-1',
        role: 'assistant',
        content: '这是表单',
        timestamp: 2,
        metadata: { genUiCards: cards },
      },
    ],
    createdAt: 1,
    updatedAt: 2,
    workingDirectory: 'D:/repo',
    processStatus: 'none',
    isTabOpen: true,
    lastActivityAt: 2,
    mode: 'code',
  }]))
}

/** 引擎 JSONL：同一条回复，正文里还留着围栏，消息 id 是引擎那套。 */
function fakeTranscript(text: string): void {
  mocks.getFullSession.mockResolvedValue({
    messages: [
      { type: 'user', uuid: 'eng-u1', message: { role: 'user', content: [{ type: 'text', text: '给我一个表单' }] } },
      { type: 'assistant', uuid: 'eng-a1', message: { role: 'assistant', content: [{ type: 'text', text }] } },
    ],
  })
}

async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

describe('重新进入历史后的卡片', () => {
  let useChatSessionStore: typeof import('../chatSession').useChatSessionStore

  beforeAll(async () => {
    setActivePinia(createPinia())
    ;({ useChatSessionStore } = await import('../chatSession'))
  })

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('已提交只读状态跟着回来，卡片仍然只有一张', async () => {
    const submitted = {
      id: 'sc-1:card:0',
      schema: SCHEMA,
      protocolVersion: 1,
      submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 42 },
    }
    seedStoredSession([submitted])
    fakeTranscript(`这是表单\n\n${FENCE}`)

    const store = useChatSessionStore()
    await store.selectSession(SESSION)
    await flushMicrotasks()

    const messages = store.getSessionMessages(SESSION)
    const assistant = messages.find(message => message.role === 'assistant')!
    const cards = assistant.metadata?.genUiCards

    expect(cards).toHaveLength(1)
    expect(cards![0]).toMatchObject({ submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 42 } })
    // 投影把围栏从正文里收走，重载后不会把界面画成一段 JSON
    expect(assistant.content).toBe('这是表单')
  })

  it('驱逐过的卡片不因重投影复活，占位留在原来的位置', async () => {
    const evicted = { id: 'sc-1:card:0', schema: null, protocolVersion: 1, expired: true }
    seedStoredSession([evicted])
    fakeTranscript(`这是表单\n\n${FENCE}`)

    const store = useChatSessionStore()
    await store.selectSession(SESSION)
    await flushMicrotasks()

    const assistant = store.getSessionMessages(SESSION).find(message => message.role === 'assistant')!
    expect(assistant.metadata?.genUiCards).toHaveLength(1)
    expect(assistant.metadata?.genUiCards![0]).toMatchObject({ schema: null, expired: true })
  })

  it('两张卡的顺序与正文位置一致，第二张新投影出来的卡排在后面', async () => {
    const firstOnly = { id: 'sc-1:card:0', schema: SCHEMA, protocolVersion: 1 }
    seedStoredSession([firstOnly])
    fakeTranscript(`这是表单\n\n${FENCE}\n\n再来一张\n\n${FENCE}`)

    const store = useChatSessionStore()
    await store.selectSession(SESSION)
    await flushMicrotasks()

    const assistant = store.getSessionMessages(SESSION).find(message => message.role === 'assistant')!
    expect(assistant.metadata?.genUiCards).toHaveLength(2)
    // 已有记录原样保留（连 id 都不换），新出现的按序号追加在后面
    expect(assistant.metadata?.genUiCards!.map(card => card.id)).toEqual(['sc-1:card:0', 'eng-a1:card:1'])
  })

  it('会话里没有卡片记录时，重投影照常给出卡片', async () => {
    localStorage.setItem('chat_sessions_v2', JSON.stringify([{
      id: SESSION,
      title: '卡片会话',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
      workingDirectory: 'D:/repo',
      processStatus: 'none',
      isTabOpen: true,
      lastActivityAt: 2,
      mode: 'code',
    }]))
    fakeTranscript(`这是表单\n\n${FENCE}`)

    const store = useChatSessionStore()
    await store.selectSession(SESSION)
    await flushMicrotasks()

    const assistant = store.getSessionMessages(SESSION).find(message => message.role === 'assistant')!
    expect(assistant.metadata?.genUiCards).toHaveLength(1)
    expect(assistant.metadata?.genUiCards![0].id).toBe('eng-a1:card:0')
  })
})
