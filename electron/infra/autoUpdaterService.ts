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
// 差量优先：electron-updater 6.8.9 的差量下载会发出 download-progress 事件，
// 小版本更新只下载 blockmap 增量块，速度远快于全量。差量尝试失败（停滞/报错）
// 后置 disableDifferentialDownload = true，本次链路的剩余尝试回退全量下载；
// 下一次新的下载链路会重新尝试差量。
// 超时按"停滞窗口"计算：每次 download-progress 重置计时，窗口内无任何进度
// 视作链路停滞（大量小 range 请求 RTT-bound 挂起）→ 取消请求进入重试。
// 因此"慢但在动"的下载不会被截断，只有真正停滞才会重试。
const MAX_DOWNLOAD_ATTEMPTS = 3
const RETRY_DELAY_MS = 30_000 // 重试间隔 30 秒
const DOWNLOAD_STALL_TIMEOUT_MS = 5 * 60 * 1000 // 全量下载停滞窗口 5 分钟
// 差量应远快于全量，窗口取 60 秒，与渲染端"60 秒无进度提示网络问题"对齐
const DIFFERENTIAL_STALL_TIMEOUT_MS = 60_000

// ── 检查更新 ──
// Chromium 对 GitHub 的挂起连接约 60s 才超时，竞速超时只约束我们的等待，
// electron-updater 仍可能在稍后完成并发出事件（fire-and-forget 语义）。
const AUTO_CHECK_TIMEOUT_MS = 8_000 // 自动检查失败保持静默
const MANUAL_CHECK_TIMEOUT_MS = 15_000 // 手动检查超时向渲染端报错

// 进行中的下载链路；自动与手动下载共享同一条链，失败向调用方传播
let downloadChain: Promise<void> | null = null
// 当前停滞窗口的活动钩子：download-progress 事件到达时重置计时
let notifyDownloadActivity: (() => void) | null = null

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
  // 差量优先：小版本更新只下载 blockmap 增量块；下载链路在差量尝试失败时
  // 自动置回 true 回退全量（见 runDownloadChain）
  autoUpdater.disableDifferentialDownload = false
  // 显式固定跟踪 GitHub latest 稳定版：electron-updater 构造时若发现当前版本
  // 含 prerelease 组件（如 0.8.1-rc.1）会把 allowPrerelease 置 true 并钉死在
  // rc channel，导致永远收不到更新的稳定版
  autoUpdater.allowPrerelease = false

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
    // 重置当前下载尝试的停滞窗口
    notifyDownloadActivity?.()
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

/**
 * 竞速超时：只约束我们的等待，不取消底层 promise。
 * 超时后 electron-updater 的检查仍可能在稍后完成并发出
 * update-available / update-not-available 事件。
 */
function raceWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    )
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

/** 自动检查（启动延迟检查 + 定期检查）：失败/超时保持静默，不打扰用户 */
async function checkForUpdates() {
  try {
    await raceWithTimeout(autoUpdater.checkForUpdates(), AUTO_CHECK_TIMEOUT_MS, 'update check')
  } catch (err) {
    warn('AutoUpdater', 'Periodic check failed or timed out (electron-updater may still complete later)', err)
  }
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
  // 每条新链路重新尝试差量（上一条链路可能已回退全量）
  autoUpdater.disableDifferentialDownload = false
  downloadChain = runDownloadChain().finally(() => {
    downloadChain = null
  })
  return downloadChain
}

async function runDownloadChain(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    const useDifferential = !autoUpdater.disableDifferentialDownload
    const token = new CancellationToken()
    try {
      info(
        'AutoUpdater',
        `Download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} (${useDifferential ? 'differential' : 'full'})`,
      )
      await withStallTimeout(
        autoUpdater.downloadUpdate(token),
        useDifferential ? DIFFERENTIAL_STALL_TIMEOUT_MS : DOWNLOAD_STALL_TIMEOUT_MS,
        token,
      )
      return // 下载成功 → update-downloaded 事件已触发
    } catch (err: any) {
      token.cancel() // 中断停滞的请求，让 electron-updater 释放内部 downloadPromise
      if (useDifferential && attempt < MAX_DOWNLOAD_ATTEMPTS) {
        // 差量尝试失败（停滞/报错）→ 剩余尝试回退全量下载
        autoUpdater.disableDifferentialDownload = true
        warn('AutoUpdater', 'Differential download failed, falling back to full download', err)
      } else {
        error('AutoUpdater', `Download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed`, err)
      }
      if (attempt === MAX_DOWNLOAD_ATTEMPTS) {
        sendToRenderer(UPDATE_EVENTS.onError, `Download failed: ${err?.message || String(err)}`)
        throw err
      }
      await sleep(RETRY_DELAY_MS)
    }
  }
}

/**
 * 停滞窗口超时：每次 download-progress 事件重置计时，窗口内无任何进度
 * 视作链路停滞 → 取消请求（token.cancel）并拒绝，进入下一次尝试。
 * "慢但在动"的下载不会被打断。
 */
function withStallTimeout<T>(promise: Promise<T>, ms: number, token: CancellationToken): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onActivity = () => {
      if (timer) {
        clearTimeout(timer)
        timer = setTimeout(onTimeout, ms)
      }
    }
    function onTimeout() {
      cleanup()
      token.cancel()
      reject(new Error(`Download stalled: no progress for ${Math.round(ms / 1000)} seconds`))
    }
    function cleanup() {
      if (timer) clearTimeout(timer)
      timer = null
      notifyDownloadActivity = null
    }
    notifyDownloadActivity = onActivity
    timer = setTimeout(onTimeout, ms)
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (err) => {
        cleanup()
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
      // 竞速超时避免 GitHub 挂起连接（约 60s）卡住关于页的转圈；
      // 超时后 electron-updater 仍可能在稍后完成并触发下载链路
      await raceWithTimeout(autoUpdater.checkForUpdates(), MANUAL_CHECK_TIMEOUT_MS, 'update check')
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
