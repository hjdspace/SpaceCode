import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  getContextUsage: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    getContextUsage: mocks.getContextUsage,
    claudeCode: {
      listAllSessions: vi.fn().mockResolvedValue([]),
      getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
      startSession: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    },
    image: null,
    trace: { event: vi.fn() },
    getCwd: vi.fn().mockResolvedValue(''),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

/** 引擎自述 1M 窗口的 /context 响应（opus-4-6 走远端模型能力目录拿到的就是 1M） */
function engineData() {
  return {
    totalTokens: 50_000,
    maxTokens: 1_000_000,
    rawMaxTokens: 1_000_000,
    percentage: 5,
    model: 'claude-opus-4-6',
    isAutoCompactEnabled: true,
    categories: [],
    apiUsage: {
      input_tokens: 40_000,
      output_tokens: 10_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

async function setupSessionOnOpus() {
  const { useSettingsStore } = await import('../settings')
  const settings = useSettingsStore()
  settings.authMethod = 'anthropic_compatible'
  settings.anthropicConfig = {
    baseUrl: 'https://api.example/v1',
    apiKey: 'test-key',
    haikuModel: '',
    sonnetModel: 'claude-sonnet-4-6',
    opusModel: 'claude-opus-4-6',
  }

  const { useChatSessionStore } = await import('../chatSession')
  const sessions = useChatSessionStore()
  const session = sessions.createSession('Test', 'D:/repo', 'ctx-window')
  session.model = 'claude-opus-4-6'
  return settings
}

describe('contextUsage store — 上下文窗口来源', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.getContextUsage.mockResolvedValue(engineData())
  })

  it('设置页把 opus 改成 200K 后，用量按 200K 显示而不是引擎自述的 1M', async () => {
    const settings = await setupSessionOnOpus()
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 200_000 } }

    const { useContextUsageStore } = await import('../contextUsage')
    const store = useContextUsageStore()
    await store.refresh('ctx-window')

    expect(store.snapshot?.data?.rawMaxTokens).toBe(200_000)
    expect(store.snapshot?.data?.percentage).toBe(25)
    expect(store.snapshot?.usedPercentage).toBe(25)
  })

  it('未配置上下文窗口时沿用引擎自述的窗口', async () => {
    await setupSessionOnOpus()

    const { useContextUsageStore } = await import('../contextUsage')
    const store = useContextUsageStore()
    await store.refresh('ctx-window')

    expect(store.snapshot?.data?.rawMaxTokens).toBe(1_000_000)
  })

  it('回合中的兜底快照同样按设置页的窗口计算', async () => {
    const settings = await setupSessionOnOpus()
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 200_000 } }

    const { useContextUsageStore } = await import('../contextUsage')
    const store = useContextUsageStore()
    store.applyFallback('ctx-window')

    expect(store.snapshot?.data?.rawMaxTokens).toBe(200_000)
  })
})
