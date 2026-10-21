// @vitest-environment node
/**
 * 手机适配器把桌面能力如实桥接给 companion app。
 *
 * 1. 授权答复的参数位（issue #40 问题 6）：桌面 Claude 引擎的权限请求同时带
 *    requestId 和 toolUseId，而 `engineGateway.allowPermission(sessionId, requestId)`
 *    的第二个参数是 **requestId**（controlProtocol 的 pending 表按 requestId 存，
 *    `electron/session/controlProtocol.ts` 找不到就抛 "No pending permission request
 *    with id=..."）。适配器曾把 toolUseId 塞进这个位置，手机的"允许/拒绝"因此永远无效。
 *    这里用两个 id 明显不同的请求把契约钉住 —— 传错就红。
 * 2. list_agents 不能再回空数组（issue #40 问题 8）：engineGateway.listAgents 是
 *    现成的真实实现，桌面 UI 一直在用。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface ServerProbe {
  emitTo: (event: string, payload: unknown) => Promise<void>
  pushes: Array<{ type: string; data?: Record<string, unknown> }>
}

const probe = vi.hoisted(() => ({
  ipcHandlers: {} as Record<string, (...args: unknown[]) => unknown>,
  servers: [] as Array<ServerProbe>,
  activeConfig: null as Record<string, unknown> | null,
  gateway: {
    allowPermission: vi.fn(async (_sessionId: string, _requestId: string) => {}),
    denyPermission: vi.fn(async (_sessionId: string, _requestId: string) => {}),
    abort: vi.fn(async () => {}),
    getSessionStatus: vi.fn(() => ({ isRunning: true })),
    sendMessage: vi.fn(async (_sessionId: string, _content: string, _images?: unknown) => {}),
    startSession: vi.fn(async (_sessionId: string, _config: unknown): Promise<unknown> => undefined),
    submitToolAnswer: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    listAgents: vi.fn(async () => [
      { agentType: 'Explore', description: 'read-only explorer', source: 'built-in' },
    ]),
  },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      probe.ipcHandlers[channel] = handler
    }),
  },
  app: { getPath: () => '/home/tester' },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

vi.mock('../../h5/mobileServer', () => {
  class StubMobileServer {
    handlers = new Map<string, (payload: any) => unknown>()
    pushes: Array<{ type: string; data?: Record<string, unknown> }> = []

    constructor() {
      probe.servers.push(this as unknown as ServerProbe)
    }
    on(event: string, listener: (payload: any) => unknown) {
      this.handlers.set(event, listener)
    }
    sendToClient(push: { type: string; data?: Record<string, unknown> }) {
      this.pushes.push(push)
    }
    async emitTo(event: string, payload: unknown) {
      await this.handlers.get(event)?.(payload)
    }
    async start() {
      return { url: 'ws://127.0.0.1:9527?token=t', token: 't', port: 9527, ip: '127.0.0.1' }
    }
    async stop() {}
    getStatus() { return { running: true, connected: true } }
  }
  return { MobileServer: StubMobileServer }
})

vi.mock('../../engine/engineGateway', () => ({ engineGateway: probe.gateway }))

vi.mock('../../engine/engines/EngineFactory', () => ({
  EngineFactory: { onRouteEvent: vi.fn(() => () => {}) },
}))

vi.mock('../../h5/themeSyncBuilder', () => ({
  buildThemeSyncData: (theme: string) => ({ theme }),
}))

vi.mock('../../windows/mainWindow', () => ({
  getMainWindow: () => ({
    webContents: {
      executeJavaScript: vi.fn(async () => probe.activeConfig),
      send: vi.fn(),
    },
  }),
}))

import { registerMobileIPCHandlers } from '../mobileIpcHandlers'

const SESSION_ID = 'session-aaaa-1111'
const REQUEST_ID = 'permission-request-77'
const TOOL_USE_ID = 'tool-call-1'

async function startMobileServer(): Promise<ServerProbe> {
  probe.servers.length = 0
  await probe.ipcHandlers['mobile:startServer']!()
  return probe.servers[probe.servers.length - 1]
}

beforeEach(() => {
  probe.ipcHandlers = {}
  probe.servers.length = 0
  probe.activeConfig = { cwd: '/repo', engineType: 'claude-code' }
  probe.gateway.allowPermission.mockClear()
  probe.gateway.denyPermission.mockClear()
  probe.gateway.listAgents.mockClear()
  probe.gateway.startSession.mockClear()
  probe.gateway.sendMessage.mockClear()
  probe.gateway.getSessionStatus.mockClear()
  registerMobileIPCHandlers()
})

describe('allow_permission / deny_permission 答复路由', () => {
  it('把 requestId 交给 allowPermission 的 requestId 位', async () => {
    const server = await startMobileServer()
    await server.emitTo('allow_permission', { sessionId: SESSION_ID, requestId: REQUEST_ID })

    expect(probe.gateway.allowPermission).toHaveBeenCalledWith(SESSION_ID, REQUEST_ID)
    expect(probe.gateway.allowPermission.mock.calls[0][1]).not.toBe(TOOL_USE_ID)
  })

  it('把 requestId 交给 denyPermission 的 requestId 位', async () => {
    const server = await startMobileServer()
    await server.emitTo('deny_permission', { sessionId: SESSION_ID, requestId: REQUEST_ID })

    expect(probe.gateway.denyPermission).toHaveBeenCalledWith(SESSION_ID, REQUEST_ID)
  })

  it('授权失败时回错误给手机，而不是让卡片无声挂在那里', async () => {
    const server = await startMobileServer()
    probe.gateway.allowPermission.mockRejectedValueOnce(
      new Error(`No pending permission request with id=${TOOL_USE_ID}`),
    )

    await server.emitTo('allow_permission', { sessionId: SESSION_ID, requestId: REQUEST_ID })

    const last = server.pushes[server.pushes.length - 1]
    expect(last?.type).toBe('error')
    expect(String(last?.data?.message)).toContain('No pending permission request')
  })
})

describe('send_message 的 agent 回执', () => {
  it('起会话后发现 agent 未生效，把回执推给手机', async () => {
    const server = await startMobileServer()
    probe.activeConfig = { cwd: '/repo', engineType: 'pi', agent: 'reviewer' }
    probe.gateway.getSessionStatus.mockReturnValueOnce({ isRunning: false })
    probe.gateway.startSession.mockResolvedValueOnce({ agentApplied: false, agentExtensionLoaded: false })

    await server.emitTo('send_message', { sessionId: SESSION_ID, content: 'hi' })

    expect(probe.gateway.startSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ agent: 'reviewer', engineType: 'pi' }),
    )
    const notice = server.pushes.find((push) => push.type === 'agent_notice')
    expect(notice?.data).toMatchObject({
      sessionId: SESSION_ID,
      agent: 'reviewer',
      applied: false,
      extensionLoaded: false,
    })
    expect(probe.gateway.sendMessage).toHaveBeenCalledWith(SESSION_ID, 'hi', undefined)
  })

  it('agent 正常生效时不推送', async () => {
    const server = await startMobileServer()
    probe.activeConfig = { cwd: '/repo', engineType: 'pi', agent: 'reviewer' }
    probe.gateway.getSessionStatus.mockReturnValueOnce({ isRunning: false })
    probe.gateway.startSession.mockResolvedValueOnce({ agentApplied: true, agentExtensionLoaded: true })

    await server.emitTo('send_message', { sessionId: SESSION_ID, content: 'hi' })

    expect(server.pushes.some((push) => push.type === 'agent_notice')).toBe(false)
  })
})

describe('list_agents 路由', () => {
  it('把桌面真实的 agent 列表回给手机，并按当前会话目录查询', async () => {
    const server = await startMobileServer()

    await server.emitTo('list_agents', {})

    expect(probe.gateway.listAgents).toHaveBeenCalledWith('/repo', 'claude-code')
    const last = server.pushes[server.pushes.length - 1]
    expect(last?.type).toBe('agents_list')
    expect(last?.data?.agents).toEqual([
      { agentType: 'Explore', description: 'read-only explorer', source: 'built-in' },
    ])
  })

  it('查询失败时仍回一个空列表，让手机端不至于一直等', async () => {
    const server = await startMobileServer()
    probe.gateway.listAgents.mockRejectedValueOnce(new Error('engine gone'))

    await server.emitTo('list_agents', {})

    const last = server.pushes[server.pushes.length - 1]
    expect(last?.type).toBe('agents_list')
    expect(last?.data?.agents).toEqual([])
  })
})
