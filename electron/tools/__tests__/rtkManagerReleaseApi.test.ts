// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * The GitHub release lookup — `checkUpdate` and the asset list that
 * `downloadBinary` trusts. Three fallback chains overlap here and each one is
 * a place where a silent break looks like "没有新版本":
 *
 *   source:  direct api.github.com → gh-proxy.com → ghproxy.net → give up
 *   TLS:     verified → one insecure retry, then that mode is process-permanent
 *   version: version.json → `rtk --version` banner
 *
 * TLS downgrade is the sharp edge: `sslFallbackEnabled` is a module-level flag,
 * so a single corporate-proxy certificate error switches certificate
 * verification off for every later request of the process — not just the one
 * that failed. These tests pin that so the blast radius is at least visible.
 *
 * `https.get` is stubbed and answers on a later tick, because the module
 * attaches its `error` / `setTimeout` handlers after the call returns.
 */

const HOME = path.join(process.cwd(), 'home')
const USER_DATA = path.join(process.cwd(), 'userdata')
const RTK_DIR = path.join(USER_DATA, 'rtk')
const API = 'https://api.github.com/repos/rtk-ai/rtk/releases/latest'

type HttpPlan = {
  status?: number
  headers?: Record<string, string>
  body?: string
  error?: Error
  /** fire the idle-socket timeout callback instead of answering */
  reqTimeout?: boolean
}

const fsProbe = vi.hoisted(() => ({
  existing: new Set<string>(),
  files: new Map<string, string>(),
}))

const net = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; options: Record<string, unknown> }>,
  requests: [] as unknown[],
  plan: [] as HttpPlan[],
}))

class StubEmitter {
  private listeners = new Map<string, Array<(arg?: unknown) => void>>()

  on(event: string, handler: (arg?: unknown) => void): this {
    const list = this.listeners.get(event) ?? []
    list.push(handler)
    this.listeners.set(event, list)
    return this
  }

  fire(event: string, arg?: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) handler(arg)
  }
}

class StubResponse extends StubEmitter {
  resumed = false

  constructor(
    readonly statusCode: number,
    readonly headers: Record<string, string>,
    readonly body: string,
  ) {
    super()
  }

  resume(): void {
    this.resumed = true
  }
}

class StubRequest extends StubEmitter {
  destroyCount = 0
  timeoutMs = 0
  private onTimeout: (() => void) | null = null

  setTimeout(ms: number, handler: () => void): void {
    this.timeoutMs = ms
    this.onTimeout = handler
  }

  destroy(): void {
    this.destroyCount += 1
  }

  fireTimeout(): void {
    this.onTimeout?.()
  }
}

vi.mock('fs', () => ({
  existsSync: (p: string) => fsProbe.existing.has(String(p)) || fsProbe.files.has(String(p)),
  readFileSync: (p: string) => {
    const value = fsProbe.files.get(String(p))
    if (value === undefined) throw new Error(`ENOENT: ${p}`)
    return value
  },
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(() => {
    throw new Error('rtkManager ran the rtk CLI during a release-lookup test')
  }),
}))

vi.mock('os', () => ({
  homedir: () => HOME,
}))

vi.mock('https', () => ({
  get: (url: string, options: Record<string, unknown>, cb: (res: StubResponse) => void) => {
    const plan = net.plan.shift()
    net.calls.push({ url, options })
    const req = new StubRequest()
    net.requests.push(req)
    if (!plan) throw new Error(`rtkManager requested ${url} with no scripted response`)
    setImmediate(() => {
      if (plan.error) {
        req.fire('error', plan.error)
        return
      }
      if (plan.reqTimeout) {
        req.fireTimeout()
        return
      }
      const res = new StubResponse(plan.status ?? 200, plan.headers ?? {}, plan.body ?? '')
      cb(res)
      if (res.resumed) return
      if (res.body) res.fire('data', res.body)
      res.fire('end')
    })
    return req
  },
  request: vi.fn(),
}))

vi.mock('stream/promises', () => ({
  pipeline: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? USER_DATA : path.join(process.cwd(), name)),
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => [])
  },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const ORIGINAL_PLATFORM = process.platform

