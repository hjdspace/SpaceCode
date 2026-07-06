/**
 * Browser-Use 核心服务：Python 检测、pip 安装、MCP 会话管理、健康检查。
 *
 * Browser Use 通过 Python 子进程运行 MCP bridge script，
 * 由 Electron 主进程管理其生命周期，通过 IPC 暴露给渲染进程。
 *
 * 架构：
 * 1. 检测系统 Python 3.11+（复用 sessionProcess 的 detectPythonPaths 模式）
 * 2. 自动 pip install browser-use（带进度上报）
 * 3. 启动 browser-use bridge.py 子进程（MCP over stdio）
 * 4. 提供健康检查、截图轮播、导航控制等能力
 */
import { app, ipcMain, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { spawn, execFile } from 'child_process'
import { info, warn, error as logError } from './logger'
import { BrowserUseMcpClient } from './browserUseMcpClient'
import type {
  BrowserUseStatus,
  BrowserUseHealthCheck,
  BrowserUseToolResult,
  BrowserUseUpdateInfo,
  BrowserUseInstallProgress,
  BrowserUseInstallOptions,
  BrowserUseLiveSnapshot,
  BrowserUseAgentConfig,
} from '../src/types/browserUse'

// ── Constants ──────────────────────────────────────────────────

/** Python 最低版本要求 */
const MIN_PYTHON_MAJOR = 3
const MIN_PYTHON_MINOR = 11

/** browser-use 包名 */
const BROWSER_USE_PACKAGE = 'browser-use'

/** bridge script 文件名 */
const BRIDGE_SCRIPT = 'bridge.py'

/** 环境变量中浏览器 use 的 API Key */
const BU_API_KEY_ENV = 'BROWSER_USE_API_KEY'

/** 长连接 MCP 客户端 */
let mcpClient: BrowserUseMcpClient | null = null

/** 截图轮播定时器 */
let screenshotInterval: ReturnType<typeof setInterval> | null = null

/** 最近一次实时快照 */
let lastSnapshot: BrowserUseLiveSnapshot | null = null

// ── 中国镜像源配置 ──────────────────────────────────────────────

/**
 * pip 镜像源映射。
 * npmmirror 没有标准 PyPI simple index，pip 安装回退到清华源；
 * npmmirror 仅用于 Playwright Chromium 二进制下载加速。
 */
const PIP_MIRRORS: Record<string, string> = {
  tsinghua: 'https://pypi.tuna.tsinghua.edu.cn/simple',
  aliyun: 'https://mirrors.aliyun.com/pypi/simple/',
  npmmirror: 'https://pypi.tuna.tsinghua.edu.cn/simple',
}

/** pip 镜像源的 trusted-host（https + 非官方源需要） */
const PIP_TRUSTED_HOSTS: Record<string, string[]> = {
  tsinghua: ['pypi.tuna.tsinghua.edu.cn'],
  aliyun: ['mirrors.aliyun.com'],
  npmmirror: ['pypi.tuna.tsinghua.edu.cn'],
}

/**
 * Playwright Chromium 下载镜像。
 * 通过 PLAYWRIGHT_DOWNLOAD_HOST 环境变量指定 CDN 前缀。
 * npmmirror 维护了 Playwright 二进制镜像：https://npmmirror.com/mirrors/playwright/
 * 清华、阿里无 Playwright CDN 镜像，回退到 npmmirror 或官方。
 */
const PLAYWRIGHT_MIRROR_HOSTS: Record<string, string> = {
  npmmirror: 'https://npmmirror.com/mirrors/playwright',
  tsinghua: 'https://npmmirror.com/mirrors/playwright',
  aliyun: 'https://playwright.azureedge.net',  // 阿里无专门镜像，回退官方
}

/** Agent 配置缓存 */
let agentConfig: BrowserUseAgentConfig = {
  provider: 'ChatBrowserUse',
  model: 'bu-2-0',
  apiKeyMasked: false,
  maxSteps: 50,
  temperature: 0.1,
  useVision: true,
  headless: true,
  allowedDomains: [],
  userDataDir: null,
  downloadsPath: null,
  useCloud: false,
  maxActionsPerStep: 3,
  maxFailures: 3,
  useThinking: true,
  flashMode: false,
  extendSystemMessage: null,
}


// ── Python Detection ──────────────────────────────────────────

/**
 * 检测系统 Python 3.11+ 可执行文件路径。
 *
 * 检测策略（与 sessionProcess.ts 的 detectPythonPaths 对齐）：
 * 1. 环境变量 PYTHON_PATH 覆盖
 * 2. 系统 PATH 上的 python3 / python
 * 3. Windows: %LOCALAPPDATA%\Programs\Python\Python3XX\
 * 4. Mac: /usr/local/bin/python3, /opt/homebrew/bin/python3
 * 5. Linux: /usr/bin/python3
 */
export function findPython(): { path: string; version: string } | null {
  // 1. 环境变量覆盖
  const envPython = process.env.PYTHON_PATH
  if (envPython && existsSync(envPython)) {
    const version = getPythonVersion(envPython)
    if (version && isPythonVersionValid(version)) {
      return { path: envPython, version }
    }
  }

  // 2. 系统 PATH
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python']

  for (const cmd of candidates) {
    const path = findInPath(cmd)
    if (path) {
      const version = getPythonVersion(path)
      if (version && isPythonVersionValid(version)) {
        return { path, version }
      }
    }
  }

  // 3. 已知安装位置
  const knownPaths = getKnownPythonPaths()
  for (const path of knownPaths) {
    if (existsSync(path)) {
      const version = getPythonVersion(path)
      if (version && isPythonVersionValid(version)) {
        return { path, version }
      }
    }
  }

  return null
}

/** 在系统 PATH 中查找可执行文件 */
function findInPath(binName: string): string | null {
  try {
    const { execFileSync } = require('child_process')
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const result = execFileSync(cmd, [binName], { encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] })
    const path = result.trim().split('\n')[0].trim()
    if (path && existsSync(path)) return path
  } catch {
    // not in PATH
  }
  return null
}

