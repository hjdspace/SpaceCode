/**
 * OfficeCLI Service — IPC handlers for the bundled OfficeCLI binary.
 *
 * Provides:
 *  - Binary path resolution (dev / packaged)
 *  - Cross-platform process-tree kill
 *  - exec / viewHtml / viewScreenshot / watch (start/stop/stopAll/list)
 *  - ensureOfficeCliInstalled() — copies binary to ~/.officecli/bin/ via `officecli install`
 *
 * All IPC channels are prefixed with `officecli:`.
 */

import { ipcMain, app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { info, warn, debug } from './logger'

// ===== Types =====

export interface OfficeCliExecOptions {
  args: string[]
  cwd?: string
  timeout?: number
  env?: Record<string, string>
}

export interface OfficeCliExecResult {
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}

export interface OfficeCliWatchHandle {
  id: string
  filePath: string
  port: number
  url: string
  process: ChildProcess
}

// ===== Global state =====

const watchProcesses = new Map<string, OfficeCliWatchHandle>()

// ===== Binary path resolution =====

/**
 * Resolve the platform-specific binary filename.
 */
function getPlatformBinaryName(): string {
  const platform = process.platform // 'win32' | 'darwin' | 'linux'
  const arch = process.arch // 'x64' | 'arm64'

  let platformName: string
  if (platform === 'win32') platformName = 'win'
  else if (platform === 'darwin') platformName = 'mac'
  else platformName = 'linux'

  return `officecli-${platformName}-${arch}${platform === 'win32' ? '.exe' : ''}`
}

/**
 * Resolve the bundled officecli binary path.
 * Dev:  <appPath>/resources/officecli/officecli-{platform}-{arch}[.exe]
 * Pack: process.resourcesPath/officecli/officecli-{platform}-{arch}[.exe]
 */
export function getOfficeCliBinaryPath(): string {
  const exeName = getPlatformBinaryName()
  const isDev = !app.isPackaged
  const baseDir = isDev
    ? path.join(app.getAppPath(), 'resources', 'officecli')
    : path.join(process.resourcesPath, 'officecli')

  return path.join(baseDir, exeName)
}

/**
 * Multi-level binary resolution for development mode.
 *
 * Lookup order:
 * 1. Bundled binary: resources/officecli/officecli-{platform}-{arch}[.exe]
 * 2. User-level install: ~/.officecli/bin/officecli[.exe]  (from `officecli install`)
 * 3. System PATH: `officecli` (if user installed globally)
 *
 * Returns the first existing path, or null if none found.
 */
export function resolveOfficeCliBinary(): string | null {
  // 1. Bundled binary (dev: resources/, pack: process.resourcesPath/)
  const bundledPath = getOfficeCliBinaryPath()
  if (fs.existsSync(bundledPath)) {
    debug('OfficeCli', `Using bundled binary: ${bundledPath}`)
    return bundledPath
  }

  // 2. User-level install (~/.officecli/bin/officecli)
  const installedPath = getOfficeCliInstalledBinary()
  if (fs.existsSync(installedPath)) {
    debug('OfficeCli', `Using user-installed binary: ${installedPath}`)
    return installedPath
  }

  // 3. System PATH — only meaningful in dev mode
  if (!app.isPackaged) {
    const exe = process.platform === 'win32' ? 'officecli.exe' : 'officecli'
    try {
      const { spawnSync } = require('child_process')
      const result = spawnSync(exe, ['--version'], {
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf-8',
      })
      if (result.status === 0 && result.stdout) {
        debug('OfficeCli', `Using system PATH binary: ${exe}`)
        return exe
      }
    } catch {
      // not on PATH
    }
  }

  return null
}

/** officecli install user-level directory (~/.officecli/bin) */
export function getOfficeCliInstallDir(): string {
  return path.join(os.homedir(), '.officecli', 'bin')
}

/** User-level officecli executable (standard name after `officecli install`) */
export function getOfficeCliInstalledBinary(): string {
  const exe = process.platform === 'win32' ? 'officecli.exe' : 'officecli'
  return path.join(getOfficeCliInstallDir(), exe)
}

// ===== Cross-platform process-tree termination =====

/**
 * Kill a process tree (including children).
 * Windows: taskkill /pid <pid> /T /F (SIGTERM does not kill children)
 * macOS/Linux: process-group kill
 */
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      process.kill(-pid, 'SIGTERM')
    }
  } catch {
    // process may have already exited
  }
}

// ===== Core execution =====

