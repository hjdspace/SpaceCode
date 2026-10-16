/**
 * cua-driver 核心服务：二进制检测、安装、MCP 会话管理、健康检查、权限管理。
 *
 * 对齐 hermes-agent 的 cua_backend.py + doctor.py + permissions.py 设计。
 * cua-driver 生命周期由 Electron 主进程管理，通过 IPC 暴露给渲染进程。
 *
 * 双通道架构：
 * 1. CLI 通道 — cua-driver 作为 MCP 服务器通过 --mcp-config 注入 Claude Code CLI
 * 2. 主进程直连通道 — 主进程通过 stdio MCP 直接通信（健康检查、权限、预览）
 */
import { app, ipcMain, BrowserWindow } from 'electron'
import { existsSync, copyFileSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { spawn, execFile, execFileSync } from 'child_process'
import { info, warn, error as logError } from '../infra/logger'
import { CuaDriverMcpClient } from './cuaDriverMcpClient'
import {
  findInstalledAppBundleBinary,
  stageAppBundle,
  CUA_DRIVER_APP_NAME,
} from './cuaDriverBundle'
import type {
  CuaDriverStatus,
  HealthCheck,
  McpToolResult,
  CuaDriverUpdateInfo,
  CuaDriverPermissions,
} from '../../src/types/computerUse'

/** cua-driver 二进制名称（Windows 带后缀） */
const CUA_DRIVER_BIN = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'

/** 环境变量覆盖（与 hermes 的 HERMES_CUA_DRIVER_CMD 对齐） */
const CUA_DRIVER_ENV_VAR = 'CUA_DRIVER_CMD'

/** cua-driver 遥测禁用环境变量 */
const CUA_TELEMETRY_ENV = 'CUA_DRIVER_RS_TELEMETRY_ENABLED'

/** 长连接 MCP 客户端（用于健康检查等 UI 功能） */
let mcpClient: CuaDriverMcpClient | null = null

// ── 二进制检测 ─────────────────────────────────────────────────

/**
 * 获取 cua-driver 二进制路径。
 *
 * macOS 与其余平台走两套规则，因为「能跑」在这两处的含义不同：
 *
 * - darwin：只认 CuaDriver.app 内的可执行文件。TCC 授权按 CFBundleIdentifier
 *   归属，裸 Mach-O 没有身份，跑起来只会得到一份全红的诊断（bundle_identity /
 *   tcc_* / ax / screen_capture 全 fail），且用户在系统设置里勾了宿主应用也不会变绿。
 *   没有 bundle 时返回 null，由 getComputerUseStatus 给出可操作的提示。
 * - 其他平台：五级优先，用户自行安装的版本要能赢过随 SpaceCode 打包的副本。
 *
 * 优先级（非 darwin）：
 * 1. 环境变量 CUA_DRIVER_CMD
 * 2. 系统 PATH 上的 cua-driver（用户自行安装的最新版）
 * 3. 官方安装脚本的落地目录
 * 4. 从内置二进制复制到 <userData>/bin 的副本
 * 5. 应用内置的 cua-driver（随 SpaceCode 打包）
 */
export function findCuaDriverBinary(): string | null {
  // 1. 环境变量覆盖 — 用户显式指定的路径原样尊重，包括 darwin
  const envCmd = process.env[CUA_DRIVER_ENV_VAR]
  if (envCmd && existsSync(envCmd)) return envCmd

  if (process.platform === 'darwin') return findInstalledAppBundleBinary()

  // 2. 检查系统 PATH（使用 which/where）— 用户自行安装的最新版
  const systemPath = findInPath(CUA_DRIVER_BIN)
  if (systemPath) return systemPath

  // 3. 检查 cua-driver 官方安装脚本的标准安装路径。
  //    PATH 可能未及时刷新（Electron 进程启动时缓存了旧 PATH），所以这里显式检查。
  const wellKnownPath = findInWellKnownLocations()
  if (wellKnownPath) return wellKnownPath

  // 4. 检查用户数据目录（从内置二进制复制过来的）
  const userBinPath = join(app.getPath('userData'), 'bin', CUA_DRIVER_BIN)
  if (existsSync(userBinPath)) return userBinPath

  // 5. 检查内置二进制（应用 resources/cua-driver/ 目录）
  const bundledPath = findBundledBinary()
  if (bundledPath) return bundledPath

  return null
}

/** 在系统 PATH 中查找可执行文件 */
function findInPath(binName: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const result = execFileSync(cmd, [binName], { encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] })
    const path = result.trim().split('\n')[0].trim()
    if (path && existsSync(path)) return path
  } catch {
    // not in PATH
  }
  return null
}

