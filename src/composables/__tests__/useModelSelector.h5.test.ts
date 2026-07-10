import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useModelSelector } from '../useModelSelector'
import { useSettingsStore } from '@/stores/settings'

const mockState = vi.hoisted(() => ({
  httpFetch: vi.fn(),
}))

vi.mock('@/services/h5ApiClient', () => ({
  isH5Mode: () => true,
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    httpFetch: mockState.httpFetch,
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(''),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
    trace: { event: vi.fn() },
  },
}))

describe('useModelSelector in H5 mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    mockState.httpFetch.mockReset()
    mockState.httpFetch.mockResolvedValue({ ok: false, status: 0, error: 'URL is not allowed' })
  })

  it('uses configured desktop models without auto-fetching provider model lists', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.authMethod = 'anthropic_compatible'
    settingsStore.anthropicConfig = {
      ...settingsStore.anthropicConfig,
      apiKey: 'sk-from-desktop',
      baseUrl: 'http://127.0.0.1:4000/v1',
      sonnetModel: 'desktop-sonnet-model',
    }

    const selector = useModelSelector()

    expect(selector.canRefreshModels.value).toBe(false)

    await selector.fetchModelsFromBaseUrl()

    expect(mockState.httpFetch).not.toHaveBeenCalled()
    expect(selector.modelLoadError.value).toBeNull()
    expect(selector.availableModels.value[0]).toEqual({
      label: 'desktop-sonnet-model',
      value: 'desktop-sonnet-model',
    })
  })
})
