// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * RTK download pipeline — the only path that puts a third-party executable on
 * the user's disk:
 *
 *   release lookup → archive download (direct GitHub, then domestic mirrors)
 *   → extraction (PowerShell on Windows, tar elsewhere) → binary placement
 *   → version.json
 *
 * Two contracts matter here and neither shows up on the happy path:
 *
 * 1. A failed download must leave the manager reporting *not installed*, never
 *    a half-written archive or a version.json claiming a successful install.
 * 2. The fallback chain is ordered — direct, gh-proxy.com, ghproxy.net — and a
 *    wrong asset for the platform installs a binary that cannot even run, so
 *    the requested URL is asserted per platform.
 *
 * `https` / `fs` / `child_process` are stubbed with hand-driven objects. The
 * module registers its listeners *after* calling `get` / `spawn`, so responses
 * are delivered on a later tick, matching real timing.
 */

const HOME = path.join(process.cwd(), 'home')
const USER_DATA = path.join(process.cwd(), 'userdata')
const RTK_DIR = path.join(USER_DATA, 'rtk')

type HttpPlan = {
  status?: number
  headers?: Record<string, string>
  body?: string
  /** emit on the request instead of answering it */
  error?: Error
  /** never answer and never time out: only the connect timer can decide */
  hang?: boolean
  /** fire the idle-socket timeout callback the module registered */
  reqTimeout?: boolean
  /** fail the destination write stream mid-download (disk full, permissions) */
  fileError?: Error
}

type SpawnPlan = {
  code?: number
  stderr?: string
  error?: Error
  /** paths the extractor "unpacks"; they appear on disk as the process exits */
  creates?: string[]
  /** hide stderr entirely, the way a detached child reports none */
  noStderr?: boolean
}

const fsProbe = vi.hoisted(() => ({
  existing: new Set<string>(),
  files: new Map<string, string>(),
  dirs: new Map<string, unknown[]>(),
  unreadable: new Set<string>(),
  sinks: [] as unknown[],
  rmCalls: [] as string[],
  rmThrows: false,
  chmods: [] as Array<{ path: string; mode: number }>,
  renames: [] as Array<{ from: string; to: string }>,
  mkdirs: [] as Array<{ path: string; options: unknown }>,
  written: [] as Array<{ path: string; data: string }>,
}))

const net = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; options: Record<string, unknown> }>,
  requests: [] as unknown[],
  plan: [] as HttpPlan[],
}))

const spawnProbe = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; args: string[] }>,
  plan: [] as SpawnPlan[],
}))

/** Minimal listener bookkeeping: unlike EventEmitter, `fire` with no listener is a no-op. */
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

class StubFile extends StubEmitter {
  chunks: string[] = []
  closed = false

  constructor(readonly destPath: string) {
    super()
  }

  write(chunk: string): boolean {
    this.chunks.push(String(chunk))
    return true
  }

  end(): void {
    this.fire('finish')
  }

  close(): void {
    this.closed = true
  }

  get bytes(): number {
    return this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  }
}

class StubResponse extends StubEmitter {
  resumed = false
  private target: StubFile | null = null

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

  pipe(target: StubFile): StubFile {
    this.target = target
    return target
  }

  /** What `res.pipe(file)` does on the wire: stream the body, then end the file. */
  deliver(): void {
    if (this.body) {
      this.fire('data', this.body)
      this.target?.write(this.body)
    }
    this.fire('end')
    this.target?.end()
  }

