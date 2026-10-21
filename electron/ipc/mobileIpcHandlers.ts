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
import type { EngineSessionStatus, EngineType, PermissionMode } from '../engine/engines/types'
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

interface MobileSessionRuntime {
  cwd?: string
  engineType?: EngineType
  /** 手机端最近一次为该会话选定的 agent；引擎只认启动参数，切换必须重启进程。 */
  agent?: string
  /** 重启失败后留作下一次启动的 --resume，避免丢历史。 */
  resumeSessionId?: string
}

const mobileSessionRuntime = new Map<string, MobileSessionRuntime>()
/** 同一会话的 set_agent / send_message 必须串行，否则会并发 stop/start。 */
const mobileSessionLocks = new Map<string, Promise<unknown>>()

function withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = mobileSessionLocks.get(sessionId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(task)
  const cleanup = () => {
    if (mobileSessionLocks.get(sessionId) === next) mobileSessionLocks.delete(sessionId)
  }
  next.then(cleanup, cleanup)
  return next
}

async function readActiveSessionConfig(): Promise<any> {
  try {
    return await getMainWindow()?.webContents.executeJavaScript(
      `window.__spacecode_api__?.getActiveSessionConfig?.() || null`
    )
  } catch (err) {
    warn('MobileServer', 'failed to query desktop active session config', { error: String(err) })
    return null
  }
}

function pushAgentNotice(data: {
  sessionId: string
  agent: string
  applied?: boolean | null
  extensionLoaded?: boolean
  pending?: boolean
  reason?: string
  detail?: string
}): void {
  mobileServer?.sendToClient({ type: 'agent_notice', data })
}

async function startMobileSession(
  sessionId: string,
  overrides: { agent?: string; resumeSessionId?: string; permissionMode?: PermissionMode } = {},
): Promise<{ status: EngineSessionStatus | null; agent?: string }> {
  const desktopConfig = await readActiveSessionConfig()
  const runtime = mobileSessionRuntime.get(sessionId)
  const cwd = runtime?.cwd || desktopConfig?.cwd || app.getPath('home')
  const engineType = (runtime?.engineType || desktopConfig?.engineType || 'claude-code') as EngineType
  const requestedAgent = overrides.agent ?? runtime?.agent ?? desktopConfig?.agent ?? undefined
  const agent = requestedAgent || undefined

  if (!desktopConfig?.apiKey || !desktopConfig?.provider) {
    warn('MobileServer', `desktop LLM config incomplete | hasApiKey=${!!desktopConfig?.apiKey} | hasProvider=${!!desktopConfig?.provider} | sid=${sessionId.slice(0, 8)}`)
  }

  info('MobileServer', `starting session for mobile | sid=${sessionId.slice(0, 8)} | cwd=${cwd} | provider=${desktopConfig?.provider || '(none)'} | model=${desktopConfig?.model || '(none)'} | apiKey=${desktopConfig?.apiKey ? '***set' : '(empty)'} | agent=${agent || '(none)'}`)

  const status = await engineGateway.startSession(sessionId, {
    cwd,
    apiKey: desktopConfig?.apiKey,
    baseUrl: desktopConfig?.baseUrl,
    provider: desktopConfig?.provider,
    model: desktopConfig?.model,
    effortLevel: desktopConfig?.effortLevel,
    thinkingEnabled: desktopConfig?.thinkingEnabled,
    agent,
    engineType,
    engineSource: desktopConfig?.engineSource,
    installedCliPath: desktopConfig?.installedCliPath,
    modelContextWindows: desktopConfig?.modelContextWindows,
    rtkEnabled: desktopConfig?.rtkEnabled,
    resumeSessionId: overrides.resumeSessionId ?? runtime?.resumeSessionId,
    permissionMode: overrides.permissionMode,
  })
  mobileSessionRuntime.set(sessionId, { cwd, engineType, agent })
  return { status, agent }
}

/**
 * 确保手机端引用的 sessionId 在 engine 中存在并运行，然后发送消息。
 */
async function ensureMobileSessionThenSend(
  sessionId: string,
  content: string,
  images?: any[],
  agentId?: string,
): Promise<void> {
  const status = engineGateway.getSessionStatus(sessionId)
  if (status?.isRunning) {
    // 运行中的会话只能由 set_agent 切换；这里不打断当前轮次。
    await engineGateway.sendMessage(sessionId, content, images)
    return
  }

  // 未运行：agentId 是手机当前选择，作为本次启动的默认 agent。
  const { status: startedStatus, agent: requestedAgent } = await startMobileSession(sessionId, { agent: agentId })

  // 「参数传下去了」不等于「agent 生效了」：引擎在 spawn 时给出回执，手机端也要能看见 (#56)。
  // 成功也要回执：手机据此确认徽章，而不是在发送时乐观假设已经生效。
  if (requestedAgent) {
    if (!startedStatus) {
      pushAgentNotice({ sessionId, agent: requestedAgent, applied: false, reason: 'start-failed' })
    } else {
      pushAgentNotice({
        sessionId,
        agent: requestedAgent,
        applied: startedStatus.agentApplied ?? null,
        extensionLoaded: startedStatus.agentExtensionLoaded,
      })
    }
  }

  await engineGateway.sendMessage(sessionId, content, images)
}

