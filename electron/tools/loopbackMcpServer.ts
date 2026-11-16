/**
 * 应用内置 MCP 服务器的通用 loopback HTTP 外壳。
 *
 * 形态是 Streamable HTTP，监听 127.0.0.1 的随机端口：两个引擎都支持
 * `type: 'http'` 的 MCP 条目（Claude 走 --mcp-config，pi 走 ~/.pi/agent/mcp.json），
 * 而 stdio 形态需要额外落一个可执行脚本并在打包里带上它，成本更高。
 *
 * 无会话状态：每个 POST 独立处理，不下发 Mcp-Session-Id，也不开服务端推流。
 *
 * 业务面由调用方注入（工具表 + dispatch），外壳只管协议与入口安全。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { info, warn } from '../infra/logger'

/** 与 MCP 规范同步；客户端要求哪个版本就回哪个，不认识时回落到最新。 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

const SESSION_PATH_PATTERN = /^\/mcp(?:\/([A-Za-z0-9_-]{1,128}))?$/
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const MAX_BODY_BYTES = 1024 * 1024

export interface LoopbackMcpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** MCP tools/call 的返回形态（只用到 text content，宿主两个引擎都认这一种）。 */
export interface LoopbackMcpToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** 一次调用的上下文：会话 id 走路径，工作区走查询串。 */
export interface LoopbackMcpContext {
  sessionId: string | null
  projectRoot: string | null
}

export interface LoopbackMcpServerOptions {
  serverKey: string
  instructions: string
  logTag: string
  tools: LoopbackMcpToolDefinition[]
  dispatch: (context: LoopbackMcpContext, name: string, args: unknown) => Promise<LoopbackMcpToolResult>
  /** 工具意外抛错时回给模型的文案前缀；默认不点名业务，由各服务器注入自己的措辞。 */
  unexpectedErrorPrefix?: string
  token?: string
  host?: string
  version?: string
}

/** 直接喂给两个引擎的 MCP 条目形态（PersistedMcpServer 的 http 子集）。 */
export type LoopbackMcpEntry = {
  type: 'http'
  url: string
  headers: Record<string, string>
}

export interface LoopbackMcpServer {
  readonly token: string
  readonly port: number
  start(): Promise<number>
  stop(): Promise<void>
  entry(sessionId: string | null, projectRoot?: string | null): LoopbackMcpEntry
}

interface JsonRpcMessage {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: unknown; result: unknown }
  | { jsonrpc: '2.0'; id: unknown; error: { code: number; message: string } }

