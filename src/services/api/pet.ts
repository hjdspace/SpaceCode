// src/services/api/pet.ts
import type { PetConfig, PetSyncPayload, PetReactionRequest, PetWindowEvent } from '@/types/pet'

/**
 * 深拷贝 Vue reactive proxy 为纯对象。
 * Vue 的 reactive Proxy 通过 Electron IPC 的 structured clone 序列化时可能丢失数据或抛错，
 * 在 IPC 边界统一深拷贝确保主进程收到的是纯 JSON 数据。
 */
function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export const petApi = {
  readConfig: (): Promise<PetConfig | null> =>
    window.electronAPI!.pet.readConfig(),

  writeConfig: (config: PetConfig): Promise<void> =>
    window.electronAPI!.pet.writeConfig(toPlain(config)),

  saveAsset: (srcPath: string, petId: string): Promise<string> =>
    window.electronAPI!.pet.saveAsset(srcPath, petId),

  deleteAsset: (relativePath: string): Promise<void> =>
    window.electronAPI!.pet.deleteAsset(relativePath),

  generateReaction: (req: PetReactionRequest): Promise<string | null> =>
    window.electronAPI!.pet.generateReaction(toPlain(req)),

  onWindowEvent: (callback: (event: PetWindowEvent) => void): (() => void) =>
    window.electronAPI!.pet.onWindowEvent(callback),

  createDesktopWindow: (): Promise<void> =>
    window.electronAPI!.pet.createDesktopWindow(),

  destroyDesktopWindow: (): Promise<void> =>
    window.electronAPI!.pet.destroyDesktopWindow(),

  updateWindowBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<void> =>
    window.electronAPI!.pet.updateWindowBounds(toPlain(bounds)),

  syncPetState: (state: PetSyncPayload): void =>
    window.electronAPI!.pet.syncPetState(toPlain(state)),
}