/**
 * 把手机端选定的 agent 落到会话上。
 *
 * agent 只在 spawn 时生效，所以运行中的会话必须带 resume 重启；当前轮次未结束时
 * 不打断它，直接回绝，让手机稍后重试。未知 id 不落库，避免出现「选了个不存在的人设」。
 */
async function applyAgentSelection(sessionId: string, agentId: string): Promise<void> {
  const runtime = mobileSessionRuntime.get(sessionId)
  const desktopConfig = await readActiveSessionConfig()
  const cwd = runtime?.cwd || desktopConfig?.cwd
  const engineType = (runtime?.engineType || desktopConfig?.engineType) as EngineType | undefined
  const agents = await engineGateway.listAgents(cwd, engineType)
  if (!agents.some((agent) => agent.agentType === agentId)) {
    warn('MobileServer', `set_agent rejected: unknown agent | sid=${sessionId.slice(0, 8)} | agent=${agentId}`)
    pushAgentNotice({ sessionId, agent: agentId, applied: false, reason: 'unknown-agent' })
    return
  }

  const status = engineGateway.getSessionStatus(sessionId)
  if (status?.isRunning && status.status !== 'idle') {
    pushAgentNotice({ sessionId, agent: agentId, applied: false, reason: 'session-busy' })
    return
  }

  mobileSessionRuntime.set(sessionId, {
    cwd,
    engineType,
    agent: agentId,
  })

  if (!status?.isRunning) {
    // 进程还没起来，下一条消息启动时生效。
    pushAgentNotice({ sessionId, agent: agentId, applied: null, pending: true })
    return
  }

  const resumeSessionId = status.engineSessionId ?? undefined
  const permissionMode = status.permissionMode
  try {
    await engineGateway.stop(sessionId)
    const { status: startedStatus } = await startMobileSession(sessionId, {
      agent: agentId,
      resumeSessionId,
      permissionMode,
    })
    if (!startedStatus) {
      pushAgentNotice({ sessionId, agent: agentId, applied: false, reason: 'start-failed' })
      return
    }
    pushAgentNotice({
      sessionId,
      agent: agentId,
      applied: startedStatus.agentApplied ?? null,
      extensionLoaded: startedStatus.agentExtensionLoaded,
    })
  } catch (err) {
    // 进程已经被 stop 掉了；把 resume 记下来，下一条消息启动时接回历史。
    mobileSessionRuntime.set(sessionId, { cwd, engineType, agent: agentId, resumeSessionId })
    error('MobileServer', 'set_agent restart failed', { sessionId: sessionId.slice(0, 8), agent: agentId, error: String(err) })
    pushAgentNotice({
      sessionId,
      agent: agentId,
      applied: false,
      reason: 'start-failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
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
  mobileSessionRuntime.clear()
  mobileSessionLocks.clear()

  ipcMain.handle('mobile:startServer', async (): Promise<QRCodeData> => {
    if (mobileServer) {
      await mobileServer.stop()
    }

    mobileServer = new MobileServer(
      async () => null,
      () => getThemeSyncData()
    )

    const qrData = await mobileServer.start()

    mobileServer.on('send_message', async ({ sessionId, content, images, agentId }: any) => {
      try {
        await withSessionLock(sessionId, () => ensureMobileSessionThenSend(
          sessionId,
          content,
          images,
          typeof agentId === 'string' && agentId ? agentId : undefined,
        ))
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

    mobileServer.on('list_agents', async ({ sessionId }: any = {}) => {
      try {
        // 会话已有启动记录时按它自己的 cwd 查；否则退回桌面当前会话。
        const runtime = sessionId ? mobileSessionRuntime.get(sessionId) : undefined
        const config = runtime ? null : await readActiveSessionConfig()
        const agents = await engineGateway.listAgents(
          runtime?.cwd ?? config?.cwd,
          runtime?.engineType ?? config?.engineType,
        )
        mobileServer?.sendToClient({ type: 'agents_list', data: { agents, sessionId } })
      } catch (err) {
        warn('MobileServer', 'list_agents failed', { error: String(err) })
        mobileServer?.sendToClient({ type: 'agents_list', data: { agents: [], sessionId } })
      }
    })

    mobileServer.on('set_agent', async ({ sessionId, agentId }: any) => {
      if (!sessionId || !agentId) {
        warn('MobileServer', 'set_agent missing params', { hasSid: !!sessionId, hasAgent: !!agentId })
        if (sessionId) {
          pushAgentNotice({ sessionId, agent: String(agentId || ''), applied: false, reason: 'missing-params' })
        }
        return
      }
      try {
        await withSessionLock(sessionId, () => applyAgentSelection(sessionId, String(agentId)))
      } catch (err) {
        error('MobileServer', 'set_agent failed', { sessionId: String(sessionId).slice(0, 8), agentId: String(agentId), error: String(err) })
        pushAgentNotice({ sessionId, agent: String(agentId), applied: false, reason: 'start-failed' })
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
