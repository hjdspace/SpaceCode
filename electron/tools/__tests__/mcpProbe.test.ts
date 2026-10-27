// @vitest-environment node
import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * MCP connectivity probe — the code behind the "测试连接" button in the MCP
 * panel. It speaks the JSON-RPC handshake directly (spawn → initialize →
 * notifications/initialized → tools/list), so the tests below drive a fake
 * child process and a stubbed fetch and assert on the protocol the probe puts
 * on the wire, not on its internals.
 */

const cp = vi.hoisted(() => ({ spawn: vi.fn() }))

vi.mock('child_process', () => ({ spawn: cp.spawn }))

vi.mock('../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { probeMcpServer } from '../mcpProbe'
import type { McpProbeConfig } from '../mcpProbe'

interface FakeProc {
  proc: any
  written: any[]
  kill: ReturnType<typeof vi.fn>
}

function fakeProcess(): FakeProc {
  const written: any[] = []
  const proc: any = new EventEmitter()
  proc.stdin = { write: (chunk: string) => written.push(JSON.parse(chunk)) }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.killed = false
  const kill = vi.fn(() => {
    proc.killed = true
  })
  proc.kill = kill
  return { proc, written, kill }
}

function stdioConfig(overrides: Partial<McpProbeConfig> = {}): McpProbeConfig {
  return { type: 'stdio', command: 'npx', args: ['-y', 'some-server'], ...overrides }
}

/** Emit one JSON-RPC line, honouring the probe's newline framing. */
function emitLine(proc: FakeProc, message: unknown): void {
  proc.proc.stdout.emit('data', Buffer.from(JSON.stringify(message) + '\n'))
}

const initResponse = {
  jsonrpc: '2.0',
  id: 1,
  result: { protocolVersion: '2024-11-05', serverInfo: { name: 'demo', version: '1.2.0' } },
}

const toolsResponse = {
  jsonrpc: '2.0',
  id: 2,
  result: { tools: [{ name: 'read_file', description: 'Read a file' }, { name: 'no_desc' }] },
}

function httpResponses(byMethod: Record<string, unknown>): void {
  fetchSpy.mockImplementation(async (_url: string, init: { body: string }) => {
    const message = JSON.parse(init.body)
    const handler = byMethod[message.method as string]
    if (handler instanceof Error) throw handler
    return typeof handler === 'function' ? handler(message) : handler
  })
}

const fetchSpy = vi.fn()
let proc: FakeProc

beforeEach(() => {
  cp.spawn.mockReset()
  proc = fakeProcess()
  cp.spawn.mockReturnValue(proc.proc)
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('probeMcpServer — dispatch', () => {
  it('fails a stdio server with no command instead of spawning undefined', async () => {
    await expect(probeMcpServer({ type: 'stdio' })).resolves.toEqual({
      status: 'failed',
      error: 'No command or URL configured',
    })
    expect(cp.spawn).not.toHaveBeenCalled()
  })

  it('routes sse and http configs to their own probes', async () => {
    httpResponses({})
    fetchSpy.mockResolvedValue(httpBody('', { ok: true, status: 200, statusText: 'OK' }))

    await probeMcpServer({ type: 'sse', url: 'http://127.0.0.1:1/sse' })
    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ method: 'GET' })

    await probeMcpServer({ type: 'http', url: 'http://127.0.0.1:1/mcp' })
    expect(fetchSpy.mock.calls[1]![1]).toMatchObject({ method: 'POST' })
    expect(cp.spawn).not.toHaveBeenCalled()
  })
})

describe('probeStdio — spawn options', () => {
  it('spawns a bare command without the shell, the way the engine does', async () => {
    // 探测要能预测会话里的结果，所以 spawn 语义必须和引擎侧 MCP SDK
    // StdioClientTransport 一致。之前这里对裸命令走 shell:true，于是
    // Windows 上「测试连接」把 npx.cmd 用 cmd.exe 拉起来报绿灯，而引擎
    // 用 shell:false 起同一个命令必然 ENOENT —— 假绿正好盖住了真故障。
    const p = probeMcpServer(stdioConfig({ command: 'npx' }))
    emitLine(proc, initResponse)
    emitLine(proc, toolsResponse)
    await p

    expect(cp.spawn).toHaveBeenCalledWith(
      'npx',
      ['-y', 'some-server'],
      expect.objectContaining({ shell: false, windowsHide: true }),
    )
  })

  it('does not use the shell for an absolute path either', async () => {
    const absolute = path.resolve('servers', 'mcp server.js')
    const p = probeMcpServer(stdioConfig({ command: absolute, args: [] }))
    emitLine(proc, initResponse)
    emitLine(proc, toolsResponse)
    await p

    expect(cp.spawn).toHaveBeenCalledWith(
      absolute,
      [],
      expect.objectContaining({ shell: false }),
    )
  })

  it('merges config env over the inherited environment', async () => {
    const p = probeMcpServer(stdioConfig({ env: { MCP_TOKEN: 'secret' } }))
    emitLine(proc, initResponse)
    emitLine(proc, toolsResponse)
    await p

    const options = cp.spawn.mock.calls[0]![2] as { env: Record<string, string | undefined> }
    expect(options.env.MCP_TOKEN).toBe('secret')
    expect(options.env.PATH).toBe(process.env.PATH)
  })

  it('defaults args to an empty list', async () => {
    const p = probeMcpServer({ type: 'stdio', command: 'uvx', args: undefined })
    emitLine(proc, initResponse)
    emitLine(proc, toolsResponse)
    await p

    expect(cp.spawn.mock.calls[0]![1]).toEqual([])
  })
})

describe('probeStdio — handshake', () => {
  it('completes initialize → initialized → tools/list and reports the tools', async () => {
    const p = probeMcpServer(stdioConfig())
    emitLine(proc, initResponse)
    emitLine(proc, toolsResponse)

    await expect(p).resolves.toEqual({
      status: 'connected',
      serverInfo: { name: 'demo', version: '1.2.0' },
      tools: [{ name: 'read_file', description: 'Read a file' }, { name: 'no_desc' }],
    })
    expect(proc.written.map((m) => m.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
  })

  it('kills the process once the probe settles', async () => {
    const p = probeMcpServer(stdioConfig())
    emitLine(proc, initResponse)
    emitLine(proc, toolsResponse)
    await p

    expect(proc.kill).toHaveBeenCalled()
  })

  it('tolerates a server that omits serverInfo', async () => {
    const p = probeMcpServer(stdioConfig())
    emitLine(proc, { jsonrpc: '2.0', id: 1, result: {} })
    emitLine(proc, toolsResponse)

    const result = await p
    expect(result.status).toBe('connected')
    expect(result.serverInfo).toBeUndefined()
    expect(result.tools).toHaveLength(2)
  })

  it('fills blank strings for half-present serverInfo instead of throwing', async () => {
    const p = probeMcpServer(stdioConfig())
    emitLine(proc, { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'only-name' } } })
    emitLine(proc, toolsResponse)

    await expect(p).resolves.toMatchObject({ serverInfo: { name: 'only-name', version: '' } })
  })

  it('reassembles a JSON message split across stdout chunks', async () => {
    const p = probeMcpServer(stdioConfig())
    const payload = JSON.stringify(initResponse)
    proc.proc.stdout.emit('data', Buffer.from(payload.slice(0, 20)))
    proc.proc.stdout.emit('data', Buffer.from(payload.slice(20) + '\n'))
    emitLine(proc, toolsResponse)

    await expect(p).resolves.toMatchObject({ status: 'connected' })
  })

  it('ignores non-JSON stdout lines and keeps waiting for the protocol', async () => {
    const p = probeMcpServer(stdioConfig())
    proc.proc.stdout.emit('data', Buffer.from('npm WARN deprecated some-package\n'))
    emitLine(proc, initResponse)
    proc.proc.stdout.emit('data', Buffer.from('not json at all\n'))
    emitLine(proc, toolsResponse)

    await expect(p).resolves.toMatchObject({ status: 'connected' })
  })
})

describe('probeStdio — failure reporting', () => {
  it('reports a spawn error as a start failure', async () => {
    const p = probeMcpServer(stdioConfig())
    proc.proc.emit('error', Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' }))

    await expect(p).resolves.toEqual({ status: 'failed', error: 'Failed to start: spawn npx ENOENT' })
  })

  it('quotes the last three stderr lines when the server dies before answering', async () => {
    const p = probeMcpServer(stdioConfig())
    proc.proc.stderr.emit('data', Buffer.from('line 1\nline 2\nline 3\nline 4\n'))
    proc.proc.emit('exit', 1)

    const result = await p
    expect(result.status).toBe('failed')
    expect(result.error).toBe('Process exited with code 1 before responding: line 2 | line 3 | line 4')
  })

  it('omits the stderr tail when the server gave no output', async () => {
    const p = probeMcpServer(stdioConfig())
    proc.proc.emit('exit', null)

    await expect(p).resolves.toEqual({
      status: 'failed',
      error: 'Process exited with code null before responding',
    })
  })

  it('surfaces a JSON-RPC error message', async () => {
    const p = probeMcpServer(stdioConfig())
    emitLine(proc, { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } })

    await expect(p).resolves.toEqual({ status: 'failed', error: 'Method not found' })
  })

  it('falls back to the error code when the message is missing', async () => {
    const p = probeMcpServer(stdioConfig())
    emitLine(proc, { jsonrpc: '2.0', id: 1, error: { code: -32000 } })

    await expect(p).resolves.toEqual({ status: 'failed', error: 'JSON-RPC error code -32000' })
  })

  it('times out and kills a server that never responds', async () => {
    await expect(probeMcpServer(stdioConfig(), 1)).resolves.toEqual({
      status: 'failed',
      error: 'Connection timed out',
    })
    expect(proc.kill).toHaveBeenCalled()
  })

  it('settles once, so a later exit cannot overwrite the reported result', async () => {
    const p = probeMcpServer(stdioConfig())
    emitLine(proc, initResponse)
    emitLine(proc, toolsResponse)
    await p
    proc.proc.emit('exit', 1)

    await expect(p).resolves.toMatchObject({ status: 'connected' })
  })
})

describe('probeSse', () => {
  it('fails without a url', async () => {
    await expect(probeMcpServer({ type: 'sse' })).resolves.toEqual({
      status: 'failed',
      error: 'No URL configured',
    })
  })

  it('reports connected with an empty tool list, which the panel must not read as "no server"', async () => {
    fetchSpy.mockResolvedValue(httpBody('', { contentType: 'text/event-stream' }))

    await expect(probeMcpServer({ type: 'sse', url: 'http://127.0.0.1:1/sse' })).resolves.toEqual({
      status: 'connected',
      tools: [],
    })
    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Accept: 'text/event-stream' }),
    })
  })

  it('reports the HTTP status when the stream endpoint rejects', async () => {
    fetchSpy.mockResolvedValue(httpBody('', { ok: false, status: 401, statusText: 'Unauthorized' }))

    await expect(probeMcpServer({ type: 'sse', url: 'http://127.0.0.1:1/sse' })).resolves.toEqual({
      status: 'failed',
      error: 'HTTP 401 Unauthorized',
    })
  })

  it('passes custom headers through to the stream request', async () => {
    fetchSpy.mockResolvedValue(httpBody(''))

    await probeMcpServer({ type: 'sse', url: 'http://x/sse', headers: { Authorization: 'Bearer t' } })

    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ headers: { Accept: 'text/event-stream', Authorization: 'Bearer t' } })
  })

  it('turns an aborted request into a failure message', async () => {
    fetchSpy.mockRejectedValue(new Error('This operation was aborted'))

    await expect(probeMcpServer({ type: 'sse', url: 'http://x/sse' })).resolves.toEqual({
      status: 'failed',
      error: 'This operation was aborted',
    })
  })
})

