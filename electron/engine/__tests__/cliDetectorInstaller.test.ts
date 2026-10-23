// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import type { InstallProgress } from '../../proxy/types'

/**
 * Installer half of `cliDetector`: `runStreamingInstaller` plus the three
 * installers built on top of it (winget / brew / `curl … | sh`), the
 * post-install re-detection, and the npm-registry update check that decides
 * whether the UI offers an install or an upgrade. The detection layer itself is
 * pinned by `cliDetector.test.ts` next door; nothing here re-tests lookup order.
 *
 * The contract, in priority order — this is what the progress bar promises the
 * user while a 300-second installer is running:
 *
 * 1. **The bar only ever moves forward, and never to the top.** Every installer
 *    runs inside `[floor, ceiling)` = `[5, 80)`: a parsed 100 % clamps to 79 so
 *    the `installing` / `verifying` / `done` frames (80 / 90 / 100) cannot read
 *    as a regression. A later, *lower* real percentage must not drag it back.
 * 2. **Bytes arriving means alive.** Each stdout/stderr chunk reports its last
 *    line as the message; total silence is covered by a 1 s heartbeat that
 *    crawls toward the ceiling. The original complaint was a bar parked at 0 %
 *    for a minute and then jumping to 80 %.
 * 3. **A non-zero *or* signalled exit is a failure**, carrying a stderr summary
 *    the UI can show — it must never fall through into a "success" re-check.
 * 4. **Timeout**: at 300 s the child gets SIGTERM and the promise rejects; the
 *    heartbeat must stop emitting frames afterwards.
 * 5. **Platform choice**: winget on Windows, brew on macOS, the official `sh`
 *    script on Linux. The re-check after installing must not trust PATH alone,
 *    because Electron snapshots PATH at startup — a binary installed seconds ago
 *    is invisible to `which`/`where` but visible under the npm global bin.
 * 6. **An update is done only when the version moved.** `npm install -g …@latest`
 *    exiting 0 says nothing about the binary PATH resolves to, so `updateCli`
 *    re-probes it and fails when it still answers the old version.
 * 7. **A registry miss is `checkFailed`, never "up to date"** — telling a user
 *    they are current because the network was unreachable is a claim the UI
 *    cannot walk back, and it suppresses the one button that would fix it.
 * 8. **A CLI that answers no version is `unusable`, which is actionable.** The
 *    bricked install (wrapper upgraded, native platform package never downloaded)
 *    must reach the repair path; folding it into `checkFailed` hides every
 *    button and leaves the user staring at "version too old".
 * 9. **npm is invoked through its resolved PATH entry.** `execFile('npm', …)`
 *    is `spawn npm ENOENT` on Windows — npm is `npm.cmd` and CreateProcess does
 *    not append PATHEXT. Answering the bare name in the fake made the entire
 *    update feature dead in the packaged app while every test here stayed green.
 * 10. **npm's script policy must not leave a stub.** npm 12 blocks install
 *    scripts by default and still exits 0, so `claude` resolves to a 500-byte
 *    placeholder. Installs pass `--allow-scripts` for the wrapper; if the CLI
 *    still cannot answer `--version`, the package's own `install.cjs` is run
 *    before the repair is declared failed.
 *
 * `isWindows` is a module-scope `process.platform` read, so every test imports
 * the module fresh under the platform it exercises (see `load`). Paths the
 * module builds with `path.join` are asserted against the same host-side join.
 */

type ExecResult = { stdout?: string; stderr?: string; error?: Error }
type ExecCall = {
  command: string
  args: string[]
  options: { shell?: boolean; timeout?: number; windowsHide?: boolean }
}
type SpawnCall = { command: string; args: string[]; options: Record<string, unknown> }
type Listener = (payload?: unknown) => void
type Sink = {
  on: (event: string, cb: Listener) => void
  push: (chunk: Buffer | string) => void
  listenerCount: () => number
}
type FakeChild = {
  stdout: Sink
  stderr: Sink
  on: (event: string, cb: Listener) => void
  kill: (signal?: string) => void
  killCalls: string[]
  killThrows: boolean
  emitClose: (code: number | null) => void
  emitError: (err: unknown) => void
  handlerCount: (event: string) => number
}

const probe = vi.hoisted(() => {
  const api: {
    execCalls: ExecCall[]
    spawns: SpawnCall[]
    children: FakeChild[]
    found: Map<string, string>
    versions: Map<string, string>
    npmRoot: string | null
    npmInstallError: Error | null
    npmLatestVersion: string | null
    existing: Set<string>
    openExternal: string[]
    respond: (call: ExecCall) => ExecResult
    makeChild: () => FakeChild
    isNpmCall: (command: string) => boolean
    reset: () => void
  } = {
    execCalls: [],
    spawns: [],
    children: [],
    found: new Map(),
    versions: new Map(),
    npmRoot: null,
    npmInstallError: null,
    npmLatestVersion: null,
    existing: new Set(),
    openExternal: [],
    respond: () => ({ stdout: '' }),
    makeChild,
    isNpmCall,
    reset,
  }

  /**
   * Matches an npm invocation whether the module passed the bare name or the
   * path it resolved from PATH. Keying strictly on `'npm'` would have let the
   * Windows `spawn npm ENOENT` bug pass every test in this file.
   */
  function isNpmCall(command: string): boolean {
    const base = command.split(/[\\/]/).pop() ?? ''
    return base.replace(/\.cmd$/i, '') === 'npm'
  }

  function makeSink(): Sink {
    const listeners: Listener[] = []
    return {
      on: (_event: string, cb: Listener) => {
        listeners.push(cb)
      },
      push: (chunk: Buffer | string) => {
        for (const cb of listeners.slice()) cb(chunk)
      },
      listenerCount: () => listeners.length,
    }
  }

  function makeChild(): FakeChild {
    const handlers: Record<string, Listener[]> = {}
    const child: FakeChild = {
      stdout: makeSink(),
      stderr: makeSink(),
      on: (event: string, cb: Listener) => {
        const bucket = handlers[event]
        if (bucket) bucket.push(cb)
        else handlers[event] = [cb]
      },
      kill: (signal?: string) => {
        if (child.killThrows) throw new Error('kill ESRCH')
        child.killCalls.push(signal ?? 'SIGTERM')
      },
      killCalls: [],
      killThrows: false,
      emitClose: (code: number | null) => {
        for (const cb of (handlers.close ?? []).slice()) cb(code)
      },
      emitError: (err: unknown) => {
        for (const cb of (handlers.error ?? []).slice()) cb(err)
      },
      handlerCount: (event: string) => (handlers[event] ?? []).length,
    }
    return child
  }

  /**
   * Declarative default: a test states what is on PATH, what version it
   * answers, and whether `npm install -g` errors — the fake child_process
   * derives every execFile reply from that.
   */
  function defaultRespond(call: ExecCall): ExecResult {
    if (call.command === 'where' || call.command === 'which') {
      const hit = api.found.get(call.args[0] ?? '')
      if (!hit) return { error: new Error('ENOENT: not found on PATH') }
      return { stdout: hit }
    }
    if (isNpmCall(call.command) && call.args[0] === 'root') {
      if (!api.npmRoot) return { error: new Error('npm is not installed') }
      return { stdout: api.npmRoot }
    }
    if (isNpmCall(call.command) && call.args[0] === 'install') {
      if (api.npmInstallError) return { error: api.npmInstallError }
      return { stdout: '' }
    }
    if (isNpmCall(call.command) && call.args[0] === 'view') {
      if (!api.npmLatestVersion) return { error: new Error('npm view exited with status 1') }
      return { stdout: api.npmLatestVersion }
    }
    if (call.args[0] === '--version') {
      const version = api.versions.get(call.command)
      if (version === undefined) return { error: new Error(`${call.command}: exited with status 42`) }
      return { stdout: version }
    }
    return { stdout: '' }
  }

  function reset(): void {
    api.execCalls.length = 0
    api.spawns.length = 0
    api.children.length = 0
    api.found.clear()
    api.versions.clear()
    api.npmRoot = null
    api.npmInstallError = null
    api.npmLatestVersion = null
    api.existing.clear()
    api.openExternal.length = 0
    api.respond = defaultRespond
  }

  reset()

  return api
})

