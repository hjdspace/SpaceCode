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
import { existsSync } from 'fs'
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

/** pip 镜像源映射 */
const PIP_MIRRORS: Record<string, string> = {
  tsinghua: 'https://pypi.tuna.tsinghua.edu.cn/simple',
  aliyun: 'https://mirrors.aliyun.com/pypi/simple/',
  npmmirror: 'https://registry.npmmirror.com/-/binary/python-wheels/',
}

/** pip 镜像源的 trusted-host（https + 非官方源需要） */
const PIP_TRUSTED_HOSTS: Record<string, string[]> = {
  tsinghua: ['pypi.tuna.tsinghua.edu.cn'],
  aliyun: ['mirrors.aliyun.com'],
  npmmirror: ['registry.npmmirror.com'],
}

/**
 * Playwright Chromium 下载镜像。
 * 通过 PLAYWRIGHT_DOWNLOAD_HOST 环境变量指定 CDN 前缀。
 * npmmirror 的 Chromium 路径：https://npmmirror.com/mirrors/playwright/
 */
const PLAYWRIGHT_MIRROR_HOSTS: Record<string, string> = {
  npmmirror: 'https://npmmirror.com/mirrors/playwright',
  tsinghua: 'https://mirrors.tuna.tsinghua.edu.cn/github-release',
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
 * 检测 browser-use 是否已安装
 */
function isBrowserUseInstalled(pythonPath: string): boolean {
  try {
    const { execFileSync } = require('child_process')
    const result = execFileSync(pythonPath, [
      '-c', 'import browser_use; print(browser_use.__version__)'
    ], { encoding: 'utf-8', timeout: 10_000 })
    return result.trim().length > 0
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
 * 安装步骤：
 * 1. 检测 Python 3.11+
 * 2. pip install browser-use（可选中国镜像加速）
 * 3. playwright install chromium（可选中国镜像加速）
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

  const mirrorLabel = useMirror ? `（${mirrorType === 'tsinghua' ? '清华' : mirrorType === 'aliyun' ? '阿里' : 'npmmirror'} 镜像）` : ''
  sendInstallProgress({ stage: 'installing_pip', message: `找到 Python ${pythonResult.version}，正在安装 browser-use${mirrorLabel}...`, percent: 15 })

  // 2. pip install browser-use
  try {
    await runPipInstall(pythonResult.path, BROWSER_USE_PACKAGE, useMirror, mirrorType, (percent, msg) => {
      sendInstallProgress({ stage: 'installing_pip', message: msg, percent })
    })
    info('BrowserUseService', 'browser-use installed successfully')
    sendInstallProgress({ stage: 'installing_pip', message: 'browser-use 安装完成，正在安装 Playwright Chromium...', percent: 55 })
  } catch (e) {
    const msg = `安装 browser-use 失败: ${e}`
    sendInstallProgress({ stage: 'error', message: msg, percent: 100 })
    return { success: false, error: msg }
  }

  // 3. playwright install chromium
  try {
    await runPlaywrightInstall(pythonResult.path, useMirror, mirrorType, (percent, msg) => {
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
 * 运行 pip install（带实时进度解析和镜像源支持）。
 *
 * pip 的输出格式：
 *   "Collecting browser-use" → 下载中
 *   "Downloading ... (1.2 MB)" → 显示下载大小
 *   "Installing collected packages" → 安装中
 */
function runPipInstall(
  pythonPath: string,
  packageName: string,
  useMirror: boolean,
  mirrorType: string,
  onProgress: (percent: number, message: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-m', 'pip', 'install', packageName, '--upgrade', '--disable-pip-version-check']

    // 镜像源
    if (useMirror && PIP_MIRRORS[mirrorType]) {
      args.push('-i', PIP_MIRRORS[mirrorType])
      const trustedHosts = PIP_TRUSTED_HOSTS[mirrorType]
      if (trustedHosts?.length) {
        args.push('--trusted-host', ...trustedHosts)
      }
    }

    info('BrowserUseService', `pip install args: ${args.join(' ')}`)

    const proc = spawn(pythonPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stderr = ''
    let lastPercent = 15

    const parseLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed) return
      info('BrowserUseService', `pip: ${trimmed}`)

      // 解析 pip 输出推断进度
      if (trimmed.startsWith('Collecting')) {
        lastPercent = Math.min(lastPercent + 2, 40)
        onProgress(lastPercent, `正在下载依赖: ${trimmed.replace('Collecting ', '')}`)
      } else if (trimmed.startsWith('Downloading')) {
        lastPercent = Math.min(lastPercent + 3, 45)
        onProgress(lastPercent, `下载中: ${trimmed.replace('Downloading ', '')}`)
      } else if (trimmed.includes('Installing collected packages')) {
        onProgress(50, '正在安装依赖包...')
      } else if (trimmed.startsWith('Successfully installed')) {
        onProgress(55, 'browser-use 安装成功')
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
      // pip 的下载进度信息也可能输出到 stderr
      for (const line of text.split('\n')) {
        parseLine(line)
      }
    })

    proc.on('error', (err) => reject(new Error(err.message)))
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `pip install exited with code ${code}`))
    })

    // 10 分钟超时（pip 依赖较多，镜像源可能也较慢）
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('pip install 超时（10 分钟），请尝试使用中国镜像源'))
    }, 10 * 60 * 1000)

    // 进程退出时清理 timer
    proc.on('exit', () => clearTimeout(timer))
  })
}

/**
 * 运行 playwright install chromium（带实时进度解析和镜像源支持）。
 *
 * Playwright 下载输出格式：
 *   "Downloading Chromium 131.0.6778.87 from https://..." → 下载中
 *   "Chromium 131.0.6778.87 downloaded" → 下载完成
 *
 * 通过 PLAYWRIGHT_DOWNLOAD_HOST 环境变量指定镜像。
 */
function runPlaywrightInstall(
  pythonPath: string,
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

    const proc = spawn(pythonPath, ['-m', 'playwright', 'install', 'chromium'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    })

    let stderr = ''
    let lastPercent = 55

    const parseLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed) return
      info('BrowserUseService', `playwright: ${trimmed}`)

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
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `playwright install exited with code ${code}`))
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

/** 构建浏览器 use 进程环境变量 */
function buildBUEnv(): Record<string, string> {
  const env: Record<string, string> = {}

  // LLM API Keys 透传
  const apiKey = process.env[BU_API_KEY_ENV]
  if (apiKey) env[BU_API_KEY_ENV] = apiKey
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (process.env.GOOGLE_API_KEY) env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY

  // Agent 配置
  env.BU_LLM_MODEL = agentConfig.model
  env.BU_HEADLESS = String(agentConfig.headless)

  return env
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
  const isLLMConfigured = Boolean(
    process.env[BU_API_KEY_ENV] ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_API_KEY
  )

  const pythonResult = findPython()
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
    source,
    llmConfigured: isLLMConfigured,
    llmProvider: agentConfig.provider,
    llmModel: agentConfig.model,
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