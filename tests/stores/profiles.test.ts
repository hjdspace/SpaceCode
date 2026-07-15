import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock electronAPI：避免真实 IPC 调用。
// settings.ts 使用 `import { api } from '@/services/electronAPI'`（命名导入），
// 因此 mock 必须提供 `api` 作为命名导出。
vi.mock('@/services/electronAPI', () => ({
  api: {
    saveGuiSettings: vi.fn(() => Promise.resolve({ success: true })),
    loadGuiSettings: vi.fn(() => Promise.resolve({ success: true, data: null })),
    profilesLoad: vi.fn(() => Promise.resolve({ success: true, data: null })),
    profilesSave: vi.fn(() => Promise.resolve({ success: true })),
    profilesBackupCorrupt: vi.fn(() => Promise.resolve({ success: true })),
    getEnv: vi.fn(() => Promise.resolve(undefined)),
  },
}))

import { api } from '@/services/electronAPI'
import { useSettingsStore } from '@/stores/settings'
import type { AuthMethod } from '@/stores/settings'

function mockProfile(id: string, name: string, authMethod: AuthMethod = 'openai_compatible') {
  return {
    id,
    name,
    authMethod,
    anthropicConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    openaiConfig: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', haikuModel: '', sonnetModel: 'deepseek-chat', opusModel: '' },
    geminiConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    modelContextWindows: { 'deepseek-chat': 64000 },
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }
}

