/**
 * 轻量级 MCP over stdio 客户端（JSON-RPC 2.0）— 专为 browser-use Python 进程设计。
 *
 * 对齐 cuaDriverMcpClient 的设计模式：启动 Python 子进程（运行 browser-use
 * bridge script）→ initialize 握手 → tools/list 能力发现 → tools/call 工具调用。
 *
 * 生命周期：start() → callTool() × N → stop()
 */
import { spawn, type ChildProcess } from 'child_process'
import { info, warn, error as logError } from './logger'
import type { McpToolResult } from '../src/types/computerUse'

/** JSON-RPC 2.0 请求/响应类型 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** 等待中的请求 */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/** MCP content part 类型 */
interface McpContentPart {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

/** MCP CallToolResult 结构 */
interface McpCallToolResult {
  content?: McpContentPart[]
  structuredContent?: Record<string, unknown> | null
  isError?: boolean
}

/** MCP Tool 信息 */
interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  [key: string]: unknown
}

/** MCP tools/list 响应 */
interface McpToolsListResult {
  tools: McpToolInfo[]
}

/** 默认工具调用超时（120 秒 — 浏览器任务通常较慢） */
const DEFAULT_TIMEOUT_MS = 120_000
/** MCP 初始化超时（30 秒 — Python 加载可能较慢） */
const INIT_TIMEOUT_MS = 30_000

export class BrowserUseMcpClient {
  private proc: ChildProcess | null = null
  private requestId = 0
  private pending = new Map<number, PendingRequest>()
  private buffer = ''
  private started = false

  /** 已发现的可调用工具列表 */
  private _tools: McpToolInfo[] = []