/** 获取已知 Python 安装位置 */
function getKnownPythonPaths(): string[] {
  const paths: string[] = []
  const home = require('os').homedir()

  if (process.platform === 'win32') {
    // python.org installer
    if (process.env.LOCALAPPDATA) {
      const pythonDir = join(process.env.LOCALAPPDATA, 'Programs', 'Python')
      try {
        const fs = require('fs')
        for (const entry of fs.readdirSync(pythonDir)) {
          if (/^Python\d+/i.test(entry)) {
            paths.push(join(pythonDir, entry, 'python.exe'))
          }
        }
      } catch {}
    }
    // Windows Store
    if (process.env.LOCALAPPDATA) {
      paths.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'python.exe'))
    }
  } else if (process.platform === 'darwin') {
    paths.push('/usr/local/bin/python3')
    paths.push('/opt/homebrew/bin/python3')
    paths.push(join(home, '.pyenv', 'versions'))
  } else {
    paths.push('/usr/bin/python3')
    paths.push('/usr/local/bin/python3')
  }

  return paths
}

/** 获取 Python 版本号（调用 python --version） */
function getPythonVersion(pythonPath: string): string | null {
  try {
    const { execFileSync } = require('child_process')
    const result = execFileSync(pythonPath, ['--version'], { encoding: 'utf-8', timeout: 8_000 })
    const match = result.trim().match(/(\d+)\.(\d+)\.(\d+)/)
    return match ? `${match[1]}.${match[2]}.${match[3]}` : null
  } catch {
    return null
  }
}

/** 检查 Python 版本是否满足最低要求 */
function isPythonVersionValid(version: string): boolean {
  const parts = version.split('.').map(Number)
  return parts[0] > MIN_PYTHON_MAJOR ||
    (parts[0] === MIN_PYTHON_MAJOR && parts[1] >= MIN_PYTHON_MINOR)
}


// ── pip Package Detection ─────────────────────────────────────

/**
 * 检测系统是否安装了 uv（Astral 的 Python 包管理器）。
 * AGENTS.md 要求优先使用 uv 而非 pip。
 */
function findUv(): string | null {
  // 1. 环境变量覆盖
  const envUv = process.env.UV_PATH
  if (envUv && existsSync(envUv)) return envUv

  // 2. 系统 PATH
  const candidates = process.platform === 'win32' ? ['uv', 'uv.exe'] : ['uv']
  for (const cmd of candidates) {
    const path = findInPath(cmd)
    if (path) return path
  }

  // 3. 已知安装位置
  const home = require('os').homedir()
  const knownPaths = process.platform === 'win32'
    ? [join(home, '.local', 'bin', 'uv.exe'), join(home, '.cargo', 'bin', 'uv.exe')]
    : [join(home, '.local', 'bin', 'uv'), join(home, '.cargo', 'bin', 'uv')]
  for (const path of knownPaths) {
    if (existsSync(path)) return path
  }

  return null
}

/**
 * 检测 browser-use 是否已安装。
 * 仅检查 import 是否成功，不依赖 __version__ 属性（部分版本可能未定义）。
 */
