import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '../chatSession'

// chatSession 在 setup 时可能读 localStorage / 调 api；若测试失败因副作用，按需 stub
beforeEach(() => {
  setActivePinia(createPinia())
})

describe('chatSession SessionSink 实现', () => {
  // 深化的核心 bug 修复点：原 updateToolCall 用 currentSessionId，多 pane 并发会写错会话。
  // updateToolCallForSession 必须按 sessionId 定位，不依赖 currentSessionId。
  it('updateToolCallForSession 按 sessionId 定位，不依赖 currentSessionId', () => {
    const sessionStore = useChatSessionStore()
    const s1 = sessionStore.createSession('A', undefined, 'sess-1')
    const s2 = sessionStore.createSession('B', undefined, 'sess-2')
    const msg1 = sessionStore.addMessage({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc1', name: 'Read', input: {}, status: 'running', startTime: 0, endTime: 0 }],
    }, 'sess-1')
    const msg2 = sessionStore.addMessage({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc2', name: 'Read', input: {}, status: 'running', startTime: 0, endTime: 0 }],
    }, 'sess-2')

    // 模拟多 pane：currentSessionId 是 s2（最后创建/选中的），但改 s1 的 toolCall。
    // 直接赋值避免 selectSession 的 async api.claudeCode 副作用，精准隔离被测方法。
    sessionStore.currentSessionId = s2.id
    expect(sessionStore.currentSessionId).toBe('sess-2')

    sessionStore.updateToolCallForSession('sess-1', msg1.id, 'tc1', 'completed')

    // s1 的 tc1 被改写为 completed
    const s1msg = sessionStore.sessions.find(s => s.id === s1.id)!.messages.find(m => m.id === msg1.id)!
    expect(s1msg.toolCalls!.find(t => t.id === 'tc1')!.status).toBe('completed')
    // s2 未受影响（currentSessionId 是 s2 但未传 s2，不应误写）
    const s2msg = sessionStore.sessions.find(s => s.id === s2.id)!.messages.find(m => m.id === msg2.id)!
    expect(s2msg.toolCalls!.find(t => t.id === 'tc2')!.status).toBe('running')
  })

  it('ensureSession 已存在则原样返回（不覆盖已有标题），不存在则按 hint 创建', () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Existing', undefined, 'sess-x')
    const got = sessionStore.ensureSession('sess-x', { title: 'Ignored' })
    expect(got.id).toBe('sess-x')
    // 不覆盖已有标题
    expect(got.title).toBe('Existing')

    const created = sessionStore.ensureSession('sess-y', { title: 'New', projectPath: '/p' })
    expect(created.id).toBe('sess-y')
    expect(created.title).toBe('New')
    expect(created.workingDirectory).toBe('/p')
  })

  it('saveToStorageForSession 不抛错', () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('A', undefined, 'sess-z')
    expect(() => sessionStore.saveToStorageForSession('sess-z')).not.toThrow()
  })

  it('updateToolCallForSession 对不存在的 sessionId 静默返回（不抛错）', () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('A', undefined, 'sess-real')
    expect(() => sessionStore.updateToolCallForSession('sess-missing', 'any-msg', 'any-tc', 'completed')).not.toThrow()
  })
})
