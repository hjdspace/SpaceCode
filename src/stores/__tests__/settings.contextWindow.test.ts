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

describe('settings store — 上下文窗口覆盖来源', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  async function setupStores() {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = {
      baseUrl: 'https://api.example/v1',
      apiKey: 'test-key',
      haikuModel: 'claude-haiku-4-5',
      sonnetModel: 'claude-sonnet-4-6',
      opusModel: 'claude-opus-4-6',
    }
    return settings
  }

  it('设置页写入的 modelCapabilities 就是生效的上下文窗口', async () => {
    const settings = await setupStores()
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 200_000 } }

    expect(settings.getContextWindowOverride('claude-opus-4-6')).toBe(200_000)
  })

  it('引擎别名按当前槽位反查上下文窗口', async () => {
    const settings = await setupStores()
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 200_000 } }

    expect(settings.getContextWindowOverride('opus')).toBe(200_000)
    expect(settings.getContextWindowOverride('sonnet')).toBeUndefined()
  })

  it('容忍 --model 用的 [1m] 后缀', async () => {
    const settings = await setupStores()
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 400_000 } }

    expect(settings.getContextWindowOverride('claude-opus-4-6[1m]')).toBe(400_000)
  })

  it('旧版持久化的 modelContextWindows 仍生效，冲突时以 modelCapabilities 为准', async () => {
    const settings = await setupStores()
    settings.modelContextWindows = { 'claude-opus-4-6': 1_000_000, 'claude-sonnet-4-6': 256_000 }
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 128_000 } }

    expect(settings.getContextWindowOverride('claude-opus-4-6')).toBe(128_000)
    expect(settings.getContextWindowOverride('claude-sonnet-4-6')).toBe(256_000)
  })

  it('非正数的输入框清空值不算覆盖', async () => {
    const settings = await setupStores()
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 0 } }

    expect(settings.getContextWindowOverride('claude-opus-4-6')).toBeUndefined()
  })

  it('传给独立 CLI 的压缩窗口 env 取自 modelCapabilities', async () => {
    const settings = await setupStores()
    settings.modelCapabilities = { 'claude-sonnet-4-6': { contextWindow: 300_000 } }

    expect(settings.buildEnvVars().CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('300000')
  })

  it('>200K 的配置才给独立 CLI 的模型名补 [1m] 后缀', async () => {
    const settings = await setupStores()
    settings.modelCapabilities = {
      'claude-sonnet-4-6': { contextWindow: 400_000 },
      'claude-opus-4-6': { contextWindow: 200_000 },
    }

    expect(settings.getModelWith1mSuffix('claude-sonnet-4-6')).toBe('claude-sonnet-4-6[1m]')
    expect(settings.getModelWith1mSuffix('claude-opus-4-6')).toBe('claude-opus-4-6')
  })
})
