// @vitest-environment node
/**
 * 打包环境的沙箱资源服务 — 自定义协议处理器（票 01 第 2 条）。
 *
 * 只断言外部可观察行为：给一个请求 URL，返回什么状态、什么 MIME、带不带 CSP 头、
 * 读到什么内容。资源根注入为临时目录，于是同一套闸门同时服务协议与开发期静态服务。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}))

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { protocol } from 'electron'
import { GENUI_SANDBOX_CSP, GENUI_SANDBOX_HOST, GENUI_SANDBOX_SCHEME } from '@/shared/genuiSandbox'
import { createSandboxRequestHandler, registerGenuiSandboxProtocol, registerGenuiSandboxScheme } from '../sandboxProtocol'

/** 去掉逐响应注入的一次性 nonce，剩下的必须与共用口径逐字一致。 */
function withoutNonce(csp: string | null): string {
  return (csp ?? '').replace(/ 'nonce-[^']+'/g, '')
}

const root = mkdtempSync(join(tmpdir(), 'genui-sandbox-'))
const OUTSIDE_SENTINEL = 'sentinel-outside-sandbox-root'

mkdirSync(join(root, 'assets'), { recursive: true })
mkdirSync(join(root, 'empty-dir'), { recursive: true })
// 与真实产物同形：文档自带一条 CSP meta（打包环境里就是 sandbox/index.html 的那一份），
// 下发时必须被改写成与响应头同一条策略
writeFileSync(
  join(root, 'index.html'),
  `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${GENUI_SANDBOX_CSP}" />` +
    '<title>t</title></head><body>card</body></html>',
)
writeFileSync(join(root, 'assets', 'sandbox.js'), 'console.log("sandbox")')
writeFileSync(join(root, 'assets', 'sandbox.css'), '#card{color:red}')
writeFileSync(join(root, 'assets', 'icon.svg'), '<svg></svg>')
writeFileSync(join(root, 'assets', 'font.woff2'), 'binary-font')
writeFileSync(join(root, 'assets', 'notes.txt'), OUTSIDE_SENTINEL)
const outsideFile = join(tmpdir(), 'genui-sandbox-outside.txt')
writeFileSync(outsideFile, OUTSIDE_SENTINEL)

/** Windows 上创建符号链接需要特权，探测失败时跳过逃逸用例而不是假装通过。 */
function probeSymlinkSupport(dir: string): boolean {
  try {
    symlinkSync(outsideFile, join(dir, 'escape-probe'), 'file')
    return true
  } catch {
    return false
  } finally {
    rmSync(join(dir, 'escape-probe'), { force: true })
  }
}
const canSymlink = probeSymlinkSupport(root)

const handle = createSandboxRequestHandler({ resourceRoot: root })

async function get(path: string, method = 'GET') {
  const res = await handle({ url: `${GENUI_SANDBOX_SCHEME}://${GENUI_SANDBOX_HOST}${path}`, method })
  return { status: res.status, headers: res.headers, body: await res.text() }
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outsideFile, { force: true })
})

describe('协议注册', () => {
  it('在 app ready 前把沙箱协议注册为 standard + secure，且不放行 CORS 与 fetch', () => {
    registerGenuiSandboxScheme()
    const schemeCalls = vi.mocked(protocol.registerSchemesAsPrivileged).mock.calls
    const call = schemeCalls[schemeCalls.length - 1]?.[0]
    const entry = (call as Array<{ scheme: string; privileges: Record<string, boolean> }>)[0]
    expect(entry.scheme).toBe(GENUI_SANDBOX_SCHEME)
    expect(entry.privileges.standard).toBe(true)
    expect(entry.privileges.secure).toBe(true)
    expect(entry.privileges.corsEnabled).toBeFalsy()
    expect(entry.privileges.supportFetchAPI).toBeFalsy()
    expect(entry.privileges.bypassCSP).toBeFalsy()
    expect(entry.privileges.allowServiceWorkers).toBeFalsy()
  })

  it('ready 之后把同一个处理器挂到传入的每一个 session，而不是默认 session', () => {
    const first = { handle: vi.fn() }
    const second = { handle: vi.fn() }

    registerGenuiSandboxProtocol({ resourceRoot: root, hosts: [first, second] })

    expect(first.handle).toHaveBeenCalledWith(GENUI_SANDBOX_SCHEME, expect.any(Function))
    expect(second.handle).toHaveBeenCalledWith(GENUI_SANDBOX_SCHEME, expect.any(Function))
    // 主窗口不在默认 session：挂到顶层 protocol 等于打包态打不开卡片
    expect(vi.mocked(protocol.handle)).not.toHaveBeenCalled()
  })

  it('多个 session 拿到的是同一个处理器实例', () => {
    const first = { handle: vi.fn() }
    const second = { handle: vi.fn() }

    registerGenuiSandboxProtocol({ resourceRoot: root, hosts: [first, second] })

    expect(first.handle.mock.calls[0]?.[1]).toBe(second.handle.mock.calls[0]?.[1])
  })
})

