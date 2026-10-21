/**
 * IM (Instant Messaging) integration IPC handlers.
 */
import { ipcMain, app } from 'electron'
import { getImSidecarManager } from '../imServer/imSidecarManager'

export function registerImIPCHandlers(): void {
  const manager = getImSidecarManager()

  ipcMain.handle('im:getConfig', () => {
    return manager.getAdapterConfig()
  })

  ipcMain.handle('im:updateConfig', (_, config: any) => {
    manager.updateAdapterConfig(config)
  })

  ipcMain.handle('im:startServer', async () => {
    await manager.startServer()
  })

  ipcMain.handle('im:stopServer', () => {
    manager.stopServer()
  })

  ipcMain.handle('im:getServerStatus', () => {
    return manager.getServerStatus()
  })

  ipcMain.handle('im:startAdapter', async (_, platform: string) => {
    await manager.startAdapter(platform as any)
  })

  ipcMain.handle('im:stopAdapter', (_, platform: string) => {
    manager.stopAdapter(platform as any)
  })

  ipcMain.handle('im:getAdapterStatuses', () => {
    return manager.getAllAdapterStatuses()
  })

  ipcMain.handle('im:generatePairingCode', () => {
    return manager.generatePairingCode()
  })

  ipcMain.handle('im:clearPairingCode', () => {
    manager.clearPairingCode()
  })

  // ── WeChat QR Login ──
  ipcMain.handle('im:wechat:startQrLogin', async () => {
    return manager.startWechatQrLogin()
  })

  ipcMain.handle('im:wechat:checkQrStatus', async (_, qrcodeId: string) => {
    return manager.checkWechatQrStatus(qrcodeId)
  })

  ipcMain.handle('im:wechat:unbind', () => {
    manager.unbindWechat()
  })

  ipcMain.handle('im:wechat:isBound', () => {
    return manager.isWechatBound()
  })

  // Cleanup on app quit
  app.on('before-quit', () => {
    manager.destroy()
  })
}
