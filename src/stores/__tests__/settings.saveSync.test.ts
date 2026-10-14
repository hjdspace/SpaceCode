import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * saveSettings 的"保存完成"含义 —— issue #40 问题 2 的时序部分。
 *
 * 界面把开关拨过去、文案显示已保存，但主进程的配置（以及跟着它重启的本地代理）
 * 可能还没更新：旧实现把 IPC 当 fire-and-forget 丢掉了。现在 saveSettings 返回那条
 * Promise，并且永不 reject —— 调用点大多是同步上下文，不能给他们留未处理的 rejection。
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

const SETTINGS_KEY = 'claude_desktop_settings'

async function setup() {
  localStorage.clear()
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  settings.authMethod = 'openai_compatible'
  settings.openaiConfig = {
    baseUrl: 'https://litellm.internal/v1',
    apiKey: 'sk-test',
    haikuModel: 'qwen3.8-27b',
    sonnetModel: 'qwen3.8-27b',
    opusModel: 'qwen3.8-27b',
  }
  return settings
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('saveSettings', () => {
  it('localStorage 同步写好，主进程要等返回的 Promise', async () => {
    const settings = await setup()
    settings.thinkingEnabled = false

    const synced = settings.saveSettings()

    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').thinkingEnabled).toBe(false)
    await expect(synced).resolves.toEqual({ success: true, proxyState: undefined, error: undefined })
  })

  it('代理没对齐时把状态带回来，而不是报成功', async () => {
    const settings = await setup()
    vi.mocked(api.saveGuiSettings).mockResolvedValueOnce({
      success: true,
      proxy: { state: 'failed', error: 'EADDRINUSE 34567' },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await settings.saveSettings()

    expect(result).toEqual({ success: true, proxyState: 'failed', error: undefined })
    expect(errorSpy).toHaveBeenCalledWith(
      '[Settings] Local proxy not aligned after save:',
      'EADDRINUSE 34567',
    )
    errorSpy.mockRestore()
  })

  it('IPC 抛错也只返回失败，不产生未处理的 rejection', async () => {
    const settings = await setup()
    vi.mocked(api.saveGuiSettings).mockRejectedValueOnce(new Error('ipc bridge gone'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(settings.saveSettings()).resolves.toEqual({
      success: false,
      proxyState: undefined,
      error: 'Error: ipc bridge gone',
    })

    errorSpy.mockRestore()
  })
})
