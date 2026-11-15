import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

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
import type { ImageGenConfig } from '@/shared/imageGenReference'
import type { ModelProfile } from '@/types/profile'

const SETTINGS_KEY = 'claude_desktop_settings'

const CONFIG: ImageGenConfig = {
  presetId: 'zhipu',
  dialect: 'zhipu',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: 'zp-key',
  model: 'cogview-4',
  disableWatermark: false,
}

/** 主进程回读的形状：没有明文 key，只有「是否已配置」。 */
const REDACTED: ImageGenConfig = { ...CONFIG, apiKey: '', hasApiKey: true }

function profile(id: string, sonnetModel: string): ModelProfile {
  const provider = { baseUrl: 'https://x.test/v1', apiKey: 'chat-key', haikuModel: sonnetModel, sonnetModel, opusModel: sonnetModel }
  const now = new Date().toISOString()
  return {
    id,
    name: id,
    authMethod: 'openai_compatible',
    anthropicConfig: { ...provider },
    openaiConfig: { ...provider },
    geminiConfig: { ...provider },
    modelContextWindows: {},
    modelCapabilities: {},
    createdAt: now,
    updatedAt: now,
  }
}

async function setup() {
  const settings = useSettingsStore()
  await vi.waitFor(() => expect(settings.settingsReady).toBe(true))
  return settings
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('生图配置持久化', () => {
  it('默认未配置', async () => {
    expect((await setup()).imageGenConfig).toBeNull()
  })

  it('setImageGenConfig 把明文交主进程，本地只留脱敏副本', async () => {
    const settings = await setup()
    const result = await settings.setImageGenConfig(CONFIG)

    expect(result.success).toBe(true)
    expect(settings.imageGenConfig).toEqual({ ...CONFIG, hasApiKey: true })
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').imageGenConfig).toEqual(REDACTED)
    // saveGuiSettings 收的是序列化后的字符串，不是对象；明文只走这一条路
    expect(JSON.parse(vi.mocked(api.saveGuiSettings).mock.calls[0][0] as string).imageGenConfig)
      .toEqual({ ...CONFIG, hasApiKey: true })
  })

  it('明文 key 不落 localStorage —— 否则只写规则被本地存储绕过', async () => {
    const settings = await setup()
    await settings.setImageGenConfig(CONFIG)

    expect(localStorage.getItem(SETTINGS_KEY)).not.toContain(CONFIG.apiKey)
  })

  it('主进程读回来的配置会被应用（重启后仍在）', async () => {
    vi.mocked(api.loadGuiSettings).mockResolvedValue({ success: true, data: JSON.stringify({ imageGenConfig: REDACTED }) })
    const settings = await setup()

    expect(settings.imageGenConfig).toEqual(REDACTED)
  })

  it('留空 key 保存时沿用「已配置」标记 —— 渲染层没有明文，不该因此显示未配置', async () => {
    vi.mocked(api.loadGuiSettings).mockResolvedValue({ success: true, data: JSON.stringify({ imageGenConfig: REDACTED }) })
    const settings = await setup()

    await settings.setImageGenConfig({ ...REDACTED, model: 'cogview-4-flash' })

    expect(settings.imageGenConfig).toEqual({ ...REDACTED, model: 'cogview-4-flash' })
  })

  it('切换 Profile 不影响生图配置 —— 生图账号与对话账号是两套', async () => {
    vi.mocked(api.profilesLoad).mockResolvedValue({
      success: true,
      data: JSON.stringify({ version: 1, activeProfileId: 'a', profiles: [profile('a', 'model-a'), profile('b', 'model-b')] }),
    })
    const settings = await setup()
    await settings.setImageGenConfig(CONFIG)
    await settings.loadProfiles()

    await settings.applyProfile('b')

    expect(settings.getSonnetModel()).toBe('model-b')
    expect(settings.imageGenConfig).toEqual({ ...CONFIG, hasApiKey: true })
  })

  it('传 null 清空配置，且清空能被持久化', async () => {
    const settings = await setup()
    await settings.setImageGenConfig(CONFIG)
    await settings.setImageGenConfig(null)

    expect(settings.imageGenConfig).toBeNull()
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').imageGenConfig).toBeNull()
  })

  it('保存失败时把错误带回来，不谎报成功', async () => {
    vi.mocked(api.saveGuiSettings).mockResolvedValueOnce({ success: false, error: 'disk full' })
    const settings = await setup()

    const result = await settings.setImageGenConfig(CONFIG)

    expect(result.success).toBe(false)
    expect(result.error).toBe('disk full')
  })
})