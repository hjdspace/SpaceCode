// electron/h5/__tests__/h5TestKit.ts
/**
 * Shared harness for the H5Server test suite.
 *
 * The tests drive the *real* service surface: `H5Server.start()` binds a genuine
 * `http.createServer` on port 0 and every assertion is made on what comes back
 * over the socket (or over a real `ws` connection). Only the collaborators that
 * H5Server cannot function without in a headless process are replaced — the
 * auth service, the engine gateway, the history manager and Electron itself —
 * and those replacements live here so each test file can wire them up through
 * `vi.mock` without re-implementing the seams.
 *
 * Nothing here re-implements path sanitising, routing or payload building; that
 * is the product's job under test (ADR-0011).
 */
import { createServer, request as httpRequest } from 'http'
import type { IncomingHttpHeaders } from 'http'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { WebSocket } from 'ws'
import type { EngineAvailability } from '@/shared/channels/claudeCode'
import type { H5AuthService } from '../h5AuthService'
import type { H5AccessSettings } from '../h5Types'

export const TEST_TOKEN = 'h5_testtoken0123456789abcdef'
export const LAN_IP = '192.168.7.20'

// ──────────────────────────────────────────────────
// environment capability: symlink creation
// ──────────────────────────────────────────────────

/**
 * Windows refuses `symlinkSync` unless the process is elevated or Developer
 * Mode is on (EPERM), while linux — what CI runs — always allows it. Probe
 * once so the symlink-based cases can skip on machines that cannot create
 * links instead of failing for an environment reason.
 */
export const CAN_SYMLINK = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'spacecode-symlink-probe-'))
  try {
    writeFileSync(join(probe, 'target.txt'), 'x', 'utf-8')
    symlinkSync(join(probe, 'target.txt'), join(probe, 'link.txt'))
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

// ──────────────────────────────────────────────────
// raw HTTP client
// ──────────────────────────────────────────────────

export interface RawRequestOptions {
  port: number
  /** Sent verbatim as the request target — the client does not normalise dot segments. */
  path: string
  method?: string
  headers?: Record<string, string>
  body?: string | Record<string, unknown>
  token?: string | null
}

export interface RawResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

/**
 * `fetch` (undici) re-canonicalises the request path before sending, which hides
 * exactly the traversal behaviour these tests care about, so requests go out
 * through `node:http`, which transmits the target as written.
 */
export function rawRequest(options: RawRequestOptions): Promise<RawResponse> {
  const payload =
    options.body === undefined
      ? undefined
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)

  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  if (options.token !== undefined && options.token !== null) {
    headers.Authorization = `Bearer ${options.token}`
  }
  if (payload !== undefined && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json'
  }

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method ?? 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        )
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

export function jsonOf(response: RawResponse): unknown {
  return JSON.parse(response.body) as unknown
}

// ──────────────────────────────────────────────────
// CSP readers (the assertions every CSP test shares)
// ──────────────────────────────────────────────────

/** 去掉逐响应注入的一次性 nonce，剩下的必须与共用口径逐字一致。 */
export function withoutCspNonce(csp: string | undefined): string {
  return (csp ?? '').replace(/ 'nonce-[^']+'/g, '')
}

/** 文档里那条 CSP meta 的内容。 */
export function cspMetaOf(html: string): string {
  return html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? ''
}

/** 把一条策略拆成 `指令名 → 来源串`；末尾的空段（`;` 收尾）丢掉。 */
export function cspDirectives(csp: string): Record<string, string> {
  return Object.fromEntries(
    csp
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/)
        return [name, sources.join(' ')]
      }),
  )
}

// ──────────────────────────────────────────────────
// port helpers (these tests bind real listeners)
// ──────────────────────────────────────────────────

/**
 * Vitest 并行跑测试文件，每个 H5 用例又各自主动监听两个端口：探测到的空端口随时可能被
 * 别的文件拿走，"主端口 +1"也可能正好落在别人还没关掉的监听上。挑端口与起服务的这套
 * helper 因此都在这里，重试逻辑只写一遍。
 */
