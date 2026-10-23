// @vitest-environment node
/**
 * updateThinkingLevel 的 IPC 边界（issue #49）。
 *
 * 这个 handler 曾经 try/catch 后只记日志并返回 undefined：`ipcRenderer.invoke` 于是
 * 永远 resolve 成功，引擎里的失败（Pi 那条 `throw err` 是老实的）在这层被抹平，
 * 界面停在用户刚点的新开关上。现在它与 setModel / setPermissionMode 同构 ——
 * 成功回引擎的生效时机，失败原样抛出，由渲染层把开关退回去。
 *
 * 测的是注册进 ipcMain.handle 的那个真实回调，不是重写一遍。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
  app: { isPackaged: false },
}))

vi.mock('../../infra/logger', () => {
  const noop = vi.fn()
  return { info: noop, warn: noop, error: noop, debug: noop }
})

const gateway = vi.hoisted(() => ({
  updateThinkingLevel: vi.fn(),
}))

vi.mock('../engineGateway', () => ({ engineGateway: gateway }))

// claudeCodeIPC 在模块图里拉进其余主进程依赖；本用例只关心那一个 handler，
// 全部换成空壳，避免注册逻辑之外的副作用被执行。
vi.mock('../engines/EngineFactory', () => ({ EngineFactory: { setMainWindow: vi.fn() } }))
vi.mock('../../session/sessionHistoryManager', () => ({ SessionHistoryManager: {} }))
vi.mock('../cliDetector', () => ({
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
vi.mock('../../infra/proxyManager', () => ({ proxyManager: {} }))
vi.mock('../../tools/mcpProbe', () => ({ probeMcpServer: vi.fn() }))
vi.mock('../../tools/mcpConfigStore', () => ({
  loadMcpConfig: vi.fn(() => ({})),
  saveMcpConfig: vi.fn(),
  buildEnabledMcpConfig: vi.fn(() => null),
}))
vi.mock('../../tools/cuaDriverService', () => ({
  findCuaDriverBinary: vi.fn(() => null),
  getCuaDriverVersion: vi.fn(async () => null),
}))
vi.mock('../../tools/mcpConfigResolver', () => ({
  detectBuiltinFromConfig: vi.fn(() => null),
  resolveBuiltinMcp: vi.fn(),
}))
vi.mock('../piInstaller', () => ({ installPiSdk: vi.fn() }))

import { ipcMain } from 'electron'
import { registerClaudeCodeIPC } from '../claudeCodeIPC'

type Handler = (...args: any[]) => Promise<unknown>

/** 从注册进 ipcMain.handle 的调用里取回 thinking channel 的真实回调 */
function thinkingHandler(): Handler {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
  const entry = calls.find(([channel]) => channel === 'claude-code:updateThinkingLevel')
  if (!entry) throw new Error(`claude-code:updateThinkingLevel handler was never registered (saw ${calls.length} channels)`)
  return entry[1] as Handler
}

beforeEach(() => {
  ;(ipcMain.handle as ReturnType<typeof vi.fn>).mockReset()
  gateway.updateThinkingLevel.mockReset()
  registerClaudeCodeIPC()
})

describe('claude-code:updateThinkingLevel handler', () => {
  it('把引擎的生效时机原样回给渲染层，不再返回 undefined', async () => {
    gateway.updateThinkingLevel.mockResolvedValue('next-turn')

    await expect(thinkingHandler()({}, 'session-aaaaaaaa', true)).resolves.toBe('next-turn')
    expect(gateway.updateThinkingLevel).toHaveBeenCalledWith('session-aaaaaaaa', true)
  })

  it('引擎失败时让 invoke 拒绝，而不是抹平成 resolve', async () => {
    gateway.updateThinkingLevel.mockRejectedValue(new Error('pi process gone'))

    // 修复前这里 resolve(undefined)：界面把「点了」读成「生效了」。
    await expect(thinkingHandler()({}, 'session-aaaaaaaa', false)).rejects.toThrow('pi process gone')
  })
})