function isBrowserUseInstalled(pythonPath: string): boolean {
  try {
    const { execFileSync } = require('child_process')
    execFileSync(pythonPath, ['-c', 'import browser_use'], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/** 检测 playwright Python 包是否已安装（browser-use 依赖，但某些环境下可能缺失） */
function isPlaywrightPackageInstalled(pythonPath: string): boolean {
  try {
    const { execFileSync } = require('child_process')
    execFileSync(pythonPath, ['-c', 'import playwright'], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/** 获取 browser-use 已安装版本 */
function getBrowserUseVersion(pythonPath: string): string | null {
  try {
    const { execFileSync } = require('child_process')
    const result = execFileSync(pythonPath, [
      '-c', 'import browser_use; print(getattr(browser_use, "__version__", "unknown"))'
    ], { encoding: 'utf-8', timeout: 10_000 })
    const v = result.trim()
    return v && v !== 'unknown' ? v : null
  } catch {
    return null
  }
}

/** 检测 Playwright Chromium 是否已安装 */
function isChromiumInstalled(pythonPath: string): boolean {
  try {
    const { execFileSync } = require('child_process')
    execFileSync(pythonPath, [
      '-c', 'from playwright.sync_api import sync_playwright; sync_playwright().__enter__()'
    ], { encoding: 'utf-8', timeout: 15_000 })
    return true
  } catch {
    return false
  }
}


// ── Install Progress ──────────────────────────────────────────

/** 向渲染进程推送安装进度 */
function sendInstallProgress(progress: BrowserUseInstallProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('browser-use:installProgress', progress)
  }
}

/** 向渲染进程推送实时快照 */
function sendLiveSnapshot(snapshot: BrowserUseLiveSnapshot): void {
  lastSnapshot = snapshot
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('browser-use:liveSnapshot', snapshot)
  }
}


// ── Installation ──────────────────────────────────────────────

const maxBuffer = 1024 * 1024 // 1MB

/**
 * 安装 browser-use + Playwright Chromium。
 *
 * 安装步骤（遵循 AGENTS.md：优先使用 uv 而非 pip）：
 * 1. 检测 Python 3.11+
 * 2. 检测 uv（有则用 uv pip install，无则回退 pip）
 * 3. 安装 browser-use（可选中国镜像加速，已安装则跳过）
 * 4. 确保 playwright Python 包已安装（缺失时自动补装）
 * 5. 安装 Chromium（优先 `uvx browser-use install`，回退 `playwright install chromium`）
 *
 * 每一步都有实时进度上报和错误处理。
 *
 * @param options 安装选项（镜像源选择）
 */
export async function installBrowserUse(
  options?: BrowserUseInstallOptions,
): Promise<{ success: boolean; error?: string }> {
  const useMirror = options?.useMirror ?? false
  const mirrorType = options?.mirrorType ?? 'tsinghua'

  info('BrowserUseService', `Starting browser-use installation (mirror: ${useMirror ? mirrorType : 'official'})...`)
  sendInstallProgress({ stage: 'detecting', message: '正在检测 Python 3.11+...', percent: 5 })

  // 1. 检测 Python
  const pythonResult = findPython()
  if (!pythonResult) {
    const msg = 'Python 3.11+ not found. Please install Python from python.org'
    sendInstallProgress({ stage: 'error', message: msg, percent: 100 })
    return { success: false, error: msg }
  }
  info('BrowserUseService', `Found Python: ${pythonResult.path} (v${pythonResult.version})`)

  // 1.5 检测 uv（AGENTS.md 要求优先使用 uv）
  const uvPath = findUv()
  const installer = uvPath ? 'uv' : 'pip'
  info('BrowserUseService', `Package installer: ${installer}${uvPath ? ` (${uvPath})` : ''}`)

  const mirrorLabel = useMirror ? `（${mirrorType === 'tsinghua' ? '清华' : mirrorType === 'aliyun' ? '阿里' : 'npmmirror'} 镜像）` : ''
  const installerLabel = uvPath ? 'uv' : 'pip'
  sendInstallProgress({ stage: 'installing_pip', message: `找到 Python ${pythonResult.version}，正在使用 ${installerLabel} 安装 browser-use${mirrorLabel}...`, percent: 15 })

  // 2. 安装 browser-use（已安装则跳过，加速重装）
  if (isBrowserUseInstalled(pythonResult.path)) {
    info('BrowserUseService', 'browser-use already installed, skipping')
    sendInstallProgress({ stage: 'installing_pip', message: 'browser-use 已安装，正在检查 Playwright...', percent: 50 })
  } else {
    try {
      await runPackageInstall(pythonResult.path, BROWSER_USE_PACKAGE, useMirror, mirrorType, uvPath, (percent, msg) => {
        sendInstallProgress({ stage: 'installing_pip', message: msg, percent })
      }, 15, 50)
      info('BrowserUseService', 'browser-use installed successfully')
      sendInstallProgress({ stage: 'installing_pip', message: 'browser-use 安装完成，正在检查 Playwright...', percent: 50 })
    } catch (e) {
      const msg = `安装 browser-use 失败: ${e}`
      sendInstallProgress({ stage: 'error', message: msg, percent: 100 })
      return { success: false, error: msg }
    }
  }

  // 2.5. 确保 playwright Python 包已安装（browser-use 依赖 playwright，但某些环境下可能未正确安装）
  if (!isPlaywrightPackageInstalled(pythonResult.path)) {
    info('BrowserUseService', 'Playwright package not found, installing playwright...')
    sendInstallProgress({ stage: 'installing_pip', message: '正在安装 Playwright Python 包...', percent: 52 })
    try {
      await runPackageInstall(pythonResult.path, 'playwright', useMirror, mirrorType, uvPath, (percent, msg) => {
        sendInstallProgress({ stage: 'installing_pip', message: msg, percent })
      }, 52, 55)
      info('BrowserUseService', 'Playwright package installed successfully')
    } catch (e) {
      const msg = `安装 Playwright 包失败: ${e}`
      sendInstallProgress({ stage: 'error', message: msg, percent: 100 })
      return { success: false, error: msg }
    }
  }

  sendInstallProgress({ stage: 'installing_pip', message: '正在安装 Playwright Chromium...', percent: 55 })

  // 3. 安装 Chromium（优先 `uvx browser-use install`，回退 `playwright install chromium`）
  try {
    await runChromiumInstall(pythonResult.path, uvPath, useMirror, mirrorType, (percent, msg) => {
      sendInstallProgress({ stage: 'installing_playwright', message: msg, percent })
    })
    info('BrowserUseService', 'Playwright Chromium installed successfully')
    sendInstallProgress({ stage: 'installing_playwright', message: 'Playwright Chromium 安装完成。', percent: 95 })
  } catch (e) {
    const msg = `安装 Chromium 失败: ${e}`
    sendInstallProgress({ stage: 'error', message: msg, percent: 100 })
    return { success: false, error: msg }
  }

  sendInstallProgress({ stage: 'done', message: 'Browser-Use 安装完成！', percent: 100 })
  return { success: true }
}

/**
 * 统一的包安装函数（支持 uv 和 pip）。
 *
 * AGENTS.md 要求优先使用 uv 而非 pip。uv 的依赖解析速度比 pip 快 10-100 倍。
 * 当 uvPath 存在时使用 `uv pip install`，否则回退到 `python -m pip install`。
 *
 * uv / pip 的输出格式一致：
 *   "Collecting browser-use" / "Resolved X packages" → 下载中
 *   "Downloading ... (1.2 MB)" → 显示下载大小
 *   "Installing collected packages" / "Installed X packages" → 安装中
 */
function runPackageInstall(
  pythonPath: string,
  packageName: string,
  useMirror: boolean,
  mirrorType: string,
  uvPath: string | null,
  onProgress: (percent: number, message: string) => void,
  startPercent = 15,
  endPercent = 55,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let command: string
    let args: string[]

    if (uvPath) {
      // uv pip install（需要指定 --python 以安装到正确的 Python 环境）
      command = uvPath
      args = ['pip', 'install', packageName, '--python', pythonPath, '--upgrade']
    } else {
      // 回退到 pip
      command = pythonPath
      args = ['-m', 'pip', 'install', packageName, '--upgrade', '--disable-pip-version-check']
    }

    // 镜像源（uv 和 pip 都支持 -i / --index-url）
    if (useMirror && PIP_MIRRORS[mirrorType]) {
      args.push('-i', PIP_MIRRORS[mirrorType])
      const trustedHosts = PIP_TRUSTED_HOSTS[mirrorType]
      if (trustedHosts?.length) {
        args.push('--trusted-host', ...trustedHosts)
      }
    }

    info('BrowserUseService', `${command} ${args.join(' ')}`)

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stderr = ''
    let lastPercent = startPercent
    const range = endPercent - startPercent
    const collectMax = startPercent + Math.floor(range * 0.5)
    const downloadMax = startPercent + Math.floor(range * 0.7)
    const installingPercent = startPercent + Math.floor(range * 0.85)

    const parseLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed) return
      info('BrowserUseService', `install: ${trimmed}`)

      // 解析 pip/uv 输出推断进度
      if (trimmed.startsWith('Collecting') || trimmed.startsWith('Resolved')) {
        lastPercent = Math.min(lastPercent + 2, collectMax)
        onProgress(lastPercent, `正在解析依赖: ${trimmed.replace('Collecting ', '').replace('Resolved ', '')}`)
      } else if (trimmed.startsWith('Downloading')) {
        lastPercent = Math.min(lastPercent + 3, downloadMax)
        onProgress(lastPercent, `下载中: ${trimmed.replace('Downloading ', '')}`)
      } else if (trimmed.includes('Installing collected packages') || trimmed.startsWith('Installed')) {
        onProgress(installingPercent, '正在安装依赖包...')
      } else if (trimmed.startsWith('Successfully installed') || trimmed.startsWith('Installed')) {
        onProgress(endPercent, `${packageName} 安装成功`)
      }
    }

    proc.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        parseLine(line)
      }
    })
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text
      // pip/uv 的下载进度信息也可能输出到 stderr
      for (const line of text.split('\n')) {
        parseLine(line)
      }
    })

    proc.on('error', (err) => reject(new Error(err.message)))
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `install exited with code ${code}`))
    })

    // 10 分钟超时（依赖较多，镜像源可能也较慢）
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('安装超时（10 分钟），请尝试使用中国镜像源'))
    }, 10 * 60 * 1000)

    // 进程退出时清理 timer
    proc.on('exit', () => clearTimeout(timer))
  })
}

