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
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as http from 'http'
import * as https from 'https'
import { info, warn, debug } from '../infra/logger'

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
  /** Empty until the watch server has printed its preview URL. */
  url: string
  process: ChildProcess
}

export interface OfficeCliScreenshotResult {
  /** Absolute path of the rendered PNG. */
  path: string
  /** Total pages in the document; equals `end` when the count is unavailable. */
  pageCount: number
  /** First and last page contained in `path`. */
  start: number
  end: number
  /** Pixel size of `path`; zero when the image is not a readable PNG. */
  width: number
  height: number
}

// ===== Global state =====

const watchProcesses = new Map<string, OfficeCliWatchHandle>()

/** Keeps watch ids unique when several starts land in the same millisecond. */
let watchIdSeq = 0

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

// ===== User-level copy freshness =====

/** Outcome of reconciling ~/.officecli/bin with the binary this app ships. */
export interface OfficeCliSyncResult {
  copied: boolean
  reason: 'missing' | 'outdated' | 'up-to-date' | 'no-bundle' | 'unknown-version' | 'copy-failed'
  bundledVersion: string | null
  installedVersion: string | null
}

/**
 * Run `<binary> --version` and pull the dotted version out of its output.
 *
 * 每次会话 spawn，syncInstalledOfficeCli 都要比对 bundled 与 installed 两个二进制
 * 的版本，而那是一次真实的子进程（Windows 上还要吃一遍 AV 扫描）。版本由二进制
 * 内容决定，所以按 (size, mtime) 复用结论：bundled 在应用运行期不会变，installed
 * 只可能因为一次 install 而变 —— 那时文件本身就被换掉了，指纹自然失效。
 * 读不到版本（二进制损坏 / 超时）不缓存，否则一次抖动就被钉成永久结论。
 */
const versionCache = new Map<string, { fingerprint: string; version: string }>()

function binaryFingerprint(binaryPath: string): string | null {
  try {
    const st = fs.statSync(binaryPath)
    return `${st.size}:${Math.round(st.mtimeMs)}`
  } catch {
    return null
  }
}

function readOfficeCliVersion(binaryPath: string): string | null {
  const fingerprint = binaryFingerprint(binaryPath)
  if (fingerprint) {
    const cached = versionCache.get(binaryPath)
    if (cached && cached.fingerprint === fingerprint) return cached.version
  }
  try {
    const result = spawnSync(binaryPath, ['--version'], {
      timeout: 5000,
      windowsHide: true,
      encoding: 'utf-8',
    })
    if (result.status !== 0 || !result.stdout) return null
    const match = result.stdout.trim().match(/\d+\.\d+\.\d+/)
    if (!match) return null
    if (fingerprint) versionCache.set(binaryPath, { fingerprint, version: match[0] })
    return match[0]
  } catch {
    return null
  }
}

/** Numeric-segment compare: >0 when `a` outranks `b`. */
function compareOfficeCliVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function copyBundledToUserInstall(bundled: string, installed: string): boolean {
  try {
    fs.mkdirSync(getOfficeCliInstallDir(), { recursive: true })
    fs.copyFileSync(bundled, installed)
    if (process.platform !== 'win32') fs.chmodSync(installed, 0o755)
    return true
  } catch {
    return false
  }
}

/**
 * Reconcile ~/.officecli/bin with the bundled binary.
 *
 * That directory is prepended to the CLI child's PATH, so it is the officecli
 * the agent actually runs. Writing it only when absent pinned every session to
 * the version from first launch, however far the app moved on: newer bundled
 * wins now, a user install that outranks the bundle is left alone, and an
 * unreadable version never triggers a 33 MB rewrite.
 */