type Manager = typeof import('../rtkManager')
type RtkManager = Manager['rtkManager']

async function loadManager(platform: NodeJS.Platform = 'linux'): Promise<RtkManager> {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  const mod = (await import('../rtkManager')) as Manager
  return mod.rtkManager
}

function release(tag: string): HttpPlan {
  return { body: JSON.stringify({ tag_name: tag, assets: [] }) }
}

function requestedUrls(): string[] {
  return net.calls.map((call) => call.url)
}

function insecureFlags(): boolean[] {
  return net.calls.map((call) => call.options.rejectUnauthorized === false)
}

function installedWithVersion(version: string): void {
  fsProbe.existing.add(path.join(RTK_DIR, 'rtk'))
  fsProbe.files.set(path.join(RTK_DIR, 'version.json'), JSON.stringify({ version }))
}

beforeEach(() => {
  fsProbe.existing.clear()
  fsProbe.files.clear()
  net.calls = []
  net.requests = []
  net.plan = []
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
})

describe('release lookup', () => {
  it('asks the GitHub API with the declared client identity', async () => {
    const manager = await loadManager()
    net.plan.push(release('v0.44.0'))

    await expect(manager.checkUpdate()).resolves.toEqual({
      current: null,
      latest: 'v0.44.0',
      hasUpdate: true,
    })

    expect(net.calls[0].url).toBe(API)
    expect(net.calls[0].options.headers).toEqual({
      'User-Agent': 'SpaceCode-Desktop',
      Accept: 'application/vnd.github+json',
    })
    expect(net.calls[0].options.rejectUnauthorized).toBe(true)
  })

  it('tries the mirrors in order until one answers', async () => {
    const manager = await loadManager()
    net.plan.push({ status: 500, body: 'server error' })
    net.plan.push({ status: 502, body: 'bad gateway' })
    net.plan.push(release('v0.44.0'))

    await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.44.0' })
    expect(requestedUrls()).toEqual([API, `https://gh-proxy.com/${API}`, `https://ghproxy.net/${API}`])
  })

  it('reports no update info once every source has failed', async () => {
    const manager = await loadManager()
    net.plan.push({ error: new Error('ECONNREFUSED') })
    net.plan.push({ error: new Error('ECONNREFUSED') })
    net.plan.push({ status: 403, body: 'rate limited' })

    await expect(manager.checkUpdate()).resolves.toBeNull()
    expect(requestedUrls()).toHaveLength(3)
  })

  it('says nothing is new when the installed version matches the release', async () => {
    const manager = await loadManager()
    installedWithVersion('v0.43.1')
    net.plan.push(release('v0.43.1'))

    await expect(manager.checkUpdate()).resolves.toEqual({
      current: 'v0.43.1',
      latest: 'v0.43.1',
      hasUpdate: false,
    })
    expect(net.calls).toHaveLength(1)
  })

  it('flags an update purely because the local version is unknown', async () => {
    const manager = await loadManager()
    net.plan.push(release('v0.44.0'))

    // An uninstalled binary has `current: null`, which is not `latest`, so the
    // panel is allowed to offer a download rather than showing an empty version.
    await expect(manager.checkUpdate()).resolves.toEqual({
      current: null,
      latest: 'v0.44.0',
      hasUpdate: true,
    })
  })

  it('trusts a version.json that has no version field', async () => {
    const manager = await loadManager()
    fsProbe.existing.add(path.join(RTK_DIR, 'rtk'))
    fsProbe.files.set(path.join(RTK_DIR, 'version.json'), JSON.stringify({ installedAt: 'x' }))
    net.plan.push(release('v0.44.0'))

    // Records a gap, not an endorsement: the stored document is trusted blindly,
    // so a version.json without a `version` key yields `undefined` for a field
    // the whole chain types as `string | null` — no banner probe, no warning.
    const info = await manager.checkUpdate()
    expect(info).toMatchObject({ latest: 'v0.44.0', hasUpdate: true })
    expect(info?.current).toBeUndefined()
  })
})