/**
 * 检查 cua-driver 官方安装脚本的标准安装路径（Windows / Linux）。
 *
 * 安装脚本（install.ps1 / install.sh）将二进制放在：
 * - package home: ~/.cua-driver/packages/current/<bin>
 * - install dir:
 *   - Windows: %LOCALAPPDATA%\Programs\Cua\cua-driver\bin\<bin> （junction → packages/current）
 *   - Linux:   ~/.local/bin/<bin>                               （symlink → packages/current）
 *
 * macOS 不在这里 —— 它用 /Applications/CuaDriver.app，见 cuaDriverBundle.ts。
 *
 * Electron 进程可能在安装脚本更新 PATH 之前就已启动，导致 `where`/`which`
 * 找不到二进制。这里显式检查这些已知路径作为兜底。
 */
function findInWellKnownLocations(): string | null {
  const home = homedir()
  const candidates: string[] = []

  if (process.platform === 'win32') {
    // package home（实际二进制所在）
    candidates.push(join(home, '.cua-driver', 'packages', 'current', CUA_DRIVER_BIN))
    // install dir（junction → packages/current）
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) {
      candidates.push(join(localAppData, 'Programs', 'Cua', 'cua-driver', 'bin', CUA_DRIVER_BIN))
    }
  } else if (process.platform === 'linux') {
    candidates.push(join(home, '.cua-driver', 'packages', 'current', CUA_DRIVER_BIN))
    candidates.push(join(home, '.local', 'bin', CUA_DRIVER_BIN))
  }

  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

/** 查找内置的 cua-driver 二进制 */
function findBundledBinary(): string | null {
  const binName = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'cua-driver', binName),
        join(process.resourcesPath, 'cua-driver', 'bin', binName),
      ]
    : [
        join(__dirname, '..', 'cua-driver', binName),
        join(__dirname, '..', '..', 'cua-driver', binName),
        join(__dirname, '..', '..', 'resources', 'cua-driver', binName),
        join(__dirname, '..', '..', 'resources', 'cua-driver', 'bin', binName),
      ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

/**
 * 获取 cua-driver 版本号。
 * 调用 `cua-driver --version` 解析输出。
 */
export async function getCuaDriverVersion(binaryPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['--version'],
      { timeout: 8_000, env: { ...process.env, [CUA_TELEMETRY_ENV]: '0' } },
      (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        const match = stdout.trim().match(/(\d+\.\d+\.\d+)/)
        resolve(match ? match[1] : stdout.trim() || null)
      },
    )
  })
}

/**
 * 判断二进制来源。
 * bundled = 随应用打包；system = 用户自行安装（含 macOS 的 /Applications/CuaDriver.app）。
 */