async function execOfficeCli(options: OfficeCliExecOptions): Promise<OfficeCliExecResult> {
  // Multi-level resolution: bundled → user-installed → system PATH
  const binaryPath = resolveOfficeCliBinary()

  if (!binaryPath) {
    throw new Error(
      'OfficeCLI binary not found. ' +
      'Place it in resources/officecli/ (dev) or run `npm run download:officecli` to fetch it. ' +
      'Alternatively, install OfficeCLI globally (see https://github.com/iOfficeAI/OfficeCLI).'
    )
  }

  const cwd = options.cwd || os.homedir()
  const timeout = options.timeout || 30000
  const env = { ...process.env, ...options.env }

  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    const child = spawn(binaryPath, options.args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    const timer = setTimeout(() => {
      if (child.pid) killProcessTree(child.pid)
      reject(new Error(`OfficeCLI timeout (${timeout}ms): officecli ${options.args.join(' ')}`))
    }, timeout)

    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      })
    })

    child.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(new Error(`OfficeCLI execution failed: ${err.message}`))
    })
  })
}

// ===== Ensure installed (agent-side PATH) =====

/**
 * Ensure officecli is installed to the user-level PATH (~/.officecli/bin).
 * Idempotent: skips if already installed and version is retrievable.
 * Call inside app.whenReady(), non-blocking (do not await from the startup path).
 */
export async function ensureOfficeCliInstalled(): Promise<void> {
  const binaryPath = resolveOfficeCliBinary()

  // No binary available anywhere — nothing to install
  if (!binaryPath) {
    debug('OfficeCli', 'No OfficeCLI binary found (bundled/user/PATH), skipping install')
    return
  }

  // If using system PATH binary, it's already installed — skip
  if (binaryPath === 'officecli' || binaryPath === 'officecli.exe') {
    debug('OfficeCli', 'Using system PATH binary, skipping install')
    return
  }

  const installedPath = getOfficeCliInstalledBinary()

  // Already installed and executable — skip
  if (fs.existsSync(installedPath)) {
    try {
      const result = await execOfficeCli({ args: ['--version'], timeout: 5000 })
      if (result.exitCode === 0) {
        debug('OfficeCli', `Already installed | version=${result.stdout.trim()} | path=${installedPath}`)
        return
      }
    } catch {
      // version check failed, continue to reinstall
    }
  }

  info('OfficeCli', `Installing | bundled=${binaryPath}`)
  try {
    const result = await execOfficeCli({ args: ['install'], timeout: 30000 })
    if (result.exitCode === 0) {
      info('OfficeCli', `Install complete | stdout=${result.stdout.trim()}`)
    } else {
      warn('OfficeCli', `Install failed | exitCode=${result.exitCode} | stderr=${result.stderr}`)
    }
  } catch (err) {
    warn('OfficeCli', `Install error | error=${String(err)}`)
  }
}

// ===== IPC Handler registration =====

export function registerOfficeCliIPCHandlers(): void {
  // Check version
  ipcMain.handle('officecli:version', async (): Promise<string> => {
    const result = await execOfficeCli({ args: ['--version'], timeout: 10000 })
    if (result.exitCode !== 0) {
      throw new Error(`Version check failed: ${result.stderr}`)
    }
    return result.stdout.trim()
  })

// Check if binary exists (bundled, user-installed, or on PATH)
ipcMain.handle('officecli:checkInstalled', async (): Promise<boolean> => {
return resolveOfficeCliBinary() !== null
})

  // Execute arbitrary command
  ipcMain.handle('officecli:exec', async (_event, options: OfficeCliExecOptions): Promise<OfficeCliExecResult> => {
    return execOfficeCli(options)
  })

  // Render file as HTML
  ipcMain.handle('officecli:viewHtml', async (_event, filePath: string, outputDir?: string): Promise<string> => {
    const args = ['view', filePath, 'html']
    if (outputDir) {
      args.push('-o', outputDir)
    }
    const result = await execOfficeCli({ args, cwd: path.dirname(filePath), timeout: 60000 })
    if (result.exitCode !== 0) {
      throw new Error(`HTML render failed: ${result.stderr}`)
    }
    if (outputDir) {
      const htmlPath = path.join(outputDir, path.basename(filePath, path.extname(filePath)) + '.html')
      return htmlPath
    }
    // No output dir specified — write stdout to a temp file
    const tmpPath = path.join(os.tmpdir(), `officecli-${Date.now()}.html`)
    fs.writeFileSync(tmpPath, result.stdout)
    return tmpPath
  })

  // Render file as PNG screenshots
  // NOTE: officecli's -o expects a *file path*, not a directory. Passing a
  // directory causes officecli to fail with a misleading "No headless browser"
  // error. We construct a file path inside the caller-provided directory.
  ipcMain.handle('officecli:viewScreenshot', async (_event, filePath: string, outputDir: string, page?: number): Promise<string[]> => {
    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true })

    const baseName = path.basename(filePath, path.extname(filePath))
    const pageLabel = page ? `page-${page}` : 'page-1'
    const outFile = path.join(outputDir, `${baseName}-${pageLabel}.png`)

    const args = ['view', filePath, 'screenshot', '-o', outFile]
    if (page) {
      args.push('--page', String(page))
    }
    const result = await execOfficeCli({ args, cwd: path.dirname(filePath), timeout: 60000 })
    if (result.exitCode !== 0) {
      throw new Error(`Screenshot render failed: ${result.stderr || result.stdout}`)
    }

    // officecli echoes the generated file path in stdout; fall back to our
    // constructed path if stdout is empty.
    const generatedPath = result.stdout.trim()
    const resolvedPath = generatedPath && fs.existsSync(generatedPath)
      ? generatedPath
      : (fs.existsSync(outFile) ? outFile : '')

    if (!resolvedPath) {
      throw new Error(`Screenshot produced no output. ${result.stderr || result.stdout}`)
    }
    return [resolvedPath]
  })