describe('settings store — profile actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('loadProfiles', () => {
    it('首次启动（profiles.json 不存在）触发迁移，创建"默认"Profile', async () => {
      const store = useSettingsStore()
      vi.mocked(api.profilesLoad).mockResolvedValue({ success: true, data: null })

      await store.loadProfiles()

      expect(store.profiles).toHaveLength(1)
      expect(store.profiles[0].name).toBe('默认')
      expect(store.activeProfileId).toBe(store.profiles[0].id)
      expect(api.profilesSave).toHaveBeenCalledOnce()
    })

    it('profiles.json 存在时加载 profiles 和 activeProfileId', async () => {
      const file = {
        version: 1 as const,
        activeProfileId: 'p1',
        profiles: [mockProfile('p1', '工作'), mockProfile('p2', '个人')],
      }
      vi.mocked(api.profilesLoad).mockResolvedValue({
        success: true,
        data: JSON.stringify(file),
      })

      const store = useSettingsStore()
      await store.loadProfiles()

      expect(store.profiles).toHaveLength(2)
      expect(store.activeProfileId).toBe('p1')
    })

    it('activeProfileId 指向不存在的 Profile 时重置为第一个', async () => {
      const file = {
        version: 1 as const,
        activeProfileId: 'nonexistent',
        profiles: [mockProfile('p1', '工作')],
      }
      vi.mocked(api.profilesLoad).mockResolvedValue({
        success: true,
        data: JSON.stringify(file),
      })

      const store = useSettingsStore()
      await store.loadProfiles()

      expect(store.activeProfileId).toBe('p1')
    })

    it('profiles.json 解析失败时备份损坏文件并触发迁移重建', async () => {
      vi.mocked(api.profilesLoad).mockResolvedValue({
        success: true,
        data: 'not-json{',
      })

      const store = useSettingsStore()
      await store.loadProfiles()

      expect(api.profilesBackupCorrupt).toHaveBeenCalledWith('not-json{')
      expect(store.profiles).toHaveLength(1)
      expect(store.profiles[0].name).toBe('默认')
    })
  })

  describe('applyProfile', () => {
    it('更新 config 字段 + 调用 saveSettings + 持久化 activeProfileId', async () => {
      const store = useSettingsStore()
      // 预置 profiles
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p1'

      await store.applyProfile('p2')

      expect(store.activeProfileId).toBe('p2')
      expect(store.authMethod).toBe('openai_compatible')
      expect(store.openaiConfig.baseUrl).toBe('https://api.deepseek.com')
      expect(api.saveGuiSettings).toHaveBeenCalled()
      expect(api.profilesSave).toHaveBeenCalled()
    })

    it('apply 失败时 activeProfileId 和 config 字段都回滚', async () => {
      const store = useSettingsStore()
      const p1 = mockProfile('p1', '工作')
      p1.openaiConfig = { baseUrl: 'https://p1.com', apiKey: 'sk-p1', haikuModel: '', sonnetModel: 'm1', opusModel: '' }
      store.profiles = [p1, mockProfile('p2', '个人', 'anthropic_compatible')]
      store.activeProfileId = 'p1'
      // 确保 p1 的 config 已应用
      store.authMethod = 'openai_compatible'
      store.openaiConfig = { ...p1.openaiConfig }

      vi.mocked(api.profilesSave).mockRejectedValueOnce(new Error('save failed'))

      await expect(store.applyProfile('p2')).rejects.toThrow('save failed')
      expect(store.activeProfileId).toBe('p1')
      expect(store.authMethod).toBe('openai_compatible')
      expect(store.openaiConfig.baseUrl).toBe('https://p1.com')
    })

    it('applyProfile 对不存在的 id 不做任何改变', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]
      store.activeProfileId = 'p1'
      vi.clearAllMocks()

      await store.applyProfile('nonexistent')

      expect(store.activeProfileId).toBe('p1')
      expect(api.profilesSave).not.toHaveBeenCalled()
    })
  })

  describe('createProfile', () => {
    it('以当前 config 为模板创建新 Profile', async () => {
      const store = useSettingsStore()
      store.authMethod = 'openai_compatible'
      store.openaiConfig = { baseUrl: 'https://x.com', apiKey: 'sk-x', haikuModel: '', sonnetModel: 'm1', opusModel: '' }

      const id = await store.createProfile('测试配置')

      expect(id).toBeTruthy()
      expect(store.profiles).toHaveLength(1)
      expect(store.profiles[0].name).toBe('测试配置')
      expect(store.profiles[0].openaiConfig.baseUrl).toBe('https://x.com')
      expect(store.expandedProfileId).toBe(id)
      expect(api.profilesSave).toHaveBeenCalled()
    })

    it('name 为空时自动填"未命名"', async () => {
      const store = useSettingsStore()
      const id = await store.createProfile('   ')
      expect(id).toBeTruthy()
      expect(store.profiles[0].name).toBe('未命名')
    })
  })

  describe('updateProfile', () => {
    it('更新指定 Profile 的字段', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]
      const originalUpdatedAt = store.profiles[0].updatedAt

      await new Promise(r => setTimeout(r, 5)) // 确保 timestamp 不同
      await store.updateProfile('p1', { name: '工作-改' })

      expect(store.profiles[0].name).toBe('工作-改')
      expect(store.profiles[0].updatedAt).not.toBe(originalUpdatedAt)
    })

    it('更新 active profile 时同步到 config + saveSettings', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]
      store.activeProfileId = 'p1'

      await store.updateProfile('p1', {
        openaiConfig: { baseUrl: 'https://new.com', apiKey: 'sk-new', haikuModel: '', sonnetModel: 'm2', opusModel: '' },
      })

      expect(store.openaiConfig.baseUrl).toBe('https://new.com')
      expect(api.saveGuiSettings).toHaveBeenCalled()
    })

    it('更新非 active profile 时不同步 config', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p1'
      vi.clearAllMocks()

      await store.updateProfile('p2', { name: '个人-改' })

      expect(store.profiles[1].name).toBe('个人-改')
      expect(api.saveGuiSettings).not.toHaveBeenCalled()
    })

    it('updateProfile 对不存在的 id 不做任何改变', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]
      vi.clearAllMocks()

      await store.updateProfile('nonexistent', { name: '改' })

      expect(store.profiles[0].name).toBe('工作')
      expect(api.profilesSave).not.toHaveBeenCalled()
    })
  })

  describe('deleteProfile', () => {
    it('删除非 active 的 Profile', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p1'

      await store.deleteProfile('p2')

      expect(store.profiles).toHaveLength(1)
      expect(store.profiles[0].id).toBe('p1')
    })

    it('删除 active Profile 时自动切换到第一个', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p2'

      await store.deleteProfile('p2')

      expect(store.activeProfileId).toBe('p1')
    })

    it('只剩 1 个时拒绝删除', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]
      store.activeProfileId = 'p1'

      await store.deleteProfile('p1')

      expect(store.profiles).toHaveLength(1)
    })

    it('deleteProfile 对不存在的 id 保留原列表', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p1'

      await store.deleteProfile('nonexistent')

      expect(store.profiles).toHaveLength(2)
    })
  })

  describe('duplicateProfile', () => {
    it('复制一份为新 Profile，名称加"副本"后缀', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]

      const newId = await store.duplicateProfile('p1')

      expect(store.profiles).toHaveLength(2)
      expect(store.profiles[1].id).toBe(newId)
      expect(store.profiles[1].name).toBe('工作 副本')
      expect(store.profiles[1].openaiConfig.baseUrl).toBe('https://api.deepseek.com')
      expect(store.expandedProfileId).toBe(newId)
    })

    it('duplicateProfile 对不存在的 id 返回空字符串', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]

      const result = await store.duplicateProfile('nonexistent')

      expect(result).toBe('')
      expect(store.profiles).toHaveLength(1)
    })
  })
})
