// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProxyConfig } from '../../proxy/types'

/**
 * `ProxyManager` process lifecycle — the module that decides where every outbound
 * AI request goes: `sessionProcess` gates on `!!proxyManager.getProxyUrl()` alone
 * (not on `isRunning()`) after awaiting the start queue, and `settingsIpc` gates a
 * restart on `isRunning()`. So the values these two return after a half-failed start
 * are the difference between traffic reaching the proxy and traffic reaching a dead
 * port.
 *
 * Contract under test:
 *   - the child is started with the current Electron binary, `ELECTRON_RUN_AS_NODE=1`
 *     and the full parent environment; the port is *probed* first, then released
 *     before the child is spawned.
 *   - readiness is one NDJSON `{type:'ready',port}` line on stdout; the port the
 *     child reports is what `getProxyUrl()` returns, and start() rejects on a 10s
 *     timeout or on an exit before ready.
 *   - `start()` is one queue, not one race: concurrent calls settle on the *latest*
 *     config; a `stop()` revokes the config that has not run yet, so the queue cannot
 *     resurrect a proxy someone just asked to stop; `stop()` is idempotent and
 *     escalates SIGTERM -> SIGKILL after 5s.
 *   - `awaitStart()` is the barrier a snapshot reader takes before trusting
 *     `getProxyUrl()`, and it settles (not hangs) when the queued start fails.
 *   - a failed start does NOT clear `proxyUrl` or null the child: state must be
 *     read together, or the caller trusts a URL nobody is listening on.
 */

vi.mock('child_process', async () => {
  const kit = await import('./proxyTestKit')
  return { spawn: kit.fakeSpawn }
})

vi.mock('net', async () => {
  const kit = await import('./proxyTestKit')
  return { createServer: kit.fakeCreateServer }
})

vi.mock('http', async () => {
  const kit = await import('./proxyTestKit')
  return { get: kit.fakeHttpGet }
})

vi.mock('fs', async () => {
  const kit = await import('./proxyTestKit')
  return { existsSync: kit.fakeExistsSync }
})

vi.mock('electron', async () => {
  const kit = await import('./proxyTestKit')
  return {
    app: {
      get isPackaged() {
        return kit.appState.isPackaged
      },
      getPath: () => kit.appState.userData,
    },
  }
})

vi.mock('../logger', async () => {
  const kit = await import('./proxyTestKit')
  return kit.loggerState
})

const { httpState, loggerState, netState, spawnState, flushTurns, fakeProxyClocks } = await import('./proxyTestKit')
const { ProxyManager } = await import('../proxyManager')

function makeConfig(port = 34567): ProxyConfig {
  return {
    host: '127.0.0.1',
    port,
    upstreamProvider: 'openai_compatible',
    upstreamBaseUrl: 'https://o.test/v1',
    upstreamApiKey: 'o-key',
    modelMapping: { sonnetModel: 'mid-k', defaultModel: 'mid-k' },
  }
}

/** let the port probe + spawn happen, then return the child the n-th spawn made */
async function spawnedChild(index = 0) {
  await flushTurns()
  return spawnState.child(index)
}

let manager!: InstanceType<typeof ProxyManager>

