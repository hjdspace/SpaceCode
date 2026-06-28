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
import { app, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { spawn, execFile } from 'child_process'
import { info, warn, error as logError } from './logger'
import { CuaDriverMcpClient } from './cuaDriverMcpClient'
import type {
  CuaDriverStatus,
  HealthCheck,
  McpToolResult,
  CuaDriverUpdateInfo,
  CuaDriverPermissions,
} from '../src/types/computerUse'

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
 * 优先级：
 * 1. 环境变量 CUA_DRIVER_CMD
 * 2. 系统 PATH 上的 cua-driver（用户自行安装的最新版）
 * 3. 应用内置的 cua-driver（随 SpaceCode 打包）
 *
 * 返回 null 表示未找到。
 */
export function findCuaDriverBinary(): string | null {
  // 1. 环境变量覆盖
  const envCmd = process.env[CUA_DRIVER_ENV_VAR]
  if (envCmd && existsSync(envCmd)) return envCmd

  // 2. 检查系统 PATH（使用 which/where）
  const systemPath = findInPath(CUA_DRIVER_BIN)
  if (systemPath) return systemPath

  // 3. 检查内置二进制（应用 resources/cua-driver/ 目录）
  const bundledPath = findBundledBinary()
  if (bundledPath) return bundledPath

  return null
}

/** 在系统 PATH 中查找可执行文件 */
function findInPath(binName: string): string | null {
  try {
    const { execSync } = require('child_process')
    const cmd = process.platform === 'win32' ? `where ${binName}` : `which ${binName}`
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] })
    const path = result.trim().split('\n')[0].trim()
    if (path && existsSync(path)) return path
  } catch {
    // not in PATH
  }
  return null
}

/** 查找内置的 cua-driver 二进制 */
function findBundledBinary(): string | null {
  const binName = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'cua-driver', binName)]
    : [
        join(__dirname, '..', 'cua-driver', binName),
        join(__dirname, '..', '..', 'cua-driver', binName),
        join(__dirname, '..', '..', 'resources', 'cua-driver', binName),
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
 * bundled = 随应用打包；system = 用户自行安装。
 */
function getBinarySource(binaryPath: string | null): 'bundled' | 'system' | null {
  if (!binaryPath) return null
  // 内置二进制路径包含 resources/cua-driver 或 cua-driver 子目录
  if (
    binaryPath.includes('resources') && binaryPath.includes('cua-driver')
  ) return 'bundled'
  if (
    !app.isPackaged &&
    (binaryPath.includes(join('cua-driver')) || binaryPath.includes(join('resources', 'cua-driver')))
  ) return 'bundled'
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
 */
export async function runHealthReport(): Promise<{ ok: boolean; checks: HealthCheck[] }> {
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

/**
 * 查询 macOS TCC 权限状态。
 *
 * 对齐 hermes-agent 的 permissions.py — 调用 `cua-driver permissions status --json`。
 * Windows/Linux 无 TCC 模型，返回 null。
 */
export async function getPermissionsStatus(): Promise<CuaDriverPermissions> {
  if (process.platform !== 'darwin') {
    return { accessibility: null, screenRecording: null }
  }

  const binaryPath = findCuaDriverBinary()
  if (!binaryPath) {
    return { accessibility: null, screenRecording: null }
  }

  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['permissions', 'status', '--json'],
      { timeout: 10_000, env: { ...process.env, [CUA_TELEMETRY_ENV]: '0' } },
      (err, stdout) => {
        if (err) {
          warn('CuaDriverService', `permissions status failed: ${err.message}`)
          resolve({ accessibility: null, screenRecording: null })
          return
        }
        try {
          const data = JSON.parse(stdout.trim())
          resolve({
            accessibility: data.accessibility ?? null,
            screenRecording: data.screen_recording ?? data.screenRecording ?? null,
          })
        } catch {
          resolve({ accessibility: null, screenRecording: null })
        }
      },
    )
  })
}

/**
 * 请求 macOS TCC 权限。
 * 会弹出系统设置对话框，需要用户手动授权。
 */
export async function grantPermissions(): Promise<{ success: boolean; error?: string }> {
  if (process.platform !== 'darwin') {
    return { success: false, error: 'TCC permissions are only available on macOS' }
  }

  const binaryPath = findCuaDriverBinary()
  if (!binaryPath) {
    return { success: false, error: 'cua-driver binary not found' }
  }

  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['permissions', 'grant'],
      { timeout: 30_000, env: { ...process.env, [CUA_TELEMETRY_ENV]: '0' } },
      (err) => {
        if (err) {
          resolve({ success: false, error: err.message })
          return
        }
        resolve({ success: true })
      },
    )
  })
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

// ── 安装/升级 ──────────────────────────────────────────────────

/**
 * 安装或升级 cua-driver。
 *
 * 考虑到 GitHub 网络问题，安装可能较慢。此方法调用上游安装脚本：
 * - Windows: PowerShell irm ... | iex
 * - macOS/Linux: bash curl ... | bash
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

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>

    if (isWindows) {
      const psScript = `irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex`
      proc = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', psScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, [CUA_TELEMETRY_ENV]: '0' },
        windowsHide: true,
      })
    } else {
      const cmd = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"`
      proc = spawn('bash', ['-c', cmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, [CUA_TELEMETRY_ENV]: '0' },
      })
    }

    let stderr = ''
    proc.stdout?.on('data', (data: Buffer) => {
      info('CuaDriverService', `install stdout: ${data.toString().trim()}`)
    })
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
      warn('CuaDriverService', `install stderr: ${data.toString().trim()}`)
    })
    proc.on('error', (err) => {
      logError('CuaDriverService', `install failed: ${err.message}`)
      resolve({ success: false, error: err.message })
    })
    proc.on('exit', (code) => {
      if (code === 0) {
        info('CuaDriverService', 'cua-driver installation completed successfully')
        resolve({ success: true })
      } else {
        const errorMsg = `Installation exited with code ${code}${stderr ? ': ' + stderr.trim() : ''}`
        logError('CuaDriverService', errorMsg)
        resolve({ success: false, error: errorMsg })
      }
    })

    // 5 分钟超时（网络下载可能较慢）
    setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        // ignore
      }
      resolve({ success: false, error: 'Installation timed out after 5 minutes' })
    }, 5 * 60 * 1000)
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
      error: 'cua-driver binary not found',
      accessibility: null,
      screenRecording: null,
    }
  }

  // 获取权限状态（macOS）
  let permissions: CuaDriverPermissions = { accessibility: null, screenRecording: null }
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
  let ready: boolean | null
  if (canGrant) {
    ready = Boolean(permissions.accessibility) && Boolean(permissions.screenRecording) && healthResult.ok
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
    accessibility: permissions.accessibility,
    screenRecording: permissions.screenRecording,
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

  ipcMain.handle('cua-driver:doctor', () => runHealthReport())

  ipcMain.handle('cua-driver:permissions:status', () => getPermissionsStatus())

  ipcMain.handle('cua-driver:permissions:grant', () => grantPermissions())

  ipcMain.handle('cua-driver:check-update', () => checkUpdate())

  ipcMain.handle('cua-driver:tool', (_e, name: string, args: Record<string, unknown>) =>
    callToolDirectly(name, args),
  )

  info('CuaDriverService', 'IPC handlers registered')
}
