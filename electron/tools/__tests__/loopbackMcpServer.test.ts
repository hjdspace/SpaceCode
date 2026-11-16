// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { request as httpRequest } from 'http'
import { connect, type Socket } from 'net'
// 真实的 MCP 客户端来自引擎自带的 SDK：外壳能不能被 Agent 用起来，
// 只有让真正的协议实现握一次手才算数，自造客户端只能证明「我和我自己一致」。
import { Client } from '../../../engine/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../../../engine/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'
import {
  createLoopbackMcpServer,
  type LoopbackMcpContext,
  type LoopbackMcpServer,
  type LoopbackMcpServerOptions,
  type LoopbackMcpToolDefinition,
} from '../loopbackMcpServer'

const ECHO_TOOLS: LoopbackMcpToolDefinition[] = [
  {
    name: 'echo',
    description: 'Echo the text back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
]

interface Dispatched {
  context: LoopbackMcpContext
  name: string
  args: unknown
}

let server: LoopbackMcpServer | null = null
let client: Client | null = null
let dispatched: Dispatched[] = []
const sockets = new Set<Socket>()

function launch(overrides: Partial<LoopbackMcpServerOptions> = {}): LoopbackMcpServer {
  dispatched = []
  server = createLoopbackMcpServer({
    serverKey: 'spacecode-probe',
    instructions: 'Call echo before answering.',
    logTag: 'ProbeMcp',
    tools: ECHO_TOOLS,
    dispatch: async (context, name, args) => {
      dispatched.push({ context, name, args })
      return { content: [{ type: 'text', text: String((args as { text?: string })?.text ?? '') }] }
    },
    ...overrides,
  })
  return server
}

afterEach(async () => {
  if (client) {
    await client.close()
    client = null
  }
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  if (server) {
    await server.stop()
    server = null
  }
})

interface RawResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

function raw(
  port: number,
  options: { method?: string; path?: string; body?: string; headers?: Record<string, string> },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'POST',
        path: options.path ?? '/mcp',
        headers: { 'Content-Type': 'application/json', ...options.headers },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          }),
        )
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

const PING = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })

/** 裸 socket：用于发 http 客户端不肯发的报文（缺 Host、只发一半的请求体）。 */
function rawSocket(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(payload))
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    socket.on('error', reject)
    sockets.add(socket)
  })
}

function authed(running: LoopbackMcpServer, body: unknown, path = '/mcp'): Promise<RawResponse> {
  return raw(running.port, {
    path,
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${running.token}`, Accept: 'application/json, text/event-stream' },
  })
}

describe('injected tool table over a real MCP client', () => {
  it('handshakes, lists the injected tools and routes a call with the session context', async () => {
    const running = launch()
    const port = await running.start()
    expect(port).toBeGreaterThan(0)
    expect(running.port).toBe(port)

    const entry = running.entry('sess-1', '/tmp/ws')
    expect(entry.type).toBe('http')
    expect(entry.url).toBe(`http://127.0.0.1:${port}/mcp/sess-1?root=%2Ftmp%2Fws`)
    expect(entry.headers.Authorization).toBe(`Bearer ${running.token}`)

    client = new Client({ name: 'probe-client', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers } }),
    )

    expect(client.getServerVersion()?.name).toBe('spacecode-probe')
    expect(client.getInstructions()).toBe('Call echo before answering.')

    const listed = await client.listTools()
    expect(listed.tools).toEqual(ECHO_TOOLS)

    const called = await client.callTool({ name: 'echo', arguments: { text: 'hi' } })
    expect(called.isError).toBeFalsy()
    expect(called.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(dispatched).toEqual([{ context: { sessionId: 'sess-1', projectRoot: '/tmp/ws' }, name: 'echo', args: { text: 'hi' } }])
  })
})

describe('real MCP client against the guards', () => {
  it('fails the handshake when the bearer token is wrong', async () => {
    const running = launch()
    await running.start()
    const entry = running.entry('sess-1')
    client = new Client({ name: 'probe-client', version: '1.0.0' })
    await expect(
      client.connect(
        new StreamableHTTPClientTransport(new URL(entry.url), {
          requestInit: { headers: { Authorization: 'Bearer not-the-token' } },
        }),
      ),
    ).rejects.toThrow()
    expect(dispatched).toEqual([])
  })

  it('fails the tool call when the request body exceeds the cap', async () => {
    const running = launch()
    await running.start()
    const entry = running.entry('sess-1')
    client = new Client({ name: 'probe-client', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers } }),
    )
    await expect(
      client.callTool({ name: 'echo', arguments: { text: 'x'.repeat(1024 * 1024 + 1) } }),
    ).rejects.toThrow()
    expect(dispatched).toEqual([])
  })
})