  /** A stream that dies mid-body: bytes reach the file, then the file errors. */
  deliverThenFail(err: Error): void {
    if (this.body) {
      this.fire('data', this.body)
      this.target?.write(this.body)
    }
    this.target?.fire('error', err)
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

class StubChild extends StubEmitter {
  stderr: StubEmitter | null = new StubEmitter()
}

vi.mock('fs', () => ({
  existsSync: (p: string) => fsProbe.existing.has(String(p)) || fsProbe.files.has(String(p)),
  readFileSync: (p: string) => {
    const value = fsProbe.files.get(String(p))
    if (value === undefined) throw new Error(`ENOENT: ${p}`)
    return value
  },
  writeFileSync: vi.fn((p: string, data: string) => {
    fsProbe.written.push({ path: String(p), data: String(data) })
  }),
  mkdirSync: vi.fn((p: string, options?: unknown) => {
    fsProbe.mkdirs.push({ path: String(p), options })
  }),
  rmSync: vi.fn((p: string) => {
    if (fsProbe.rmThrows) throw new Error(`EBUSY: ${p}`)
    fsProbe.rmCalls.push(String(p))
    fsProbe.existing.delete(String(p))
  }),
  chmodSync: vi.fn((p: string, mode: number) => {
    fsProbe.chmods.push({ path: String(p), mode })
  }),
  renameSync: vi.fn((from: string, to: string) => {
    fsProbe.renames.push({ from: String(from), to: String(to) })
    fsProbe.existing.delete(String(from))
    fsProbe.existing.add(String(to))
  }),
  readdirSync: (dir: string) => {
    if (fsProbe.unreadable.has(String(dir))) throw new Error(`EACCES: ${dir}`)
    return fsProbe.dirs.get(String(dir)) ?? []
  },
  createReadStream: vi.fn(),
  createWriteStream: vi.fn((p: string) => {
    const sink = new StubFile(p)
    fsProbe.sinks.push(sink)
    return sink
  }),
}))

vi.mock('child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    const child = new StubChild()
    spawnProbe.calls.push({ cmd, args })
    const plan = spawnProbe.plan.shift()
    if (!plan) throw new Error(`rtkManager spawned ${cmd} with no scripted result`)
    if (plan.noStderr) child.stderr = null
    setImmediate(() => {
      if (plan.error) {
        child.fire('error', plan.error)
        return
      }
      if (plan.stderr) child.stderr?.fire('data', plan.stderr)
      for (const created of plan.creates ?? []) fsProbe.existing.add(created)
      child.fire('exit', plan.code ?? 0)
    })
    return child
  },
  // The download tests never let a CLI run; reaching this means a test leaked one.
  execFile: vi.fn(() => {
    throw new Error('rtkManager ran the rtk CLI during a download test')
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
    if (plan.hang) return req
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
      if (plan.fileError) {
        res.deliverThenFail(plan.fileError)
        return
      }
      res.deliver()
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
const ORIGINAL_ARCH = process.arch

type Manager = typeof import('../rtkManager')
type RtkManager = Manager['rtkManager']

async function loadManager(platform: NodeJS.Platform, arch = 'x64'): Promise<RtkManager> {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  Object.defineProperty(process, 'arch', { value: arch, configurable: true })
  const mod = (await import('../rtkManager')) as Manager
  return mod.rtkManager
}

function binaryOf(platform: NodeJS.Platform): string {
  return path.join(RTK_DIR, platform === 'win32' ? 'rtk.exe' : 'rtk')
}

const LINUX_ASSET = 'rtk-x86_64-unknown-linux-musl.tar.gz'
const LINUX_URL = `https://github.com/rtk-ai/rtk/releases/download/v0.43.1/${LINUX_ASSET}`

function releaseJson(...names: string[]): string {
  return JSON.stringify({
    tag_name: 'v0.43.1',
    assets: names.map((name) => ({
      name,
      browser_download_url: `https://github.com/rtk-ai/rtk/releases/download/v0.43.1/${name}`,
    })),
  })
}

/** Script a release offering exactly `asset`, then a 12-byte archive body. */
function scriptReleaseAndDownload(asset: string): void {
  net.plan.push({ body: releaseJson(asset) })
  net.plan.push({ headers: { 'content-length': '12' }, body: '0123456789ab' })
}

function sinkAt(index: number): StubFile {
  return fsProbe.sinks[index] as StubFile
}

function lastSink(): StubFile {
  return sinkAt(fsProbe.sinks.length - 1)
}

function archivePath(): string {
  return sinkAt(0).destPath
}

function collectProgress(manager: RtkManager): Array<Record<string, number>> {
  const seen: Array<Record<string, number>> = []
  manager.on('downloadProgress', (progress: Record<string, number>) => {
    seen.push(progress)
  })
  return seen
}

/** The single scratch path the pipeline used, ignoring how many attempts ran. */
function scratchPaths(): string[] {
  return [...new Set(fsProbe.rmCalls)]
}

beforeEach(() => {
  fsProbe.existing.clear()
  fsProbe.files.clear()
  fsProbe.dirs.clear()
  fsProbe.unreadable.clear()
  fsProbe.sinks = []
  fsProbe.rmCalls = []
  fsProbe.rmThrows = false
  fsProbe.chmods = []
  fsProbe.renames = []
  fsProbe.mkdirs = []
  fsProbe.written = []
  net.calls = []
  net.requests = []
  net.plan = []
  spawnProbe.calls = []
  spawnProbe.plan = []
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  Object.defineProperty(process, 'arch', { value: ORIGINAL_ARCH, configurable: true })
  vi.useRealTimers()
})

describe('release asset selection', () => {
  const cases: Array<{ platform: NodeJS.Platform; arch: string; asset: string }> = [
    { platform: 'win32', arch: 'x64', asset: 'rtk-x86_64-pc-windows-msvc.zip' },
    { platform: 'darwin', arch: 'arm64', asset: 'rtk-aarch64-apple-darwin.tar.gz' },
    { platform: 'darwin', arch: 'x64', asset: 'rtk-x86_64-apple-darwin.tar.gz' },
    { platform: 'linux', arch: 'x64', asset: LINUX_ASSET },
    { platform: 'linux', arch: 'arm64', asset: 'rtk-aarch64-unknown-linux-gnu.tar.gz' },
  ]

  for (const item of cases) {
    it(`requests ${item.asset} on ${item.platform}-${item.arch}`, async () => {
      const manager = await loadManager(item.platform, item.arch)
      scriptReleaseAndDownload(item.asset)
      // Stop inside extraction: everything before it is the platform decision.
      spawnProbe.plan.push({ code: 1, stderr: 'halted by test' })

      await expect(manager.downloadBinary()).rejects.toThrow(/halted by test/)
      expect(net.calls[1].url).toBe(
        `https://github.com/rtk-ai/rtk/releases/download/v0.43.1/${item.asset}`,
      )
      expect(archivePath()).toMatch(item.asset.endsWith('.zip') ? /\.zip$/ : /\.tar\.gz$/)
    })
  }

  it('unzips through PowerShell on Windows and untars elsewhere', async () => {
    const windows = await loadManager('win32')
    scriptReleaseAndDownload('rtk-x86_64-pc-windows-msvc.zip')
    spawnProbe.plan.push({ code: 1, stderr: 'halted by test' })
    await expect(windows.downloadBinary()).rejects.toThrow(/halted by test/)
    const winArchive = archivePath()
    expect(spawnProbe.calls[0]).toEqual({
      cmd: 'powershell.exe',
      args: [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${winArchive}" -DestinationPath "${RTK_DIR}" -Force`,
      ],
    })

    const mac = await loadManager('darwin', 'arm64')
    scriptReleaseAndDownload('rtk-aarch64-apple-darwin.tar.gz')
    spawnProbe.plan.push({ code: 1, stderr: 'halted by test' })
    await expect(mac.downloadBinary()).rejects.toThrow(/halted by test/)
    expect(spawnProbe.calls[1]).toEqual({
      cmd: 'tar',
      args: ['xzf', lastSink().destPath, '-C', RTK_DIR],
    })
  })

  it('refuses to download a build it does not ship for this machine', async () => {
    const manager = await loadManager('win32', 'arm64')
    net.plan.push({ body: releaseJson('rtk-x86_64-pc-windows-msvc.zip') })

    await expect(manager.downloadBinary()).rejects.toThrow('Unsupported platform: win32-arm64')
    expect(net.calls).toHaveLength(1)
  })

  it('fails loudly when the release carries no asset for this platform', async () => {
    const manager = await loadManager('linux')
    net.plan.push({ body: releaseJson('rtk-aarch64-windows.exe') })

    await expect(manager.downloadBinary()).rejects.toThrow(
      `No matching release asset found for platform: ${LINUX_ASSET}`,
    )
    expect(net.calls).toHaveLength(1)
    expect(fsProbe.sinks).toEqual([])
  })

  it('treats a release with no assets array as a missing asset', async () => {
    const manager = await loadManager('linux')
    net.plan.push({ body: JSON.stringify({ tag_name: 'v0.43.1' }) })

    await expect(manager.downloadBinary()).rejects.toThrow(/No matching release asset/)
  })
})

describe('fresh install', () => {
  it('downloads, extracts, chmods and records the version in one pass', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    scriptReleaseAndDownload(LINUX_ASSET)
    spawnProbe.plan.push({ code: 0, creates: [target] })
    const progress = collectProgress(manager)

    await expect(manager.ensureBinary()).resolves.toBe(target)

    expect(manager.isBinaryInstalled()).toBe(true)
    expect(fsProbe.mkdirs).toEqual([{ path: RTK_DIR, options: { recursive: true } }])
    expect(fsProbe.chmods).toEqual([{ path: target, mode: 0o755 }])
    expect(progress).toEqual([{ downloaded: 12, total: 12, percent: 100 }])
    expect(fsProbe.written).toHaveLength(1)
    expect(fsProbe.written[0].path).toBe(path.join(RTK_DIR, 'version.json'))
    expect(JSON.parse(fsProbe.written[0].data)).toMatchObject({ version: 'v0.43.1' })
    // The archive is scratch: it must not survive a successful install.
    expect(scratchPaths()).toEqual([archivePath()])
    expect(lastSink().closed).toBe(true)
  })

  it('returns the existing path without touching the network', async () => {
    const manager = await loadManager('linux')
    fsProbe.existing.add(binaryOf('linux'))

    await expect(manager.ensureBinary()).resolves.toBe(binaryOf('linux'))
    expect(net.calls).toEqual([])
  })

  it('leaves a Windows binary without an exec bit', async () => {
    const manager = await loadManager('win32')
    const target = binaryOf('win32')
    scriptReleaseAndDownload('rtk-x86_64-pc-windows-msvc.zip')
    spawnProbe.plan.push({ code: 0, creates: [target] })

    await manager.downloadBinary()

    expect(fsProbe.chmods).toEqual([])
    expect(manager.isBinaryInstalled()).toBe(true)
  })

  it('adopts a binary the archive nested in a subdirectory', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    const unpacked = path.join(RTK_DIR, 'rtk-0.43.1-x86_64-unknown-linux-musl')
    scriptReleaseAndDownload(LINUX_ASSET)
    spawnProbe.plan.push({ code: 0, creates: [path.join(unpacked, 'rtk')] })
    fsProbe.dirs.set(RTK_DIR, [
      { name: 'version.json', isFile: () => true, isDirectory: () => false },
      { name: path.basename(unpacked), isFile: () => false, isDirectory: () => true },
    ])
    fsProbe.dirs.set(unpacked, [
      { name: 'rtk', isFile: () => true, isDirectory: () => false },
    ])

    await manager.downloadBinary()

    expect(fsProbe.renames).toEqual([{ from: path.join(unpacked, 'rtk'), to: target }])
    expect(manager.isBinaryInstalled()).toBe(true)
  })

  it('matches the binary name case-insensitively', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    scriptReleaseAndDownload(LINUX_ASSET)
    spawnProbe.plan.push({ code: 0, creates: [path.join(RTK_DIR, 'unpack', 'RTK')] })
    fsProbe.dirs.set(RTK_DIR, [{ name: 'unpack', isFile: () => false, isDirectory: () => true }])
    fsProbe.dirs.set(path.join(RTK_DIR, 'unpack'), [
      { name: 'RTK', isFile: () => true, isDirectory: () => false },
    ])

    await manager.downloadBinary()

    expect(fsProbe.renames).toEqual([{ from: path.join(RTK_DIR, 'unpack', 'RTK'), to: target }])
  })

  it('skips a subdirectory it cannot list instead of aborting the search', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    const locked = path.join(RTK_DIR, '.fuse_hidden0')
    const unpacked = path.join(RTK_DIR, 'unpack')
    scriptReleaseAndDownload(LINUX_ASSET)
    spawnProbe.plan.push({ code: 0, creates: [path.join(unpacked, 'rtk')] })
    fsProbe.unreadable.add(locked)
    fsProbe.dirs.set(RTK_DIR, [
      { name: path.basename(locked), isFile: () => false, isDirectory: () => true },
      { name: path.basename(unpacked), isFile: () => false, isDirectory: () => true },
    ])
    fsProbe.dirs.set(unpacked, [{ name: 'rtk', isFile: () => true, isDirectory: () => false }])

    await manager.downloadBinary()

    expect(fsProbe.renames).toEqual([{ from: path.join(unpacked, 'rtk'), to: target }])
  })

  it('reports a failure, not a success, when the archive holds no binary', async () => {
    const manager = await loadManager('linux')
    scriptReleaseAndDownload(LINUX_ASSET)
    spawnProbe.plan.push({ code: 0 })
    fsProbe.dirs.set(RTK_DIR, [{ name: 'README.md', isFile: () => true, isDirectory: () => false }])

    await expect(manager.downloadBinary()).rejects.toThrow('RTK binary not found after extraction')
    expect(fsProbe.written).toEqual([])
    expect(manager.isBinaryInstalled()).toBe(false)
    expect(scratchPaths()).toEqual([archivePath()])
  })

  it('does not report progress when the server omits content-length', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({ body: '0123456789ab' })
    spawnProbe.plan.push({ code: 0, creates: [target] })
    const progress = collectProgress(manager)

    await manager.downloadBinary()

    expect(progress).toEqual([])
    expect(lastSink().bytes).toBe(12)
  })
})

