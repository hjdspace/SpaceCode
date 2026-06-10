import { autoUpdater } from 'electron-updater'
import { app, ipcMain, BrowserWindow } from 'electron'
import { info, warn, error } from './logger'

let mainWindow: BrowserWindow | null = null

// 定期检查定时器
let checkInterval: ReturnType<typeof setInterval> | null = null

// 安全发送消息到渲染进程
function sendToRenderer(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

export function initAutoUpdater(win: BrowserWindow) {
  mainWindow = win

  // 配置 electron-updater
  autoUpdater.autoDownload = false        // 不自动下载，由用户确认
  autoUpdater.autoInstallOnAppQuit = true  // 退出时自动安装已下载的更新

  // 检查更新失败
  autoUpdater.on('error', (err) => {
    error('AutoUpdater', 'Update error', err)
    sendToRenderer('update:error', err?.message || String(err))
  })

  // 发现新版本
  autoUpdater.on('update-available', (updateInfo) => {
    info('AutoUpdater', `Update available: ${updateInfo.version}`)
    sendToRenderer('update:available', {
      version: updateInfo.version,
      releaseDate: updateInfo.releaseDate,
      releaseNotes: updateInfo.releaseNotes,
      releaseName: updateInfo.releaseName,
    })
  })

  // 当前已是最新
  autoUpdater.on('update-not-available', () => {
    info('AutoUpdater', 'App is up to date')
    sendToRenderer('update:not-available')
  })

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
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
    sendToRenderer('update:downloaded', {
      version: updateInfo.version,
    })
  })

  // 启动后延迟 30 秒首次检查更新（避免影响启动速度）
  setTimeout(() => {
    checkForUpdates()
  }, 30_000)

  // 每 4 小时定期检查
  checkInterval = setInterval(() => {
    checkForUpdates()
  }, 4 * 60 * 60 * 1000)
}

export function destroyAutoUpdater() {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    warn('AutoUpdater', 'Periodic check failed', err)
  }
}

// IPC Handlers
export function registerAutoUpdaterIPC() {
  // 手动检查更新
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

  // 下载更新
  ipcMain.handle('update:download', async () => {
    if (!app.isPackaged) {
      return { success: false, error: 'Updates not available in development mode' }
    }
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err: any) {
      error('AutoUpdater', 'Download failed', err)
      return { success: false, error: err.message }
    }
  })

  // 安装更新并重启
  ipcMain.handle('update:installAndRestart', () => {
    if (!app.isPackaged) return
    info('AutoUpdater', 'Installing update and restarting')
    autoUpdater.quitAndInstall()
  })

  // 获取当前版本
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })
}
