// @vitest-environment node
/**
 * Linux recursive-worktree watcher — worker-thread degradation.
 *
 * On Linux `fs.watch(recursive)` is a JS polyfill whose initial tree walk blocks
 * the main thread for seconds on large work trees, so gitService runs it in a
 * worker thread. When that worker is unavailable or dies mid-run (inotify limit
 * ENOSPC, crashed worker, stale message from an old project) the module must keep
 * at least root-level coverage by degrading to an in-process non-recursive watch —
 * losing the watcher entirely would silently freeze the SCM badge. These tests pin
 * the failure handling and the stale-guard (`worktreeWorker !== worker`) that stops
 * a late message from one project's worker from tearing down another's watcher.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_PLATFORM = process.platform

const probe = vi.hoisted(() => ({
  workers: [] as Array<{
    opts: { eval?: boolean; workerData?: { root?: string } }
    handlers: Record<string, (payload: unknown) => void>
    terminated: boolean
    emit: (type: string, payload: unknown) => void
  }>,
  watchCalls: [] as Array<{ path: string; recursive: boolean }>,
  sends: [] as Array<{ channel: string }>,
  throwOnConstruct: false,
}))

class FakeWorker {
  opts: { eval?: boolean; workerData?: { root?: string } }
  handlers: Record<string, (payload: unknown) => void> = {}
  terminated = false
  constructor(source: string, opts: { eval?: boolean; workerData?: { root?: string } }) {
    if (probe.throwOnConstruct) throw new Error('worker spawn failed')
    this.opts = opts
    const self = this
    const rec = {
      opts,
      handlers: this.handlers,
      get terminated() {
        return self.terminated
      },
      emit: (type: string, payload: unknown) => self.handlers[type]?.(payload),
    }
    probe.workers.push(rec)
  }
  on(type: string, cb: (payload: unknown) => void) {
    this.handlers[type] = cb
    return this
  }
  unref() {}
  terminate() {
    this.terminated = true
    return Promise.resolve()
  }
}

vi.mock('worker_threads', () => ({ Worker: FakeWorker }))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    watch: (path: string, optionsOrListener: unknown, maybeListener?: unknown) => {
      const recursive =
        typeof optionsOrListener === 'object' && optionsOrListener !== null
          ? Boolean((optionsOrListener as { recursive?: boolean }).recursive)
          : false
      probe.watchCalls.push({ path: String(path), recursive })
      return { on: () => undefined, close: () => undefined }
    },
  }
})

vi.mock('child_process', () => ({ execFile: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { handle: vi.fn(), handleOnce: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string) => probe.sends.push({ channel }) },
      },
    ],
  },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const handlers = vi.hoisted(() => ({}) as Record<string, (...args: unknown[]) => unknown>)

vi.mock('@/shared/handlerRegistry', () => ({
  registerHandlers: vi.fn(
    (_ipc: unknown, _ch: unknown, _prefix: string, h: Record<string, (...a: unknown[]) => unknown>) => {
      for (const k of Object.keys(handlers)) delete handlers[k]
      Object.assign(handlers, h)
    },
  ),
}))

async function loadOnLinux() {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  const mod = await import('../gitService')
  mod.registerGitIPCHandlers()
  return mod
}

beforeEach(async () => {
  probe.workers = []
  probe.watchCalls = []
  probe.sends = []
  probe.throwOnConstruct = false
  await loadOnLinux()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
})

describe('startGitWatcher (linux) — worktree watch runs in a worker', () => {
  it('delegates the recursive worktree watch to a worker thread and keeps the .git watch in-process', async () => {
    await handlers.watchProject!('/proj')

    expect(probe.workers).toHaveLength(1)
    expect(probe.workers[0].opts.eval).toBe(true)
    expect(probe.workers[0].opts.workerData?.root).toBe('/proj')

    const gitDirWatch = probe.watchCalls.find(w => w.path.endsWith('.git') || w.path.includes('.git'))
    expect(gitDirWatch).toBeDefined()
    expect(gitDirWatch!.recursive).toBe(true)
    // The in-process recursive worktree watch is skipped on linux (worker owns it)
    expect(probe.watchCalls.some(w => w.path === '/proj' && w.recursive)).toBe(false)
  })

  it('debounces a worker change message into a single statusChanged notification', async () => {
    await handlers.watchProject!('/proj')
    const worker = probe.workers[0]

    worker.emit('message', { type: 'change', filename: 'src/a.ts' })
    worker.emit('message', { type: 'change', filename: 'src/b.ts' })
    vi.advanceTimersByTime(300)

    expect(probe.sends.filter(s => s.channel === 'git:statusChanged')).toHaveLength(1)
  })

  it('drops Factory worktree changes before they can schedule a parent SCM refresh', async () => {
    await handlers.watchProject!('/proj')
    const worker = probe.workers[0]

    worker.emit('message', { type: 'change', filename: '.spacecode/worktrees/bl-1/src/a.ts' })
    vi.advanceTimersByTime(300)

    expect(probe.sends.filter(s => s.channel === 'git:statusChanged')).toHaveLength(0)
  })
})

describe('startWorktreeWorkerWatcher — degradation paths', () => {
  it('falls back to an in-process non-recursive watch when the worker reports a mid-run error (ENOSPC)', async () => {
    await handlers.watchProject!('/proj')
    const worker = probe.workers[0]

    worker.emit('message', { type: 'error', message: 'ENOSPC: inotify limit' })

    expect(worker.terminated).toBe(true)
    const nonRecursive = probe.watchCalls.find(w => w.path === '/proj' && !w.recursive)
    expect(nonRecursive).toBeDefined()
  })

  it('ignores an error message from a stale worker after a project switch', async () => {
    await handlers.watchProject!('/proj')
    const first = probe.workers[0]

    // Switch project: stopGitWatcher terminates the first worker and starts a new one
    await handlers.watchProject!('/other')
    const second = probe.workers[probe.workers.length - 1]
    expect(second).not.toBe(first)

    first.emit('message', { type: 'error', message: 'late' })

    // The stale worker is not terminated again and the new project's watcher is intact
    expect(first.terminated).toBe(true)
    expect(second.terminated).toBe(false)
  })

  it('degrades to a non-recursive watch when the worker crashes via the error event', async () => {
    await handlers.watchProject!('/proj')
    const worker = probe.workers[0]

    worker.emit('error', new Error('worker died'))

    const nonRecursive = probe.watchCalls.find(w => w.path === '/proj' && !w.recursive)
    expect(nonRecursive).toBeDefined()
  })

  it('starts the non-recursive watch immediately when the worker cannot be constructed', async () => {
    probe.throwOnConstruct = true

    await handlers.watchProject!('/proj')

    expect(probe.workers).toHaveLength(0)
    const nonRecursive = probe.watchCalls.find(w => w.path === '/proj' && !w.recursive)
    expect(nonRecursive).toBeDefined()
  })

  it('stopWatch tears down the running worker', async () => {
    await handlers.watchProject!('/proj')
    const worker = probe.workers[0]

    await handlers.stopWatch!()

    expect(worker.terminated).toBe(true)
  })
})
