import { electronAPI } from './_context'

export const mobile = {
  startServer: () => {
    if (electronAPI?.mobile?.startServer) {
      return electronAPI.mobile.startServer()
    }
    return Promise.resolve({ url: '', token: '', port: 0, ip: '' })
  },
  stopServer: () => {
    if (electronAPI?.mobile?.stopServer) {
      return electronAPI.mobile.stopServer()
    }
    return Promise.resolve()
  },
  getStatus: () => {
    if (electronAPI?.mobile?.getStatus) {
      return electronAPI.mobile.getStatus()
    }
    return Promise.resolve({ running: false, connected: false })
  },
  onConnected: (cb: (clientInfo: string) => void) =>
    electronAPI?.mobile?.onConnected(cb) ?? (() => {}),
  onDisconnected: (cb: () => void) =>
    electronAPI?.mobile?.onDisconnected(cb) ?? (() => {}),
}
