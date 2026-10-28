/**
 * 内置 MCP 服务器配置解析器（深模块）。
 *
 * 特殊内置 MCP 服务器的实际启动配置不在 mcp-servers.json 里，而是运行时动态解析：
 * - cua-driver：原生 Rust 二进制，安装路径不在系统 PATH 里（安装脚本创建的
 *   junction/symlink 可能尚未被 Electron 进程的 PATH 缓存感知），需要
 *   findCuaDriverBinary() 解析绝对路径。依赖缺失时探测直接失败（missing）。
 * - browser-use：Python MCP 服务（bridge.py --mcp），需要 Python 3.11+ 和
 *   browser-use 包，存储的 config 是相对路径（python bridge.py --mcp）。
 *   依赖缺失时探测直接失败（missing）。
 * - cdp-bridge / chrome-devtools：预设走 `uvx`/`npx`，依赖缺失不是错误——
 *   存在本地安装（uv tool / npm global）就直连本地入口，否则回退到钉版本的
 *   `uvx`/`npx`（去掉 @latest 的强制联网解析）。探测与 CLI 注入都不因缺本地
 *   安装而失败。Windows 上 npx 回退形态会包成 `cmd /c npx`，因为裸 `npx`
 *   （npx.cmd 垫片）在引擎的 `shell: false` spawn 下必然 ENOENT。
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
import { findCdpBridgeExecutable, findChromeDevtoolsMcpLocal } from './localMcpService'
import { debug } from '../infra/logger'

/** 内置 MCP 服务器的规范名称 */
export type BuiltinMcpName = 'cua-driver' | 'browser-use' | 'cdp-bridge' | 'chrome-devtools'

/** 解析后的启动配置 */
export interface ResolvedMcpConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

/**
 * 解析时调用方手上的原始配置（command/args），供 uvx/npx 预设做
 * 版本钉扎与 server flags 保留的改写。
 */
export interface OriginalMcpConfig {
  command?: string
  args?: string[]
}

/** 解析结果：
 * - `resolved` — 覆盖为解析后的配置（本地直连或钉版本的 launcher）
 * - `missing` — 依赖缺失，调用方按语义决定（探测失败 / CLI 保留原配置）
 * - `fallback-original` — 配置不属于该预设的 uvx/npx 形态（用户自行改过
 *   command），不覆盖，按原配置走
 */
export type BuiltinMcpResolution =
  | { status: 'resolved'; config: ResolvedMcpConfig }
  | { status: 'missing'; error: string }
  | { status: 'fallback-original' }

// ── uvx / npx 预设的钉版本 ──────────────────────────────────────────
//
// `uvx cdp-bridge@latest` / `npx -y chrome-devtools-mcp@latest` 每次启动都
// 要联网解析 @latest（弱网下会吃满 MCP 握手超时）；钉精确版本后，包管理器
// 缓存命中即可离线启动。升级版本时改这里（预设里的 @latest 只是初始展示值，
// 运行时永远经过本解析器）。
//
// 导出给 builtinMcpInstaller：本地化安装必须装的就是这两个版本，否则
// 「装了 1.12.0、回退写 1.13.0」两条路径会各跑各的。
export const PINNED_CDP_BRIDGE = 'cdp-bridge@0.1.25'
export const PINNED_CHROME_DEVTOOLS_MCP = 'chrome-devtools-mcp@1.12.0'

