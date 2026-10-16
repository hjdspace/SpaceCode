// @vitest-environment node
/**
 * `settings:saveGuiSettings` 的排队契约 —— issue #42 第 9 项的服务端半边。
 *
 * 一次保存要做三件事：写 gui-settings.json、同步 ~/.claude/settings.json、把本地代理
 * 对齐到新上游。渲染端会连发两次（切配置方案尤其明显），并发跑时「最后一个写完文件的」
 * 和「最后一个对齐代理的」未必是同一批 —— 文件已经是新上游、代理还挂在旧上游，而两次
 * 保存都回 success。这里把两次保存压进同一个缝：前者代理没落地前，后者连文件都不许动。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Gate = { promise: Promise<void>; release: () => void; fail: (err: Error) => void }
type FakeConfig = { upstreamBaseUrl: string; upstreamApiKey: string; port: number }

const probe = vi.hoisted(() => {
  const mkGate = (): Gate => {
    let release = () => {}
    let fail = (_err: Error) => {}
    const promise = new Promise<void>((resolve, reject) => {
      release = resolve
      fail = reject
    })
    return { promise, release, fail }
  }
  return {
    ipcHandlers: {} as Record<string, (...args: any[]) => unknown>,
    writes: [] as Array<{ path: string; data: string }>,
    files: new Map<string, string>(),
    started: [] as FakeConfig[],
    stopped: 0,
    gates: [] as Gate[],
    running: false,
    current: null as FakeConfig | null,
    mkGate,
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      probe.ipcHandlers[channel] = handler
    }),
  },
  app: { getPath: () => '/home/tester' },
}))

vi.mock('fs', () => ({
  existsSync: (target: string) => probe.files.has(String(target)),
  readFileSync: (target: string) => {
    const raw = probe.files.get(String(target))
    if (raw === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return raw
  },
  writeFileSync: (target: string, data: string) => {
    probe.writes.push({ path: String(target), data })
    probe.files.set(String(target), data)
  },
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
}))

vi.mock('../../session/tokenStatsService', () => ({
  aggregateLocalTokenStats: vi.fn(async () => ({})),
}))

vi.mock('../../infra/proxyManager', () => ({
  buildProxyConfigFromSettings: (gui: Record<string, any>): FakeConfig | null => {
    const cfg = gui.openaiConfig
    if (!cfg?.baseUrl || !cfg?.apiKey) return null
    return { upstreamBaseUrl: cfg.baseUrl, upstreamApiKey: cfg.apiKey, port: 34567 }
  },
  isSameProxyConfig: (a: FakeConfig, b: FakeConfig) =>
    a.upstreamBaseUrl === b.upstreamBaseUrl && a.upstreamApiKey === b.upstreamApiKey,
  proxyManager: {
    isRunning: () => probe.running,
    getConfig: () => probe.current,
    start: (config: FakeConfig) => {
      const gate = probe.mkGate()
      probe.gates.push(gate)
      probe.started.push(config)
      return gate.promise.then(() => {
        probe.running = true
        probe.current = config
        return `http://127.0.0.1:${config.port}`
      })
    },
    stop: async () => {
      probe.stopped += 1
      probe.running = false
      probe.current = null
    },
  },
}))

const { registerSettingsIPCHandlers } = await import('../settingsIpc')

const GUI_PATH = '/home/tester/.claude/gui-settings.json'

function payload(baseUrl: string): string {
  return JSON.stringify({
    authMethod: 'openai_compatible',
    openaiConfig: { baseUrl, apiKey: 'k-1', sonnetModel: 'model-a' },
  })
}

/** 让真实微任务 + setImmediate 队列排空 —— 替身都在这些轮次里答复 */
async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
}

function savedPayloads(): string[] {
  // path.join 在 win32 上给出反斜杠，比对前先归一化分隔符
  return probe.writes
    .filter((write) => write.path.replace(/\\/g, '/') === GUI_PATH)
    .map((write) => write.data)
}

let save!: (...args: any[]) => any

beforeEach(() => {
  probe.writes.length = 0
  probe.files.clear()
  probe.started.length = 0
  probe.gates.length = 0
  probe.stopped = 0
  probe.running = false
  probe.current = null
  vi.clearAllMocks()
  registerSettingsIPCHandlers()
  save = probe.ipcHandlers['settings:saveGuiSettings']
})

describe('settings:saveGuiSettings — 保存排队', () => {
  it('第一次的代理还没落地，第二次连文件都不许动', async () => {
    const a = payload('https://first.test/v1')
    const b = payload('https://second.test/v1')

    const first = save({}, a)
    await flush()
    const second = save({}, b)
    await flush()

    expect(savedPayloads()).toEqual([a])
    expect(probe.started.map((c) => c.upstreamBaseUrl)).toEqual(['https://first.test/v1'])

    probe.gates[0].release()
    await flush()
    expect(probe.started).toHaveLength(2)

    probe.gates[1].release()
    await expect(first).resolves.toEqual({ success: true, proxy: { state: 'aligned' } })
    await expect(second).resolves.toEqual({ success: true, proxy: { state: 'aligned' } })

    // 文件顺序 == 请求顺序，代理最终跑的是最后一次请求的上游
    expect(savedPayloads()).toEqual([a, b])
    expect(probe.current!.upstreamBaseUrl).toBe('https://second.test/v1')
  })

  it('一次代理启动失败不卡死队列，后续保存照样对齐', async () => {
    const first = save({}, payload('https://first.test/v1'))
    await flush()
    probe.gates[0].fail(new Error('EADDRINUSE 34567'))

    await expect(first).resolves.toEqual({
      success: true,
      proxy: { state: 'failed', error: 'Error: EADDRINUSE 34567' },
    })

    const second = save({}, payload('https://second.test/v1'))
    await flush()
    probe.gates[1].release()

    await expect(second).resolves.toEqual({ success: true, proxy: { state: 'aligned' } })
    expect(probe.current!.upstreamBaseUrl).toBe('https://second.test/v1')
  })
})
