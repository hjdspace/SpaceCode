// @vitest-environment node
/**
 * H5 的第二个源（票 06 第 1、3 条）。
 *
 * 沿现有 H5 HTTP 测试夹具起真服务：主服务之外多一个只提供沙箱静态资源的端口。
 * 这里钉的是"第二端口该有什么、不该有什么"：
 *   - 端口 = 主端口 +1，可显式配置，被占时不静默漂移；
 *   - 逐响应下发与桌面沙箱同一条 CSP，nonce 每次换新，文档自带的 meta 一起改写；
 *   - 路径穿越、缺失文件、白名单外的类型一律拒绝，不做目录列举；
 *   - 不接 API、不接鉴权、不碰引擎网关 —— 它只读一个目录。
 * 资源根是注入的临时目录：闸门（`resolveSandboxFile`）按 realpath 判归属，
 * 那是打包环境里也在跑的同一份代码，所以这里用真文件而不是假 fs。
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
import { GENUI_SANDBOX_CSP } from '@/shared/genuiSandbox'
import {
  auth,
  authStub,
  attempt,
  cspMetaOf,
  freeMainPort,
  freePort,
  gatewayStub,
  holdPort,
  rawRequest,
  resetAuthStub,
  resetEngineFactoryStub,
  resetGatewayStub,
  resetHistoryStub,
  resetRuntime,
  runtime,
  withoutCspNonce,
} from './h5TestKit'

const root = mkdtempSync(join(tmpdir(), 'h5-genui-sandbox-'))
const OUTSIDE_SENTINEL = 'sentinel-outside-sandbox-root'
const outsideFile = join(tmpdir(), 'h5-sandbox-outside.txt')

function seedRoot(): void {
  mkdirSync(join(root, 'assets'), { recursive: true })
  mkdirSync(join(root, 'empty-dir'), { recursive: true })
  writeFileSync(
    join(root, 'index.html'),
    '<!DOCTYPE html>\n<html>\n<head>\n<meta\n  http-equiv="Content-Security-Policy"\n' +
      `  content="${GENUI_SANDBOX_CSP}"\n/>\n<title>GenUI card sandbox</title>\n</head>\n<body></body>\n</html>`,
  )
  writeFileSync(join(root, 'sandbox.js'), 'console.log("sandbox")')
  writeFileSync(join(root, 'sandbox.theme.css'), '.card{color:red}')
  writeFileSync(join(root, 'notes.txt'), OUTSIDE_SENTINEL)
  writeFileSync(outsideFile, OUTSIDE_SENTINEL)
}

function newServer(): H5Server {
  // 资源根注入临时目录：第二端口只服务静态资源，不需要真实构建产物
  return new H5Server(auth, root)
}

async function startMain(listenPort = 0): Promise<H5Server> {
  const server = newServer()
  await server.start(listenPort)
  return server
}

/** 起一个"第二端口确实监听上了"的主服务。 */
async function startMainWithSandboxUp(): Promise<H5Server> {
  return attempt(async () => {
    const candidate = await startMain(await freeMainPort())
    if (candidate.getStatus().sandboxRunning) return candidate
    candidate.stop()
    return null
  })
}

beforeAll(seedRoot)

beforeEach(() => {
  resetRuntime()
  resetAuthStub()
  resetGatewayStub()
  resetHistoryStub()
  resetEngineFactoryStub()
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outsideFile, { force: true })
})

describe('第二端口随主服务起落', () => {
  it('端口是主服务端口 +1，且真的在监听', async () => {
    const server = await startMainWithSandboxUp()
    const status = server.getStatus()
    expect(status.running).toBe(true)
    expect(status.sandboxPort).toBe(status.port + 1)
    expect(status.sandboxRunning).toBe(true)

    expect((await rawRequest({ port: status.sandboxPort, path: '/index.html' })).status).toBe(200)
    server.stop()
  })

  it('显式配置的沙箱端口优先于 +1 约定', async () => {
    const picked = await attempt(async () => {
      const sandboxPort = await freePort()
      runtime.settings = { ...runtime.settings, sandboxPort }
      const candidate = await startMain(await freePort())
      const status = candidate.getStatus()
      if (status.sandboxRunning && status.sandboxPort === sandboxPort) return { candidate, sandboxPort }
      candidate.stop()
      return null
    })

    expect((await rawRequest({ port: picked.sandboxPort, path: '/index.html' })).status).toBe(200)
    picked.candidate.stop()
  })

  it('沙箱端口配成非法值时不静默漂移，第二端口直接不启用', async () => {
    runtime.settings = { ...runtime.settings, sandboxPort: 70000 }
    const server = await startMain()

    expect(server.getStatus().running).toBe(true)
    expect(server.getStatus().sandboxRunning).toBe(false)
    server.stop()
  })

  it('第二端口被占用时主服务照常 —— 卡片退化成错误态，不是整个 H5 起不来', async () => {
    const held = await attempt(async () => {
      const mainPort = await freeMainPort()
      try {
        return { mainPort, release: await holdPort(mainPort + 1) }
      } catch {
        return null
      }
    })

    const server = await startMain(held.mainPort)
    expect(server.getStatus().running).toBe(true)
    expect(server.getStatus().sandboxPort).toBe(held.mainPort + 1)
    expect(server.getStatus().sandboxRunning).toBe(false)

    server.stop()
    await held.release()
  })

  it('stop() 把第二个端口一起关掉', async () => {
    const server = await startMainWithSandboxUp()
    const sandboxPort = server.getStatus().sandboxPort
    server.stop()

    await expect(rawRequest({ port: sandboxPort, path: '/index.html' })).rejects.toThrow()
  })
})

