/**
 * Mobile Server IPC handlers — QR-code pairing, message relay, and
 * engine event forwarding to the mobile companion app.
 */
import { ipcMain, app } from 'electron'
import { info, warn, error } from '../infra/logger'
import { MobileServer } from '../h5/mobileServer'
import type { QRCodeData, ServerStatus } from '../h5/mobileServerTypes'
import { engineGateway } from '../engine/engineGateway'
import { EngineFactory } from '../engine/engines/EngineFactory'
import { buildThemeSyncData } from '../h5/themeSyncBuilder'
import { getMainWindow } from '../windows/mainWindow'

let mobileServer: MobileServer | null = null
let unsubscribeEngineEventsForMobile: (() => void) | null = null

export function getMobileServer(): MobileServer | null {
  return mobileServer
}

export function setMobileServer(server: MobileServer | null): void {
  mobileServer = server
}

export function getMobileUnsubscribe(): (() => void) | null {
  return unsubscribeEngineEventsForMobile
}

export function setMobileUnsubscribe(fn: (() => void) | null): void {
  unsubscribeEngineEventsForMobile = fn
}

/**
 * 确保手机端引用的 sessionId 在 engine 中存在并运行，然后发送消息。
 */
async function ensureMobileSessionThenSend(sessionId: string, content: string, images?: any[]): Promise<void> {
  const status = engineGateway.getSessionStatus(sessionId)
  if (status?.isRunning) {
    await engineGateway.sendMessage(sessionId, content, images)
    return
  }

  let desktopConfig: any = null
  try {
    desktopConfig = await getMainWindow()?.webContents.executeJavaScript(
      `window.__spacecode_api__?.getActiveSessionConfig?.() || null`
    )
  } catch (err) {
    warn('MobileServer', 'failed to query desktop active session config', { error: String(err) })
  }

  const cwd = desktopConfig?.cwd || app.getPath('home')
  if (!desktopConfig?.apiKey || !desktopConfig?.provider) {
    warn('MobileServer', `desktop LLM config incomplete | hasApiKey=${!!desktopConfig?.apiKey} | hasProvider=${!!desktopConfig?.provider} | sid=${sessionId.slice(0, 8)}`)
  }

  info('MobileServer', `starting session for mobile | sid=${sessionId.slice(0, 8)} | cwd=${cwd} | provider=${desktopConfig?.provider || '(none)'} | model=${desktopConfig?.model || '(none)'} | apiKey=${desktopConfig?.apiKey ? '***set' : '(empty)'} | agent=${desktopConfig?.agent || '(none)'}`)

  const startedStatus = await engineGateway.startSession(sessionId, {
    cwd,
    apiKey: desktopConfig?.apiKey,
    baseUrl: desktopConfig?.baseUrl,
    provider: desktopConfig?.provider,
    model: desktopConfig?.model,
    effortLevel: desktopConfig?.effortLevel,
    thinkingEnabled: desktopConfig?.thinkingEnabled,
    agent: desktopConfig?.agent,
    engineType: desktopConfig?.engineType || 'claude-code',
    engineSource: desktopConfig?.engineSource,
    installedCliPath: desktopConfig?.installedCliPath,
    modelContextWindows: desktopConfig?.modelContextWindows,
    rtkEnabled: desktopConfig?.rtkEnabled,
  })

  // 「参数传下去了」不等于「agent 生效了」：引擎在 spawn 时给出回执，手机端也要能看见 (#56)
  const requestedAgent: string = typeof desktopConfig?.agent === 'string' ? desktopConfig.agent : ''
  if (requestedAgent && startedStatus && (startedStatus.agentApplied === false || startedStatus.agentExtensionLoaded === false)) {
    mobileServer?.sendToClient({
      type: 'agent_notice',
      data: {
        sessionId,
        agent: requestedAgent,
        applied: startedStatus.agentApplied ?? null,
        extensionLoaded: startedStatus.agentExtensionLoaded,
      },
    })
  }

  await engineGateway.sendMessage(sessionId, content, images)
}

/**
 * 订阅 engine 事件流并转发给手机端。
 */