describe('release redirect handling', () => {
  it('follows a 302 to the relocated document', async () => {
    const manager = await loadManager()
    net.plan.push({ status: 302, headers: { location: 'https://gh-proxy.com/moved/1' } })
    net.plan.push(release('v0.44.0'))

    await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.44.0' })
    expect(requestedUrls()).toEqual([API, 'https://gh-proxy.com/moved/1'])
  })

  it('treats a redirect without a Location header as a failure', async () => {
    const manager = await loadManager()
    net.plan.push({ status: 301 })
    net.plan.push(release('v0.44.0'))

    await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.44.0' })
    expect(requestedUrls()).toEqual([API, `https://gh-proxy.com/${API}`])
  })

  it('stops following a redirect loop after five hops', async () => {
    const manager = await loadManager()
    for (let hop = 0; hop < 6; hop += 1) {
      net.plan.push({ status: 302, headers: { location: `https://gh-proxy.com/loop/${hop}` } })
    }
    net.plan.push(release('v0.44.0'))

    await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.44.0' })
    // Five hops are followed; the response of the sixth call is rejected rather
    // than chased, and only then does the mirror chain start.
    expect(requestedUrls()).toHaveLength(7)
    expect(requestedUrls()[0]).toBe(API)
    expect(requestedUrls()[1]).toBe('https://gh-proxy.com/loop/0')
    expect(requestedUrls()[5]).toBe('https://gh-proxy.com/loop/4')
    expect(requestedUrls()[6]).toBe(`https://gh-proxy.com/${API}`)
  })

  it('rejects a body that is not the release JSON', async () => {
    const manager = await loadManager()
    net.plan.push({ body: '<html>502 Bad Gateway</html>' })
    net.plan.push(release('v0.44.0'))

    await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.44.0' })
    expect(requestedUrls()).toEqual([API, `https://gh-proxy.com/${API}`])
  })

  it('gives up on a request that neither answers nor errors', async () => {
    const manager = await loadManager()
    net.plan.push({ reqTimeout: true })
    net.plan.push(release('v0.44.0'))

    await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.44.0' })
    const first = net.requests[0] as StubRequest
    expect(first.timeoutMs).toBe(15_000)
    expect(first.destroyCount).toBe(1)
    expect(requestedUrls()).toEqual([API, `https://gh-proxy.com/${API}`])
  })
})

describe('TLS fallback for the release lookup', () => {
  const sslMessages = [
    'unable to verify the first certificate',
    'self signed certificate in certificate chain',
    'CERT_HAS_EXPIRED',
  ]

  for (const message of sslMessages) {
    it(`retries a corporate-proxy certificate failure unverified: ${message}`, async () => {
      const manager = await loadManager()
      net.plan.push({ error: new Error(message) })
      net.plan.push(release('v0.44.0'))

      await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.44.0' })
      expect(requestedUrls()).toEqual([API, API])
      expect(insecureFlags()).toEqual([false, true])
    })
  }

  it('does not downgrade TLS for an ordinary socket error', async () => {
    const manager = await loadManager()
    net.plan.push({ error: new Error('ECONNRESET') })
    net.plan.push(release('v0.44.0'))

    await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.44.0' })
    expect(requestedUrls()).toEqual([API, `https://gh-proxy.com/${API}`])
    expect(insecureFlags()).toEqual([false, false])
  })

  it('leaves every later request of the process unverified once TLS was downgraded', async () => {
    const manager = await loadManager()
    net.plan.push({ error: new Error('unable to verify the first certificate') })
    net.plan.push(release('v0.44.0'))
    await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.44.0' })

    net.plan.push({ error: new Error('unable to verify the first certificate') })
    net.plan.push(release('v0.45.0'))
    await expect(manager.checkUpdate()).resolves.toMatchObject({ latest: 'v0.45.0' })

    // The second lookup never retries: the flag already reads "insecure", so the
    // direct attempt fails, the mirror answers — and both were unverified.
    expect(insecureFlags()).toEqual([false, true, true, true])
    expect(requestedUrls()).toEqual([API, API, API, `https://gh-proxy.com/${API}`])
  })
})
