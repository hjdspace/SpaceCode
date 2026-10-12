/**
 * modelCatalogStore — 模型目录磁盘缓存 / 网络拉取 / 回退链。
 * 覆盖:进程内缓存、新鲜磁盘缓存命中、过期缓存触发拉取、拉取失败回退过期缓存、
 * 完全无缓存且拉取失败返回空表、并发去重、缓存读写失败的兜底。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  httpFetch: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    app: { getPath: mocks.getPath },
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    httpFetch: mocks.httpFetch,
  },
}))

// 每次导入前重置模块, 以便让模块内的 `catalogRef` / `loadPromise` 重新初始化
async function importFresh() {
  vi.resetModules()
  return await import('@/lib/modelCatalogStore')
}

const NOW = Date.now()

function makeCacheJson(fetchedAt: number, catalog: object = { openai: { name: 'OpenAI', models: {} } }) {
  return JSON.stringify({ fetchedAt, catalog })
}

function makeCatalogPayload() {
  return {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      models: {
        'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
      },
    },
  }
}

beforeEach(() => {
  mocks.getPath.mockReset().mockResolvedValue('/userData')
  mocks.readFile.mockReset()
  mocks.writeFile.mockReset().mockResolvedValue(undefined)
  mocks.httpFetch.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loadModelCatalog', () => {
  it('磁盘缓存新鲜 (7 天内) → 直接命中并返回, 不发起网络请求', async () => {
    mocks.readFile.mockResolvedValue(makeCacheJson(NOW - 1000))
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(catalog).toEqual({ openai: { name: 'OpenAI', models: {} } })
    expect(mocks.httpFetch).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('磁盘缓存过期 → 联网拉取成功, 写入新缓存并返回', async () => {
    const stale = NOW - 8 * 24 * 60 * 60 * 1000 // 8 天前
    mocks.readFile.mockResolvedValue(makeCacheJson(stale))
    mocks.httpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: JSON.stringify(makeCatalogPayload()),
    })
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(mocks.httpFetch).toHaveBeenCalledWith(
      'https://models.dev/api.json',
      { timeoutMs: 10_000 },
    )
    expect(catalog.openai).toBeDefined()
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
  })

  it('无磁盘缓存 → 联网拉取成功', async () => {
    mocks.readFile.mockResolvedValue(null)
    mocks.httpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: JSON.stringify(makeCatalogPayload()),
    })
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(catalog.openai).toBeDefined()
  })

  it('联网失败 → 回退过期缓存', async () => {
    const stale = NOW - 8 * 24 * 60 * 60 * 1000
    const staleCatalog = { anthropic: { name: 'Anthropic', models: {} } }
    mocks.readFile.mockResolvedValue(makeCacheJson(stale, staleCatalog))
    mocks.httpFetch.mockResolvedValue({ ok: false, status: 500, data: '' })
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(catalog).toEqual(staleCatalog)
  })

  it('联网失败且无缓存 → 返回空对象', async () => {
    mocks.readFile.mockResolvedValue(null)
    mocks.httpFetch.mockRejectedValue(new Error('network down'))
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(catalog).toEqual({})
  })

  it('httpFetch 返回 ok=false → 视为失败, 走缓存回退', async () => {
    mocks.readFile.mockResolvedValue(null)
    mocks.httpFetch.mockResolvedValue({ ok: false, status: 503, data: '' })
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(catalog).toEqual({})
  })

  it('readFile 抛错 → 视为无缓存, 继续联网拉取', async () => {
    mocks.readFile.mockRejectedValue(new Error('disk error'))
    mocks.httpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: JSON.stringify(makeCatalogPayload()),
    })
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(catalog.openai).toBeDefined()
  })

  it('readFile 返回非法 JSON → 视为无缓存', async () => {
    mocks.readFile.mockResolvedValue('not-json{')
    mocks.httpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: JSON.stringify(makeCatalogPayload()),
    })
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(catalog.openai).toBeDefined()
  })

  it('缓存文件结构非法 (缺 fetchedAt) → 视为无缓存', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({ catalog: {} }))
    mocks.httpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: JSON.stringify(makeCatalogPayload()),
    })
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(catalog.openai).toBeDefined()
  })

  it('writeFile 抛错不影响功能 (静默吞掉)', async () => {
    mocks.readFile.mockResolvedValue(null)
    mocks.httpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: JSON.stringify(makeCatalogPayload()),
    })
    mocks.writeFile.mockRejectedValue(new Error('disk full'))
    const { loadModelCatalog } = await importFresh()

    const catalog = await loadModelCatalog()
    expect(catalog.openai).toBeDefined()
  })

  it('并发调用去重 → 第二次复用同一个 Promise', async () => {
    mocks.readFile.mockResolvedValue(null)
    mocks.httpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: JSON.stringify(makeCatalogPayload()),
    })
    const { loadModelCatalog } = await importFresh()

    const [a, b, c] = await Promise.all([
      loadModelCatalog(),
      loadModelCatalog(),
      loadModelCatalog(),
    ])
    expect(mocks.httpFetch).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('第二次调用 (同一模块实例) → 走进程内 catalogRef, 不再读盘也不联网', async () => {
    mocks.readFile.mockResolvedValue(makeCacheJson(NOW - 1000))
    const { loadModelCatalog } = await importFresh()

    await loadModelCatalog()
    mocks.readFile.mockClear()
    mocks.httpFetch.mockClear()

    await loadModelCatalog()
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.httpFetch).not.toHaveBeenCalled()
  })

  it('7 天边界: fetchedAt 恰好等于 NOW - TTL 视为不新鲜', async () => {
    const ttl = 7 * 24 * 60 * 60 * 1000
    // 用一个略早于 NOW - ttl 的时间戳, 因为执行 readCache 需要时间
    mocks.readFile.mockResolvedValue(makeCacheJson(NOW - ttl - 1))
    mocks.httpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: JSON.stringify(makeCatalogPayload()),
    })
    const { loadModelCatalog } = await importFresh()

    await loadModelCatalog()
    expect(mocks.httpFetch).toHaveBeenCalled()
  })
})
