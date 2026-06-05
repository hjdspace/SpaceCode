/**
 * MCP Server Probe — 直接探测 MCP 服务器连通性，不依赖 engine session。
 *
 * 对 stdio 类型：spawn 进程 → initialize → tools/list → kill
 * 对 SSE/HTTP 类型：尝试 HTTP 连接（有限支持）
 */

import { spawn, ChildProcess } from 'child_process'
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
  if (config.type === 'sse' || config.type === 'http') {
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
      proc = spawn(config.command!, config.args || [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      })

      proc.on('error', (err) => {
        settle({ status: 'failed', error: `Failed to start: ${err.message}` })
      })

      proc.stderr?.on('data', () => { /* drain */ })

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
          settle({
            status: 'failed',
            error: `Process exited with code ${code} before responding`,
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

// ── SSE / HTTP 探测（有限） ──────────────────────────────────────────

async function probeHttp(
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