describe('mirror fallback', () => {
  it('retries a failed direct download through the first mirror', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({ error: new Error('socket hang up') })
    net.plan.push({ headers: { 'content-length': '12' }, body: '0123456789ab' })
    spawnProbe.plan.push({ code: 0, creates: [target] })

    await manager.downloadBinary()

    expect(net.calls[1].url).toBe(LINUX_URL)
    expect(net.calls[2].url).toBe(`https://gh-proxy.com/${LINUX_URL}`)
    expect(manager.isBinaryInstalled()).toBe(true)
  })

  it('falls through to the second mirror when the first one 404s', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({ error: new Error('socket hang up') })
    net.plan.push({ status: 404, body: 'Not Found' })
    net.plan.push({ headers: { 'content-length': '12' }, body: '0123456789ab' })
    spawnProbe.plan.push({ code: 0, creates: [target] })

    await manager.downloadBinary()

    expect(net.calls[3].url).toBe(`https://ghproxy.net/${LINUX_URL}`)
    expect(fsProbe.written).toHaveLength(1)
  })

  it('follows a redirect to the real file location', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({
      status: 302,
      headers: { location: 'https://objects.githubusercontent.com/blob/1' },
    })
    net.plan.push({ headers: { 'content-length': '12' }, body: '0123456789ab' })
    spawnProbe.plan.push({ code: 0, creates: [target] })

    await manager.downloadBinary()

    expect(net.calls[2].url).toBe('https://objects.githubusercontent.com/blob/1')
    // The redirect hop wrote nothing into the scratch file it opened.
    expect(sinkAt(0).bytes).toBe(0)
    expect(lastSink().bytes).toBe(12)
  })

  it('gives up after the direct attempt and both mirrors fail', async () => {
    const manager = await loadManager('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({ error: new Error('ECONNRESET') })
    net.plan.push({ status: 503, body: 'busy' })
    net.plan.push({ reqTimeout: true })

    await expect(manager.downloadBinary()).rejects.toThrow(
      'All download sources failed (direct + mirrors)',
    )
    expect(net.calls).toHaveLength(4)
    expect(manager.isBinaryInstalled()).toBe(false)
    expect(fsProbe.written).toEqual([])
    // Three attempts share one scratch path, and every abort cleans it up.
    expect(fsProbe.sinks).toHaveLength(3)
    expect(scratchPaths()).toEqual([archivePath()])
  })

  it('deletes the partial archive left by a failing write stream', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({
      headers: { 'content-length': '12' },
      body: '01234567',
      fileError: new Error('ENOSPC: no space left on device'),
    })
    net.plan.push({ headers: { 'content-length': '12' }, body: '0123456789ab' })
    spawnProbe.plan.push({ code: 0, creates: [target] })

    await manager.downloadBinary()

    expect(sinkAt(0).bytes).toBe(8)
    expect(scratchPaths()).toEqual([archivePath()])
    expect(lastSink().bytes).toBe(12)
  })

  it('closes the write stream of every aborted attempt', async () => {
    const manager = await loadManager('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({ error: new Error('ECONNRESET') })
    net.plan.push({ status: 503, body: 'busy' })
    net.plan.push({ fileError: new Error('EACCES: permission denied') })

    await expect(manager.downloadBinary()).rejects.toThrow(/All download sources failed/)
    expect(fsProbe.sinks.map((sink) => (sink as StubFile).closed)).toEqual([true, true, true])
  })

  it('caps an idle download at the two-minute request timeout and destroys the socket', async () => {
    const manager = await loadManager('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({ reqTimeout: true })
    net.plan.push({ reqTimeout: true })
    net.plan.push({ reqTimeout: true })

    await expect(manager.downloadBinary()).rejects.toThrow(/All download sources failed/)
    const downloadRequests = net.requests.slice(1) as StubRequest[]
    expect(downloadRequests.map((req) => req.timeoutMs)).toEqual([120_000, 120_000, 120_000])
    expect(downloadRequests.every((req) => req.destroyCount === 1)).toBe(true)
  })
})