function getBinarySource(binaryPath: string | null): 'bundled' | 'system' | null {
  if (!binaryPath) return null

  // cua-driver 官方安装脚本的安装路径 → system（用户自行安装）
  // 必须先检查，因为这些路径可能包含 "cua-driver" 子串（如 .cua-driver），
  // 会被下方的 bundled 检查误判。
  const home = homedir()
  const systemPatterns = [join(home, '.cua-driver')]
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    systemPatterns.push(join(process.env.LOCALAPPDATA, 'Programs', 'Cua'))
  }
  for (const pattern of systemPatterns) {
    if (binaryPath.includes(pattern)) return 'system'
  }

  // 从内置二进制复制到 userData/bin/ 的标记为 'bundled'
  if (binaryPath.includes(join(app.getPath('userData'), 'bin'))) return 'bundled'
  // 内置副本在 <resourcesPath>/cua-driver 下。用 resourcesPath 而不是字面量
  // 'resources/cua-driver' 比对：macOS 的磁盘布局是 Contents/Resources，大小写
  // 对不上，字面量只在 Windows 上碰巧成立 —— mac 包因此被标成「系统」，
  // 让人以为红叉来自自己装的那份驱动。
  if (app.isPackaged && binaryPath.startsWith(join(process.resourcesPath, 'cua-driver'))) return 'bundled'
  // 开发模式下内置副本直接从仓库的 resources/cua-driver 取
  if (!app.isPackaged && binaryPath.includes(join('resources', 'cua-driver'))) return 'bundled'
  return 'system'
}

// ── MCP 客户端管理 ─────────────────────────────────────────────

/** cua-driver 子进程环境变量（禁用遥测） */
function cuaDriverEnv(): Record<string, string> {
  return { [CUA_TELEMETRY_ENV]: '0' }
}

/** 获取或创建长连接 MCP 客户端 */
async function getMcpClient(): Promise<CuaDriverMcpClient> {
  if (mcpClient && mcpClient['started']) return mcpClient

  const binaryPath = findCuaDriverBinary()
  if (!binaryPath) {
    throw new Error('cua-driver binary not found')
  }

  mcpClient = new CuaDriverMcpClient()
  await mcpClient.start(binaryPath, cuaDriverEnv())
  return mcpClient
}

/** 关闭并清理 MCP 客户端 */
export async function cleanupCuaDriverMcp(): Promise<void> {
  if (mcpClient) {
    try {
      await mcpClient.stop()
    } catch {
      // ignore
    }
    mcpClient = null
  }
}

// ── 健康检查 ───────────────────────────────────────────────────

/**
 * 运行 cua-driver 健康检查。
 * 通过 MCP 客户端调用 health_report 工具，返回结构化检查矩阵。
 *
 * 对齐 hermes-agent 的 doctor.py — 调用 cua-driver 的 health_report MCP 工具，
 * 解析 structuredContent 中的 checks 数组。
 *
 * @param opts.fresh 先丢掉现有子进程再探测。macOS 在系统设置里改授权后必须换进程
 *                   才看得到新结果，所以「运行诊断」按钮走 fresh。
 */
export async function runHealthReport(
  opts?: { fresh?: boolean },
): Promise<{ ok: boolean; checks: HealthCheck[] }> {
  if (opts?.fresh) await cleanupCuaDriverMcp()

  try {
    const client = await getMcpClient()
    const result = await client.callTool('health_report', {}, 30_000)

    // 优先从 structuredContent 获取
    const sc = result.structuredContent as Record<string, unknown> | null
    if (sc && typeof sc === 'object') {
      const overall = sc.overall as string
      const rawChecks = Array.isArray(sc.checks) ? sc.checks : []
      const checks: HealthCheck[] = rawChecks.map((raw: Record<string, unknown>) => ({
        label: String(raw.name ?? raw.label ?? ''),
        status: (raw.status as HealthCheck['status']) ?? 'skip',
        message: String(raw.message ?? ''),
        hint: raw.hint ? String(raw.hint) : undefined,
      }))
      return { ok: overall === 'ok', checks }
    }

    // 回退：从 text 数据解析
    if (typeof result.data === 'string' && result.data) {
      try {
        const parsed = JSON.parse(result.data)
        const checks: HealthCheck[] = (parsed.checks ?? []).map((raw: Record<string, unknown>) => ({
          label: String(raw.name ?? ''),
          status: (raw.status as HealthCheck['status']) ?? 'skip',
          message: String(raw.message ?? ''),
          hint: raw.hint ? String(raw.hint) : undefined,
        }))
        return { ok: parsed.overall === 'ok', checks }
      } catch {
        // 解析失败，返回空
      }
    }

    return { ok: false, checks: [] }
  } catch (e) {
    warn('CuaDriverService', `health_report failed: ${e}`)
    return {
      ok: false,
      checks: [{
        label: 'mcp_connection',
        status: 'fail',
        message: `Failed to connect to cua-driver: ${e}`,
        hint: 'Ensure cua-driver is installed and running.',
      }],
    }
  }
}