describe('沙箱文档与资源', () => {
  it('入口文档带正确 MIME 与沙箱 CSP', async () => {
    const res = await get('/index.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(withoutNonce(res.headers.get('content-security-policy'))).toBe(GENUI_SANDBOX_CSP)
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self' 'unsafe-eval' 'nonce-[^']+'/)
    // 文档执行的是 meta ∩ 响应头：meta 不同步改写，头里的 nonce 就永远授权不到东西
    expect(res.body.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]).toBe(
      res.headers.get('content-security-policy'),
    )
    expect(res.body).toContain('card')
  })

  it('CSP 逐响应下发，nonce 每次换新且不放回内联脚本', async () => {
    const first = (await get('/index.html')).headers.get('content-security-policy') ?? ''
    const second = (await get('/index.html')).headers.get('content-security-policy') ?? ''

    expect(first).not.toBe(second)
    expect(withoutNonce(first)).toBe(withoutNonce(second))
    // 动态口令的意义在于不必回头放开 'unsafe-inline'：这条永远不该出现在沙箱 CSP 里
    expect(first).not.toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline'")
    expect(first).not.toMatch(/script-src[^;]*unsafe-inline/)
  })

  it('根路径落到入口文档', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  it.each([
    ['/assets/sandbox.js', 'application/javascript; charset=utf-8'],
    ['/assets/sandbox.css', 'text/css; charset=utf-8'],
    ['/assets/icon.svg', 'image/svg+xml'],
    ['/assets/font.woff2', 'font/woff2'],
  ])('%s 的 MIME 正确', async (path, expected) => {
    const res = await get(path)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(expected)
  })

  it('每个响应都禁止被嗅探成脚本，且不放开任意源', async () => {
    const res = await get('/assets/sandbox.js')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    // 子资源同样逐响应下发 CSP，不只文档带
    expect(withoutNonce(res.headers.get('content-security-policy'))).toBe(GENUI_SANDBOX_CSP)
  })
})

describe('越界读取一律失败', () => {
  it.each([
    '../genui-sandbox-outside.txt',
    '..%2fgenui-sandbox-outside.txt',
    'assets/../../genui-sandbox-outside.txt',
    '..%2f..%2fgenui-sandbox-outside.txt',
  ])('穿越路径 %s 读不到资源根外的文件', async (raw) => {
    const res = await get(`/${raw}`)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.body).not.toContain(OUTSIDE_SENTINEL)
  })

  it('NUL 字节与反斜杠穿越不落到文件系统', async () => {
    expect((await get('/index.html%00.png')).status).toBeGreaterThanOrEqual(400)
    expect((await get('\\..\\genui-sandbox-outside.txt')).status).toBeGreaterThanOrEqual(400)
  })

  it.skipIf(!canSymlink)('符号链接指向资源根外时被 realpath 闸门拦下', async () => {
    symlinkSync(outsideFile, join(root, 'link.txt'))
    const res = await get('/link.txt')
    rmSync(join(root, 'link.txt'), { force: true })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.body).not.toContain(OUTSIDE_SENTINEL)
  })

  it('不存在的文件与目录都失败，且不做目录列举', async () => {
    expect((await get('/nope.html')).status).toBe(404)
    const dir = await get('/empty-dir')
    expect(dir.status).toBe(404)
    expect(dir.body).not.toContain('empty-dir')
  })

  it('白名单之外的扩展名即便存在也不服务', async () => {
    const res = await get('/assets/notes.txt')
    expect(res.status).toBe(404)
    expect(res.body).not.toContain(OUTSIDE_SENTINEL)
  })

  it('非本沙箱 host 的请求不服务', async () => {
    const res = await handle({ url: `${GENUI_SANDBOX_SCHEME}://other-host/index.html`, method: 'GET' })
    expect(res.status).toBe(404)
  })

  it('只服务 GET 与 HEAD', async () => {
    expect((await handle({ url: `${GENUI_SANDBOX_SCHEME}://${GENUI_SANDBOX_HOST}/index.html`, method: 'POST' })).status).toBe(405)
  })

  it('非法 URL 直接失败而不是抛给协议层', async () => {
    const res = await handle({ url: 'not-a-url', method: 'GET' })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
