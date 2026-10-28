// @vitest-environment node
/**
 * H5 设计预览的第二个源（Issue #64 第 1 项）。
 *
 * 预览文档必须与父页面跨源，所以走主端口 +1 的第二源 `/__preview/<token>/<rel>`：
 *   - URL 由服务端签发（反向代理 / 隧道下前端不能自己按端口 +1 推导）；
 *   - 只有桌面登记过的项目根内文件可被签发，未登记与越界路径与桌面同口径拒绝；
 *   - 文档下发预览自己的 CSP（不是 GenUI 的 default-src 'none'），并注入桥；
 *   - 同目录与子目录的相对资源同源命中，脚本/MIME 正常。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', async () => {
  const { electronMock } = await import('./h5TestKit')
  return electronMock
})

vi.mock('../../infra/logger', async () => {
  const { loggerStub } = await import('./h5TestKit')
  return loggerStub
})

vi.mock('../../engine/engineGateway', async () => {
  const { gatewayStub } = await import('./h5TestKit')
  return { engineGateway: gatewayStub, NotImplementedError: class NotImplementedError extends Error {} }
})

vi.mock('../../engine/engines/EngineFactory', async () => {
  const { engineFactoryStub } = await import('./h5TestKit')
  return { EngineFactory: engineFactoryStub }
})

vi.mock('../../session/sessionHistoryManager', async () => {
  const { historyStub } = await import('./h5TestKit')
  return { SessionHistoryManager: historyStub }
})

import { H5Server } from '../h5Server'
import { resolveH5SandboxBaseUrl } from '../h5DocumentPolicy'
import { PREVIEW_CSP, PREVIEW_HOST_ORIGIN_PARAM, PREVIEW_NONCE_PARAM } from '@/shared/previewOrigin'
import { PREVIEW_SANDBOX_SHIM_ID, PREVIEW_TRANSPORT_BRIDGE_ID } from '@/shared/previewDocument'
import {
  attempt,
  auth,
  freeMainPort,
  jsonOf,
  rawRequest,
  resetAuthStub,
  resetEngineFactoryStub,
  resetGatewayStub,
  resetHistoryStub,
  resetRuntime,
  runtime,
  TEST_TOKEN,
  type RawResponse,
} from './h5TestKit'

const sandboxRoot = mkdtempSync(join(tmpdir(), 'h5-preview-sandbox-'))
const project = mkdtempSync(join(tmpdir(), 'h5-preview-project-'))
const designDir = join(project, 'design')
const outsideRoot = mkdtempSync(join(tmpdir(), 'h5-preview-outside-'))
const OUTSIDE_SENTINEL = 'sentinel-outside-registered-root'

beforeAll(() => {
  mkdirSync(join(sandboxRoot, 'assets'), { recursive: true })
  writeFileSync(join(sandboxRoot, 'index.html'), '<html><body>card sandbox</body></html>')

  mkdirSync(join(designDir, 'sub'), { recursive: true })
  writeFileSync(
    join(designDir, 'index.html'),
    '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'">' +
      '<link rel="stylesheet" href="./style.css"></head><body>design artifact' +
      '<script type="module" src="./sub/app.js"></script></body></html>',
  )
  writeFileSync(join(designDir, 'style.css'), 'body{color:teal}')
  writeFileSync(join(designDir, 'sub', 'app.js'), 'export const ok = true')
  writeFileSync(join(designDir, 'data.bin'), 'binary-sentinel')

  // 同项目根下的敏感文件：登记根收窄到 design/ 之后，预览不该读到它
  writeFileSync(join(project, 'config.json'), '{"token":"secret"}')
  writeFileSync(join(project, 'notes.txt'), OUTSIDE_SENTINEL)
  writeFileSync(join(outsideRoot, 'other.html'), OUTSIDE_SENTINEL)
})

beforeEach(() => {
  resetRuntime()
  resetAuthStub()
  resetGatewayStub()
  resetHistoryStub()
  resetEngineFactoryStub()
})

afterAll(() => {
  rmSync(sandboxRoot, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
  rmSync(outsideRoot, { recursive: true, force: true })
})

async function startServer(registerRoot = true): Promise<H5Server> {
  const server = await attempt(async () => {
    const candidate = new H5Server(auth, sandboxRoot)
    await candidate.start(await freeMainPort())
    if (candidate.getStatus().sandboxRunning) return candidate
    candidate.stop()
    return null
  })
  if (registerRoot) server.registerProjectRoot(project)
  return server
}

function statusOf(server: H5Server) {
  return server.getStatus()
}

async function requestGrant(
  server: H5Server,
  filePath: string,
  extra: Record<string, unknown> = {},
  token: string | null = TEST_TOKEN,
): Promise<RawResponse> {
  return rawRequest({
    port: statusOf(server).port,
    path: '/api/preview/grant',
    method: 'POST',
    body: { filePath, ...extra },
    token,
  })
}

async function grantUrl(server: H5Server, filePath: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await requestGrant(server, filePath, extra)
  expect(res.status).toBe(200)
  const url = (jsonOf(res) as { url?: unknown }).url
  expect(typeof url).toBe('string')
  return url as string
}

async function fetchPreview(url: string, query: Record<string, string> = {}): Promise<RawResponse> {
  const parsed = new URL(url)
  for (const [key, value] of Object.entries(query)) parsed.searchParams.set(key, value)
  return rawRequest({
    port: Number(parsed.port),
    path: `${parsed.pathname}${parsed.search}`,
  })
}

describe('签发预览 token', () => {
  let server: H5Server

  beforeAll(async () => {
    server = await startServer()
  })

  afterAll(() => {
    server.stop()
  })

  it('返回第二个源上的绝对 URL，前端不需要自己推导端口', async () => {
    const status = statusOf(server)
    const url = await grantUrl(server, join(designDir, 'index.html'))

    expect(url).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:${status.sandboxPort}/__preview/[0-9a-f]{32}/index\\.html$`),
    )
    expect(status.sandboxPort).toBe(status.port + 1)
  })

  it('未带 H5 token 拒绝签发', async () => {
    const res = await requestGrant(server, join(designDir, 'index.html'), {}, null)
    expect(res.status).toBe(401)
  })

  it('项目登记根之外的文件拒绝签发', async () => {
    const res = await requestGrant(server, join(outsideRoot, 'other.html'))
    expect(res.status).toBe(403)
    expect(res.body).not.toContain(OUTSIDE_SENTINEL)
  })

  it('同一会话复用 token，不同会话各拿一份', async () => {
    const first = await grantUrl(server, join(designDir, 'index.html'), { sessionId: 's1' })
    const again = await grantUrl(server, join(designDir, 'index.html'), { sessionId: 's1' })
    const other = await grantUrl(server, join(designDir, 'index.html'), { sessionId: 's2' })

    expect(again).toBe(first)
    expect(other).not.toBe(first)
  })
})

describe('/__preview 路由的响应', () => {
  let server: H5Server
  let url: string

  beforeAll(async () => {
    server = await startServer()
    url = await grantUrl(server, join(designDir, 'index.html'))
  })

  afterAll(() => {
    server.stop()
  })

  it('文档下发预览自己的 CSP，而不是 GenUI 的 default-src none', async () => {
    const res = await fetchPreview(url)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.headers['content-security-policy']).toBe(PREVIEW_CSP)
    expect(PREVIEW_CSP).not.toContain('allow-popups')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    // 产物自带的 CSP meta 必须移除，否则会和响应头取交集把桥拦掉
    expect(res.body).not.toContain('script-src &#39;none&#39;')
    expect(res.body).not.toContain("script-src 'none'")
  })

  it('带桥参数时注入 shim 与 transport bridge', async () => {
    const res = await fetchPreview(url, {
      [PREVIEW_NONCE_PARAM]: 'nonce-h5',
      [PREVIEW_HOST_ORIGIN_PARAM]: `http://127.0.0.1:${statusOf(server).port}`,
    })

    expect(res.status).toBe(200)
    expect(res.body).toContain(`id="${PREVIEW_SANDBOX_SHIM_ID}"`)
    expect(res.body).toContain(`id="${PREVIEW_TRANSPORT_BRIDGE_ID}"`)
    expect(res.body).toContain('var NONCE = "nonce-h5"')
  })

  it('相对 CSS / module JS 同源命中产物目录', async () => {
    const css = await fetchPreview(new URL('./style.css', url).toString())
    const js = await fetchPreview(new URL('./sub/app.js', url).toString())

    expect(css.status).toBe(200)
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8')
    expect(css.body).toContain('color:teal')
    expect(js.status).toBe(200)
    expect(js.headers['content-type']).toBe('application/javascript; charset=utf-8')
  })

  it('同一项目根下的无关文件读不到', async () => {
    const parsed = new URL(url)
    const token = parsed.pathname.split('/')[2]

    const json = await rawRequest({
      port: Number(parsed.port),
      path: `/__preview/${token}/%2e%2e%2fconfig.json`,
    })
    const text = await rawRequest({
      port: Number(parsed.port),
      path: `/__preview/${token}/%2e%2e%2fnotes.txt`,
    })

    expect(json.status).toBe(403)
    expect(text.status).toBe(403)
    expect(json.body).not.toContain('secret')
    expect(text.body).not.toContain(OUTSIDE_SENTINEL)
  })

  it('未登记 token、未知 MIME、非 GET/HEAD 都与桌面同口径拒绝', async () => {
    const parsed = new URL(url)
    const token = parsed.pathname.split('/')[2]

    expect((await rawRequest({ port: Number(parsed.port), path: '/__preview/deadbeef/index.html' })).status).toBe(404)
    expect((await rawRequest({ port: Number(parsed.port), path: `/__preview/${token}/data.bin` })).status).toBe(404)

    const post = await rawRequest({ port: Number(parsed.port), path: parsed.pathname, method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')
  })

  it('HEAD 返回头但不带 body', async () => {
    const parsed = new URL(url)
    const res = await rawRequest({ port: Number(parsed.port), path: parsed.pathname, method: 'HEAD' })

    expect(res.status).toBe(200)
    expect(res.body).toBe('')
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0)
  })
})

describe('反向代理 / 隧道下的源一致性', () => {
  it('签发 URL 与 frame-src 出自同一份推导', async () => {
    runtime.settings = { ...runtime.settings, publicBaseUrl: 'https://design.example' }
    const server = await startServer()

    try {
      const status = statusOf(server)
      // serveDocument 写进 frame-src 的就是这个函数的结果；签发端必须复用同一份
      const frameSrcOrigin = resolveH5SandboxBaseUrl({
        requestAuthority: `127.0.0.1:${status.port}`,
        publicBaseUrl: runtime.settings.publicBaseUrl,
        sandboxPort: runtime.settings.sandboxPort,
        mainPort: status.port,
      })

      const url = await grantUrl(server, join(designDir, 'index.html'))
      expect(frameSrcOrigin).toBe(`https://design.example:${status.sandboxPort}`)
      expect(new URL(url).origin).toBe(frameSrcOrigin)
    } finally {
      server.stop()
    }
  })

  it('第二端口没起来时拒绝签发，而不是给一个空白 iframe', async () => {
    runtime.settings = { ...runtime.settings, sandboxPort: 70000 }
    const server = new H5Server(auth, sandboxRoot)
    await server.start(await freeMainPort())
    server.registerProjectRoot(project)

    try {
      expect(statusOf(server).sandboxRunning).toBe(false)
      const res = await requestGrant(server, join(designDir, 'index.html'))
      expect(res.status).toBe(409)
    } finally {
      server.stop()
    }
  })
})