describe('第二端口只服务沙箱静态资源', () => {
  let server: H5Server | undefined
  let sandboxPort = 0

  // 一个实例服务整组用例：每测一次就抢一对临时端口，会被并行文件的端口池拖住
  beforeAll(async () => {
    server = await startMainWithSandboxUp()
    sandboxPort = server.getStatus().sandboxPort
  })

  afterAll(() => {
    server?.stop()
  })

  it('每个响应都带与桌面同一条沙箱 CSP，nonce 逐个换新', async () => {
    const doc = await rawRequest({ port: sandboxPort, path: '/index.html' })
    const script = await rawRequest({ port: sandboxPort, path: '/sandbox.js' })

    expect(doc.status).toBe(200)
    expect(withoutCspNonce(doc.headers['content-security-policy'] as string)).toBe(GENUI_SANDBOX_CSP)
    expect(doc.headers['content-security-policy']).toMatch(/'nonce-[^']+'/)
    expect(withoutCspNonce(script.headers['content-security-policy'] as string)).toBe(GENUI_SANDBOX_CSP)
    expect(script.headers['content-security-policy']).not.toBe(doc.headers['content-security-policy'])
  })

  it('文档自带的 CSP meta 被改写成与响应头同一条，nonce 因此真的能说话', async () => {
    const res = await rawRequest({ port: sandboxPort, path: '/index.html' })
    const headerCsp = res.headers['content-security-policy'] as string

    // 浏览器执行 meta ∩ 响应头：meta 不改，头里的 nonce 就永远轮不到授权
    expect(cspMetaOf(res.body)).toBe(headerCsp)
    expect(cspMetaOf(res.body)).toMatch(/'nonce-[^']+'/)
  })

  it('MIME 走沙箱那份白名单，不放开 octet-stream', async () => {
    const cases: Array<[string, string]> = [
      ['/index.html', 'text/html; charset=utf-8'],
      ['/sandbox.js', 'application/javascript; charset=utf-8'],
      ['/sandbox.theme.css', 'text/css; charset=utf-8'],
    ]
    for (const [path, mime] of cases) {
      const res = await rawRequest({ port: sandboxPort, path })
      expect(res.headers['content-type']).toBe(mime)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
    }

    const unknown = await rawRequest({ port: sandboxPort, path: '/notes.txt' })
    expect(unknown.status).toBe(404)
    expect(unknown.body).not.toContain(OUTSIDE_SENTINEL)
  })

  it('根路径落到入口文档，不列目录', async () => {
    const rootRes = await rawRequest({ port: sandboxPort, path: '/' })
    expect(rootRes.status).toBe(200)
    expect(rootRes.body).toContain('GenUI card sandbox')

    const dir = await rawRequest({ port: sandboxPort, path: '/empty-dir' })
    expect(dir.status).toBe(404)
    expect(dir.body).not.toContain('sandbox.js')
  })

  const escapes = [
    '/../h5-sandbox-outside.txt',
    '/..%2f..%2f..%2f..%2fetc%2fpasswd',
    '/%2e%2e%2f%2e%2e%2fh5-sandbox-outside.txt',
    '/assets/../../h5-sandbox-outside.txt',
    '/index.html%00.js',
  ]

  it.each(escapes)('穿越请求 %s 读不到沙箱目录外的东西', async (path) => {
    const res = await rawRequest({ port: sandboxPort, path })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.body).not.toContain(OUTSIDE_SENTINEL)
  })

  it('不存在的文件失败，且回落到同一个状态码而不是泄露目录结构', async () => {
    expect((await rawRequest({ port: sandboxPort, path: '/nope.html' })).status).toBe(404)
    expect((await rawRequest({ port: sandboxPort, path: '/assets/deep/nested.js' })).status).toBe(404)
  })

  it('没有 API、没有引擎 —— 非 GET/HEAD 一律挡在门口', async () => {
    expect((await rawRequest({ port: sandboxPort, path: '/api/sessions/active' })).status).toBe(404)

    const post = await rawRequest({ port: sandboxPort, path: '/index.html', method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')
    expect(gatewayStub.getActiveSessions).not.toHaveBeenCalled()
  })

  it('不接 H5 鉴权：静态资源不带 token 也拿得到，但从不校验 token', async () => {
    expect((await rawRequest({ port: sandboxPort, path: '/index.html', token: null })).status).toBe(200)
    expect(authStub.validateToken).not.toHaveBeenCalled()
  })

  it('不给泛域 CORS，别的应用读不走沙箱资源', async () => {
    const res = await rawRequest({
      port: sandboxPort,
      path: '/index.html',
      headers: { Origin: 'http://evil.example' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