/**
 * 运行 Chromium 安装（优先 `uvx browser-use install`，回退 `playwright install chromium`）。
 *
 * AGENTS.md 推荐使用 `uvx browser-use install` 安装 Chromium。
 * 当 uv 不可用时，回退到 `python -m playwright install chromium`。
 *
 * Playwright 下载输出格式：
 *   "Downloading Chromium 131.0.6778.87 from https://..." → 下载中
 *   "Chromium 131.0.6778.87 downloaded" → 下载完成
 *
 * 通过 PLAYWRIGHT_DOWNLOAD_HOST 环境变量指定镜像。
 */
function runChromiumInstall(
  pythonPath: string,
  uvPath: string | null,
  useMirror: boolean,
  mirrorType: string,
  onProgress: (percent: number, message: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = { ...process.env } as Record<string, string>

    // 镜像源：通过环境变量指定 Playwright 下载主机
    if (useMirror && PLAYWRIGHT_MIRROR_HOSTS[mirrorType]) {
      env.PLAYWRIGHT_DOWNLOAD_HOST = PLAYWRIGHT_MIRROR_HOSTS[mirrorType]
      info('BrowserUseService', `Using Playwright mirror: ${env.PLAYWRIGHT_DOWNLOAD_HOST}`)
    }

    let command: string
    let args: string[]

    if (uvPath) {
      // 优先使用 `uvx browser-use install`（AGENTS.md 推荐）
      command = uvPath
      args = ['x', 'browser-use', 'install']
      info('BrowserUseService', 'Using uvx browser-use install for Chromium')
    } else {
      // 回退到 `python -m playwright install chromium`
      command = pythonPath
      args = ['-m', 'playwright', 'install', 'chromium']
      info('BrowserUseService', 'Using playwright install chromium (uv not found)')
    }

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    })

    let stderr = ''
    let lastPercent = 55

    const parseLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed) return
      info('BrowserUseService', `chromium: ${trimmed}`)

      if (trimmed.startsWith('Downloading') && trimmed.includes('Chromium')) {
        // "Downloading Chromium 131.0.6778.87 from ..."
        lastPercent = 60
        const match = trimmed.match(/Chromium\s+([\d.]+)/)
        const ver = match ? match[1] : ''
        onProgress(60, `正在下载 Chromium ${ver}...`)
      } else if (trimmed.includes('downloaded')) {
        lastPercent = 85
        onProgress(85, 'Chromium 下载完成，正在解压...')
      } else if (trimmed.includes('Validating')) {
        onProgress(90, '正在验证安装...')
      } else if (trimmed.startsWith('Chromium') && trimmed.includes('installed')) {
        onProgress(95, 'Chromium 安装完成')
      } else if (trimmed.includes('Installing')) {
        onProgress(70, '正在安装 Chromium...')
      }
    }

    proc.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        parseLine(line)
      }
    })
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text
      for (const line of text.split('\n')) {
        parseLine(line)
      }
    })

    proc.on('error', (err) => reject(new Error(err.message)))
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const errText = stderr.trim()
      // 提供 "No module named playwright" 的友好提示
      if (errText.includes('No module named playwright')) {
        reject(new Error(
          'Playwright Python 包未安装。请先运行: pip install playwright，然后重试安装。',
        ))
      } else {
        reject(new Error(errText || `chromium install exited with code ${code}`))
      }
    })

    // 15 分钟超时（Chromium ~150MB，镜像源下载可能需要时间）
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('Chromium 下载超时（15 分钟），请尝试使用中国镜像源'))
    }, 15 * 60 * 1000)

    proc.on('exit', () => clearTimeout(timer))
  })
}