beforeEach(() => {
  spawnState.reset()
  netState.reset()
  httpState.reset()
  loggerState.reset()
  fakeProxyClocks()
  manager = new ProxyManager()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('start — the spawn the child inherits', () => {
  it('runs the proxy script in the current Electron binary as a node process with piped stdio', async () => {
    spawnState.autoReadyPort = 34567

    await manager.start(makeConfig())

    expect(spawnState.calls).toHaveLength(1)
    const call = spawnState.calls[0]!
    expect(call.execPath).toBe(process.execPath)
    expect(call.options.env).toEqual({ ...process.env, ELECTRON_RUN_AS_NODE: '1' })
    expect(call.options.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(call.args).toContain('--port')
    expect(call.args).toContain('34567')
  })

  it('hands back the URL the child reported and keeps it as the live proxy URL', async () => {
    spawnState.autoReadyPort = 34567

    await expect(manager.start(makeConfig())).resolves.toBe('http://127.0.0.1:34567')

    expect(manager.getProxyUrl()).toBe('http://127.0.0.1:34567')
    expect(manager.isRunning()).toBe(true)
    expect(manager.getConfig()).toEqual(makeConfig())
  })

  it('logs through the injected logger instead of the real debug writer', async () => {
    spawnState.autoReadyPort = 34567

    await manager.start(makeConfig())

    expect(loggerState.messages('info')).toEqual([
      'Starting proxy subprocess',
      'Proxy subprocess ready',
    ])
  })

  it('trusts the child-reported port for the URL even when it differs from the probed one', async () => {
    // the health check and getStatus poll config.port, not this URL, so a child
    // that lands elsewhere is monitored on a port nobody answers on.
    spawnState.autoReadyPort = 39999

    const url = await manager.start(makeConfig(34567))

    expect(url).toBe('http://127.0.0.1:39999')
    expect(manager.getConfig()!.port).toBe(34567)
  })

  it('writes the probed port into the caller config object and keeps that object as its snapshot', async () => {
    netState.busyPorts.add(34567)
    spawnState.autoReadyPort = 34568
    const config = makeConfig()

    await manager.start(config)

    expect(config.port).toBe(34568)
    expect(manager.getConfig()).toBe(config)
  })
})

describe('start — readiness parsing', () => {
  it('waits for the newline before accepting a split ready line', async () => {
    spawnState.autoReadyPort = null
    let settled = false
    const run = manager.start(makeConfig()).then((url) => {
      settled = true
      return url
    })
    const child = await spawnedChild()

    child.writeStdout('{"type":"ready","port":345')
    await flushTurns()
    expect(settled).toBe(false)

    child.writeStdout('67}\n')
    await expect(run).resolves.toBe('http://127.0.0.1:34567')
    expect(settled).toBe(true)
  })

  it('skips boot chatter and unrelated JSON instead of mistaking it for readiness', async () => {
    spawnState.autoReadyPort = null
    const run = manager.start(makeConfig())
    const child = await spawnedChild()

    child.writeStdout('proxy booting\n\n   \n')
    child.writeStdout('not json at all\n')
    child.writeStdout('{"type":"log","msg":"listening"}\n')
    await flushTurns()

    child.writeStdout('{"type":"ready"}\n{"type":"ready","port":"34567"}\n')
    await flushTurns()

    child.writeStdout('{"type":"ready","port":34570}\n')
    await expect(run).resolves.toBe('http://127.0.0.1:34570')
  })

  it('reports every stderr line as a warning and drops blank chunks', async () => {
    spawnState.autoReadyPort = 34567
    const run = manager.start(makeConfig())
    const child = await spawnedChild()

    child.writeStderr('[proxy] upstream auth failed\n')
    child.writeStderr('   \n')
    child.writeReady(34567)
    await run

    expect(loggerState.messages('warn')).toEqual(['Proxy stderr: [proxy] upstream auth failed'])
  })
})

describe('start — port probing', () => {
  it('walks up from the requested port until one is free, and releases it before spawning', async () => {
    netState.busyPorts.add(34567)
    spawnState.autoReadyPort = 34568

    await manager.start(makeConfig())

    expect(netState.trace).toEqual(['listen:34567', 'eaddrinuse:34567', 'listen:34568', 'close:34568'])
    expect(spawnState.calls[0]!.args).toContain('34568')
  })

  it('treats a zero port as the default range start', async () => {
    spawnState.autoReadyPort = 34567

    await manager.start(makeConfig(0))

    expect(netState.trace).toEqual(['listen:34567', 'close:34567'])
  })

  it('gives up without spawning when the whole 34567-34667 window is occupied', async () => {
    for (let port = 34567; port <= 34667; port += 1) netState.busyPorts.add(port)

    await expect(manager.start(makeConfig())).rejects.toThrow('No available port in range 34567-34667')

    expect(spawnState.calls).toEqual([])
    expect(manager.isRunning()).toBe(false)
    expect(manager.getConfig()).toBeNull()
  })

  it('rejects a requested port above the window before touching the network', async () => {
    await expect(manager.start(makeConfig(34668))).rejects.toThrow('No available port in range 34567-34667')

    expect(netState.trace).toEqual([])
    expect(spawnState.calls).toEqual([])
  })
})

describe('start — one queue, latest config wins', () => {
  it('reuses the in-flight run instead of spawning a second child', async () => {
    spawnState.autoReadyPort = null
    const first = manager.start(makeConfig())
    await flushTurns()
    const second = manager.start(makeConfig(34600))

    spawnState.child(0).writeReady(34567)

    await expect(second).resolves.toBe('http://127.0.0.1:34567')
    await first
    expect(spawnState.children).toHaveLength(1)
  })

  it('applies the second call config once the in-flight run settles, so a settings save during startup is not lost', async () => {
    spawnState.autoReadyPort = null
    spawnState.exitOnKill = true
    const wanted = makeConfig(34600)
    wanted.upstreamBaseUrl = 'https://second.test/v1'
    const first = manager.start(makeConfig())
    await flushTurns()

    const second = manager.start(wanted)
    spawnState.child(0).writeReady(34567)
    await flushTurns(12)
    spawnState.child(1).writeReady(34600)

    await expect(second).resolves.toBe('http://127.0.0.1:34600')
    await expect(first).resolves.toBe('http://127.0.0.1:34600')
    expect(spawnState.children).toHaveLength(2)
    expect(manager.getConfig()!.upstreamBaseUrl).toBe('https://second.test/v1')
  })

  it('spawns a fresh child once the previous run has settled', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())
    spawnState.child(0).exitWith(0)
    await flushTurns()

    await manager.start(makeConfig())

    expect(spawnState.children).toHaveLength(2)
  })
})

describe('start queue — stop() revokes what has not run yet', () => {
  it('fails a queued config instead of starting a proxy after the stop', async () => {
    spawnState.autoReadyPort = null
    const first = manager.start(makeConfig())
    // 断言尽早挂上：等待方拿到的是同一条队列的失败，晚一拍就是未处理的 rejection
    const firstFails = expect(first).rejects.toThrow('Proxy start cancelled by stop()')
    await flushTurns()
    const wanted = makeConfig(34600)
    wanted.upstreamBaseUrl = 'https://second.test/v1'
    const second = manager.start(wanted)
    const secondFails = expect(second).rejects.toThrow('Proxy start cancelled by stop()')

    const stopping = manager.stop()
    await flushTurns()
    // 在飞的那次还是落了地（先 ready 再退出，让它走完正常返回），队列随后发现
    // 第二份配置已经没人认领。
    spawnState.child(0).writeReady(34567)
    spawnState.child(0).exitWith(0)
    await stopping

    await Promise.all([firstFails, secondFails])
    expect(spawnState.children).toHaveLength(1)
    expect(manager.isRunning()).toBe(false)
  })

  it('does not even spawn for a config revoked while the port probe was running', async () => {
    netState.busyPorts.add(34567)
    spawnState.autoReadyPort = null
    const started = manager.start(makeConfig())
    const startedFails = expect(started).rejects.toThrow('Proxy start cancelled by stop()')
    await flushTurns(1)

    const stopping = manager.stop()
    await flushTurns()
    await stopping

    await startedFails
    expect(spawnState.calls).toEqual([])
  })

  it('runs a start that arrives after a revoked one instead of inheriting its failure', async () => {
    spawnState.autoReadyPort = null
    const queued = manager.start(makeConfig())
    const queuedFails = expect(queued).rejects.toThrow()
    await flushTurns()
    const wanted = makeConfig(34600)
    wanted.upstreamBaseUrl = 'https://second.test/v1'
    const second = manager.start(wanted)
    const secondFails = expect(second).rejects.toThrow('Proxy start cancelled by stop()')

    const stopping = manager.stop()
    spawnState.child(0).writeReady(34567)
    spawnState.child(0).exitWith(0)
    await stopping
    await Promise.all([queuedFails, secondFails])

    spawnState.autoReadyPort = 34600
    await expect(manager.start(wanted)).resolves.toBe('http://127.0.0.1:34600')
    expect(manager.getConfig()!.upstreamBaseUrl).toBe('https://second.test/v1')
  })
})

describe('awaitStart — the barrier snapshot readers use', () => {
  it('returns at once when nothing is queued', async () => {
    await expect(manager.awaitStart()).resolves.toBeUndefined()

    expect(spawnState.calls).toEqual([])
  })

  it('settles only after the queue lands on the latest config', async () => {
    spawnState.autoReadyPort = null
    spawnState.exitOnKill = true
    const first = manager.start(makeConfig())
    await flushTurns()
    const wanted = makeConfig(34600)
    wanted.upstreamBaseUrl = 'https://second.test/v1'
    const second = manager.start(wanted)

    let settled = false
    const barrier = manager.awaitStart().then(() => {
      settled = true
    })

    spawnState.child(0).writeReady(34567)
    await flushTurns(12)
    expect(settled).toBe(false)

    spawnState.child(1).writeReady(34600)
    await barrier

    expect(manager.getProxyUrl()).toBe('http://127.0.0.1:34600')
    await Promise.all([first, second])
  })

  it('does not hang the reader when the queued start fails', async () => {
    spawnState.autoReadyPort = null
    const started = manager.start(makeConfig())
    await flushTurns()

    spawnState.child(0).exitWith(1)
    await expect(manager.awaitStart()).resolves.toBeUndefined()
    await expect(started).rejects.toThrow('Proxy process exited before ready with code 1')
  })
})

describe('ensureRunning — never restarts a live proxy', () => {
  it('returns the current URL without touching the child when already running', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())

    await expect(manager.ensureRunning(makeConfig(34600))).resolves.toBe('http://127.0.0.1:34567')

    expect(spawnState.children).toHaveLength(1)
  })

  it('waits for an in-flight start rather than racing it', async () => {
    spawnState.autoReadyPort = null
    const starting = manager.start(makeConfig())
    await flushTurns()

    const ensuring = manager.ensureRunning(makeConfig())
    spawnState.child(0).writeReady(34567)

    await expect(ensuring).resolves.toBe('http://127.0.0.1:34567')
    await starting
    expect(spawnState.children).toHaveLength(1)
  })

  it('aligns the proxy when the in-flight start settled on a different provider', async () => {
    spawnState.autoReadyPort = null
    spawnState.exitOnKill = true
    const starting = manager.start(makeConfig())
    await flushTurns()

    const wanted = makeConfig(34600)
    wanted.upstreamBaseUrl = 'https://second.test/v1'
    const ensuring = manager.ensureRunning(wanted)
    spawnState.child(0).writeReady(34567)
    await flushTurns(12)
    spawnState.child(1).writeReady(34600)

    await expect(ensuring).resolves.toBe('http://127.0.0.1:34600')
    await starting
    expect(manager.getConfig()!.upstreamBaseUrl).toBe('https://second.test/v1')
  })

  it('starts the proxy when nothing is running', async () => {
    spawnState.autoReadyPort = 34567

    await expect(manager.ensureRunning(makeConfig())).resolves.toBe('http://127.0.0.1:34567')

    expect(spawnState.children).toHaveLength(1)
  })
})

