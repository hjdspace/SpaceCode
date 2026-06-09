import { autoUpdater } from 'electron-updater'
import { ipcMain, BrowserWindow } from 'electron'
import { info, warn, error } from './logger'

let mainWindow: BrowserWindow | null = null

// 定期检查定时器
let checkInterval: ReturnType<typeof setInterval> | null = null

export function initAutoUpdater(win: BrowserWindow) {
  mainWindow = win

  // 配置 electron-updater
  autoUpdater.autoDownload = false        // 不自动下载，由用户确认
  autoUpdater.autoInstallOnAppQuit = true  // 退出时自动安装已下载的更新

  // 检查更新失败
  autoUpdater.on('error', (err) => {
    error('AutoUpdater', 'Update error', err)
    mainWindow?.webContents.send('update:error', err?.message || String(err))
  })

  // 发现新版本
  autoUpdater.on('update-available', (updateInfo) => {
    info('AutoUpdater', `Update available: ${updateInfo.version}`)
    mainWindow?.webContents.send('update:available', {
      version: updateInfo.version,
      releaseDate: updateInfo.releaseDate,
      releaseNotes: updateInfo.releaseNotes,
      releaseName: updateInfo.releaseName,
    })
  })

  // 当前已是最新
  autoUpdater.on('update-not-available', () => {
    info('AutoUpdater', 'App is up to date')
    mainWindow?.webContents.send('update:not-available')
  })

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:download-progress', {
      bytesPerSecond: progress.bytesPerSecond,
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  // 下载完成
  autoUpdater.on('update-downloaded', (updateInfo) => {
    info('AutoUpdater', `Update downloaded: ${updateInfo.version}`)
    mainWindow?.webContents.send('update:downloaded', {
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
    info('AutoUpdater', 'Installing update and restarting')
    autoUpdater.quitAndInstall()
  })

  // 获取当前版本
  ipcMain.handle('app:getVersion', () => {
    return autoUpdater.currentVersion.version
  })
}
