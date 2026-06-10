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

// ============================================================
// Renderer Logger — 将前端日志转发到主进程写入文件
// ============================================================
const rendererLogger = {
  debug: (scope: string, message: string, data?: any) =>
    ipcRenderer.send('log:debug', scope, message, data),
  info: (scope: string, message: string, data?: any) =>
    ipcRenderer.send('log:info', scope, message, data),
  warn: (scope: string, message: string, data?: any) =>
    ipcRenderer.send('log:warn', scope, message, data),
  error: (scope: string, message: string, data?: any) =>
    ipcRenderer.send('log:error', scope, message, data),
}

const debugApi = {
  listFiles: () => ipcRenderer.invoke('debug:listFiles'),
  readFile: (filePath: string, maxBytes?: number) =>
    ipcRenderer.invoke('debug:readFile', filePath, maxBytes),
  listTraceSessions: () => ipcRenderer.invoke('debug:listTraceSessions'),
  readTraceEvents: (sessionId: string, maxEvents?: number) =>
    ipcRenderer.invoke('debug:readTraceEvents', sessionId, maxEvents),
}

const traceApi = {
  event: (event: any) => ipcRenderer.send('trace:event', event),
}

// Turn Checkpoint API - 轮次变更追踪
const sessionApi = {
  getTurnCheckpoints: (sessionId: string, projectPath?: string) =>
    ipcRenderer.invoke('session:getTurnCheckpoints', sessionId, projectPath),
  getTurnRewindPreviewFiles: (
    sessionId: string,
    targetUserMessageId: string,
    userMessageIndex: number | undefined,
    projectPath?: string
  ) =>
    ipcRenderer.invoke(
      'session:getTurnRewindPreviewFiles',
      sessionId,
      targetUserMessageId,
      userMessageIndex,
      projectPath
    ),
  getTurnCheckpointDiff: (
    sessionId: string,
    targetUserMessageId: string,
    filePath: string,
    userMessageIndex?: number,
    projectPath?: string
  ) =>
    ipcRenderer.invoke(
      'session:getTurnCheckpointDiff',
      sessionId,
      targetUserMessageId,
      filePath,
      userMessageIndex,
      projectPath
    ),
  rewindTurn: (
    sessionId: string,
    options: { targetUserMessageId: string; userMessageIndex?: number },
    projectPath?: string
  ) =>
    ipcRenderer.invoke('session:rewindTurn', sessionId, options, projectPath),
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info for titlebar rendering
  platform: process.platform,
  sendMessage: (text: string) => ipcRenderer.invoke('cli:sendMessage', text),
  onMessage: (callback: (msg: any) => void) =>
    ipcRenderer.on('cli:message', (_, msg) => callback(msg)),

  getAppState: () => ipcRenderer.invoke('cli:getAppState'),

  // Window controls (used on Linux where we run frameless)
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChanged: (callback: (maximized: boolean) => void) => {
      const wrapper = (_: any, maximized: boolean) => callback(maximized)
      ipcRenderer.on('window:maximizeChanged', wrapper)
      return () => ipcRenderer.removeListener('window:maximizeChanged', wrapper)
    },
  },

  readDir: (dirPath: string): Promise<FileEntry[]> =>
    ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  stat: (filePath: string): Promise<FileStat | null> =>
    ipcRenderer.invoke('fs:stat', filePath),

  searchFiles: (dirPath: string, query: string, options?: { maxResults?: number }): Promise<Array<{ name: string; path: string; relativePath: string; isDirectory: boolean; isFile: boolean }>> =>
    ipcRenderer.invoke('fs:searchFiles', dirPath, query, options),

  // File operations for context menu
  copyFile: (srcPath: string, destPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:copy', srcPath, destPath),
  moveFile: (srcPath: string, destPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:move', srcPath, destPath),
  renameFile: (filePath: string, newName: string): Promise<{ success: boolean; error?: string; newPath?: string }> =>
    ipcRenderer.invoke('fs:rename', filePath, newName),
  deleteFile: (filePath: string, permanent?: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:delete', filePath, permanent),

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
  openInEditor: (editor: 'vscode' | 'visualstudio' | 'cursor' | 'fileExplorer' | 'terminal' | 'gitBash' | 'wsl' | 'androidStudio', targetPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:openInEditor', editor, targetPath),

  // HTTP proxy (bypasses CORS by routing through main process)
  httpFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) =>
    ipcRenderer.invoke('http:fetch', url, options),

  // System API
  getCwd: () => ipcRenderer.invoke('system:getCwd'),
  getClaudeCliPath: () => ipcRenderer.invoke('app:getClaudeCliPath'),
  getPiCliPath: () => ipcRenderer.invoke('app:getPiCliPath'),

  // Inject GUI model settings into ~/.claude/settings.json
  injectGuiModelsToSettings: (models: { primaryModel: string; haikuModel?: string; sonnetModel?: string; opusModel?: string; effortLevel?: 'low' | 'medium' | 'high' | 'max'; permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' }) =>
    ipcRenderer.invoke('settings:injectGuiModels', models),

  // GUI Settings persistence (file-based, ~/.claude/gui-settings.json)
  saveGuiSettings: (data: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:saveGuiSettings', data),
  loadGuiSettings: (): Promise<{ success: boolean; data: string | null; error?: string }> =>
    ipcRenderer.invoke('settings:loadGuiSettings'),

  // Hooks Settings persistence
  loadHooksSettings: (scope?: string): Promise<{ success: boolean; data: string | null; error?: string }> =>
    ipcRenderer.invoke('settings:loadHooksSettings', scope),
  saveHooksSettings: (hooksJson: string, scope?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:saveHooksSettings', hooksJson, scope),

  getTokenUsageStats: () =>
    ipcRenderer.invoke('stats:getTokenUsage'),

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
    getFullDiff: (cwd: string): Promise<any> =>
      ipcRenderer.invoke('git:getFullDiff', cwd),
    getStagedDiff: (cwd: string): Promise<string> =>
      ipcRenderer.invoke('git:getStagedDiff', cwd),
    showFile: (cwd: string, path: string): Promise<string | null> =>
      ipcRenderer.invoke('git:showFile', cwd, path),
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
    startSession: (sessionId: string, config: any) =>
      ipcRenderer.invoke('claude-code:startSession', sessionId, config),
    sendMessage: (sessionId: string, content: string, images?: any[]) =>
      ipcRenderer.invoke('claude-code:sendMessage', sessionId, content, images),
    abort: (sessionId: string) =>
      ipcRenderer.invoke('claude-code:abort', sessionId),
    stop: (sessionId: string) =>
      ipcRenderer.invoke('claude-code:stop', sessionId),
    suspendSession: (sessionId: string) =>
      ipcRenderer.invoke('claude-code:suspendSession', sessionId),
    resumeSession: (sessionId: string) =>
      ipcRenderer.invoke('claude-code:resumeSession', sessionId),
    getSessionStatus: (sessionId: string) =>
      ipcRenderer.invoke('claude-code:getSessionStatus', sessionId),
    getActiveSessions: () =>
      ipcRenderer.invoke('claude-code:getActiveSessions'),
    isSessionActive: (sessionId?: string) =>
      ipcRenderer.invoke('claude-code:isSessionActive', sessionId),
    listAgents: (cwd?: string, engineType?: string) =>
      ipcRenderer.invoke('claude-code:listAgents', cwd, engineType),
    isEngineAvailable: (engineType: string) =>
      ipcRenderer.invoke('claude-code:isEngineAvailable', engineType),
    updateThinkingLevel: (sessionId: string, enabled: boolean) =>
      ipcRenderer.invoke('claude-code:updateThinkingLevel', sessionId, enabled),
    // 会话历史相关
    listProjectSessions: (cwd: string) =>
      ipcRenderer.invoke('claude-code:listProjectSessions', cwd),
    listAllSessions: () =>
      ipcRenderer.invoke('claude-code:listAllSessions'),
    getFullSession: (projectPath: string, sessionId: string) =>
      ipcRenderer.invoke('claude-code:getFullSession', projectPath, sessionId),
    restoreSession: (sessionId: string, projectPath: string) =>
      ipcRenderer.invoke('claude-code:restoreSession', sessionId, projectPath),
    onAssistant: (callback: (data: { sessionId: string; data: any }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:assistant', wrapper)
      return () => ipcRenderer.removeListener('claude-code:assistant', wrapper)
    },
    onUser: (callback: (data: { sessionId: string; data: any }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:user', wrapper)
      return () => ipcRenderer.removeListener('claude-code:user', wrapper)
    },
    onToolUse: (callback: (data: { sessionId: string; data: any }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:tool_use', wrapper)
      return () => ipcRenderer.removeListener('claude-code:tool_use', wrapper)
    },
    onToolResult: (callback: (data: { sessionId: string; data: any }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:tool_result', wrapper)
      return () => ipcRenderer.removeListener('claude-code:tool_result', wrapper)
    },
    onResult: (callback: (data: { sessionId: string; data: any }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:result', wrapper)
      return () => ipcRenderer.removeListener('claude-code:result', wrapper)
    },
    onStreamEvent: (callback: (data: { sessionId: string; data: any }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:stream_event', wrapper)
      return () => ipcRenderer.removeListener('claude-code:stream_event', wrapper)
    },
    onLog: (callback: (data: { sessionId: string; data: string }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:log', wrapper)
      return () => ipcRenderer.removeListener('claude-code:log', wrapper)
    },
    onExit: (callback: (data: { sessionId: string; data: number | null | { code?: number | null; signal?: string | null; stderr?: string } }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:exit', wrapper)
      return () => ipcRenderer.removeListener('claude-code:exit', wrapper)
    },
    onSuspended: (callback: (data: { sessionId: string; data: { reason: string } }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:suspended', wrapper)
      return () => ipcRenderer.removeListener('claude-code:suspended', wrapper)
    },
    onEvictionBlocked: (callback: (data: { sessionId: string; data: { reason: string; pendingTools: number } }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:eviction_blocked', wrapper)
      return () => ipcRenderer.removeListener('claude-code:eviction_blocked', wrapper)
    },
    submitToolAnswer: (sessionId: string, toolCallId: string, answers: Record<string, string>) =>
      ipcRenderer.invoke('claude-code:submitToolAnswer', sessionId, toolCallId, answers),
    skipToolAnswer: (sessionId: string, toolCallId: string) =>
      ipcRenderer.invoke('claude-code:skipToolAnswer', sessionId, toolCallId),

    // ── can_use_tool / control_request 协议 ──
    allowPermission: (
      sessionId: string,
      requestId: string,
      updatedInput?: Record<string, unknown>,
      decisionClassification?: 'user_temporary' | 'user_permanent',
    ) =>
      ipcRenderer.invoke(
        'claude-code:allowPermission',
        sessionId,
        requestId,
        updatedInput,
        decisionClassification,
      ),
    denyPermission: (
      sessionId: string,
      requestId: string,
      message?: string,
      options?: { interrupt?: boolean },
    ) => ipcRenderer.invoke('claude-code:denyPermission', sessionId, requestId, message, options),
    respondPermission: (sessionId: string, requestId: string, decision: any) =>
      ipcRenderer.invoke('claude-code:respondPermission', sessionId, requestId, decision),
    setPermissionMode: (
      sessionId: string,
      mode: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions',
    ) => ipcRenderer.invoke('claude-code:setPermissionMode', sessionId, mode),
    setModel: (sessionId: string, model: string | undefined) =>
      ipcRenderer.invoke('claude-code:setModel', sessionId, model),
    getMcpStatus: (sessionId: string) => ipcRenderer.invoke('claude-code:getMcpStatus', sessionId),
    getContextUsage: (sessionId: string) =>
      ipcRenderer.invoke('claude-code:getContextUsage', sessionId),
    getSettings: (sessionId: string) => ipcRenderer.invoke('claude-code:getSettings', sessionId),
    stopEngineTask: (sessionId: string, taskId: string) =>
      ipcRenderer.invoke('claude-code:stopEngineTask', sessionId, taskId),
    getPendingPermissionRequestIds: (sessionId: string) =>
      ipcRenderer.invoke('claude-code:getPendingPermissionRequestIds', sessionId),
    onPermissionRequest: (callback: (data: { sessionId: string; data: any }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:permission_request', wrapper)
      return () => ipcRenderer.removeListener('claude-code:permission_request', wrapper)
    },
    onPermissionRequestCancelled: (callback: (data: { sessionId: string; data: any }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:permission_request_cancelled', wrapper)
      return () => ipcRenderer.removeListener('claude-code:permission_request_cancelled', wrapper)
    },
    onElicitationRequest: (callback: (data: { sessionId: string; data: any }) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:elicitation_request', wrapper)
      return () => ipcRenderer.removeListener('claude-code:elicitation_request', wrapper)
    },
    detectInstalledCli: () =>
      ipcRenderer.invoke('claude-code:detectInstalledCli'),
    checkEnvironment: () =>
      ipcRenderer.invoke('claude-code:checkEnvironment'),
    installCli: () =>
      ipcRenderer.invoke('claude-code:installCli'),
    onInstallProgress: (callback: (progress: any) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('claude-code:installProgress', wrapper)
      return () => ipcRenderer.removeListener('claude-code:installProgress', wrapper)
    },
    getProxyStatus: () =>
      ipcRenderer.invoke('claude-code:getProxyStatus'),
    isProxyRunning: () =>
      ipcRenderer.invoke('claude-code:isProxyRunning'),
    notifyEngineSourceChanged: (source: string) =>
      ipcRenderer.invoke('claude-code:engineSourceChanged', source),
  },

  // Folder selection dialog
  selectFolder: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke('dialog:selectFolder'),

  // File selection dialog
  selectFiles: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke('dialog:selectFiles'),

  // Prompt Optimizer API
  optimizePrompt: (
    prompt: string,
    options?: { workingDirectory?: string },
  ): Promise<{ success: boolean; result?: string; error?: string }> =>
    ipcRenderer.invoke('prompt-optimizer:optimize', prompt, options),

  // Skills API
  skills: {
    getSkills: (cwd?: string) => ipcRenderer.invoke('skills:getSkills', cwd),
    getBundledSkills: () => ipcRenderer.invoke('skills:getBundledSkills'),
    createSkill: (name: string, scope: 'global' | 'project', content: string, cwd?: string) =>
      ipcRenderer.invoke('skills:createSkill', name, scope, content, cwd),
    saveSkill: (skill: any, content: string) => ipcRenderer.invoke('skills:saveSkill', skill, content),
    deleteSkill: (filePath: string) => ipcRenderer.invoke('skills:deleteSkill', filePath),
    searchMarketplace: (query: string) => ipcRenderer.invoke('skills:searchMarketplace', query),
    installMarketplaceSkill: (source: string, skillId: string, global: boolean, cwd?: string) => ipcRenderer.invoke('skills:installMarketplaceSkill', source, skillId, global, cwd),
    uninstallMarketplaceSkill: (skillName: string, global: boolean, cwd?: string) => ipcRenderer.invoke('skills:uninstallMarketplaceSkill', skillName, global, cwd),
    fetchMarketplaceReadme: (source: string, skillId: string) => ipcRenderer.invoke('skills:fetchMarketplaceReadme', source, skillId),
    scanLocalLibrary: (dirPaths: string[], cwd?: string) => ipcRenderer.invoke('skills:scan-local-library', dirPaths, cwd),
    installLocal: (skillName: string, scope: 'global' | 'project', cwd?: string) => ipcRenderer.invoke('skills:install-local', skillName, scope, cwd),
    uninstallLocal: (skillName: string, cwd?: string) => ipcRenderer.invoke('skills:uninstall-local', skillName, cwd),
    installLocalBundle: (bundleId: string, scope: 'global' | 'project', cwd?: string) => ipcRenderer.invoke('skills:install-local-bundle', bundleId, scope, cwd),
    uninstallLocalBundle: (bundleName: string, cwd?: string) => ipcRenderer.invoke('skills:uninstall-local-bundle', bundleName, cwd),
    getCustomDirs: () => ipcRenderer.invoke('skills:get-custom-dirs'),
    addCustomDir: (dirPath: string) => ipcRenderer.invoke('skills:add-custom-dir', dirPath),
    removeCustomDir: (dirPath: string) => ipcRenderer.invoke('skills:remove-custom-dir', dirPath),
  },

  // Agents API
  agents: {
    scanLibrary: (cwd?: string) => ipcRenderer.invoke('agents:scanLibrary', cwd),
    install: (agentName: string, scope: 'global' | 'project', cwd?: string) =>
      ipcRenderer.invoke('agents:install', agentName, scope, cwd),
    uninstall: (agentName: string, scope: 'global' | 'project', cwd?: string) =>
      ipcRenderer.invoke('agents:uninstall', agentName, scope, cwd),
    getInstalled: (cwd?: string) => ipcRenderer.invoke('agents:getInstalled', cwd),
    listWorkflows: () => ipcRenderer.invoke('agents:listWorkflows'),
    saveWorkflow: (workflow: any) => ipcRenderer.invoke('agents:saveWorkflow', workflow),
    deleteWorkflow: (id: string) => ipcRenderer.invoke('agents:deleteWorkflow', id),
    exportWorkflow: (id: string, scope: 'global' | 'project', cwd?: string) =>
      ipcRenderer.invoke('agents:exportWorkflow', id, scope, cwd),
  },

  // Image persistence — 聊天图片落盘到 userData，避免 localStorage 配额溢出
  image: {
    save: (id: string, dataUrl: string) =>
      ipcRenderer.invoke('image:save', id, dataUrl) as Promise<{ success: boolean; error?: string }>,
    load: (id: string) =>
      ipcRenderer.invoke('image:load', id) as Promise<string | null>,
  },

  // 渲染进程日志桥接
  logger: rendererLogger,
  debug: debugApi,
  trace: traceApi,
  session: sessionApi,

  // MCP Probe — 直接探测 MCP 服务器（不依赖 engine session）
  // MCP Config CRUD — 持久化到 <userData>/mcp-servers.json
  mcp: {
    getServers: () => ipcRenderer.invoke('mcp:getServers'),
    addServer: (name: string, server: any) => ipcRenderer.invoke('mcp:addServer', name, server),
    updateServers: (servers: Record<string, any>) => ipcRenderer.invoke('mcp:updateServers', servers),
    deleteServer: (name: string) => ipcRenderer.invoke('mcp:deleteServer', name),
    toggleEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('mcp:toggleEnabled', name, enabled),
    probeServer: (config: any) => ipcRenderer.invoke('mcp:probeServer', config),
  },

  mobile: {
    startServer: (): Promise<import('./mobileServerTypes').QRCodeData> =>
      ipcRenderer.invoke('mobile:startServer'),
    stopServer: (): Promise<void> =>
      ipcRenderer.invoke('mobile:stopServer'),
    getStatus: (): Promise<import('./mobileServerTypes').ServerStatus> =>
      ipcRenderer.invoke('mobile:getStatus'),
    onConnected: (callback: (clientInfo: string) => void) => {
      const handler = (_event: any, clientInfo: string) => callback(clientInfo)
      ipcRenderer.on('mobile:onConnected', handler)
      return () => ipcRenderer.removeListener('mobile:onConnected', handler)
    },
    onDisconnected: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('mobile:onDisconnected', handler)
      return () => ipcRenderer.removeListener('mobile:onDisconnected', handler)
    },
  },

  // Auto Update API
  update: {
    check: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:check'),
    download: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:download'),
    installAndRestart: () =>
      ipcRenderer.invoke('update:installAndRestart'),
    onAvailable: (callback: (info: { version: string; releaseDate: string; releaseNotes: any; releaseName?: string }) => void) => {
      const wrapper = (_: any, info: any) => callback(info)
      ipcRenderer.on('update:available', wrapper)
      return () => ipcRenderer.removeListener('update:available', wrapper)
    },
    onNotAvailable: (callback: () => void) => {
      const wrapper = () => callback()
      ipcRenderer.on('update:not-available', wrapper)
      return () => ipcRenderer.removeListener('update:not-available', wrapper)
    },
    onDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
      const wrapper = (_: any, progress: any) => callback(progress)
      ipcRenderer.on('update:download-progress', wrapper)
      return () => ipcRenderer.removeListener('update:download-progress', wrapper)
    },
    onDownloaded: (callback: (info: { version: string }) => void) => {
      const wrapper = (_: any, info: any) => callback(info)
      ipcRenderer.on('update:downloaded', wrapper)
      return () => ipcRenderer.removeListener('update:downloaded', wrapper)
    },
    onError: (callback: (error: string) => void) => {
      const wrapper = (_: any, error: string) => callback(error)
      ipcRenderer.on('update:error', wrapper)
      return () => ipcRenderer.removeListener('update:error', wrapper)
    },
  },

  // App version
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke('app:getVersion'),

  // Cron API
  cron: {
    list: (projectRoot: string) => ipcRenderer.invoke('cron:list', projectRoot),
    create: (projectRoot: string, task: any) => ipcRenderer.invoke('cron:create', projectRoot, task),
    update: (projectRoot: string, id: string, updates: any) => ipcRenderer.invoke('cron:update', projectRoot, id, updates),
    delete: (projectRoot: string, id: string) => ipcRenderer.invoke('cron:delete', projectRoot, id),
    run: (projectRoot: string, id: string) => ipcRenderer.invoke('cron:run', projectRoot, id),
    runs: (projectRoot: string, limit?: number) => ipcRenderer.invoke('cron:runs', projectRoot, limit),
    taskRuns: (projectRoot: string, taskId: string) => ipcRenderer.invoke('cron:taskRuns', projectRoot, taskId),
    validate: (cron: string) => ipcRenderer.invoke('cron:validate', cron),
    describe: (cron: string) => ipcRenderer.invoke('cron:describe', cron),
    onTaskFired: (callback: (data: any) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('cron:onTaskFired', wrapper)
      return () => ipcRenderer.removeListener('cron:onTaskFired', wrapper)
    },
    onRunCompleted: (callback: (data: any) => void) => {
      const wrapper = (_: any, data: any) => callback(data)
      ipcRenderer.on('cron:onRunCompleted', wrapper)
      return () => ipcRenderer.removeListener('cron:onRunCompleted', wrapper)
    },
  },
})
