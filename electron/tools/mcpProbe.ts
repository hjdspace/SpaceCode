/**
 * MCP Server Probe — 直接探测 MCP 服务器连通性，不依赖 engine session。
 *
 * 对 stdio 类型：spawn 进程 → initialize → tools/list → kill
 * 对 SSE/HTTP 类型：尝试 HTTP 连接（有限支持）
 */

import { spawn, ChildProcess } from 'child_process'
import { isAbsolute } from 'path'
import { info, warn } from './logger'

export interface McpProbeConfig {
  type: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface McpProbeTool {
  name: string
  description?: string
}

export interface McpProbeResult {
  status: 'connected' | 'failed'
  serverInfo?: { name: string; version: string }
  tools?: McpProbeTool[]
  error?: string
}

/**
 * 探测一个 MCP 服务器，返回连接状态和工具列表。
 * 超时默认 15 秒。
 */
export async function probeMcpServer(
  config: McpProbeConfig,
  timeoutMs = 15_000,
): Promise<McpProbeResult> {
  if (config.type === 'sse') {
    return probeSse(config, timeoutMs)
  }
  if (config.type === 'http') {
    return probeHttp(config, timeoutMs)
  }
  // 默认 stdio
  if (config.command) {
    return probeStdio(config, timeoutMs)
  }
  return { status: 'failed', error: 'No command or URL configured' }
}

// ── stdio 探测 ──────────────────────────────────────────────────────

function probeStdio(
  config: McpProbeConfig,
  timeoutMs: number,
): Promise<McpProbeResult> {
  return new Promise((resolve) => {
    let proc: ChildProcess | null = null
    let buffer = ''
    let settled = false
    let initResponseReceived = false
    let stderrBuffer = ''

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        cleanup()
        resolve({ status: 'failed', error: 'Connection timed out' })
      }
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      if (proc && !proc.killed) {
        try { proc.kill() } catch { /* already dead */ }
      }
    }

    function settle(result: McpProbeResult) {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    try {
      const env = { ...process.env, ...(config.env || {}) }
      const cmd = config.command!
      // 绝对路径直接执行，不走 shell — 避免 cmd.exe 对含空格/特殊字符
      // 的路径做错误引号处理；裸命令名（如 npx/uvx）仍走 shell 解析 PATH。
      const useShell = !isAbsolute(cmd)
      proc = spawn(cmd, config.args || [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: useShell,
        windowsHide: true,
      })

      proc.on('error', (err) => {
        settle({ status: 'failed', error: `Failed to start: ${err.message}` })
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString()
      })

      proc.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            handleJsonRpcMessage(JSON.parse(line))
          } catch {
            // 非 JSON 行，忽略
          }
        }
      })

      proc.on('exit', (code) => {
        if (!settled) {
          const stderrTail = stderrBuffer.trim()
          const detail = stderrTail
            ? `: ${stderrTail.split(/\r?\n/).slice(-3).join(' | ')}`
            : ''
          settle({
            status: 'failed',
            error: `Process exited with code ${code} before responding${detail}`,
          })
        }
      })

      // 1) 发送 initialize
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'spacecode-mcp-probe', version: '0.1.0' },
        },
      })
    } catch (err) {
      settle({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // ── JSON-RPC 消息处理 ──

    function send(msg: object) {
      proc?.stdin?.write(JSON.stringify(msg) + '\n')
    }

    function handleJsonRpcMessage(msg: any) {
      // initialize 响应
      if (msg.id === 1 && msg.result) {
        initResponseReceived = true
        const serverInfo = msg.result.serverInfo
        // 2) 发送 initialized 通知
        send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        // 3) 请求 tools/list
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
        // 暂存 serverInfo 供后续使用
        ;(proc as any).__serverInfo = serverInfo
          ? { name: serverInfo.name || '', version: serverInfo.version || '' }
          : undefined
        return
      }

      // tools/list 响应
      if (msg.id === 2 && msg.result) {
        const tools: McpProbeTool[] = (msg.result.tools || []).map((t: any) => ({
          name: t.name,
          description: t.description || undefined,
        }))
        settle({
          status: 'connected',
          serverInfo: (proc as any).__serverInfo,
          tools,
        })
        return
      }

      // 错误响应
      if (msg.error) {
        settle({
          status: 'failed',
          error: msg.error.message || `JSON-RPC error code ${msg.error.code}`,
        })
      }
    }
  })
}