describe('stop — idempotency and signal escalation', () => {
  it('does nothing at all when the proxy was never started', async () => {
    await expect(manager.stop()).resolves.toBeUndefined()

    expect(spawnState.calls).toEqual([])
    expect(manager.isRunning()).toBe(false)
  })

  it('kills the child once and stays quiet on a repeated stop', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())
    const child = spawnState.child(0)

    const stopping = manager.stop()
    await flushTurns()
    child.exitWith(0)
    await stopping

    await manager.stop()

    expect(child.killSignals).toEqual(['SIGTERM'])
    expect(manager.isRunning()).toBe(false)
    expect(manager.getProxyUrl()).toBe('http://127.0.0.1:34567')
  })

  it('does not escalate when the child exits on SIGTERM', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())
    const child = spawnState.child(0)

    const stopping = manager.stop()
    await flushTurns()
    child.exitWith(0, 'SIGTERM')
    await stopping
    await vi.advanceTimersByTimeAsync(5_000)

    expect(child.killSignals).toEqual(['SIGTERM'])
  })

  it('escalates to SIGKILL after 5s of ignoring SIGTERM and resolves without proof of death', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())
    const child = spawnState.child(0)

    const stopping = manager.stop()
    await flushTurns()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(child.killSignals).toEqual(['SIGTERM'])

    await vi.advanceTimersByTimeAsync(1)
    await expect(stopping).resolves.toBeUndefined()

    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(loggerState.messages('warn')).toContain('Proxy did not exit gracefully, sending SIGKILL')
  })

  it('finishes immediately when the pid is already gone', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())
    const child = spawnState.child(0)
    child.killThrows = true

    const stopping = manager.stop()
    await expect(stopping).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(child.killSignals).toEqual(['SIGTERM'])
  })

  it('reports a killed child as not running even before it exits', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())

    spawnState.child(0).killed = true

    expect(manager.isRunning()).toBe(false)
  })
})

