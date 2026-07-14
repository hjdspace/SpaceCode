import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  type FakeEngine = {
    type: 'claude-code' | 'pi'
    startSession: ReturnType<typeof vi.fn>
    sendMessage: ReturnType<typeof vi.fn>
    abort: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    suspendSession?: ReturnType<typeof vi.fn>
    resumeSession?: ReturnType<typeof vi.fn>
    getSessionStatus: ReturnType<typeof vi.fn>
    getActiveSessions: ReturnType<typeof vi.fn>
    listAgents?: ReturnType<typeof vi.fn>
    submitToolAnswer?: ReturnType<typeof vi.fn>
    skipToolAnswer?: ReturnType<typeof vi.fn>
    allowPermission?: ReturnType<typeof vi.fn>
    denyPermission?: ReturnType<typeof vi.fn>
    respondPermission?: ReturnType<typeof vi.fn>
    setPermissionMode?: ReturnType<typeof vi.fn>
    setModel?: ReturnType<typeof vi.fn>
    getMcpStatus?: ReturnType<typeof vi.fn>
    getContextUsage?: ReturnType<typeof vi.fn>
    getSettings?: ReturnType<typeof vi.fn>
    stopEngineTask?: ReturnType<typeof vi.fn>
    getPendingPermissionRequestIds?: ReturnType<typeof vi.fn>
  }

  const engines: FakeEngine[] = []

  function makeClaudeEngine(overrides: Partial<FakeEngine> = {}): FakeEngine {
    return {
      type: 'claude-code',
      startSession: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      suspendSession: vi.fn(() => {}),
      resumeSession: vi.fn(async () => {}),
      getSessionStatus: vi.fn(() => null),
      getActiveSessions: vi.fn(() => []),
      listAgents: vi.fn(async () => []),
      submitToolAnswer: vi.fn(async () => {}),
      skipToolAnswer: vi.fn(async () => {}),
      allowPermission: vi.fn(async () => {}),
      denyPermission: vi.fn(async () => {}),
      respondPermission: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      getMcpStatus: vi.fn(async () => ({})),
      getContextUsage: vi.fn(async () => ({})),
      getSettings: vi.fn(async () => ({})),
      stopEngineTask: vi.fn(async () => {}),
      getPendingPermissionRequestIds: vi.fn(() => []),
      ...overrides,
    }
  }

  function makePiEngine(overrides: Partial<FakeEngine> = {}): FakeEngine {
    return {
      type: 'pi',
      startSession: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      getSessionStatus: vi.fn(() => null),
      getActiveSessions: vi.fn(() => []),
      ...overrides,
    }
  }

  return {
    engines,
    makeClaudeEngine,
    makePiEngine,
    reset() {
      engines.splice(0)
    },
  }
})

vi.mock('../engines/EngineFactory', () => ({
  EngineFactory: {
    getAllEngines: () => mockState.engines,
    getEngine: vi.fn((type: string) => {
      const found = mockState.engines.find(e => e.type === type)
      if (!found) throw new Error(`Engine "${type}" not found`)
      return found
    }),
    isEngineAvailableAsync: vi.fn(async () => true),
    onEngineCreated: vi.fn(() => () => {}),
  },
}))

vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

