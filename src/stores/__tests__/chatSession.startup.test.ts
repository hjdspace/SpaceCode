import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  listAllSessions: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: { listAllSessions: mocks.listAllSessions },
    image: null,
    trace: { event: vi.fn() },
    getCwd: vi.fn().mockResolvedValue(''),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('chat session startup', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
  })

  it('keeps history metadata available without selecting or hydrating a session', async () => {
    localStorage.setItem('chat_sessions_v2', JSON.stringify([{
      id: 'history-1',
      title: 'Previous task',
      messages: [{ id: 'message-1', role: 'user', content: 'old message', timestamp: 1 }],
      createdAt: 1,
      updatedAt: 2,
      workingDirectory: 'D:/repo',
    }]))

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].title).toBe('Previous task')
    expect(store.currentSessionId).toBeNull()
    expect(store.currentMessages).toEqual([])
  })

  it('recovers missing sidebar entries from Claude history', async () => {
    mocks.listAllSessions.mockResolvedValueOnce([{
      sessionId: 'disk-session-1',
      projectPath: '/work/project',
      title: 'Recovered task',
      firstUserMessage: 'Original prompt',
      lastMessageTimestamp: 5000,
    }])

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    expect(await store.recoverSessionsFromHistory()).toBe(1)
    expect(store.sessions).toEqual([
      expect.objectContaining({
        id: 'disk-session-1',
        title: 'Recovered task',
        workingDirectory: '/work/project',
        updatedAt: 5000,
        mode: 'code',
      }),
    ])
    expect(JSON.parse(localStorage.getItem('chat_sessions_v2') || '[]')).toHaveLength(1)
  })
})