describe('probeHttp', () => {
  it('fails without a url', async () => {
    await expect(probeMcpServer({ type: 'http' })).resolves.toEqual({
      status: 'failed',
      error: 'No URL configured',
    })
  })

  it('runs initialize then tools/list and returns both results', async () => {
    httpResponses({
      initialize: httpBody(initResponse),
      'notifications/initialized': httpBody(''),
      'tools/list': httpBody(toolsResponse),
    })

    await expect(probeMcpServer({ type: 'http', url: 'http://x/mcp' })).resolves.toEqual({
      status: 'connected',
      serverInfo: { name: 'demo', version: '1.2.0' },
      tools: [{ name: 'read_file', description: 'Read a file' }, { name: 'no_desc' }],
    })
  })

  it('sends the transport headers the spec requires', async () => {
    httpResponses({
      initialize: httpBody(initResponse),
      'notifications/initialized': httpBody(''),
      'tools/list': httpBody(toolsResponse),
    })

    await probeMcpServer({ type: 'http', url: 'http://x/mcp', headers: { 'X-API-Key': 'k' } })
    const init = fetchSpy.mock.calls[0]![1] as { headers: Record<string, string>; body: string }

    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-API-Key': 'k',
    })
    expect(JSON.parse(init.body)).toMatchObject({ method: 'initialize', id: 1 })
  })

  it('parses an SSE-framed JSON-RPC response', async () => {
    httpResponses({
      initialize: httpBody('event: message\ndata: ' + JSON.stringify(initResponse) + '\n\n', {
        contentType: 'text/event-stream',
      }),
      'notifications/initialized': httpBody(''),
      'tools/list': httpBody('event: message\ndata: ' + JSON.stringify(toolsResponse) + '\n\n', {
        contentType: 'text/event-stream',
      }),
    })

    await expect(probeMcpServer({ type: 'http', url: 'http://x/mcp' })).resolves.toMatchObject({
      status: 'connected',
      serverInfo: { name: 'demo', version: '1.2.0' },
    })
  })

  it('fails when initialize is rejected at the HTTP layer', async () => {
    httpResponses({ initialize: httpBody('', { ok: false, status: 502, statusText: 'Bad Gateway' }) })

    await expect(probeMcpServer({ type: 'http', url: 'http://x/mcp' })).resolves.toEqual({
      status: 'failed',
      error: 'HTTP 502 Bad Gateway',
    })
  })

  it('fails with the JSON-RPC error when the server answers initialize with an error', async () => {
    httpResponses({
      initialize: httpBody({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'unsupported protocol' } }),
    })

    await expect(probeMcpServer({ type: 'http', url: 'http://x/mcp' })).resolves.toEqual({
      status: 'failed',
      error: 'unsupported protocol',
    })
  })

  it('reports failure when the initialize body is not parseable', async () => {
    httpResponses({ initialize: httpBody('<html>login required</html>') })

    await expect(probeMcpServer({ type: 'http', url: 'http://x/mcp' })).resolves.toEqual({
      status: 'failed',
      error: 'Invalid initialize response',
    })
  })

  it('still counts the server as connected when tools/list returns an error status', async () => {
    httpResponses({
      initialize: httpBody(initResponse),
      'notifications/initialized': httpBody(''),
      'tools/list': httpBody('', { ok: false, status: 500, statusText: 'Internal Server Error' }),
    })

    await expect(probeMcpServer({ type: 'http', url: 'http://x/mcp' })).resolves.toEqual({
      status: 'connected',
      serverInfo: { name: 'demo', version: '1.2.0' },
      tools: [],
    })
  })

  it('treats a transport-level throw from tools/list as a failure', async () => {
    // The "connected anyway" allowance above covers a bad HTTP answer, not a
    // socket that never completed. Pinning the difference: one side reports the
    // server healthy with no tools, the other reports the error.
    httpResponses({
      initialize: httpBody(initResponse),
      'notifications/initialized': httpBody(''),
      'tools/list': new Error('socket hang up'),
    })

    await expect(probeMcpServer({ type: 'http', url: 'http://x/mcp' })).resolves.toEqual({
      status: 'failed',
      error: 'socket hang up',
    })
  })

  it('surfaces a transport-level throw as a failure message', async () => {
    httpResponses({ initialize: new Error('fetch failed') })

    await expect(probeMcpServer({ type: 'http', url: 'http://x/mcp' })).resolves.toEqual({
      status: 'failed',
      error: 'fetch failed',
    })
  })
})

function httpBody(
  body: string | Record<string, unknown>,
  options: { ok?: boolean; status?: number; statusText?: string; contentType?: string } = {},
) {
  const contentType = options.contentType ?? 'application/json'
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}