export function freePort(): Promise<number> {
  const probe = createServer()
  return new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '0.0.0.0', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

export function isPortFree(port: number): Promise<boolean> {
  const probe = createServer()
  return new Promise((resolve) => {
    probe.once('error', () => resolve(false))
    probe.listen(port, '0.0.0.0', () => {
      probe.close(() => resolve(true))
    })
  })
}

/** 找一个"自己和 +1 都空着"的主端口。 */
export async function freeMainPort(): Promise<number> {
  for (let i = 0; i < 10; i += 1) {
    const port = await freePort()
    if (await isPortFree(port + 1)) return port
  }
  throw new Error('No free main/sandbox port pair available')
}

/** 占住一个端口，模拟"第二个源已经被别的服务占了"。 */
export function holdPort(port: number): Promise<() => Promise<void>> {
  const blocker = createServer()
  blocker.on('request', (_req, res) => res.end('occupier'))
  return new Promise((resolve, reject) => {
    // 与 H5 同口径绑 0.0.0.0：Windows 上只绑 127.0.0.1 时，再绑 0.0.0.0 会成功而不是撞车
    blocker.once('error', reject)
    blocker.listen(port, '0.0.0.0', () => {
      blocker.removeListener('error', reject)
      resolve(
        () =>
          new Promise<void>((closed) => {
            blocker.close(() => closed())
          }),
      )
    })
  })
}

/** 起服务这类操作整轮重试：每轮重新挑端口，被并行文件抢走就再来一次。 */
export async function attempt<T>(make: () => Promise<T | null | undefined>, times = 6): Promise<T> {
  let lastFailure = 'operation never succeeded'
  for (let i = 0; i < times; i += 1) {
    try {
      const value = await make()
      if (value) return value
      lastFailure = 'precondition never held'
    } catch (err) {
      lastFailure = String(err)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`端口始终被并行的测试文件占着 (${lastFailure})`)
}

// ──────────────────────────────────────────────────
// runtime knobs the stubs read
// ──────────────────────────────────────────────────

export interface FakeWindow {
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn> }
}

export interface FakeElectronRuntime {
  /** `app.getPath('home')` — tests point this at a real temp dir. */
  homeDir: string
  userDataDir: string
  windows: FakeWindow[]
  settings: H5AccessSettings
  /** Backs `net.fetch` for the `/api/http/fetch` proxy. */
  fetchImpl: FetchStub
}

export type FetchStub = Mock<(url?: unknown, init?: unknown) => Promise<unknown>>

function unusedFetch(): FetchStub {
  return vi.fn(async (): Promise<unknown> => {
    throw new Error('net.fetch is not configured for this test')
  })
}

/** A routable address, so the SSRF guard's resolution step is not a real lookup. */
export const PUBLIC_IP = '93.184.216.34'

/**
 * Backs `dns.promises.lookup` for `/api/http/fetch`. The proxy resolves the
 * hostname before fetching, so a test that names a public host must not depend
 * on the machine having DNS.
 */
export const dnsStub = {
  lookup: vi.fn(async (_hostname: string, _opts: unknown): Promise<Array<{ address: string }>> => [
    { address: PUBLIC_IP },
  ]),
}

export function resetDnsStub(): void {
  dnsStub.lookup.mockReset()
  dnsStub.lookup.mockResolvedValue([{ address: PUBLIC_IP }])
}

export function defaultSettings(): H5AccessSettings {
  return {
    enabled: true,
    token: TEST_TOKEN,
    tokenPreview: 'h5_test...cdef',
    publicBaseUrl: null,
    fixedPort: null,
    sandboxPort: null,
  }
}

export const runtime: FakeElectronRuntime = {
  homeDir: '',
  userDataDir: '',
  windows: [],
  settings: defaultSettings(),
  fetchImpl: unusedFetch(),
}

export function resetRuntime(): void {
  runtime.homeDir = ''
  runtime.userDataDir = ''
  runtime.windows = []
  runtime.settings = defaultSettings()
  runtime.fetchImpl = unusedFetch()
}

export function makeWindow(destroyed = false): FakeWindow {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } }
}

