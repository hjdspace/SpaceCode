import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 模块级 connectionConfig 是单例状态：每个用例 resetModules 后动态导入，
// 让懒解析/缓存的断言互不串台（先例：turn 测试的动态导入模式）。
type ApiClientModule = typeof import('../h5ApiClient')

const jsdomOrigin = 'http://localhost:3000'

function setUrl(query: string): void {
  window.history.replaceState(null, '', `/${query}`)
}

function makeRes(opts: {
  ok: boolean
  status?: number
  statusText?: string
  body?: unknown
  jsonError?: Error
}) {
  return {
    ok: opts.ok,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? '',
    json: () => (opts.jsonError ? Promise.reject(opts.jsonError) : Promise.resolve(opts.body)),
  }
}

describe('h5ApiClient', () => {
  let mod: ApiClientModule
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mod = await import('../h5ApiClient')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setUrl('')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  describe('initH5Connection — URL 解析', () => {
    it('URL 无 token 返回 null', () => {
      setUrl('')
      expect(mod.initH5Connection()).toBeNull()
      expect(mod.getH5Config()).toBeNull()
    })

    it('有 token 时解析出 baseUrl 与 token', () => {
      setUrl('?token=h5_abc&other=1')
      expect(mod.initH5Connection()).toEqual({
        baseUrl: `${jsdomOrigin}`,
        token: 'h5_abc',
      })
    })

    it('重复调用覆盖旧配置', () => {
      setUrl('?token=old')
      mod.initH5Connection()
      setUrl('?token=new')
      expect(mod.initH5Connection()).toEqual({ baseUrl: jsdomOrigin, token: 'new' })
      expect(mod.getH5Config()?.token).toBe('new')
    })

    it('typeof window === undefined 时安全返回 null', () => {
      vi.stubGlobal('window', undefined)
      expect(mod.initH5Connection()).toBeNull()
      expect(mod.isH5Mode()).toBe(false)
    })
  })

  describe('getH5Config — 懒解析与缓存', () => {
    it('未显式 init 时从 URL 懒解析', () => {
      setUrl('?token=lazy')
      expect(mod.getH5Config()).toEqual({ baseUrl: jsdomOrigin, token: 'lazy' })
    })

    it('首次解析后缓存，URL 再变也不重读', () => {
      setUrl('?token=first')
      const first = mod.getH5Config()
      setUrl('?token=second')
      expect(mod.getH5Config()).toBe(first)
    })
  })

  describe('isH5Mode', () => {
    it('Electron 环境下即使有 token 也返回 false', () => {
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {}
      setUrl('?token=h5_abc')
      expect(mod.isH5Mode()).toBe(false)
    })

    it('无 electronAPI 且有 token 返回 true', () => {
      setUrl('?token=h5_abc')
      expect(mod.isH5Mode()).toBe(true)
    })

    it('无 token 返回 false', () => {
      setUrl('')
      expect(mod.isH5Mode()).toBe(false)
    })
  })

  describe('h5Fetch — 经公开方法验证请求形态', () => {
    it('未初始化（URL 无 token）时抛错', async () => {
      setUrl('')
      await expect(mod.h5ApiClient.getActiveSessions()).rejects.toThrow(
        'H5 connection not initialized',
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('POST 带 JSON 头、序列化 body 与 Bearer token', async () => {
      setUrl('?token=h5_abc')
      fetchMock.mockResolvedValueOnce(makeRes({ ok: true, body: { ok: 1 } }))

      await mod.h5ApiClient.startSession('s1', { model: 'x' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${jsdomOrigin}/api/session/start`)
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({
        Authorization: 'Bearer h5_abc',
        'Content-Type': 'application/json',
      })
      expect(JSON.parse(init.body)).toEqual({ sessionId: 's1', config: { model: 'x' } })
    })

    it('sendMessage 把 meta 展开进 body（JSON.stringify 丢弃 undefined 字段）', async () => {
      setUrl('?token=h5_abc')
      fetchMock.mockResolvedValueOnce(makeRes({ ok: true, body: {} }))

      await mod.h5ApiClient.sendMessage('s1', '你好', undefined, {
        clientMessageId: 'cm1',
        displayContent: '显示文本',
      })

      const init = fetchMock.mock.calls[0][1]
      expect(JSON.parse(init.body)).toEqual({
        sessionId: 's1',
        content: '你好',
        clientMessageId: 'cm1',
        displayContent: '显示文本',
      })
    })

    it('GET 不带 body 与 Content-Type', async () => {
      setUrl('?token=h5_abc')
      fetchMock.mockResolvedValueOnce(makeRes({ ok: true, body: [] }))

      await mod.h5ApiClient.getActiveSessions()

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${jsdomOrigin}/api/sessions/active`)
      expect(init.method).toBe('GET')
      expect(init.headers).toEqual({ Authorization: 'Bearer h5_abc' })
      expect(init.body).toBeUndefined()
    })

    it('成功时返回解析后的 JSON', async () => {
      setUrl('?token=h5_abc')
      const payload = [{ sessionId: 'a' }]
      fetchMock.mockResolvedValueOnce(makeRes({ ok: true, body: payload }))

      await expect(mod.h5ApiClient.getActiveSessions()).resolves.toBe(payload)
    })

    it('非 ok 且响应体含 error 时抛出该 error', async () => {
      setUrl('?token=h5_abc')
      fetchMock.mockResolvedValueOnce(makeRes({ ok: false, status: 400, body: { error: 'boom' } }))

      await expect(mod.h5ApiClient.abort('s1')).rejects.toThrow('boom')
    })

    it('非 ok 且响应体无 error 字段时回退到 HTTP {status}', async () => {
      setUrl('?token=h5_abc')
      fetchMock.mockResolvedValueOnce(makeRes({ ok: false, status: 500, body: {} }))

      await expect(mod.h5ApiClient.abort('s1')).rejects.toThrow('HTTP 500')
    })

    it('非 ok 且响应体非 JSON 时回退到 statusText，空 statusText 再回退到状态码', async () => {
      setUrl('?token=h5_abc')
      fetchMock.mockResolvedValueOnce(
        makeRes({ ok: false, status: 502, statusText: 'Bad Gateway', jsonError: new Error('not json') }),
      )
      await expect(mod.h5ApiClient.abort('s1')).rejects.toThrow('Bad Gateway')

      fetchMock.mockResolvedValueOnce(
        makeRes({ ok: false, status: 500, statusText: '', jsonError: new Error('not json') }),
      )
      await expect(mod.h5ApiClient.abort('s1')).rejects.toThrow('HTTP 500')
    })
  })

  describe('URL query 编码', () => {
    beforeEach(() => {
      setUrl('?token=h5_abc')
      fetchMock.mockResolvedValue(makeRes({ ok: true, body: {} }))
    })

    it('listProjectSessions 对 projectPath 做 encodeURIComponent', async () => {
      const cwd = 'D:/项目 目录'
      await mod.h5ApiClient.listProjectSessions(cwd)
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${jsdomOrigin}/api/sessions/list?projectPath=${encodeURIComponent(cwd)}`,
      )
    })

    it('restoreSession 对 projectPath 与 sessionId 都做编码', async () => {
      const projectPath = '/Users/张三/proj'
      const sessionId = 'id with space&x'
      await mod.h5ApiClient.restoreSession(sessionId, projectPath)
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${jsdomOrigin}/api/sessions/history?projectPath=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`,
      )
    })
  })

  describe('路径映射抽查', () => {
    beforeEach(() => {
      setUrl('?token=h5_abc')
      fetchMock.mockResolvedValue(makeRes({ ok: true, body: {} }))
    })

    it('代表性方法映射到对应端点', async () => {
      const cases: Array<[string, () => Promise<unknown>, string]> = [
        ['stop', () => mod.h5ApiClient.stop('s'), '/api/session/stop'],
        ['setMirrorSession', () => mod.h5ApiClient.setMirrorSession(null, null), '/api/mirror-session'],
        ['httpFetch', () => mod.h5ApiClient.httpFetch('http://x'), '/api/http/fetch'],
        ['readFile', () => mod.h5ApiClient.readFile('/a'), '/api/fs/read-file'],
        ['isEngineAvailable', () => mod.h5ApiClient.isEngineAvailable('pi'), '/api/engine/available'],
        ['searchFiles', () => mod.h5ApiClient.searchFiles('/a', 'q'), '/api/fs/search-files'],
      ]

      for (const [, invoke, expected] of cases) {
        await invoke()
      }

      expect(fetchMock.mock.calls.map(c => c[0])).toEqual(
        cases.map(([, , expected]) => `${jsdomOrigin}${expected}`),
      )
    })
  })
})
