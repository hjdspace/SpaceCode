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
import { DEFAULT_ROUTER_CONFIG, normalizeRouterConfig, useSettingsStore } from '../settings'
import type { ModelProfile } from '@/types/profile'

const SETTINGS_KEY = 'claude_desktop_settings'

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

describe('助手路由配置', () => {
  it('默认开启并跟随快速模型', async () => {
    expect((await setup()).routerConfig).toEqual(DEFAULT_ROUTER_CONFIG)
    expect(DEFAULT_ROUTER_CONFIG).toEqual({ enabled: true, modelSource: 'follow-fast' })
  })

  it('保存后能随重启恢复', async () => {
    const settings = await setup()
    settings.routerConfig = {
      enabled: false,
      modelSource: 'custom',
      provider: 'openai',
      baseUrl: 'https://router.test/v1',
      apiKey: 'sk-router',
      model: 'cheap-router',
    }

    await settings.saveSettings()

    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').routerConfig).toEqual(settings.routerConfig)
    const sent = JSON.parse(vi.mocked(api.saveGuiSettings).mock.calls[0][0] as string)
    expect(sent.routerConfig).toEqual(settings.routerConfig)
  })

  it('从 gui-settings 读回时收敛损坏形状', async () => {
    vi.mocked(api.loadGuiSettings).mockResolvedValue({
      success: true,
      data: JSON.stringify({ routerConfig: { enabled: 'nope', modelSource: 'jev', provider: 'other' } }),
    })

    const settings = await setup()

    expect(settings.routerConfig).toEqual({ enabled: true, modelSource: 'follow-fast' })
  })

  it('切换 Profile 不改变路由配置', async () => {
    vi.mocked(api.profilesLoad).mockResolvedValue({
      success: true,
      data: JSON.stringify({ version: 1, activeProfileId: 'a', profiles: [profile('a', 'model-a'), profile('b', 'model-b')] }),
    })
    const settings = await setup()
    settings.routerConfig = { enabled: true, modelSource: 'custom', provider: 'anthropic', apiKey: 'sk-router', model: 'cheap' }
    await settings.loadProfiles()

    await settings.applyProfile('b')

    expect(settings.getSonnetModel()).toBe('model-b')
    expect(settings.routerConfig).toEqual({ enabled: true, modelSource: 'custom', provider: 'anthropic', apiKey: 'sk-router', model: 'cheap' })
  })

  it('setRouterConfig 局部合并并立即落盘', async () => {
    const settings = await setup()
    settings.routerConfig = {
      enabled: true,
      modelSource: 'custom',
      provider: 'openai',
      baseUrl: 'https://router.test/v1',
      apiKey: 'sk-router',
      model: 'cheap',
    }

    await settings.setRouterConfig({ enabled: false })

    expect(settings.routerConfig).toEqual({
      enabled: false,
      modelSource: 'custom',
      provider: 'openai',
      baseUrl: 'https://router.test/v1',
      apiKey: 'sk-router',
      model: 'cheap',
    })
    const calls = vi.mocked(api.saveGuiSettings).mock.calls
    const sent = JSON.parse(calls[calls.length - 1][0] as string)
    expect(sent.routerConfig.enabled).toBe(false)
  })

  it('开关可以从关闭切回开启，custom 连接字段随之保留', async () => {
    const settings = await setup()
    await settings.setRouterConfig({
      enabled: false,
      modelSource: 'custom',
      provider: 'anthropic',
      apiKey: 'sk-router',
      model: 'cheap',
    })
    await settings.setRouterConfig({ enabled: true })

    expect(settings.routerConfig).toEqual({
      enabled: true,
      modelSource: 'custom',
      provider: 'anthropic',
      apiKey: 'sk-router',
      model: 'cheap',
    })
  })

  it('空串 patch 能清掉 custom 连接字段，不会留下半截配置', async () => {
    const settings = await setup()
    settings.routerConfig = {
      enabled: true,
      modelSource: 'custom',
      provider: 'openai',
      baseUrl: 'https://router.test/v1',
      apiKey: 'sk-router',
      model: 'cheap',
    }

    await settings.setRouterConfig({ apiKey: '', baseUrl: '', model: '' })

    expect(settings.routerConfig).toEqual({ enabled: true, modelSource: 'custom', provider: 'openai' })
    expect(normalizeRouterConfig(settings.routerConfig)).toEqual(settings.routerConfig)
  })
})

describe('normalizeRouterConfig', () => {
  it('fills defaults for missing or malformed values', () => {
    expect(normalizeRouterConfig(undefined)).toEqual(DEFAULT_ROUTER_CONFIG)
    expect(normalizeRouterConfig(null)).toEqual(DEFAULT_ROUTER_CONFIG)
    expect(normalizeRouterConfig('custom')).toEqual(DEFAULT_ROUTER_CONFIG)
    expect(normalizeRouterConfig({ modelSource: 'follow-fast' })).toEqual(DEFAULT_ROUTER_CONFIG)
  })

  it('keeps valid custom fields', () => {
    expect(normalizeRouterConfig({
      enabled: false,
      modelSource: 'custom',
      provider: 'openai',
      baseUrl: 'https://router.test/v1',
      apiKey: 'sk-router',
      model: 'cheap',
    })).toEqual({
      enabled: false,
      modelSource: 'custom',
      provider: 'openai',
      baseUrl: 'https://router.test/v1',
      apiKey: 'sk-router',
      model: 'cheap',
    })
  })
})
