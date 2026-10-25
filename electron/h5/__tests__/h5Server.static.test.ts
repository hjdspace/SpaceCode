// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { join } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * Static-asset surface of the H5 server — the one part of the remote entrypoint
 * that touches the filesystem *without* an explicit token, so its path handling
 * is the blast radius for an unauthenticated LAN peer.
 *
 * Contract under test:
 *   - `/` maps to `<dist>/index.html`, `/assets/*` to the real file, anything
 *     else falls back to index.html (SPA) or 404s when the client was never built.
 *   - No request, however encoded (`../`, `..%2f`, `%2e%2e%2f`, backslashes),
 *     can make the server ask the filesystem for something outside the dist root.
 *   - MIME comes from the extension table; unknown extensions are octet-stream.
 *
 * The filesystem under the dist root does not exist in a test run, so `fs` is an
 * in-memory tree here — plus a few planted "sensitive" files outside that tree,
 * so an escape shows up as leaked bytes in the response rather than as a
 * hand-check of path arithmetic. `serveFile` streams through a function-body
 * `require('fs')`, which `vi.mock` cannot intercept (it resolves the genuine CJS
 * module) — those cases spy on that genuine module instead. See the report: the
 * in-body `require` is the reason the seam has to be patched this way.
 */

const PLANTED_SECRET = 'PLANTED-SECRET-DO-NOT-SERVE'

const dist = vi.hoisted(() => ({
  files: new Map<string, string>(),
  /**
   * Sensitive files that live *outside* the dist root. They exist for the fake
   * filesystem, so any request that does escape root-contains them and the test
   * sees the payload in the response body instead of trusting path arithmetic.
   */
  sensitive: new Map<string, string>(),
  /** paths whose second stat blows up — models the stat race serveFile catches */
  unstatable: new Set<string>(),
  statCalls: new Map<string, number>(),
  touched: [] as string[],
}))

// Partial mock: only the four fs functions h5Server imports are replaced. The
// rest of the module must stay real because h5TestKit's top-level CAN_SYMLINK
// probe runs genuine mkdtemp/write/symlink/rm while this module graph loads.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: (p: string) => {
      dist.touched.push(p)
      return dist.files.has(p) || dist.sensitive.has(p) || dist.unstatable.has(p)
    },
    statSync: (p: string) => {
      dist.touched.push(p)
      const calls = (dist.statCalls.get(p) ?? 0) + 1
      dist.statCalls.set(p, calls)
      if (dist.unstatable.has(p) && calls > 1) {
        throw Object.assign(new Error(`EBUSY: resource busy or locked, stat '${p}'`), { code: 'EBUSY' })
      }
      const content = dist.files.get(p) ?? dist.sensitive.get(p)
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${p}'`), { code: 'ENOENT' })
      }
      return {
        isFile: () => true,
        isDirectory: () => false,
        size: Buffer.byteLength(content),
        mtime: new Date(0),
      }
    },
    readFileSync: (p: string) => {
      dist.touched.push(p)
      if (dist.unstatable.has(p)) {
        throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${p}'`), { code: 'EBUSY' })
      }
      const content = dist.files.get(p) ?? dist.sensitive.get(p)
      if (content === undefined) throw new Error(`ENOENT: open '${p}'`)
      return content
    },
    readdirSync: (p: string) => {
      dist.touched.push(p)
      return []
    },
  }
})

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
import {
  TEST_TOKEN,
  attempt,
  auth,
  cspDirectives,
  cspMetaOf,
  freeMainPort,
  gatewayStub,
  holdPort,
  rawRequest,
  resetEngineFactoryStub,
  resetGatewayStub,
  resetHistoryStub,
  resetRuntime,
  runtime,
} from './h5TestKit'

/**
 * `serveFile` streams through a function-body `require('fs')`, and the document
 * path reads through the module-level `fs` that this file mocks — so the genuine
 * module is grabbed here to seed the real build artifact into the fake tree.
 */
const realFs = createRequire(import.meta.url)('fs') as {
  createReadStream: (path: string) => unknown
  readFileSync: (path: string, encoding: string) => string
}

