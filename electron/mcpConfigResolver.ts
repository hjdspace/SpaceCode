/**
 * 内置 MCP 服务器配置解析器（深模块）。
 *
 * cua-driver 和 browser-use 是两个特殊的内置 MCP 服务器，它们的实际启动路径
 * 不在 mcp-servers.json 里，而是运行时动态解析：
 * - cua-driver：原生 Rust 二进制，安装路径不在系统 PATH 里（安装脚本创建的
 *   junction/symlink 可能尚未被 Electron 进程的 PATH 缓存感知），需要
 *   findCuaDriverBinary() 解析绝对路径
 * - browser-use：Python MCP 服务（bridge.py --mcp），需要 Python 3.11+ 和
 *   browser-use 包，存储的 config 是相对路径（python bridge.py --mcp）
 *
 * 这份解析逻辑在两处需要保持一致：
 * 1. mcp:probeServer IPC handler — 探测时需要解析实际路径
 * 2. buildEnabledMcpConfig — 注入 CLI --mcp-config 时需要解析实际路径
 *
 * 抽出前，两处各自维护一份副本，靠注释提醒"与 mcpConfigStore 保持一致"。
 * 抽出后，两者共享同一个深模块，消除口头契约。
 */
import type { McpProbeConfig } from './mcpProbe'
import { findCuaDriverBinary } from './cuaDriverService'
import { getBrowserUseMcpServerConfig } from './browserUseService'
import { debug } from './logger'

/** 内置 MCP 服务器的规范名称 */
export type BuiltinMcpName = 'cua-driver' | 'browser-use'

/** 解析后的启动配置 */
export interface ResolvedMcpConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** 解析结果：成功返回 config，失败返回用户可读的错误信息 */
export type BuiltinMcpResolution =
  | { status: 'resolved'; config: ResolvedMcpConfig }
  | { status: 'missing'; error: string }

/**
 * 从探测配置的 command/args 模式检测是否匹配内置 MCP 服务器。
 *
 * 用于 mcp:probeServer handler —— 此时只有原始 config，没有服务器名称 key。
 *
 * - cua-driver: config.command === 'cua-driver'
 * - browser-use: command 为 python/python3 且 args 含 bridge.py
 */
export function detectBuiltinFromConfig(
  config: Pick<McpProbeConfig, 'type' | 'command' | 'args' | 'url'>,
): BuiltinMcpName | null {
  if (config.command === 'cua-driver') {
    return 'cua-driver'
  }

  if (
    config.type === 'stdio' &&
    config.command &&
    (config.command === 'python' || config.command === 'python3') &&
    config.args &&
    config.args.some(
      (a) => a === 'bridge.py' || a.endsWith('/bridge.py') || a.endsWith('\\bridge.py'),
    )
  ) {
    return 'browser-use'
  }

  return null
}

/**
 * 从持久化的服务器名称 key 映射到内置 MCP 规范名称。
 *
 * 用于 buildEnabledMcpConfig —— 此时服务器名称 key 已知。
 *
 * - 'sc-computer-use' → 'cua-driver'
 * - 'browser-use' → 'browser-use'
 */
export function builtinNameFromServerKey(key: string): BuiltinMcpName | null {
  if (key === 'sc-computer-use') return 'cua-driver'
  if (key === 'browser-use') return 'browser-use'
  return null
}

/**
 * 解析内置 MCP 服务器的实际启动配置。
 *
 * 返回:
 * - `{ status: 'resolved', config }` — 依赖已安装，返回绝对路径配置
 * - `{ status: 'missing', error }` — 依赖缺失，返回用户可读的错误提示
 *
 * 调用方自行决定缺失时的行为：
 * - probe handler：直接返回失败
 * - buildEnabledMcpConfig：保留原始命令，让 CLI 启动时自行失败（不影响其他服务器）
 */
export function resolveBuiltinMcp(name: BuiltinMcpName): BuiltinMcpResolution {
  switch (name) {
    case 'cua-driver': {
      const driverPath = findCuaDriverBinary()
      if (!driverPath) {
        debug('McpResolver', 'cua-driver binary not found in PATH or well-known locations')
        return {
          status: 'missing',
          error:
            'cua-driver binary not found. Please install it in Computer Use settings or add it to PATH.',
        }
      }
      debug('McpResolver', `Resolved cua-driver binary: ${driverPath}`)
      return {
        status: 'resolved',
        config: {
          command: driverPath,
          env: { CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' },
        },
      }
    }

    case 'browser-use': {
      const buConfig = getBrowserUseMcpServerConfig()
      if (!buConfig) {
        debug('McpResolver', 'browser-use Python or bridge.py not found')
        return {
          status: 'missing',
          error:
            'Python 3.11+ or browser-use bridge script not found. Please install Browser Use from the settings panel.',
        }
      }
      debug('McpResolver', `Resolved browser-use: ${buConfig.command} ${buConfig.args.join(' ')}`)
      return {
        status: 'resolved',
        config: buConfig,
      }
    }
  }
}
