// electron/petIpcHandlers.ts
import { ipcMain, BrowserWindow } from 'electron'
import { info } from './logger'
import { PetFileService } from './petFileService'
import { PetLLMProxy } from './petLLMProxy'
import { PetWindowManager } from './petWindowManager'
import type { PetConfig, PetSyncPayload, PetReactionRequest, PetWindowEvent } from '../src/types/pet'

export interface PetIpcDeps {
  petFileService: PetFileService
  petLLMProxy: PetLLMProxy
  petWindowManager: PetWindowManager
  getMainWindow: () => BrowserWindow | null
  getLocale: () => 'zh-CN' | 'en-US'
}

export function registerPetIpcHandlers(deps: PetIpcDeps): void {
  info('PetIpcHandlers', 'Registering pet IPC handlers')

  ipcMain.handle('pet:readConfig', async () => {
    return await deps.petFileService.read()
  })

  ipcMain.handle('pet:writeConfig', async (_e, config: PetConfig) => {
    await deps.petFileService.write(config)
  })

  ipcMain.handle('pet:saveAsset', async (_e, srcPath: string, petId: string) => {
    return await deps.petFileService.saveAsset(srcPath, petId)
  })

  ipcMain.handle('pet:deleteAsset', async (_e, relativePath: string) => {
    await deps.petFileService.deleteAsset(relativePath)
  })

  ipcMain.handle('pet:generateReaction', async (_e, req: PetReactionRequest) => {
    return await deps.petLLMProxy.generateReaction(req)
  })

  ipcMain.handle('petWindow:getLocale', () => {
    return deps.getLocale()
  })

  ipcMain.handle('petWindow:requestReaction', async (_e, req: PetReactionRequest) => {
    return await deps.petLLMProxy.generateReaction(req)
  })

  // 独立窗口控制
  ipcMain.handle('pet:createDesktopWindow', async () => {
    const config = deps.petFileService.getCachedConfig()
    if (config) {
      await deps.petWindowManager.create(config)
    }
  })

  ipcMain.handle('pet:destroyDesktopWindow', async () => {
    await deps.petWindowManager.destroy()
  })

  ipcMain.handle('pet:updateWindowBounds', async (_e, bounds: { x: number; y: number; width: number; height: number }) => {
    await deps.petWindowManager.updateBounds(bounds)
  })

  ipcMain.on('pet:syncPetState', (_e, state: PetSyncPayload) => {
    deps.petWindowManager.syncPetState(state)
  })

  // 独立窗口事件中继
  ipcMain.on('petWindow:event', (_e, event: PetWindowEvent) => {
    deps.petWindowManager.handleWindowEvent(event)
    deps.getMainWindow()?.webContents.send('pet:windowEvent', event)
  })

  ipcMain.handle('petWindow:getInitialState', () => {
    return null  // 状态由主应用通过 syncPetState 推送
  })
}
