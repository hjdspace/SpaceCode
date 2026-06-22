/**
 * 共享的 MCP 配置存储访问层。
 *
 * 历史：MCP 服务器配置原本只在 claudeCodeIPC.ts 中维护，仅供 UI 通过 IPC
 * 增删改查。但 buildArgs() 也需要在 spawn claude-code CLI 之前读取这份
 * 配置并通过 `--mcp-config <file>` 注入进去，否则用户在 UI 上启用的
 * MCP 服务器在对话里完全不可用。
 *
 * 把 MCP_CONFIG_PATH / loadMcpConfig 提到这个共享模块里，让两个调用方
 * （IPC handler + sessionProcess buildArgs）共用同一份解析逻辑。
 */
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { warn, error as logError } from './logger'

/** 内置 MCP 服务器的来源标记，与渲染层 BUILTIN_MCP_SOURCE 保持一致 */
const BUILTIN_SOURCE = 'builtin'

/** MCP 服务器在持久化文件中可能携带的额外元字段（仅供 SpaceCode 内部使用） */
export interface PersistedMcpServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
  type?: 'stdio' | 'sse' | 'http'
  url?: string
  headers?: Record<string, string>
  /** SpaceCode 内部来源标记：'settings.json' | 'builtin' | 'claude.json' */
  _source?: string
  /** 仅 store 侧需要的 id / name，文件里也可能持久化，写入 CLI 配置前必须剔除 */
  id?: string
  name?: string
  [key: string]: unknown
}

/** 写入 CLI `--mcp-config` 文件时使用的纯净格式（去掉所有元字段） */
export interface McpJsonConfig {
  mcpServers: Record<string, {
    type?: 'stdio' | 'sse' | 'http'
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
  }>
}

/** 持久化文件路径：<userData>/mcp-servers.json */
export const MCP_CONFIG_PATH = join(app.getPath('userData'), 'mcp-servers.json')

/**
 * 从磁盘加载 MCP 配置。
 *
 * 兼容两种格式：
 * 1. 扁平：`{ "<name>": { command, args, ... } }`
 * 2. Claude Desktop 嵌套：`{ "mcpServers": { "<name>": {...} } }`
 *
 * 返回扁平后的 Record；任何错误都吃掉并返回 `{}`，避免阻塞会话启动。
 */
export function loadMcpConfig(): Record<string, PersistedMcpServer> {
  try {
    if (!existsSync(MCP_CONFIG_PATH)) return {}
    const raw = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8'))
    if (
      raw && typeof raw === 'object' &&
      raw.mcpServers && typeof raw.mcpServers === 'object' &&
      !raw.command && !raw.type
    ) {
      return raw.mcpServers as Record<string, PersistedMcpServer>
    }
    return raw as Record<string, PersistedMcpServer>
  } catch (e) {
    warn('McpConfigStore', `Failed to load config: ${e}`)
    return {}
  }
}

/** 写回 MCP 配置文件（覆盖式） */
export function saveMcpConfig(data: Record<string, PersistedMcpServer>): void {
  try {
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    logError('McpConfigStore', `Failed to save config: ${e}`)
    throw e
  }
}

/**
 * 从 PersistedMcpServer 形态转换成 CLI `--mcp-config` 文件期望的纯净 schema。
 *
 * 去掉的元字段：id / name / enabled / _source / 任何不在 schema 里的键。
 * 字段映射严格遵循 engine/src/services/mcp/types.ts 中的 schema：
 *   - stdio: { type?: 'stdio', command, args?, env? }
 *   - sse/http: { type, url, headers? }
 */
function toCliMcpServerConfig(server: PersistedMcpServer): McpJsonConfig['mcpServers'][string] | null {
  const type = (server.type || 'stdio') as 'stdio' | 'sse' | 'http'
  if (type === 'stdio') {
    if (!server.command) return null
    const config: McpJsonConfig['mcpServers'][string] = {
      type: 'stdio',
      command: server.command,
    }
    if (server.args && server.args.length > 0) config.args = server.args
    if (server.env && Object.keys(server.env).length > 0) config.env = server.env
    return config
  }
  // sse / http 走 URL
  if (!server.url) return null
  const config: McpJsonConfig['mcpServers'][string] = {
    type,
    url: server.url,
  }
  if (server.headers && Object.keys(server.headers).length > 0) config.headers = server.headers
  return config
}

/**
 * 加载所有「启用」的 MCP 服务器，转换成 CLI `--mcp-config` 可用的格式。
 *
 * - 跳过 `enabled === false` 的服务器（包括内置但未开启的预设）。
 * - 跳过缺 command 或 url 的非法配置（避免 schema 校验失败导致 CLI 启动失败）。
 * - 跳过 `_source === 'claude.json'`：这些来自 ~/.claude.json，由 CLI 自己发现，
 *   不需要、也不应该通过 --mcp-config 重复注入。
 *
 * @returns `null` 表示没有任何启用的服务器，调用方应跳过 `--mcp-config` 参数
 */
export function buildEnabledMcpConfig(): McpJsonConfig | null {
  const raw = loadMcpConfig()
  const mcpServers: McpJsonConfig['mcpServers'] = {}

  for (const [name, server] of Object.entries(raw)) {
    if (!server || typeof server !== 'object') continue
    if (server.enabled === false) continue
    if (server._source === 'claude.json') continue
    const cliConfig = toCliMcpServerConfig(server)
    if (cliConfig) {
      mcpServers[name] = cliConfig
    }
  }

  if (Object.keys(mcpServers).length === 0) return null
  return { mcpServers }
}

export { BUILTIN_SOURCE }
