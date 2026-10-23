// @vitest-environment node
/**
 * claudeCodeIPC 的 handler 边界 — gateway 转发之外的本地逻辑。
 *
 * engineGateway 已有自己的测试面（fake IEngine 驱动完整流程），本文件钉住 adapter 层
 * 自己负责的那部分契约：
 *   - 每个 channel 转发给 gateway 的哪个方法、参数原样透传（转发表是 adapter 的全部职责，
 *     拼错 channel 或换错方法编译期查不出来）
 *   - 会话历史 handler 的映射与错误口径：列表/全文失败原样抛出（#49 同款），而
 *     transcript 解析失败回 null（渲染层把 null 当「找不到」处理，不算错误）
 *   - MCP probe 的内置服务器解析（missing → failed，resolved → 命令/参数/env 合并）
 *   - cua-driver 依赖检测的特殊路径（不在系统 PATH 里）
 *   - MCP CRUD 落盘与 addServer/deleteServer/toggleEnabled 之后的 pi mcp.json 同步门控
 *   - 安装/更新进度回调经事件 channel 送回渲染层
 *
 * 测的都是注册进 ipcMain.handle 的真实回调，不是重写一遍。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: Object.assign(class {}, { fromWebContents: vi.fn() }),
  app: { isPackaged: false },
}))

vi.mock('../../infra/logger', () => {
  const noop = vi.fn()
  return { info: noop, warn: noop, error: noop, debug: noop }
})

const gateway = vi.hoisted(() => ({
  startSession: vi.fn(),
  sendMessage: vi.fn(),
  abort: vi.fn(),
  stop: vi.fn(),
  suspendSession: vi.fn(),
  resumeSession: vi.fn(),
  getSessionStatus: vi.fn(),
  getActiveSessions: vi.fn(),
  isSessionActive: vi.fn(),
  listAgents: vi.fn(),
  updateThinkingLevel: vi.fn(),
  updateEffortLevel: vi.fn(),
  submitToolAnswer: vi.fn(),
  skipToolAnswer: vi.fn(),
  allowPermission: vi.fn(),
  denyPermission: vi.fn(),
  respondPermission: vi.fn(),
  respondExtensionDialog: vi.fn(),
  setPermissionMode: vi.fn(),
  setModel: vi.fn(),
  getMcpStatus: vi.fn(),
  getContextUsage: vi.fn(),
  getSettings: vi.fn(),
  stopEngineTask: vi.fn(),
  getPendingPermissionRequestIds: vi.fn(),
}))

const history = vi.hoisted(() => ({
  listProjectSessions: vi.fn(),
  listAllSessions: vi.fn(),
  getFullSession: vi.fn(),
  getSessionTitle: vi.fn(),
  formatTimestamp: vi.fn(),
  getAgentTranscriptPath: vi.fn(),
  findAgentTranscriptByToolUse: vi.fn(),
}))

const cli = vi.hoisted(() => ({
  detectInstalledCli: vi.fn(),
  checkEnvironment: vi.fn(),
  installCli: vi.fn(),
  getCliUpdateState: vi.fn(),
  checkCliUpdate: vi.fn(),
  invalidateCliUpdateState: vi.fn(),
  updateCli: vi.fn(),
  isCommandAvailable: vi.fn(),
  installCommand: vi.fn(),
}))

const factory = vi.hoisted(() => ({
  setMainWindow: vi.fn(),
  getEngineAvailability: vi.fn(),
  killAll: vi.fn(),
}))

const mcpProbe = vi.hoisted(() => ({ probeMcpServer: vi.fn() }))
const mcpStore = vi.hoisted(() => ({
  loadMcpConfig: vi.fn((): any => ({})),
  saveMcpConfig: vi.fn(),
  buildEnabledMcpConfig: vi.fn((): any => null),
}))
const cuaDriver = vi.hoisted(() => ({
  findCuaDriverBinary: vi.fn((): any => null),
  getCuaDriverVersion: vi.fn(async (): Promise<any> => null),
}))
const mcpResolver = vi.hoisted(() => ({
  detectBuiltinFromConfig: vi.fn((): any => null),
  resolveBuiltinMcp: vi.fn((): any => null),
}))
const piMcp = vi.hoisted(() => ({
  piMcpJsonPath: vi.fn((): string => '/pi/mcp.json'),
  projectMcpForPi: vi.fn((): any => ({ entries: [], skipped: [] })),
  readPiForeignServers: vi.fn((): any[] => []),
  setPiForeignServerEnabled: vi.fn(),
  syncPiMcpConfigFromStore: vi.fn(() => ({})),
}))
const settingsIpc = vi.hoisted(() => ({ loadGuiSettings: vi.fn(async (): Promise<any> => null) }))
const piInstaller = vi.hoisted(() => ({ installPiSdk: vi.fn() }))

vi.mock('../engineGateway', () => ({ engineGateway: gateway }))
vi.mock('../../session/sessionHistoryManager', () => ({ SessionHistoryManager: history }))
vi.mock('../cliDetector', () => cli)
vi.mock('../engines/EngineFactory', () => ({ EngineFactory: factory }))
vi.mock('../../infra/proxyManager', () => ({
  proxyManager: { getStatus: vi.fn(), isRunning: vi.fn() },
}))
vi.mock('../../tools/mcpProbe', () => mcpProbe)
vi.mock('../../tools/mcpConfigStore', () => mcpStore)
vi.mock('../../tools/cuaDriverService', () => cuaDriver)
vi.mock('../../tools/mcpConfigResolver', () => mcpResolver)
vi.mock('../../tools/piMcpProjection', () => piMcp)
vi.mock('../../ipc/settingsIpc', () => settingsIpc)
vi.mock('../piInstaller', () => piInstaller)

import { ipcMain, BrowserWindow } from 'electron'
import { proxyManager } from '../../infra/proxyManager'
import { registerClaudeCodeIPC, getPool, setMainWindow } from '../claudeCodeIPC'

type Handler = (...args: any[]) => unknown

/** 从注册进 ipcMain.handle 的调用里按 channel 取回真实回调 */
function handler(channel: string): Handler {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
  const entry = calls.find(([name]) => name === channel)
  if (!entry) {
    throw new Error(`${channel} handler was never registered (saw ${calls.length} channels)`)
  }
  return entry[1] as Handler
}

