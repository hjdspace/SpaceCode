import { execFile, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { shell } from 'electron'
import { CliDetectionResult, EnvironmentCheck, EnvItemStatus, InstallProgress } from './proxy/types'
import { info, warn, debug } from './logger'

const SCOPE = 'CliDetector'
const isWindows = process.platform === 'win32'
const MIN_CLI_VERSION = '1.0.0'

function execFileAsync(command: string, args: string[] = [], timeout = 15000, forceShell = false): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Windows 上 .cmd/.bat 不是真正的可执行文件，必须通过 shell 解释。
    // 否则 execFile 会直接 ENOENT —— 这就是早先 npx (npx.cmd) 检测假阴性的根因。
    const lower = command.toLowerCase()
    const useShell = forceShell || (isWindows && (lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1')))
    // 走 shell 时路径可能含空格（如 "C:\Program Files\nodejs\npx.cmd"），需要加引号
    // 防止 shell 在空格处拆参数；非 shell 模式 execFile 自己会处理空格。
    const finalCommand = useShell && command.includes(' ') ? `"${command}"` : command
    const options: import('child_process').ExecFileOptions = { timeout, windowsHide: true, shell: useShell }
    execFile(finalCommand, args, options, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout: String(stdout).trim(), stderr: String(stderr).trim() })
    })
  })
}

async function findInPath(cliName: string): Promise<string | null> {
  try {
    const cmd = isWindows ? 'where' : 'which'
    const { stdout } = await execFileAsync(cmd, [cliName], 15000, true)
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    if (!lines.length) return null
    if (isWindows) {
      const cmdFile = lines.find(l => l.toLowerCase().endsWith('.cmd'))
      if (cmdFile) return cmdFile
    }
    return lines[0] || null
  } catch {
    return null
  }
}

async function checkNpmGlobal(cliName: string): Promise<string | null> {
  try {
    const { stdout: npmRoot } = await execFileAsync('npm', ['root', '-g'])
    const candidate = path.join(npmRoot, '@anthropic-ai', cliName)
    if (fs.existsSync(candidate)) {
      if (isWindows) {
        const cmdFile = path.join(npmRoot, `${cliName}.cmd`)
        if (fs.existsSync(cmdFile)) return cmdFile
      }
      const binFile = path.join(npmRoot, '.bin', cliName)
      if (fs.existsSync(binFile)) return binFile
      return candidate
    }
  } catch {}
  return null
}

function scanCommonPaths(cliName: string): string | null {
  const candidates: string[] = []
  if (isWindows) {
    const appData = process.env.APPDATA
    if (appData) candidates.push(path.join(appData, 'npm', `${cliName}.cmd`))
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) candidates.push(path.join(localAppData, 'npm', `${cliName}.cmd`))
  } else {
    const home = os.homedir()
    candidates.push(path.join(home, '.local', 'bin', cliName))
    candidates.push(path.join('/usr', 'local', 'bin', cliName))
    candidates.push(path.join(home, '.npm-global', 'bin', cliName))
    const npmBinPrefix = process.env.NPM_CONFIG_PREFIX
    if (npmBinPrefix) candidates.push(path.join(npmBinPrefix, 'bin', cliName))
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

async function getVersion(cliPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cliPath, ['--version'])
    const match = stdout.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : stdout.split(/\r?\n/)[0] || null
  } catch {
    return null
  }
}

export async function detectInstalledCli(): Promise<CliDetectionResult> {
  debug(SCOPE, 'Starting CLI detection')

  let cliPath = await findInPath('claude')
  debug(SCOPE, 'PATH lookup result', { cliPath })

  if (!cliPath) {
    cliPath = await checkNpmGlobal('claude-code')
    debug(SCOPE, 'npm global check result', { cliPath })
  }

  if (!cliPath) {
    cliPath = scanCommonPaths('claude')
    debug(SCOPE, 'Common paths scan result', { cliPath })
  }

  if (!cliPath) {
    info(SCOPE, 'CLI not found')
    return { available: false, path: null, version: null }
  }

  const version = await getVersion(cliPath)
  info(SCOPE, 'CLI detected', { path: cliPath, version })

  const versionCompatible = version ? isVersionGte(version, MIN_CLI_VERSION) : false

  return {
    available: true,
    path: cliPath,
    version,
    versionCompatible,
  }
}

async function checkEnvItem(name: string, versionArgs: string[] = ['--version']): Promise<EnvItemStatus> {
  try {
    const envPath = await findInPath(name)
    if (!envPath) {
      return { available: false, version: null, path: null }
    }
    // 用 findInPath 返回的**完整路径**（含 .cmd/.bat 后缀）来跑 --version。
    //
    // 原因：Node 的 child_process.execFile 在 Windows 上不识别 PATHEXT —— 它只查
    // 精确文件名。如果传裸命令名（如 'npx'），但 PATH 里只有 'npx.cmd'，会触发
    // ENOENT 落入 catch，UI 就误报"未安装"。execFileAsync 内部已根据
    // command.endsWith('.cmd') 自动启用 shell，只要把完整路径传进去就能命中。
    const { stdout } = await execFileAsync(envPath, versionArgs)
    const version = stdout.split(/\r?\n/)[0] || null
    return { available: true, version, path: envPath }
  } catch {
    return { available: false, version: null, path: null }
  }
}

