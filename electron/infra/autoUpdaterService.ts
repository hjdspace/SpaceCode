import { autoUpdater, CancellationToken } from 'electron-updater'
import { app, ipcMain, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { info, warn, error } from './logger'
import { updateNamespace } from '@/shared/channels/update'
import { channelNames, eventChannels } from '@/shared/channelMap'

const UPDATE_CHANNELS = channelNames(updateNamespace.channels, 'update:')
const UPDATE_EVENTS = eventChannels(updateNamespace.events, 'update:')

let mainWindow: BrowserWindow | null = null

// 定期检查定时器
let checkInterval: ReturnType<typeof setInterval> | null = null

// ── 下载链路（自动静默下载与手动下载共用） ──
// 差量下载走 blockmap 多 range 请求时不产生 download-progress 事件，
// 且对 GitHub CDN 的大量小 range 请求 RTT-bound、国内网络下极易停滞，
// 表现为"转圈无进度"，因此强制完整下载（参考 cc-haha 的 updater 实现）。
const MAX_DOWNLOAD_ATTEMPTS = 3
const RETRY_DELAY_MS = 30_000 // 重试间隔 30 秒
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000 // 单次尝试 5 分钟超时

// 进行中的下载链路；自动与手动下载共享同一条链，失败向调用方传播
let downloadChain: Promise<void> | null = null

// ── 安装状态 ──
let updateDownloaded = false
let isInstalling = false

// 安全发送消息到渲染进程
function sendToRenderer(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

export function setUpdateToken(token: string) {
  if (token) {
    info('AutoUpdater', 'GitHub token configured for private repo')
    return token
  }
  warn('AutoUpdater', 'No GH_TOKEN provided, update check may fail for private repo')
  return null
}

export function initAutoUpdater(win: BrowserWindow, ghToken: string | null) {
  mainWindow = win

  // 配置 electron-updater
  autoUpdater.autoDownload = false        // 不由 electron-updater 自动下载，我们自行管理重试逻辑
  autoUpdater.autoInstallOnAppQuit = false // 关闭时由我们自行调用 quitAndInstall 控制行为
  autoUpdater.disableDifferentialDownload = true // 差量下载无进度事件且易停滞，强制完整下载

  // 仓库已公开，无需 token 认证。
  // 注意：不要传 token 给 setFeedURL — 如果传入 token（即使是过期的），
  // electron-updater 会切换到 PrivateGitHubProvider 并在请求中携带该 token，
  // 导致 GitHub API 返回 401 Bad credentials。
  // app-update.yml（由 electron-builder 在打包时生成）已包含正确的公共仓库配置，
  // 不调用 setFeedURL 时 electron-updater 会自动读取该文件。
  if (ghToken) {
    info('AutoUpdater', 'Public repo — ignoring GH_TOKEN from environment')
  }

  // 检查更新失败
  autoUpdater.on('error', (err) => {
    error('AutoUpdater', 'Update error', err)
    sendToRenderer(UPDATE_EVENTS.onError, err?.message || String(err))
  })

  // 发现新版本 → 自动静默下载
  autoUpdater.on('update-available', (updateInfo) => {
    info('AutoUpdater', `Update available: ${updateInfo.version}`)
    sendToRenderer(UPDATE_EVENTS.onAvailable, {
      version: updateInfo.version,
      releaseDate: updateInfo.releaseDate,
      releaseNotes: updateInfo.releaseNotes,
      releaseName: updateInfo.releaseName,
    })
    // 自动开始静默下载（带重试）；失败已通过 onError 事件通知渲染端
    startDownloadChain().catch(() => {})
  })

  // 当前已是最新
  autoUpdater.on('update-not-available', () => {
    info('AutoUpdater', 'App is up to date')
    sendToRenderer(UPDATE_EVENTS.onNotAvailable)
  })

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
    info('AutoUpdater', `Download progress: ${progress.percent.toFixed(1)}% (${progress.transferred}/${progress.total} bytes, ${progress.bytesPerSecond} B/s)`)
    sendToRenderer(UPDATE_EVENTS.onDownloadProgress, {
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
    sendToRenderer(UPDATE_EVENTS.onDownloaded, {
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
 * 启动（或复用进行中的）下载链路。
 *
 * 自动静默下载（update-available 触发）与手动下载（update:download IPC）
 * 共用同一条链：单次尝试带超时并取消停滞请求，失败自动重试；
 * 最终失败时向渲染端发 onError 并向调用方抛出（手动调用据此返回
 * { success: false }，渲染端的超时保护不会被假成功短路）。
 * 下载成功由 electron-updater 的 update-downloaded 事件通知渲染端。
 */
function startDownloadChain(): Promise<void> {
  if (downloadChain) return downloadChain
  downloadChain = runDownloadChain().finally(() => {
    downloadChain = null
  })
  return downloadChain
}

async function runDownloadChain(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    const token = new CancellationToken()
    try {
      info('AutoUpdater', `Download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS}`)
      await withTimeout(autoUpdater.downloadUpdate(token), DOWNLOAD_TIMEOUT_MS, token)
      return // 下载成功 → update-downloaded 事件已触发
    } catch (err: any) {
      token.cancel() // 中断停滞的请求，让 electron-updater 释放内部 downloadPromise
      error('AutoUpdater', `Download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed`, err)
      if (attempt === MAX_DOWNLOAD_ATTEMPTS) {
        sendToRenderer(UPDATE_EVENTS.onError, `Download failed: ${err?.message || String(err)}`)
        throw err
      }
      await sleep(RETRY_DELAY_MS)
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, token: CancellationToken): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      token.cancel()
      reject(new Error(`Download timeout after ${Math.round(ms / 1000)} seconds`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// IPC Handlers
export function registerAutoUpdaterIPC() {
  // 手动检查更新（关于页面使用）
  ipcMain.handle(UPDATE_CHANNELS.check, async () => {
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

  // 手动下载更新（关于页面使用）— 与自动下载共用同一条链：
  // 已在下载中则等待其结果，不再假成功（假成功会让渲染端取消超时保护后无限转圈）
  ipcMain.handle(UPDATE_CHANNELS.download, async () => {
    if (!app.isPackaged) {
      return { success: false, error: 'Updates not available in development mode' }
    }
    try {
      info('AutoUpdater', 'User requested download')
      await startDownloadChain()
      info('AutoUpdater', 'Download completed successfully')
      return { success: true }
    } catch (err: any) {
      error('AutoUpdater', 'Download failed', err)
      return { success: false, error: err?.message || String(err) }
    }
  })

  // 安装更新并重启（标题栏绿色"更新"按钮 / 关于页面使用）
  ipcMain.handle(UPDATE_CHANNELS.installAndRestart, () => {
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