describe('bearer token gate', () => {
  it('rejects a missing, malformed or wrong token and accepts the issued one', async () => {
    const running = launch()
    await running.start()
    const token = running.token
    // 不等长的两个用例是「先比长度」的证据：timingSafeEqual 对不等长入参会抛，
    // 少了长度前置判断就会变成 500 而不是 401。
    const sameLengthWrong = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    expect(sameLengthWrong).toHaveLength(token.length)

    const rejected = [
      undefined,
      'Bearer wrong',
      `Bearer ${token}x`,
      `Bearer ${token.slice(0, -1)}`,
      `Bearer ${sameLengthWrong}`,
      token,
      `Basic ${token}`,
    ]
    for (const authorization of rejected) {
      const res = await raw(running.port, {
        body: PING,
        headers: authorization === undefined ? {} : { Authorization: authorization },
      })
      expect(res.status, `authorization=${authorization}`).toBe(401)
    }

    const accepted = await raw(running.port, { body: PING, headers: { Authorization: `Bearer ${token}` } })
    expect(accepted.status).toBe(200)
    expect(JSON.parse(accepted.body).result).toEqual({})
  })

  it('issues a distinct random token per server and honours an injected one', async () => {
    const first = launch()
    const second = createLoopbackMcpServer({
      serverKey: 'spacecode-probe',
      instructions: '',
      logTag: 'ProbeMcp',
      tools: [],
      dispatch: async () => ({ content: [{ type: 'text', text: '' }] }),
    })
    expect(first.token).not.toBe(second.token)
    expect(first.token.length).toBeGreaterThanOrEqual(32)

    const pinned = createLoopbackMcpServer({
      serverKey: 'spacecode-probe',
      instructions: '',
      logTag: 'ProbeMcp',
      tools: [],
      token: 'pinned-token',
      dispatch: async () => ({ content: [{ type: 'text', text: '' }] }),
    })
    expect(pinned.token).toBe('pinned-token')
    expect(pinned.entry(null).headers.Authorization).toBe('Bearer pinned-token')
  })
})

