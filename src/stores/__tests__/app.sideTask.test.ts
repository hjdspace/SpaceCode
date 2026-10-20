/**
 * app store 侧边任务的上下文继承来源戳记：
 * addSideTask 把当前主会话记为 _sideTaskSourceSessionId（首启时主进程据此压
 * transcript 快照），但主会话不存在或本身就是临时会话时不戳。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const probe = vi.hoisted(() => ({
  api: {
    cron: { setProjectRoot: vi.fn() },
    readFile: vi.fn(),
    preview: { getUrl: vi.fn() },
  },
  session: null as any,
  terminal: null as any,
  split: null as any,
  ephCount: 0,
}))

vi.mock('@/services/electronAPI', () => ({ api: probe.api }))
vi.mock('../chatSession', () => ({ useChatSessionStore: () => probe.session }))
vi.mock('../terminal', () => ({ useTerminalStore: () => probe.terminal }))
vi.mock('../splitLayout', () => ({ useSplitLayoutStore: () => probe.split }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))

import { useAppStore } from '../app'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  probe.ephCount = 0
  probe.api.cron.setProjectRoot.mockClear()
  probe.api.readFile.mockReset().mockResolvedValue('content')
  probe.api.preview.getUrl.mockReset().mockResolvedValue(null)
  probe.session = reactive({
    currentSessionId: 'main-session' as string | null,
    workingDirectory: '',
    currentProjectRoot: '',
    sessions: [
      { id: 'main-session', engineType: 'claude-code' },
      { id: 'eph-side-old', ephemeral: true, engineType: 'pi' },
    ],
    createSession: vi.fn(() => ({ id: `eph-${++probe.ephCount}` })),
    deleteSession: vi.fn(),
  })
  probe.terminal = reactive({ tabs: [], createTab: vi.fn(), closeTab: vi.fn() })
  probe.split = { clearLeavesForTab: vi.fn() }
})

describe('addSideTask — 上下文继承来源戳记', () => {
  it('主会话存在时记下其 id 与引擎类型', () => {
    const store = useAppStore()
    const sessionId = store.addSideTask()
    const created = probe.session.createSession.mock.results[0].value
    expect(sessionId).toBe(created.id)
    expect(created._sideTaskSourceSessionId).toBe('main-session')
    expect(created._sideTaskSourceEngine).toBe('claude-code')
    expect(store.sideTasks).toHaveLength(1)
  })

  it('主会话是临时会话时不戳（侧边任务只继承主任务）', () => {
    probe.session.currentSessionId = 'eph-side-old'
    const store = useAppStore()
    store.addSideTask()
    const created = probe.session.createSession.mock.results[0].value
    expect(created._sideTaskSourceSessionId).toBeUndefined()
    expect(created._sideTaskSourceEngine).toBeUndefined()
  })

  it('没有主会话时不戳', () => {
    probe.session.currentSessionId = null
    const store = useAppStore()
    store.addSideTask()
    const created = probe.session.createSession.mock.results[0].value
    expect(created._sideTaskSourceSessionId).toBeUndefined()
  })
})