vi.mock('child_process', () => ({
  execFile: (
    command: string,
    args: string[],
    options: ExecCall['options'],
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const call: ExecCall = { command, args, options }
    probe.execCalls.push(call)
    const result = probe.respond(call)
    // Microtask, not setImmediate: vitest's fake timers fake immediates by
    // default and most of these suites advance timers explicitly.
    Promise.resolve().then(() => cb(result.error ?? null, result.stdout ?? '', result.stderr ?? ''))
  },
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    const call: SpawnCall = { command, args, options }
    probe.spawns.push(call)
    const child = probe.makeChild()
    probe.children.push(child)
    return child
  },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => probe.existing.has(String(p)),
}))

vi.mock('electron', () => ({
  shell: {
    openExternal: (url: string) => {
      probe.openExternal.push(url)
    },
  },
}))

// Correct relative depth for this directory: a wrong path silently leaves the
// real logger wired up and the suite starts writing to disk.
vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const NODE_DOWNLOAD = 'https://nodejs.org/en/download/'
const GIT_DOWNLOAD = 'https://git-scm.com/downloads'
const CLI_OVERVIEW = 'https://docs.anthropic.com/en/docs/claude-code/overview'
const UV_DOCS = 'https://docs.astral.sh/uv/getting-started/installation/'

const INSTALLER_OPTIONS = { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true }

const ORIGINAL_PLATFORM = process.platform
const ENV_KEYS = ['APPDATA', 'LOCALAPPDATA', 'NPM_CONFIG_PREFIX'] as const
const ORIGINAL_ENV: Record<string, string | undefined> = {}
for (const key of ENV_KEYS) ORIGINAL_ENV[key] = process.env[key]

type Detector = typeof import('../cliDetector')

async function load(platform: NodeJS.Platform, env: Record<string, string> = {}): Promise<Detector> {
  vi.resetModules()
  probe.reset()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  return await import('../cliDetector')
}

/** Register a command as resolvable on PATH *and* answering `--version`. */
function available(name: string, binPath: string, version: string): string {
  probe.found.set(name, binPath)
  probe.versions.set(binPath, version)
  return binPath
}

function collect(frames: InstallProgress[]): (p: InstallProgress) => void {
  return (p) => {
    frames.push(p)
  }
}

function percents(frames: InstallProgress[]): number[] {
  return frames.map((f) => f.percent ?? -1)
}

function downloading(frames: InstallProgress[]): InstallProgress[] {
  return frames.filter((f) => f.stage === 'downloading')
}

function last<T>(xs: T[]): T {
  const value = xs[xs.length - 1]
  if (value === undefined) throw new Error('empty array')
  return value
}

function lastChild(): FakeChild {
  const child = probe.children[probe.children.length - 1]
  if (!child) throw new Error('nothing was spawned')
  return child
}

async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

/**
 * Drive the flow until the installer has been spawned. Everything in this
 * module settles on microtasks (the mocked execFile callback, the synchronous
 * stream emits), so no timer has to advance for the hand-off.
 */
async function waitForSpawns(count: number): Promise<void> {
  for (let i = 0; i < 200 && probe.spawns.length < count; i++) await flushMicrotasks()
  if (probe.spawns.length < count) {
    throw new Error(`expected ${count} spawn call(s), got ${probe.spawns.length}`)
  }
}

const lookupCalls = (): ExecCall[] =>
  probe.execCalls.filter((c) => c.command === 'where' || c.command === 'which')
const npmInstallCalls = (): ExecCall[] =>
  probe.execCalls.filter((c) => probe.isNpmCall(c.command) && c.args[0] === 'install')
const npmViewCalls = (): ExecCall[] =>
  probe.execCalls.filter((c) => probe.isNpmCall(c.command) && c.args[0] === 'view')
const versionProbeCalls = (): ExecCall[] => probe.execCalls.filter((c) => c.args[0] === '--version')
const postinstallCalls = (): ExecCall[] =>
  probe.execCalls.filter((c) => (c.args[0] ?? '').endsWith('install.cjs'))

/**
 * Let `npm install -g` stand in for a real upgrade: after it runs, every
 * `--version` probe answers `to`. Without this the fake always reports the same
 * version and the update flow can never observe progress.
 */
function upgradeOnInstall(to: string): void {
  const previous = probe.respond
  let installed = false
  probe.respond = (call) => {
    if (probe.isNpmCall(call.command) && call.args[0] === 'install') {
      installed = true
      return { stdout: '' }
    }
    if (installed && call.args[0] === '--version') return { stdout: to }
    return previous(call)
  }
}

beforeEach(() => {
  probe.reset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key]
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
})

