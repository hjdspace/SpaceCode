/**
 * RTK (Rust Token Killer) IPC handlers.
 */
import { ipcMain } from 'electron'
import { info, error } from '../infra/logger'
import { rtkManager } from '../tools/rtkManager'
import { getMainWindow } from '../windows/mainWindow'

export function registerRtkIPCHandlers(): void {
  // 全局下载进度监听器：始终转发到渲染进程
  rtkManager.on('downloadProgress', (progress: { downloaded: number; total: number; percent: number }) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('rtk:downloadProgress', progress)
    }
  })

  ipcMain.handle('rtk:getStatus', async () => {
    return rtkManager.getStatus()
  })

  ipcMain.handle('rtk:enable', async () => {
    try {
      await rtkManager.ensureBinary()
      await rtkManager.install()
      info('RTK', 'RTK enabled and hook installed')
      return { success: true, status: await rtkManager.getStatus() }
    } catch (err: any) {
      error('RTK', 'Failed to enable RTK', { error: String(err) })
      return { success: false, error: String(err), status: await rtkManager.getStatus() }
    }
  })

  ipcMain.handle('rtk:disable', async () => {
    try {
      await rtkManager.uninstall()
      info('RTK', 'RTK disabled and hook uninstalled')
      return { success: true, status: await rtkManager.getStatus() }
    } catch (err: any) {
      error('RTK', 'Failed to disable RTK', { error: String(err) })
      return { success: false, error: String(err), status: await rtkManager.getStatus() }
    }
  })

  ipcMain.handle('rtk:downloadBinary', async () => {
    try {
      await rtkManager.downloadBinary()
      info('RTK', 'RTK binary downloaded')
      return { success: true, status: await rtkManager.getStatus() }
    } catch (err: any) {
      error('RTK', 'Failed to download RTK binary', { error: String(err) })
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('rtk:getStats', async () => {
    return rtkManager.getGainStats()
  })

  ipcMain.handle('rtk:checkUpdate', async () => {
    return rtkManager.checkUpdate()
  })

  ipcMain.handle('rtk:getBinaryPath', () => {
    return rtkManager.getBinaryPath()
  })
}
