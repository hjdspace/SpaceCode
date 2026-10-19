import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// 在导入 store 之前 mock electronAPI，避免因 IPC 不存在导致副作用。
vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
      onPermissionRequest: undefined,
      onPermissionRequestCancelled: undefined,
    },
    injectGuiModelsToSettings: vi.fn().mockResolvedValue({ success: true }),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: false }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    trace: { event: vi.fn() },
  },
}))

import { usePermissionPolicyStore } from '../permissionPolicy'
import { useSettingsStore } from '../settings'
import { useChatSessionStore } from '../chatSession'
import { api } from '@/services/electronAPI'

describe('usePermissionPolicyStore', () => {
  beforeEach(() => {
    // settings store 会把 permissionMode 落到 localStorage，清掉否则默认值会跨用例串味
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('把模式落在会话自己身上并按 sessionId 下发', async () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('A', undefined, 'a')
    const store = usePermissionPolicyStore()

    await store.setPermissionMode('a', 'plan')

    expect(store.getPermissionMode('a')).toBe('plan')
    expect(sessionStore.getSession('a')!.permissionMode).toBe('plan')
    expect(api.claudeCode?.setPermissionMode).toHaveBeenCalledWith('a', 'plan')
  })

  it('一个会话切模式不改写另一个会话（多会话串扰回归）', async () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('A', undefined, 'a')
    sessionStore.createSession('B', undefined, 'b')
    const store = usePermissionPolicyStore()
    sessionStore.selectSession('b')

    await store.setPermissionMode('b', 'plan')

    expect(store.getPermissionMode('b')).toBe('plan')
    // A 从没切过 → 仍取全局默认，不是 B 刚选的 plan
    expect(store.getPermissionMode('a')).toBe('default')
    // 只有被操作的那个会话收到下发
    expect(api.claudeCode?.setPermissionMode).toHaveBeenCalledTimes(1)
    expect(api.claudeCode?.setPermissionMode).toHaveBeenCalledWith('b', 'plan')
  })

  it('切换会话模式不再改写全局默认与 ~/.claude/settings.json', async () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('A', undefined, 'a')
    const store = usePermissionPolicyStore()
    const settings = useSettingsStore()
    settings.permissionMode = 'default'

    await store.setPermissionMode('a', 'acceptEdits')

    expect(settings.permissionMode).toBe('default')
    expect(store.defaultPermissionMode).toBe('default')
    expect(api.injectGuiModelsToSettings).not.toHaveBeenCalled()
  })

  it('没传会话归属时只改默认值，不打扰任何进程', async () => {
    const store = usePermissionPolicyStore()
    const settings = useSettingsStore()

    await store.setPermissionMode(null, 'plan')

    expect(settings.permissionMode).toBe('plan')
    expect(store.defaultPermissionMode).toBe('plan')
    expect(api.claudeCode?.setPermissionMode).not.toHaveBeenCalled()
  })

  it('未知 sessionId 回退到全局默认', () => {
    const store = usePermissionPolicyStore()
    expect(store.getPermissionMode('not-a-session')).toBe('default')
    expect(store.getPermissionMode(null)).toBe('default')
  })

  it('后端拒绝时还原该会话的模式，含「从没切过」这个状态', async () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('A', undefined, 'a')
    const store = usePermissionPolicyStore()

    // 该会话从没主动切过模式
    expect(store.getPermissionMode('a')).toBe('default')

    // 第一次切成功，第二次让后端拒绝
    await store.setPermissionMode('a', 'acceptEdits')
    ;(api.claudeCode as any).setPermissionMode = vi
      .fn()
      .mockRejectedValueOnce(new Error('not launched with --dangerously-skip-permissions'))

    await store.setPermissionMode('a', 'bypassPermissions')

    expect(sessionStore.getSession('a')!.permissionMode).toBe('acceptEdits')
    expect(store.getPermissionMode('a')).toBe('acceptEdits')
  })

  it('后端拒绝且该会话从没切过时回退到全局默认', async () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('A', undefined, 'a')
    const store = usePermissionPolicyStore()
    ;(api.claudeCode as any).setPermissionMode = vi
      .fn()
      .mockRejectedValueOnce(new Error('engine refused mode switch'))

    await store.setPermissionMode('a', 'plan')

    expect(sessionStore.getSession('a')!.permissionMode).toBeUndefined()
    expect(store.getPermissionMode('a')).toBe('default')
  })
})
