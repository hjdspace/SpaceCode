// electron/petPreload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('petWindowAPI', {
  getInitialState: () => ipcRenderer.invoke('petWindow:getInitialState'),
  onStateUpdate: (handler: (state: any) => void) => {
    const wrapper = (_: unknown, data: any) => handler(data)
    ipcRenderer.on('petWindow:stateUpdate', wrapper)
    return () => ipcRenderer.removeListener('petWindow:stateUpdate', wrapper)
  },
  emitWindowEvent: (event: any) => ipcRenderer.send('petWindow:event', event),
  requestReaction: (req: any) => ipcRenderer.invoke('petWindow:requestReaction', req),
  getLocale: () => ipcRenderer.invoke('petWindow:getLocale'),
})