function rpcResult(id: unknown, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: unknown, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function tokenMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  // 长度不同直接拒：timingSafeEqual 对不等长入参会抛。长度本身不是秘密。
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // 只暂停不 destroy：销毁 socket 会让 413 发不出去，客户端只看到连接被重置。
        req.pause()
        reject(new Error('body-too-large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

export function createLoopbackMcpServer(options: LoopbackMcpServerOptions): LoopbackMcpServer {
  const host = options.host ?? '127.0.0.1'
  const token = options.token ?? randomBytes(32).toString('base64url')
  const version = options.version ?? '1.0.0'
  let server: Server | null = null
  let port = 0

  async function handleRequest(message: JsonRpcMessage, context: LoopbackMcpContext): Promise<JsonRpcResponse | null> {
    const method = typeof message.method === 'string' ? message.method : ''
    const isNotification = message.id === undefined || message.id === null
    if (message.jsonrpc !== '2.0' || !method) {
      return isNotification ? null : rpcError(message.id ?? null, -32600, 'Invalid JSON-RPC 2.0 request')
    }
    if (isNotification) return null
    const params: Record<string, unknown> =
      message.params && typeof message.params === 'object' && !Array.isArray(message.params)
        ? (message.params as Record<string, unknown>)
        : {}

    switch (method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        return rpcResult(message.id, {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.serverKey, version },
          instructions: options.instructions,
        })
      }
      case 'ping':
        return rpcResult(message.id, {})
      case 'tools/list':
        return rpcResult(message.id, { tools: options.tools })
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : ''
        if (!name) return rpcError(message.id, -32602, 'tools/call requires a tool name')
        try {
          return rpcResult(message.id, await options.dispatch(context, name, params.arguments))
        } catch (err) {
          // 工具层自己会把业务失败包成 isError；走到这里说明是意外异常，
          // 仍然回 isError 让模型看得见原因，而不是整条 JSON-RPC 通道报错。
          warn(options.logTag, `Tool ${name} threw`, { error: String(err) })
          return rpcResult(message.id, {
            content: [
              {
                type: 'text',
                text: `${options.unexpectedErrorPrefix ?? 'The tool failed unexpectedly'}: ${String(err)}`,
              },
            ],
            isError: true,
          })
        }
      }
      default:
        return rpcError(message.id, -32601, `Unsupported method "${method}"`)
    }
  }

  function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    })
    res.end(body)
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}`)
    const match = SESSION_PATH_PATTERN.exec(url.pathname)
    if (!match) {
      sendJson(res, 404, { error: 'Not found' })
      return
    }

    // DNS rebinding：浏览器可以把任意域名解析到 127.0.0.1，Host 头会露出真实来源。
    const requestHost = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (!ALLOWED_HOSTS.has(requestHost)) {
      sendJson(res, 403, { error: 'Forbidden host' })
      return
    }

    const auth = req.headers.authorization ?? ''
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!provided || !tokenMatches(token, provided)) {
      sendJson(res, 401, { error: 'Unauthorized' })
      return
    }

    if (req.method !== 'POST') {
      // 不支持服务端推流，也不维护会话，GET/DELETE 都没有语义。
      res.writeHead(405, { Allow: 'POST' })
      res.end()
      return
    }

    const context: LoopbackMcpContext = {
      sessionId: match[1] ?? null,
      projectRoot: url.searchParams.get('root'),
    }

    let rawBody: string
    try {
      rawBody = await readBody(req)
    } catch {
      // 请求体没读完就回绝，Connection: close 让 Node 在响应发完后收掉连接。
      res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' })
      res.end(JSON.stringify({ error: 'Request body too large' }))
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      sendJson(res, 400, rpcError(null, -32700, 'Parse error'))
      return
    }
    // 2025-03-26 允许批量请求，之后的版本取消了；两种都收下，成本只有几行。
    const batch = Array.isArray(parsed) ? parsed : [parsed]
    const responses: JsonRpcResponse[] = []
    for (const item of batch) {
      const response = await handleRequest((item ?? {}) as JsonRpcMessage, context)
      if (response) responses.push(response)
    }
    if (responses.length === 0) {
      res.writeHead(202)
      res.end()
      return
    }
    sendJson(res, 200, Array.isArray(parsed) ? responses : responses[0])
  }

  return {
    token,
    get port() {
      return port
    },
    start() {
      if (server) return Promise.resolve(port)
      return new Promise<number>((resolve, reject) => {
        const created = createServer((req, res) => {
          void route(req, res).catch(err => {
            warn(options.logTag, 'Request failed', { error: String(err) })
            if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' })
            else res.end()
          })
        })
        created.on('error', err => {
          warn(options.logTag, 'Server error', { error: String(err) })
          if (server === created) {
            server = null
            port = 0
          }
          reject(err)
        })
        created.listen(0, host, () => {
          const address = created.address()
          port = typeof address === 'object' && address ? address.port : 0
          server = created
          info(options.logTag, `Listening | host=${host} | port=${port}`)
          resolve(port)
        })
      })
    },
    stop() {
      const current = server
      server = null
      port = 0
      if (!current) return Promise.resolve()
      return new Promise<void>(resolve => {
        current.close(() => resolve())
        // keep-alive 与在途请求会让 close() 一直等下去，退出时不能卡在这里。
        current.closeAllConnections()
      })
    },
    entry(sessionId, projectRoot) {
      const suffix = sessionId && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? `/${sessionId}` : ''
      const query = projectRoot ? `?root=${encodeURIComponent(projectRoot)}` : ''
      return {
        type: 'http',
        url: `http://${host}:${port}/mcp${suffix}${query}`,
        headers: { Authorization: `Bearer ${token}` },
      }
    },
  }
}