// ── 权限管理（macOS TCC）─────────────────────────────────────

/** 权限状态的空值 —— 非 macOS、或拿不到任何有效读数时使用 */
function emptyPermissions(readError: string | null = null): CuaDriverPermissions {
  return {
    accessibility: null,
    screenRecording: null,
    screenRecordingCapturable: null,
    attribution: null,
    readError,
  }
}

/**
 * 查询 macOS TCC 权限状态。
 *
 * 对齐 hermes-agent 的 permissions.py — 调用 `cua-driver permissions status --json`。
 * Windows/Linux 无 TCC 模型，返回空。
 *
 * 除了两个布尔值，还要带上 CLI 的 `source` 字段（这里叫 attribution）：它说明
 * 这次读数反映的是谁的身份。CLI 自己的解释是 —— macOS 把授权算给 responsible
 * process，从终端或宿主应用里直接问，读到的是终端/宿主而非驱动的授权。没有这个
 * 字段，「驱动没身份」和「驱动有身份但没授权」在界面上长得一模一样。
 */
export async function getPermissionsStatus(): Promise<CuaDriverPermissions> {
  if (process.platform !== 'darwin') {
    return emptyPermissions()
  }

  const binaryPath = findCuaDriverBinary()
  if (!binaryPath) {
    return emptyPermissions('cua-driver binary not found')
  }

  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['permissions', 'status', '--json'],
      // 这条命令可能顺手 relaunch daemon，10s 偏紧
      { timeout: 20_000, env: { ...process.env, [CUA_TELEMETRY_ENV]: '0' } },
      (err, stdout) => {
        if (err) {
          warn('CuaDriverService', `permissions status failed: ${err.message}`)
          resolve(emptyPermissions(err.message))
          return
        }
        try {
          const data = JSON.parse(stdout.trim())
          resolve({
            accessibility: typeof data.accessibility === 'boolean' ? data.accessibility : null,
            screenRecording:
              typeof data.screen_recording === 'boolean' ? data.screen_recording : null,
            screenRecordingCapturable:
              typeof data.screen_recording_capturable === 'boolean'
                ? data.screen_recording_capturable
                : null,
            attribution: typeof data.source === 'string' ? data.source : null,
            readError: null,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          warn('CuaDriverService', `permissions status JSON parse failed: ${msg}`)
          resolve(emptyPermissions(msg))
        }
      },
    )
  })
}

/**
 * 请求 macOS TCC 权限。
 * 会弹出系统设置对话框，需要用户手动授权。
 *
 * 授权完成后必须换掉 MCP 子进程：TCC 的判定按进程缓存，旧进程会一直读回授权前的
 * 拒绝结果。不重启的话，用户明明勾了开关，诊断面板还是全红。
 */
