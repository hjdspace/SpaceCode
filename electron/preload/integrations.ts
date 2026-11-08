// electron/preload/integrations.ts
// 集成域：终端、Git、记忆、语音、引擎、超级 Agent、流水线、更新、
// 桌面宠物、移动端与 H5、定时任务、IM。

import { gitChannels } from '@/shared/channels/git'
import { terminalNamespace } from '@/shared/channels/terminal'
import { updateNamespace } from '@/shared/channels/update'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import { memoryChannels } from '@/shared/channels/memory'
import { voiceNamespace } from '@/shared/channels/voice'
import { factoryNamespace } from '@/shared/channels/factory'
import { superAgentNamespace } from '@/shared/channels/superAgent'
import { createPreloadBridge, createEventBridge } from '@/shared/preloadBridge'
import type { PreloadIpc } from './types'

export function createIntegrationsApi(ipcRenderer: PreloadIpc) {
  return {
    // Terminal API — invoke/send channels 与事件订阅均表驱动注册
    terminal: {
      ...createPreloadBridge(terminalNamespace.channels, ipcRenderer, 'terminal:'),
      ...createEventBridge(terminalNamespace.events, ipcRenderer, 'terminal:'),
    } satisfies import('@/shared/channels/terminal').TerminalRendererApi
      & import('@/shared/channels/terminal').TerminalEventApi,

    // Git/SCM API — invoke channels 表驱动注册；onStatusChanged 是事件订阅，保留手写
    git: {
      ...createPreloadBridge(gitChannels, ipcRenderer, 'git:'),
      onStatusChanged: (callback: () => void) => {
        const wrapper = () => callback()
        ipcRenderer.on('git:statusChanged', wrapper)
        return () => ipcRenderer.removeListener('git:statusChanged', wrapper)
      },
    } satisfies import('@/shared/channels/git').GitRendererApi & { onStatusChanged: (callback: () => void) => () => void },

    // Memory API — 项目记忆文件的读取与编辑
    memory: {
      ...createPreloadBridge(memoryChannels, ipcRenderer, 'memory:'),
    } satisfies import('@/shared/channels/memory').MemoryRendererApi,

    // Voice Input API — 识别模型管理与录音会话，invoke/send channels 与事件订阅均表驱动注册
    voice: {
      ...createPreloadBridge(voiceNamespace.channels, ipcRenderer, 'voice:'),
      ...createEventBridge(voiceNamespace.events, ipcRenderer, 'voice:'),
    } satisfies import('@/shared/channels/voice').VoiceRendererApi
      & import('@/shared/channels/voice').VoiceEventApi,

    // ClaudeCode Engine API — invoke channels 与事件订阅均表驱动注册
    claudeCode: {
      ...createPreloadBridge(claudeCodeNamespace.channels, ipcRenderer, 'claude-code:'),
      ...createEventBridge(claudeCodeNamespace.events, ipcRenderer, 'claude-code:'),
    } satisfies import('@/shared/channels/claudeCode').ClaudeCodeRendererApi
      & import('@/shared/channels/claudeCode').ClaudeCodeEventApi,

    // Super Agent API — invoke channels 与 health.changed 事件均表驱动注册（T01/T13）
    superAgent: {
      ...createPreloadBridge(superAgentNamespace.channels, ipcRenderer, 'super-agent:'),
      ...createEventBridge(superAgentNamespace.events, ipcRenderer, 'super-agent:'),
    } satisfies import('@/shared/channels/superAgent').SuperAgentRendererApi
      & import('@/shared/channels/superAgent').SuperAgentEventApi,

    // Factory（AI 流水线）API — invoke channels 与事件订阅均表驱动注册
    factory: {
      ...createPreloadBridge(factoryNamespace.channels, ipcRenderer, 'factory:'),
      ...createEventBridge(factoryNamespace.events, ipcRenderer, 'factory:'),
    } satisfies import('@/shared/channels/factory').FactoryRendererApi
      & import('@/shared/channels/factory').FactoryEventApi,

    // Auto Update API — invoke channels 与事件订阅均表驱动注册
    update: {
      ...createPreloadBridge(updateNamespace.channels, ipcRenderer, 'update:'),
      ...createEventBridge(updateNamespace.events, ipcRenderer, 'update:'),
    } satisfies import('@/shared/channels/update').UpdateRendererApi
      & import('@/shared/channels/update').UpdateEventApi,

    // Pet API — 桌面宠物系统（配置读写、桌面窗口控制、状态同步、偏好/会话事件）
    // 注意：preload 中使用 any 类型避免导入 src 模块（preload 是独立构建）。类型安全由 electron.d.ts 保证。
    pet: {
      readConfig: () => ipcRenderer.invoke('pet:readConfig'),
      writeConfig: (config: any) => ipcRenderer.invoke('pet:writeConfig', config),
      createDesktopWindow: () => ipcRenderer.invoke('pet:createDesktopWindow'),
      destroyDesktopWindow: () => ipcRenderer.invoke('pet:destroyDesktopWindow'),
      syncPetState: (state: any) => ipcRenderer.send('pet:syncPetState', state),
      /** 监听偏好变更（来自宠物窗口的偏好变更，主进程转发） */
      onPreferencesChanged: (callback: (patch: any) => void) => {
        const wrapper = (_: unknown, data: any) => callback(data)
        ipcRenderer.on('pet:preferencesChanged', wrapper)
        return () => ipcRenderer.removeListener('pet:preferencesChanged', wrapper)
      },
      /** 监听会话跳转请求（来自宠物窗口的 focusSession，主进程转发） */
      onNavigateSession: (callback: (sessionId: string) => void) => {
        const wrapper = (_: unknown, sessionId: string) => callback(sessionId)
        ipcRenderer.on('petMainWindow:navigateSession', wrapper)
        return () => ipcRenderer.removeListener('petMainWindow:navigateSession', wrapper)
      },
      /** 监听宠物窗口就绪请求（窗口 mount 后请求主应用推送一次完整状态） */
      onResyncRequest: (callback: () => void) => {
        const wrapper = () => callback()
        ipcRenderer.on('pet:resyncRequest', wrapper)
        return () => ipcRenderer.removeListener('pet:resyncRequest', wrapper)
      },
    },

    mobile: {
      startServer: (): Promise<import('../h5/mobileServerTypes').QRCodeData> =>
        ipcRenderer.invoke('mobile:startServer'),
      stopServer: (): Promise<void> =>
        ipcRenderer.invoke('mobile:stopServer'),
      getStatus: (): Promise<import('../h5/mobileServerTypes').ServerStatus> =>
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

    // H5 WebUI Access API
    h5Access: {
      enable: (): Promise<{ status: import('../h5/h5Types').H5ServerStatus; token: string }> =>
        ipcRenderer.invoke('h5:enable'),
      disable: (): Promise<void> =>
        ipcRenderer.invoke('h5:disable'),
      regenerateToken: (): Promise<{ status: import('../h5/h5Types').H5ServerStatus; token: string }> =>
        ipcRenderer.invoke('h5:regenerateToken'),
      getStatus: (): Promise<import('../h5/h5Types').H5ServerStatus> =>
        ipcRenderer.invoke('h5:getStatus'),
      getSettings: (): Promise<import('../h5/h5Types').H5AccessSettings> =>
        ipcRenderer.invoke('h5:getSettings'),
      updateSettings: (input: Partial<Pick<import('../h5/h5Types').H5AccessSettings, 'publicBaseUrl' | 'fixedPort' | 'sandboxPort'>>) =>
        ipcRenderer.invoke('h5:updateSettings', input),
      setMirrorSession: (sessionId: string | null, projectPath: string | null) =>
        ipcRenderer.invoke('h5:setMirrorSession', sessionId, projectPath),
      checkBuild: (): Promise<{ built: boolean; path: string }> =>
        ipcRenderer.invoke('h5:checkBuild'),
    },

    // Cron API
    cron: {
      setProjectRoot: (projectRoot: string) => ipcRenderer.send('cron:setProjectRoot', projectRoot),
      list: (projectRoot: string) => ipcRenderer.invoke('cron:list', projectRoot),
      create: (projectRoot: string, task: any) => ipcRenderer.invoke('cron:create', projectRoot, task),
      update: (projectRoot: string, id: string, updates: any) => ipcRenderer.invoke('cron:update', projectRoot, id, updates),
      delete: (projectRoot: string, id: string) => ipcRenderer.invoke('cron:delete', projectRoot, id),
      run: (projectRoot: string, id: string) => ipcRenderer.invoke('cron:run', projectRoot, id),
      runs: (projectRoot: string, limit?: number) => ipcRenderer.invoke('cron:runs', projectRoot, limit),
      taskRuns: (projectRoot: string, taskId: string) => ipcRenderer.invoke('cron:taskRuns', projectRoot, taskId),
      validate: (cron: string) => ipcRenderer.invoke('cron:validate', cron),
      describe: (cron: string) => ipcRenderer.invoke('cron:describe', cron),
      saveAttachment: (projectRoot: string, attachment: { id: string; name: string; dataUrl: string }) =>
        ipcRenderer.invoke('cron:saveAttachment', projectRoot, attachment),
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

    // IM Integration API
    im: {
      getConfig: (): Promise<any> => ipcRenderer.invoke('im:getConfig'),
      updateConfig: (config: any): Promise<void> => ipcRenderer.invoke('im:updateConfig', config),
      startServer: (): Promise<void> => ipcRenderer.invoke('im:startServer'),
      stopServer: (): Promise<void> => ipcRenderer.invoke('im:stopServer'),
      getServerStatus: (): Promise<any> => ipcRenderer.invoke('im:getServerStatus'),
      startAdapter: (platform: string): Promise<void> => ipcRenderer.invoke('im:startAdapter', platform),
      stopAdapter: (platform: string): Promise<void> => ipcRenderer.invoke('im:stopAdapter', platform),
      getAdapterStatuses: (): Promise<any> => ipcRenderer.invoke('im:getAdapterStatuses'),
      generatePairingCode: (): Promise<{ code: string; expiresAt: number }> =>
        ipcRenderer.invoke('im:generatePairingCode'),
      clearPairingCode: (): Promise<void> =>
        ipcRenderer.invoke('im:clearPairingCode'),
      // WeChat QR Login
      wechat: {
        startQrLogin: (): Promise<{ qrcodeUrl: string; qrcodeId: string }> =>
          ipcRenderer.invoke('im:wechat:startQrLogin'),
        checkQrStatus: (qrcodeId: string): Promise<{
          status: 'waiting' | 'scanned' | 'confirmed' | 'expired'
          accountId?: string
          botToken?: string
          baseUrl?: string
          userId?: string
        }> => ipcRenderer.invoke('im:wechat:checkQrStatus', qrcodeId),
        unbind: (): Promise<void> => ipcRenderer.invoke('im:wechat:unbind'),
        isBound: (): Promise<boolean> => ipcRenderer.invoke('im:wechat:isBound'),
      },
    },
  }
}
