// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import * as os from 'os'
import * as path from 'path'

/**
 * Watch child-process lifecycle (issue #41 / ticket 15).
 *
 * `officecli watch` is a resident server: a child that is spawned but never
 * reaches the "URL printed" state must still be reachable by every cleanup
 * path (watch:stop, watch:stopAll, app quit), otherwise it keeps the preview
 * port after the app is gone. The POSIX branch of the tree kill also has to
 * address a real process group, which only exists when the child was spawned
 * detached.
 */

const cp = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }))

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

interface WatchHandle {
  id: string
  filePath: string
  port: number
  url: string
}

const electronMock = vi.hoisted(() => ({ handlers: new Map<string, IpcHandler>() }))

vi.mock('child_process', () => ({ spawn: cp.spawn, spawnSync: cp.spawnSync }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => path.join(process.cwd(), 'app'),
    getPath: (name: string) => path.join(os.homedir(), name),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    }),
    on: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('fs', () => ({
  existsSync: () => true,
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  createWriteStream: vi.fn(),
  unlinkSync: vi.fn(),
  renameSync: vi.fn(),
  chmodSync: vi.fn(),
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { cleanupOfficeCli, registerOfficeCliIPCHandlers } from '../officeCliService'

const FILE = path.join(process.cwd(), 'doc.pptx')

interface FakeChild extends EventEmitter {
  pid: number
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
  emitClose: (code: number | null) => void
  emitError: (err: Error) => void
}

function makeFakeChild(pid: number): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  child.emitClose = (code) => child.emit('close', code)
  child.emitError = (err) => child.emit('error', err)
  return child
}

/** spawn calls: the officecli child is handed back, taskkill gets a dummy. */
let children: FakeChild[] = []
let nextPid = 4000

function stubSpawn(): void {
  cp.spawn.mockImplementation((bin: string, _args?: unknown, _opts?: unknown) => {
    if (path.basename(bin).toLowerCase() === 'taskkill') {
      return { pid: 9999, on: vi.fn(), stdout: null, stderr: null, kill: vi.fn() }
    }
    const child = makeFakeChild(nextPid++)
    children.push(child)
    return child
  })
}

function taskkillCalls(): string[][] {
  return cp.spawn.mock.calls
    .filter(([bin]) => path.basename(bin).toLowerCase() === 'taskkill')
    .map(([, args]) => args as string[])
}

function getHandler(channel: string): IpcHandler {
  const handler = electronMock.handlers.get(channel)
  if (!handler) throw new Error(`IPC handler not registered: ${channel}`)
  return handler
}

function startWatch(file = FILE): Promise<WatchHandle> {
  return getHandler('officecli:watch:start')({}, file) as Promise<WatchHandle>
}

async function watchList(): Promise<WatchHandle[]> {
  return (await getHandler('officecli:watch:list')({})) as WatchHandle[]
}

function usePlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

const ORIGINAL_PLATFORM = process.platform
const originalKill = process.kill

beforeEach(() => {
  vi.useFakeTimers()
  children = []
  nextPid = 4000
  cp.spawn.mockReset()
  cp.spawnSync.mockReset().mockReturnValue({ status: 0, stdout: '' })
  stubSpawn()
  usePlatform('win32')
  registerOfficeCliIPCHandlers()
})

afterEach(() => {
  usePlatform(ORIGINAL_PLATFORM)
  process.kill = originalKill
  cleanupOfficeCli()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('watch startup timeout', () => {
  it('kills the child on Windows when no URL is ever printed', async () => {
    const pending = startWatch()
    const failure = expect(pending).rejects.toThrow('watch startup timeout')

    await vi.advanceTimersByTimeAsync(10_000)
    await failure

    expect(taskkillCalls().flat()).toContain(String(children[0].pid))
  })

  it('kills the child process group on macOS/Linux instead of silently missing it', async () => {
    usePlatform('darwin')
    const killed: Array<[number, string]> = []
    process.kill = ((target: number, signal?: string) => {
      killed.push([target, signal ?? 'SIGTERM'])
      return true
    }) as typeof process.kill

    const pending = startWatch()
    const failure = expect(pending).rejects.toThrow('watch startup timeout')
    await vi.advanceTimersByTimeAsync(10_000)
    await failure

    // A negative pid targets the process group, which only exists when the
    // child was spawned detached — otherwise the signal is a no-op and the
    // resident watch server keeps the port.
    expect(killed).toContainEqual([-children[0].pid, 'SIGTERM'])
    const spawnOptions = cp.spawn.mock.calls.find(([bin]) => path.basename(bin).toLowerCase() !== 'taskkill')?.[2] as
      | { detached?: boolean }
      | undefined
    expect(spawnOptions?.detached).toBe(true)
  })

  it('falls back to signalling the pid when the process group is already gone', async () => {
    usePlatform('linux')
    const killed: Array<[number, string]> = []
    process.kill = ((target: number, signal?: string) => {
      killed.push([target, signal ?? 'SIGTERM'])
      if (target < 0) throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
      return true
    }) as typeof process.kill

    const pending = startWatch()
    const failure = expect(pending).rejects.toThrow('watch startup timeout')
    await vi.advanceTimersByTimeAsync(10_000)
    await failure

    expect(killed).toContainEqual([-children[0].pid, 'SIGTERM'])
    expect(killed).toContainEqual([children[0].pid, 'SIGTERM'])
  })

  it('does not register the process when the URL arrives after the timeout', async () => {
    const pending = startWatch()
    const failure = expect(pending).rejects.toThrow('watch startup timeout')
    await vi.advanceTimersByTimeAsync(10_000)
    await failure

    children[0].stdout.emit('data', Buffer.from('serving http://localhost:26315\n'))

    expect(await watchList()).toEqual([])
  })
})

describe('watch processes registered before the URL appears', () => {
  it('stopAll kills a child that is still starting up', async () => {
    const pending = startWatch()
    pending.catch(() => {})
    expect(children).toHaveLength(1)

    expect(await getHandler('officecli:watch:stopAll')({})).toBe(1)
    expect(taskkillCalls().flat()).toContain(String(children[0].pid))
  })

  it('app-quit cleanup kills a child that is still starting up', async () => {
    const pending = startWatch()
    pending.catch(() => {})

    cleanupOfficeCli()

    expect(taskkillCalls().flat()).toContain(String(children[0].pid))
  })

  it('watch:stop kills the child and unwatches its file', async () => {
    const pending = startWatch()
    pending.catch(() => {})
    const handle = await listAfterRegister()

    expect(await getHandler('officecli:watch:stop')({}, handle.id)).toBe(true)
    expect(taskkillCalls().flat()).toContain(String(children[0].pid))
    expect(cp.spawnSync.mock.calls.map(([, args]) => args as string[])).toContainEqual([
      'unwatch',
      FILE,
    ])
  })

  it('never lists a watch that has no preview URL yet', async () => {
    const pending = startWatch()
    pending.catch(() => {})

    expect(await watchList()).toEqual([])
  })

  it('unregisters the watch when the child dies before printing a URL', async () => {
    const pending = startWatch()
    const failure = expect(pending).rejects.toThrow(/watch process exited/)
    children[0].stderr.emit('data', Buffer.from('Another watch process is already running'))
    children[0].emitClose(1)

    await failure
    expect(await getHandler('officecli:watch:stopAll')({})).toBe(0)
  })

  it('unregisters the watch when spawn itself fails', async () => {
    const pending = startWatch()
    const failure = expect(pending).rejects.toThrow('watch start failed: EACCES')
    children[0].emitError(new Error('EACCES'))

    await failure
    expect(await getHandler('officecli:watch:stopAll')({})).toBe(0)
  })

  it('assigns a distinct id to watches started in the same millisecond', async () => {
    const first = startWatch()
    const second = startWatch()

    for (const child of children) {
      child.stdout.emit('data', Buffer.from('preview at http://localhost:26315\n'))
    }
    await vi.advanceTimersByTimeAsync(0)

    const [a, b] = await Promise.all([first, second])
    expect(a.id).not.toBe(b.id)
    expect(await getHandler('officecli:watch:list')({})).toHaveLength(2)
  })
})

/** Resolve once the handler registered the watch, then stop it via list. */
async function listAfterRegister(): Promise<WatchHandle> {
  children[0].stdout.emit('data', Buffer.from('preview at http://localhost:26315\n'))
  await vi.advanceTimersByTimeAsync(0)
  const list = await watchList()
  if (!list.length) throw new Error('watch was not registered')
  return list[0]
}