export async function grantPermissions(): Promise<{ success: boolean; error?: string }> {
  if (process.platform !== 'darwin') {
    return { success: false, error: 'TCC permissions are only available on macOS' }
  }

  const binaryPath = findCuaDriverBinary()
  if (!binaryPath) {
    return { success: false, error: 'cua-driver binary not found' }
  }

  const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
    execFile(
      binaryPath,
      ['permissions', 'grant'],
      // 这条命令要等人在系统设置里点完，30s 会让一次正常授权被报成失败
      { timeout: 180_000, env: { ...process.env, [CUA_TELEMETRY_ENV]: '0' } },
      (err) => {
        if (err) resolve({ success: false, error: err.message })
        else resolve({ success: true })
      },
    )
  })

  if (result.success) await cleanupCuaDriverMcp()
  return result
}

// ── 更新检查 ───────────────────────────────────────────────────

/**
 * 检查 cua-driver 更新。
 * 调用 `cua-driver check-update --json` 比较已安装版本与 GitHub 最新版本。
 *
 * 对齐 hermes-agent 的 cua_driver_update_check。
 */
export async function checkUpdate(): Promise<CuaDriverUpdateInfo> {
  const binaryPath = findCuaDriverBinary()
  if (!binaryPath) {
    return { updateAvailable: false, latestVersion: null, currentVersion: null }
  }

  const currentVersion = await getCuaDriverVersion(binaryPath)

  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['check-update', '--json'],
      { timeout: 12_000, env: { ...process.env, [CUA_TELEMETRY_ENV]: '0' } },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve({
            updateAvailable: false,
            latestVersion: null,
            currentVersion,
          })
          return
        }
        try {
          const data = JSON.parse(stdout.trim())
          if (data.error) {
            resolve({
              updateAvailable: false,
              latestVersion: null,
              currentVersion,
            })
            return
          }
          resolve({
            updateAvailable: Boolean(data.update_available),
            latestVersion: data.latest_version ?? null,
            currentVersion: data.current_version ?? currentVersion,
          })
        } catch {
          resolve({
            updateAvailable: false,
            latestVersion: null,
            currentVersion,
          })
        }
      },
    )
  })
}

// ── 安装进度回调 ───────────────────────────────────────────────

/** 安装进度事件类型 */
export interface CuaInstallProgress {
  stage: 'bundled' | 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  message: string
  percent: number
}

/** 向渲染进程推送安装进度 */
function sendInstallProgress(progress: CuaInstallProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('cua-driver:installProgress', progress)
  }
}

// ── 安装/升级 ──────────────────────────────────────────────────

/**
 * 从应用内置的 cua-driver 二进制安装到用户数据目录。
 *
 * 内置二进制随应用打包（extraResources/cua-driver/），无需网络下载。
 * 复制到 userData/bin/ 目录下，使其独立于应用更新持久存在。
 *
 * @returns 成功时返回目标路径，无内置二进制时返回 null
 */
function installFromBundledBinary(progress?: (p: CuaInstallProgress) => void): string | null {
  const report = progress || sendInstallProgress

  const bundledPath = findBundledBinary()
  if (!bundledPath) {
    return null
  }

  report({ stage: 'bundled', message: 'Found bundled cua-driver binary', percent: 10 })

  const binName = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
  const targetDir = join(app.getPath('userData'), 'bin')
  const targetPath = join(targetDir, binName)

  try {
    mkdirSync(targetDir, { recursive: true })
    report({ stage: 'installing', message: 'Copying bundled binary to user directory...', percent: 50 })
    copyFileSync(bundledPath, targetPath)

    // Unix 需要设置可执行权限
    if (process.platform !== 'win32') {
      chmodSync(targetPath, 0o755)
    }

    report({ stage: 'verifying', message: 'Verifying installation...', percent: 90 })

    // 验证二进制可用
    try {
      const version = execFileSync2(targetPath, ['--version'])
      report({ stage: 'done', message: `cua-driver ${version} installed from bundled binary`, percent: 100 })
      info('CuaDriverService', `Installed from bundled binary: ${targetPath} (v${version})`)
      return targetPath
    } catch {
      report({ stage: 'done', message: 'Bundled binary copied (version check skipped)', percent: 100 })
      info('CuaDriverService', `Copied bundled binary to: ${targetPath}`)
      return targetPath
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError('CuaDriverService', `Failed to copy bundled binary: ${msg}`)
    return null
  }
}

/** execFileSync 的 Promise 封装，返回 stdout trim */
function execFileSync2(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 8_000, env: { ...process.env, [CUA_TELEMETRY_ENV]: '0' } },
      (err, stdout) => {
        if (err) { reject(err); return }
        resolve(stdout.trim())
      },
    )
  })
}

