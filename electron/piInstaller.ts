/**
 * Pi SDK 安装器（深模块）。
 *
 * 从 claudeCodeIPC.ts 的 installPiSdk handler 中抽出进程管理逻辑：
 * npm/bun spawn、平台检测、bundled-binary 路径解析、超时处理、fallback 迭代。
 *
 * 抽出后 IPC handler 退化成 1 行转发，逻辑可在不 mock ipcMain 的情况下单测。
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { info } from './logger'

export interface InstallResult {
  success: boolean
  error?: string
}

/** 安装超时（毫秒） */
const INSTALL_TIMEOUT_MS = 120_000

/** Pi SDK 包名 */
const PI_SDK_PACKAGE = '@mariozechner/pi-coding-agent'

/**
 * 构建 installer 候选列表（按优先级排序）。
 *
 * 顺序：npm → bundled bun（如果存在）→ global bun
 */
function buildInstallerCandidates(): Array<{
  cmd: string
  args: string[]
  label: string
}> {
  const platform = process.platform
  const installers: Array<{ cmd: string; args: string[]; label: string }> = [
    { cmd: 'npm', args: ['install', '-g', PI_SDK_PACKAGE], label: 'npm' },
  ]

  // Check if bun is available (bundled or global)
  const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
  const resourcesDir = process.resourcesPath || ''
  const bundledBun = join(resourcesDir, 'engine', 'bin', bunName)
  const devBun = join(__dirname, '../../engine/bin', bunName)

  if (existsSync(bundledBun) || existsSync(devBun)) {
    const bunPath = existsSync(bundledBun) ? bundledBun : devBun
    installers.push({
      cmd: bunPath,
      args: ['install', '-g', PI_SDK_PACKAGE],
      label: 'bundled bun',
    })
  }
  installers.push({
    cmd: 'bun',
    args: ['install', '-g', PI_SDK_PACKAGE],
    label: 'global bun',
  })

  return installers
}

/**
 * 尝试用单个 installer 安装 Pi SDK。
 *
 * spawn 子进程，收集 stdout/stderr，等待退出码或超时。
 */
function tryInstall(
  installer: { cmd: string; args: string[]; label: string },
  platform: string,
): Promise<InstallResult> {
  return new Promise((resolve) => {
    const child = spawn(installer.cmd, installer.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: platform === 'win32',
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({
          success: false,
          error: `${installer.label} exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
        })
      }
    })
    child.on('error', (err: Error) => {
      resolve({ success: false, error: `${installer.label} failed: ${err.message}` })
    })
    setTimeout(() => {
      child.kill()
      resolve({ success: false, error: `${installer.label} timed out after ${INSTALL_TIMEOUT_MS / 1000}s` })
    }, INSTALL_TIMEOUT_MS)
  })
}

/**
 * 安装 Pi SDK（@mariozechner/pi-coding-agent）。
 *
 * 依次尝试 npm → bundled bun → global bun，首个成功即返回。
 * 全部失败时返回最后一个错误。
 *
 * @param onProgress 进度回调，接收每个 installer 的尝试/成功/失败日志
 * @returns 安装结果
 */
export async function installPiSdk(
  onProgress?: (msg: string) => void,
): Promise<InstallResult> {
  const platform = process.platform
  const installers = buildInstallerCandidates()

  let lastError: string | null = null

  for (const installer of installers) {
    const msg = `Trying ${installer.label}: ${installer.cmd} ${installer.args.join(' ')}`
    info('PiInstaller', msg)
    onProgress?.(msg)

    try {
      const result = await tryInstall(installer, platform)

      if (result.success) {
        const successMsg = `Pi SDK installed successfully via ${installer.label}`
        info('PiInstaller', successMsg)
        onProgress?.(successMsg)
        return { success: true }
      }

      lastError = result.error || 'Unknown error'
      const failMsg = `${installer.label} failed: ${lastError}`
      info('PiInstaller', failMsg)
      onProgress?.(failMsg)
    } catch (err) {
      lastError = String(err)
      const errMsg = `${installer.label} threw: ${lastError}`
      info('PiInstaller', errMsg)
      onProgress?.(errMsg)
    }
  }

  return {
    success: false,
    error: lastError || 'No installer available. Please install Node.js or Bun first.',
  }
}
