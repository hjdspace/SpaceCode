import { contextBridge, ipcRenderer } from 'electron'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface FileStat {
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: number
}

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (text: string) => ipcRenderer.invoke('cli:sendMessage', text),
  onMessage: (callback: (msg: any) => void) =>
    ipcRenderer.on('cli:message', (_, msg) => callback(msg)),

  getAppState: () => ipcRenderer.invoke('cli:getAppState'),

  readDir: (dirPath: string): Promise<FileEntry[]> =>
    ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:readFile', filePath),
  stat: (filePath: string): Promise<FileStat | null> =>
    ipcRenderer.invoke('fs:stat', filePath),

  getEnv: (key: string): Promise<string | undefined> =>
    ipcRenderer.invoke('env:get', key),

  showDiff: (diff: any) => ipcRenderer.send('ui:showDiff', diff),
  onDiffRequested: (callback: (diff: any) => void) =>
    ipcRenderer.on('ui:showDiff', (_, diff) => callback(diff)),

  showInfoPanel: (mode: 'diff' | 'file' | 'markdown') =>
    ipcRenderer.send('ui:showInfoPanel', mode),
  hideInfoPanel: () => ipcRenderer.send('ui:hideInfoPanel'),
  onShowInfoPanel: (callback: (mode: string) => void) =>
    ipcRenderer.on('ui:showInfoPanel', (_, mode) => callback(mode)),
  onHideInfoPanel: (callback: () => void) =>
    ipcRenderer.on('ui:hideInfoPanel', () => callback()),

  onToolResult: (callback: (result: any) => void) =>
    ipcRenderer.on('cli:toolResult', (_, result) => callback(result)),

  onMenuNewChat: (callback: () => void) =>
    ipcRenderer.on('menu:newChat', () => callback()),
  onMenuOpenFolder: (callback: (path: string) => void) =>
    ipcRenderer.on('menu:openFolder', (_, path) => callback(path)),
  onMenuCloseFolder: (callback: () => void) =>
    ipcRenderer.on('menu:closeFolder', () => callback()),

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // HTTP proxy (bypasses CORS by routing through main process)
  httpFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) =>
    ipcRenderer.invoke('http:fetch', url, options),

  // System API
  getCwd: () => ipcRenderer.invoke('system:getCwd'),
  getClaudeCliPath: () => ipcRenderer.invoke('app:getClaudeCliPath'),

  // Terminal API
  terminal: {
    create: (options?: { cwd?: string; command?: string; env?: Record<string, string> }): Promise<{ id: string | null; shell?: string; error?: string }> =>
      ipcRenderer.invoke('terminal:create', options),
    write: (id: string, data: string) =>
      ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id: string) =>
      ipcRenderer.send('terminal:kill', id),
    runCommand: (id: string, command: string) =>
      ipcRenderer.send('terminal:runCommand', id, command),
    onData: (callback: (id: string, data: string) => void) => {
      const wrapper = (_: any, id: string, data: string) => callback(id, data)
      ipcRenderer.on('terminal:data', wrapper)
      return () => ipcRenderer.removeListener('terminal:data', wrapper)
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const wrapper = (_: any, id: string, exitCode: number) => callback(id, exitCode)
      ipcRenderer.on('terminal:exit', wrapper)
      return () => ipcRenderer.removeListener('terminal:exit', wrapper)
    },
  },

  queryEngine: (() => {
    const listeners = new Map<(...args: any[]) => void, { channel: string; wrapper: (...args: any[]) => void }>()

    return {
      createSession: (options?: { cwd?: string; apiKey?: string; provider?: 'anthropic' | 'openai' | 'gemini'; model?: string; baseUrl?: string }) =>
        ipcRenderer.invoke('queryengine:createSession', options),
      sendMessage: (params: { sessionId: string; content: string; options?: any }) =>
        ipcRenderer.invoke('queryengine:sendMessage', params),
      streamMessage: (params: { sessionId: string; content: string; options?: any; requestId?: string }) =>
        ipcRenderer.send('queryengine:streamMessage', params),
      getMessages: (params: { sessionId: string }) =>
        ipcRenderer.invoke('queryengine:getMessages', params),
      deleteSession: (params: { sessionId: string }) =>
        ipcRenderer.invoke('queryengine:deleteSession', params),
      onChunk: (callback: (data: { sessionId: string; chunk: string }) => void) => {
        const wrapper = (_: any, data: { sessionId: string; chunk: string }) => callback(data)
        listeners.set(callback, { channel: 'queryengine:chunk', wrapper })
        ipcRenderer.on('queryengine:chunk', wrapper)
      },
      offChunk: (callback: (...args: any[]) => void) => {
        const entry = listeners.get(callback)
        if (entry) {
          ipcRenderer.removeListener(entry.channel, entry.wrapper)
          listeners.delete(callback)
        }
      },
      onComplete: (callback: (data: { sessionId: string }) => void) => {
        const wrapper = (_: any, data: { sessionId: string }) => callback(data)
        listeners.set(callback, { channel: 'queryengine:complete', wrapper })
        ipcRenderer.on('queryengine:complete', wrapper)
      },
      offComplete: (callback: (...args: any[]) => void) => {
        const entry = listeners.get(callback)
        if (entry) {
          ipcRenderer.removeListener(entry.channel, entry.wrapper)
          listeners.delete(callback)
        }
      },
      onError: (callback: (data: { sessionId: string; error: string }) => void) => {
        const wrapper = (_: any, data: { sessionId: string; error: string }) => callback(data)
        listeners.set(callback, { channel: 'queryengine:error', wrapper })
        ipcRenderer.on('queryengine:error', wrapper)
      },
      offError: (callback: (...args: any[]) => void) => {
        const entry = listeners.get(callback)
        if (entry) {
          ipcRenderer.removeListener(entry.channel, entry.wrapper)
          listeners.delete(callback)
        }
      },
      onCompactStart: (callback: (data: { sessionId: string }) => void) => {
        const wrapper = (_: any, data: { sessionId: string }) => callback(data)
        listeners.set(callback, { channel: 'queryengine:compact_start', wrapper })
        ipcRenderer.on('queryengine:compact_start', wrapper)
      },
      offCompactStart: (callback: (...args: any[]) => void) => {
        const entry = listeners.get(callback)
        if (entry) {
          ipcRenderer.removeListener(entry.channel, entry.wrapper)
          listeners.delete(callback)
        }
      },
      onCompactComplete: (callback: (data: { sessionId: string; removedCount: number; tokenReduction: number }) => void) => {
        const wrapper = (_: any, data: { sessionId: string; removedCount: number; tokenReduction: number }) => callback(data)
        listeners.set(callback, { channel: 'queryengine:compact_complete', wrapper })
        ipcRenderer.on('queryengine:compact_complete', wrapper)
      },
      offCompactComplete: (callback: (...args: any[]) => void) => {
        const entry = listeners.get(callback)
        if (entry) {
          ipcRenderer.removeListener(entry.channel, entry.wrapper)
          listeners.delete(callback)
        }
      },
    }
  })()
})