/**
 * macOS：把内置的 CuaDriver.app 落到 /Applications（回退 ~/Applications）。
 *
 * 不走 installFromBundledBinary 那条「复制裸二进制到 <userData>/bin」的路：
 * 那样得到的进程没有 CFBundleIdentifier，TCC 授权不会归到驱动身上，
 * Computer Use 会永远停在未就绪。
 *
 * @returns true 表示已就绪（本次落地或此前已存在）；false 表示需要回退在线安装
 */
async function installMacAppBundle(progress: (p: CuaInstallProgress) => void): Promise<boolean> {
  const existing = findInstalledAppBundleBinary()
  if (existing) {
    progress({ stage: 'done', message: `${CUA_DRIVER_APP_NAME} 已就绪`, percent: 100 })
    info('CuaDriverService', `Using existing driver bundle: ${existing}`)
    return true
  }

  progress({ stage: 'installing', message: `安装 ${CUA_DRIVER_APP_NAME} 到 /Applications...`, percent: 50 })
  const staged = await stageAppBundle()
  if (!staged.ok || !staged.binaryPath) {
    logError('CuaDriverService', `Failed to stage CuaDriver.app: ${staged.error}`)
    return false
  }

  progress({ stage: 'done', message: `已安装 ${staged.appDir}`, percent: 100 })
  info('CuaDriverService', `Staged driver bundle: ${staged.binaryPath}`)
  return true
}

/**
 * 安装或升级 cua-driver。
 *
 * 安装策略（按优先级）：
 * 1. **内置副本** — macOS 把 CuaDriver.app 落地到标准安装目录（TCC 身份需要它），
 *    其他平台把裸二进制复制到用户数据目录。两者都秒级完成，无需网络。
 * 2. **GitHub 在线安装** — 没有内置副本时（如开发模式），调用上游安装脚本。
 *    官方脚本在 macOS 上同样会安装 /Applications/CuaDriver.app。
 *    支持 `CUA_DRIVER_GITHUB_MIRROR` 环境变量设置 GitHub 镜像加速。
 *
 * 安装完成后用户安装的版本优先于内置版本。
 */
