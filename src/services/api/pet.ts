// src/services/api/pet.ts
import type { PetConfig, PetPreferences, PetSyncPayload } from '@/types/pet'

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

  createDesktopWindow: (): Promise<void> =>
    window.electronAPI!.pet.createDesktopWindow(),

  destroyDesktopWindow: (): Promise<void> =>
    window.electronAPI!.pet.destroyDesktopWindow(),

  syncPetState: (state: PetSyncPayload): void =>
    window.electronAPI!.pet.syncPetState(toPlain(state)),

  /** 监听偏好变更（来自宠物窗口的偏好变更，主进程转发） */
  onPreferencesChanged: (callback: (patch: Partial<PetPreferences>) => void): () => void =>
    window.electronAPI!.pet.onPreferencesChanged(callback),

  /** 监听会话跳转请求（来自宠物窗口的 focusSession，主进程转发） */
  onNavigateSession: (callback: (sessionId: string) => void): () => void =>
    window.electronAPI!.pet.onNavigateSession(callback),

  /** 监听宠物窗口就绪请求（窗口 mount 后请求主应用推送一次完整状态） */
  onResyncRequest: (callback: () => void): () => void =>
    window.electronAPI!.pet.onResyncRequest(callback),
}