export function syncInstalledOfficeCli(): OfficeCliSyncResult {
  const bundled = getOfficeCliBinaryPath()
  const installed = getOfficeCliInstalledBinary()

  if (!fs.existsSync(bundled)) {
    return { copied: false, reason: 'no-bundle', bundledVersion: null, installedVersion: null }
  }

  if (!fs.existsSync(installed)) {
    const bundledVersion = readOfficeCliVersion(bundled)
    if (!copyBundledToUserInstall(bundled, installed)) {
      return { copied: false, reason: 'copy-failed', bundledVersion, installedVersion: null }
    }
    return { copied: true, reason: 'missing', bundledVersion, installedVersion: null }
  }

  const bundledVersion = readOfficeCliVersion(bundled)
  const installedVersion = readOfficeCliVersion(installed)

  if (!bundledVersion || !installedVersion) {
    return { copied: false, reason: 'unknown-version', bundledVersion, installedVersion }
  }
  if (compareOfficeCliVersions(bundledVersion, installedVersion) <= 0) {
    return { copied: false, reason: 'up-to-date', bundledVersion, installedVersion }
  }

  if (!copyBundledToUserInstall(bundled, installed)) {
    return { copied: false, reason: 'copy-failed', bundledVersion, installedVersion }
  }
  return { copied: true, reason: 'outdated', bundledVersion, installedVersion }
}

// ===== Cross-platform process-tree termination =====

/**
 * Kill a process tree (including children).
 * Windows: taskkill /pid <pid> /T /F (SIGTERM does not kill children)
 * macOS/Linux: process-group kill — only valid for children spawned with
 * `detached`, which makes them a group leader; otherwise the group does not
 * exist and the signal would be silently lost, so fall back to the pid.
 */
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
      return
    }
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      process.kill(pid, 'SIGTERM')
    }
  } catch {
    // process may have already exited
  }
}