  /**
   * 启动 browser-use Python MCP 子进程并完成 initialize 握手。
   *
   * @param pythonPath Python 可执行文件路径
   * @param bridgeScriptPath browser-use bridge script 路径
   * @param env 子进程环境变量（包含 API Keys）
   */
  async start(
    pythonPath: string,
    bridgeScriptPath: string,
    env?: Record<string, string>,
  ): Promise<void> {
    if (this.started) return

    info('BrowserUseMcpClient', `Starting browser-use MCP: ${pythonPath} ${bridgeScriptPath}`)

    this.proc = spawn(pythonPath, [bridgeScriptPath, '--mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      windowsHide: true,
    })

    this.proc.stdout?.on('data', (data: Buffer) => this.onStdout(data))
    this.proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) warn('BrowserUseMcpClient', `browser-use stderr: ${text}`)
    })
    this.proc.on('error', (err) => {
      logError('BrowserUseMcpClient', `Process error: ${err.message}`)
    })
    this.proc.on('exit', (code, signal) => {
      info('BrowserUseMcpClient', `Process exited: code=${code} signal=${signal}`)
      this.handleProcessExit()
    })

    // 发送 initialize 请求
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'spacecode', version: '1.0.0' },
    }, INIT_TIMEOUT_MS)

    // 发送 initialized 通知
    this.sendNotification('notifications/initialized', {})

    // 获取 tools/list 进行能力发现
    await this.populateTools()

    this.started = true
    info('BrowserUseMcpClient', 'browser-use MCP session ready')
  }

  /** 从 tools/list 响应中获取可用工具列表 */
  private async populateTools(): Promise<void> {
    try {
      const result = await this.sendRequest('tools/list', {}, INIT_TIMEOUT_MS) as McpToolsListResult
      if (!result || !Array.isArray(result.tools)) return
      this._tools = result.tools
      info('BrowserUseMcpClient', `Discovered ${result.tools.length} tools: ${result.tools.map(t => t.name).join(', ')}`)
    } catch (e) {
      warn('BrowserUseMcpClient', `tools/list discovery failed: ${e}`)
    }
  }

  /** 获取已发现工具列表 */
  get tools(): McpToolInfo[] {
    return this._tools
  }

  /** 查询某工具是否存在 */
  hasTool(name: string): boolean {
    return this._tools.some(t => t.name === name)
  }

  /**
   * 调用 MCP 工具。
   *
   * @param name 工具名称（如 'browse', 'scrape', 'screenshot'）
   * @param args 工具参数
   * @param timeoutMs 超时时间（默认 120 秒）
   * @returns 扁平化后的工具调用结果
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<McpToolResult> {
    if (!this.started) {
      throw new Error('browser-use MCP session not started')
    }
    const mcpResult = await this.sendRequest(
      'tools/call',
      { name, arguments: args },
      timeoutMs,
    ) as McpCallToolResult
    return this.extractToolResult(mcpResult)
  }

  /** 是否已启动 */
  get isStarted(): boolean {
    return this.started
  }

  /** 优雅关闭 MCP 会话 */
  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false

    // 清理所有 pending 请求
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('browser-use session closed'))
    }
    this.pending.clear()

    if (this.proc) {
      try {
        this.proc.stdin?.end()
      } catch {
        // ignore
      }
      // 给进程 5 秒优雅退出（浏览器关闭可能较慢），超时则 kill
      await new Promise<void>((resolve) => {
        if (!this.proc) return resolve()
        const killTimer = setTimeout(() => {
          try {
            this.proc?.kill('SIGKILL')
          } catch {
            // ignore
          }
          resolve()
        }, 5_000)
        this.proc!.on('exit', () => {
          clearTimeout(killTimer)
          resolve()
        })
      })
      this.proc = null
    }
  }

  // ── 内部方法 ──────────────────────────────────────────────────

  /** 处理 stdout 数据，按行解析 JSON-RPC 消息 */
  private onStdout(data: Buffer): void {
    this.buffer += data.toString()
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          clearTimeout(pending.timeout)
          if (msg.error) {
            pending.reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`))
          } else {
            pending.resolve(msg.result)
          }
        }
      } catch {
        // 非 JSON 行（可能是日志），忽略
      }
    }
  }

  /** 发送 JSON-RPC 请求并等待响应 */
  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin || this.proc.killed) {
        reject(new Error('browser-use process not running'))
        return
      }
      const id = ++this.requestId
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`browser-use ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timeout })

      const json = JSON.stringify(request) + '\n'
      try {
        this.proc.stdin.write(json)
      } catch (e) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(new Error(`Failed to write to browser-use stdin: ${e}`))
      }
    })
  }

  /** 发送 JSON-RPC 通知（无需响应） */
  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.proc || !this.proc.stdin || this.proc.killed) return
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    }
    try {
      this.proc.stdin.write(JSON.stringify(notification) + '\n')
    } catch {
      // ignore
    }
  }

  /** 处理子进程意外退出 */
  private handleProcessExit(): void {
    this.started = false
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('browser-use process exited unexpectedly'))
    }
    this.pending.clear()
    this.proc = null
  }

  /**
   * 将 MCP CallToolResult 转换为扁平化的 McpToolResult。
   *
   * - content 中的 text parts → 拼接后尝试 JSON 解析
   * - content 中的 image parts → images + imageMimeTypes 数组
   * - structuredContent → 直接传递
   * - isError → 标记错误
   */
  private extractToolResult(mcpResult: McpCallToolResult | null | undefined): McpToolResult {
    const images: string[] = []
    const imageMimeTypes: string[] = []
    const textChunks: string[] = []
    const isError = mcpResult?.isError ?? false
    const structuredContent = mcpResult?.structuredContent ?? null

    for (const part of mcpResult?.content ?? []) {
      if (part.type === 'text' && part.text) {
        textChunks.push(part.text)
      } else if (part.type === 'image' && part.data) {
        images.push(part.data)
        imageMimeTypes.push(part.mimeType ?? '')
      }
    }

    let parsedData: unknown = null
    if (textChunks.length > 0) {
      const joined = textChunks.join('\n')
      const trimmed = joined.trim()
      try {
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          parsedData = JSON.parse(joined)
        } else {
          parsedData = joined
        }
      } catch {
        parsedData = joined
      }
    }

    return {
      data: parsedData,
      images,
      imageMimeTypes,
      structuredContent,
      isError,
    }
  }
}