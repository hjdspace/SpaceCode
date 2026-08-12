// src/services/api/pet.ts
import { electronAPI } from './_context'
import type { PetConfig, PetPreferences, PetSyncPayload } from '@/types/pet'

/**
 * 深拷贝 Vue reactive proxy 为纯对象。
 * Vue 的 reactive Proxy 通过 Electron IPC 的 structured clone 序列化时可能丢失数据或抛错，
 * 在 IPC 边界统一深拷贝确保主进程收到的是纯 JSON 数据。
 */
function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/** 空操作清理函数，用于 IPC listener 不可用时返回安全回退 */
const noopCleanup = (): void => {}

export const petApi = {
  readConfig: (): Promise<PetConfig | null> =>
    electronAPI?.pet?.readConfig() ?? Promise.resolve(null),

  writeConfig: (config: PetConfig): Promise<void> =>
    electronAPI?.pet?.writeConfig(toPlain(config)) ?? Promise.resolve(),

  createDesktopWindow: (): Promise<void> =>
    electronAPI?.pet?.createDesktopWindow() ?? Promise.resolve(),

  destroyDesktopWindow: (): Promise<void> =>
    electronAPI?.pet?.destroyDesktopWindow() ?? Promise.resolve(),

  syncPetState: (state: PetSyncPayload): void => {
    electronAPI?.pet?.syncPetState(toPlain(state))
  },

  /** 监听偏好变更（来自宠物窗口的偏好变更，主进程转发） */
  onPreferencesChanged: (callback: (patch: Partial<PetPreferences>) => void): () => void =>
    electronAPI?.pet?.onPreferencesChanged(callback) ?? noopCleanup,

  /** 监听会话跳转请求（来自宠物窗口的 focusSession，主进程转发） */
  onNavigateSession: (callback: (sessionId: string) => void): () => void =>
    electronAPI?.pet?.onNavigateSession(callback) ?? noopCleanup,

  /** 监听宠物窗口就绪请求（窗口 mount 后请求主应用推送一次完整状态） */
  onResyncRequest: (callback: () => void): () => void =>
    electronAPI?.pet?.onResyncRequest(callback) ?? noopCleanup,
}
