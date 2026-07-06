import { autoUpdater } from 'electron-updater'
import { app, ipcMain, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { info, warn, error } from './logger'

// GitHub 私有仓库更新所需的 Token
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN

let mainWindow: BrowserWindow | null = null

// 定期检查定时器
let checkInterval: ReturnType<typeof setInterval> | null = null

// ── 自动静默下载状态 ──
let isAutoDownloading = false
let downloadAttempts = 0
const MAX_DOWNLOAD_ATTEMPTS = 3
const RETRY_DELAY_MS = 30_000 // 重试间隔 30 秒

// ── 安装状态 ──
let updateDownloaded = false
let isInstalling = false

// 安全发送消息到渲染进程
function sendToRenderer(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

export function initAutoUpdater(win: BrowserWindow) {
  mainWindow = win

  // 配置 electron-updater
  autoUpdater.autoDownload = false        // 不由 electron-updater 自动下载，我们自行管理重试逻辑
  autoUpdater.autoInstallOnAppQuit = false // 关闭时由我们自行调用 quitAndInstall 控制行为

  // 私有仓库需要通过 token 认证访问 GitHub Releases
  if (GH_TOKEN) {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'hjdspace',
      repo: 'SpaceCode',
      token: GH_TOKEN,
    })
    info('AutoUpdater', 'GitHub token configured for private repo')
  } else {
    warn('AutoUpdater', 'No GH_TOKEN found, update check may fail for private repo')
  }

  // 检查更新失败
  autoUpdater.on('error', (err) => {
    error('AutoUpdater', 'Update error', err)
    sendToRenderer('update:error', err?.message || String(err))
  })

  // 发现新版本 → 自动静默下载
  autoUpdater.on('update-available', (updateInfo) => {
    info('AutoUpdater', `Update available: ${updateInfo.version}`)
    sendToRenderer('update:available', {
      version: updateInfo.version,
      releaseDate: updateInfo.releaseDate,
      releaseNotes: updateInfo.releaseNotes,
      releaseName: updateInfo.releaseName,
    })
    // 自动开始静默下载（带重试）
    autoDownloadUpdate()
  })

  // 当前已是最新
  autoUpdater.on('update-not-available', () => {
    info('AutoUpdater', 'App is up to date')
    sendToRenderer('update:not-available')
  })

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
    info('AutoUpdater', `Download progress: ${progress.percent.toFixed(1)}% (${progress.transferred}/${progress.total} bytes, ${progress.bytesPerSecond} B/s)`)
    sendToRenderer('update:download-progress', {
      bytesPerSecond: progress.bytesPerSecond,
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  // 下载完成
  autoUpdater.on('update-downloaded', (updateInfo) => {
    info('AutoUpdater', `Update downloaded: ${updateInfo.version}`)
    updateDownloaded = true
    isAutoDownloading = false
    sendToRenderer('update:downloaded', {
      version: updateInfo.version,
    })
  })

  // 启动后延迟 30 秒首次检查更新（避免影响启动速度）
  setTimeout(() => {
    checkForUpdates()
  }, 30_000)

  // 每 6 小时定期检查
  checkInterval = setInterval(() => {
    checkForUpdates()
  }, 6 * 60 * 60 * 1000)
}

export function destroyAutoUpdater() {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

/**
 * 在应用退出时静默安装已下载的更新（不重启）。
 * 由 main.ts 的 before-quit 事件调用。
 */
export function installUpdateOnQuit() {
  if (updateDownloaded && !isInstalling) {
    isInstalling = true
    info('AutoUpdater', 'Installing update on quit (silent, no restart)')
    // isSilent=true: 静默安装（无安装界面）
    // isForceRunAfter=false: 安装完成后不启动应用
    autoUpdater.quitAndInstall(true, false)
  }
}

async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    warn('AutoUpdater', 'Periodic check failed', err)
  }
}

/**
 * 自动静默下载更新，失败后自动重试（最多 MAX_DOWNLOAD_ATTEMPTS 次）。
 */
async function autoDownloadUpdate() {
  if (isAutoDownloading) return
  isAutoDownloading = true
  downloadAttempts = 0
  await attemptDownload()
}

async function attemptDownload() {
  downloadAttempts++
  try {
    info('AutoUpdater', `Auto-download attempt ${downloadAttempts}/${MAX_DOWNLOAD_ATTEMPTS}`)
    await autoUpdater.downloadUpdate()
    // 下载成功 → update-downloaded 事件会触发
  } catch (err) {
    error('AutoUpdater', `Download attempt ${downloadAttempts}/${MAX_DOWNLOAD_ATTEMPTS} failed`, err)
    if (downloadAttempts < MAX_DOWNLOAD_ATTEMPTS) {
      // 等待后重试
      setTimeout(() => {
        if (isAutoDownloading) {
          attemptDownload()
        }
      }, RETRY_DELAY_MS)
    } else {
      // 所有重试均失败
      isAutoDownloading = false
      error('AutoUpdater', `All ${MAX_DOWNLOAD_ATTEMPTS} download attempts failed`)
      sendToRenderer('update:error', `Download failed after ${MAX_DOWNLOAD_ATTEMPTS} attempts`)
    }
  }
}

// IPC Handlers
export function registerAutoUpdaterIPC() {
  // 手动检查更新（关于页面使用）
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { success: false, error: 'Updates not available in development mode' }
    }
    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (err: any) {
      error('AutoUpdater', 'Manual check failed', err)
      return { success: false, error: err.message }
    }
  })

  // 手动下载更新（关于页面使用，如果自动下载已在进行中则直接返回成功）
  ipcMain.handle('update:download', async () => {
    if (!app.isPackaged) {
      return { success: false, error: 'Updates not available in development mode' }
    }
    // 自动下载已在进行中，无需重复
    if (isAutoDownloading) {
      return { success: true }
    }
    try {
      info('AutoUpdater', 'User requested download, starting...')
      // 设置 5 分钟下载超时，防止网络问题导致永久挂起
      const downloadPromise = autoUpdater.downloadUpdate()
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Download timeout after 5 minutes')),
        5 * 60 * 1000)
      })
      await Promise.race([downloadPromise, timeoutPromise])
      info('AutoUpdater', 'Download completed successfully')
      return { success: true }
    } catch (err: any) {
      error('AutoUpdater', 'Download failed', err)
      return { success: false, error: err.message }
    }
  })

  // 安装更新并重启（标题栏绿色"更新"按钮 / 关于页面使用）
  ipcMain.handle('update:installAndRestart', () => {
    if (!app.isPackaged) return
    if (isInstalling) return
    isInstalling = true
    info('AutoUpdater', 'Installing update and restarting')
    // isSilent=false: 显示安装界面
    // isForceRunAfter=true: 安装完成后强制重启应用
    autoUpdater.quitAndInstall(false, true)
  })

  // 获取当前版本
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  // 获取指定版本的更新日志
  ipcMain.handle('changelog:getReleaseNotes', async (_event, version: string) => {
    try {
      // 1. 尝试读取本地 release-notes/v{version}.md
      const notesPath = app.isPackaged
        ? path.join(process.resourcesPath, 'release-notes', `v${version}.md`)
        : path.join(__dirname, '../release-notes', `v${version}.md`)

      try {
        const content = await fs.readFile(notesPath, 'utf-8')
        return { content, source: 'local' as const }
      } catch {
        // 本地文件不存在，尝试远程获取
      }

      // 2. Fallback: 从 GitHub Releases API 获取
      const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
      }
      if (GH_TOKEN) {
        headers['Authorization'] = `Bearer ${GH_TOKEN}`
      }

      const { net } = await import('electron')
      const request = net.request({
        url: `https://api.github.com/repos/hjdspace/SpaceCode/releases/tags/v${version}`,
        headers,
      })

      const body = await new Promise<string>((resolve, reject) => {
        let data = ''
        request.on('response', (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`GitHub API returned ${response.statusCode}`))
            return
          }
          response.on('data', (chunk) => { data += chunk.toString() })
          response.on('end', () => resolve(data))
        })
        request.on('error', reject)
        request.end()
      })

      const release = JSON.parse(body)
      if (release.body) {
        return { content: release.body, source: 'remote' as const }
      }

      return null
    } catch (err) {
      warn('Changelog', 'Failed to get release notes', err)
      return null
    }
  })
}
