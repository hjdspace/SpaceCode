/**
 * 内置 MCP 预设的本地化安装（把 uvx/npx 形态换成一次性安装）。
 *
 * 预设里 `uvx cdp-bridge@latest` / `npx -y chrome-devtools-mcp@latest` 每次
 * spawn 都要跑一遍包管理器 launcher：钉版本后仍要付 launcher 进程 + 缓存校验的
 * 钱，且 uv 会按 PyPI 的 max-age=600 周期性回源（实测握手 4.7–10.8s，两台并发
 * 时更高）。装到持久位置后 `localMcpService` 就能直接发现入口文件，
 * `mcpConfigResolver` 随即改走本地直连，launcher 成本归零，MCP 握手预算也能
 * 从 30s 收回 15s。
 *
 * 边界（刻意保守）：
 * - 只在用户**主动启用**某个内置预设时被调用（见 store 的 toggleServerEnabled），
 *   不在启动时批量扫描；
 * - 不装运行时：uv 缺失只报错（一键装 uv 是设置页上另一个显式动作），npm 随
 *   Node 自带，同样不代装 Node；
 * - 已本地化就跳过，不做版本比较也不自动升级 —— 与 resolver 的口径一致：
 *   本地存在即权威（钉版本只在走不到本地时用于回退）；
 * - 失败不改写任何配置：下次 spawn 照旧回落到钉版本 launcher，行为与今天相同。
 *
 * Windows 口径沿用 mcpConfigResolver 的教训：npm 是 `npm.cmd` 垫片，Node 对
 * .cmd 有 CVE-2024-27980 保护（shell:false 下同步抛 EINVAL），而 `cmd /c "<带空格
 * 的绝对路径>"` 又时好时坏。所以 npm 一律走 `cmd /c npm …` 交给 cmd 做 PATH 解析；
 * uv 是真 uvx.exe/uv.exe，直接 spawn 绝对路径。
 */
import { info, warn } from '../infra/logger'
import type { InstallProgress } from '../proxy/types'
import { runStreamingInstaller } from '../engine/cliDetector'
import { findUv } from './browserUseService'
import { findCdpBridgeExecutable, findChromeDevtoolsMcpLocal } from './localMcpService'
import {
  PINNED_CDP_BRIDGE,
  PINNED_CHROME_DEVTOOLS_MCP,
  builtinNameFromServerKey,
  isNpxLike,
  isUvxLike,
  type BuiltinMcpName,
} from './mcpConfigResolver'

const SCOPE = 'BuiltinMcpInstaller'

/** 安装子进程的整体超时：全局 npm 安装慢盘上能到几分钟，给足余量 */
const INSTALL_TIMEOUT_MS = 300_000

/** 调用方手上的预设形态；由渲染层从面板那条记录里带过来，不额外读磁盘 */
export interface LocalizeSource {
  type?: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
}

export type LocalizeResult =
  /** 这次真的装上了，下次 spawn 起走本地直连 */
  | { status: 'localized' }
  /** 本来就是本地直连，什么都没做 */
  | { status: 'already-local' }
  /** 不该装：非这两个 launcher 预设，或用户把 command 改写成了别的形态 */
  | { status: 'not-applicable' }
  | { status: 'failed'; error: string }

/**
 * 同一个 key 的并发请求共享一次安装。
 *
 * 面板上连点、或 store 的降级链（toggleEnabled 失败后走 updateServers）二次触发,
 * 都不该起两个 `npm install -g` 互相踩全局 node_modules。
 */
const inFlight = new Map<string, Promise<LocalizeResult>>()

export function localizeBuiltinMcp(
  key: string,
  source: LocalizeSource,
  onProgress: (p: InstallProgress) => void,
): Promise<LocalizeResult> {
  const builtin = builtinNameFromServerKey(key)
  // 判断放在 single-flight 之前：不适用的 key 不值得留一个在飞的 Promise。
  if (!isLocalizableForm(builtin, source)) return Promise.resolve({ status: 'not-applicable' })

  const existing = inFlight.get(key)
  if (existing) {
    info(SCOPE, `Localization already in flight, joining | key=${key}`)
    return existing
  }
  const job = run(builtin, onProgress).finally(() => inFlight.delete(key))
  inFlight.set(key, job)
  return job
}

