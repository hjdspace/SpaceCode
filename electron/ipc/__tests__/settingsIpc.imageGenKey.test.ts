// @vitest-environment node
/**
 * 生图 key 的只写契约（issue #107）。
 *
 * 「读设置」不等于「读密钥」：渲染层能填入并保存 key，回读只拿到 hasApiKey。
 * 而渲染层手里既然没有明文，它每次保存交上来的都是空 key —— 落盘前必须把磁盘上那份
 * 合并回来，否则改一次字号就把生图 key 抹掉了。主进程执行面读的是同一份文件，仍要拿到明文。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({
  ipcHandlers: {} as Record<string, (...args: unknown[]) => unknown>,
  files: new Map<string, string>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      probe.ipcHandlers[channel] = handler
    }),
  },
  app: { getPath: () => '/home/tester' },
}))

// path.join 在 win32 上给出反斜杠，替身按归一化后的键存，断言才能用同一个字面量
const norm = (target: string) => String(target).replace(/\\/g, '/')

vi.mock('fs', () => ({
  existsSync: (target: string) => probe.files.has(norm(target)),
  readFileSync: (target: string) => {
    const raw = probe.files.get(norm(target))
    if (raw === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return raw
  },
  writeFileSync: (target: string, data: string) => { probe.files.set(norm(target), data) },
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
  buildProxyConfigFromSettings: () => null,
  isSameProxyConfig: () => true,
  proxyManager: { isRunning: () => false, getConfig: () => null, start: vi.fn(), stop: vi.fn() },
}))

const { registerSettingsIPCHandlers, loadGuiSettings } = await import('../settingsIpc')

const GUI_PATH = '/home/tester/.claude/gui-settings.json'

function disk(): string {
  return probe.files.get(GUI_PATH) ?? ''
}

function settingsPayload(apiKey: string, fontSize = 15): string {
  return JSON.stringify({
    authMethod: 'claudeai',
    appearance: { fontSize },
    imageGenConfig: {
      presetId: 'ark',
      dialect: 'seedream',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey,
      model: 'doubao-seedream-4-0-250828',
      disableWatermark: false,
      hasApiKey: true,
    },
  })
}

let save!: (event: unknown, data: string) => Promise<{ success: boolean }>
let load!: () => Promise<{ success: boolean; data: string | null }>

beforeEach(() => {
  probe.files.clear()
  vi.clearAllMocks()
  registerSettingsIPCHandlers()
  save = probe.ipcHandlers['settings:saveGuiSettings'] as typeof save
  load = probe.ipcHandlers['settings:loadGuiSettings'] as typeof load
})

describe('生图 key 只写', () => {
  it('保存后磁盘留着明文 key，回读给渲染层只有「是否已配置」', async () => {
    await expect(save({}, settingsPayload('ark-secret'))).resolves.toEqual({ success: true, proxy: { state: 'not-needed' } })
    expect(JSON.parse(disk()).imageGenConfig.apiKey).toBe('ark-secret')

    const result = await load()
    expect(result.data).not.toContain('ark-secret')
    expect(JSON.parse(result.data!).imageGenConfig).toMatchObject({ apiKey: '', hasApiKey: true })
  })

  it('渲染层拿着脱敏那份改字号再保存，key 不会被抹掉', async () => {
    await save({}, settingsPayload('ark-secret'))
    const redacted = JSON.parse((await load()).data!)

    await save({}, JSON.stringify({ ...redacted, appearance: { fontSize: 18 } }))

    expect(JSON.parse(disk()).imageGenConfig.apiKey).toBe('ark-secret')
    expect(JSON.parse(disk()).appearance.fontSize).toBe(18)
  })

  it('填了新 key 就覆盖旧的', async () => {
    await save({}, settingsPayload('old-key'))
    await save({}, settingsPayload('new-key'))
    expect(JSON.parse(disk()).imageGenConfig.apiKey).toBe('new-key')
  })

  it('主进程执行面读同一份文件仍拿得到明文 key', async () => {
    await save({}, settingsPayload('ark-secret'))
    expect((await loadGuiSettings())?.imageGenConfig.apiKey).toBe('ark-secret')
  })

  it('没配过生图时回读原样，不凭空造出一段配置', async () => {
    const raw = JSON.stringify({ authMethod: 'claudeai' })
    await save({}, raw)
    expect((await load()).data).toBe(raw)
  })

  it('清空生图配置后 key 一起消失，hasApiKey 不再谎报', async () => {
    await save({}, settingsPayload('ark-secret'))
    await save({}, JSON.stringify({ authMethod: 'claudeai', imageGenConfig: null }))
    expect(disk()).not.toContain('ark-secret')
    expect(JSON.parse(disk()).imageGenConfig).toBeNull()
  })
})