export const electronMock = {
  app: {
    isPackaged: false,
    getPath: (kind: string) => (kind === 'home' ? runtime.homeDir : runtime.userDataDir),
    getAppPath: () => process.cwd(),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: class FakeBrowserWindow {
    static getAllWindows = vi.fn(() => runtime.windows)
  },
  net: {
    fetch: (url?: unknown, init?: unknown): Promise<unknown> => runtime.fetchImpl(url, init),
  },
}

// ──────────────────────────────────────────────────
// auth service stub
// ──────────────────────────────────────────────────

export const authStub = {
  getSettings: vi.fn((): H5AccessSettings => runtime.settings),
  validateToken: vi.fn(
    (token: string | null | undefined): boolean =>
      typeof token === 'string' && token === runtime.settings.token,
  ),
  findLanIP: vi.fn((): string => LAN_IP),
}

export const auth = authStub as unknown as H5AuthService

export function resetAuthStub(): void {
  authStub.getSettings.mockClear()
  authStub.validateToken.mockClear()
  authStub.findLanIP.mockClear()
}

// ──────────────────────────────────────────────────
// engine gateway stub
// ──────────────────────────────────────────────────

export const gatewayStub = {
  startSession: vi.fn(async (_sessionId: string, _config?: unknown): Promise<void> => undefined),
  sendMessage: vi.fn(async (_s: string, _c: string, _i?: unknown): Promise<void> => undefined),
  abort: vi.fn(async (_sessionId: string): Promise<void> => undefined),
  stop: vi.fn(async (_sessionId: string): Promise<void> => undefined),
  allowPermission: vi.fn(async (_s: string, _r: string, _u?: unknown, _c?: unknown): Promise<void> => undefined),
  denyPermission: vi.fn(async (_s: string, _r: string, _m?: unknown, _o?: unknown): Promise<void> => undefined),
  submitToolAnswer: vi.fn(async (_s: string, _t: string, _a?: unknown): Promise<void> => undefined),
  skipToolAnswer: vi.fn(async (_s: string, _t: string): Promise<void> => undefined),
  // pi 扩展对话框的应答在网关是同步的（写 stdin 不 await 回执），stub 跟着同步 (#54)
  respondExtensionDialog: vi.fn((_s: string, _d: string, _a?: unknown): void => undefined),
  suspendSession: vi.fn((_sessionId: string): void => undefined),
  resumeSession: vi.fn(async (_sessionId: string): Promise<unknown> => ({ status: 'idle' })),
  setPermissionMode: vi.fn(async (_s: string, _m?: unknown): Promise<void> => undefined),
  setModel: vi.fn(async (_s: string, _m?: unknown): Promise<void> => undefined),
  updateThinkingLevel: vi.fn(async (_s: string, _e?: unknown): Promise<'now'> => 'now'),
  getMcpStatus: vi.fn(async (_sessionId: string): Promise<unknown> => ({ servers: [] })),
  getContextUsage: vi.fn(async (_sessionId: string): Promise<unknown> => ({ used: 1234 })),
  getSettings: vi.fn(async (_sessionId: string): Promise<unknown> => ({ model: 'sonnet' })),
  getPendingPermissionRequestIds: vi.fn((_sessionId: string): string[] => ['req-1']),
  stopEngineTask: vi.fn(async (_s: string, _t: string): Promise<void> => undefined),
  getSessionStatus: vi.fn((sessionId: string): unknown => ({
    sessionId,
    status: 'idle',
    isRunning: true,
  })),
  getActiveSessions: vi.fn((): unknown[] => []),
  listAgents: vi.fn(async (_cwd?: unknown, _type?: unknown): Promise<unknown> => [{ name: 'reviewer' }]),
}

export function resetGatewayStub(): void {
  for (const fn of Object.values(gatewayStub)) {
    fn.mockReset()
  }
  gatewayStub.getSessionStatus.mockImplementation((sessionId: string) => ({
    sessionId,
    status: 'idle',
    isRunning: true,
  }))
  gatewayStub.getActiveSessions.mockReturnValue([])
  gatewayStub.resumeSession.mockResolvedValue({ status: 'idle' })
  gatewayStub.getMcpStatus.mockResolvedValue({ servers: [] })
  gatewayStub.getContextUsage.mockResolvedValue({ used: 1234 })
  gatewayStub.getSettings.mockResolvedValue({ model: 'sonnet' })
  gatewayStub.getPendingPermissionRequestIds.mockReturnValue(['req-1'])
  gatewayStub.listAgents.mockResolvedValue([{ name: 'reviewer' }])
}

// ──────────────────────────────────────────────────
// EngineFactory stub (statics) — also captures the route-event listener
// ──────────────────────────────────────────────────

export type RouteListener = (sessionId: string, eventType: string, data: unknown) => void

export const engineFactoryStub = {
  listeners: [] as RouteListener[],
  unsubscribeCalls: 0,
  onRouteEvent: vi.fn((listener: RouteListener): (() => void) => {
    engineFactoryStub.listeners.push(listener)
    return () => {
      engineFactoryStub.unsubscribeCalls += 1
      const at = engineFactoryStub.listeners.indexOf(listener)
      if (at >= 0) engineFactoryStub.listeners.splice(at, 1)
    }
  }),
  getEngineAvailability: vi.fn(async (_type: unknown): Promise<EngineAvailability> => ({ available: true, reason: 'ok', version: null, installable: false })),
}

/** Push an event through whatever listener H5Server registered at start(). */
export function emitRouteEvent(sessionId: string, eventType: string, data: unknown): number {
  for (const listener of [...engineFactoryStub.listeners]) {
    listener(sessionId, eventType, data)
  }
  return engineFactoryStub.listeners.length
}

export function resetEngineFactoryStub(): void {
  engineFactoryStub.listeners = []
  engineFactoryStub.unsubscribeCalls = 0
  engineFactoryStub.onRouteEvent.mockClear()
  engineFactoryStub.getEngineAvailability.mockResolvedValue({ available: true, reason: 'ok', version: null, installable: false })
}

// ──────────────────────────────────────────────────
// SessionHistoryManager stub
// ──────────────────────────────────────────────────

export const historyStub = {
  listProjectSessions: vi.fn(async (_cwd: string): Promise<unknown[]> => []),
  getSessionTitle: vi.fn((session: unknown): string => {
    const value = session as { firstUserMessage?: string }
    return value?.firstUserMessage ?? 'untitled'
  }),
  formatTimestamp: vi.fn((timestamp?: number): string => `formatted:${timestamp ?? 'none'}`),
  getFullSession: vi.fn(async (_cwd: string, _sid: string): Promise<unknown> => ({ messages: [] })),
  getAgentTranscriptPath: vi.fn(
    (_projectPath: string, _sessionId: string, _agentId: string): string => '/tmp/transcript.jsonl',
  ),
}

export function resetHistoryStub(): void {
  historyStub.listProjectSessions.mockResolvedValue([])
  historyStub.getSessionTitle.mockImplementation((session: unknown) => {
    const value = session as { firstUserMessage?: string }
    return value?.firstUserMessage ?? 'untitled'
  })
  historyStub.formatTimestamp.mockImplementation(
    (timestamp?: number) => `formatted:${timestamp ?? 'none'}`,
  )
  historyStub.getFullSession.mockResolvedValue({ messages: [] })
  historyStub.getAgentTranscriptPath.mockReturnValue('/tmp/transcript.jsonl')
}

// ──────────────────────────────────────────────────
// logger stub
// ──────────────────────────────────────────────────

export const loggerStub = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

// ──────────────────────────────────────────────────
// server + websocket helpers
// ──────────────────────────────────────────────────

export function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
}

