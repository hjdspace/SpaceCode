// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterStatus, ProxyConfig } from '../../proxy/types'

/**
 * Health monitoring and status reporting — the only thing that keeps a long-lived
 * proxy honest. `AdapterStatus` is surfaced to the GUI and the failure ladder
 * (3 tolerated misses, then restart) is the last line of defence before engine
 * traffic starts hitting a dead port, so what this module *fails to* report is as
 * important as what it reports.
 *
 * Contract under test:
 *   - `/health` on the *config* port every 30s; 200 = healthy, anything else
 *     (non-200, transport error, 5s hang) counts as a miss.
 *   - four consecutive misses restart the proxy; a pass resets the budget.
 *   - `getStatus()` reads `/status`, and returns null rather than throwing when
 *     the proxy answers with garbage, an error or silence.
 *   - a restart that fails is caught and logged only — no event, no re-armed
 *     monitor, and `getProxyUrl()` keeps advertising the dead port.
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

const { fsState, httpState, loggerState, netState, spawnState, flushTurns, fakeProxyClocks } = await import('./proxyTestKit')
const { ProxyManager } = await import('../proxyManager')

const HEALTH_URL = 'http://127.0.0.1:34567/health'
const STATUS_URL = 'http://127.0.0.1:34567/status'

function makeConfig(): ProxyConfig {
  return {
    host: '127.0.0.1',
    port: 34567,
    upstreamProvider: 'openai_compatible',
    upstreamBaseUrl: 'https://o.test/v1',
    upstreamApiKey: 'o-key',
    modelMapping: { defaultModel: 'mid-k' },
  }
}

/** the module's clock is fake; each cycle = one 30s interval fire + the async http dance */
async function cycles(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await vi.advanceTimersByTimeAsync(30_000)
    await flushTurns(4)
  }
}

function healthProbes(): string[] {
  return httpState.urls.filter((url) => url.includes('/health'))
}

let manager!: InstanceType<typeof ProxyManager>

beforeEach(() => {
  spawnState.reset()
  netState.reset()
  httpState.reset()
  fsState.reset()
  loggerState.reset()
  fakeProxyClocks()
  manager = new ProxyManager()
  spawnState.autoReadyPort = 34567
})

afterEach(() => {
  vi.useRealTimers()
})

