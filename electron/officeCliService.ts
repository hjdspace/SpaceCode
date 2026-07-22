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

import { ipcMain, app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as http from 'http'
import * as https from 'https'
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

// ===== In-app binary download =====

/** TLS 证书相关错误码（企业代理环境常见） */
const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
])

const GITHUB_API_URL = 'https://api.github.com/repos/iOfficeAI/OfficeCLI/releases'

/** HTTPS GET with redirect following and TLS error retry */
function httpsGet(url: string, maxRedirects = 5, allowInsecure = false): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const doRequest = (insecure: boolean) => {
      const options: https.RequestOptions = {
        headers: {
          'User-Agent': 'SpaceCode-OfficeCLI',
          'Accept': 'application/vnd.github+json',
        },
      }
      if (insecure) {
        options.agent = new https.Agent({ rejectUnauthorized: false })
      }
      https.get(url, options, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          if (maxRedirects <= 0) {
            reject(new Error('Too many redirects'))
            return
          }
          const location = res.headers.location
          if (!location) {
            reject(new Error('Redirect without Location header'))
            return
          }
          res.resume()
          httpsGet(location, maxRedirects - 1, insecure).then(resolve).catch(reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        resolve(res)
      }).on('error', (e: NodeJS.ErrnoException) => {
        if (!insecure && TLS_ERROR_CODES.has(e.code ?? '')) {
          warn('OfficeCli', `TLS certificate verification failed (${e.code}), retrying with insecure mode...`)
          doRequest(true)
        } else {
          reject(e)
        }
      })
    }
    doRequest(allowInsecure)
  })
}

/** Fetch JSON from URL */
async function fetchJson(url: string): Promise<unknown> {
  const res = await httpsGet(url)
  const chunks: Buffer[] = []
  for await (const chunk of res) {
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString())
}

interface GithubRelease {
  tag_name: string
  html_url: string
  assets: Array<{
    name: string
    size: number
    browser_download_url: string
  }>
}

/** Send download progress to all renderer windows */
function sendDownloadProgress(progress: { stage: string; message: string; percent: number }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('officecli:downloadProgress', progress)
  }
}

/**
 * Download the OfficeCLI binary from GitHub Releases to ~/.officecli/bin/.
 * Reports progress via the `officecli:downloadProgress` IPC event.
 *
 * @returns The path to the downloaded binary.
 */
export async function downloadOfficeCliBinary(): Promise<string> {
  const exeName = getPlatformBinaryName()
  const installDir = getOfficeCliInstallDir()
  const installedPath = getOfficeCliInstalledBinary()

  // If already installed and working, skip download
  if (fs.existsSync(installedPath)) {
    try {
      const result = await execOfficeCli({ args: ['--version'], timeout: 5000 })
      if (result.exitCode === 0) {
        info('OfficeCli', `Already installed | version=${result.stdout.trim()} | path=${installedPath}`)
        sendDownloadProgress({ stage: 'done', message: result.stdout.trim(), percent: 100 })
        return installedPath
      }
    } catch {
      // version check failed, continue to download
    }
  }

  // Ensure install directory exists
  fs.mkdirSync(installDir, { recursive: true })

  // Fetch latest release info
  sendDownloadProgress({ stage: 'fetching', message: 'Fetching release info...', percent: 0 })
  const release = (await fetchJson(`${GITHUB_API_URL}/latest`)) as GithubRelease

  // Find matching asset
  const asset = release.assets?.find((a) => a.name === exeName)
  if (!asset) {
    const available = release.assets?.map((a) => a.name).join(', ') || 'none'
    throw new Error(`No matching asset found for ${exeName}. Available: ${available}`)
  }

  info('OfficeCli', `Downloading | release=${release.tag_name} | asset=${asset.name} | size=${(asset.size / 1024 / 1024).toFixed(1)}MB`)

  // Download with progress
  sendDownloadProgress({ stage: 'downloading', message: `Downloading ${asset.name}...`, percent: 0 })

  const tmpPath = installedPath + '.tmp'
  const file = fs.createWriteStream(tmpPath)
  const res = await httpsGet(asset.browser_download_url)

  const contentLength = parseInt(res.headers['content-length'] || '0', 10)
  let downloaded = 0

  return new Promise<string>((resolve, reject) => {
    res.on('data', (chunk: Buffer) => {
      downloaded += chunk.length
      file.write(chunk)
      if (contentLength > 0) {
        const percent = Math.round((downloaded / contentLength) * 100)
        sendDownloadProgress({
          stage: 'downloading',
          message: `Downloading... ${percent}%`,
          percent,
        })
      }
    })

    res.on('end', () => {
      file.end(() => {
        // Rename tmp file to final path
        try {
          if (fs.existsSync(installedPath)) {
            fs.unlinkSync(installedPath)
          }
          fs.renameSync(tmpPath, installedPath)
        } catch (err) {
          reject(new Error(`Failed to save binary: ${String(err)}`))
          return
        }

        // Make executable on Unix
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(installedPath, 0o755)
          } catch { /* ignore */ }
        }

        // Verify
        sendDownloadProgress({ stage: 'verifying', message: 'Verifying installation...', percent: 95 })
        execOfficeCli({ args: ['--version'], timeout: 10000 })
          .then((result) => {
            if (result.exitCode === 0) {
              info('OfficeCli', `Download complete | version=${result.stdout.trim()}`)
              sendDownloadProgress({ stage: 'done', message: result.stdout.trim(), percent: 100 })
              resolve(installedPath)
            } else {
              warn('OfficeCli', `Downloaded but version check failed | stderr=${result.stderr}`)
              sendDownloadProgress({ stage: 'done', message: 'installed', percent: 100 })
              resolve(installedPath)
            }
          })
          .catch((err) => {
            warn('OfficeCli', `Downloaded but verification failed: ${String(err)}`)
            sendDownloadProgress({ stage: 'done', message: 'installed', percent: 100 })
            resolve(installedPath)
          })
      })
    })

    res.on('error', (err: Error) => {
      file.destroy()
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
      reject(new Error(`Download failed: ${err.message}`))
    })
  })
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

  // Download binary from GitHub Releases (in-app, for packaged builds without bundled binary)
  ipcMain.handle('officecli:download', async (): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const binaryPath = await downloadOfficeCliBinary()
      return { success: true, path: binaryPath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      warn('OfficeCli', `In-app download failed: ${message}`)
      return { success: false, error: message }
    }
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