// Start watch mode
ipcMain.handle('officecli:watch:start', async (_event, filePath: string, port?: number): Promise<{ id: string; filePath: string; port: number; url: string }> => {
const binaryPath = resolveOfficeCliBinary()
if (!binaryPath) {
throw new Error('OfficeCLI binary not found. Run `npm run download:officecli` or install OfficeCLI globally.')
}

    const args = ['watch', filePath]
    if (port) {
      args.push('--port', String(port))
    }

    const child = spawn(binaryPath, args, {
      cwd: path.dirname(filePath),
      shell: false,
      windowsHide: true,
    })

    return new Promise((resolve, reject) => {
      const id = `watch-${Date.now()}`
      let resolvedPort = port || 26315
      let outputBuffer = ''

      const timer = setTimeout(() => {
        reject(new Error('watch startup timeout'))
      }, 10000)

      child.stdout?.on('data', (data: Buffer) => {
        outputBuffer += data.toString()
        const urlMatch = outputBuffer.match(/http:\/\/localhost:(\d+)/)
        if (urlMatch) {
          resolvedPort = parseInt(urlMatch[1])
          clearTimeout(timer)
          const handle: OfficeCliWatchHandle = {
            id,
            filePath,
            port: resolvedPort,
            url: `http://localhost:${resolvedPort}`,
            process: child,
          }
          watchProcesses.set(id, handle)
          resolve({ id, filePath, port: resolvedPort, url: handle.url })
        }
      })

      child.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new Error(`watch start failed: ${err.message}`))
      })

      child.on('close', () => {
        watchProcesses.delete(id)
      })
    })
  })

  // Stop watch
  ipcMain.handle('officecli:watch:stop', async (_event, watchId: string): Promise<boolean> => {
    const handle = watchProcesses.get(watchId)
    if (!handle) return false
    if (handle.process.pid) killProcessTree(handle.process.pid)
    watchProcesses.delete(watchId)
    return true
  })

  // Stop all watch processes
  ipcMain.handle('officecli:watch:stopAll', async (): Promise<number> => {
    const count = watchProcesses.size
    for (const handle of watchProcesses.values()) {
      if (handle.process.pid) killProcessTree(handle.process.pid)
    }
    watchProcesses.clear()
    return count
  })

  // List active watches
  ipcMain.handle('officecli:watch:list', async (): Promise<Array<{ id: string; filePath: string; url: string }>> => {
    return Array.from(watchProcesses.values()).map(h => ({
      id: h.id,
      filePath: h.filePath,
      url: h.url,
    }))
  })

  // Read an image file as base64 data URL (bypasses file:// CORS in dev mode)
  ipcMain.handle('officecli:readImageAsDataURL', async (_event, filePath: string): Promise<string> => {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`)
    }
    const buffer = fs.readFileSync(filePath)
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return `data:image/${mime};base64,${buffer.toString('base64')}`
  })
}

// ===== Cleanup (call on app before-quit) =====

export function cleanupOfficeCli(): void {
  for (const handle of watchProcesses.values()) {
    try {
      if (handle.process.pid) killProcessTree(handle.process.pid)
    } catch {
      // process may have already exited
    }
  }
  watchProcesses.clear()
}