describe('health ladder', () => {
  it('probes /health on the config port once per 30s and stays quiet while it passes', async () => {
    await manager.start(makeConfig())

    await cycles(2)

    expect(healthProbes()).toEqual([HEALTH_URL, HEALTH_URL])
    expect(loggerState.messages('debug')).toEqual(['Health check passed'])
  })

  it('skips the probe for a child it no longer owns', async () => {
    await manager.start(makeConfig())

    spawnState.child(0).killed = true
    await cycles(1)

    expect(healthProbes()).toEqual([])
  })

  it('counts a non-200 answer as a miss against the restart budget', async () => {
    await manager.start(makeConfig())
    httpState.script('/health', { kind: 'respond', statusCode: 503, body: 'upstream down' })

    await cycles(1)

    expect(loggerState.messages('warn')).toEqual(['Health check failed (retry 1/3)'])
  })

  it('counts a health endpoint that never answers as a miss once its 5s timeout fires', async () => {
    await manager.start(makeConfig())
    httpState.script('/health', { kind: 'hang' })

    await cycles(1)
    expect(healthProbes()).toHaveLength(1)

    // the 5s watchdog only starts once the probe is in flight, i.e. after the 30s tick
    await vi.advanceTimersByTimeAsync(5_000)
    await flushTurns(2)

    expect(httpState.request(0).timeoutMs).toBe(5_000)
    expect(httpState.request(0).destroyCount).toBe(1)
    expect(loggerState.messages('warn')).toEqual(['Health check failed (retry 1/3)'])
  })

  it('treats a health probe that throws on contact as a miss and never says why', async () => {
    // e.g. a config whose port went non-numeric: `http.get` throws synchronously,
    // the bare `catch` swallows the reason, and the ladder logs the same
    // "health check failed" line it would print for a dead proxy.
    await manager.start(makeConfig())
    httpState.throwOnGet = new TypeError('Invalid URL')

    await cycles(1)

    expect(healthProbes()).toEqual([])
    expect(loggerState.messages('warn')).toEqual(['Health check failed (retry 1/3)'])
    expect(loggerState.messages('error')).toEqual([])
    expect(manager.isRunning()).toBe(true)
  })

  it('announces recovery once, not on every pass afterwards', async () => {
    await manager.start(makeConfig())
    httpState.script('/health', { kind: 'error', message: 'ECONNREFUSED' })
    await cycles(1)

    httpState.script('/health', { kind: 'respond', statusCode: 200, body: '{}' })
    await cycles(1)
    await cycles(1)

    expect(loggerState.messages('info')).toContain('Health check passed (recovered)')
    expect(loggerState.messages('info').filter((m) => m === 'Health check passed (recovered)')).toHaveLength(1)
  })

  it('restarts on the fourth consecutive miss, not the third', async () => {
    const restarting: number[] = []
    manager.on('restarting', () => restarting.push(1))
    await manager.start(makeConfig())
    spawnState.exitOnKill = true
    httpState.script('/health', { kind: 'error', message: 'ECONNREFUSED' })

    await cycles(3)
    expect(restarting).toEqual([])
    expect(spawnState.children).toHaveLength(1)

    await cycles(1)

    expect(restarting).toHaveLength(1)
    // the counter is logged before the budget is compared, so the restart miss
    // announces itself as "4/3"
    expect(loggerState.messages('warn')).toEqual([
      'Health check failed (retry 1/3)',
      'Health check failed (retry 2/3)',
      'Health check failed (retry 3/3)',
      'Health check failed (retry 4/3)',
    ])
    expect(loggerState.messages('error')).toEqual(['Max health check retries exceeded, restarting proxy'])
    expect(spawnState.children).toHaveLength(2)
    expect(spawnState.child(0).killSignals).toEqual(['SIGTERM'])
    expect(loggerState.messages('info')).toContain('Proxy restarted successfully')
  })

  it('gives a passing probe back the whole budget', async () => {
    const restarting: number[] = []
    manager.on('restarting', () => restarting.push(1))
    await manager.start(makeConfig())
    spawnState.exitOnKill = true

    httpState.script('/health', { kind: 'error', message: 'ECONNREFUSED' })
    await cycles(3)
    httpState.script('/health', { kind: 'respond', statusCode: 200, body: '{}' })
    await cycles(1)

    httpState.script('/health', { kind: 'error', message: 'ECONNREFUSED' })
    await cycles(3)
    expect(restarting).toEqual([])

    await cycles(1)
    expect(restarting).toHaveLength(1)
  })

  it('reports a restart failure that threw something other than an Error', async () => {
    spawnState.exitOnKill = true
    manager.on('error', () => undefined) // child errors are fatal when nobody listens
    await manager.start(makeConfig())
    spawnState.autoReadyPort = null
    httpState.script('/health', { kind: 'error', message: 'ECONNREFUSED' })

    await cycles(4)
    await flushTurns(8)
    spawnState.child(1).emit('error', 'boom')
    await flushTurns(8)

    expect(loggerState.messages('error')).toEqual([
      'Max health check retries exceeded, restarting proxy',
      'Proxy subprocess error',
      'Failed to restart proxy',
    ])
    const failure = loggerState.error.mock.calls.find((call) => call[1] === 'Failed to restart proxy')
    expect(failure?.[2]).toEqual({ error: 'boom' })
  })

  it('stops probing the moment the child reports its exit', async () => {
    await manager.start(makeConfig())

    spawnState.child(0).exitWith(0, null)
    await cycles(2)

    expect(healthProbes()).toEqual([])
  })

  it('reports a restart failure that threw something other than an Error', async () => {
    spawnState.exitOnKill = true
    manager.on('error', () => undefined) // child errors are fatal when nobody listens
    await manager.start(makeConfig())
    spawnState.autoReadyPort = null
    httpState.script('/health', { kind: 'error', message: 'ECONNREFUSED' })

    await cycles(4)
    await flushTurns(8)
    const replacement = spawnState.child(1)

    replacement.emit('error', 'boom')
    await flushTurns(4)

    expect(loggerState.messages('error')).toEqual([
      'Max health check retries exceeded, restarting proxy',
      'Proxy subprocess error',
      'Failed to restart proxy',
    ])
    expect(loggerState.error.mock.calls[2]![2]).toEqual({ error: 'boom' })
  })

  it('leaves the proxy unmonitored and unreported when the restart itself fails', async () => {
    const emitted: string[] = []
    manager.on('restarting', () => emitted.push('restarting'))
    manager.on('exit', () => emitted.push('exit'))
    manager.on('error', () => emitted.push('error'))
    spawnState.exitOnKill = true
    await manager.start(makeConfig())

    httpState.script('/health', { kind: 'error', message: 'ECONNREFUSED' })
    spawnState.exitBeforeReady = true

    await cycles(4)

    expect(emitted).toEqual(['restarting', 'exit', 'exit'])
    expect(loggerState.messages('error')).toEqual([
      'Max health check retries exceeded, restarting proxy',
      'Failed to restart proxy',
    ])
    // the proxy is gone, yet every getter still advertises it: sessionProcess reads
    // getProxyUrl() and would keep routing engine traffic to this dead port.
    expect(manager.isRunning()).toBe(false)
    expect(manager.getProxyUrl()).toBe('http://127.0.0.1:34567')
    expect(manager.getConfig()).not.toBeNull()

    const probesBefore = healthProbes().length
    await cycles(2)
    expect(healthProbes()).toHaveLength(probesBefore)
  })
})