function registeredChannels(): string[] {
  return (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.map(([name]) => name as string)
}

beforeEach(() => {
  ;(ipcMain.handle as ReturnType<typeof vi.fn>).mockReset()
  ;(BrowserWindow.fromWebContents as ReturnType<typeof vi.fn>).mockReset()
  for (const fn of Object.values(gateway)) fn.mockReset()
  for (const fn of Object.values(history)) fn.mockReset()
  for (const fn of Object.values(cli)) fn.mockReset()
  for (const fn of Object.values(factory)) fn.mockReset()
  for (const fn of Object.values(mcpProbe)) fn.mockReset()
  mcpStore.loadMcpConfig.mockReset().mockReturnValue({})
  mcpStore.saveMcpConfig.mockReset()
  mcpStore.buildEnabledMcpConfig.mockReset().mockReturnValue(null)
  cuaDriver.findCuaDriverBinary.mockReset().mockReturnValue(null)
  cuaDriver.getCuaDriverVersion.mockReset().mockResolvedValue(null)
  mcpResolver.detectBuiltinFromConfig.mockReset().mockReturnValue(null)
  mcpResolver.resolveBuiltinMcp.mockReset()
  piMcp.piMcpJsonPath.mockReset().mockReturnValue('/pi/mcp.json')
  piMcp.projectMcpForPi.mockReset().mockReturnValue({ entries: [], skipped: [] })
  piMcp.readPiForeignServers.mockReset().mockReturnValue([])
  piMcp.setPiForeignServerEnabled.mockReset()
  piMcp.syncPiMcpConfigFromStore.mockReset().mockReturnValue({})
  settingsIpc.loadGuiSettings.mockReset().mockResolvedValue(null)
  piInstaller.installPiSdk.mockReset()
  ;(proxyManager.getStatus as ReturnType<typeof vi.fn>).mockReset()
  ;(proxyManager.isRunning as ReturnType<typeof vi.fn>).mockReset()
  registerClaudeCodeIPC()
})

describe('gateway 转发表', () => {
  // channel → gateway 方法与参数的一一对应。加新引擎方法时在这里补一行，
  // 缺行 = 渲染层 invoke 得到 "No handler registered"。
  it.each([
    ['claude-code:startSession', 'startSession', ['s1', { cwd: '/p' }]],
    ['claude-code:sendMessage', 'sendMessage', ['s1', 'hello', [{ id: 'img1' }]]],
    ['claude-code:abort', 'abort', ['s1']],
    ['claude-code:stop', 'stop', ['s1']],
    ['claude-code:suspendSession', 'suspendSession', ['s1']],
    ['claude-code:resumeSession', 'resumeSession', ['s1']],
    ['claude-code:getSessionStatus', 'getSessionStatus', ['s1']],
    ['claude-code:getActiveSessions', 'getActiveSessions', []],
    ['claude-code:isSessionActive', 'isSessionActive', ['s1']],
    ['claude-code:listAgents', 'listAgents', ['/p', 'pi']],
    ['claude-code:updateThinkingLevel', 'updateThinkingLevel', ['s1', true]],
    ['claude-code:updateEffortLevel', 'updateEffortLevel', ['s1', 'high']],
    ['claude-code:submitToolAnswer', 'submitToolAnswer', ['s1', 't1', { a: 'b' }]],
    ['claude-code:skipToolAnswer', 'skipToolAnswer', ['s1', 't1']],
    [
      'claude-code:allowPermission',
      'allowPermission',
      ['s1', 'r1', { x: 1 }, 'user_temporary', []],
    ],
    ['claude-code:denyPermission', 'denyPermission', ['s1', 'r1', 'no', { interrupt: true }]],
    ['claude-code:respondPermission', 'respondPermission', ['s1', 'r1', { behavior: 'allow' }]],
    ['claude-code:respondExtensionDialog', 'respondExtensionDialog', ['s1', 'd1', { kind: 'cancel' }]],
    ['claude-code:setPermissionMode', 'setPermissionMode', ['s1', 'plan']],
    ['claude-code:setModel', 'setModel', ['s1', 'opus']],
    ['claude-code:getMcpStatus', 'getMcpStatus', ['s1']],
    ['claude-code:getContextUsage', 'getContextUsage', ['s1']],
    ['claude-code:getSettings', 'getSettings', ['s1']],
    ['claude-code:stopEngineTask', 'stopEngineTask', ['s1', 'task-1']],
    ['claude-code:getPendingPermissionRequestIds', 'getPendingPermissionRequestIds', ['s1']],
  ])('%s → gateway.%s', async (channel, method, args) => {
    const sentinel = { done: true }
    gateway[method as keyof typeof gateway].mockResolvedValue(sentinel)

    // ipcMain.handle 回调的首参是 event，转发表里的 args 从 event 之后算起
    await expect(handler(channel as string)({}, ...args)).resolves.toBe(sentinel)
    expect(gateway[method as keyof typeof gateway]).toHaveBeenCalledWith(...args)
  })

  it('每个注册的 channel 都落在转发表或本文件的用例里（防拼错 channel 静默漏接）', () => {
    const channels = registeredChannels()
    expect(channels.length).toBeGreaterThan(40)
    expect(new Set(channels).size).toBe(channels.length) // 不重复注册
    expect(channels).toContain('claude-code:startSession')
  })

  it('respondExtensionDialog 同步抛错直接穿透到 invoke（#54：不能把「没答上」显示成「答好了」）', () => {
    gateway.respondExtensionDialog.mockImplementation(() => {
      throw new Error('dialog gone')
    })
    // 该 handler 未包 async，同步异常原样冒泡 —— ipcMain 会把它转成 rejected promise
    expect(() => handler('claude-code:respondExtensionDialog')({}, 's1', 'd1', { kind: 'cancel' })).toThrow('dialog gone')
  })

  it('async 转发的失败同样让 invoke 拒绝（#49 家族语义）', async () => {
    gateway.setModel.mockRejectedValue(new Error('model refused'))
    await expect(handler('claude-code:setModel')({}, 's1', 'opus')).rejects.toThrow('model refused')
  })
})

describe('引擎可用性与 pi 安装', () => {
  it('isEngineAvailable 委托 EngineFactory.getEngineAvailability', async () => {
    const availability = { available: true, reason: 'ok', version: '1.2.3' }
    factory.getEngineAvailability.mockReturnValue(availability)

    await expect(handler('claude-code:isEngineAvailable')({}, 'pi')).resolves.toBe(availability)
    expect(factory.getEngineAvailability).toHaveBeenCalledWith('pi')
  })

  it('installPiSdk 委托 piInstaller', async () => {
    piInstaller.installPiSdk.mockResolvedValue({ success: true })
    await expect(handler('claude-code:installPiSdk')({})).resolves.toEqual({ success: true })
  })
})

describe('会话历史 handler', () => {
  it('listProjectSessions 附加 title 与 displayTime，其余字段原样保留', async () => {
    const lite = { sessionId: 'a', lastMessageTimestamp: 123, cwd: '/p' }
    history.listProjectSessions.mockResolvedValue([lite])
    history.getSessionTitle.mockImplementation((s: any) => `T-${s.sessionId}`)
    history.formatTimestamp.mockImplementation((ts: number) => `F-${ts}`)

    await expect(handler('claude-code:listProjectSessions')({}, '/p')).resolves.toEqual([
      { sessionId: 'a', lastMessageTimestamp: 123, cwd: '/p', title: 'T-a', displayTime: 'F-123' },
    ])
    expect(history.listProjectSessions).toHaveBeenCalledWith('/p')
  })

  it('listProjectSessions 失败原样抛出（渲染层要能区分「没有会话」和「读不了」）', async () => {
    history.listProjectSessions.mockRejectedValue(new Error('disk gone'))
    await expect(handler('claude-code:listProjectSessions')({}, '/p')).rejects.toThrow('disk gone')
  })

  it('listAllSessions 附加 title 与 displayTime', async () => {
    history.listAllSessions.mockResolvedValue([{ sessionId: 'b', lastMessageTimestamp: 5 }])
    history.getSessionTitle.mockReturnValue('T-b')
    history.formatTimestamp.mockReturnValue('F-5')

    await expect(handler('claude-code:listAllSessions')({})).resolves.toEqual([
      { sessionId: 'b', lastMessageTimestamp: 5, title: 'T-b', displayTime: 'F-5' },
    ])
  })

  it('listAllSessions 失败原样抛出', async () => {
    history.listAllSessions.mockRejectedValue(new Error('boom'))
    await expect(handler('claude-code:listAllSessions')({})).rejects.toThrow('boom')
  })

  it('getFullSession 原样回传全文并透传 engineType', async () => {
    const full = { sessionId: 'abc', messages: [] }
    history.getFullSession.mockResolvedValue(full)

    await expect(handler('claude-code:getFullSession')({}, '/p', 'abcdefgh', 'pi')).resolves.toBe(full)
    expect(history.getFullSession).toHaveBeenCalledWith('/p', 'abcdefgh', 'pi')
  })

  it('restoreSession 与 getFullSession 同一条读取路径', async () => {
    const full = { sessionId: 'abc', messages: [] }
    history.getFullSession.mockResolvedValue(full)

    await expect(handler('claude-code:restoreSession')({}, 'abcdefgh', '/p')).resolves.toBe(full)
    // restoreSession 的参数顺序是 (sessionId, projectPath)，读历史时换回 (projectPath, sessionId)
    expect(history.getFullSession).toHaveBeenCalledWith('/p', 'abcdefgh', undefined)
  })

  it('restoreSession 失败原样抛出', async () => {
    history.getFullSession.mockRejectedValue(new Error('corrupt'))
    await expect(handler('claude-code:restoreSession')({}, 'abcdefgh', '/p')).rejects.toThrow('corrupt')
  })

  it('resolveAgentTranscriptPath 成功回路径，失败回 null 而不是抛（渲染层按「找不到」处理）', async () => {
    history.getAgentTranscriptPath.mockReturnValue('/t/agent.jsonl')
    await expect(handler('claude-code:resolveAgentTranscriptPath')({}, '/p', 'abc', 'ag1')).resolves.toBe('/t/agent.jsonl')

    history.getAgentTranscriptPath.mockImplementation(() => {
      throw new Error('bad path')
    })
    await expect(handler('claude-code:resolveAgentTranscriptPath')({}, '/p', 'abc', 'ag1')).resolves.toBeNull()
  })

  it('findAgentTranscriptByToolUse 成功回路径，失败回 null', async () => {
    history.findAgentTranscriptByToolUse.mockReturnValue('/t/by-tool.jsonl')
    await expect(handler('claude-code:findAgentTranscriptByToolUse')({}, '/p', 'abc', 'tu1')).resolves.toBe('/t/by-tool.jsonl')

    history.findAgentTranscriptByToolUse.mockImplementation(() => {
      throw new Error('bad path')
    })
    await expect(handler('claude-code:findAgentTranscriptByToolUse')({}, '/p', 'abc', 'tu1')).resolves.toBeNull()
  })
})

describe('CLI 安装 / 更新与代理状态', () => {
  it('detectInstalledCli / checkEnvironment / getCliUpdateState 原样透传', async () => {
    cli.detectInstalledCli.mockResolvedValue({ available: true })
    cli.checkEnvironment.mockResolvedValue({ ok: true })
    const cached = { result: { hasUpdate: true }, checkedAt: 1, stale: false }
    cli.getCliUpdateState.mockReturnValue(cached)

    await expect(handler('claude-code:detectInstalledCli')({})).resolves.toEqual({ available: true })
    await expect(handler('claude-code:checkEnvironment')({})).resolves.toEqual({ ok: true })
    await expect(handler('claude-code:getCliUpdateState')({})).resolves.toEqual(cached)
  })

  it('checkCliUpdate 默认不吃缓存（force=false），并把最新结论广播给渲染层', async () => {
    const result = { installed: true, hasUpdate: true }
    const state = { result, checkedAt: 2, stale: false }
    cli.checkCliUpdate.mockResolvedValue(result)
    cli.getCliUpdateState.mockReturnValue(state)
    const send = vi.fn()
    const event = { sender: { send, isDestroyed: () => false } }

    await expect(handler('claude-code:checkCliUpdate')(event)).resolves.toEqual(result)
    expect(cli.checkCliUpdate).toHaveBeenCalledWith({ force: false })
    expect(send).toHaveBeenCalledWith('claude-code:cliUpdateState', state)

    await handler('claude-code:checkCliUpdate')(event, { force: true })
    expect(cli.checkCliUpdate).toHaveBeenLastCalledWith({ force: true })
  })

  it('installCli 从 event.sender 还原窗口，进度经 onInstallProgress 送回渲染层', async () => {
    const fakeWin = { webContents: { send: vi.fn(), isDestroyed: () => false } }
    ;(BrowserWindow.fromWebContents as ReturnType<typeof vi.fn>).mockReturnValue(fakeWin)
    cli.installCli.mockResolvedValue({ success: true })

    const event = { sender: { id: 1 } }
    await expect(handler('claude-code:installCli')(event)).resolves.toEqual({ success: true })
    expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(event.sender)

    const progress = { stage: 'downloading', message: 'fetching', percent: 10 }
    const progressCb = cli.installCli.mock.calls[0][1] as (p: unknown) => void
    progressCb(progress)
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('claude-code:installProgress', progress)
    // 装完本机 CLI 变了，旧结论必须作废并通知界面
    expect(cli.invalidateCliUpdateState).toHaveBeenCalled()
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('claude-code:cliUpdateState', cli.getCliUpdateState())
  })

  it('updateCli 的进度直接发到 event.sender（渲染端复用同一条进度通道）', async () => {
    cli.updateCli.mockResolvedValue({ success: true })
    const send = vi.fn()
    const event = { sender: { send, isDestroyed: () => false } }

    await expect(handler('claude-code:updateCli')(event)).resolves.toEqual({ success: true })

    const progress = { stage: 'verifying', message: 'done soon' }
    const progressCb = cli.updateCli.mock.calls[0][0] as (p: unknown) => void
    progressCb(progress)
    expect(send).toHaveBeenCalledWith('claude-code:installProgress', progress)
    expect(cli.invalidateCliUpdateState).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('claude-code:cliUpdateState', cli.getCliUpdateState())
  })

  it('getProxyStatus / isProxyRunning 委托 proxyManager', async () => {
    const status = { running: true, port: 8080 }
    ;(proxyManager.getStatus as ReturnType<typeof vi.fn>).mockReturnValue(status)
    ;(proxyManager.isRunning as ReturnType<typeof vi.fn>).mockReturnValue(true)

    await expect(handler('claude-code:getProxyStatus')({})).resolves.toBe(status)
    await expect(handler('claude-code:isProxyRunning')({})).resolves.toBe(true)
  })
})

describe('mcp:probeServer 的内置服务器解析', () => {
  it('非内置配置原样交给 probeMcpServer', async () => {
    const config = { type: 'stdio' as const, command: 'npx', args: ['-y', 'some-server'] }
    const result = { status: 'connected' as const, tools: [] }
    mcpProbe.probeMcpServer.mockResolvedValue(result)

    await expect(handler('mcp:probeServer')({}, config)).resolves.toBe(result)
    expect(mcpProbe.probeMcpServer).toHaveBeenCalledWith(config)
  })

  it('内置服务器解析失败时直接回 failed，不去 spawn', async () => {
    mcpResolver.detectBuiltinFromConfig.mockReturnValue('cua-driver')
    mcpResolver.resolveBuiltinMcp.mockReturnValue({ status: 'missing', error: 'cua-driver 未安装' })

    await expect(handler('mcp:probeServer')({}, { type: 'stdio', command: 'cua-driver' })).resolves.toEqual({
      status: 'failed',
      error: 'cua-driver 未安装',
    })
    expect(mcpProbe.probeMcpServer).not.toHaveBeenCalled()
  })

  it('内置服务器解析成功时把 command/args/env 合并进探测配置', async () => {
    mcpResolver.detectBuiltinFromConfig.mockReturnValue('browser-use')
    mcpResolver.resolveBuiltinMcp.mockReturnValue({
      status: 'resolved',
      config: { command: '/resolved/python', args: ['bridge.py'], env: { RESOLVED: '1' } },
    })
    mcpProbe.probeMcpServer.mockResolvedValue({ status: 'connected', tools: [] })

    const config = { type: 'stdio' as const, command: 'python', env: { USER: 'u' } }
    await handler('mcp:probeServer')({}, config)

    expect(mcpProbe.probeMcpServer).toHaveBeenCalledWith({
      type: 'stdio',
      command: '/resolved/python',
      args: ['bridge.py'],
      // 原有 env 在前、解析出的 env 在后 —— 后者覆盖同名键
      env: { USER: 'u', RESOLVED: '1' },
    })
  })
})

describe('mcp:checkDependency 的 cua-driver 特殊路径', () => {
  it('cua-driver 不在已知位置时回不可用，不走通用检测', async () => {
    const res = await handler('mcp:checkDependency')({}, 'cua-driver')
    expect(res).toEqual({ available: false, version: null, path: null })
    expect(cli.isCommandAvailable).not.toHaveBeenCalled()
  })

  it('cua-driver 找得到时带出版本与路径', async () => {
    cuaDriver.findCuaDriverBinary.mockReturnValue('/bin/cua-driver')
    cuaDriver.getCuaDriverVersion.mockResolvedValue('1.2.3')

    await expect(handler('mcp:checkDependency')({}, 'cua-driver')).resolves.toEqual({
      available: true,
      version: '1.2.3',
      path: '/bin/cua-driver',
    })
  })

  it('普通命令走 isCommandAvailable 并原样回传', async () => {
    cli.isCommandAvailable.mockResolvedValue({ available: true, version: '3.0.0', path: '/usr/bin/uvx' })

    await expect(handler('mcp:checkDependency')({}, 'uvx')).resolves.toEqual({
      available: true,
      version: '3.0.0',
      path: '/usr/bin/uvx',
    })
    expect(cli.isCommandAvailable).toHaveBeenCalledWith('uvx')
  })
})

describe('mcp:installDependency', () => {
  it('安装进度经 mcp:installProgress 送回发起方', async () => {
    cli.installCommand.mockResolvedValue({ success: true })
    const fakeWin = { webContents: { send: vi.fn() } }
    ;(BrowserWindow.fromWebContents as ReturnType<typeof vi.fn>).mockReturnValue(fakeWin)

    await expect(handler('mcp:installDependency')({ sender: { id: 1 } }, 'uv')).resolves.toEqual({ success: true })
    expect(cli.installCommand).toHaveBeenCalledWith('uv', expect.any(Function))

    const progress = { stage: 'installing', message: 'pip install uv' }
    const progressCb = cli.installCommand.mock.calls[0][1] as (p: unknown) => void
    progressCb(progress)
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('mcp:installProgress', progress)
  })
})

describe('MCP 配置 CRUD 与 pi 同步门控', () => {
  it('getServers 回当前配置', async () => {
    mcpStore.loadMcpConfig.mockReturnValue({ a: { command: 'x' } })
    await expect(handler('mcp:getServers')({})).resolves.toEqual({ mcpServers: { a: { command: 'x' } } })
  })

  it('addServer 打上 settings.json 来源并落盘', async () => {
    await expect(handler('mcp:addServer')({ sender: {} }, 'srv', { command: 'x' })).resolves.toEqual({ success: true })
    expect(mcpStore.saveMcpConfig).toHaveBeenCalledWith({ srv: { command: 'x', _source: 'settings.json' } })
  })

  it('updateServers 原样落盘', async () => {
    const servers = { a: { command: 'x' }, b: { url: 'http://x' } }
    await expect(handler('mcp:updateServers')({ sender: {} }, servers)).resolves.toEqual({ success: true })
    expect(mcpStore.saveMcpConfig).toHaveBeenCalledWith(servers)
  })

  it('deleteServer 从配置里移除后再落盘', async () => {
    mcpStore.loadMcpConfig.mockReturnValue({ a: {}, b: {} })
    await expect(handler('mcp:deleteServer')({ sender: {} }, 'a')).resolves.toEqual({ success: true })
    expect(mcpStore.saveMcpConfig).toHaveBeenCalledWith({ b: {} })
  })

  it('toggleEnabled 对存在的条目置位并落盘', async () => {
    mcpStore.loadMcpConfig.mockReturnValue({ a: { enabled: false } })
    await expect(handler('mcp:toggleEnabled')({ sender: {} }, 'a', true)).resolves.toEqual({ success: true })
    expect(mcpStore.saveMcpConfig).toHaveBeenCalledWith({ a: { enabled: true } })
  })

  it('toggleEnabled 对不存在的条目不落盘，仍回成功（幂等开关）', async () => {
    mcpStore.loadMcpConfig.mockReturnValue({})
    await expect(handler('mcp:toggleEnabled')({ sender: {} }, 'ghost', true)).resolves.toEqual({ success: true })
    expect(mcpStore.saveMcpConfig).not.toHaveBeenCalled()
  })

  it('getActiveMcpNames：无启用配置回空数组，有配置回服务器名列表', async () => {
    expect(await handler('mcp:getActiveMcpNames')({})).toEqual([])

    mcpStore.buildEnabledMcpConfig.mockReturnValue({ mcpServers: { a: {}, b: {} } })
    expect(await handler('mcp:getActiveMcpNames')({})).toEqual(['a', 'b'])
  })

  it('getPiState 汇总投影条目、被跳过的与外来服务器', async () => {
    mcpStore.loadMcpConfig.mockReturnValue({ a: {} })
    piMcp.projectMcpForPi.mockReturnValue({
      entries: [{ name: 'cleaned-a', sourceKey: 'a', entry: { enabled: false } }],
      skipped: ['sse-server'],
    })
    piMcp.readPiForeignServers.mockReturnValue([{ name: 'foreign', sourceKey: 'foreign' }])

    await expect(handler('mcp:getPiState')({})).resolves.toEqual({
      path: '/pi/mcp.json',
      configured: [{ name: 'cleaned-a', sourceKey: 'a', enabled: false }],
      skipped: ['sse-server'],
      foreign: [{ name: 'foreign', sourceKey: 'foreign' }],
    })
  })

  it('setPiServerEnabled 原样委托 pi 投影层', async () => {
    piMcp.setPiForeignServerEnabled.mockReturnValue({ ok: true })
    await expect(handler('mcp:setPiServerEnabled')({ sender: {} }, 'foreign', true)).resolves.toEqual({ ok: true })
    expect(piMcp.setPiForeignServerEnabled).toHaveBeenCalledWith('foreign', true)
  })
})

describe('MCP 面板改动后的 pi mcp.json 同步门控 (issue #53)', () => {
  it('当前引擎是 pi 时同步投影结果', async () => {
    settingsIpc.loadGuiSettings.mockResolvedValue({ engineType: 'pi' })
    piMcp.syncPiMcpConfigFromStore.mockReturnValue({ path: '/pi/mcp.json', wrote: true })

    await handler('mcp:addServer')({ sender: {} }, 'srv', { command: 'x' })

    expect(piMcp.syncPiMcpConfigFromStore).toHaveBeenCalledTimes(1)
  })

  it('当前引擎不是 pi 时不碰用户自己的 mcp.json', async () => {
    settingsIpc.loadGuiSettings.mockResolvedValue({ engineType: 'claude-code' })

    await handler('mcp:addServer')({ sender: {} }, 'srv', { command: 'x' })

    expect(piMcp.syncPiMcpConfigFromStore).not.toHaveBeenCalled()
  })

  it('读不到设置（loadGuiSettings 抛错）时不同步，CRUD 本身照常成功', async () => {
    settingsIpc.loadGuiSettings.mockRejectedValue(new Error('settings io'))

    await expect(handler('mcp:addServer')({ sender: {} }, 'srv', { command: 'x' })).resolves.toEqual({ success: true })
    expect(mcpStore.saveMcpConfig).toHaveBeenCalled()
    expect(piMcp.syncPiMcpConfigFromStore).not.toHaveBeenCalled()
  })

  it('同步失败只降级为 warn，不吞掉 CRUD 的成功结果', async () => {
    settingsIpc.loadGuiSettings.mockResolvedValue({ engineType: 'pi' })
    piMcp.syncPiMcpConfigFromStore.mockReturnValue({ path: '/pi/mcp.json', wrote: false, error: 'mcp.json 损坏' })

    await expect(handler('mcp:deleteServer')({ sender: {} }, 'srv')).resolves.toEqual({ success: true })
    expect(mcpStore.saveMcpConfig).toHaveBeenCalled()
  })
})

describe('窗口接线与退出清理', () => {
  it('setMainWindow 同时接线 adapter 与 EngineFactory', () => {
    const win = { webContents: {} } as any
    setMainWindow(win)
    expect(factory.setMainWindow).toHaveBeenCalledWith(win)
  })

  it('getPool().killAll() 委托 EngineFactory.killAll（曾经是恒 null 的死代码）', () => {
    const pool = getPool()
    expect(pool).not.toBeNull()
    pool!.killAll()
    expect(factory.killAll).toHaveBeenCalledTimes(1)
  })
})