/** Same expression the product uses, one directory level down. */
const DIST_ROOT = join(__dirname, '..', '..', 'dist')

/**
 * 文档用的就是仓库根目录那份 `index.html` —— 构建只做资源指纹化，那条面向桌面的 CSP meta
 * 原样带进 `dist/index.html`，桌面与 H5 共用同一个文件。H5 下发时逐响应改写它，
 * 所以契约测试要钉住这份真实模板，而不是手搓一段。
 */
const REPO_INDEX_HTML = realFs.readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf-8')
/** 改写后仍必须原样留在文档里的标记，用来证明内容没被换掉。 */
const DOC_MARKER = '<div id="app"></div>'

function seed(): void {
  dist.files.clear()
  dist.sensitive.clear()
  dist.unstatable.clear()
  dist.statCalls.clear()
  dist.touched = []
  dist.files.set(join(DIST_ROOT, 'index.html'), REPO_INDEX_HTML)
  dist.files.set(join(DIST_ROOT, 'assets', 'app.js'), 'console.log("app")')
  dist.files.set(join(DIST_ROOT, 'assets', 'entry.mjs'), 'export const a = 1')
  dist.files.set(join(DIST_ROOT, 'assets', 'ui.css'), 'body{color:red}')
  dist.files.set(join(DIST_ROOT, 'config.json'), '{"a":1}')
  dist.files.set(join(DIST_ROOT, 'logo.svg'), '<svg/>')
  dist.files.set(join(DIST_ROOT, 'shot.png'), 'pngbytes')
  dist.files.set(join(DIST_ROOT, 'photo.jpg'), 'jpgbytes')
  dist.files.set(join(DIST_ROOT, 'font.woff'), 'w')
  dist.files.set(join(DIST_ROOT, 'font2.woff2'), 'w2')
  dist.files.set(join(DIST_ROOT, 'favicon.ico'), 'ico')
  dist.files.set(join(DIST_ROOT, 'robots.unknown'), 'opaque')

  const payload = `${PLANTED_SECRET} root:x:0:0:root:/root:/bin/sh`
  dist.sensitive.set('/etc/passwd', payload)
  dist.sensitive.set('C:\\Windows\\win.ini', payload)
  // the sibling tree the bundle actually sits next to
  dist.sensitive.set(join(DIST_ROOT, '..', 'h5', 'h5Server.ts'), payload)
  dist.sensitive.set(join(DIST_ROOT, '..', '..', 'package.json'), payload)
}

/** Minimal ServerResponse stand-in for the cases that must reach a private member. */
class CapturedResponse {
  status = 0
  headers: Record<string, unknown> = {}
  body = ''
  ended = false

  setHeader(key: string, value: unknown): void {
    this.headers[key] = value
  }

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status
    Object.assign(this.headers, headers ?? {})
    return this
  }

  write(chunk: unknown): boolean {
    this.body += String(chunk)
    return true
  }

  end(chunk?: unknown): void {
    if (chunk !== undefined) this.body += String(chunk)
    this.ended = true
  }
}

function asResponse(response: CapturedResponse): ServerResponse {
  return response as unknown as ServerResponse
}