// ── MCP Client Management ─────────────────────────────────────

/** 获取 Bridge Script 路径 */
function getBridgeScriptPath(): string | null {
  const scriptName = BRIDGE_SCRIPT
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'browser-use', scriptName)]
    : [
        join(__dirname, '..', 'resources', 'browser-use', scriptName),
        join(__dirname, '..', '..', 'resources', 'browser-use', scriptName),
      ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

// ── Desktop LLM Config Reuse ─────────────────────────────────

/** 读取桌面程序 GUI 设置（~/.claude/gui-settings.json） */
function loadGuiSettings(): Record<string, any> | null {
  try {
    const settingsPath = join(app.getPath('home'), '.claude', 'gui-settings.json')
    if (!existsSync(settingsPath)) return null
    const raw = readFileSync(settingsPath, 'utf-8')
    if (!raw.trim()) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

interface DesktopLlmCredentials {
  /** 桌面配置的 LLM 提供商（与 browser-use provider 选项对齐） */
  provider: 'Anthropic' | 'OpenAI' | 'Google'
  apiKey: string
  baseUrl: string
  model: string
}

/**
 * 从桌面程序 GUI 设置中提取当前启用的 LLM 凭证。
 *
 * 桌面程序支持 Anthropic / OpenAI 兼容 / Gemini 三种 API Key 方式，
 * 通过 authMethod 标识当前启用哪一个。此处仅返回当前启用项的凭证，
 * 避免注入历史残留的其他 Provider Key 导致 browser-use 选错模型。
 * （claudeai / console 为 OAuth 方式，无 apiKey，返回 null）
 */
function getDesktopLlmCredentials(): DesktopLlmCredentials | null {
  const gui = loadGuiSettings()
  if (!gui) return null
  const authMethod = gui.authMethod as string | undefined

  const pick = (cfg: any, provider: DesktopLlmCredentials['provider']): DesktopLlmCredentials | null => {
    if (!cfg) return null
    const apiKey = (cfg.apiKey || '').trim()
    if (!apiKey) return null
    const baseUrl = (cfg.baseUrl || '').trim()
    const model = (cfg.sonnetModel || cfg.opusModel || cfg.haikuModel || '').trim()
    return { provider, apiKey, baseUrl, model }
  }

  if (authMethod === 'openai_compatible') return pick(gui.openaiConfig, 'OpenAI')
  if (authMethod === 'gemini_api') return pick(gui.geminiConfig, 'Google')
  if (authMethod === 'anthropic_compatible' || authMethod === 'claudeai' || authMethod === 'console') {
    return pick(gui.anthropicConfig, 'Anthropic')
  }
  return null
}

/** 构建浏览器 use 进程环境变量 */
function buildBUEnv(): Record<string, string> {
  const env: Record<string, string> = {}

  // 显式环境变量优先透传（保留对系统环境变量的兼容）
  const apiKey = process.env[BU_API_KEY_ENV]
  if (apiKey) env[BU_API_KEY_ENV] = apiKey
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (process.env.GOOGLE_API_KEY) env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY

  // 复用桌面程序 LLM 配置：当 browser-use 选定标准 Provider 且桌面启用了同一 Provider 时，
  // 注入对应 API Key + BaseUrl（仅当未显式设置 BROWSER_USE_API_KEY，即未使用 ChatBrowserUse 云服务时）
  if (!env[BU_API_KEY_ENV]) {
    const desktop = getDesktopLlmCredentials()
    if (desktop && desktop.provider === agentConfig.provider) {
      if (desktop.provider === 'Anthropic') {
        env.ANTHROPIC_API_KEY = desktop.apiKey
        if (desktop.baseUrl) env.ANTHROPIC_BASE_URL = desktop.baseUrl
      } else if (desktop.provider === 'OpenAI') {
        env.OPENAI_API_KEY = desktop.apiKey
        if (desktop.baseUrl) env.OPENAI_BASE_URL = desktop.baseUrl
      } else if (desktop.provider === 'Google') {
        env.GOOGLE_API_KEY = desktop.apiKey
        if (desktop.baseUrl) env.GEMINI_BASE_URL = desktop.baseUrl
      }
    }
  }

  // ── Agent 配置（全部传递给 bridge.py）──
  env.BU_LLM_PROVIDER = agentConfig.provider
  env.BU_LLM_MODEL = agentConfig.model
  env.BU_HEADLESS = String(agentConfig.headless)
  env.BU_USE_VISION = agentConfig.useVision ? 'true' : 'false'
  env.BU_TEMPERATURE = String(agentConfig.temperature)
  env.BU_MAX_STEPS = String(agentConfig.maxSteps)
  env.BU_MAX_ACTIONS_PER_STEP = String(agentConfig.maxActionsPerStep)
  env.BU_MAX_FAILURES = String(agentConfig.maxFailures)
  env.BU_USE_THINKING = agentConfig.useThinking ? 'true' : 'false'
  env.BU_FLASH_MODE = agentConfig.flashMode ? 'true' : 'false'
  env.BU_USE_CLOUD = agentConfig.useCloud ? 'true' : 'false'

  if (agentConfig.allowedDomains.length > 0) {
    env.BU_ALLOWED_DOMAINS = agentConfig.allowedDomains.join(',')
  }
  if (agentConfig.userDataDir) {
    env.BU_USER_DATA_DIR = agentConfig.userDataDir
  }
  if (agentConfig.downloadsPath) {
    env.BU_DOWNLOADS_PATH = agentConfig.downloadsPath
  }
  if (agentConfig.extendSystemMessage) {
    env.BU_EXTEND_SYSTEM_MESSAGE = agentConfig.extendSystemMessage
  }

  return env
}

/**
 * 构建 browser-use MCP 服务器配置（供 CLI --mcp-config 注入使用）。
 *
 * 当 browser-use 作为内置 MCP 预设启用时，mcpConfigStore.buildEnabledMcpConfig()
 * 调用此函数解析 Python 路径 + bridge.py 路径 + 环境变量，生成 CLI 可直接 spawn
 * 的 stdio MCP 服务器配置。
 *
 * @returns { command, args, env } 或 null（Python 或 bridge.py 不可用）
 */
export function getBrowserUseMcpServerConfig(): {
  command: string
  args: string[]
  env: Record<string, string>
} | null {
  const pythonResult = findPython()
  if (!pythonResult) return null

  const bridgePath = getBridgeScriptPath()
  if (!bridgePath) return null

  return {
    command: pythonResult.path,
    args: [bridgePath, '--mcp'],
    env: buildBUEnv(),
  }
}

/** 获取或创建长连接 MCP 客户端 */
async function getMcpClient(): Promise<BrowserUseMcpClient> {
  if (mcpClient?.isStarted) return mcpClient

  const pythonResult = findPython()
  if (!pythonResult) {
    throw new Error('Python 3.11+ not found')
  }

  const bridgePath = getBridgeScriptPath()
  if (!bridgePath) {
    throw new Error('Browser-use bridge script not found')
  }

  mcpClient = new BrowserUseMcpClient()
  await mcpClient.start(pythonResult.path, bridgePath, buildBUEnv())

  // 启动截图轮播（每秒获取一次快照）
  startScreenshotPolling()

  return mcpClient
}

/** 关闭并清理 MCP 客户端 */
export async function cleanupBrowserUseMcp(): Promise<void> {
  stopScreenshotPolling()
  if (mcpClient) {
    try {
      await mcpClient.stop()
    } catch {
      // ignore
    }
    mcpClient = null
  }
}

/** 停止 MCP 客户端（用于重新配置时） */
async function stopMcpClient(): Promise<void> {
  stopScreenshotPolling()
  if (mcpClient) {
    try {
      await mcpClient.stop()
    } catch {
      // ignore
    }
    mcpClient = null
  }
}


// ── Screenshot Polling (Live Preview) ─────────────────────────

function startScreenshotPolling(): void {
  stopScreenshotPolling()
  screenshotInterval = setInterval(async () => {
    try {
      if (!mcpClient?.isStarted) return
      const result = await mcpClient.callTool('get_info', {}, 10_000)
      // 如果有浏览器会话，获取截图
      if (result.data) {
        const info = result.data as { url: string; title?: string } | string
        if (typeof info === 'object' && info) {
          let screenshotBase64: string | null = null
          let agentStatus: BrowserUseLiveSnapshot['agentStatus'] = 'idle'
          
          // 尝试获取截图
          try {
            const ssResult = await mcpClient.callTool('screenshot', {}, 15_000)
            if (ssResult.images.length > 0) {
              screenshotBase64 = ssResult.images[0]
            }
            if (mcpClient.hasTool('browse')) agentStatus = 'running'
          } catch {
            // 截图失败不影响主流程
          }

          sendLiveSnapshot({
            screenshot: screenshotBase64,
            url: (info as any).url || '',
            title: (info as any).title || '',
            currentStep: 0,
            totalSteps: agentConfig.maxSteps,
            agentStatus,
            lastAction: null,
          })
        }
      }
    } catch {
      // 截图轮播失败，静默忽略
    }
  }, 2_000)
}

function stopScreenshotPolling(): void {
  if (screenshotInterval) {
    clearInterval(screenshotInterval)
    screenshotInterval = null
  }
}


// ── Health Check ──────────────────────────────────────────────

/**
 * 运行 browser-use 健康检查。
 * 通过 MCP 客户端调用 health_report 工具。
 */
export async function runHealthCheck(): Promise<{ ok: boolean; checks: BrowserUseHealthCheck[] }> {
  try {
    // 先做基本的 Python 和包检测（不依赖 MCP 连接）
    const pythonResult = findPython()
    const checks: BrowserUseHealthCheck[] = []

    // Python 检测
    if (pythonResult) {
      checks.push({
        label: 'python_runtime',
        status: 'pass',
        message: `Python ${pythonResult.version} at ${pythonResult.path}`,
      })
    } else {
      checks.push({
        label: 'python_runtime',
        status: 'fail',
        message: 'Python 3.11+ not found',
        hint: 'Install Python 3.11+ from python.org',
      })
    }

    // 尝试通过 MCP 获取完整健康报告
    if (mcpClient?.isStarted) {
      try {
        const result = await mcpClient.callTool('health_report', {}, 15_000)
        const sc = result.structuredContent as Record<string, unknown> | null
        if (sc && typeof sc === 'object') {
          const overall = sc.overall as string
          const rawChecks = Array.isArray(sc.checks) ? sc.checks : []
          for (const raw of rawChecks) {
            checks.push({
              label: String((raw as any).name ?? ''),
              status: (raw as any).status as BrowserUseHealthCheck['status'] ?? 'skip',
              message: String((raw as any).message ?? ''),
              hint: (raw as any).hint ? String((raw as any).hint) : undefined,
            })
          }
          return { ok: overall === 'ok', checks }
        }
      } catch (e) {
        checks.push({
          label: 'mcp_connection',
          status: 'fail',
          message: `MCP client connection failed: ${e}`,
          hint: 'Try restarting the browser-use service',
        })
      }
    } else {
      // 无 MCP 连接时，做本地检测
      if (pythonResult) {
        const buInstalled = isBrowserUseInstalled(pythonResult.path)
        checks.push({
          label: 'browser_use_package',
          status: buInstalled ? 'pass' : 'fail',
          message: buInstalled ? 'browser-use is installed' : 'browser-use is NOT installed',
          hint: buInstalled ? undefined : 'Run: pip install browser-use',
        })

        if (buInstalled) {
          const chromiumOk = isChromiumInstalled(pythonResult.path)
          checks.push({
            label: 'chromium_installation',
            status: chromiumOk ? 'pass' : 'fail',
            message: chromiumOk ? 'Chromium is installed' : 'Chromium is NOT installed',
            hint: chromiumOk ? undefined : 'Run: playwright install chromium',
          })
        }
      }

      const allPass = checks.every(c => c.status === 'pass')
      return { ok: allPass, checks }
    }

    return { ok: false, checks }
  } catch (e) {
    warn('BrowserUseService', `health check failed: ${e}`)
    return {
      ok: false,
      checks: [{
        label: 'health_check',
        status: 'fail',
        message: `Health check failed: ${e}`,
        hint: 'Ensure browser-use is properly installed',
      }],
    }
  }
}


// ── Status ────────────────────────────────────────────────────

/**
 * 获取 Browser-Use 完整就绪状态。
 */
export async function getBrowserUseStatus(): Promise<BrowserUseStatus> {
  const platform = process.platform
  const platformSupported = platform === 'win32' || platform === 'darwin' || platform === 'linux'
  const desktopCreds = getDesktopLlmCredentials()
  const envKeyPresent = Boolean(
    process.env[BU_API_KEY_ENV] ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_API_KEY
  )
  const isLLMConfigured = Boolean(desktopCreds?.apiKey) || envKeyPresent

  const pythonResult = findPython()
  const uvPath = findUv()
  let installed = false
  let buVersion: string | null = null
  let chromiumInstalled = false
  let source: 'system' | 'venv' | null = null

  if (pythonResult) {
    installed = isBrowserUseInstalled(pythonResult.path)
    if (installed) {
      buVersion = getBrowserUseVersion(pythonResult.path)
      chromiumInstalled = isChromiumInstalled(pythonResult.path)
      source = 'system'
    }
  }

  // 健康检查
  let healthResult: { ok: boolean; checks: BrowserUseHealthCheck[] } = { ok: false, checks: [] }
  try {
    healthResult = await runHealthCheck()
  } catch (e) {
    healthResult = {
      ok: false,
      checks: [{
        label: 'health_check',
        status: 'fail',
        message: `Health check failed: ${e}`,
      }],
    }
  }

  const ready = installed && chromiumInstalled && isLLMConfigured && healthResult.ok

  return {
    platform,
    platformSupported,
    installed,
    pythonPath: pythonResult?.path ?? null,
    pythonVersion: pythonResult?.version ?? null,
    browserUseVersion: buVersion,
    chromiumInstalled,
    uvInstalled: !!uvPath,
    source,
    llmConfigured: isLLMConfigured,
    llmProvider: desktopCreds?.provider ?? agentConfig.provider,
    llmModel: desktopCreds?.model || agentConfig.model,
    llmSource: desktopCreds ? 'desktop' : (envKeyPresent ? 'env' : null),
    ready: platformSupported ? (ready || null) : null,
    checks: healthResult.checks,
    error: null,
  }
}


// ── Tool Calls ────────────────────────────────────────────────

/**
 * 调用 browser-use MCP 工具。
 */
export async function callBrowserUseTool(
  name: string,
  args: Record<string, unknown>,
): Promise<BrowserUseToolResult> {
  const client = await getMcpClient()
  const result = await client.callTool(name, args)

  // 从结果中提取浏览器状态
  let currentUrl: string | null = null
  let pageTitle: string | null = null
  let stepsUsed = 0

  if (typeof result.data === 'object' && result.data) {
    const d = result.data as Record<string, unknown>
    currentUrl = (d.url as string) ?? null
    pageTitle = (d.title as string) ?? null
    stepsUsed = (d.steps_used as number) ?? 0
  }

  return {
    data: result.data,
    screenshots: result.images,
    currentUrl,
    pageTitle,
    isError: result.isError,
    stepsUsed,
  }
}


// ── Config Management ─────────────────────────────────────────

/** 更新 Agent 配置 */
export function updateAgentConfig(config: Partial<BrowserUseAgentConfig>): void {
  agentConfig = { ...agentConfig, ...config }
  info('BrowserUseService', `Agent config updated: ${JSON.stringify(config)}`)
}

/** 获取当前 Agent 配置 */
export function getAgentConfig(): BrowserUseAgentConfig {
  return { ...agentConfig }
}


// ── Navigation & Control ──────────────────────────────────────

/** 导航到指定 URL */
export async function browserNavigate(url: string): Promise<BrowserUseToolResult> {
  return callBrowserUseTool('navigate', { url })
}

/** 获取实时快照 */
export async function getLiveSnapshot(): Promise<BrowserUseLiveSnapshot | null> {
  return lastSnapshot
}


// ── IPC Handler Registration ──────────────────────────────────

/** 注册所有 browser-use 相关的 IPC handlers */
export function registerBrowserUseIPCHandlers(): void {
  ipcMain.handle('browser-use:status', () => getBrowserUseStatus())

  ipcMain.handle('browser-use:install', (_e, options?: BrowserUseInstallOptions) =>
    installBrowserUse(options),
  )

  ipcMain.handle('browser-use:doctor', () => runHealthCheck())

  ipcMain.handle('browser-use:check-update', () => {
    // browser-use 版本检查通过 pip index 实现
    return {
      updateAvailable: false,
      latestVersion: null,
      currentVersion: null,
    } as BrowserUseUpdateInfo
  })

  ipcMain.handle('browser-use:tool', (_e, name: string, args: Record<string, unknown>) =>
    callBrowserUseTool(name, args),
  )

  ipcMain.handle('browser-use:config', (_e, config?: Partial<BrowserUseAgentConfig>) => {
    if (config) {
      updateAgentConfig(config)
      // 如果 MCP 在运行且配置了 LLM 变更，需要重启
      if (mcpClient?.isStarted) {
        void stopMcpClient()
      }
    }
    return getAgentConfig()
  })

  ipcMain.handle('browser-use:navigate', (_e, url: string) => browserNavigate(url))

  ipcMain.handle('browser-use:liveSnapshot', () => getLiveSnapshot())

  info('BrowserUseService', 'IPC handlers registered')
}