describe('host allowlist', () => {
  // 这一闸只能走裸 HTTP：Node 的 fetch 会丢掉调用方给的 Host 头，
  // SDK 客户端无法表达「Host 不在白名单」这个请求。
  it('rejects a foreign Host even with a valid token, and accepts loopback names with a port', async () => {
    const running = launch()
    const port = await running.start()
    const authorization = `Bearer ${running.token}`

    for (const host of ['evil.example.com', `evil.example.com:${port}`, '127.0.0.1.evil.com']) {
      const res = await raw(port, { body: PING, headers: { Authorization: authorization, Host: host } })
      expect(res.status, `host=${host}`).toBe(403)
    }

    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'localhost']) {
      const res = await raw(port, { body: PING, headers: { Authorization: authorization, Host: host } })
      expect(res.status, `host=${host}`).toBe(200)
    }
  })

  it('rejects a request that carries no Host header at all', async () => {
    const running = launch()
    const port = await running.start()
    // Node 的 http 客户端会自动补上 Host，只有裸 socket 才能发出「没有 Host」的请求。
    const response = await rawSocket(
      port,
      [
        'POST /mcp HTTP/1.0',
        `Authorization: Bearer ${running.token}`,
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(PING)}`,
        '',
        PING,
      ].join('\r\n'),
    )
    expect(response).toContain('403')
  })
})

describe('request body cap', () => {
  const MAX_BODY_BYTES = 1024 * 1024

  function paddedPing(totalBytes: number): string {
    const head = '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"'
    const tail = '"}}'
    return head + 'x'.repeat(totalBytes - head.length - tail.length) + tail
  }

  it('accepts a body at the cap and refuses one byte over it', async () => {
    const running = launch()
    await running.start()
    const headers = { Authorization: `Bearer ${running.token}` }

    const atCap = paddedPing(MAX_BODY_BYTES)
    expect(Buffer.byteLength(atCap)).toBe(MAX_BODY_BYTES)
    expect((await raw(running.port, { body: atCap, headers })).status).toBe(200)

    const overCap = paddedPing(MAX_BODY_BYTES + 1)
    const refused = await raw(running.port, { body: overCap, headers })
    expect(refused.status).toBe(413)
    expect(JSON.parse(refused.body)).toEqual({ error: 'Request body too large' })
  })

  it('answers 413 while the oversized body is still uploading, without resetting the connection', async () => {
    const running = launch()
    const port = await running.start()
    // 只发一半就停手：destroy socket 的实现会让这里收不到任何状态码，
    // 只有 pause 读取才能把 413 发回来。
    const head = [
      'POST /mcp HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      `Authorization: Bearer ${running.token}`,
      'Content-Type: application/json',
      `Content-Length: ${MAX_BODY_BYTES * 4}`,
      '',
      '',
    ].join('\r\n')
    const response = await rawSocket(port, head + 'x'.repeat(MAX_BODY_BYTES + 1))
    expect(response).toContain('413')
    expect(response).toContain('Request body too large')
  })
})

describe('protocol version negotiation', () => {
  function initialize(running: LoopbackMcpServer, params: Record<string, unknown>): Promise<RawResponse> {
    return authed(running, { jsonrpc: '2.0', id: 1, method: 'initialize', params })
  }

  it('echoes a supported version and falls back to the latest for an unknown or absent one', async () => {
    const running = launch()
    await running.start()

    for (const version of ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']) {
      const res = await initialize(running, { protocolVersion: version, capabilities: {}, clientInfo: { name: 'probe', version: '1' } })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).result.protocolVersion, `requested=${version}`).toBe(version)
    }

    for (const params of [{ protocolVersion: '1999-01-01' }, { protocolVersion: 7 }, {}]) {
      const res = await initialize(running, params)
      expect(JSON.parse(res.body).result.protocolVersion).toBe('2025-11-25')
    }
  })

  it('advertises only tools, with no list-changed notifications', async () => {
    const running = launch()
    await running.start()
    const result = JSON.parse((await initialize(running, { protocolVersion: '2025-06-18' })).body).result
    expect(result.capabilities).toEqual({ tools: { listChanged: false } })
    expect(result.serverInfo).toEqual({ name: 'spacecode-probe', version: '1.0.0' })
  })
})

describe('json-rpc batching and notifications', () => {
  it('answers a mixed batch with one response per request, dropping notifications', async () => {
    const running = launch()
    await running.start()
    const res = await authed(running, [
      { jsonrpc: '2.0', id: 'first', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'second', method: 'tools/list' },
    ])
    expect(res.status).toBe(200)
    const parsed = JSON.parse(res.body)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.map((item: { id: unknown }) => item.id)).toEqual(['first', 'second'])
    expect(parsed[0].result).toEqual({})
    expect(parsed[1].result.tools).toEqual(ECHO_TOOLS)
  })

  it('returns 202 with no body for notification-only traffic', async () => {
    const running = launch()
    await running.start()

    const single = await authed(running, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(single.status).toBe(202)
    expect(single.body).toBe('')

    const batch = await authed(running, [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: null, method: 'notifications/cancelled' },
    ])
    expect(batch.status).toBe(202)
    expect(batch.body).toBe('')
    expect(dispatched).toEqual([])
  })

  it('keeps batch responses in request order even when a later call finishes first', async () => {
    const running = launch({
      dispatch: async (_context, _name, args) => {
        const text = String((args as { text?: string })?.text ?? '')
        await new Promise(resolve => setTimeout(resolve, text === 'slow' ? 40 : 0))
        return { content: [{ type: 'text', text }] }
      },
    })
    await running.start()
    const res = await authed(running, [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { text: 'slow' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'fast' } } },
    ])
    const parsed = JSON.parse(res.body)
    expect(parsed.map((item: { id: unknown }) => item.id)).toEqual([1, 2])
    expect(parsed.map((item: { result: { content: Array<{ text: string }> } }) => item.result.content[0].text)).toEqual([
      'slow',
      'fast',
    ])
  })
})

describe('stateless loopback surface', () => {
  it('never issues a session id and never opens a server-push stream', async () => {
    const running = launch()
    await running.start()

    const initialized = await authed(running, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
    })
    expect(initialized.headers['mcp-session-id']).toBeUndefined()

    const headers = { Authorization: `Bearer ${running.token}` }
    for (const method of ['GET', 'DELETE']) {
      const res = await raw(running.port, { method, headers })
      expect(res.status, `method=${method}`).toBe(405)
      expect(res.headers.allow).toBe('POST')
      expect(res.body).toBe('')
    }
  })

  it('sends no CORS headers on success or on rejection', async () => {
    const running = launch()
    await running.start()

    const responses = [
      await authed(running, { jsonrpc: '2.0', id: 1, method: 'ping' }),
      await raw(running.port, { body: PING }),
      await raw(running.port, { body: PING, headers: { Authorization: `Bearer ${running.token}`, Host: 'evil.example.com' } }),
      await raw(running.port, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } }),
    ]
    for (const res of responses) {
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
      expect(res.headers['access-control-allow-credentials']).toBeUndefined()
    }
  })

  it('serves only the mcp path and drops unsafe session ids from the entry', async () => {
    const running = launch()
    const port = await running.start()
    const headers = { Authorization: `Bearer ${running.token}` }

    for (const path of ['/admin', '/mcp/../../etc', '/mcp/', '/mcp/a/b']) {
      expect((await raw(port, { path, headers })).status, `path=${path}`).toBe(404)
    }

    expect(running.entry(null).url).toBe(`http://127.0.0.1:${port}/mcp`)
    expect(running.entry('../escape').url).toBe(`http://127.0.0.1:${port}/mcp`)
    expect(running.entry('a'.repeat(129)).url).toBe(`http://127.0.0.1:${port}/mcp`)
    expect(running.entry('ok-123', 'D:/work/with space').url).toBe(
      `http://127.0.0.1:${port}/mcp/ok-123?root=D%3A%2Fwork%2Fwith%20space`,
    )
  })
})

