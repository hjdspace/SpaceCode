import { ipcMain, BrowserWindow } from 'electron'
import { ClaudeCodeProcessManager, SessionConfig } from './claudeCodeProcessManager'

let manager: ClaudeCodeProcessManager | null = null
let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window
}

export function registerClaudeCodeIPC() {
  manager = new ClaudeCodeProcessManager()

  // 转发 manager 事件到 renderer
  const forwardEvents = ['assistant', 'user', 'tool_use', 'tool_result', 'result', 'compact', 'stream_event', 'log', 'exit', 'error']
  for (const event of forwardEvents) {
    manager.on(event, (data) => {
      if (mainWindow) {
        mainWindow.webContents.send(`claude-code:${event}`, data)
      }
    })
  }

  ipcMain.handle('claude-code:startSession', async (_, config: SessionConfig) => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.startSession(config)
  })

  ipcMain.handle('claude-code:sendMessage', async (_, content: string) => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.sendMessage(content)
  })

  ipcMain.handle('claude-code:abort', async () => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.abort()
  })

  ipcMain.handle('claude-code:stop', async () => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.stop()
  })

  ipcMain.handle('claude-code:isSessionActive', async () => {
    if (!manager) return false
    return manager.isSessionActive()
  })

  ipcMain.handle('claude-code:log', async () => {
    // 调试日志已禁用
  })
}

export function getManager(): ClaudeCodeProcessManager | null {
  return manager
}
