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
 * 预打包内置 MCP 服务器：构建时已随安装包打入 <resources>/mcp-vendor/，
 * 运行时用打包内的 bun 执行预装的 server.js，无需联网下载。
 *
 * key = 内置预设 key（与渲染层 BUILTIN_MCP_PRESETS 的 key 对齐），
 * pkgPath = server.js 相对 <resources> 的路径。
 */
const BUNDLED_MCP_SERVERS: Record<string, { pkgPath: string }> = {
  // key 必须与 src/lib/builtinMcp.ts 的 preset key 一致。
  // 不能用 'computer-use'：那是 Claude Code 引擎保留名，外部 --mcp-config
  // 命中会直接 exit(1)。详见 builtinMcp.ts 的注释。
  'sc-computer-use': {
    pkgPath: join('mcp-vendor', 'node_modules', '@zavora-ai', 'computer-use-mcp', 'dist', 'server.js'),
  },
}

/**
 * 解析预打包 MCP 服务器的启动命令。
 * @returns { bunPath, serverPath } 或 null（预打包文件不存在，调用方应回退 npx）
 */
function resolveBundledMcpCommand(pkgRelPath: string): { bunPath: string; serverPath: string } | null {
  // 打包模式：resources/ 下含 engine/bin/bun 与 mcp-vendor/
  // 开发模式：回退到项目根（需先跑 npm run copy-mcp-vendor 与 copy-bun）
  const resourcesPath = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..')
  const bunName = process.platform === 'win32' ? 'bun.exe' : 'bun'
  const bunPath = join(resourcesPath, 'engine', 'bin', bunName)
  const serverPath = join(resourcesPath, pkgRelPath)
  if (existsSync(bunPath) && existsSync(serverPath)) {
    return { bunPath, serverPath }
  }
  return null
}

/**
 * 历史 key → 当前 key 的别名映射（与 src/lib/builtinMcp.ts 的
 * DEPRECATED_BUILTIN_KEY_ALIASES 保持一致）。
 *
 * 主进程在 buildEnabledMcpConfig 里读 mcp-servers.json 时，磁盘上可能还
 * 残留旧 key（渲染层 syncBuiltinServers 的迁移尚未触发或尚未写回）。
 * 这里在生成 CLI 配置时把旧 key 重命名为新 key，避免旧 key（如
 * 'computer-use'，Claude Code 引擎保留名）直接传给 --mcp-config 导致
 * CLI 启动即 exit(1)。磁盘上的持久化清理仍由渲染层负责。
 */
const DEPRECATED_KEY_ALIASES: Record<string, string> = {
  'computer-use': 'sc-computer-use',
}

/**
 * 加载所有「启用」的 MCP 服务器，转换成 CLI `--mcp-config` 可用的格式。
 *
 * - 跳过 `enabled === false` 的服务器（包括内置但未开启的预设）。
 * - 跳过缺 command 或 url 的非法配置（避免 schema 校验失败导致 CLI 启动失败）。
 * - 跳过 `_source === 'claude.json'`：这些来自 ~/.claude.json，由 CLI 自己发现，
 *   不需要、也不应该通过 --mcp-config 重复注入。
 * - 旧 key 按 DEPRECATED_KEY_ALIASES 重命名为新 key，避免命中引擎保留名。
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
      // 旧 key → 新 key（避免 'computer-use' 等保留名直接传给 CLI）
      const resolvedName = DEPRECATED_KEY_ALIASES[name] ?? name
      // 预打包内置服务器：优先用打包内的 bun + 预装 server.js，路径缺失则回退 npx
      const bundled = server._source === BUILTIN_SOURCE ? BUNDLED_MCP_SERVERS[resolvedName] : undefined
      if (bundled) {
        const resolved = resolveBundledMcpCommand(bundled.pkgPath)
        if (resolved) {
          cliConfig.command = resolved.bunPath
          cliConfig.args = ['run', resolved.serverPath]
          delete cliConfig.env
        }
      }
      mcpServers[resolvedName] = cliConfig
    }
  }

  if (Object.keys(mcpServers).length === 0) return null
  return { mcpServers }
}

export { BUILTIN_SOURCE }
