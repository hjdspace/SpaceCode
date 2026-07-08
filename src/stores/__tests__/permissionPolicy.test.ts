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
import { api } from '@/services/electronAPI'

describe('usePermissionPolicyStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('setPermissionMode 更新 currentPermissionMode 并持久化', async () => {
    const store = usePermissionPolicyStore()
    await store.setPermissionMode('acceptEdits')
    expect(store.currentPermissionMode).toBe('acceptEdits')
  })

  it('setPermissionMode 同步 settings.permissionMode 并调用 saveSettings', async () => {
    const store = usePermissionPolicyStore()
    const settings = useSettingsStore()
    const spy = vi.spyOn(settings, 'saveSettings')

    await store.setPermissionMode('plan')

    expect(settings.permissionMode).toBe('plan')
    expect(spy).toHaveBeenCalled()
  })

  it('setPermissionMode 调用 api.injectGuiModelsToSettings 传入当前 mode', async () => {
    const store = usePermissionPolicyStore()
    await store.setPermissionMode('bypassPermissions')

    expect(api.injectGuiModelsToSettings).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: 'bypassPermissions' })
    )
  })

  it('setPermissionMode 无当前会话时仅更新本地状态，不调用 claudeCode.setPermissionMode', async () => {
    const store = usePermissionPolicyStore()
    await store.setPermissionMode('default')
    // 没有会话 → claudeCode.setPermissionMode 不应被调用
    expect(api.claudeCode?.setPermissionMode).not.toHaveBeenCalled()
  })

  it('setPermissionMode 后端拒绝时回滚 previousMode', async () => {
    const store = usePermissionPolicyStore()
    const settings = useSettingsStore()
    // 先设置初始 mode
    await store.setPermissionMode('default')
    // 让 backend reject
    ;(api.claudeCode!.setPermissionMode as any) = vi
      .fn()
      .mockRejectedValueOnce(new Error('not launched with --dangerously-skip-permissions'))

    // 模拟有当前会话，使后端分支被触发
    const { useChatSessionStore } = await import('../chatSession')
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-rollback')
    sessionStore.selectSession('sess-rollback')

    await store.setPermissionMode('bypassPermissions')

    // 后端拒绝 → 回滚到 previousMode
    expect(store.currentPermissionMode).toBe('default')
    expect(settings.permissionMode).toBe('default')
  })
})