/** Own process group on macOS/Linux so killProcessTree() can reach the tree. */
function spawnDetached(): boolean {
  return process.platform !== 'win32'
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
      detached: spawnDetached(),
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

// ===== Multi-page screenshot helpers =====

/**
 * Pages rendered per screenshot call. officecli stacks a page range into ONE
 * PNG, and a long document would exceed the renderer's per-side texture limit,
 * so the panel asks for a bounded chunk and repeats it for the next pages.
 */
const SCREENSHOT_PAGE_CHUNK = 8

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * How each format reports its total page count. A format missing here has no
 * countable pages, so it renders exactly one page per call.
 */
const PAGE_COUNT_QUERY: Record<string, { args: string[]; key: string }> = {
  '.pptx': { args: ['stats', '--json'], key: 'slides' },
  '.docx': { args: ['stats', '--page-count', '--json'], key: 'pages' },
}

interface OfficeCliStatsPayload {
  data?: Record<string, unknown>
}

async function readStatsNumber(
  filePath: string,
  args: string[],
  key: string,
): Promise<number | null> {
  try {
    const result = await execOfficeCli({ args, cwd: path.dirname(filePath), timeout: 30000 })
    if (result.exitCode !== 0) return null
    const value = (JSON.parse(result.stdout) as OfficeCliStatsPayload).data?.[key]
    return typeof value === 'number' && value > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Total pages, or null when the format has no count or the lookup failed —
 * docx repagination needs Word, so null is a normal outcome, not an error.
 */
async function readPageCount(filePath: string): Promise<number | null> {
  const query = PAGE_COUNT_QUERY[path.extname(filePath).toLowerCase()]
  if (!query) return null
  return readStatsNumber(filePath, ['view', filePath, ...query.args], query.key)
}

function readPngSize(filePath: string): { width: number; height: number } {
  const unknown = { width: 0, height: 0 }
  let fd: number | undefined
  try {
    const header = Buffer.alloc(26)
    fd = fs.openSync(filePath, 'r')
    if (fs.readSync(fd, header, 0, 26, 0) < 26) return unknown
    if (!header.subarray(0, 8).equals(PNG_SIGNATURE)) return unknown
    if (header.toString('ascii', 12, 16) !== 'IHDR') return unknown
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
  } catch {
    return unknown
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore
      }
    }
  }
}

// ===== Ensure installed (agent-side PATH) =====

/**
 * Ensure officecli is installed to the user-level PATH (~/.officecli/bin).
 * Idempotent: the bundled copy is (re)written whenever it is newer, so an app
 * update actually reaches the officecli the agent runs.
 * Call inside app.whenReady(), non-blocking (do not await from the startup path).
 */
export async function ensureOfficeCliInstalled(): Promise<void> {
  const sync = syncInstalledOfficeCli()
  if (sync.copied) {
    info('OfficeCli', `Installed bundled officecli | reason=${sync.reason} | version=${sync.bundledVersion}`)
    return
  }
  if (sync.reason === 'up-to-date') {
    debug('OfficeCli', `Already up to date | version=${sync.installedVersion} | path=${getOfficeCliInstalledBinary()}`)
    return
  }

  // No bundled binary to copy (or an unreadable version) — ask whichever binary
  // resolves to install itself, as before.
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

  // Fetch latest release info
  sendDownloadProgress({ stage: 'fetching', message: 'Fetching release info...', percent: 0 })
  const release = (await fetchJson(`${GITHUB_API_URL}/latest`)) as GithubRelease
  const latestVersion = (release.tag_name || '').replace(/^v/, '')

  // Only a copy that is genuinely current may skip the download. Probing the
  // resolved binary would report the bundle's version instead of the user
  // copy's, which made this button a no-op for as long as ~/.officecli/bin
  // held any runnable file — however stale.
  const installedVersion = fs.existsSync(installedPath) ? readOfficeCliVersion(installedPath) : null
  if (installedVersion && latestVersion && compareOfficeCliVersions(latestVersion, installedVersion) <= 0) {
    info('OfficeCli', `Already up to date | version=${installedVersion} | path=${installedPath}`)
    sendDownloadProgress({ stage: 'done', message: installedVersion, percent: 100 })
    return installedPath
  }
  if (installedVersion) {
    info('OfficeCli', `Upgrading user copy | ${installedVersion} → ${latestVersion || 'latest'}`)
  }

  // Ensure install directory exists
  fs.mkdirSync(installDir, { recursive: true })

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

  // Render a chunk of pages as one PNG sheet (pages stacked top-to-bottom).
  // NOTE: officecli's -o expects a *file path*, not a directory, and always
  // writes a single file — a page range becomes a vertically stacked sheet,
  // not one image per page. Passing a directory makes officecli fail with a
  // misleading "No headless browser" error.
  ipcMain.handle('officecli:viewScreenshot', async (_event, filePath: string, outputDir: string, start = 1): Promise<OfficeCliScreenshotResult> => {
    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true })

    // The range must be settled before rendering: when the page count is
    // unavailable the sheet has to be a single page, otherwise the panel would
    // be handed an N-page stack it can only label as page one.
    const pageCount = await readPageCount(filePath)
    const last = pageCount === null ? start : Math.min(start + SCREENSHOT_PAGE_CHUNK - 1, pageCount)

    const baseName = path.basename(filePath, path.extname(filePath))
    const outFile = path.join(outputDir, `${baseName}-pages-${start}-${last}.png`)

    const result = await execOfficeCli({
      args: ['view', filePath, 'screenshot', '--page', `${start}-${last}`, '-o', outFile],
      cwd: path.dirname(filePath),
      timeout: 60000,
    })

    if (result.exitCode !== 0) {
      throw new Error(`Screenshot render failed: ${result.stderr || result.stdout}`)
    }

    // stdout is the generated file path, followed by a "[pages] total=N" note
    // for pptx — only the first line can be a path.
    const reported = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
    const resolvedPath = [reported, outFile].find((p) => p && fs.existsSync(p)) ?? ''

    if (!resolvedPath) {
      throw new Error(`Screenshot produced no output. ${result.stderr || result.stdout}`)
    }

    const { width, height } = readPngSize(resolvedPath)

    return { path: resolvedPath, pageCount: pageCount ?? last, start, end: last, width, height }
  })