describe('restart guards', () => {
  it('answers unhealthy rather than probing a port it has no config for', async () => {
    // reachable only if the caller-side guard is dropped; without it the interval
    // would read `this.config.port` off null and die mid-callback.
    await expect(new ProxyManager()['checkHealth']()).resolves.toBe(false)
  })

  it('does nothing when a restart is asked for with no config to restart', async () => {
    const fresh = new ProxyManager()

    await fresh['restartProxy']()

    expect(spawnState.calls).toEqual([])
    expect(fresh.isRunning()).toBe(false)
  })

  it('spawns a single replacement when two restarts overlap', async () => {
    spawnState.exitOnKill = true
    await manager.start(makeConfig())

    await Promise.all([manager['restartProxy'](), manager['restartProxy']()])

    expect(spawnState.children).toHaveLength(2)
    expect(manager.getProxyUrl()).toBe('http://127.0.0.1:34567')
    expect(manager.isRunning()).toBe(true)
  })
})

describe('getStatus', () => {
  it('has no status to report before the proxy has been started', async () => {
    await expect(manager.getStatus()).resolves.toBeNull()
  })

  it('passes the proxy status body through untouched', async () => {
    const status: AdapterStatus = { running: true, port: 34567, requestsProcessed: 12, errorsCount: 1, lastError: 'upstream 429' }
    httpState.script('/status', { kind: 'respond', statusCode: 200, body: JSON.stringify(status) })
    await manager.start(makeConfig())

    await expect(manager.getStatus()).resolves.toEqual(status)
    expect(httpState.urls.filter((url) => url.includes('/status'))).toEqual([STATUS_URL])
  })

  it('reports null instead of throwing when the body is not JSON', async () => {
    httpState.script('/status', { kind: 'respond', statusCode: 200, body: '<html>502</html>' })
    await manager.start(makeConfig())

    await expect(manager.getStatus()).resolves.toBeNull()
  })

  it('reports null when the proxy refuses the connection', async () => {
    httpState.script('/status', { kind: 'error', message: 'ECONNREFUSED' })
    await manager.start(makeConfig())

    await expect(manager.getStatus()).resolves.toBeNull()
  })

  it('gives up after 5s and destroys the hanging request', async () => {
    httpState.script('/status', { kind: 'hang' })
    await manager.start(makeConfig())

    const pending = manager.getStatus()
    await flushTurns()
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(pending).resolves.toBeNull()
    const statusRequest = httpState.requests[httpState.requests.length - 1]!
    expect(statusRequest.timeoutMs).toBe(5_000)
    expect(statusRequest.destroyCount).toBe(1)
  })

  it('reports null for a child that died while still holding its config', async () => {
    await manager.start(makeConfig())

    spawnState.child(0).exitWith(null, 'SIGKILL')

    expect(manager.getConfig()).not.toBeNull()
    await expect(manager.getStatus()).resolves.toBeNull()
  })

  it('asks the probed port, not the port the child said it is listening on', async () => {
    spawnState.autoReadyPort = 39999
    httpState.script('/status', { kind: 'error', message: 'ECONNREFUSED' })
    const url = await manager.start(makeConfig())

    const status = await manager.getStatus()

    expect(url).toBe('http://127.0.0.1:39999')
    expect(status).toBeNull()
    expect(httpState.urls.filter((u) => u.includes('/status'))).toEqual([STATUS_URL])
  })
})
