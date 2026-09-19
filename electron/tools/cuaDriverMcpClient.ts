/**
 * 轻量级 MCP over stdio 客户端（JSON-RPC 2.0）。
 *
 * 不引入 `@modelcontextprotocol/sdk` 依赖，对齐 hermes-agent 的
 * `_CuaDriverSession` 设计：启动 cua-driver 子进程 → initialize 握手 →
 * tools/list 能力发现 → tools/call 工具调用。
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
  capabilities?: string[]
  [key: string]: unknown
}

/** MCP tools/list 响应 */
interface McpToolsListResult {
  tools: McpToolInfo[]
  capability_version?: string
}

/** 默认工具调用超时（30 秒） */
const DEFAULT_TIMEOUT_MS = 30_000
/** MCP 初始化超时（15 秒） */
const INIT_TIMEOUT_MS = 15_000

export class CuaDriverMcpClient {
  private proc: ChildProcess | null = null
  private requestId = 0
  private pending = new Map<number, PendingRequest>()
  private buffer = ''
  private started = false

  /** 每个工具的 capability 集合（从 tools/list 获取） */
  private capabilities = new Map<string, Set<string>>()
  /** capability 版本号 */
  private _capabilityVersion = ''

  /**
   * 启动 cua-driver MCP 子进程并完成 initialize 握手。
   *
   * @param binaryPath cua-driver 二进制路径
   * @param env 子进程环境变量
   */
  async start(binaryPath: string, env?: Record<string, string>): Promise<void> {
    if (this.started) return

    // 先尝试 manifest 获取 MCP 启动参数，回退到 ['mcp']
    const { command, args } = await this.resolveMcpInvocation(binaryPath, env)

    info('CuaDriverMcpClient', `Starting cua-driver MCP: ${command} ${args.join(' ')}`)

    this.proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      windowsHide: true,
    })

    this.proc.stdout?.on('data', (data: Buffer) => this.onStdout(data))
    this.proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) warn('CuaDriverMcpClient', `cua-driver stderr: ${text}`)
    })
    this.proc.on('error', (err) => {
      logError('CuaDriverMcpClient', `Process error: ${err.message}`)
    })
    this.proc.on('exit', (code, signal) => {
      info('CuaDriverMcpClient', `Process exited: code=${code} signal=${signal}`)
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
    await this.populateCapabilities()

    this.started = true
    info('CuaDriverMcpClient', 'cua-driver MCP session ready')
  }

  /** 查询 cua-driver manifest 获取 MCP 启动参数 */
  private async resolveMcpInvocation(
    binaryPath: string,
    env?: Record<string, string>,
  ): Promise<{ command: string; args: string[] }> {
    try {
      const { execFile } = await import('child_process')
      const result = await new Promise<string>((resolve, reject) => {
        execFile(
          binaryPath,
          ['manifest'],
          { timeout: 6_000, env: { ...process.env, ...env } },
          (err, stdout) => {
            if (err) reject(err)
            else resolve(stdout.trim())
          },
        )
      })
      if (result) {
        const manifest = JSON.parse(result)
        const invocation = manifest?.mcp_invocation
        if (
          invocation &&
          Array.isArray(invocation.args) &&
          invocation.args.every((a: unknown) => typeof a === 'string')
        ) {
          const command = typeof invocation.command === 'string' && invocation.command
            ? invocation.command
            : binaryPath
          return { command, args: invocation.args as string[] }
        }
      }
    } catch {
      // manifest 不可用（旧版驱动），回退到 ['mcp']
    }
    return { command: binaryPath, args: ['mcp'] }
  }

  /** 从 tools/list 响应中缓存每个工具的 capability 集合 */
  private async populateCapabilities(): Promise<void> {
    try {
      const result = await this.sendRequest('tools/list', {}, INIT_TIMEOUT_MS) as McpToolsListResult
      if (!result || !Array.isArray(result.tools)) return

      for (const tool of result.tools) {
        if (typeof tool.name !== 'string') continue
        const caps = Array.isArray(tool.capabilities)
          ? new Set(tool.capabilities.filter((c): c is string => typeof c === 'string'))
          : new Set<string>()
        this.capabilities.set(tool.name, caps)
      }

      if (typeof result.capability_version === 'string') {
        this._capabilityVersion = result.capability_version
      }
    } catch (e) {
      warn('CuaDriverMcpClient', `tools/list capability discovery failed: ${e}`)
    }
  }

  /**
   * 调用 MCP 工具。
   *
   * @param name 工具名称（如 'health_report', 'click', 'screenshot'）
   * @param args 工具参数
   * @param timeoutMs 超时时间（默认 30 秒）
   * @returns 扁平化后的工具调用结果
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<McpToolResult> {
    if (!this.started) {
      throw new Error('cua-driver MCP session not started')
    }
    const mcpResult = await this.sendRequest(
      'tools/call',
      { name, arguments: args },
      timeoutMs,
    ) as McpCallToolResult
    return this.extractToolResult(mcpResult)
  }

  /** 查询某工具是否支持指定 capability */
  supportsCapability(capability: string, tool?: string): boolean {
    if (tool) {
      return this.capabilities.get(tool)?.has(capability) ?? false
    }
    for (const caps of this.capabilities.values()) {
      if (caps.has(capability)) return true
    }
    return false
  }

  /** 查询某工具是否存在 */
  hasTool(name: string): boolean {
    return this.capabilities.has(name)
  }

  /** 获取 capability 版本号 */
  get capabilityVersion(): string {
    return this._capabilityVersion
  }

  /** 是否已完成能力发现 */
  get capabilitiesDiscovered(): boolean {
    return this.capabilities.size > 0
  }

  /** 优雅关闭 MCP 会话 */
  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false

    // 清理所有 pending 请求
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('cua-driver session closed'))
    }
    this.pending.clear()

    if (this.proc) {
      try {
        this.proc.stdin?.end()
      } catch {
        // ignore
      }
      // 给进程 3 秒优雅退出，超时则 kill
      await new Promise<void>((resolve) => {
        if (!this.proc) return resolve()
        const killTimer = setTimeout(() => {
          try {
            this.proc?.kill('SIGKILL')
          } catch {
            // ignore
          }
          resolve()
        }, 3_000)
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
        reject(new Error('cua-driver process not running'))
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
        reject(new Error(`cua-driver ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timeout })

      const json = JSON.stringify(request) + '\n'
      try {
        this.proc.stdin.write(json)
      } catch (e) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(new Error(`Failed to write to cua-driver stdin: ${e}`))
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
      pending.reject(new Error('cua-driver process exited unexpectedly'))
    }
    this.pending.clear()
    this.proc = null
  }

  /**
   * 将 MCP CallToolResult 转换为扁平化的 McpToolResult。
   *
   * 对齐 hermes-agent 的 `_extract_tool_result`：
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