describe('lifecycle', () => {
  it('reclaims an in-flight connection on stop and leaves no listening port', async () => {
    let entered!: () => void
    let release!: () => void
    const inFlight = new Promise<void>(resolve => {
      entered = resolve
    })
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const running = launch({
      dispatch: async () => {
        entered()
        await gate
        return { content: [{ type: 'text', text: 'too late' }] }
      },
    })
    const port = await running.start()

    // 一个永不返回的工具调用：连接是活跃的，光靠 close() 会一直等下去。
    const pending = raw(port, {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { text: 'x' } } }),
      headers: { Authorization: `Bearer ${running.token}` },
    })
    const settled = pending.then(
      () => 'resolved',
      () => 'reset',
    )
    await inFlight

    const outcome = await Promise.race([
      running.stop().then(() => 'stopped'),
      new Promise(resolve => setTimeout(() => resolve('hung'), 2000)),
    ])
    expect(outcome).toBe('stopped')
    expect(running.port).toBe(0)
    expect(await settled).toBe('reset')
    await expect(raw(port, { body: PING })).rejects.toThrow()
    release()
  })

  it('is idempotent on start and safe to stop twice', async () => {
    const running = launch()
    const port = await running.start()
    expect(await running.start()).toBe(port)
    expect(running.port).toBe(port)

    await running.stop()
    expect(running.port).toBe(0)
    await running.stop()
    await expect(raw(port, { body: PING })).rejects.toThrow()

    const restarted = await running.start()
    expect(restarted).toBeGreaterThan(0)
    expect((await authed(running, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
  })
})

describe('error envelope', () => {
  it('reports parse errors and invalid requests with their JSON-RPC codes', async () => {
    const running = launch()
    await running.start()

    const broken = await raw(running.port, {
      body: '{not json',
      headers: { Authorization: `Bearer ${running.token}` },
    })
    expect(broken.status).toBe(400)
    expect(JSON.parse(broken.body).error.code).toBe(-32700)

    const missingVersion = JSON.parse((await authed(running, { id: 9, method: 'ping' })).body)
    expect(missingVersion.error.code).toBe(-32600)
    expect(missingVersion.id).toBe(9)

    const missingMethod = JSON.parse((await authed(running, { jsonrpc: '2.0', id: 10 })).body)
    expect(missingMethod.error.code).toBe(-32600)

    const noToolName = JSON.parse(
      (await authed(running, { jsonrpc: '2.0', id: 11, method: 'tools/call', params: {} })).body,
    )
    expect(noToolName.error.code).toBe(-32602)

    const unknownMethod = JSON.parse((await authed(running, { jsonrpc: '2.0', id: 12, method: 'resources/list' })).body)
    expect(unknownMethod.error.code).toBe(-32601)
    expect(dispatched).toEqual([])
  })

  it('stays silent for a malformed notification', async () => {
    const running = launch()
    await running.start()
    const res = await authed(running, { method: 'ping' })
    expect(res.status).toBe(202)
    expect(res.body).toBe('')
  })

  it('turns an unexpected dispatch throw into a readable tool error, not a channel error', async () => {
    const running = launch({
      dispatch: async () => {
        throw new Error('store exploded')
      },
    })
    await running.start()
    const res = await authed(running, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.error).toBeUndefined()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('store exploded')
    expect(body.result.content[0].text).toContain('The tool failed unexpectedly:')
  })

  it('lets the caller own the wording of an unexpected tool failure', async () => {
    const running = launch({
      unexpectedErrorPrefix: 'The probe tool failed unexpectedly',
      dispatch: async () => {
        throw new Error('boom')
      },
    })
    await running.start()
    const body = JSON.parse(
      (await authed(running, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } })).body,
    )
    expect(body.result.content[0].text).toBe('The probe tool failed unexpectedly: Error: boom')
  })

  it('passes a business-level tool error straight through', async () => {
    const running = launch({
      dispatch: async () => ({ content: [{ type: 'text', text: 'no such thing' }], isError: true }),
    })
    await running.start()
    const body = JSON.parse(
      (await authed(running, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } })).body,
    )
    expect(body.result).toEqual({ content: [{ type: 'text', text: 'no such thing' }], isError: true })
  })
})