/**
 * 通用「命令是否可用」检测。返回命令是否存在、版本与路径。
 *
 * 用于 MCP 内置服务器的依赖检测（如 cdp-bridge 依赖 uvx、chrome-devtools
 * 依赖 npx）。复用 findInPath + --version，避免每个调用点各写一套
 * where/which 逻辑。
 */
export async function isCommandAvailable(command: string): Promise<EnvItemStatus> {
  return checkEnvItem(command, ['--version'])
}

export async function checkEnvironment(): Promise<EnvironmentCheck> {
  debug(SCOPE, 'Checking environment prerequisites')

  const [node, npm, git] = await Promise.all([
    checkEnvItem('node'),
    checkEnvItem('npm'),
    checkEnvItem('git'),
  ])

  info(SCOPE, 'Environment check complete', {
    node: node.available ? `${node.version} @ ${node.path}` : 'NOT FOUND',
    npm: npm.available ? `${npm.version} @ ${npm.path}` : 'NOT FOUND',
    git: git.available ? `${git.version} @ ${git.path}` : 'NOT FOUND',
  })

  return { node, npm, git }
}

async function installWithWinget(packageId: string, onProgress: (p: InstallProgress) => void): Promise<void> {
  onProgress({ stage: 'downloading', message: `Downloading ${packageId}...`, percent: 0 })
  try {
    await execFileAsync('winget', ['install', '--id', packageId, '--accept-source-agreements', '--accept-package-agreements'], 300000)
    onProgress({ stage: 'installing', message: `${packageId} installed`, percent: 80 })
  } catch (err) {
    warn(SCOPE, `winget install failed for ${packageId}`, { error: String(err) })
    throw err
  }
}

async function installWithBrew(packageName: string, onProgress: (p: InstallProgress) => void): Promise<void> {
  onProgress({ stage: 'downloading', message: `Downloading ${packageName}...`, percent: 0 })
  try {
    await execFileAsync('brew', ['install', packageName], 300000)
    onProgress({ stage: 'installing', message: `${packageName} installed`, percent: 80 })
  } catch (err) {
    warn(SCOPE, `brew install failed for ${packageName}`, { error: String(err) })
    throw err
  }
}

async function installMissingDeps(envCheck: EnvironmentCheck, onProgress: (p: InstallProgress) => void): Promise<void> {
  const missing: string[] = []
  if (!envCheck.node.available) missing.push('node')
  if (!envCheck.npm.available) missing.push('npm')
  if (!envCheck.git.available) missing.push('git')

  if (missing.length === 0) return

  debug(SCOPE, 'Installing missing dependencies', { missing })

  if (isWindows) {
    if (!envCheck.node.available || !envCheck.npm.available) {
      await installWithWinget('OpenJS.NodeJS.LTS', onProgress)
    }
    if (!envCheck.git.available) {
      await installWithWinget('Git.Git', onProgress)
    }
  } else {
    if (!envCheck.node.available || !envCheck.npm.available) {
      await installWithBrew('node', onProgress)
    }
    if (!envCheck.git.available) {
      await installWithBrew('git', onProgress)
    }
  }
}

async function installClaudeCodeCli(onProgress: (p: InstallProgress) => void): Promise<void> {
  onProgress({ stage: 'installing', message: 'Installing @anthropic-ai/claude-code...', percent: 50 })
  await execFileAsync('npm', ['install', '-g', '@anthropic-ai/claude-code'], 300000)
  onProgress({ stage: 'verifying', message: 'Verifying installation...', percent: 90 })
}

function openDownloadPage(missing: string[]): void {
  for (const item of missing) {
    switch (item) {
      case 'node':
      case 'npm':
        shell.openExternal('https://nodejs.org/en/download/')
        break
      case 'git':
        shell.openExternal('https://git-scm.com/downloads')
        break
    }
  }
  shell.openExternal('https://docs.anthropic.com/en/docs/claude-code/overview')
}

