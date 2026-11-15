// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { request as httpRequest } from 'http'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// 真实的 MCP 客户端来自引擎自带的 SDK：待办工具能不能被 Agent 调起来，
// 只有让真正的协议实现握一次手才算数，自造客户端只能证明「我和我自己一致」。
import { Client } from '../../../engine/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../../../engine/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'
import { createTodoStore, type TodoStore } from '../todoStore'
import { createTodoService, type TodoService } from '../todoService'
import type { TodoSyncController } from '../remindersSync'
import type { TodoSyncState } from '@/shared/channels/todo'
import { callTodoTool, TODO_MCP_TOOL_NAMES } from '../todoMcpTools'
import type { McpToolResult } from '../todoMcpTools'
import {
  createTodoMcpServer,
  getTodoMcpEntry,
  startTodoMcpServer,
  stopTodoMcpServer,
  type TodoMcpServer,
} from '../todoMcpServer'

const SYNC_STATE: TodoSyncState = {
  supported: false,
  permission: 'unsupported',
  config: { enabled: false, listId: null },
  lists: [],
  conflicts: [],
  syncing: false,
}

function silentSync(): TodoSyncController {
  return {
    getState: () => SYNC_STATE,
    requestAccess: async () => ({ ok: true, state: SYNC_STATE }),
    setConfig: async () => ({ ok: true, state: SYNC_STATE }),
    syncNow: async () => ({ ok: true, state: SYNC_STATE }),
    resolveConflict: async () => ({ ok: true, state: SYNC_STATE }),
    noteLocalDeletions: () => {},
    noteLocalRestorations: () => {},
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
  }
}

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

let dir: string
let store: TodoStore
let service: TodoService
let server: TodoMcpServer
let client: Client | null = null

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'spacecode-todo-mcp-http-'))
  store = createTodoStore({ filePath: join(dir, 'todos.json') })
  service = createTodoService({ store, sync: silentSync(), send: () => {}, notify: () => {} })
  server = createTodoMcpServer({
    dispatch: (context, name, args) => callTodoTool(name, args, service.forAgent(context.sessionId), context),
  })
  await server.start()
})

afterEach(async () => {
  if (client) {
    await client.close()
    client = null
  }
  await server.stop()
  await stopTodoMcpServer()
  rmSync(dir, { recursive: true, force: true })
})

