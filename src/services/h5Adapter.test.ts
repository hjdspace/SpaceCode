// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  startSession: vi.fn(async () => ({})),
  sendMessage: vi.fn(async () => ({})),
  abort: vi.fn(async () => ({})),
  stop: vi.fn(async () => ({})),
  suspendSession: vi.fn(async () => ({})),
  resumeSession: vi.fn(async () => ({ status: null })),
  getSessionStatus: vi.fn(async () => null),
  getActiveSessions: vi.fn(async () => []),
  submitToolAnswer: vi.fn(async () => ({})),
  skipToolAnswer: vi.fn(async () => ({})),
  allowPermission: vi.fn(async () => ({})),
  denyPermission: vi.fn(async () => ({})),
  setPermissionMode: vi.fn(async () => ({})),
  setModel: vi.fn(async () => ({})),
  updateThinkingLevel: vi.fn(async () => ({})),
  stopEngineTask: vi.fn(async () => ({})),
  getMcpStatus: vi.fn(async () => null),
  getContextUsage: vi.fn(async () => null),
  getSettings: vi.fn(async () => null),
  getPendingPermissionRequestIds: vi.fn(async () => []),
  resolveAgentTranscriptPath: vi.fn(async () => '/tmp/agent.jsonl'),
  listAgents: vi.fn(async () => []),
  isEngineAvailable: vi.fn(async () => ({ available: true })),
  listProjectSessions: vi.fn(async () => []),
  restoreSession: vi.fn(async () => ({})),
}))

vi.mock('./h5ApiClient', () => ({
  h5ApiClient: api,
  // h5WebSocketClient 从同一模块取连接配置，mock 需保持该导出存在
  getH5Config: vi.fn(() => null),
  isH5Mode: vi.fn(() => true),
}))

import { createH5Adapter } from './h5Adapter'

describe('createH5Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('结构满足 claudeCode 契约（含必选 onError）', () => {
    const adapter = createH5Adapter()
    expect(typeof adapter.startSession).toBe('function')
    expect(typeof adapter.onError).toBe('function')
    expect(typeof adapter.onAssistant).toBe('function')
    expect(typeof adapter.onInstallProgress).toBe('function')
  })

  // 回归防线：这些方法曾经是 Promise.resolve() 空操作 —— 界面点了「成功」
  // 但引擎毫无变化。现在必须真正打到服务端。
  describe('曾经的空操作现在必须转发到服务端', () => {
    const cases: Array<[string, (a: any) => unknown, readonly unknown[]]> = [
      ['suspendSession', a => a.suspendSession('sid'), ['sid']],
      ['resumeSession', a => a.resumeSession('sid'), ['sid']],
      ['setPermissionMode', a => a.setPermissionMode('sid', 'plan'), ['sid', 'plan']],
      ['setModel', a => a.setModel('sid', 'opus'), ['sid', 'opus']],
      ['updateThinkingLevel', a => a.updateThinkingLevel('sid', true), ['sid', true]],
      ['stopEngineTask', a => a.stopEngineTask('sid', 'task-1'), ['sid', 'task-1']],
      ['getMcpStatus', a => a.getMcpStatus('sid'), ['sid']],
      ['getContextUsage', a => a.getContextUsage('sid'), ['sid']],
      ['getSettings', a => a.getSettings('sid'), ['sid']],
      ['getPendingPermissionRequestIds', a => a.getPendingPermissionRequestIds('sid'), ['sid']],
      ['listAgents', a => a.listAgents('/proj', 'claude-code'), ['/proj', 'claude-code']],
      [
        'resolveAgentTranscriptPath',
        a => a.resolveAgentTranscriptPath('/proj', 'sid', 'agent-1'),
        ['/proj', 'sid', 'agent-1'],
      ],
    ]

    it.each(cases)('%s 转发参数', async (name, invoke, args) => {
      const adapter = createH5Adapter()
      await invoke(adapter)
      expect(api[name as keyof typeof api]).toHaveBeenCalledWith(...args)
    })
  })

  it('isEngineAvailable 取服务端探测结果而非恒 true', async () => {
    const adapter = createH5Adapter()
    api.isEngineAvailable.mockResolvedValueOnce({ available: false })

    await expect(adapter.isEngineAvailable('pi')).resolves.toBe(false)
    expect(api.isEngineAvailable).toHaveBeenCalledWith('pi')
  })

  it('resumeSession 解析为 void，不把服务端 status 泄漏给调用方', async () => {
    const adapter = createH5Adapter()
    await expect(adapter.resumeSession('sid')).resolves.toBeUndefined()
  })

  it('Desktop-only 能力保持诚实降级（warn 而非假成功）', async () => {
    const adapter = createH5Adapter()

    await expect(adapter.notifyEngineSourceChanged('installed')).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('仅桌面端'))

    // 代理/CLI 探测无 H5 入口，返回中性值
    await expect(adapter.detectInstalledCli()).resolves.toBeNull()
    await expect(adapter.isProxyRunning()).resolves.toBe(false)
    await expect(adapter.getProxyStatus()).resolves.toBeNull()
  })
})
