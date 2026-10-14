import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Message } from '@/types'

const mocks = vi.hoisted(() => ({
  getContextUsage: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    // 保留在 mock 里: 下面的用例要断言 store 不再向引擎发这个控制请求
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

/** 上一轮 API 真实回报的用量: 40k + 10k = 50k 上下文占用 */
function lastCallUsage() {
  return {
    input_tokens: 40_000,
    output_tokens: 10_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

async function setupSessionOnOpus(withUsage = true) {
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
  if (withUsage) {
    session.messages.push({
      id: 'm-1',
      role: 'assistant',
      content: 'hi',
      metadata: { apiCallUsage: lastCallUsage() },
    } as unknown as Message)
  }
  return settings
}

describe('contextUsage store — 窗口与用量来源', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.getContextUsage.mockResolvedValue({ totalTokens: 1, rawMaxTokens: 1_000_000 })
  })

  it('设置页把 opus 改成 200K 后，用量按 200K 显示', async () => {
    const settings = await setupSessionOnOpus()
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 200_000 } }

    const { useContextUsageStore } = await import('../contextUsage')
    const store = useContextUsageStore()
    store.refresh('ctx-window')

    expect(store.snapshot?.data?.rawMaxTokens).toBe(200_000)
    expect(store.snapshot?.data?.totalTokens).toBe(50_000)
    expect(store.snapshot?.data?.percentage).toBe(25)
    expect(store.snapshot?.usedPercentage).toBe(25)
  })

  it('未配置上下文窗口时用客户端默认窗口', async () => {
    await setupSessionOnOpus()

    const { useContextUsageStore } = await import('../contextUsage')
    const store = useContextUsageStore()
    store.refresh('ctx-window')

    expect(store.snapshot?.data?.rawMaxTokens).toBe(200_000)
  })

  it('回合中的兜底快照同样按设置页的窗口计算', async () => {
    const settings = await setupSessionOnOpus()
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 200_000 } }

    const { useContextUsageStore } = await import('../contextUsage')
    const store = useContextUsageStore()
    store.applyFallback('ctx-window')

    expect(store.snapshot?.data?.rawMaxTokens).toBe(200_000)
  })

  it('不发 get_context_usage 控制请求 —— 它会占住 CLI 的串行 stdin 循环', async () => {
    await setupSessionOnOpus()

    const { useContextUsageStore } = await import('../contextUsage')
    const store = useContextUsageStore()
    store.refresh('ctx-window')
    store.applyFallback('ctx-window')

    expect(mocks.getContextUsage).not.toHaveBeenCalled()
  })

  it('会话没有任何用量记录时按消息内容估算，窗口仍取设置页配置', async () => {
    const settings = await setupSessionOnOpus(false)
    settings.modelCapabilities = { 'claude-opus-4-6': { contextWindow: 32_000 } }

    const { useContextUsageStore } = await import('../contextUsage')
    const store = useContextUsageStore()
    store.refresh('ctx-window')

    expect(store.snapshot?.data?.rawMaxTokens).toBe(32_000)
    expect(store.snapshot?.data?.totalTokens).toBe(0)
  })

  it('切换到别的会话 id 时不采纳它的快照', async () => {
    await setupSessionOnOpus()

    const { useContextUsageStore } = await import('../contextUsage')
    const store = useContextUsageStore()
    store.refresh('ctx-window')

    store.applyFallback('other-session')

    expect(store.snapshot?.data?.model).toBe('claude-opus-4-6')
  })
})