/**
 * 只有「这个 key 确实是靠 uvx/npx 拉起这两个包」时才装。
 *
 * `fallback-original`（用户自行改过 command）时 resolver 不会用本地入口，
 * 装了也白装，还平白往用户机器上写东西。
 */
function isLocalizableForm(
  builtin: BuiltinMcpName | null,
  source: LocalizeSource,
): builtin is 'cdp-bridge' | 'chrome-devtools' {
  if (source.type && source.type !== 'stdio') return false
  if (builtin === 'cdp-bridge') return isUvxLike(source.command)
  if (builtin === 'chrome-devtools') return isNpxLike(source.command)
  return false
}

async function run(
  builtin: 'cdp-bridge' | 'chrome-devtools',
  onProgress: (p: InstallProgress) => void,
): Promise<LocalizeResult> {
  return builtin === 'cdp-bridge' ? localizeCdpBridge(onProgress) : localizeChromeDevtools(onProgress)
}

function fail(message: string, onProgress: (p: InstallProgress) => void): LocalizeResult {
  onProgress({ stage: 'error', message, percent: 100 })
  warn(SCOPE, message)
  return { status: 'failed', error: message }
}

function done(message: string, onProgress: (p: InstallProgress) => void): LocalizeResult {
  onProgress({ stage: 'done', message, percent: 100 })
  info(SCOPE, message)
  return { status: 'localized' }
}

async function localizeCdpBridge(onProgress: (p: InstallProgress) => void): Promise<LocalizeResult> {
  if (findCdpBridgeExecutable()) return { status: 'already-local' }

  const uv = findUv()
  if (!uv) return fail(`uv not found — cannot install ${PINNED_CDP_BRIDGE} locally`, onProgress)

  info(SCOPE, `Localizing cdp-bridge via uv tool install | uv=${uv}`)
  try {
    const { code, stderr } = await runStreamingInstaller(
      uv,
      ['tool', 'install', PINNED_CDP_BRIDGE],
      {
        onProgress,
        floor: 10,
        ceiling: 85,
        initialMessage: `uv tool install ${PINNED_CDP_BRIDGE}`,
        timeoutMs: INSTALL_TIMEOUT_MS,
      },
    )
    if (code > 0) return fail(`uv tool install exited ${code}: ${tail(stderr)}`, onProgress)
  } catch (err) {
    return fail(`uv tool install failed: ${errMessage(err)}`, onProgress)
  }

  const resolved = findCdpBridgeExecutable()
  if (!resolved) {
    // 装成功但发现不了 = uv 的 tool bin 目录不在我们认的位置上。
    // 不猜路径，保留 launcher 回退。
    return fail('uv tool install reported success but cdp-bridge is not discoverable', onProgress)
  }
  return done(`cdp-bridge localized at ${resolved}`, onProgress)
}

async function localizeChromeDevtools(onProgress: (p: InstallProgress) => void): Promise<LocalizeResult> {
  if (findChromeDevtoolsMcpLocal()) return { status: 'already-local' }

  const args = ['install', '-g', '--allow-scripts=chrome-devtools-mcp', PINNED_CHROME_DEVTOOLS_MCP]
  const isWin = process.platform === 'win32'
  info(SCOPE, 'Localizing chrome-devtools via npm install -g')

  try {
    const { code, stderr } = await runStreamingInstaller(
      isWin ? 'cmd' : 'npm',
      isWin ? ['/c', 'npm', ...args] : args,
      {
        onProgress,
        floor: 10,
        ceiling: 85,
        initialMessage: `npm ${args.join(' ')}`,
        timeoutMs: INSTALL_TIMEOUT_MS,
      },
    )
    if (code > 0) return fail(`npm install -g exited ${code}: ${tail(stderr)}`, onProgress)
  } catch (err) {
    return fail(`npm install -g failed: ${errMessage(err)}`, onProgress)
  }

  const resolved = findChromeDevtoolsMcpLocal()
  if (!resolved) {
    return fail('npm install -g reported success but chrome-devtools-mcp is not discoverable', onProgress)
  }
  return done(`chrome-devtools-mcp localized at ${resolved.args[0]}`, onProgress)
}

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** 只回传最后一行，避免把整段 npm 日志塞进 UI 的错误文案里 */
function tail(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  return (lines[lines.length - 1] || '(no stderr)').slice(0, 200)
}