describe('start failures — what the manager admits afterwards', () => {
  it('a child that dies before ready rejects the start and leaves nothing marked running', async () => {
    spawnState.autoReadyPort = null
    const run = manager.start(makeConfig())
    const child = await spawnedChild()

    child.exitWith(3)

    await expect(run).rejects.toThrow('Proxy process exited before ready with code 3')
    expect(manager.isRunning()).toBe(false)
    expect(manager.getProxyUrl()).toBe('')
  })

  it('keeps the wedged child as "running" with the previous URL when startup times out', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())

    spawnState.autoReadyPort = null
    const run = manager.start(makeConfig())
    await flushTurns()
    spawnState.child(0).exitWith(0)
    await flushTurns()
    const timedOut = expect(run).rejects.toThrow('Proxy startup timed out')

    await vi.advanceTimersByTimeAsync(10_000)
    await timedOut

    // sessionProcess gates on getProxyUrl() and settingsIpc gates on isRunning(),
    // so both now agree the proxy is fine while no request can be served.
    expect(manager.isRunning()).toBe(true)
    expect(manager.getProxyUrl()).toBe('http://127.0.0.1:34567')
    expect(manager.getConfig()).not.toBeNull()
  })

  it('re-emits a child error to listeners and fails the pending start with it', async () => {
    spawnState.autoReadyPort = null
    const seen: unknown[] = []
    manager.on('error', (err) => seen.push(err))
    const run = manager.start(makeConfig())
    await flushTurns()
    const boom = new Error('spawn node ENOENT')

    spawnState.child(0).emit('error', boom)

    await expect(run).rejects.toBe(boom)
    expect(seen).toEqual([boom])
    expect(loggerState.messages('error')).toEqual(['Proxy subprocess error'])
  })

  it('turns a child error into an uncaught throw when nobody subscribes', async () => {
    // EventEmitter treats an unlistened 'error' as fatal, and the throw aborts the
    // emit loop before the startup watchdog is reached — start() then hangs for the
    // full 10s instead of reporting the spawn failure.
    spawnState.autoReadyPort = null
    const run = manager.start(makeConfig())
    await flushTurns()
    const child = spawnState.child(0)
    const watchdog = expect(run).rejects.toThrow('Proxy startup timed out')

    expect(() => child.emit('error', new Error('spawn node ENOENT'))).toThrow('spawn node ENOENT')

    await vi.advanceTimersByTimeAsync(10_000)
    await watchdog
  })

  it('lets the dying word of a replaced child switch off the replacement\'s watchdog', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())
    const previous = spawnState.child(0)

    const run = manager.start(makeConfig())
    await flushTurns()
    await vi.advanceTimersByTimeAsync(5_000) // stop() SIGKILLs and resolves without proof
    await flushTurns()
    await expect(run).resolves.toBe('http://127.0.0.1:34567')

    previous.exitWith(null, 'SIGKILL') // the old child reports its death one beat late

    // the exit handler does not check which child died: the live one is now
    // untracked and unmonitored, and a later stop() will not kill it either.
    expect(manager.isRunning()).toBe(false)
    expect(spawnState.children).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(30_000)
    await flushTurns()
    expect(httpState.urls.filter((url) => url.includes('/health'))).toEqual([])
  })

  it('clears the child reference and emits exit with the code and signal', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())
    const exits: unknown[] = []
    manager.on('exit', (payload) => exits.push(payload))

    spawnState.child(0).exitWith(null, 'SIGKILL')

    expect(exits).toEqual([{ code: null, signal: 'SIGKILL' }])
    expect(manager.isRunning()).toBe(false)
    expect(manager.getProxyUrl()).toBe('http://127.0.0.1:34567')
  })

  it('stops a previously running child before starting the replacement', async () => {
    spawnState.autoReadyPort = 34567
    await manager.start(makeConfig())
    const first = spawnState.child(0)

    spawnState.autoReadyPort = 34568
    const run = manager.start(makeConfig())
    await flushTurns()

    first.exitWith(0)

    await expect(run).resolves.toBe('http://127.0.0.1:34568')
    expect(first.killSignals).toEqual(['SIGTERM'])
    expect(spawnState.children).toHaveLength(2)
  })
})