describe('engineGateway', () => {
  let engineGateway: typeof import('../engineGateway').engineGateway
  let NotImplementedError: typeof import('../engineGateway').NotImplementedError
  let info: typeof import('../logger').info
  let error: typeof import('../logger').error

  beforeEach(async () => {
    vi.clearAllMocks()
    mockState.reset()
    vi.resetModules()
    const mod = await import('../engineGateway')
    engineGateway = mod.engineGateway
    NotImplementedError = mod.NotImplementedError
    const logger = await import('../logger')
    info = logger.info
    error = logger.error
  })

  describe('findEngineForSession', () => {
    it('returns the engine with a running session', () => {
      const engineA = mockState.makeClaudeEngine()
      engineA.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      const engineB = mockState.makePiEngine()
      engineB.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: false })
      mockState.engines.push(engineA, engineB)

      const result = engineGateway.findEngineForSession('s1')
      expect(result).toBe(engineA)
    })

    it('falls back to non-running engine that tracks the session', () => {
      const engineA = mockState.makeClaudeEngine()
      engineA.getSessionStatus.mockReturnValue(null)
      const engineB = mockState.makePiEngine()
      engineB.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: false })
      mockState.engines.push(engineA, engineB)

      const result = engineGateway.findEngineForSession('s1')
      expect(result).toBe(engineB)
    })

    it('falls back to claude-code default when no engine tracks the session', () => {
      const engineA = mockState.makeClaudeEngine()
      engineA.getSessionStatus.mockReturnValue(null)
      const engineB = mockState.makePiEngine()
      engineB.getSessionStatus.mockReturnValue(null)
      mockState.engines.push(engineA, engineB)

      const result = engineGateway.findEngineForSession('unknown-session')
      expect(result).toBe(engineA)
    })
  })

  describe('dispatch — basic', () => {
    it('sendMessage delegates to the engine found by sessionId', async () => {
      const engine = mockState.makeClaudeEngine()
      engine.sendMessage.mockResolvedValue(undefined)
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await engineGateway.sendMessage('s1', 'hello', undefined)

      expect(engine.sendMessage).toHaveBeenCalledWith('s1', 'hello', undefined)
    })

    it('abort delegates to the engine', async () => {
      const engine = mockState.makeClaudeEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await engineGateway.abort('s1')

      expect(engine.abort).toHaveBeenCalledWith('s1')
    })

    it('suspendSession delegates when engine supports it', async () => {
      const engine = mockState.makeClaudeEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      engineGateway.suspendSession('s1')

      expect(engine.suspendSession).toHaveBeenCalledWith('s1')
    })

    it('resumeSession delegates and returns status', async () => {
      const engine = mockState.makeClaudeEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true, status: 'active' })
      mockState.engines.push(engine)

      const status = await engineGateway.resumeSession('s1')

      expect(engine.resumeSession).toHaveBeenCalledWith('s1')
      expect(status).toEqual({ sessionId: 's1', isRunning: true, status: 'active' })
    })
  })

  describe('startSession', () => {
    it('delegates to the engine and returns status', async () => {
      const engine = mockState.makeClaudeEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true, status: 'active' })
      mockState.engines.push(engine)

      const status = await engineGateway.startSession('s1', { cwd: '/proj' })

      expect(engine.startSession).toHaveBeenCalledWith('s1', { cwd: '/proj' })
      expect(status).toEqual({ sessionId: 's1', isRunning: true, status: 'active' })
    })

    it('falls back to claude-code when requested engine not available', async () => {
      const { EngineFactory } = await import('../engines/EngineFactory')
      ;(EngineFactory.isEngineAvailableAsync as any).mockResolvedValue(false)

      const claudeEngine = mockState.makeClaudeEngine()
      claudeEngine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true, status: 'active' })
      mockState.engines.push(claudeEngine)

      const status = await engineGateway.startSession('s1', { cwd: '/proj', engineType: 'pi' })

      expect(claudeEngine.startSession).toHaveBeenCalledWith('s1', expect.objectContaining({ engineType: 'pi' }))
      expect(status).toEqual({ sessionId: 's1', isRunning: true, status: 'active' })
    })
  })

  describe('stop — multi-engine', () => {
    it('stops the session on every engine that tracks it', async () => {
      const engineA = mockState.makeClaudeEngine()
      engineA.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      const engineB = mockState.makePiEngine()
      engineB.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: false })
      mockState.engines.push(engineA, engineB)

      await engineGateway.stop('s1')

      expect(engineA.stop).toHaveBeenCalledWith('s1')
      expect(engineB.stop).toHaveBeenCalledWith('s1')
    })

    it('warns but continues when one engine throws', async () => {
      const engineA = mockState.makeClaudeEngine()
      engineA.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      engineA.stop.mockRejectedValue(new Error('engine A boom'))
      const engineB = mockState.makePiEngine()
      engineB.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: false })
      mockState.engines.push(engineA, engineB)

      await engineGateway.stop('s1')

      expect(engineB.stop).toHaveBeenCalledWith('s1')
    })
  })

  describe('aggregation', () => {
    it('getActiveSessions aggregates across all engines', () => {
      const engineA = mockState.makeClaudeEngine()
      engineA.getActiveSessions.mockReturnValue([{ sessionId: 's1' }])
      const engineB = mockState.makePiEngine()
      engineB.getActiveSessions.mockReturnValue([{ sessionId: 's2' }])
      mockState.engines.push(engineA, engineB)

      const result = engineGateway.getActiveSessions()

      expect(result).toEqual([{ sessionId: 's1' }, { sessionId: 's2' }])
    })

    it('isSessionActive checks the specific session when sessionId given', () => {
      const engine = mockState.makeClaudeEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      expect(engineGateway.isSessionActive('s1')).toBe(true)
    })

    it('isSessionActive returns false when session is not running', () => {
      const engine = mockState.makeClaudeEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: false })
      mockState.engines.push(engine)

      expect(engineGateway.isSessionActive('s1')).toBe(false)
    })

    it('isSessionActive checks any engine when no sessionId given', () => {
      const engineA = mockState.makeClaudeEngine()
      engineA.getActiveSessions.mockReturnValue([])
      const engineB = mockState.makePiEngine()
      engineB.getActiveSessions.mockReturnValue([{ sessionId: 's2' }])
      mockState.engines.push(engineA, engineB)

      expect(engineGateway.isSessionActive()).toBe(true)
    })

    it('isSessionActive returns false when no engine has active sessions', () => {
      const engine = mockState.makeClaudeEngine()
      engine.getActiveSessions.mockReturnValue([])
      mockState.engines.push(engine)

      expect(engineGateway.isSessionActive()).toBe(false)
    })
  })

  describe('capability check — action methods throw NotImplementedError', () => {
    it('allowPermission throws when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await expect(
        engineGateway.allowPermission('s1', 'r1'),
      ).rejects.toThrow(NotImplementedError)
    })

    it('allowPermission delegates when engine supports it', async () => {
      const engine = mockState.makeClaudeEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await engineGateway.allowPermission('s1', 'r1', { foo: 1 }, 'user_temporary')

      expect(engine.allowPermission).toHaveBeenCalledWith('s1', 'r1', { foo: 1 }, 'user_temporary')
    })

    it('denyPermission throws when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await expect(
        engineGateway.denyPermission('s1', 'r1'),
      ).rejects.toThrow(NotImplementedError)
    })

    it('submitToolAnswer throws when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await expect(
        engineGateway.submitToolAnswer('s1', 't1', {}),
      ).rejects.toThrow(NotImplementedError)
    })

    it('setPermissionMode throws when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await expect(
        engineGateway.setPermissionMode('s1', 'plan'),
      ).rejects.toThrow(NotImplementedError)
    })

    it('setModel throws when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await expect(
        engineGateway.setModel('s1', 'gpt-4'),
      ).rejects.toThrow(NotImplementedError)
    })

    it('stopEngineTask throws when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await expect(
        engineGateway.stopEngineTask('s1', 'task-1'),
      ).rejects.toThrow(NotImplementedError)
    })
  })

  describe('capability check — query methods return null/[]', () => {
    it('getMcpStatus returns null when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      const result = await engineGateway.getMcpStatus('s1')

      expect(result).toBeNull()
    })

    it('getSettings returns null when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      const result = await engineGateway.getSettings('s1')

      expect(result).toBeNull()
    })

    it('getContextUsage returns null when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      const result = await engineGateway.getContextUsage('s1')

      expect(result).toBeNull()
    })

    it('getPendingPermissionRequestIds returns [] when engine lacks it', () => {
      const engine = mockState.makePiEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      const result = engineGateway.getPendingPermissionRequestIds('s1')

      expect(result).toEqual([])
    })

    it('listAgents returns [] when engine lacks it', async () => {
      const engine = mockState.makePiEngine()
      mockState.engines.push(engine)

      const result = await engineGateway.listAgents('/proj', 'pi')

      expect(result).toEqual([])
    })
  })

  describe('logging', () => {
    it('logs enter and exit on success', async () => {
      const engine = mockState.makeClaudeEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      mockState.engines.push(engine)

      await engineGateway.sendMessage('s1', 'hello')

      const calls = (info as any).mock.calls
      const enterCall = calls.find((c: any[]) => c[0] === 'EngineGateway' && c[1].includes('→ sendMessage'))
      const exitCall = calls.find((c: any[]) => c[0] === 'EngineGateway' && c[1].includes('← sendMessage'))
      expect(enterCall).toBeTruthy()
      expect(exitCall).toBeTruthy()
    })

    it('logs error on failure and rethrows', async () => {
      const engine = mockState.makeClaudeEngine()
      engine.getSessionStatus.mockReturnValue({ sessionId: 's1', isRunning: true })
      engine.sendMessage.mockRejectedValue(new Error('engine boom'))
      mockState.engines.push(engine)

      await expect(engineGateway.sendMessage('s1', 'hello')).rejects.toThrow('engine boom')

      const calls = (error as any).mock.calls
      const errorCall = calls.find((c: any[]) => c[0] === 'EngineGateway' && c[1].includes('✗ sendMessage'))
      expect(errorCall).toBeTruthy()
    })
  })
})
