import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { shell } from 'electron'
import { CliDetectionResult, EnvironmentCheck, EnvItemStatus, InstallProgress } from './proxy/types'
import { info, warn, debug } from './logger'

const SCOPE = 'CliDetector'
const isWindows = process.platform === 'win32'

function execFileAsync(command: string, args: string[] = [], timeout = 15000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const useShell = isWindows && command.endsWith('.cmd')
    const options: import('child_process').ExecFileOptions = { timeout, windowsHide: true, shell: useShell || undefined }
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout: String(stdout).trim(), stderr: String(stderr).trim() })
    })
  })
}

async function findInPath(cliName: string): Promise<string | null> {
  try {
    const cmd = isWindows ? 'where' : 'which'
    const { stdout } = await execFileAsync(cmd, [cliName])
    const lines = stdout.split(/\r?\n/).filter(Boolean)
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

  return {
    available: true,
    path: cliPath,
    version,
  }
}

async function checkEnvItem(name: string, versionArgs: string[] = ['--version']): Promise<EnvItemStatus> {
  try {
    const envPath = await findInPath(name)
    if (!envPath) {
      return { available: false, version: null, path: null }
    }
    const { stdout } = await execFileAsync(name, versionArgs)
    const version = stdout.split(/\r?\n/)[0] || null
    return { available: true, version, path: envPath }
  } catch {
    return { available: false, version: null, path: null }
  }
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