describe('runStreamingInstaller — streaming progress frames', () => {
  it('reports every stdout line as a message while clamping the bar below its ceiling', async () => {
    const svc = await load('win32')
    available('uvx', 'C:\\tools\\uvx.cmd', 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)

    expect(probe.spawns[0]).toEqual({
      command: 'winget',
      args: [
        'install',
        '--id',
        'astral-sh.uv',
        '--accept-source-agreements',
        '--accept-package-agreements',
        '--silent',
      ],
      options: INSTALLER_OPTIONS,
    })
    const child = lastChild()
    expect(child.stdout.listenerCount()).toBe(1)
    expect(child.stderr.listenerCount()).toBe(1)
    expect(child.handlerCount('close')).toBe(1)
    expect(child.handlerCount('error')).toBe(1)

    child.stdout.push('Installing package metadata ...\n')
    child.stdout.push('  14.5 MB / 31.0 MB\r')
    child.stdout.push('  31.0 MB / 31.0 MB\r')
    // A winget repaint carrying no text at all: the child is alive, but there is
    // nothing to show and the bar already sits at its cap, so no frame is emitted.
    const beforeSilentChunk = frames.length
    child.stdout.push('\r\n')
    expect(frames.length).toBe(beforeSilentChunk)
    child.stdout.push('Download complete\nPackage installed successfully\r\n')

    child.emitClose(0)
    await expect(flow).resolves.toEqual({ success: true })

    expect(downloading(frames).map((f) => f.message)).toEqual([
      'Downloading astral-sh.uv...',
      'Installing package metadata ...',
      '14.5 MB / 31.0 MB',
      '31.0 MB / 31.0 MB',
      'Package installed successfully',
    ])
    // 14.5/31.0 = 46.8 % mapped onto [5,80] is 40; a finished download parses as
    // 100 % and still reports 79, leaving 80/90/100 for the closing frames.
    expect(percents(frames)).toEqual([5, 5, 40, 79, 79, 80, 90, 100])
    expect(frames.slice(5)).toEqual([
      { stage: 'installing', message: 'astral-sh.uv installed', percent: 80 },
      { stage: 'verifying', message: 'Verifying installation...', percent: 90 },
      { stage: 'done', message: 'uv installed successfully', percent: 100 },
    ])
  })

  it('keeps the bar monotonic when a later real percentage is lower than the estimate', async () => {
    const svc = await load('win32')
    available('uvx', 'C:\\tools\\uvx.cmd', 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    const child = lastChild()

    child.stdout.push('Progress: 100%\r')
    child.stdout.push('Progress: 60%\r')
    child.emitClose(0)
    await expect(flow).resolves.toEqual({ success: true })

    // The first frame clamps to ceiling-1; the second must not pull it back down.
    expect(percents(downloading(frames))).toEqual([5, 79, 79])
  })

  it('accepts decoded string chunks, not only Buffers', async () => {
    const svc = await load('win32')
    available('uvx', 'C:\\tools\\uvx.cmd', 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)

    lastChild().stdout.push('Progress: 50%\n')
    lastChild().emitClose(0)
    await expect(flow).resolves.toEqual({ success: true })

    // 50 % of [5,80] is 42.5, reported as 43.
    expect(percents(downloading(frames))).toEqual([5, 43])
  })

  it('reports the last line of a multi-line chunk and truncates the message to the UI budget', async () => {
    const svc = await load('win32')
    available('uvx', 'C:\\tools\\uvx.cmd', 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    const child = lastChild()

    child.stdout.push('Searching sources...\nFound package [astral-sh.uv]\n')
    expect(last(downloading(frames)).message).toBe('Found package [astral-sh.uv]')

    child.stdout.push(`${'▓'.repeat(200)}\n`)
    expect(last(downloading(frames)).message).toHaveLength(120)

    child.emitClose(0)
    await expect(flow).resolves.toEqual({ success: true })
  })

  it('has no line buffer, so a size bar split across chunks never reaches the percentage parser', async () => {
    const svc = await load('win32')
    available('uvx', 'C:\\tools\\uvx.cmd', 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    const child = lastChild()

    // Exactly how a real winget pipe fragments a wide progress line.
    child.stdout.push('Downloading 14.5 MB /')
    child.stdout.push(' 31.0 MB\n')
    child.emitClose(0)
    await expect(flow).resolves.toEqual({ success: true })

    // Both halves are parsed as standalone lines, neither matches, so the bar
    // stays at the floor and the UI only ever sees the tail of the sentence.
    expect(percents(downloading(frames))).toEqual([5, 5, 5])
    expect(downloading(frames).map((f) => f.message)).toEqual([
      'Downloading astral-sh.uv...',
      'Downloading 14.5 MB /',
      '31.0 MB',
    ])
  })

  it('accumulates stderr into the failure summary while still showing it as progress', async () => {
    const svc = await load('win32')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    const child = lastChild()

    child.stderr.push('Failed to download from source\r\n')
    child.stderr.push('0x80070005 : Access is denied.\r\n')
    expect(last(downloading(frames)).message).toBe('0x80070005 : Access is denied.')

    child.emitClose(-1978200065)
    await expect(flow).resolves.toEqual({
      success: false,
      error:
        'Failed to install uv automatically. Installation guide opened: winget install failed ' +
        '(exit -1978200065): Failed to download from source\r\n0x80070005 : Access is denied.',
    })
    expect(probe.openExternal).toEqual([UV_DOCS])
    expect(last(frames)).toEqual({
      stage: 'error',
      message:
        'winget install failed (exit -1978200065): Failed to download from source\r\n' +
        '0x80070005 : Access is denied.',
      percent: 100,
    })
    // The verification probes never run once the installer failed.
    expect(lookupCalls().filter((c) => c.args[0] === 'uvx')).toHaveLength(0)
  })

  it('stops the heartbeat and settles exactly once when the child closes twice', async () => {
    const svc = await load('win32')
    available('uvx', 'C:\\tools\\uvx.cmd', 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    const child = lastChild()

    child.emitClose(0)
    child.emitClose(1) // a re-issued close must not resurrect the finished run
    await expect(flow).resolves.toEqual({ success: true })

    expect(frames.filter((f) => f.stage === 'installing')).toHaveLength(1)
    expect(frames.filter((f) => f.stage === 'done')).toHaveLength(1)

    const settled = frames.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(frames.length).toBe(settled)
  })

  it('crawls one decaying step per second while the installer stays silent', async () => {
    const svc = await load('win32')
    available('uvx', 'C:\\tools\\uvx.cmd', 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    lastChild().emitClose(0)
    await expect(flow).resolves.toEqual({ success: true })

    // 10 % of the remaining distance per tick, so the bar never sits still even
    // when winget repaints one line and produces no readable bytes.
    expect(percents(downloading(frames))).toEqual([5, 13, 19])
    expect(downloading(frames).map((f) => f.message)).toEqual([
      'Downloading astral-sh.uv...',
      'Downloading astral-sh.uv...',
      'Downloading astral-sh.uv...',
    ])
  })

  it('kills the installer and fails the flow after the 300 second timeout', async () => {
    const svc = await load('win32')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)

    await vi.advanceTimersByTimeAsync(299_000)
    expect(probe.openExternal).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(flow).resolves.toEqual({
      success: false,
      error: 'Failed to install uv automatically. Installation guide opened: Installer timed out after 300s',
    })
    expect(lastChild().killCalls).toEqual(['SIGTERM'])
    expect(last(frames)).toEqual({ stage: 'error', message: 'Installer timed out after 300s', percent: 100 })
    expect(probe.openExternal).toEqual([UV_DOCS])
    // No uvx probe: a timed-out download must not be reported as "installed but
    // not on PATH", which is the message that sends the user chasing PATH.
    expect(lookupCalls().filter((c) => c.args[0] === 'uvx')).toHaveLength(0)

    const timedOut = frames.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(frames.length).toBe(timedOut)
  })

  it('still rejects when the timed-out child refuses to be killed', async () => {
    const svc = await load('win32')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    lastChild().killThrows = true

    await vi.advanceTimersByTimeAsync(300_000)
    await expect(flow).resolves.toEqual({
      success: false,
      error: expect.stringContaining('Installer timed out after 300s'),
    })
    expect(last(frames).stage).toBe('error')
  })

  it('reports a spawn failure and ignores a close that arrives after it', async () => {
    const svc = await load('win32')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    const child = lastChild()

    child.emitError(Object.assign(new Error('spawn winget ENOENT'), { code: 'ENOENT' }))
    child.emitClose(0) // a late success code must not flip the run green
    await expect(flow).resolves.toEqual({
      success: false,
      error: expect.stringContaining('spawn winget ENOENT'),
    })
    expect(frames.filter((f) => f.stage === 'installing')).toHaveLength(0)
    expect(frames.filter((f) => f.stage === 'done')).toHaveLength(0)
  })

  it('surfaces a rejection that is not an Error as its own text', async () => {
    const svc = await load('win32')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    lastChild().emitError('winget is not available on this machine')

    await expect(flow).resolves.toEqual({
      success: false,
      error:
        'Failed to install uv automatically. Installation guide opened: winget is not available on this machine',
    })
    expect(last(frames)).toEqual({
      stage: 'error',
      message: 'winget is not available on this machine',
      percent: 100,
    })
  })

  it('reports a silent winget failure as an unknown error instead of an empty reason', async () => {
    const svc = await load('win32')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    lastChild().emitClose(5)

    await expect(flow).resolves.toEqual({
      success: false,
      error: expect.stringContaining('winget install failed (exit 5): unknown error'),
    })
    expect(last(frames).message).toBe('winget install failed (exit 5): unknown error')
  })

  it('caps the reported stderr summary at 200 characters', async () => {
    const svc = await load('win32')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    lastChild().stderr.push(`${'E'.repeat(300)}\n`)
    lastChild().emitClose(1)

    await expect(flow).resolves.toEqual({
      success: false,
      error: expect.stringContaining(`winget install failed (exit 1): ${'E'.repeat(200)}`),
    })
    const message = last(frames).message
    expect(message).toBe(`winget install failed (exit 1): ${'E'.repeat(200)}`)
    expect(message).not.toContain('E'.repeat(201))
  })

  it('treats a signalled exit as a failure rather than a zero code', async () => {
    const svc = await load('win32')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    // Node hands `null` for a process reaped by a signal (the user killed winget,
    // or the session ended) — `code ?? 1` must not read that as success.
    lastChild().emitClose(null)

    await expect(flow).resolves.toEqual({
      success: false,
      error: expect.stringContaining('winget install failed (exit 1): unknown error'),
    })
    expect(frames.some((f) => f.stage === 'done')).toBe(false)
  })

  it('reports success with a restart hint when only uv reached the stale PATH', async () => {
    const svc = await load('win32')
    // uv landed, uvx is not on the PATH snapshot yet, and uv answers with a
    // decorated banner.
    available('uv', 'C:\\tools\\uv.cmd', 'uv 0.5.15 3f2a1b')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    lastChild().emitClose(0)

    await expect(flow).resolves.toEqual({ success: true })
    expect(probe.openExternal).toHaveLength(0)
    expect(frames.filter((f) => f.stage === 'done')).toEqual([
      { stage: 'done', message: 'uv installed (restart shell to refresh PATH)', percent: 100 },
    ])
    // uvx first, then uv — that order is what produces the restart hint instead
    // of a flat "not detected".
    expect(lookupCalls().map((c) => c.args[0])).toEqual(['uvx', 'uv'])
  })

  it('says the install is incomplete when neither uvx nor uv shows up', async () => {
    const svc = await load('win32')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    lastChild().emitClose(0)

    await expect(flow).resolves.toEqual({
      success: false,
      error: 'Installation completed but uvx not detected in PATH. You may need to restart your shell.',
    })
    expect(last(frames)).toEqual({
      stage: 'error',
      message: 'Installation completed but uvx not detected',
      percent: 100,
    })
    expect(lookupCalls().map((c) => c.args[0])).toEqual(['uvx', 'uv'])
  })
})

describe('runStreamingInstaller — platform-specific installers', () => {
  it('maps brew stage banners onto the bar and never lets a later stage move it back', async () => {
    const svc = await load('darwin')
    available('uvx', path.join('/opt', 'homebrew', 'bin', 'uvx'), 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)

    expect(probe.spawns[0]).toEqual({
      command: 'brew',
      args: ['install', 'uv'],
      options: INSTALLER_OPTIONS,
    })

    const child = lastChild()
    child.stdout.push('#################### 50.0%\n')
    child.stdout.push('==> Pouring uv--0.5.15.bottle.tar.gz\n')
    child.stdout.push('==> Installing uv\n')
    child.emitClose(0)
    await expect(flow).resolves.toEqual({ success: true })

    // 50 % -> 43; Pouring is the 90 % stage -> 73; Installing is the *earlier*
    // 85 % stage banner, and a rebuild can reprint it after Pouring, so the bar
    // must stay put rather than fall back to 68.
    expect(percents(downloading(frames))).toEqual([5, 43, 73, 73])
  })

  it('pipes the official installer script through `sh -c` on Linux', async () => {
    const svc = await load('linux')
    available('uvx', path.join(os.homedir(), '.local', 'bin', 'uvx'), 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)

    expect(probe.spawns[0]).toEqual({
      command: 'sh',
      args: ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'],
      options: INSTALLER_OPTIONS,
    })

    const child = lastChild()
    child.stdout.push('downloading uv 0.5.15 x86_64-unknown-linux-gnu\n')
    expect(percents(downloading(frames))).toEqual([5, 5])
    child.emitClose(0)

    await expect(flow).resolves.toEqual({ success: true })
    expect(frames.slice(-3).map((f) => [f.stage, f.percent])).toEqual([
      ['installing', 80],
      ['verifying', 90],
      ['done', 100],
    ])
  })

  it('surfaces the script exit code and stderr tail when curl is unavailable', async () => {
    const svc = await load('linux')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    const child = lastChild()

    child.stderr.push('sh: curl: command not found\n')
    child.emitClose(127)

    await expect(flow).resolves.toEqual({
      success: false,
      error:
        'Failed to install uv automatically. Installation guide opened: ' +
        'uv install script exited with code 127: sh: curl: command not found',
    })
    expect(probe.openExternal).toEqual([UV_DOCS])
    expect(lookupCalls()).toHaveLength(0)
  })

  it('never routes an installer command through a second shell', async () => {
    const svc = await load('linux')
    available('uvx', path.join(os.homedir(), '.local', 'bin', 'uvx'), 'uvx 0.5.15')

    const frames: InstallProgress[] = []
    const flow = svc.installCommand('uv', collect(frames))
    await waitForSpawns(1)
    lastChild().emitClose(0)
    await flow

    // `sh -c <script>` is already a shell; shell:true would re-quote the pipe and
    // hand the user an installer that cannot run.
    for (const call of probe.spawns) expect(call.options.shell).toBe(false)
  })
})

describe('installCli — dependency installers and the post-install re-check', () => {
  it('runs no installer at all when node, npm and git are already available', async () => {
    const svc = await load('linux')
    available('node', path.join('/usr', 'bin', 'node'), 'v22.1.0')
    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    available('git', path.join('/usr', 'bin', 'git'), '2.45.0')
    available('claude', path.join(os.homedir(), '.local', 'bin', 'claude'), '2.1.0')

    const frames: InstallProgress[] = []
    await expect(svc.installCli(null, collect(frames))).resolves.toEqual({ success: true })

    expect(probe.spawns).toHaveLength(0)
    expect(npmInstallCalls()).toHaveLength(1)
    expect(npmInstallCalls()[0]?.args).toEqual([
      'install',
      '-g',
      '--allow-scripts=@anthropic-ai/claude-code',
      '@anthropic-ai/claude-code',
    ])
    expect(frames).toEqual([
      { stage: 'installing', message: 'Installing @anthropic-ai/claude-code...', percent: 50 },
      { stage: 'verifying', message: 'Verifying installation...', percent: 90 },
      { stage: 'done', message: 'Claude Code CLI installed successfully', percent: 100 },
    ])
  })

  it('re-detects through the npm global bin when PATH is still the startup snapshot', async () => {
    const svc = await load('linux')
    available('node', path.join('/usr', 'bin', 'node'), 'v22.1.0')
    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    available('git', path.join('/usr', 'bin', 'git'), '2.45.0')
    // `which claude` still misses: Electron cached PATH before the install ran.
    const npmRoot = path.join('/usr', 'lib', 'node_modules')
    probe.npmRoot = npmRoot
    const bin = path.join(npmRoot, '.bin', 'claude')
    probe.existing.add(path.join(npmRoot, '@anthropic-ai', 'claude-code'))
    probe.existing.add(bin)
    probe.versions.set(bin, 'claude code 2.1.0 (npm global)')

    const frames: InstallProgress[] = []
    await expect(svc.installCli(null, collect(frames))).resolves.toEqual({ success: true })

    expect(last(frames)).toEqual({
      stage: 'done',
      message: 'Claude Code CLI installed successfully',
      percent: 100,
    })
    expect(lookupCalls().filter((c) => c.args[0] === 'claude')).toHaveLength(1)
    expect(versionProbeCalls().map((c) => c.command)).toContain(bin)
  })

  it('installs Node.js and Git through two separate winget runs on Windows', async () => {
    const svc = await load('win32')
    const claude = available('claude', 'C:\\tools\\claude.cmd', '2.1.0')
    const frames: InstallProgress[] = []

    const flow = svc.installCli(null, collect(frames))
    await waitForSpawns(1)
    expect(probe.spawns[0]?.args).toEqual([
      'install',
      '--id',
      'OpenJS.NodeJS.LTS',
      '--accept-source-agreements',
      '--accept-package-agreements',
      '--silent',
    ])
    lastChild().stdout.push('  14.5 MB / 31.0 MB\r')
    lastChild().emitClose(0)

    await waitForSpawns(2)
    expect(probe.spawns[1]?.args).toEqual([
      'install',
      '--id',
      'Git.Git',
      '--accept-source-agreements',
      '--accept-package-agreements',
      '--silent',
    ])
    lastChild().emitClose(0)

    await expect(flow).resolves.toEqual({ success: true })

    // Node and npm share one winget id, so a missing npm must not trigger a
    // second runtime installer; Git is a separate package that runs afterwards.
    expect(probe.spawns.map((s) => s.command)).toEqual(['winget', 'winget'])
    expect(npmInstallCalls()).toHaveLength(1)
    // Note the `downloading` reset between installers: the Git run restarts at its
    // own floor after the Node run reached 80, and the CLI install then emits 50.
    // Monotonicity is only guaranteed *within* a stage band (see the clamping
    // suite above) — this is the known band boundary, not a regression of it.
    expect(frames.map((f) => [f.stage, f.message])).toEqual([
      ['downloading', 'Downloading OpenJS.NodeJS.LTS...'],
      ['downloading', '14.5 MB / 31.0 MB'],
      ['installing', 'OpenJS.NodeJS.LTS installed'],
      ['downloading', 'Downloading Git.Git...'],
      ['installing', 'Git.Git installed'],
      ['installing', 'Installing @anthropic-ai/claude-code...'],
      ['verifying', 'Verifying installation...'],
      ['done', 'Claude Code CLI installed successfully'],
    ])
    expect(versionProbeCalls().map((c) => c.command)).toContain(claude)
  })

  it('aborts the whole installation when winget is killed partway through', async () => {
    const svc = await load('win32')
    const frames: InstallProgress[] = []

    const flow = svc.installCli(null, collect(frames))
    await waitForSpawns(1)
    lastChild().emitClose(null) // the user killed winget

    await expect(flow).resolves.toEqual({
      success: false,
      error:
        'Failed to install dependencies automatically. Download pages have been opened. ' +
        'Error: winget install failed (exit 1): unknown error',
    })
    // `npm install -g` cannot work without the runtime it just failed to add.
    expect(npmInstallCalls()).toHaveLength(0)
    expect(probe.spawns).toHaveLength(1)
    // npm ships with Node, so the missing-npm entry re-opens the Node.js page —
    // the user gets one tab per missing item rather than one per distinct page.
    expect(probe.openExternal).toEqual([NODE_DOWNLOAD, NODE_DOWNLOAD, GIT_DOWNLOAD, CLI_OVERVIEW])
    // Characterization of what the UI actually receives today: the run stops on
    // the installer's own `downloading` frame. The agreed design (an `error`
    // frame carrying the installer's message plus a closing `done`) is NOT
    // implemented in this module, so a progress-driven bar stays parked here and
    // the failure only reaches the caller through the returned value. Update this
    // array when the product side lands — do not soften it to hide the gap.
    expect(frames).toEqual([
      { stage: 'downloading', message: 'Downloading OpenJS.NodeJS.LTS...', percent: 5 },
    ])
  })

  it('installs git on its own when only git is missing on posix', async () => {
    const svc = await load('linux')
    available('node', path.join('/usr', 'bin', 'node'), 'v22.1.0')
    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    available('claude', path.join(os.homedir(), '.local', 'bin', 'claude'), '2.1.0')

    const frames: InstallProgress[] = []
    const flow = svc.installCli(null, collect(frames))
    await waitForSpawns(1)

    expect(probe.spawns[0]).toEqual({
      command: 'brew',
      args: ['install', 'git'],
      options: INSTALLER_OPTIONS,
    })
    lastChild().emitClose(0)
    await expect(flow).resolves.toEqual({ success: true })

    // A present node/npm must not drag the Node installer along; only the one
    // missing dependency is installed.
    expect(probe.spawns).toHaveLength(1)
    expect(last(frames)).toEqual({
      stage: 'done',
      message: 'Claude Code CLI installed successfully',
      percent: 100,
    })
  })

  it('resolves with a reportable failure when the renderer it streams to disappears', async () => {
    const svc = await load('linux')
    available('node', path.join('/usr', 'bin', 'node'), 'v22.1.0')
    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    available('git', path.join('/usr', 'bin', 'git'), '2.45.0')
    available('claude', path.join(os.homedir(), '.local', 'bin', 'claude'), '2.1.0')

    const frames: InstallProgress[] = []
    // `webContents.send` throws once the window is destroyed; this runs inside
    // `ipcMain.handle`, where an escaping exception becomes an IPC rejection the
    // renderer has no catch for.
    const sink = (p: InstallProgress): void => {
      if (p.stage === 'done') throw new Error('Object has been destroyed')
      frames.push(p)
    }

    await expect(svc.installCli(null, sink)).resolves.toEqual({
      success: false,
      error: 'Object has been destroyed',
    })
    expect(last(frames)).toEqual({
      stage: 'error',
      message: 'Object has been destroyed',
      percent: 100,
    })
  })

  it('opens exactly the download pages for what is still missing when brew fails', async () => {
    const svc = await load('linux')
    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    // git resolves on PATH but cannot answer --version: unusable.
    probe.found.set('git', path.join('/usr', 'bin', 'git'))
    const frames: InstallProgress[] = []

    const flow = svc.installCli(null, collect(frames))
    await waitForSpawns(1)
    expect(probe.spawns[0]).toEqual({
      command: 'brew',
      args: ['install', 'node'],
      options: INSTALLER_OPTIONS,
    })
    lastChild().stderr.push('Error: Failed to download!\n')
    lastChild().emitClose(1)

    await expect(flow).resolves.toEqual({
      success: false,
      error:
        'Failed to install dependencies automatically. Download pages have been opened. ' +
        'Error: brew install failed (exit 1): Error: Failed to download!',
    })
    // node missing -> the Node.js page; git unusable -> the git page; then the
    // CLI overview. npm is present, so it adds no duplicate Node.js entry.
    expect(probe.openExternal).toEqual([NODE_DOWNLOAD, GIT_DOWNLOAD, CLI_OVERVIEW])
    expect(npmInstallCalls()).toHaveLength(0)
    // Characterization: the brew stderr does reach the UI, but only as a
    // `downloading` message, and the stream ends there — no `error` frame, no
    // closing `done`. The agreed design (error frame carrying the installer's
    // message, then `done`) is not implemented in this module; when it lands,
    // this array is what changes.
    expect(frames).toEqual([
      { stage: 'downloading', message: 'Downloading node...', percent: 5 },
      { stage: 'downloading', message: 'Error: Failed to download!', percent: 5 },
    ])
  })

  it('opens only the Claude Code guide when the npm install itself fails', async () => {
    const svc = await load('linux')
    available('node', path.join('/usr', 'bin', 'node'), 'v22.1.0')
    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    available('git', path.join('/usr', 'bin', 'git'), '2.45.0')
    probe.npmInstallError = new Error('npm ERR! code EACCES')

    const frames: InstallProgress[] = []
    await expect(svc.installCli(null, collect(frames))).resolves.toEqual({
      success: false,
      error:
        'Failed to install CLI via npm. Download page has been opened. Error: npm ERR! code EACCES',
    })
    expect(probe.openExternal).toEqual([CLI_OVERVIEW])
    // No point scanning for a CLI whose install command just errored.
    expect(lookupCalls().filter((c) => c.args[0] === 'claude')).toHaveLength(0)
    // Characterization: the run ends on the installer's own frame — last frame
    // `installing` / 50 % / 'Installing @anthropic-ai/claude-code...', with no
    // `error` and no `done`. The failure only reaches the caller as the returned
    // value, so an install that fails this late leaves the bar parked.
    expect(frames).toEqual([
      { stage: 'installing', message: 'Installing @anthropic-ai/claude-code...', percent: 50 },
    ])
  })

  it('reports the honest failure when the CLI is still invisible after a green npm install', async () => {
    const svc = await load('linux')
    available('node', path.join('/usr', 'bin', 'node'), 'v22.1.0')
    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    available('git', path.join('/usr', 'bin', 'git'), '2.45.0')
    const frames: InstallProgress[] = []

    await expect(svc.installCli(null, collect(frames))).resolves.toEqual({
      success: false,
      error: 'Installation completed but CLI not detected in PATH',
    })
    expect(last(frames)).toEqual({
      stage: 'error',
      message: 'Installation completed but CLI not detected',
      percent: 100,
    })
    // All three lookup strategies were tried before giving up. The second
    // `npm` is resolveNpmCommand() re-resolving the package manager for the
    // `npm install -g` it is about to run.
    expect(lookupCalls().map((c) => c.args[0])).toEqual(['node', 'npm', 'git', 'npm', 'claude'])
    expect(npmInstallCalls()).toHaveLength(1)
  })

  it('does not report success when claude is only a stub that answers no version', async () => {
    const svc = await load('linux')
    const NODE = path.join('/usr', 'bin', 'node')
    const npmRoot = path.join('/usr', 'lib', 'node_modules')
    const CLAUDE = path.join('/opt', 'claude')
    const SCRIPT = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'install.cjs')

    available('node', NODE, 'v24.18.0')
    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    available('git', path.join('/usr', 'bin', 'git'), '2.45.0')
    available('claude', CLAUDE, '0')
    probe.versions.delete(CLAUDE)
    probe.npmRoot = npmRoot
    probe.existing.add(SCRIPT)

    const previous = probe.respond
    probe.respond = (call) => {
      if (call.command === NODE && call.args[0] === SCRIPT) {
        return { stdout: '', stderr: 'native package still missing' }
      }
      return previous(call)
    }

    const frames: InstallProgress[] = []
    const result = await svc.installCli(null, collect(frames))

    expect(result.success).toBe(false)
    expect(result.error).toContain('claude --version still fails')
    expect(postinstallCalls()).toHaveLength(1)
    expect(last(frames)).toEqual({
      stage: 'error',
      message: 'Installed but claude --version still fails',
      percent: 100,
    })
  })
})

describe('checkCliUpdate — comparing the installed CLI against npm', () => {
  const NPM = path.join('/usr', 'bin', 'npm')

  /** npm on PATH, a CLI on PATH answering `installed`, and a registry saying `latest`. */
  async function ready(installed: string | null, latest: string | null): Promise<Detector> {
    const svc = await load('linux')
    available('npm', NPM, '11.3.0')
    const claude = available('claude', path.join('/opt', 'claude'), '0')
    if (installed === null) probe.versions.delete(claude)
    else probe.versions.set(claude, installed)
    probe.npmLatestVersion = latest
    return svc
  }

  it('skips the registry entirely when no CLI is installed', async () => {
    const svc = await load('linux')
    available('npm', NPM, '11.3.0')
    probe.npmLatestVersion = '2.1.307'

    await expect(svc.checkCliUpdate()).resolves.toEqual({
      installed: false,
      installedVersion: null,
      latestVersion: null,
      hasUpdate: false,
      unusable: false,
      checkFailed: false,
    })
    expect(npmViewCalls()).toHaveLength(0)
  })

  it('flags an update only when the registry version is strictly newer', async () => {
    const svc = await ready('2.1.227', '2.1.307')

    await expect(svc.checkCliUpdate()).resolves.toEqual({
      installed: true,
      installedVersion: '2.1.227',
      latestVersion: '2.1.307',
      hasUpdate: true,
      unusable: false,
      checkFailed: false,
    })
    // `npm view`, not a direct registry fetch: it inherits the user's .npmrc
    // mirror, so the version we advertise is one npm can actually install.
    expect(npmViewCalls()[0]?.args).toEqual(['view', '@anthropic-ai/claude-code', 'version'])
  })

  it('runs npm through its resolved PATH entry, never the bare command name', async () => {
    // Windows regression: `execFile('npm', …)` dies with `spawn npm ENOENT`
    // because npm is npm.cmd and CreateProcess does not append PATHEXT. The
    // whole update feature was dead in the packaged app and every test here
    // still passed, because the fake answered the bare name.
    const svc = await ready('2.1.227', '2.1.307')
    await svc.checkCliUpdate()

    const view = npmViewCalls()[0]
    expect(view?.command).toBe(NPM)
    expect(lookupCalls().map((c) => c.args[0])).toContain('npm')
  })

  it.each([
    ['identical versions', '2.1.307', '2.1.307'],
    // rc / slow channel users run ahead of the registry — not an update, and
    // above all not a failure.
    ['a local build newer than the registry', '2.2.0', '2.1.307'],
  ])('reports no update for %s', async (_label, installed, latest) => {
    const svc = await ready(installed, latest)

    await expect(svc.checkCliUpdate()).resolves.toMatchObject({
      hasUpdate: false,
      unusable: false,
      checkFailed: false,
    })
  })

  it('surfaces a registry failure as checkFailed rather than as "up to date"', async () => {
    const svc = await ready('2.1.227', null)

    await expect(svc.checkCliUpdate()).resolves.toEqual({
      installed: true,
      installedVersion: '2.1.227',
      latestVersion: null,
      hasUpdate: false,
      unusable: false,
      checkFailed: true,
    })
  })

  it('calls a CLI that answers no version unusable, not a failed check', async () => {
    // The bricked-install state: npm upgraded the wrapper but the ~290 MB
    // native package never landed, so bin/claude is a stub that only prints an
    // error. Folding this into checkFailed hid every button and left the user
    // with a bare "version too old" and no way out.
    const svc = await ready(null, '2.1.307')

    await expect(svc.checkCliUpdate()).resolves.toEqual({
      installed: true,
      installedVersion: null,
      latestVersion: null,
      hasUpdate: false,
      unusable: true,
      checkFailed: false,
    })
    // Pointless to ask the registry — a repair is needed either way.
    expect(npmViewCalls()).toHaveLength(0)
  })

  it('answers a second check from the cache without re-querying npm', async () => {
    const svc = await ready('2.1.227', '2.1.307')

    await svc.checkCliUpdate()
    await svc.checkCliUpdate()

    expect(npmViewCalls()).toHaveLength(1)
  })

  it('serves the cached conclusion to the settings page without spawning the CLI again', async () => {
    const svc = await ready('2.1.227', '2.1.307')
    await svc.checkCliUpdate()
    const probes = versionProbeCalls().length

    await svc.checkCliUpdate()

    expect(versionProbeCalls()).toHaveLength(probes)
    expect(svc.getCliUpdateState()).toEqual({
      result: expect.objectContaining({ installedVersion: '2.1.227', latestVersion: '2.1.307', hasUpdate: true }),
      checkedAt: expect.any(Number),
      stale: false,
    })
  })

  it('re-checks once the 12h window expires, and a forced check ignores both caches', async () => {
    const svc = await ready('2.1.227', '2.1.307')
    await svc.checkCliUpdate()
    const afterFirst = versionProbeCalls().length

    vi.advanceTimersByTime(13 * 60 * 60 * 1000)
    expect(svc.getCliUpdateState()?.stale).toBe(true)

    await svc.checkCliUpdate()
    const afterStale = versionProbeCalls().length
    expect(afterStale).toBeGreaterThan(afterFirst)

    await svc.checkCliUpdate({ force: true })
    expect(versionProbeCalls().length).toBeGreaterThan(afterStale)
  })

  it('drops the cached conclusion when the CLI is installed, updated, or the source changes', async () => {
    const svc = await ready('2.1.227', '2.1.307')
    await svc.checkCliUpdate()
    expect(svc.getCliUpdateState()).not.toBeNull()

    svc.invalidateCliUpdateState()

    expect(svc.getCliUpdateState()).toBeNull()
  })

  it('keeps the last good conclusion when a later registry query fails', async () => {
    const svc = await ready('2.1.227', '2.1.307')
    await svc.checkCliUpdate()
    // 让 10 分钟 registry 缓存过期，强制检查才会真的再问一次 npm
    vi.advanceTimersByTime(11 * 60 * 1000)
    probe.npmLatestVersion = null

    await expect(svc.checkCliUpdate({ force: true })).resolves.toMatchObject({ checkFailed: true })

    // 失败的尝试不能把「发现新版本」改成一次新鲜的「无法检查」。
    expect(svc.getCliUpdateState()?.result).toMatchObject({
      installedVersion: '2.1.227',
      latestVersion: '2.1.307',
      hasUpdate: true,
    })
  })
})

describe('updateCli — npm @latest plus the version-advance re-check', () => {
  const NPM = path.join('/usr', 'bin', 'npm')
  const CLAUDE = path.join('/opt', 'claude')

  /** npm + a CLI that answers `version` (or nothing, when null). */
  async function ready(version: string | null): Promise<Detector> {
    const svc = await load('linux')
    available('npm', NPM, '11.3.0')
    available('claude', CLAUDE, '0')
    if (version === null) probe.versions.delete(CLAUDE)
    else probe.versions.set(CLAUDE, version)
    return svc
  }

  it('upgrades through npm and only reports success once the version moves', async () => {
    const svc = await ready('2.1.227')
    upgradeOnInstall('2.1.307')
    const frames: InstallProgress[] = []

    await expect(svc.updateCli(collect(frames))).resolves.toEqual({ success: true })

    expect(npmInstallCalls()[0]?.command).toBe(NPM)
    expect(npmInstallCalls()[0]?.args).toEqual([
      'install',
      '-g',
      '--allow-scripts=@anthropic-ai/claude-code',
      '@anthropic-ai/claude-code@latest',
    ])
    expect(frames).toEqual([
      {
        stage: 'installing',
        message: 'Installing @anthropic-ai/claude-code@latest...',
        percent: 50,
      },
      { stage: 'verifying', message: 'Verifying installation...', percent: 90 },
      { stage: 'done', message: 'Updated to v2.1.307', percent: 100 },
    ])
    // Both probes must hit the same PATH-resolved binary — that is the file the
    // next session will spawn.
    expect(versionProbeCalls().map((c) => c.command)).toEqual([CLAUDE, CLAUDE])
    // A healthy install needs no manual postinstall.
    expect(postinstallCalls()).toHaveLength(0)
  })

  it('refuses to update when nothing is installed, without touching npm', async () => {
    const svc = await load('linux')
    const frames: InstallProgress[] = []

    await expect(svc.updateCli(collect(frames))).resolves.toEqual({
      success: false,
      error: 'Claude Code CLI is not installed. Install it first.',
    })
    expect(npmInstallCalls()).toHaveLength(0)
    expect(last(frames)).toEqual({
      stage: 'error',
      message: 'Claude Code CLI not detected',
      percent: 100,
    })
  })

  it('treats a version-less CLI as something to repair, not a reason to refuse', async () => {
    // The bricked install must still reach npm — refusing here is what left the
    // user with a dead CLI and no button.
    const svc = await ready(null)
    upgradeOnInstall('2.1.307')
    const frames: InstallProgress[] = []

    await expect(svc.updateCli(collect(frames))).resolves.toEqual({ success: true })
    expect(npmInstallCalls()).toHaveLength(1)
    expect(last(frames)).toEqual({ stage: 'done', message: 'Updated to v2.1.307', percent: 100 })
  })

  it('says so when the reinstall leaves claude --version still broken', async () => {
    // npm can exit 0 with the native package still missing. Reporting success
    // here would tell the user they are fixed when `claude` is still a stub.
    const svc = await ready(null)
    const frames: InstallProgress[] = []

    const result = await svc.updateCli(collect(frames))

    expect(result.success).toBe(false)
    expect(result.error).toContain('claude --version still fails')
    expect(last(frames)).toEqual({
      stage: 'error',
      message: 'Reinstalled but claude --version still fails',
      percent: 100,
    })
  })

  it('runs the package install.cjs when npm leaves the native stub in place', async () => {
    const svc = await load('linux')
    const NODE = path.join('/usr', 'bin', 'node')
    const npmRoot = path.join('/usr', 'lib', 'node_modules')
    const CLAUDE = path.join('/opt', 'claude')
    const SCRIPT = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'install.cjs')

    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    available('node', NODE, 'v24.18.0')
    available('claude', CLAUDE, '0')
    probe.versions.delete(CLAUDE)
    probe.npmRoot = npmRoot
    probe.existing.add(SCRIPT)

    const previous = probe.respond
    probe.respond = (call) => {
      if (call.command === NODE && call.args[0] === SCRIPT) {
        probe.versions.set(CLAUDE, '2.1.308')
        return { stdout: '', stderr: '' }
      }
      return previous(call)
    }

    const frames: InstallProgress[] = []
    await expect(svc.updateCli(collect(frames))).resolves.toEqual({ success: true })

    expect(postinstallCalls()).toEqual([
      { command: NODE, args: [SCRIPT], options: expect.objectContaining({ timeout: 120000 }) },
    ])
    expect(last(frames)).toEqual({ stage: 'done', message: 'Updated to v2.1.308', percent: 100 })
  })

  it('surfaces install.cjs output when the native binary still cannot run', async () => {
    const svc = await load('linux')
    const NODE = path.join('/usr', 'bin', 'node')
    const npmRoot = path.join('/usr', 'lib', 'node_modules')
    const CLAUDE = path.join('/opt', 'claude')
    const SCRIPT = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'install.cjs')

    available('npm', path.join('/usr', 'bin', 'npm'), '11.3.0')
    available('node', NODE, 'v24.18.0')
    available('claude', CLAUDE, '0')
    probe.versions.delete(CLAUDE)
    probe.npmRoot = npmRoot
    probe.existing.add(SCRIPT)

    const previous = probe.respond
    probe.respond = (call) => {
      if (call.command === NODE && call.args[0] === SCRIPT) {
        return {
          stdout: '',
          stderr: 'Native package "@anthropic-ai/claude-code-win32-x64" not found.\n',
        }
      }
      return previous(call)
    }

    const frames: InstallProgress[] = []
    const result = await svc.updateCli(collect(frames))

    expect(result.success).toBe(false)
    expect(result.error).toContain('claude --version still fails')
    expect(result.error).toContain(
      'install.cjs: Native package "@anthropic-ai/claude-code-win32-x64" not found.',
    )
    expect(postinstallCalls()).toHaveLength(1)
    expect(last(frames)).toEqual({
      stage: 'error',
      message: 'Reinstalled but claude --version still fails',
      percent: 100,
    })
  })

  it('fails when npm exits 0 but the CLI on PATH still answers the old version', async () => {
    const svc = await ready('2.1.227')
    const frames: InstallProgress[] = []

    await expect(svc.updateCli(collect(frames))).resolves.toEqual({
      success: false,
      error: 'Update finished but the CLI on PATH still reports v2.1.227',
    })
    expect(last(frames)).toEqual({
      stage: 'error',
      message: 'Still running v2.1.227',
      percent: 100,
    })
  })

  it('opens the install guide when npm install fails', async () => {
    const svc = await ready('2.1.227')
    probe.npmInstallError = new Error('npm ERR! 404 Not Found')

    const result = await svc.updateCli(collect([]))

    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to update CLI via npm')
    expect(probe.openExternal).toEqual([CLI_OVERVIEW])
  })
})

describe('detection branches the installer flow leans on', () => {
  it('scans %LOCALAPPDATA%\\npm when the roaming prefix has nothing', async () => {
    const localAppData = path.join(process.cwd(), 'LocalAppData')
    const svc = await load('win32', { LOCALAPPDATA: localAppData })
    const shim = path.join(localAppData, 'npm', 'claude.cmd')
    probe.existing.add(shim)
    probe.versions.set(shim, '2.1.0')

    await expect(svc.detectInstalledCli()).resolves.toMatchObject({
      available: true,
      path: shim,
      version: '2.1.0',
    })
  })

  it('routes a .bat shim through the shell, the way .cmd shims need', async () => {
    const svc = await load('win32')
    const bat = 'C:\\tools\\claude.bat'
    available('claude', bat, '1.5.0')

    await expect(svc.detectInstalledCli()).resolves.toMatchObject({ path: bat, version: '1.5.0' })
    const versionCall = versionProbeCalls()[0]
    expect(versionCall?.command).toBe(bat)
    expect(versionCall?.options.shell).toBe(true)
  })

  it('treats a version with fewer segments than the minimum as zero-padded', async () => {
    const svc = await load('linux')
    available('claude', path.join('/opt', 'claude'), '1.0')

    await expect(svc.detectInstalledCli()).resolves.toMatchObject({
      version: '1.0',
      versionCompatible: true,
    })
  })
})
