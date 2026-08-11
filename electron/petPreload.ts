// electron/petPreload.ts
// 宠物窗口专用 preload。通过 contextBridge 暴露 petWindowAPI，
// 受限于宠物窗口专用通道（不暴露文件系统/会话等主应用能力）。
import { contextBridge, ipcRenderer } from 'electron'
import type {
  PetMainWindowEvent,
  PetSyncPayload,
  PetWindowEvent,
} from '../src/types/pet'

type Unsubscribe = () => void

const petWindowAPI = {
  /** 获取初始状态（状态由主应用通过 syncPetState 推送，此处通常返回 null） */
  getInitialState: (): Promise<unknown> =>
    ipcRenderer.invoke('petWindow:getInitialState'),

  /** 监听主进程推送的同步状态（PetSyncPayload） */
  onStateUpdate: (handler: (state: PetSyncPayload) => void): Unsubscribe => {
    const wrapper = (_event: Electron.IpcRendererEvent, data: PetSyncPayload) => handler(data)
    ipcRenderer.on('petWindow:stateUpdate', wrapper)
    return () => ipcRenderer.removeListener('petWindow:stateUpdate', wrapper)
  },

  /** 向主进程发送窗口事件（drag/click/contextMenu/focusMain/...） */
  emitWindowEvent: (event: PetWindowEvent): void =>
    ipcRenderer.send('petWindow:event', event),

  /** 监听主进程发来的 MainWindowEvent（navigateSession/visibilityChanged/panelPlacementChanged） */
  onMainWindowEvent: (handler: (event: PetMainWindowEvent) => void): Unsubscribe => {
    const wrapper = (_event: Electron.IpcRendererEvent, data: PetMainWindowEvent) => handler(data)
    ipcRenderer.on('petMainWindow:event', wrapper)
    return () => ipcRenderer.removeListener('petMainWindow:event', wrapper)
  },

  /** 获取当前 locale（决定菜单 i18n） */
  getLocale: (): Promise<'zh-CN' | 'en-US'> =>
    ipcRenderer.invoke('petWindow:getLocale'),

  /** 关闭宠物窗口（主进程会 destroy 并通知主应用 enabled=false） */
  closePet: (): Promise<void> =>
    ipcRenderer.invoke('petWindow:close'),
}

contextBridge.exposeInMainWorld('petWindowAPI', petWindowAPI)