describe('interrupted downloads', () => {
  it('aborts a direct connection that never answers and hands over to the mirrors', async () => {
    vi.useFakeTimers()
    const manager = await loadManager('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({ hang: true })
    net.plan.push({ status: 503, body: 'busy' })
    net.plan.push({ status: 503, body: 'busy' })

    const pending = manager.downloadBinary()
    // Attach the rejection handler before the timers run, otherwise the failure
    // lands as an unhandled rejection instead of being observed here.
    const assertion = expect(pending).rejects.toThrow(
      'All download sources failed (direct + mirrors)',
    )
    await vi.runAllTimersAsync()

    await assertion
    expect(manager.isBinaryInstalled()).toBe(false)
    expect(fsProbe.written).toEqual([])
    expect(scratchPaths()).toEqual([archivePath()])
  })

  it('accepts a truncated archive as a completed install', async () => {
    // Records a gap, not an endorsement: nothing in the pipeline compares the
    // received byte count against content-length and no checksum is verified,
    // so a connection that dies early installs a corrupt binary silently.
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({ headers: { 'content-length': '9000' }, body: '01' })
    spawnProbe.plan.push({ code: 0, creates: [target] })
    const progress = collectProgress(manager)

    await expect(manager.downloadBinary()).resolves.toBeUndefined()

    expect(progress).toEqual([{ downloaded: 2, total: 9000, percent: 0 }])
    expect(JSON.parse(fsProbe.written[0].data).version).toBe('v0.43.1')
    expect(manager.isBinaryInstalled()).toBe(true)
  })

  it('surfaces the spawn error when tar is missing instead of hanging', async () => {
    const manager = await loadManager('linux')
    scriptReleaseAndDownload(LINUX_ASSET)
    spawnProbe.plan.push({ error: new Error('spawn tar ENOENT') })

    await expect(manager.downloadBinary()).rejects.toThrow('spawn tar ENOENT')
    expect(fsProbe.written).toEqual([])
  })

  it('surfaces the spawn error when PowerShell is missing', async () => {
    const manager = await loadManager('win32')
    scriptReleaseAndDownload('rtk-x86_64-pc-windows-msvc.zip')
    spawnProbe.plan.push({ error: new Error('spawn powershell.exe ENOENT') })

    await expect(manager.downloadBinary()).rejects.toThrow('spawn powershell.exe ENOENT')
    expect(manager.isBinaryInstalled()).toBe(false)
  })

  it('keeps the install failed when PowerShell reports a broken zip', async () => {
    const manager = await loadManager('win32')
    scriptReleaseAndDownload('rtk-x86_64-pc-windows-msvc.zip')
    spawnProbe.plan.push({ code: 1, stderr: 'Remove-Item : Cannot find path' })

    await expect(manager.downloadBinary()).rejects.toThrow(
      'PowerShell Expand-Archive failed: Remove-Item : Cannot find path',
    )
    expect(manager.isBinaryInstalled()).toBe(false)
  })

  it('reports tar failure text even when the child writes nothing to stderr', async () => {
    const manager = await loadManager('linux')
    scriptReleaseAndDownload(LINUX_ASSET)
    spawnProbe.plan.push({ code: 2, noStderr: true })

    await expect(manager.downloadBinary()).rejects.toThrow('tar xzf failed:')
    expect(fsProbe.written).toEqual([])
  })

  it('still calls the install a success when the scratch archive cannot be deleted', async () => {
    // The cleanup sits in a bare `catch {}`: an EBUSY on Windows leaves the
    // archive on disk forever and nobody is told — but the binary is fine.
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    scriptReleaseAndDownload(LINUX_ASSET)
    spawnProbe.plan.push({ code: 0, creates: [target] })
    fsProbe.rmThrows = true

    await expect(manager.downloadBinary()).resolves.toBeUndefined()
    expect(manager.isBinaryInstalled()).toBe(true)
    expect(fsProbe.rmCalls).toEqual([])
  })
})

describe('TLS downgrade during download', () => {
  it('retries an SSL-blocked download without certificate verification', async () => {
    const manager = await loadManager('linux')
    const target = binaryOf('linux')
    net.plan.push({ body: releaseJson(LINUX_ASSET) })
    net.plan.push({ error: new Error('unable to verify the first certificate') })
    net.plan.push({ headers: { 'content-length': '12' }, body: '0123456789ab' })
    spawnProbe.plan.push({ code: 0, creates: [target] })

    await manager.downloadBinary()

    expect(net.calls[1].options).toMatchObject({ rejectUnauthorized: true })
    expect(net.calls[2].options).toMatchObject({ rejectUnauthorized: false })
    expect(net.calls[2].url).toBe(LINUX_URL)
    expect(manager.isBinaryInstalled()).toBe(true)
  })
})
