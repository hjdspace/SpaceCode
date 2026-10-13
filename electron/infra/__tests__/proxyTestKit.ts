import { EventEmitter } from 'events'
import { vi } from 'vitest'

/**
 * Test doubles for the four seams `proxyManager` reaches through: the child
 * process (`child_process.spawn`), the port probe (`net.createServer`), the
 * proxy's own HTTP surface (`http.get`) and the filesystem (`fs.existsSync`),
 * plus Electron's packaging state and the logger.
 *
 * Every seam answers on a later tick, never synchronously: the product attaches
 * its `error` / `data` listeners *after* calling `listen()` / `get()` /
 * `spawn()`, so a synchronous answer would be dropped and the failure would look
 * like a broken proxy instead of a broken double.
 *
 * `setImmediate` is deliberately kept real (the tests fake only the timer
 * functions), so these doubles stay reachable while `vi.advanceTimersByTimeAsync`
 * drives the product's 10s startup / 5s shutdown / 30s health clocks.
 */

// ---------------------------------------------------------------- child_process

export interface SpawnCall {
  execPath: string
  args: string[]
  options: { env: NodeJS.ProcessEnv; stdio: string[] }
}

/** A `ChildProcess` the test drives by hand. */
export class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  killed = false
  readonly killSignals: string[] = []
  /** one-shot: models `kill()` throwing on an already-reaped pid */
  killThrows = false

  constructor(readonly index: number) {
    super()
  }

  kill(signal: string = 'SIGTERM'): boolean {
    this.killSignals.push(signal)
    if (this.killThrows) {
      this.killThrows = false
      throw new Error('ESRCH: no such process')
    }
    this.killed = true
    if (spawnState.exitOnKill) {
      setImmediate(() => this.exitWith(0, signal))
    }
    return true
  }

  /** raw stdout, exactly as the proxy script's NDJSON reaches us */
  writeStdout(text: string): void {
    this.stdout.emit('data', Buffer.from(text))
  }

  writeReady(port: number): void {
    this.writeStdout(`${JSON.stringify({ type: 'ready', port })}\n`)
  }

  writeStderr(text: string): void {
    this.stderr.emit('data', Buffer.from(text))
  }

  exitWith(code: number | null, signal: string | null = null): void {
    this.emit('exit', code, signal)
  }
}

export const spawnState = {
  calls: [] as SpawnCall[],
  children: [] as FakeChild[],
  /** when set, each fake child announces readiness on the next tick */
  autoReadyPort: null as number | null,
  /** when true, a spawned child dies with code 1 instead of ever reporting ready */
  exitBeforeReady: false,
  /** when true, `kill()` is answered by an exit on the next tick (a well-behaved child) */
  exitOnKill: false,
  reset(): void {
    this.calls = []
    this.children = []
    this.autoReadyPort = null
    this.exitBeforeReady = false
    this.exitOnKill = false
  },
  /** the child created by the n-th spawn (0-based) */
  child(index: number): FakeChild {
    const child = this.children[index]
    if (!child) throw new Error(`no spawn #${index + 1} yet (${this.children.length} seen)`)
    return child
  },
}

export function fakeSpawn(
  execPath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: string[] },
): FakeChild {
  const child = new FakeChild(spawnState.children.length)
  spawnState.calls.push({ execPath, args, options })
  spawnState.children.push(child)
  if (spawnState.exitBeforeReady) {
    setImmediate(() => child.exitWith(1))
    return child
  }
  const readyPort = spawnState.autoReadyPort
  if (readyPort !== null) {
    setImmediate(() => child.writeReady(readyPort))
  }
  return child
}

// --------------------------------------------------------------------------- net

export const netState = {
  busyPorts: new Set<number>(),
  /** ordered trace of the port probe — `listen:34567` / `eaddrinuse:34567` / `close:34567` */
  trace: [] as string[],
  reset(): void {
    this.busyPorts.clear()
    this.trace = []
  },
}

class FakeProbeServer extends EventEmitter {
  private port: number | null = null

  listen(port: number, _host: string, onListening: () => void): this {
    this.port = port
    netState.trace.push(`listen:${port}`)
    setImmediate(() => {
      if (netState.busyPorts.has(port)) {
        netState.trace.push(`eaddrinuse:${port}`)
        this.emit('error', Object.assign(new Error(`EADDRINUSE: address already in use 127.0.0.1:${port}`), { code: 'EADDRINUSE' }))
        return
      }
      onListening()
    })
    return this
  }

