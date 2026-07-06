import { EventEmitter } from 'events'
import { spawn, execFile, type ChildProcess } from 'child_process'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as https from 'https'
import { createWriteStream, createReadStream, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { pipeline } from 'stream/promises'
import { info, warn, error, debug } from './logger'

const RTK_GITHUB_REPO = 'rtk-ai/rtk'
const RTK_API_URL = `https://api.github.com/repos/${RTK_GITHUB_REPO}/releases/latest`
const DOWNLOAD_TIMEOUT_MS = 120_000

export interface RtkGainStats {
  totalCommands?: number
  totalSavedTokens?: number
  totalSavedUsd?: number
  saveRate?: number
  daily?: Array<{ date: string; commands: number; savedTokens: number }>
  byCommand?: Record<string, { commands: number; savedTokens: number }>
}

export interface RtkStatus {
  binaryInstalled: boolean
  version: string | null
  hookInstalled: boolean
  platform: NodeJS.Platform
  binaryPath: string
  isWindows: boolean
}

export interface RtkUpdateInfo {
  current: string | null
  latest: string
  hasUpdate: boolean
}

export interface DownloadProgress {
  downloaded: number
  total: number
  percent: number
}

/**
 * RTK (Rust Token Killer) 管理器
 *
 * 负责 RTK 二进制文件的下载、安装、版本检测、Hook 注入/卸载以及 token 节省统计获取。
 *
 * 工作方式：
 * - 二进制存储在 app.getPath('userData')/rtk/rtk[.exe]
 * - 通过 GitHub Releases 下载对应平台的预编译二进制
 * - 使用 `rtk init -g --auto-patch` 安装 PreToolUse Hook 到全局 ~/.claude/settings.json
 * - 使用 `rtk init -g --uninstall` 卸载 Hook
 * - Windows 原生不支持 Hook，RTK 会自动降级为 CLAUDE.md 指令注入模式
 */
class RtkManager extends EventEmitter {
  private binaryDir: string
  private binaryName: string

  constructor() {
    super()
    this.binaryDir = path.join(app.getPath('userData'), 'rtk')
    this.binaryName = process.platform === 'win32' ? 'rtk.exe' : 'rtk'
  }

  /** RTK 二进制所在目录 */
  getBinaryDir(): string {
    return this.binaryDir
  }

  /** RTK 二进制完整路径 */
  getBinaryPath(): string {
    return path.join(this.binaryDir, this.binaryName)
  }

  /** 二进制是否已存在 */
  isBinaryInstalled(): boolean {
    return existsSync(this.getBinaryPath())
  }

  /**
   * 确保二进制已安装，若缺失则自动下载
   * @returns 二进制路径
   */
  async ensureBinary(): Promise<string> {
    if (this.isBinaryInstalled()) {
      return this.getBinaryPath()
    }
    await this.downloadBinary()
    return this.getBinaryPath()
  }

  /**
   * 从 GitHub Releases 下载对应平台的 RTK 二进制
   */
  async downloadBinary(): Promise<void> {
    info('RtkManager', 'Starting RTK binary download')

    const releaseInfo = await this.fetchLatestRelease()
    const assetName = this.getAssetName()
    const asset = releaseInfo.assets?.find((a: { name: string; browser_download_url: string }) => a.name === assetName)
    if (!asset) {
      throw new Error(`No matching release asset found for platform: ${assetName}`)
    }

    const downloadUrl = asset.browser_download_url
    const version = releaseInfo.tag_name as string
    info('RtkManager', `Downloading RTK ${version}`, { url: downloadUrl, asset: assetName })

    // 准备目录
    mkdirSync(this.binaryDir, { recursive: true })

    // 下载压缩包到临时文件
    const archiveExt = assetName.endsWith('.zip') ? '.zip' : '.tar.gz'
    const archivePath = path.join(this.binaryDir, `rtk-download-${Date.now()}${archiveExt}`)

    try {
      await this.downloadFile(downloadUrl, archivePath, (progress) => {
        this.emit('downloadProgress', progress)
      })

      // 解压
      await this.extractArchive(archivePath, this.binaryDir)

      // 验证二进制存在
      const binaryPath = this.getBinaryPath()
      if (!existsSync(binaryPath)) {
        // 有时解压出来在子目录中，尝试查找
        const found = this.findBinaryInDir(this.binaryDir)
        if (found) {
          // 移动到正确位置
          fs.renameSync(found, binaryPath)
        } else {
          throw new Error('RTK binary not found after extraction')
        }
      }

      // 设置可执行权限（非 Windows）
      if (process.platform !== 'win32') {
        fs.chmodSync(binaryPath, 0o755)
      }

      // 记录版本信息
      writeFileSync(
        path.join(this.binaryDir, 'version.json'),
        JSON.stringify({ version, installedAt: new Date().toISOString() }, null, 2),
        'utf8',
      )

      info('RtkManager', `RTK binary downloaded successfully`, { version, path: binaryPath })
    } finally {
      // 清理临时压缩包
      try { rmSync(archivePath, { force: true }) } catch {}
    }
  }

  /**
   * 获取当前安装的 RTK 版本
   */
  async getVersion(): Promise<string | null> {
    if (!this.isBinaryInstalled()) {
      return null
    }

    // 优先从 version.json 读取（避免每次启动子进程）
    const versionFile = path.join(this.binaryDir, 'version.json')
    if (existsSync(versionFile)) {
      try {
        const data = JSON.parse(readFileSync(versionFile, 'utf8'))
        return data.version as string
      } catch {}
    }

    // 回退到 rtk --version
    return this.execRtk(['--version'])
      .then((output) => {
        // 输出格式: "rtk 0.28.2"
        const match = output.match(/rtk\s+v?([\d.]+)/i)
        return match ? match[1] : output.trim()
      })
      .catch(() => null)
  }

  /**
   * 安装 RTK Hook 到全局 Claude Code 配置
   * 使用 `rtk init -g --auto-patch` 非交互式安装
   */
  async install(): Promise<void> {
    await this.ensureBinary()
    info('RtkManager', 'Installing RTK hook (rtk init -g --auto-patch)')
    const output = await this.execRtk(['init', '-g', '--auto-patch'], { timeout: 30_000 })
    info('RtkManager', 'RTK hook installed', { output: output.slice(0, 200) })
  }

  /**
   * 卸载 RTK Hook
   * 使用 `rtk init -g --uninstall`
   */
  async uninstall(): Promise<void> {
    if (!this.isBinaryInstalled()) {
      return
    }
    info('RtkManager', 'Uninstalling RTK hook (rtk init -g --uninstall)')
    try {
      const output = await this.execRtk(['init', '-g', '--uninstall'], { timeout: 30_000 })
      info('RtkManager', 'RTK hook uninstalled', { output: output.slice(0, 200) })
    } catch (err) {
      warn('RtkManager', 'Failed to uninstall RTK hook', { error: String(err) })
    }
  }

  /**
   * 检查 Hook 是否已安装
   * 使用 `rtk init --show`
   */
  async isHookInstalled(): Promise<boolean> {
    if (!this.isBinaryInstalled()) {
      return false
    }
    try {
      const output = await this.execRtk(['init', '--show'], { timeout: 10_000 })
      // 如果输出包含 "installed" 或未报错，认为 Hook 已安装
      return !/not installed|not found|missing/i.test(output)
    } catch {
      return false
    }
  }

  /**
   * 获取完整状态
   */
  async getStatus(): Promise<RtkStatus> {
    const [version, hookInstalled] = await Promise.all([
      this.getVersion(),
      this.isHookInstalled(),
    ])

    return {
      binaryInstalled: this.isBinaryInstalled(),
      version,
      hookInstalled,
      platform: process.platform,
      binaryPath: this.getBinaryPath(),
      isWindows: process.platform === 'win32',
    }
  }

  /**
   * 获取 token 节省统计
   * 使用 `rtk gain --all --format json`
   */
  async getGainStats(): Promise<RtkGainStats | null> {
    if (!this.isBinaryInstalled()) {
      return null
    }
    try {
      const output = await this.execRtk(['gain', '--all', '--format', 'json'], { timeout: 15_000 })
      const data = JSON.parse(output)
      return this.parseGainStats(data)
    } catch (err) {
      debug('RtkManager', 'Failed to get gain stats', { error: String(err) })
      return null
    }
  }

  /**
   * 检查是否有新版本
   */
  async checkUpdate(): Promise<RtkUpdateInfo | null> {
    const current = await this.getVersion()
    let latest: string
    try {
      const release = await this.fetchLatestRelease()
      latest = release.tag_name as string
    } catch {
      return null
    }

    return {
      current,
      latest,
      hasUpdate: current !== latest,
    }
  }

  /**
   * 删除已安装的二进制文件
   */
  removeBinary(): void {
    try {
      rmSync(this.binaryDir, { recursive: true, force: true })
      info('RtkManager', 'RTK binary removed')
    } catch (err) {
      warn('RtkManager', 'Failed to remove RTK binary', { error: String(err) })
    }
  }

  // ── 私有方法 ──

  /**
   * 根据当前平台获取对应的 Release Asset 名称
   */
  private getAssetName(): string {
    const platform = process.platform
    const arch = process.arch

    if (platform === 'win32' && arch === 'x64') {
      return 'rtk-x86_64-pc-windows-msvc.zip'
    }
    if (platform === 'darwin' && arch === 'arm64') {
      return 'rtk-aarch64-apple-darwin.tar.gz'
    }
    if (platform === 'darwin' && arch === 'x64') {
      return 'rtk-x86_64-apple-darwin.tar.gz'
    }
    if (platform === 'linux' && arch === 'x64') {
      return 'rtk-x86_64-unknown-linux-musl.tar.gz'
    }
    if (platform === 'linux' && arch === 'arm64') {
      return 'rtk-aarch64-unknown-linux-gnu.tar.gz'
    }

    throw new Error(`Unsupported platform: ${platform}-${arch}`)
  }

  /**
   * 从 GitHub API 获取最新 Release 信息
   */
  private fetchLatestRelease(): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = https.get(RTK_API_URL, {
        headers: {
          'User-Agent': 'SpaceCode-Desktop',
          'Accept': 'application/vnd.github+json',
        },
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // 跟随重定向
          const location = res.headers.location
          if (location) {
            https.get(location, { headers: { 'User-Agent': 'SpaceCode-Desktop', 'Accept': 'application/vnd.github+json' } }, (redirectRes) => {
              let data = ''
              redirectRes.on('data', (chunk) => { data += chunk })
              redirectRes.on('end', () => {
                try { resolve(JSON.parse(data)) } catch { reject(new Error('Failed to parse release JSON')) }
              })
            }).on('error', reject)
            return
          }
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned status ${res.statusCode}`))
          return
        }
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Failed to parse release JSON')) }
        })
      })
      req.on('error', reject)
      req.setTimeout(15_000, () => {
        req.destroy()
        reject(new Error('GitHub API request timed out'))
      })
    })
  }

  /**
   * 下载文件到指定路径，支持进度回调
   */
  private downloadFile(url: string, destPath: string, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath)

      const handleResponse = (res: any) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // 跟随重定向
          file.close()
          try { rmSync(destPath, { force: true }) } catch {}
          const location = res.headers.location
          if (location) {
            https.get(location, handleResponse).on('error', reject)
            return
          }
        }
        if (res.statusCode !== 200) {
          file.close()
          try { rmSync(destPath, { force: true }) } catch {}
          reject(new Error(`Download failed with status ${res.statusCode}`))
          return
        }

        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (onProgress && total > 0) {
            onProgress({
              downloaded,
              total,
              percent: Math.round((downloaded / total) * 100),
            })
          }
        })

        res.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
        file.on('error', (err) => {
          try { rmSync(destPath, { force: true }) } catch {}
          reject(err)
        })
      }

      const req = https.get(url, { headers: { 'User-Agent': 'SpaceCode-Desktop' } }, handleResponse)
      req.on('error', reject)
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        req.destroy()
        reject(new Error('Download timed out'))
      })
    })
  }

  /**
   * 解压压缩包
   */
  private async extractArchive(archivePath: string, destDir: string): Promise<void> {
    const isZip = archivePath.endsWith('.zip')
    const isTarGz = archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')

    if (!isZip && !isTarGz) {
      throw new Error(`Unknown archive format: ${archivePath}`)
    }

    if (isZip) {
      // Windows 使用 PowerShell 解压 zip
      // 其他平台也尝试使用系统 unzip 或 tar
      await this.extractZip(archivePath, destDir)
    } else {
      // tar.gz 使用系统 tar
      await this.extractTarGz(archivePath, destDir)
    }
  }

  private extractZip(archivePath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        // 使用 PowerShell Expand-Archive
        const psCommand = `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`
        const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], { windowsHide: true })
        let stderr = ''
        child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        child.on('exit', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`PowerShell Expand-Archive failed: ${stderr}`))
        })
        child.on('error', reject)
      } else {
        // 使用 unzip 或 tar
        const child = spawn('tar', ['xf', archivePath, '-C', destDir], { windowsHide: true })
        let stderr = ''
        child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        child.on('exit', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`tar extract failed: ${stderr}`))
        })
        child.on('error', reject)
      }
    })
  }

  private extractTarGz(archivePath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('tar', ['xzf', archivePath, '-C', destDir], { windowsHide: true })
      let stderr = ''
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar xzf failed: ${stderr}`))
      })
      child.on('error', reject)
    })
  }

  /**
   * 在目录中查找 rtk 二进制文件
   */
  private findBinaryInDir(dir: string): string | null {
    const targetName = this.binaryName
    const targetNameLower = targetName.toLowerCase()

    const search = (d: string): string | null => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        return null
      }
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name)
        if (entry.isFile() && entry.name.toLowerCase() === targetNameLower) {
          return fullPath
        }
        if (entry.isDirectory()) {
          const found = search(fullPath)
          if (found) return found
        }
      }
      return null
    }

    return search(dir)
  }

  /**
   * 执行 RTK 命令
   */
  private execRtk(args: string[], options?: { timeout?: number }): Promise<string> {
    return new Promise((resolve, reject) => {
      const binaryPath = this.getBinaryPath()
      if (!existsSync(binaryPath)) {
        reject(new Error('RTK binary not found'))
        return
      }

      const timeout = options?.timeout ?? 15_000
      const child = execFile(binaryPath, args, {
        timeout,
        maxBuffer: 1024 * 1024 * 5, // 5MB
        windowsHide: true,
        env: { ...process.env },
      }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`RTK command failed: ${err.message} | stderr: ${stderr?.slice(0, 500)}`))
          return
        }
        resolve(stdout.trim())
      })
    })
  }

  /**
   * 解析 rtk gain --all --format json 的输出
   */
  private parseGainStats(data: any): RtkGainStats {
    const stats: RtkGainStats = {}

    // RTK gain JSON 格式可能因版本而异，做兼容处理
    if (data.total_commands !== undefined) {
      stats.totalCommands = data.total_commands
    }
    if (data.total_saved_tokens !== undefined) {
      stats.totalSavedTokens = data.total_saved_tokens
    } else if (data.tokens_saved !== undefined) {
      stats.totalSavedTokens = data.tokens_saved
    }
    if (data.total_saved_usd !== undefined) {
      stats.totalSavedUsd = data.total_saved_usd
    } else if (data.usd_saved !== undefined) {
      stats.totalSavedUsd = data.usd_saved
    }
    if (data.save_rate !== undefined) {
      stats.saveRate = data.save_rate
    } else if (data.total_commands && data.total_saved_tokens && data.total_tokens) {
      stats.saveRate = data.total_saved_tokens / (data.total_saved_tokens + data.total_tokens)
    }
    if (data.daily) {
      stats.daily = data.daily
    }
    if (data.by_command) {
      stats.byCommand = data.by_command
    }

    return stats
  }
}

export const rtkManager = new RtkManager()