export async function installCuaDriver(): Promise<{ success: boolean; error?: string }> {
  const isWindows = process.platform === 'win32'
  const isMacOS = process.platform === 'darwin'
  const isLinux = process.platform === 'linux'

  if (!isWindows && !isMacOS && !isLinux) {
    return { success: false, error: `Unsupported platform: ${process.platform}` }
  }

  info('CuaDriverService', 'Starting cua-driver installation...')
  sendInstallProgress({ stage: 'downloading', message: 'Starting installation...', percent: 0 })

  // ── 策略 1: 从内置副本安装 ──
  const fromBundled = isMacOS
    ? await installMacAppBundle(sendInstallProgress)
    : installFromBundledBinary() !== null
  if (fromBundled) {
    return { success: true }
  }

  // ── 策略 2: 从 GitHub 在线安装 ──
  info('CuaDriverService', 'No bundled payload found, falling back to GitHub install script')
  sendInstallProgress({ stage: 'downloading', message: 'Downloading from GitHub (may take a while)...', percent: 5 })

  // 支持 GitHub 镜像加速：设置 CUA_DRIVER_GITHUB_MIRROR 环境变量
  // 例如: CUA_DRIVER_GITHUB_MIRROR=https://ghfast.top
  const mirror = process.env.CUA_DRIVER_GITHUB_MIRROR || ''
  const rawGithubBase = 'https://raw.githubusercontent.com'
  const githubBase = 'https://github.com'
  const scriptPath = '/trycua/cua/main/libs/cua-driver/scripts/install'

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>
    const env = { ...process.env, [CUA_TELEMETRY_ENV]: '0' }

    if (isWindows) {
      // 如果有镜像，用镜像 URL 替换 raw.githubusercontent.com
      const scriptUrl = mirror
        ? `${mirror}/${rawGithubBase.slice(8)}${scriptPath}.ps1`
        : `${rawGithubBase}${scriptPath}.ps1`
      const psScript = `irm ${scriptUrl} | iex`
      proc = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', psScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        windowsHide: true,
      })
    } else {
      const scriptUrl = mirror
        ? `${mirror}/${rawGithubBase.slice(8)}${scriptPath}.sh`
        : `${rawGithubBase}${scriptPath}.sh`
      const cmd = `/bin/bash -c "$(curl -fsSL ${scriptUrl})"`
      proc = spawn('bash', ['-c', cmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
    }

    let stderr = ''
    let progressPercent = 10
    proc.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      info('CuaDriverService', `install stdout: ${line}`)
      // 根据安装脚本输出推送进度
      if (line.includes('Downloading') || line.includes('downloading')) {
        progressPercent = Math.min(progressPercent + 5, 60)
        sendInstallProgress({ stage: 'downloading', message: line, percent: progressPercent })
      } else if (line.includes('Installing') || line.includes('installing')) {
        progressPercent = Math.min(progressPercent + 10, 80)
        sendInstallProgress({ stage: 'installing', message: line, percent: progressPercent })
      } else if (line.includes('Verify') || line.includes('verify')) {
        sendInstallProgress({ stage: 'verifying', message: line, percent: 90 })
      }
    })
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
      warn('CuaDriverService', `install stderr: ${data.toString().trim()}`)
    })
    proc.on('error', (err) => {
      logError('CuaDriverService', `install failed: ${err.message}`)
      sendInstallProgress({ stage: 'error', message: err.message, percent: 100 })
      resolve({ success: false, error: err.message })
    })
    proc.on('exit', (code) => {
      if (code === 0) {
        info('CuaDriverService', 'cua-driver installation completed successfully')
        sendInstallProgress({ stage: 'done', message: 'Installation completed', percent: 100 })
        resolve({ success: true })
      } else {
        const errorMsg = `Installation exited with code ${code}${stderr ? ': ' + stderr.trim() : ''}`
        logError('CuaDriverService', errorMsg)
        sendInstallProgress({ stage: 'error', message: errorMsg, percent: 100 })
        resolve({ success: false, error: errorMsg })
      }
    })

    // 10 分钟超时（网络下载可能较慢，特别是从 GitHub）
    setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        // ignore
      }
      const msg = 'Installation timed out after 10 minutes'
      sendInstallProgress({ stage: 'error', message: msg, percent: 100 })
      resolve({ success: false, error: msg })
    }, 10 * 60 * 1000)
  })
}

// ── 统一状态查询 ───────────────────────────────────────────────

/**
 * 获取 Computer-Use 完整就绪状态。
 *
 * 组合：二进制检测 + 版本 + 健康检查 + 权限状态。
 * 对齐 hermes-agent 的 computer_use_status。
 */
