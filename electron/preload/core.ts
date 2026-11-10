// electron/preload/core.ts
// 核心域：日志/调试/追踪、窗口控制、应用与设置、shell、通知、预览、版本。

import type { EffortLevel } from '@/shared/effort'
import type { PreloadIpc } from './types'

export function createCoreApi(ipcRenderer: PreloadIpc) {
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
    /** cc-haha 复刻: 获取 trace 会话列表 */
    list: (params?: { limit?: number; offset?: number; query?: string }) =>
      ipcRenderer.invoke('trace:list', params),
    /** 轻量 stat 单个 trace 会话文件，轮询前变更检测用 */
    statSession: (sessionId: string) =>
      ipcRenderer.invoke('trace:statSession', sessionId),
    /** cc-haha 复刻: 获取单个 trace 会话详情 */
    getTrace: (sessionId: string) =>
      ipcRenderer.invoke('trace:getTrace', sessionId),
    /** cc-haha 复刻: 获取单个 call 的完整详情 */
    getTraceCall: (sessionId: string, callId: string) =>
      ipcRenderer.invoke('trace:getTraceCall', sessionId, callId),
    /** cc-haha 复刻: 获取 trace 采集设置 */
    getSettings: () =>
      ipcRenderer.invoke('trace:getSettings'),
    /** cc-haha 复刻: 更新 trace 采集设置 */
    updateSettings: (settings: { enabled: boolean }) =>
      ipcRenderer.invoke('trace:updateSettings', settings),
    /** cc-haha 复刻: 在独立窗口中打开 trace 详情 */
    openWindow: (sessionId: string) =>
      ipcRenderer.send('trace:openWindow', sessionId),
  }

  return {
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
    injectGuiModelsToSettings: (models: { primaryModel: string; haikuModel?: string; sonnetModel?: string; opusModel?: string; effortLevel?: EffortLevel; permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' }) =>
      ipcRenderer.invoke('settings:injectGuiModels', models),

    // GUI Settings persistence (file-based, ~/.claude/gui-settings.json)
    saveGuiSettings: (data: string): Promise<{
      success: boolean
      error?: string
      proxy?: { state: 'not-needed' | 'unchanged' | 'aligned' | 'failed'; error?: string }
    }> =>
      ipcRenderer.invoke('settings:saveGuiSettings', data),
    loadGuiSettings: (): Promise<{ success: boolean; data: string | null; error?: string }> =>
      ipcRenderer.invoke('settings:loadGuiSettings'),

    // Profiles persistence (file-based, ~/.spacecode/profiles.json)
    profilesLoad: (): Promise<{ success: boolean; data: string | null; error?: string }> =>
      ipcRenderer.invoke('profiles:load'),
    profilesSave: (data: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('profiles:save', data),
    profilesBackupCorrupt: (data: string): Promise<{ success: boolean; backupPath?: string; error?: string }> =>
      ipcRenderer.invoke('profiles:backupCorrupt', data),

    // Hooks Settings persistence
    // projectRoot 由渲染进程显式传入：project/local 的落点属于"当前打开的项目"，主进程无从得知
    loadHooksSettings: (scope?: string, projectRoot?: string): Promise<{ success: boolean; data: string | null; error?: string }> =>
      ipcRenderer.invoke('settings:loadHooksSettings', scope, projectRoot),
    saveHooksSettings: (hooksJson: string, scope?: string, projectRoot?: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:saveHooksSettings', hooksJson, scope, projectRoot),

    // Builtin hooks
    getBuiltinHooksRoot: (): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('settings:getBuiltinHooksRoot'),
    checkNode: (): Promise<{ success: boolean; version?: string; error?: string }> =>
      ipcRenderer.invoke('settings:checkNode'),

    getTokenUsageStats: () =>
      ipcRenderer.invoke('stats:getTokenUsage'),

    // App paths API
    app: {
      getPath: (name: string): Promise<string> =>
        ipcRenderer.invoke('app:getPath', name),
    },

    // Shell API
    shell: {
      openExternal: (url: string): Promise<void> =>
        ipcRenderer.invoke('shell:openExternal', url),
      openPath: (path: string): Promise<void> =>
        ipcRenderer.invoke('shell:openPath', path),
    },

    // 卡片复制动作：文本经主进程写入系统剪贴板
    clipboard: {
      writeText: (text: string): Promise<void> =>
        ipcRenderer.invoke('clipboard:writeText', text),
    },

    // Notification API
    showNotification: (options: { title: string; message: string; sessionId?: string }) =>
      ipcRenderer.send('app:showNotification', options),
    onNotificationClicked: (callback: (detail: { sessionId: string }) => void) => {
      const handler = (_: unknown, detail: { sessionId: string }) => callback(detail)
      ipcRenderer.on('app:notificationClicked', handler)
      return () => ipcRenderer.removeListener('app:notificationClicked', handler)
    },

    // Preview API — HTTP URL 给 webview；frame URL 给设计预览 iframe 的专用源
    preview: {
      getUrl: (filePath: string): Promise<string | null> =>
        ipcRenderer.invoke('preview:getUrl', filePath),
      getFrameUrl: (filePath: string): Promise<string | null> =>
        ipcRenderer.invoke('preview:getFrameUrl', filePath),
    },

    // Changelog API
    changelog: {
      getReleaseNotes: (version: string): Promise<{ content: string; source: 'local' | 'remote' } | null> =>
        ipcRenderer.invoke('changelog:getReleaseNotes', version),
    },

    // App version
    getAppVersion: (): Promise<string> =>
      ipcRenderer.invoke('app:getVersion'),

    // Prompt Optimizer API
    optimizePrompt: (
      prompt: string,
      options?: { workingDirectory?: string },
    ): Promise<{ success: boolean; result?: string; error?: string }> =>
      ipcRenderer.invoke('prompt-optimizer:optimize', prompt, options),

    // 渲染进程日志桥接
    logger: rendererLogger,
    debug: debugApi,
    trace: traceApi,
  }
}