/** 取命令 basename（兼容 windows 路径）并去掉可执行后缀，用于 uvx/npx 识别 */
function launcherName(command: string): string {
  const normalized = command.replace(/[\\/]/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
  return base.replace(/\.(exe|cmd|bat)$/, '')
}

/**
 * command 是否还是预设的 uvx / npx 形态。
 *
 * 导出给 `builtinMcpInstaller`：用户把内置项的 command 改写成别的形态时
 * （resolver 报 fallback-original），本地化安装帮不上忙，不该照装不误。
 */
export function isUvxLike(command: string | undefined): boolean {
  return !!command && launcherName(command) === 'uvx'
}

export function isNpxLike(command: string | undefined): boolean {
  return !!command && launcherName(command) === 'npx'
}

/** 判断 arg 是否是包 `<pkg>` 的 spec 形态（裸名或 `<pkg>@version`） */
function isPackageSpec(arg: string, pkg: string): boolean {
  return arg === pkg || arg.startsWith(`${pkg}@`)
}

/**
 * 钉版本回退的 launcher args：把包 spec 原位替换为 pinned spec，其余
 * server flags 原样保留；找不到 spec（配置异常）时前置 pinned spec。
 * npx 额外确保 `-y` 存在，避免首次下载时卡在交互确认。
 */
function pinnedLauncherArgs(
  args: string[] | undefined,
  pkg: string,
  pinnedSpec: string,
  ensureYes: boolean,
): string[] {
  const source = args ?? []
  const specIndex = source.findIndex(a => isPackageSpec(a, pkg))
  const result =
    specIndex >= 0
      ? source.map((a, i) => (i === specIndex ? pinnedSpec : a))
      : [pinnedSpec, ...source]
  if (ensureYes && !result.includes('-y')) result.unshift('-y')
  return result
}

/**
 * 本地直连时的 server args：去掉包 spec 与 `-y`（它们是 launcher 参数，
 * 不是 server 参数），其余 flags 原样传给本地入口。
 */
function serverFlagsOnly(args: string[] | undefined, pkg: string): string[] {
  const source = args ?? []
  const specIndex = source.findIndex(a => isPackageSpec(a, pkg))
  return source.filter((a, i) => i !== specIndex && a !== '-y')
}

/**
 * Windows 上把 npx 启动包一层 `cmd /c`。
 *
 * 引擎用 MCP SDK 的 StdioClientTransport 以 `shell: false` spawn stdio 服务器
 * （见 engine/src/services/mcp/client.ts → SDK stdio.js），而 libuv 在 Windows
 * 上只按「名称 + .exe」搜 PATH，不认 PATHEXT。npx 是 `npx.cmd` 垫片，于是
 * `spawn('npx', …)` 直接 ENOENT，服务器永远停在 CONNECT_TIMEOUT —— 这正是
 * 内置 chrome-devtools 连不上的根因（uvx 不受影响，因为它是真的 uvx.exe）。
 * 引擎自己也把这条写进了校验告警：「Windows requires 'cmd /c' wrapper to
 * execute npx」。
 *
 * 这里固定用裸 `npx` 而不是用户写的 command：实测 `cmd /c "<绝对路径>"` 在
 * 路径含空格时要么静默无输出、要么报语法错误，只有交给 cmd 走 PATH 解析才
 * 稳。所以即使用户把 command 改成 `npx.cmd` 或绝对路径，也一并归一化掉。
 */
function windowsLauncherConfig(args: string[]): ResolvedMcpConfig {
  return { command: 'cmd', args: ['/c', 'npx', ...args] }
}

/**
 * 这条 stdio 配置是否要靠包管理器 launcher（uvx / npx）在启动时做包解析。
 *
 * launcher 形态的握手耗时由网络决定，不由本机决定：uv 会按 PyPI 的
 * `max-age=600` 周期性回源校验 cdp-bridge 的索引元数据，实测握手从 4.7-5.4s
 * （缓存新鲜）涨到 6.9-10.8s（回源 + 与另一个 launcher 并发）。调用方据此决定
 * 给多长的 MCP 握手预算，而不是所有服务器共用一个拍出来的常数。
 *
 * 按命令形态判断，所以内置预设（uvx/npx）和用户自建但手写 npx 的条目都算。
 * 调用方（buildEnabledMcpConfig）刻意在解析器覆盖**之后**才问这个问题：本地
 * 已安装、直连绝对路径的预设于是答 false，不再为一段走不到的网络开销买单。
 * 这里本身只读 command，不再起探测子进程 —— 覆盖它的那次解析已经付过钱了。
 */
export function usesPackageManagerLauncher(
  config: Pick<McpProbeConfig, 'type' | 'command' | 'args' | 'url'>,
): boolean {
  if (config.type === 'sse' || config.type === 'http') return false
  if (isUvxLike(config.command) || isNpxLike(config.command)) return true
  // 穿过 Windows 那层壳：本模块自己就会把 npx 包成 `cmd /c npx …`，判据若只看
  // command 就会把它当成"不需要 launcher 预算"，反过来把健康的服务器掐死。
  if (launcherName(config.command || '') === 'cmd') {
    const wrapped = wrappedCommand(config.args)
    return !!wrapped && (isUvxLike(wrapped) || isNpxLike(wrapped))
  }
  return false
}

/** `cmd /c <command> …` 里被包起来的那个命令；形态不符时返回 null */
function wrappedCommand(args: string[] | undefined): string | null {
  if (!args || args.length < 2 || args[0].toLowerCase() !== '/c') return null
  return args[1]
}

/**
 * 从探测配置的 command/args 模式检测是否匹配内置 MCP 服务器。
 *
 * 用于 mcp:probeServer handler —— 此时只有原始 config，没有服务器名称 key。
 *
 * - cua-driver: config.command === 'cua-driver'
 * - browser-use: command 为 python/python3 且 args 含 bridge.py
 * - cdp-bridge: command 为 uvx 且 args 含 cdp-bridge 包 spec
 * - chrome-devtools: command 为 npx 且 args 含 chrome-devtools-mcp 包 spec
 */
export function detectBuiltinFromConfig(
  config: Pick<McpProbeConfig, 'type' | 'command' | 'args' | 'url'>,
): BuiltinMcpName | null {
  if (config.command === 'cua-driver') {
    return 'cua-driver'
  }

  if (
    config.type === 'stdio' &&
    isUvxLike(config.command) &&
    config.args?.some(a => isPackageSpec(a, 'cdp-bridge'))
  ) {
    return 'cdp-bridge'
  }

  if (
    config.type === 'stdio' &&
    isNpxLike(config.command) &&
    config.args?.some(a => isPackageSpec(a, 'chrome-devtools-mcp'))
  ) {
    return 'chrome-devtools'
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
 * - 'cdp-bridge' → 'cdp-bridge'
 * - 'chrome-devtools' → 'chrome-devtools'
 */
export function builtinNameFromServerKey(key: string): BuiltinMcpName | null {
  if (key === 'sc-computer-use') return 'cua-driver'
  if (key === 'browser-use') return 'browser-use'
  if (key === 'cdp-bridge') return 'cdp-bridge'
  if (key === 'chrome-devtools') return 'chrome-devtools'
  return null
}

/**
 * 解析内置 MCP 服务器的实际启动配置。
 *
 * `original` 为调用方手上的原始 uvx/npx 配置，仅 cdp-bridge / chrome-devtools
 * 使用（保留 server flags、钉扎包版本）；cua-driver / browser-use 不需要。
 *
 * 返回:
 * - `{ status: 'resolved', config }` — 覆盖为解析后的配置
 * - `{ status: 'missing', error }` — 依赖缺失，返回用户可读的错误提示
 * - `{ status: 'fallback-original' }` — 原配置不是该预设的 uvx/npx 形态
 *   （用户自行改写过 command），保留原配置不做覆盖
 *
 * 调用方自行决定 missing 时的行为：
 * - probe handler：直接返回失败
 * - buildEnabledMcpConfig：保留原始命令，让 CLI 启动时自行失败（不影响其他服务器）
 */
export function resolveBuiltinMcp(
  name: BuiltinMcpName,
  original?: OriginalMcpConfig,
): BuiltinMcpResolution {
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

    case 'cdp-bridge': {
      // 用户把内置服务器的 command 改成了别的形态：尊重其配置
      if (!isUvxLike(original?.command)) return { status: 'fallback-original' }

      const local = findCdpBridgeExecutable()
      if (local) {
        debug('McpResolver', `Resolved cdp-bridge local executable: ${local}`)
        return {
          status: 'resolved',
          config: {
            command: local,
            args: serverFlagsOnly(original?.args, 'cdp-bridge'),
          },
        }
      }
      const args = pinnedLauncherArgs(original?.args, 'cdp-bridge', PINNED_CDP_BRIDGE, false)
      debug('McpResolver', `cdp-bridge local install not found, falling back to uvx ${args.join(' ')}`)
      return {
        status: 'resolved',
        config: { command: original!.command!, args },
      }
    }

    case 'chrome-devtools': {
      if (!isNpxLike(original?.command)) return { status: 'fallback-original' }

      const local = findChromeDevtoolsMcpLocal()
      if (local) {
        debug('McpResolver', `Resolved chrome-devtools-mcp local: ${local.command} ${local.args.join(' ')}`)
        return {
          status: 'resolved',
          config: {
            command: local.command,
            args: [...local.args, ...serverFlagsOnly(original?.args, 'chrome-devtools-mcp')],
          },
        }
      }
      const args = pinnedLauncherArgs(original?.args, 'chrome-devtools-mcp', PINNED_CHROME_DEVTOOLS_MCP, true)
      if (process.platform === 'win32') {
        debug('McpResolver', `chrome-devtools-mcp local install not found, falling back to cmd /c npx ${args.join(' ')}`)
        return { status: 'resolved', config: windowsLauncherConfig(args) }
      }
      debug('McpResolver', `chrome-devtools-mcp local install not found, falling back to npx ${args.join(' ')}`)
      return {
        status: 'resolved',
        config: { command: original!.command!, args },
      }
    }
  }
}