function authed(body: unknown, path = '/mcp'): Promise<RawResponse> {
  return raw(server.port, {
    path,
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${server.token}`, Accept: 'application/json, text/event-stream' },
  })
}

describe('real MCP client handshake', () => {
  it('initializes, lists the todo tools and round-trips a create through the store', async () => {
    client = new Client({ name: 'spacecode-test-client', version: '1.0.0' })
    const entry = server.entry('session-live', 'D:/work/demo')
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers } }),
    )

    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name).sort()).toEqual([...TODO_MCP_TOOL_NAMES].sort())
    expect(client.getServerVersion()?.name).toBe('spacecode-todo')
    expect(client.getInstructions()).toContain('get_todo')

    const created = await client.callTool({
      name: 'create_todo',
      arguments: { title: '把握手跑通', notes: '真实 SDK 客户端建的', priority: 'high', dueAt: '+1h' },
    })
    expect(created.isError).toBeFalsy()
    const todo = JSON.parse((created.content as Array<{ text: string }>)[0].text)
    expect(todo.title).toBe('把握手跑通')
    expect(todo.sessionIds).toEqual(['session-live'])
    expect(todo.projectRoot).toBe('D:/work/demo')
    // 会话痕迹真的落到了 store，而不是只出现在工具返回值里
    expect(store.get(todo.id)!.sessionLinks[0].sessionId).toBe('session-live')

    const listed = await client.callTool({ name: 'list_todos', arguments: { status: 'open' } })
    expect(JSON.parse((listed.content as Array<{ text: string }>)[0].text).count).toBe(1)

    const completed = await client.callTool({ name: 'complete_todo', arguments: { id: todo.id } })
    expect(JSON.parse((completed.content as Array<{ text: string }>)[0].text).status).toBe('completed')
    expect(store.get(todo.id)!.status).toBe('completed')
  })

  it('reports a business failure as a tool error the model can read', async () => {
    client = new Client({ name: 'spacecode-test-client', version: '1.0.0' })
    const entry = server.entry(null)
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers } }),
    )
    const missing = await client.callTool({ name: 'get_todo', arguments: { id: 'ghost' } })
    expect(missing.isError).toBe(true)
    expect((missing.content as Array<{ text: string }>)[0].text).toContain('list_todos')
  })
})

describe('protocol envelope', () => {
  it('echoes a supported protocol version and falls back for an unknown one', async () => {
    const initialize = (protocolVersion: string) =>
      authed({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion, capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
      })
    const echoed = await initialize('2025-06-18')
    expect(echoed.status).toBe(200)
    expect(JSON.parse(echoed.body).result.protocolVersion).toBe('2025-06-18')
    expect(JSON.parse(echoed.body).result.capabilities.tools).toEqual({ listChanged: false })

    const fallback = await initialize('1999-01-01')
    expect(JSON.parse(fallback.body).result.protocolVersion).toBe('2025-11-25')
  })

  it('answers ping and rejects unknown methods', async () => {
    expect(JSON.parse((await authed({ jsonrpc: '2.0', id: 2, method: 'ping' })).body).result).toEqual({})
    const unknown = JSON.parse((await authed({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).body)
    expect(unknown.error.code).toBe(-32601)
  })

  it('accepts notifications with 202 and no body', async () => {
    const res = await authed({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
    expect(res.body).toBe('')
  })

  it('handles batches and drops notification-only batches', async () => {
    const batch = await authed([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ])
    const parsed = JSON.parse(batch.body)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
    expect(parsed[1].result.tools).toHaveLength(TODO_MCP_TOOL_NAMES.length)

    const onlyNotifications = await authed([{ jsonrpc: '2.0', method: 'notifications/cancelled' }])
    expect(onlyNotifications.status).toBe(202)
  })

  it('rejects malformed JSON and malformed requests', async () => {
    const broken = await raw(server.port, {
      body: '{not json',
      headers: { Authorization: `Bearer ${server.token}` },
    })
    expect(broken.status).toBe(400)
    expect(JSON.parse(broken.body).error.code).toBe(-32700)

    const invalid = JSON.parse((await authed({ id: 9, method: 'ping' })).body)
    expect(invalid.error.code).toBe(-32600)

    const noName = JSON.parse((await authed({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: {} })).body)
    expect(noName.error.code).toBe(-32602)
  })

  it('turns an unexpected dispatch throw into a readable tool error', async () => {
    const broken = createTodoMcpServer({
      dispatch: async (): Promise<McpToolResult> => {
        throw new Error('store exploded')
      },
    })
    await broken.start()
    try {
      const res = await raw(broken.port, {
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_todos' } }),
        headers: { Authorization: `Bearer ${broken.token}` },
      })
      expect(res.status).toBe(200)
      const result = JSON.parse(res.body).result
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('store exploded')
      // 外壳抽出去之后这句文案仍须一字不变：本票是 prefactor，模型可见行为零变化。
      expect(result.content[0].text).toContain('The todo tool failed unexpectedly:')
    } finally {
      await broken.stop()
    }
  })
})

describe('loopback guards', () => {
  it('requires the bearer token', async () => {
    expect((await raw(server.port, { body: '{}' })).status).toBe(401)
    expect(
      (await raw(server.port, { body: '{}', headers: { Authorization: 'Bearer wrong' } })).status,
    ).toBe(401)
    expect(
      (await raw(server.port, { body: '{}', headers: { Authorization: `Bearer ${server.token}x` } })).status,
    ).toBe(401)
    expect(
      (await raw(server.port, { body: '{}', headers: { Authorization: server.token } })).status,
    ).toBe(401)
  })

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const res = await raw(server.port, {
      body: '{}',
      headers: { Authorization: `Bearer ${server.token}`, Host: 'evil.example.com' },
    })
    expect(res.status).toBe(403)
    const withPort = await raw(server.port, {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      headers: { Authorization: `Bearer ${server.token}`, Host: `localhost:${server.port}` },
    })
    expect(withPort.status).toBe(200)
  })

  it('only serves POST on the mcp path', async () => {
    const headers = { Authorization: `Bearer ${server.token}` }
    expect((await raw(server.port, { method: 'GET', headers })).status).toBe(405)
    expect((await raw(server.port, { method: 'DELETE', headers })).status).toBe(405)
    expect((await raw(server.port, { path: '/admin', headers })).status).toBe(404)
    expect((await raw(server.port, { path: '/mcp/../../etc', headers })).status).toBe(404)
  })

  it('caps the request body', async () => {
    const res = await raw(server.port, {
      body: 'x'.repeat(1024 * 1024 + 1),
      headers: { Authorization: `Bearer ${server.token}` },
    })
    expect(res.status).toBe(413)
  })

  it('sends no CORS headers', async () => {
    const res = await authed({ jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('entry and lifecycle', () => {
  it('builds a session-scoped url and drops unsafe session ids', () => {
    const entry = server.entry('abc-123', 'D:/work/with space')
    expect(entry.type).toBe('http')
    expect(entry.url).toBe(`http://127.0.0.1:${server.port}/mcp/abc-123?root=D%3A%2Fwork%2Fwith%20space`)
    expect(entry.headers.Authorization).toBe(`Bearer ${server.token}`)
    expect(server.entry(null).url).toBe(`http://127.0.0.1:${server.port}/mcp`)
    expect(server.entry('../escape').url).toBe(`http://127.0.0.1:${server.port}/mcp`)
  })

  it('is idempotent on start and releases the port on stop', async () => {
    const port = server.port
    expect(await server.start()).toBe(port)
    await server.stop()
    expect(server.port).toBe(0)
    await expect(raw(port, { body: '{}' })).rejects.toThrow()
    await server.stop()
  })

  it('exposes the singleton entry only while it is listening', async () => {
    expect(getTodoMcpEntry('s1')).toBeNull()
    const started = await startTodoMcpServer(sessionId => service.forAgent(sessionId))
    expect(await startTodoMcpServer(sessionId => service.forAgent(sessionId))).toBe(started)

    const entry = getTodoMcpEntry('s1', 'D:/x')
    expect(entry?.url).toContain(`:${started.port}/mcp/s1`)

    const entryUrl = new URL(entry!.url)
    const res = await raw(started.port, {
      path: entryUrl.pathname + entryUrl.search,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_todo', arguments: { title: '单例建的' } },
      }),
      headers: { Authorization: entry!.headers.Authorization },
    })
    const todo = JSON.parse(JSON.parse(res.body).result.content[0].text)
    expect(store.get(todo.id)!.sessionLinks[0].sessionId).toBe('s1')
    expect(store.get(todo.id)!.projectRoot).toBe('D:/x')

    await stopTodoMcpServer()
    expect(getTodoMcpEntry('s1')).toBeNull()
  })
})