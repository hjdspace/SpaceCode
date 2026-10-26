// @vitest-environment node
/**
 * `spacecode-preview://` 协议处理器 — Issue #63。
 *
 * 只断言外部可观察行为：URL 决定状态码与 MIME；HTML 带沙箱 CSP、被注入桥、
 * 产物自带的 CSP meta 被移除；非 HTML 不执行任何脚本。文件闸门与 HTTP 预览
 * 服务共用 `previewGrants`，这里用同一套边界用例收口。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}))
vi.mock('../logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { protocol } from 'electron'
import {
  PREVIEW_CSP,
  PREVIEW_HOST,
  PREVIEW_HOST_ORIGIN_PARAM,
  PREVIEW_NONCE_PARAM,
  PREVIEW_ORIGIN,
  PREVIEW_SCHEME,
} from '@/shared/previewOrigin'
import { PREVIEW_TRANSPORT_BRIDGE_ID } from '@/shared/previewDocument'
import { PreviewGrants } from '../previewGrants'
import {
  createPreviewRequestHandler,
  registerPreviewProtocol,
  registerPreviewScheme,
} from '../previewProtocol'

const root = mkdtempSync(join(tmpdir(), 'preview-protocol-'))
const workspace = join(root, 'workspace')
const OUTSIDE = join(root, 'outside.txt')
const NONCE = 'nonce-1234'
const HOST_ORIGIN = 'http://127.0.0.1:5173'

mkdirSync(workspace)
mkdirSync(join(workspace, 'pages'))
writeFileSync(
  join(workspace, 'index.html'),
  '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><title>t</title></head><body>artifact<script>window.__ran=1</script></body></html>',
)
writeFileSync(join(workspace, 'pages', 'other.html'), '<html><body>other</body></html>')
writeFileSync(join(workspace, 'style.css'), 'body{color:red}')
writeFileSync(join(workspace, 'payload.bin'), 'binary')
writeFileSync(OUTSIDE, 'outside-secret')

const grants = new PreviewGrants()
const handler = createPreviewRequestHandler({ grants })
const grant = grants.register(join(workspace, 'index.html'), workspace)!

function urlOf(rel: string, params: Record<string, string> = {}): string {
  const url = new URL(`${PREVIEW_ORIGIN}/${grant.token}/${rel}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function bridgeParams(): Record<string, string> {
  return { [PREVIEW_NONCE_PARAM]: NONCE, [PREVIEW_HOST_ORIGIN_PARAM]: HOST_ORIGIN }
}

async function request(url: string, method = 'GET') {
  const res = await handler({ url, method })
  return { status: res.status, headers: res.headers, body: await res.text() }
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('协议注册', () => {
  it('ready 前注册为 standard + secure，并允许同源 fetch', () => {
    registerPreviewScheme()
    const calls = vi.mocked(protocol.registerSchemesAsPrivileged).mock.calls
    const entry = (calls[calls.length - 1]?.[0] as Array<{
      scheme: string
      privileges: Record<string, boolean>
    }>)[0]

    expect(entry.scheme).toBe(PREVIEW_SCHEME)
    expect(entry.privileges.standard).toBe(true)
    expect(entry.privileges.secure).toBe(true)
    expect(entry.privileges.supportFetchAPI).toBe(true)
    expect(entry.privileges.corsEnabled).toBe(false)
    expect(entry.privileges.bypassCSP).toBe(false)
    expect(entry.privileges.allowServiceWorkers).toBe(false)
  })

  it('ready 后挂到传入的每一个 session', () => {
    const first = { handle: vi.fn() }
    const second = { handle: vi.fn() }

    registerPreviewProtocol({ grants, hosts: [first, second] })

    expect(first.handle).toHaveBeenCalledWith(PREVIEW_SCHEME, expect.any(Function))
    expect(second.handle).toHaveBeenCalledWith(PREVIEW_SCHEME, expect.any(Function))
  })
})

describe('HTML 文档', () => {
  it('带沙箱 CSP、注入与宿主一致的桥，并移除产物自带的 CSP meta', async () => {
    const res = await request(urlOf('index.html', bridgeParams()))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('content-security-policy')).toBe(PREVIEW_CSP)
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.body).toContain('artifact')
    expect(res.body).toContain(`id="${PREVIEW_TRANSPORT_BRIDGE_ID}"`)
    expect(res.body).toContain(`var NONCE = "${NONCE}"`)
    expect(res.body).toContain(`var HOST_ORIGIN = "${HOST_ORIGIN}"`)
    // 产物自己的 meta 会与响应头取交集，必须先移除
    expect(res.body).not.toContain('http-equiv="Content-Security-Policy"')
  })

  it('缺少或不合法的桥参数时不注入桥，但仍下发沙箱 CSP', async () => {
    const variants: Array<Record<string, string>> = [
      {},
      { [PREVIEW_NONCE_PARAM]: NONCE },
      { ...bridgeParams(), [PREVIEW_NONCE_PARAM]: 'bad nonce"' },
      { ...bridgeParams(), [PREVIEW_HOST_ORIGIN_PARAM]: 'javascript:alert(1)' },
    ]
    for (const params of variants) {
      const res = await request(urlOf('index.html', params))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-security-policy')).toBe(PREVIEW_CSP)
      expect(res.body).not.toContain(`id="${PREVIEW_TRANSPORT_BRIDGE_ID}"`)
    }
  })

  it('目录 URL 命中 index.html', async () => {
    const res = await request(`${PREVIEW_ORIGIN}/${grant.token}/`)
    expect(res.status).toBe(200)
    expect(res.body).toContain('artifact')
  })

  it('HEAD 返回同样的头部但不带 body', async () => {
    const res = await request(urlOf('index.html'), 'HEAD')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(PREVIEW_CSP)
    expect(res.body).toBe('')
  })
})

describe('资源与边界', () => {
  it('非 HTML 资源按白名单 MIME 服务，不执行 HTML 注入', async () => {
    const res = await request(urlOf('style.css'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(res.headers.get('content-security-policy')).toBeNull()
    expect(res.body).toBe('body{color:red}')
  })

  it('未登记的 token 与不存在的路径同码 404', async () => {
    expect((await request(`${PREVIEW_ORIGIN}/deadbeef/index.html`)).status).toBe(404)
    expect((await request(urlOf('missing.html'))).status).toBe(404)
  })

  it('越过登记根的穿越被 403 拦截', async () => {
    const res = await request(urlOf('%2e%2e%2f%2e%2e%2foutside.txt'))
    expect(res.status).toBe(403)
    expect(res.body).not.toContain('outside-secret')
  })

  it('白名单之外的扩展名不服务（脚本能 fetch 登记根，不能照发未知类型）', async () => {
    expect((await request(urlOf('payload.bin'))).status).toBe(404)
  })

  it('其他 host 与写方法被拒', async () => {
    expect((await request(`${PREVIEW_SCHEME}://other/index.html`)).status).toBe(404)
    const res = await request(urlOf('index.html'), 'POST')
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })
})