function subscribeEngineEventsForMobile(): void {
  unsubscribeEngineEventsForMobile?.()
  unsubscribeEngineEventsForMobile = null

  if (!mobileServer) return

  unsubscribeEngineEventsForMobile = EngineFactory.onRouteEvent((sid, eventType, data) => {
    if (!mobileServer) return
    // 手机端没有 i18n：拦截事件（issue #55）仍给它原始 detail 作为可显示文本，
    // 同时保留 reason 供客户端后续自行本地化。
    const payload = eventType === 'error'
      && data && typeof data === 'object'
      && data.message === undefined
      && typeof data.detail === 'string'
      ? { ...data, message: data.detail }
      : data
    mobileServer.sendToClient({ type: eventType as any, data: { ...payload, sessionId: sid } })
  })
}

async function getThemeSyncData() {
  try {
    const data = await getMainWindow()?.webContents.executeJavaScript(
      `window.__spacecode_api__?.getThemeData() || null`
    )
    if (data) {
      return buildThemeSyncData(data.effectiveTheme, data.appearance)
    }
  } catch {}
  return buildThemeSyncData('dark')
}

export function registerMobileIPCHandlers(): void {
  ipcMain.handle('mobile:startServer', async (): Promise<QRCodeData> => {
    if (mobileServer) {
      await mobileServer.stop()
    }

    mobileServer = new MobileServer(
      async () => null,
      () => getThemeSyncData()
    )

    const qrData = await mobileServer.start()

    mobileServer.on('send_message', async ({ sessionId, content, images }: any) => {
      try {
        await ensureMobileSessionThenSend(sessionId, content, images)
      } catch (err) {
        error('MobileServer', 'send_message failed', { sessionId: sessionId.slice(0, 8), error: String(err) })
        mobileServer?.sendToClient({
          type: 'error',
          data: { message: err instanceof Error ? err.message : 'Failed to send message' },
        })
      }
    })

    mobileServer.on('abort', async ({ sessionId }: any) => {
      try {
        await engineGateway.abort(sessionId)
      } catch (err) {
        error('MobileServer', 'abort failed', { sessionId: sessionId.slice(0, 8), error: String(err) })
      }
    })

    mobileServer.on('allow_permission', async ({ sessionId, requestId }: any) => {
      try {
        await engineGateway.allowPermission(sessionId, requestId)
      } catch (err) {
        error('MobileServer', 'allow_permission failed', { sessionId: sessionId.slice(0, 8), error: String(err) })
        mobileServer?.sendToClient({
          type: 'error',
          data: { message: err instanceof Error ? err.message : 'Failed to allow permission' },
        })
      }
    })

    mobileServer.on('deny_permission', async ({ sessionId, requestId }: any) => {
      try {
        await engineGateway.denyPermission(sessionId, requestId)
      } catch (err) {
        error('MobileServer', 'deny_permission failed', { sessionId: sessionId.slice(0, 8), error: String(err) })
        mobileServer?.sendToClient({
          type: 'error',
          data: { message: err instanceof Error ? err.message : 'Failed to deny permission' },
        })
      }
    })

    mobileServer.on('submit_tool_answer', async ({ sessionId, toolUseId, answer }: any) => {
      try {
        await engineGateway.submitToolAnswer(sessionId, toolUseId, typeof answer === 'string' ? { answer } : answer)
      } catch (err) {
        error('MobileServer', 'submit_tool_answer failed', { sessionId: sessionId.slice(0, 8), error: String(err) })
      }
    })

    mobileServer.on('list_sessions', async () => {
      try {
        const sessions = await getMainWindow()?.webContents.executeJavaScript(
          `window.__spacecode_api__?.getSessions() || []`
        )
        mobileServer?.sendToClient({ type: 'sessions_list', data: { sessions: sessions || [] } })
      } catch (err) {
        error('MobileServer', 'list_sessions failed', { error: String(err) })
        mobileServer?.sendToClient({ type: 'sessions_list', data: { sessions: [] } })
      }
    })

    mobileServer.on('new_session', async ({ sessionId }: any) => {
      try {
        if (sessionId) {
          getMainWindow()?.webContents.send('mobile:sessionChanged', { sessionId, source: 'mobile' })
        }
        info('MobileServer', `new session | sid=${String(sessionId).slice(0, 8)}`)
      } catch (err) {
        error('MobileServer', 'new_session failed', { error: String(err) })
      }
    })

    mobileServer.on('switch_session', async ({ sessionId }: any) => {
      try {
        if (sessionId) {
          getMainWindow()?.webContents.send('mobile:sessionChanged', { sessionId, source: 'mobile' })
        }
        info('MobileServer', `switch session | sid=${String(sessionId).slice(0, 8)}`)
      } catch (err) {
        error('MobileServer', 'switch_session failed', { error: String(err) })
      }
    })

    mobileServer.on('list_agents', async () => {
      try {
        const config = await getMainWindow()?.webContents.executeJavaScript(
          `window.__spacecode_api__?.getActiveSessionConfig?.() || null`
        )
        const agents = await engineGateway.listAgents(config?.cwd, config?.engineType)
        mobileServer?.sendToClient({ type: 'agents_list', data: { agents } })
      } catch (err) {
        warn('MobileServer', 'list_agents failed', { error: String(err) })
        mobileServer?.sendToClient({ type: 'agents_list', data: { agents: [] } })
      }
    })

    mobileServer.on('set_permission_mode', async ({ sessionId, mode }: any) => {
      try {
        if (!sessionId || !mode) {
          warn('MobileServer', 'set_permission_mode missing params', { hasSid: !!sessionId, hasMode: !!mode })
          return
        }
        await engineGateway.setPermissionMode(sessionId, mode)
        info('MobileServer', `permission mode set | sid=${String(sessionId).slice(0, 8)} | mode=${mode}`)
      } catch (err) {
        error('MobileServer', 'set_permission_mode failed', { sessionId: String(sessionId).slice(0, 8), error: String(err) })
      }
    })

    mobileServer.on('get_settings', async () => {
      try {
        const config = await getMainWindow()?.webContents.executeJavaScript(
          `window.__spacecode_api__?.getActiveSessionConfig?.() || null`
        )
        mobileServer?.sendToClient({
          type: 'settings_sync',
          data: {
            apiKey: config?.apiKey || '',
            baseUrl: config?.baseUrl || '',
            model: config?.model || '',
          },
        })
      } catch (err) {
        warn('MobileServer', 'failed to sync settings', { error: String(err) })
      }
    })

    mobileServer.on('connected', async (clientInfo: string) => {
      getMainWindow()?.webContents.send('mobile:onConnected', clientInfo)
      subscribeEngineEventsForMobile()

      try {
        const config = await getMainWindow()?.webContents.executeJavaScript(
          `window.__spacecode_api__?.getActiveSessionConfig?.() || null`
        )
        if (config?.cwd) {
          mobileServer?.sendToClient({
            type: 'session_changed',
            data: { projectPath: config.cwd, sessionId: config.sessionId || null },
          })
        }
        mobileServer?.sendToClient({
          type: 'settings_sync',
          data: {
            apiKey: config?.apiKey || '',
            baseUrl: config?.baseUrl || '',
            model: config?.model || '',
          },
        })
      } catch (err) {
        warn('MobileServer', 'failed to send session_changed on connect', { error: String(err) })
      }
    })

    mobileServer.on('disconnected', () => {
      getMainWindow()?.webContents.send('mobile:onDisconnected')
      unsubscribeEngineEventsForMobile?.()
      unsubscribeEngineEventsForMobile = null
    })

    return qrData
  })

  ipcMain.handle('mobile:stopServer', async () => {
    if (mobileServer) {
      await mobileServer.stop()
      mobileServer = null
    }
    unsubscribeEngineEventsForMobile?.()
    unsubscribeEngineEventsForMobile = null
  })

  ipcMain.handle('mobile:getStatus', (): ServerStatus => {
    return mobileServer?.getStatus() ?? { running: false, connected: false }
  })
}