  close(onClosed: () => void): this {
    netState.trace.push(`close:${this.port}`)
    setImmediate(() => onClosed())
    return this
  }
}

export function fakeCreateServer(): FakeProbeServer {
  return new FakeProbeServer()
}

// -------------------------------------------------------------------------- http

export type HttpAction =
  | { kind: 'respond'; statusCode: number; body: string }
  | { kind: 'error'; message: string }
  | { kind: 'hang' }

export class FakeRequest extends EventEmitter {
  timeoutMs: number | null = null
  destroyCount = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  setTimeout(ms: number, onTimeout: () => void): this {
    this.timeoutMs = ms
    this.timer = setTimeout(onTimeout, ms)
    return this
  }

  destroy(): this {
    this.destroyCount += 1
    if (this.timer) clearTimeout(this.timer)
    return this
  }
}

class FakeResponse extends EventEmitter {
  constructor(readonly statusCode: number, private readonly body: string) {
    super()
  }

  deliver(): void {
    this.emit('data', Buffer.from(this.body))
    this.emit('end')
  }
}

export const httpState = {
  urls: [] as string[],
  requests: [] as FakeRequest[],
  /** keyed by URL fragment (`/health`, `/status`); `default` answers anything unmatched */
  actions: new Map<string, HttpAction>(),
  /** when set, `http.get` throws synchronously — a malformed URL, not a bad reply */
  throwOnGet: null as Error | null,
  default: { kind: 'respond', statusCode: 200, body: '{}' } as HttpAction,
  reset(): void {
    this.urls = []
    this.requests = []
    this.actions.clear()
    this.throwOnGet = null
    this.default = { kind: 'respond', statusCode: 200, body: '{}' }
  },
  script(fragment: string, action: HttpAction): void {
    this.actions.set(fragment, action)
  },
  /** the n-th outbound request (0-based) */
  request(index: number): FakeRequest {
    const req = this.requests[index]
    if (!req) throw new Error(`no http request #${index + 1} yet (${this.requests.length} seen)`)
    return req
  },
}

export function fakeHttpGet(url: string, onResponse: (res: FakeResponse) => void): FakeRequest {
  if (httpState.throwOnGet) throw httpState.throwOnGet
  httpState.urls.push(url)
  const req = new FakeRequest()
  httpState.requests.push(req)
  const action = actionFor(url)
  setImmediate(() => {
    if (action.kind === 'error') {
      req.emit('error', new Error(action.message))
      return
    }
    if (action.kind === 'hang') return
    const res = new FakeResponse(action.statusCode, action.body)
    onResponse(res)
    setImmediate(() => res.deliver())
  })
  return req
}

function actionFor(url: string): HttpAction {
  for (const [fragment, action] of httpState.actions) {
    if (url.includes(fragment)) return action
  }
  return httpState.default
}

// ---------------------------------------------------------------------------- fs

export const fsState = {
  existing: new Set<string>(),
  /** every path the module asked about, in probe order */
  touched: [] as string[],
  reset(): void {
    this.existing.clear()
    this.touched = []
  },
}

export function fakeExistsSync(target: string): boolean {
  fsState.touched.push(String(target))
  return fsState.existing.has(String(target))
}

// ---------------------------------------------------------------------- electron

export const appState = {
  isPackaged: false,
  userData: '',
}

// ------------------------------------------------------------------------ logger

export const loggerState = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  reset(): void {
    this.debug.mockClear()
    this.info.mockClear()
    this.warn.mockClear()
    this.error.mockClear()
  },
  /** message strings logged at a level, second argument of every logger call */
  messages(level: 'debug' | 'info' | 'warn' | 'error'): string[] {
    return this[level].mock.calls.map((call) => String(call[1]))
  },
}

// ----------------------------------------------------------------------- helpers

/** let the real `setImmediate` queue drain — the seam doubles answer there */
export async function flushTurns(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  }
}

/** fake the clocks the module owns, but leave `setImmediate`/microtasks alone */
export function fakeProxyClocks(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
}