describe('H5Server static surface', () => {
  let server: H5Server
  let port = 0

  beforeEach(async () => {
    seed()
    resetRuntime()
    resetGatewayStub()
    resetHistoryStub()
    resetEngineFactoryStub()
    vi.spyOn(realFs, 'createReadStream').mockImplementation((path: string) => ({
      pipe: (destination: { write: (c: string) => void; end: () => void }) => {
        destination.write(dist.files.get(path) ?? '')
        destination.end()
      },
    }))
    server = new H5Server(auth)
    const status = await server.start(0)
    port = status.port
  })

  afterEach(() => {
    server.stop()
    vi.restoreAllMocks()
  })

  describe('dist root', () => {
    it('resolves static files against the electron/dist sibling of the bundle', async () => {
      const res = await rawRequest({ port, path: '/' })

      expect(res.status).toBe(200)
      expect(dist.touched).toContain(join(DIST_ROOT, 'index.html'))
    })
  })

  describe('routes that bypass authentication', () => {
    it('answers /health without a token', async () => {
      const res = await rawRequest({ port, path: '/health' })

      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ status: 'ok' })
    })

    it('answers the CORS preflight with 204 but grants no cross-origin read', async () => {
      const res = await rawRequest({ port, path: '/api/session/status', method: 'OPTIONS' })

      expect(res.status).toBe(204)
      // The H5 client is same-origin by construction (its baseUrl comes from
      // window.location), so a wildcard would only widen a leaked token's reach.
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
      expect(res.headers['access-control-allow-methods']).toBeUndefined()
    })

    it('serves statics without an Access-Control-Allow-Origin', async () => {
      const res = await rawRequest({ port, path: '/' })

      expect(res.status).toBe(200)
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })
  })

  describe('index + assets', () => {
    it('serves index.html for the root path with the app payload intact', async () => {
      const res = await rawRequest({ port, path: '/' })

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
      expect(res.headers['cache-control']).toBe('no-cache')
      // 文档被改写的只有 CSP meta 与一段内联引导，其余内容原样留着
      expect(res.body).toContain(DOC_MARKER)
      expect(res.body).toContain('src="/src/main.ts"')
    })

    it.each([
      ['/assets/app.js', 'application/javascript; charset=utf-8'],
      ['/assets/entry.mjs', 'application/javascript; charset=utf-8'],
      ['/assets/ui.css', 'text/css; charset=utf-8'],
      ['/config.json', 'application/json; charset=utf-8'],
      ['/logo.svg', 'image/svg+xml'],
      ['/shot.png', 'image/png'],
      ['/photo.jpg', 'image/jpeg'],
      ['/font.woff', 'font/woff'],
      ['/font2.woff2', 'font/woff2'],
      ['/favicon.ico', 'image/x-icon'],
    ])('maps %s to its table MIME', async (path, mime) => {
      const res = await rawRequest({ port, path })

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe(mime)
    })

    it('degrades an unknown extension to octet-stream instead of guessing', async () => {
      const res = await rawRequest({ port, path: '/robots.unknown' })

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('application/octet-stream')
    })
  })

  describe('SPA fallback', () => {
    it('serves index.html for a client-side route', async () => {
      const res = await rawRequest({ port, path: '/session/abc123' })

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
      expect(res.body).toContain(DOC_MARKER)
    })

    it('404s with the build hint when even index.html is missing', async () => {
      dist.files.clear()

      const res = await rawRequest({ port, path: '/whatever' })

      expect(res.status).toBe(404)
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
      expect(JSON.parse(res.body).error).toMatch(/not built/)
    })

    it('falls back to index.html for a missing asset instead of leaking a 404', async () => {
      const res = await rawRequest({ port, path: '/assets/nope.js' })

      expect(res.status).toBe(200)
      expect(res.body).toContain(DOC_MARKER)
    })
  })

  describe('path traversal', () => {
    const probes = [
      '/../../etc/passwd',
      '/../../../windows/win.ini',
      '/..%2f..%2f..%2fetc%2fpasswd',
      '/%2e%2e%2f%2e%2e%2fetc/passwd',
      '/%252e%252e%252fetc/passwd',
      '/..\\..\\..\\windows\\win.ini',
      '/....//....//etc/passwd',
      '/assets/../../index.html',
      '/%c0%ae%c0%ae/%c0%ae%c0%ae/etc/passwd',
    ]

    it.each(probes)('serves only the fallback for %s', async (path) => {
      const res = await rawRequest({ port, path })

      // Every filesystem probe the handler made stayed under the dist root ...
      expect(dist.touched.filter((p) => !p.startsWith(DIST_ROOT))).toEqual([])
      // ... and nothing planted outside it came back over the wire.
      expect(res.body).not.toContain(PLANTED_SECRET)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
      expect(res.body).toContain(DOC_MARKER)
    })

    it('hands a raw dot-segment path to the sanitizer before the filesystem sees it', async () => {
      // `new URL()` folds dot segments away, so raw `../` can only be checked
      // against the handler itself — the sanitizer is the product's, not ours.
      const res = new CapturedResponse()
      const handleStatic = (server as unknown as {
        handleStatic: (pathname: string, response: ServerResponse) => void
      }).handleStatic.bind(server)

      handleStatic('../../../../etc/passwd', asResponse(res))

      expect(dist.touched.filter((p) => !p.startsWith(DIST_ROOT))).toEqual([])
      expect(res.body).not.toContain(PLANTED_SECRET)
      expect(res.status).toBe(200)
      expect(res.body).toContain(DOC_MARKER)
    })

    it('strips a backslash traversal prefix the same way', async () => {
      const res = new CapturedResponse()
      const handleStatic = (server as unknown as {
        handleStatic: (pathname: string, response: ServerResponse) => void
      }).handleStatic.bind(server)

      handleStatic('..\\..\\..\\windows\\win.ini', asResponse(res))

      expect(dist.touched.filter((p) => !p.startsWith(DIST_ROOT))).toEqual([])
      expect(res.body).not.toContain(PLANTED_SECRET)
      expect(res.body).toContain(DOC_MARKER)
    })

    it('serves nothing outside the root even when the request asks for a sibling tree', async () => {
      const res = await rawRequest({ port, path: '/../h5/h5Server.ts' })

      expect(res.status).toBe(200)
      expect(res.body).toContain(DOC_MARKER)
      expect(res.body).not.toContain(PLANTED_SECRET)
      expect(dist.touched.filter((p) => !p.startsWith(DIST_ROOT))).toEqual([])
    })
  })

  describe('request defaults', () => {
    type HandleHttp = (req: IncomingMessage, response: ServerResponse) => void

    function privateHandleHttp(): HandleHttp {
      const target = server as unknown as { handleHttp: HandleHttp }
      return target.handleHttp.bind(target)
    }

    it('treats a request with no target as the root document', async () => {
      const res = new CapturedResponse()

      privateHandleHttp()({ headers: {} } as unknown as IncomingMessage, asResponse(res))

      expect(res.status).toBe(200)
      expect(res.body).toContain(DOC_MARKER)
    })

    it('defaults a target-less API request to GET instead of reading a body', async () => {
      const res = new CapturedResponse()

      privateHandleHttp()(
        {
          url: '/api/sessions/active',
          headers: { authorization: `Bearer ${TEST_TOKEN}` },
        } as unknown as IncomingMessage,
        asResponse(res),
      )

      await vi.waitFor(() => expect(res.status).toBe(200))
      expect(JSON.parse(res.body)).toEqual([])
      expect(gatewayStub.getActiveSessions).toHaveBeenCalled()
    })
  })

  describe('serveFile failures', () => {
    it('answers 500 with the fs message when the file disappears between stat and stream', async () => {
      const config = join(DIST_ROOT, 'config.json')
      dist.unstatable.add(config)

      const res = await rawRequest({ port, path: '/config.json' })

      expect(res.status).toBe(500)
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
      expect(JSON.parse(res.body).error).toMatch(/EBUSY/)
    })

    it('answers 500 for the document too when it disappears before the rewrite', async () => {
      dist.unstatable.add(join(DIST_ROOT, 'index.html'))

      const res = await rawRequest({ port, path: '/' })

      expect(res.status).toBe(500)
      expect(res.body).not.toContain(DOC_MARKER)
    })

    it('falls back instead of streaming a directory-shaped request', async () => {
      const res = await rawRequest({ port, path: '/assets/' })

      expect(res.status).toBe(200)
      expect(res.body).toContain(DOC_MARKER)
      expect(dist.touched.filter((p) => !p.startsWith(DIST_ROOT))).toEqual([])
    })
  })

  describe('parent document CSP contract (GenUI sandbox origin, ticket 06)', () => {
    /** 构建产物里那条 meta 面向桌面；H5 必须逐响应换成第二个源。 */
    const DESKTOP_MARKERS = ['spacecode-genui:', 'http://localhost:5174']

    let docPort = 0
    let sandboxPort = 0
    let docServer: H5Server | null = null

    /**
     * 这一组要的是"第二端口真的监听上了"的那次启动：父页面的源由同一次计算给出，
     * 端口被并行文件抢走时服务端就不广播它了（那是下面单独一条用例的行为）。
     */
    beforeEach(async () => {
      docServer = await attempt(async () => {
        const candidate = new H5Server(auth)
        await candidate.start(await freeMainPort())
        if (candidate.getStatus().sandboxRunning) return candidate
        candidate.stop()
        return null
      })
      const status = docServer.getStatus()
      docPort = status.port
      sandboxPort = status.sandboxPort
    })

    afterEach(() => {
      docServer?.stop()
      docServer = null
    })

    it('rewrites frame-src to the second origin and keeps header and meta identical', async () => {
      const res = await rawRequest({ port: docPort, path: '/' })
      const sandboxOrigin = `http://127.0.0.1:${sandboxPort}`

      const headerCsp = res.headers['content-security-policy'] as string
      expect(cspMetaOf(res.body)).toBe(headerCsp)
      expect(cspDirectives(headerCsp)['frame-src']).toBe(`'self' ${sandboxOrigin}`)
      for (const desktop of DESKTOP_MARKERS) {
        expect(headerCsp).not.toContain(desktop)
        expect(res.body).not.toContain(desktop)
      }
      // 卡片要用的 eval 只在沙箱源里存在，父页面永不放开
      expect(headerCsp).not.toContain('unsafe-eval')
    })

    it('authorises the bootstrap script with the same per-response nonce it publishes', async () => {
      const first = await rawRequest({ port: docPort, path: '/' })
      const second = await rawRequest({ port: docPort, path: '/' })

      const firstCsp = first.headers['content-security-policy'] as string
      const firstNonce = cspDirectives(firstCsp)['script-src'].match(/'nonce-([^']+)'/)?.[1] ?? ''
      expect(cspDirectives(firstCsp)['script-src']).toBe(`'self' 'nonce-${firstNonce}'`)
      expect(firstNonce.length).toBeGreaterThan(8)
      expect(first.body).toContain(`<script nonce="${firstNonce}">`)
      // 引导脚本与 frame-src 出自同一次计算，渲染端不再自己推导端口
      expect(first.body).toContain(`window.__SPACECODE_GENUI_SANDBOX__="http://127.0.0.1:${sandboxPort}"`)
      expect(first.body.match(/__SPACECODE_GENUI_SANDBOX__/g)).toHaveLength(1)
      expect(first.body.indexOf('__SPACECODE_GENUI_SANDBOX__')).toBeLessThan(
        first.body.indexOf('src="/src/main.ts"'),
      )
      // 逐响应换新，两份响应不会共用一个 nonce
      expect(second.headers['content-security-policy']).not.toBe(firstCsp)
    })

    it('follows the public base address when the operator is behind a proxy', async () => {
      runtime.settings = { ...runtime.settings, publicBaseUrl: 'https://space.example.com' }

      const res = await rawRequest({ port: docPort, path: '/' })

      expect(cspDirectives(res.headers['content-security-policy'] as string)['frame-src']).toBe(
        `'self' https://space.example.com:${sandboxPort}`,
      )
    })

    it('leaves non-HTML assets untouched — no CSP rewrite, no bootstrap', async () => {
      const res = await rawRequest({ port: docPort, path: '/assets/app.js' })

      expect(res.body).toBe('console.log("app")')
      expect(res.headers['content-security-policy']).toBeUndefined()
    })

    it('does not advertise the origin when the second port never came up', async () => {
      // 第二端口没监听上时给源，卡片会先亮 5 秒空白 iframe 再换成超时；不如立即报错
      const mainPort = await freeMainPort()
      const release = await holdPort(mainPort + 1)
      const down = new H5Server(auth)
      await down.start(mainPort)

      const res = await rawRequest({ port: mainPort, path: '/' })
      expect(res.status).toBe(200)
      expect(res.headers['content-security-policy']).toBeUndefined()
      expect(res.body).not.toContain('__SPACECODE_GENUI_SANDBOX__')
      // 构建产物那条面向桌面的 meta 原样留着，页面不是无策略状态
      expect(cspMetaOf(res.body)).toContain('spacecode-genui:')

      down.stop()
      await release()
    })
  })
})