export interface SocketWatcher {
  ws: WebSocket
  /** Next frame, or a rejection if the socket closes first. */
  next(): Promise<Record<string, unknown>>
  closed(): Promise<{ code: number; reason: string }>
}

/**
 * Attaches listeners synchronously and buffers frames, because the server
 * pushes `connected` from the same tick the handshake completes — a listener
 * installed after `await open` can miss it.
 */
export function watchSocket(ws: WebSocket): SocketWatcher {
  const buffer: string[] = []
  const waiters: Array<(text: string) => void> = []

  ws.on('message', (raw: Buffer) => {
    const text = raw.toString()
    const waiter = waiters.shift()
    if (waiter) waiter(text)
    else buffer.push(text)
  })

  const closeSignal = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }))
  })
  ws.on('error', () => {
    /* a rejected handshake surfaces through the close code */
  })

  return {
    ws,
    async next(): Promise<Record<string, unknown>> {
      const queued = buffer.shift()
      if (queued !== undefined) return JSON.parse(queued) as Record<string, unknown>
      const text = await Promise.race<string | null>([
        new Promise<string>((resolve) => waiters.push(resolve)),
        closeSignal.then(() => null),
      ])
      if (text === null) throw new Error('socket closed before another frame arrived')
      return JSON.parse(text) as Record<string, unknown>
    },
    closed: () => closeSignal,
  }
}
