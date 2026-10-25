/**
 * 第二个源到底通不通（票 06 第 5 条）。
 *
 * 握手超时有两种完全不同的成因：沙箱源没人监听（端口没暴露、防火墙拦了），
 * 或者源在但卡片自己起不来。前者要告诉运维去暴露端口，后者不该跟着一起喊部署问题。
 * 探测只问"这个源有没有回应"：`mode: 'no-cors'` 拿的是不透明响应，读不到任何内容，
 * 成功仅代表 TCP/HTTP 走通了 —— 沙箱源只有静态产物，多这一条查询不放大可读面。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { probeSandboxReachability } from '../sandboxProbe'

const SANDBOX = 'http://192.168.1.20:8081'

function pageAt(protocol: string) {
  return { protocol }
}

describe('可达性判定', () => {
  const fetchStub = vi.fn()

  beforeEach(() => {
    fetchStub.mockReset()
  })

  it('源没人监听时判为不可达', async () => {
    fetchStub.mockRejectedValue(new TypeError('Failed to fetch'))

    expect(await probeSandboxReachability(SANDBOX, { fetchImpl: fetchStub, page: pageAt('http:') })).toBe(
      'unreachable',
    )
  })

  it('源有回应就判可达，不看状态码也读不到内容', async () => {
    fetchStub.mockResolvedValue({ type: 'opaque', status: 0 })

    expect(await probeSandboxReachability(SANDBOX, { fetchImpl: fetchStub, page: pageAt('http:') })).toBe(
      'reachable',
    )
  })

  it('探的是沙箱文档入口，且不带凭据、不留缓存、不做 CORS 协商', async () => {
    fetchStub.mockResolvedValue({})
    await probeSandboxReachability(SANDBOX, { fetchImpl: fetchStub, page: pageAt('http:') })

    expect(fetchStub).toHaveBeenCalledWith(`${SANDBOX}/index.html`, {
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
    })
  })

  it('https 页面配 http 沙箱源时先判混合内容，不发那个一定会被拦的请求', async () => {
    expect(
      await probeSandboxReachability('http://sandbox.example:8081', {
        fetchImpl: fetchStub,
        page: pageAt('https:'),
      }),
    ).toBe('mixed-content')
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('沙箱源本身是 https 时正常探测', async () => {
    fetchStub.mockResolvedValue({})
    expect(
      await probeSandboxReachability('https://sandbox.example:8444', {
        fetchImpl: fetchStub,
        page: pageAt('https:'),
      }),
    ).toBe('reachable')
  })

  it('宿主没有 fetch 时不改口，沿用原本的握手超时说明', async () => {
    // 探不出去不等于源不可达：这时候把卡片说成部署问题，只会把用户支去查一个没坏的东西
    vi.stubGlobal('fetch', undefined)
    try {
      expect(await probeSandboxReachability(SANDBOX, { page: pageAt('http:') })).toBe('reachable')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('默认用当前窗口的 location 与全局 fetch', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    try {
      expect(await probeSandboxReachability(SANDBOX)).toBe('reachable')
    } finally {
      stub.mockRestore()
    }
  })
})

describe('默认页面源', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('页面是 https 而沙箱源是 http 时，默认判定就能认出混合内容', async () => {
    const fetchStub = vi.fn()
    vi.stubGlobal('fetch', fetchStub)
    vi.stubGlobal('location', { protocol: 'https:' })

    expect(await probeSandboxReachability('http://sandbox.example:8081')).toBe('mixed-content')
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
