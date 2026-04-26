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

  searchFiles: (dirPath: string, query: string, options?: { maxResults?: number }): Promise<Array<{ name: string; path: string; relativePath: string; isDirectory: boolean; isFile: boolean }>> =>
    ipcRenderer.invoke('fs:searchFiles', dirPath, query, options),

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

  // Inject GUI model settings into ~/.claude/settings.json
  injectGuiModelsToSettings: (models: { primaryModel: string; haikuModel?: string; sonnetModel?: string; opusModel?: string; effortLevel?: 'low' | 'medium' | 'high' | 'max' }) =>
    ipcRenderer.invoke('settings:injectGuiModels', models),

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

  // Git/SCM API
  git: {
    isRepo: (cwd: string): Promise<boolean> =>
      ipcRenderer.invoke('git:isRepo', cwd),
    getRoot: (cwd: string): Promise<string | null> =>
      ipcRenderer.invoke('git:getRoot', cwd),
    getStatus: (cwd: string): Promise<any> =>
      ipcRenderer.invoke('git:getStatus', cwd),
    stage: (cwd: string, paths: string[]): Promise<boolean> =>
      ipcRenderer.invoke('git:stage', cwd, paths),
    unstage: (cwd: string, paths: string[]): Promise<boolean> =>
      ipcRenderer.invoke('git:unstage', cwd, paths),
    stageAll: (cwd: string): Promise<boolean> =>
      ipcRenderer.invoke('git:stageAll', cwd),
    unstageAll: (cwd: string): Promise<boolean> =>
      ipcRenderer.invoke('git:unstageAll', cwd),
    commit: (cwd: string, message: string, amend?: boolean): Promise<{ success: boolean; hash?: string; error?: string }> =>
      ipcRenderer.invoke('git:commit', cwd, message, amend),
    getDiff: (cwd: string, path: string, staged?: boolean): Promise<any> =>
      ipcRenderer.invoke('git:getDiff', cwd, path, staged),
    getBranches: (cwd: string): Promise<any[]> =>
      ipcRenderer.invoke('git:getBranches', cwd),
    checkout: (cwd: string, ref: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:checkout', cwd, ref),
    createBranch: (cwd: string, name: string, checkoutTo?: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:createBranch', cwd, name, checkoutTo),
    deleteBranch: (cwd: string, name: string, force?: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:deleteBranch', cwd, name, force),
    getLog: (cwd: string, count?: number): Promise<any[]> =>
      ipcRenderer.invoke('git:getLog', cwd, count),
    discardChanges: (cwd: string, paths: string[]): Promise<boolean> =>
      ipcRenderer.invoke('git:discardChanges', cwd, paths),
    pull: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:pull', cwd),
    push: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:push', cwd),
    stash: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:stash', cwd),
    stashPop: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:stashPop', cwd),
    fetchAll: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:fetchAll', cwd),
  },

  claudeCode: {
    startSession: (config: any) => ipcRenderer.invoke('claude-code:startSession', config),
    sendMessage: (content: string) => ipcRenderer.invoke('claude-code:sendMessage', content),
    abort: () => ipcRenderer.invoke('claude-code:abort'),
    stop: () => ipcRenderer.invoke('claude-code:stop'),
    isSessionActive: () => ipcRenderer.invoke('claude-code:isSessionActive'),
    onAssistant: (callback: (data: any) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:assistant', wrapper)
      return () => ipcRenderer.removeListener('claude-code:assistant', wrapper)
    },
    onUser: (callback: (data: any) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:user', wrapper)
      return () => ipcRenderer.removeListener('claude-code:user', wrapper)
    },
    onToolUse: (callback: (data: any) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:tool_use', wrapper)
      return () => ipcRenderer.removeListener('claude-code:tool_use', wrapper)
    },
    onToolResult: (callback: (data: any) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:tool_result', wrapper)
      return () => ipcRenderer.removeListener('claude-code:tool_result', wrapper)
    },
    onResult: (callback: (data: any) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:result', wrapper)
      return () => ipcRenderer.removeListener('claude-code:result', wrapper)
    },
    onStreamEvent: (callback: (data: any) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:stream_event', wrapper)
      return () => ipcRenderer.removeListener('claude-code:stream_event', wrapper)
    },
    onLog: (callback: (data: string) => void) => {
      const wrapper = (_: any, data: string) => callback(data)
      ipcRenderer.on('claude-code:log', wrapper)
      return () => ipcRenderer.removeListener('claude-code:log', wrapper)
    },
    onExit: (callback: (code: number | null) => void) => {
      const wrapper = (_: any, code: number | null) => callback(code)
      ipcRenderer.on('claude-code:exit', wrapper)
      return () => ipcRenderer.removeListener('claude-code:exit', wrapper)
    },
  },

  // Folder selection dialog
  selectFolder: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke('dialog:selectFolder'),

  // File selection dialog
  selectFiles: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke('dialog:selectFiles'),

  // Skills API
  skills: {
    getSkills: (cwd?: string) => ipcRenderer.invoke('skills:getSkills', cwd),
    createSkill: (name: string, scope: 'global' | 'project', content: string, cwd?: string) =>
      ipcRenderer.invoke('skills:createSkill', name, scope, content, cwd),
    saveSkill: (skill: any, content: string) => ipcRenderer.invoke('skills:saveSkill', skill, content),
    deleteSkill: (filePath: string) => ipcRenderer.invoke('skills:deleteSkill', filePath),
    searchMarketplace: (query: string) => ipcRenderer.invoke('skills:searchMarketplace', query),
    installMarketplaceSkill: (source: string, skillId: string, global: boolean) => ipcRenderer.invoke('skills:installMarketplaceSkill', source, skillId, global),
    uninstallMarketplaceSkill: (skillName: string, global: boolean) => ipcRenderer.invoke('skills:uninstallMarketplaceSkill', skillName, global),
    fetchMarketplaceReadme: (source: string, skillId: string) => ipcRenderer.invoke('skills:fetchMarketplaceReadme', source, skillId),
  }
})