// ── SSE / HTTP 探测 ─────────────────────────────────────────────────

/**
 * 探测 SSE 类型服务器：发送 GET + Accept: text/event-stream。
 */
async function probeSse(
  config: McpProbeConfig,
  timeoutMs: number,
): Promise<McpProbeResult> {
  if (!config.url) {
    return { status: 'failed', error: 'No URL configured' }
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      ...(config.headers || {}),
    }

    const response = await fetch(config.url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (response.ok) {
      return {
        status: 'connected',
        tools: [],
      }
    }
    return { status: 'failed', error: `HTTP ${response.status} ${response.statusText}` }
  } catch (err) {
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 探测 HTTP 类型服务器（Streamable HTTP transport）。
 *
 * MCP Streamable HTTP transport 要求：
 * - POST 请求，Content-Type: application/json
 * - Body 为 JSON-RPC 2.0 消息
 * - 服务器可能返回 application/json 或 text/event-stream
 *
 * 探测流程：发送 initialize → 解析响应 → 发送 tools/list → 解析工具列表
 */
async function probeHttp(
  config: McpProbeConfig,
  timeoutMs: number,
): Promise<McpProbeResult> {
  if (!config.url) {
    return { status: 'failed', error: 'No URL configured' }
  }

  const baseUrl = config.url
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(config.headers || {}),
  }

  try {
    // Step 1: 发送 initialize 请求
    const initResult = await mcpHttpPost(baseUrl, baseHeaders, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'spacecode-mcp-probe', version: '0.1.0' },
      },
    }, timeoutMs)

    if (!initResult.ok) {
      return { status: 'failed', error: `HTTP ${initResult.status} ${initResult.statusText}` }
    }

    const initMsg = initResult.message
    if (!initMsg || initMsg.error) {
      return {
        status: 'failed',
        error: initMsg?.error?.message || 'Invalid initialize response',
      }
    }

    const serverInfo = initMsg.result?.serverInfo
      ? { name: initMsg.result.serverInfo.name || '', version: initMsg.result.serverInfo.version || '' }
      : undefined

    // Step 2: 发送 initialized 通知（无响应）
    await mcpHttpPost(baseUrl, baseHeaders, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, 5_000).catch(() => { /* 通知无响应，忽略错误 */ })

    // Step 3: 发送 tools/list 请求
    const toolsResult = await mcpHttpPost(baseUrl, baseHeaders, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, timeoutMs)

    if (!toolsResult.ok || !toolsResult.message || toolsResult.message.error) {
      // tools/list 失败但 initialize 成功，仍视为已连接
      return {
        status: 'connected',
        serverInfo,
        tools: [],
      }
    }

    const tools: McpProbeTool[] = (toolsResult.message.result?.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || undefined,
    }))

    return {
      status: 'connected',
      serverInfo,
      tools,
    }
  } catch (err) {
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 发送 MCP JSON-RPC POST 请求并解析响应。
 *
 * Streamable HTTP transport 的响应可能是：
 * - application/json：直接 JSON-RPC 响应
 * - text/event-stream：SSE 格式，每行 data: <json>
 */
async function mcpHttpPost(
  url: string,
  headers: Record<string, string>,
  body: object,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; statusText: string; message: any | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!response.ok) {
      return { ok: false, status: response.status, statusText: response.statusText, message: null }
    }

    const contentType = response.headers.get('content-type') || ''
    const text = await response.text()

    let message: any = null

    if (contentType.includes('text/event-stream')) {
      // SSE 格式：解析 data: 行
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data:')) {
          try {
            message = JSON.parse(trimmed.slice(5).trim())
            break
          } catch {
            // 忽略解析失败的行
          }
        }
      }
    } else {
      // JSON 格式
      try {
        message = JSON.parse(text)
      } catch {
        // 非 JSON 响应
      }
    }

    return { ok: true, status: response.status, statusText: response.statusText, message }
  } finally {
    clearTimeout(timer)
  }
}