export async function getComputerUseStatus(): Promise<CuaDriverStatus> {
  const platform = process.platform
  const platformSupported = platform === 'darwin' || platform === 'win32' || platform === 'linux'
  const canGrant = platform === 'darwin'

  const binaryPath = findCuaDriverBinary()
  const installed = binaryPath !== null
  const source = getBinarySource(binaryPath)
  const version = installed ? await getCuaDriverVersion(binaryPath!) : null

  if (!installed) {
    return {
      platform,
      platformSupported,
      installed: false,
      binaryPath: null,
      version: null,
      source: null,
      ready: false,
      canGrant,
      checks: [],
      // macOS 上「找不到二进制」几乎都是「bundle 没落地」，说清楚才有下一步。
      error: platform === 'darwin'
        ? `${CUA_DRIVER_APP_NAME} 未安装到 /Applications —— 驱动需要 bundle 身份才能持有 TCC 授权，点「安装」即可。`
        : 'cua-driver binary not found',
      permissions: emptyPermissions(),
    }
  }

  // 获取权限状态（macOS）
  let permissions: CuaDriverPermissions = emptyPermissions()
  if (canGrant) {
    permissions = await getPermissionsStatus()
  }

  // 获取健康检查
  let healthResult: { ok: boolean; checks: HealthCheck[] } = { ok: false, checks: [] }
  try {
    healthResult = await runHealthReport()
  } catch (e) {
    healthResult = {
      ok: false,
      checks: [{
        label: 'health_report',
        status: 'fail',
        message: `Health check failed: ${e}`,
      }],
    }
  }

  // 就绪条件：
  // - macOS: accessibility && screenRecording && health.ok
  // - Windows/Linux: health.ok
  //
  // macOS 上必须把「读不到」和「读到了但没授权」分开。把 null 当 false 会让
  // bundle 身份缺失显示成「未就绪，请去系统设置」，而用户已经去授权过了 ——
  // 这正是本次故障的表象。null 一路传到 UI 的三态横幅。
  //
  // screenRecordingCapturable === false 压过 preflight 的 true：上游明确说
  // 两者不一致时，那份授权属于另一个进程，驱动实际抓不到屏，不该报就绪。
  let ready: boolean | null
  if (canGrant) {
    const { accessibility, screenRecording, screenRecordingCapturable } = permissions
    if (accessibility === null || screenRecording === null) {
      ready = null
    } else if (screenRecording && screenRecordingCapturable === false) {
      ready = false
    } else {
      ready = accessibility && screenRecording && healthResult.ok
    }
  } else {
    ready = healthResult.ok
  }

  return {
    platform,
    platformSupported,
    installed: true,
    binaryPath,
    version,
    source,
    ready,
    canGrant,
    checks: healthResult.checks,
    error: null,
    permissions,
  }
}

// ── 直接工具调用 ───────────────────────────────────────────────

/**
 * 直接调用 cua-driver MCP 工具（用于 UI 扩展功能）。
 * 每次调用使用长连接 MCP 客户端。
 */
export async function callToolDirectly(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const client = await getMcpClient()
  return client.callTool(name, args)
}

// ── IPC Handler 注册 ───────────────────────────────────────────

/** 注册所有 cua-driver 相关的 IPC handlers */
export function registerCuaDriverIPCHandlers(): void {
  ipcMain.handle('cua-driver:status', () => getComputerUseStatus())

  ipcMain.handle('cua-driver:install', () => installCuaDriver())

  ipcMain.handle('cua-driver:doctor', (_e, fresh?: boolean) =>
    runHealthReport({ fresh: Boolean(fresh) }),
  )

  ipcMain.handle('cua-driver:permissions:status', () => getPermissionsStatus())

  ipcMain.handle('cua-driver:permissions:grant', () => grantPermissions())

  // 丢掉当前驱动子进程，下一次探测会重新拉起。macOS 改完授权后必须换进程才看得见。
  ipcMain.handle('cua-driver:restart', async () => {
    await cleanupCuaDriverMcp()
    return { success: true }
  })

  ipcMain.handle('cua-driver:check-update', () => checkUpdate())

  ipcMain.handle('cua-driver:tool', (_e, name: string, args: Record<string, unknown>) =>
    callToolDirectly(name, args),
  )

  info('CuaDriverService', 'IPC handlers registered')
}