export async function installCli(
  mainWindow: Electron.BrowserWindow | null,
  onProgress: (p: InstallProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  info(SCOPE, 'Starting CLI installation')

  try {
    const envCheck = await checkEnvironment()

    try {
      await installMissingDeps(envCheck, onProgress)
    } catch (depErr) {
      warn(SCOPE, 'Failed to install missing dependencies, opening download pages', { error: String(depErr) })
      const missing: string[] = []
      if (!envCheck.node.available) missing.push('node')
      if (!envCheck.npm.available) missing.push('npm')
      if (!envCheck.git.available) missing.push('git')
      openDownloadPage(missing)
      return { success: false, error: `Failed to install dependencies automatically. Download pages have been opened. ${depErr}` }
    }

    try {
      await installClaudeCodeCli(onProgress)
    } catch (installErr) {
      warn(SCOPE, 'npm install -g failed, opening download page', { error: String(installErr) })
      shell.openExternal('https://docs.anthropic.com/en/docs/claude-code/overview')
      return { success: false, error: `Failed to install CLI via npm. Download page has been opened. ${installErr}` }
    }

    const result = await detectInstalledCli()
    if (result.available) {
      onProgress({ stage: 'done', message: 'Claude Code CLI installed successfully', percent: 100 })
      info(SCOPE, 'CLI installed successfully', { path: result.path, version: result.version })
      return { success: true }
    }

    onProgress({ stage: 'error', message: 'Installation completed but CLI not detected', percent: 100 })
    warn(SCOPE, 'CLI not detected after installation')
    return { success: false, error: 'Installation completed but CLI not detected in PATH' }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    onProgress({ stage: 'error', message: errMsg, percent: 100 })
    warn(SCOPE, 'Installation failed', { error: errMsg })
    return { success: false, error: errMsg }
  }
}

/**
 * 通过 `curl ... | sh` 形式的安装脚本装一个依赖（Linux 上 uv 的官方安装方式）。
 * 用 spawn 跑 shell，实时 drain stdout/stderr，resolve on close。
 */
function installWithScript(
  script: string,
  onProgress: (p: InstallProgress) => void,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    // drain stdout（脚本可能有进度输出）
    child.stdout?.on('data', () => {})
    child.on('close', (code: number | null) => {
      if (code === 0) {
        onProgress({ stage: 'installing', message: `${label} installed`, percent: 80 })
        resolve()
      } else {
        reject(new Error(`${label} install script exited with code ${code}: ${stderr.trim()}`))
      }
    })
    child.on('error', (err: Error) => reject(err))
  })
}

const UV_INSTALL_DOCS = 'https://docs.astral.sh/uv/getting-started/installation/'

/**
 * 安装一个 MCP 依赖命令。当前支持 `uv`（提供 uvx）。
 *
 * 平台策略：
 * - Windows: winget install astral-sh.uv
 * - macOS:   brew install uv
 * - Linux:   curl -LsSf https://astral.sh/uv/install.sh | sh
 *
 * 安装后用 isCommandAvailable('uvx') 验证；失败时打开官方文档并返回错误。
 * 全程通过 onProgress 推 InstallProgress（downloading/installing/verifying/done/error）。
 */
export async function installCommand(
  cmd: 'uv',
  onProgress: (p: InstallProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  info(SCOPE, `Starting dependency installation: ${cmd}`)

  try {
    onProgress({ stage: 'downloading', message: `Downloading ${cmd}...`, percent: 10 })

    if (isWindows) {
      await installWithWinget('astral-sh.uv', onProgress)
    } else if (process.platform === 'darwin') {
      await installWithBrew('uv', onProgress)
    } else {
      // Linux / 其他 Unix：走官方 install script
      await installWithScript(
        'curl -LsSf https://astral.sh/uv/install.sh | sh',
        onProgress,
        'uv',
      )
    }

    onProgress({ stage: 'verifying', message: 'Verifying installation...', percent: 90 })

    // uv 安装后会提供 uvx 命令；检测 uvx 是否可用
    const uvxStatus = await isCommandAvailable('uvx')
    if (uvxStatus.available) {
      onProgress({ stage: 'done', message: `${cmd} installed successfully`, percent: 100 })
      info(SCOPE, `${cmd} installed successfully`, { version: uvxStatus.version, path: uvxStatus.path })
      return { success: true }
    }

    // 可能 uv 装好了但 uvx 还没进 PATH（新开终端才生效）。再测一次 uv 本身。
    const uvStatus = await isCommandAvailable('uv')
    if (uvStatus.available) {
      onProgress({ stage: 'done', message: `${cmd} installed (restart shell to refresh PATH)`, percent: 100 })
      info(SCOPE, `${cmd} installed but uvx not on PATH yet`, { version: uvStatus.version })
      return { success: true }
    }

    onProgress({ stage: 'error', message: 'Installation completed but uvx not detected', percent: 100 })
    warn(SCOPE, 'uvx not detected after installation')
    return { success: false, error: 'Installation completed but uvx not detected in PATH. You may need to restart your shell.' }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    onProgress({ stage: 'error', message: errMsg, percent: 100 })
    warn(SCOPE, `${cmd} installation failed, opening docs`, { error: errMsg })
    // 自动安装失败时打开官方文档，让用户手动装
    shell.openExternal(UV_INSTALL_DOCS)
    return { success: false, error: `Failed to install ${cmd} automatically. Installation guide opened: ${errMsg}` }
  }
}

function isVersionGte(version: string, minVersion: string): boolean {
  const parse = (v: string) => v.split('.').map(Number)
  const a = parse(version)
  const b = parse(minVersion)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] || 0
    const bi = b[i] || 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return true
}
