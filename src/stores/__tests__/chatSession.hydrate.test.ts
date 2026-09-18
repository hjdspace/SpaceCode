import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 会话 JSONL 懒加载（hydrate）竞态回归测试。
 *
 * 背景 bug：selectSession 触发 fire-and-forget 的 hydrateSingleSession，
 * hydrateSessionsFromJsonl 完成后用 JSONL 快照**整体覆盖** session.messages。
 * 若用户在 hydrate 窗口内发送消息，刚追加的气泡会被覆盖丢失——遗留旧会话上
 * 表现为"我发送的消息变成了历史旧消息（你好）"。
 *
 * 修复：
 * 1. selectSession / hydrate 回写前检测 turn 进行中（processStatus starting/active）则跳过覆盖；
 * 2. hydrate 启动后新追加的消息按 role+content 去重后合并回重建结果；
 * 3. 重建消息保留 JSONL 原始时间戳（不再统一改成 Date.now()）。
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

function seedSession(id: string, extra: Record<string, unknown> = {}): void {
  localStorage.setItem('chat_sessions_v2', JSON.stringify([{
    id,
    title: 'legacy session',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
    workingDirectory: 'D:/repo',
    processStatus: 'none',
    isTabOpen: true,
    lastActivityAt: 2,
    mode: 'code',
    ...extra,
  }]))
}

const flush = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('chatSession hydrate race protection', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('preserves messages appended while JSONL hydration is in flight', async () => {
    // JSONL 快照：历史"你好"（重复 + API 错误会被重试去重折叠成一条）
    mocks.getFullSession.mockImplementation(async () => {
      await flush(30)
      return {
        messages: [
          { type: 'user', uuid: 'u1', timestamp: '2026-08-20T11:33:53.117Z', message: { role: 'user', content: '你好' } },
          { type: 'assistant', uuid: 'a1', isApiErrorMessage: true, timestamp: '2026-08-20T11:36:22.870Z', message: { role: 'assistant', content: 'API Error: 401 Invalid token' } },
          { type: 'user', uuid: 'u2', timestamp: '2026-08-20T11:36:25.727Z', message: { role: 'user', content: '你好' } },
        ],
      }
    })
    seedSession('race-1')

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    // selectSession 内部 void hydrateSingleSession —— 不等待完成
    await store.selectSession('race-1')
    // hydrate 窗口内用户发送消息（sendMessage 的 appendMessage 先于引擎启动）
    store.addMessage({ role: 'user', content: '写个贪吃蛇小游戏' }, 'race-1')

    await flush()

    const msgs = store.sessions.find(s => s.id === 'race-1')!.messages
    const contents = msgs.map(m => m.content)
    expect(contents).toContain('写个贪吃蛇小游戏')
    expect(contents).toContain('你好')
    // 历史折叠为一条"你好" + 追加的一条新消息；401 错误与重复"你好"不重复出现
    expect(msgs).toHaveLength(2)
    expect(contents.filter(c => c === '你好')).toHaveLength(1)
  })

  it('skips JSONL overwrite while a turn is in flight (processStatus active)', async () => {
    mocks.getFullSession.mockResolvedValue({
      messages: [
        { type: 'user', uuid: 'u1', message: { role: 'user', content: 'history-only message' } },
      ],
    })
    seedSession('race-2', {
      messages: [{ id: 'm-live', role: 'user', content: '刚发送的消息', timestamp: 123 }],
    })

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    // 模拟 turn 进行中：sendMessage 会同步把 processStatus 置为 'active'
    // （应用启动时持久化会话会被重置为 'none'，此处手动恢复运行时真实状态）
    store.sessions.find(s => s.id === 'race-2')!.processStatus = 'active'

    await store.selectSession('race-2')
    await flush()

    const msgs = store.sessions.find(s => s.id === 'race-2')!.messages
    // turn 进行中：本地消息是最新事实，JSONL 快照（滞后）不得覆盖
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('刚发送的消息')
  })

  it('restores historical messages with their original JSONL timestamps', async () => {
    mocks.getFullSession.mockResolvedValue({
      messages: [
        { type: 'user', uuid: 'u9', timestamp: '2026-08-20T11:33:53.117Z', message: { role: 'user', content: '你好' } },
      ],
    })
    seedSession('race-3')

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    await store.selectSession('race-3')
    await flush()

    const msgs = store.sessions.find(s => s.id === 'race-3')!.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('你好')
    // 不再伪装成"刚刚发送"——保留引擎写入的原始时间戳
    expect(msgs[0].timestamp).toBe(Date.parse('2026-08-20T11:33:53.117Z'))
  })
})