// Start watch mode
ipcMain.handle('officecli:watch:start', async (_event, filePath: string, port?: number): Promise<{ id: string; filePath: string; port: number; url: string }> => {
const binaryPath = resolveOfficeCliBinary()
if (!binaryPath) {
throw new Error('OfficeCLI binary not found. Run `npm run download:officecli` or install OfficeCLI globally.')
}

    // 清掉同文件的残留 watch：officecli watch 是独立常驻进程，应用异常退出后
    // 依然存活；残留进程会让新的 watch 立即退出并报 "Another watch process is
    // already running"。unwatch 幂等，无残留时是 no-op。
    try {
      spawnSync(binaryPath, ['unwatch', filePath], {
        cwd: path.dirname(filePath),
        windowsHide: true,
        timeout: 5000,
      })
    } catch {
      // 清理失败不阻塞启动 —— 后续 close 监听会把真实错误带出来
    }

    const args = ['watch', filePath]
    if (port) {
      args.push('--port', String(port))
    }

    const child = spawn(binaryPath, args, {
      cwd: path.dirname(filePath),
      shell: false,
      windowsHide: true,
      detached: spawnDetached(),
    })

    // 从 spawn 成功那一刻就登记，不等 URL：预览地址可能要等满超时才打印，
    // 也可能永远不打印，而 watch:stop / stopAll / 退出清理都必须够得着这个进程，
    // 否则常驻的 watch server 会带着端口活过应用。
    const id = `watch-${Date.now()}-${++watchIdSeq}`
    const handle: OfficeCliWatchHandle = {
      id,
      filePath,
      port: port || 26315,
      url: '',
      process: child,
    }
    watchProcesses.set(id, handle)

    return new Promise((resolve, reject) => {
      let outputBuffer = ''
      let stderrBuffer = ''
      let settled = false

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        watchProcesses.delete(id)
        if (child.pid) killProcessTree(child.pid)
        reject(new Error('watch startup timeout'))
      }, 10000)

      child.stdout?.on('data', (data: Buffer) => {
        outputBuffer += data.toString()
        const urlMatch = outputBuffer.match(/http:\/\/localhost:(\d+)/)
        if (urlMatch && !settled) {
          settled = true
          clearTimeout(timer)
          handle.port = parseInt(urlMatch[1])
          handle.url = `http://localhost:${handle.port}`
          resolve({ id, filePath, port: handle.port, url: handle.url })
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString()
      })

      child.on('error', (err: Error) => {
        watchProcesses.delete(id)
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`watch start failed: ${err.message}`))
      })

      // officecli 自身退出（同文件已有 watch、文件被锁、参数错误）会立刻 close。
      // 带上 stderr reject，不要傻等超时把真实原因吞成 "watch startup timeout"。
      child.on('close', (code: number | null) => {
        watchProcesses.delete(id)
        if (settled) return
        settled = true
        clearTimeout(timer)
        const detail = stderrBuffer.trim() || outputBuffer.trim()
        reject(new Error(`watch process exited (code ${code})${detail ? `: ${detail}` : ''}`))
      })
    })
  })

  // Stop watch
  ipcMain.handle('officecli:watch:stop', async (_event, watchId: string): Promise<boolean> => {
    const handle = watchProcesses.get(watchId)
    if (!handle) return false
    if (handle.process.pid) killProcessTree(handle.process.pid)
    watchProcesses.delete(watchId)
    // kill 后补一刀 unwatch：若 officecli 侧留有同文件的 watch 注册状态，
    // 下次对同一文件 watch 会因 "already running" 立即失败。
    const binaryPath = resolveOfficeCliBinary()
    if (binaryPath) {
      try {
        spawnSync(binaryPath, ['unwatch', handle.filePath], { windowsHide: true, timeout: 5000 })
      } catch {
        // ignore
      }
    }
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
    // url 为空 = 还在启动中，没有可预览的地址，不对外暴露
    return Array.from(watchProcesses.values())
      .filter(h => h.url)
      .map(h => ({
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
