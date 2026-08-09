import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {},
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
})
