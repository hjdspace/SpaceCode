import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * issue #48：更新 / 删除配置方案也要等主进程落地。
 *
 * applyProfile 在 #43 CCF-004 已经改成"等 saveSettings → 校验 success 与 proxyState → 失败回滚"，
 * 但 updateProfile / deleteProfile 改活跃方案时还是裸调 saveSettings：界面显示新值、profiles.json
 * 写好，主进程那份 gui-settings.json 与本地代理却可能还指着旧接口 —— 下一条消息走错地方，
 * 而入口看起来一切正常。这里钉住同一个口径。
 */
vi.mock('@/services/electronAPI', () => ({
  api: {
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    profilesLoad: vi.fn().mockResolvedValue({ success: true, data: null }),
    profilesSave: vi.fn().mockResolvedValue({ success: true }),
    profilesBackupCorrupt: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
  },
}))

import { api } from '@/services/electronAPI'
import { useSettingsStore } from '../settings'
import type { ModelProfile } from '@/types/profile'

function mockProfile(id: string, name: string, baseUrl: string): ModelProfile {
  return {
    id,
    name,
    authMethod: 'openai_compatible',
    anthropicConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    openaiConfig: { baseUrl, apiKey: `sk-${id}`, haikuModel: '', sonnetModel: `model-${id}`, opusModel: '' },
    geminiConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    modelContextWindows: {},
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

/** p1 在用（https://p1.com），p2 是另一套上游 */
function activeP1Store() {
  const store = useSettingsStore()
  store.profiles = [mockProfile('p1', '工作', 'https://p1.com'), mockProfile('p2', '个人', 'https://p2.com')]
  store.activeProfileId = 'p1'
  store.authMethod = 'openai_compatible'
  store.openaiConfig = { ...store.profiles[0].openaiConfig }
  return store
}

function lastPersistedProfiles() {
  const calls = vi.mocked(api.profilesSave).mock.calls
  return JSON.parse(String(calls[calls.length - 1]?.[0])) as {
    activeProfileId: string | null
    profiles: ModelProfile[]
  }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('settings store — 更新/删除方案的落地同步 (issue #48)', () => {
  describe('updateProfile 改活跃方案', () => {
    it('主进程还没落地时不 resolve，profiles.json 也不先写', async () => {
      const store = activeP1Store()
      let releaseSave: (value: { success: boolean }) => void = () => {}
      vi.mocked(api.saveGuiSettings).mockImplementationOnce(
        () => new Promise(resolve => { releaseSave = resolve }),
      )

      let settled = false
      const updating = store
        .updateProfile('p1', { name: '工作-改' })
        .then(() => { settled = true })
      await Promise.resolve()

      expect(settled).toBe(false)
      expect(api.profilesSave).not.toHaveBeenCalled()

      releaseSave({ success: true })
      await updating
      expect(settled).toBe(true)
      expect(store.profiles[0].name).toBe('工作-改')
    })

    it('主进程写 gui-settings 失败时判为失败，方案内容与主进程配置一起退回改动前', async () => {
      const store = activeP1Store()
      vi.mocked(api.saveGuiSettings).mockResolvedValueOnce({ success: false, error: 'EPERM gui-settings.json' })

      const err = await store
        .updateProfile('p1', { openaiConfig: { ...store.profiles[0].openaiConfig, baseUrl: 'https://broken.com' } })
        .catch(e => e)

      expect(err.profileApplyFailure).toBe('settings_save_failed')
      expect(err.message).toContain('EPERM gui-settings.json')
      expect(store.profiles[0].openaiConfig.baseUrl).toBe('https://p1.com')
      expect(store.openaiConfig.baseUrl).toBe('https://p1.com')
      expect(store.activeProfileId).toBe('p1')
      // 回滚要把退回后的配置再送一次主进程，否则代理还停在改动尝试后的状态
      expect(api.saveGuiSettings).toHaveBeenCalledTimes(2)
      expect(lastPersistedProfiles().profiles[0].openaiConfig.baseUrl).toBe('https://p1.com')
    })

    it('代理没按新配置起来时判为失败并回滚，而不是报成功', async () => {
      const store = activeP1Store()
      vi.mocked(api.saveGuiSettings).mockResolvedValueOnce({
        success: true,
        proxy: { state: 'failed', error: 'EADDRINUSE 34567' },
      })

      const err = await store
        .updateProfile('p1', { openaiConfig: { ...store.profiles[0].openaiConfig, sonnetModel: 'model-x' } })
        .catch(e => e)

      expect(err.profileApplyFailure).toBe('proxy_not_aligned')
      expect(store.profiles[0].openaiConfig.sonnetModel).toBe('model-p1')
      expect(store.openaiConfig.sonnetModel).toBe('model-p1')
    })

    it('profiles.json 写失败时同样回滚到改动前的方案', async () => {
      const store = activeP1Store()
      vi.mocked(api.profilesSave).mockResolvedValueOnce({ success: false, error: 'EACCES profiles.json' })

      const err = await store.updateProfile('p1', { name: '工作-改' }).catch(e => e)

      expect(err.profileApplyFailure).toBe('profiles_save_failed')
      expect(err.message).toContain('EACCES profiles.json')
      expect(store.profiles[0].name).toBe('工作')
      expect(store.activeProfileId).toBe('p1')
    })
  })

  describe('deleteProfile 删活跃方案', () => {
    it('主进程还没落地时不 resolve', async () => {
      const store = activeP1Store()
      let releaseSave: (value: { success: boolean }) => void = () => {}
      vi.mocked(api.saveGuiSettings).mockImplementationOnce(
        () => new Promise(resolve => { releaseSave = resolve }),
      )

      let settled = false
      const deleting = store.deleteProfile('p1').then(() => { settled = true })
      await Promise.resolve()

      expect(settled).toBe(false)
      expect(api.profilesSave).not.toHaveBeenCalled()

      releaseSave({ success: true })
      await deleting
      expect(settled).toBe(true)
      expect(store.activeProfileId).toBe('p2')
    })

    it('主进程写失败时被删的方案回来了，活动方案与配置也退回它', async () => {
      const store = activeP1Store()
      vi.mocked(api.saveGuiSettings).mockResolvedValueOnce({ success: false, error: 'EPERM gui-settings.json' })

      const err = await store.deleteProfile('p1').catch(e => e)

      expect(err.profileApplyFailure).toBe('settings_save_failed')
      expect(store.profiles.map(p => p.id)).toEqual(['p1', 'p2'])
      expect(store.activeProfileId).toBe('p1')
      expect(store.openaiConfig.baseUrl).toBe('https://p1.com')
      expect(lastPersistedProfiles().activeProfileId).toBe('p1')
      expect(lastPersistedProfiles().profiles).toHaveLength(2)
    })

    it('代理没按恢复后的配置起来时判为失败', async () => {
      const store = activeP1Store()
      vi.mocked(api.saveGuiSettings).mockResolvedValueOnce({
        success: true,
        proxy: { state: 'failed', error: 'EADDRINUSE 34567' },
      })

      const err = await store.deleteProfile('p1').catch(e => e)

      expect(err.profileApplyFailure).toBe('proxy_not_aligned')
      expect(store.profiles).toHaveLength(2)
      expect(store.activeProfileId).toBe('p1')
    })

    it('删非活跃方案只落 profiles.json，不重写主进程配置', async () => {
      const store = activeP1Store()

      await store.deleteProfile('p2')

      expect(store.profiles).toHaveLength(1)
      expect(store.activeProfileId).toBe('p1')
      expect(api.saveGuiSettings).not.toHaveBeenCalled()
      expect(api.profilesSave).toHaveBeenCalledOnce()
    })

    it('删非活跃方案时 profiles.json 写失败也要把方案恢复回来', async () => {
      const store = activeP1Store()
      vi.mocked(api.profilesSave).mockResolvedValueOnce({ success: false, error: 'EACCES profiles.json' })

      const err = await store.deleteProfile('p2').catch(e => e)

      expect(err.profileApplyFailure).toBe('profiles_save_failed')
      expect(store.profiles.map(p => p.id)).toEqual(['p1', 'p2'])
      expect(store.activeProfileId).toBe('p1')
      expect(api.saveGuiSettings).not.toHaveBeenCalled()
    })
  })

  // 票面点名的第三条链路：首次加载时发现 activeProfileId 指向不存在的方案，改用第一个之后要等落地。
  it('loadProfiles 的迁移分支等主进程落地后才返回', async () => {
    vi.mocked(api.profilesLoad).mockResolvedValue({
      success: true,
      data: JSON.stringify({ version: 1, activeProfileId: 'gone', profiles: [mockProfile('p1', '工作', 'https://p1.com')] }),
    })
    let releaseSave: (value: { success: boolean }) => void = () => {}
    vi.mocked(api.saveGuiSettings).mockImplementationOnce(
      () => new Promise(resolve => { releaseSave = resolve }),
    )

    const store = useSettingsStore()
    let loaded = false
    const loading = store.loadProfiles().then(() => { loaded = true })
    await Promise.resolve()

    expect(loaded).toBe(false)

    releaseSave({ success: true })
    await loading
    expect(store.activeProfileId).toBe('p1')
    expect(store.openaiConfig.baseUrl).toBe('https://p1.com')
  })
})
