// electron/petIpcHandlers.ts
import { ipcMain, BrowserWindow } from 'electron'
import { info } from './logger'
import { PetFileService } from './petFileService'
import { PetLLMProxy } from './petLLMProxy'
import type { PetConfig, PetReactionRequest } from '../src/types/pet'

export interface PetIpcDeps {
  petFileService: PetFileService
  petLLMProxy: PetLLMProxy
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
}
