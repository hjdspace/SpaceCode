// @vitest-environment node
/**
 * ClaudeCodeEngine 对进程池的委托契约（thinking/effort 与 listAgents 已各有专测）。
 *
 * 这个类是 gateway 背后 claude-code 引擎的实现层，几乎全部逻辑是「翻译」：
 *   - startSession 把 EngineSessionConfig 逐字段映射成 SessionConfig，其中侧边任务
 *     要先解析快照文件（失败降级为普通新会话，由 transcriptDigest 决定回 undefined）
 *   - 方法名两处不一致：stopEngineTask → pool.stopTask、stop → pool.killSession、
 *     abort → pool.abortSession —— 拼错就是静默 no-op，必须钉住
 *   - async 包装的池调用（updateThinkingLevel 族）在池同步抛错时必须变成 reject；
 *     sendMessage 则是原样透传池的 Promise，不做任何包装
 *   - getSessionStatus / getActiveSessions 把池状态投影成引擎状态，池里的内部字段
 *     （engineVersion 等）不得泄漏给上层
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app/root', getPath: () => '/home/u' },
  BrowserWindow: class {},
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

// transcriptDigest 会碰文件系统；快照是否生成由它负责，这里只断言引擎把结果接进配置
vi.mock('../../../session/transcriptDigest', () => ({
  resolveSideTaskContextPath: vi.fn(async () => undefined),
}))

vi.mock('../agentDefinitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agentDefinitions')>()
  return { ...actual, discoverAgentDefinitions: vi.fn(() => []) }
})

import { ClaudeCodeEngine } from '../ClaudeCodeEngine'
import { resolveSideTaskContextPath } from '../../../session/transcriptDigest'
import { discoverAgentDefinitions } from '../agentDefinitions'

type PoolMock = Record<string, ReturnType<typeof vi.fn>>

function engineWithPool(poolMock: PoolMock): ClaudeCodeEngine {
  const engine = new ClaudeCodeEngine()
  ;(engine as unknown as { pool: PoolMock }).pool = poolMock
  return engine
}

beforeEach(() => {
  vi.mocked(discoverAgentDefinitions).mockReset().mockReturnValue([])
})

describe('startSession 配置映射', () => {
  const fullConfig = {
    cwd: '/project',
    provider: 'anthropic',
    model: 'claude-opus-4',
    baseUrl: 'https://proxy.internal',
    apiKey: 'sk-test',
    effortLevel: 'high',
    permissionMode: 'bypassPermissions',
    systemPrompt: 'be terse',
    agent: 'Explore',
    thinkingEnabled: true,
    resumeSessionId: 'prev-session',
    engineSource: 'bundled',
    installedCliPath: '/cli/claude',
    modelContextWindows: { 'claude-opus-4': 200000 },
    rtkEnabled: true,
  }

  it('把 EngineSessionConfig 的全部字段逐个映射进 SessionConfig', async () => {
    const pool = { startSession: vi.fn(async (..._args: unknown[]) => undefined) }
    const engine = engineWithPool(pool)

    await engine.startSession('s1', fullConfig as any)

    expect(pool.startSession).toHaveBeenCalledTimes(1)
    const [sessionId, sessionConfig] = pool.startSession.mock.calls[0]
    expect(sessionId).toBe('s1')
    expect(sessionConfig).toEqual({
      cwd: '/project',
      provider: 'anthropic',
      model: 'claude-opus-4',
      baseUrl: 'https://proxy.internal',
      apiKey: 'sk-test',
      effortLevel: 'high',
      // 无人值守调用方（定时任务）靠它跳过权限确认，此前被丢弃过
      permissionMode: 'bypassPermissions',
      systemPrompt: 'be terse',
      agent: 'Explore',
      thinkingEnabled: true,
      resumeSessionId: 'prev-session',
      engineSource: 'bundled',
      installedCliPath: '/cli/claude',
      modelContextWindows: { 'claude-opus-4': 200000 },
      rtkEnabled: true,
      sideTaskContextPath: undefined,
    })
  })

  it('侧边任务：先解析快照文件，把路径带进会话配置', async () => {
    vi.mocked(resolveSideTaskContextPath).mockResolvedValue('/tmp/side-context.md')
    const pool = { startSession: vi.fn(async () => undefined) }
    const engine = engineWithPool(pool)

    const config = { ...fullConfig, sideTaskSourceSessionId: 'main-1', sideTaskSourceEngine: 'claude-code' }
    await engine.startSession('side-1', config as any)

    expect(resolveSideTaskContextPath).toHaveBeenCalledWith('side-1', config)
    expect(pool.startSession).toHaveBeenCalledWith('side-1', expect.objectContaining({ sideTaskContextPath: '/tmp/side-context.md' }))
  })

  it('快照解析失败降级为普通新会话（sideTaskContextPath 为 undefined）', async () => {
    vi.mocked(resolveSideTaskContextPath).mockResolvedValue(undefined)
    const pool = { startSession: vi.fn(async () => undefined) }
    const engine = engineWithPool(pool)

    const config = { ...fullConfig, sideTaskSourceSessionId: 'main-1' }
    await engine.startSession('side-1', config as any)

    expect(pool.startSession).toHaveBeenCalledWith('side-1', expect.objectContaining({ sideTaskContextPath: undefined }))
  })
})

describe('方法名映射：引擎方法 → 池方法', () => {
  it('stopEngineTask 映射到 pool.stopTask', async () => {
    const pool = { stopTask: vi.fn(async () => undefined) }
    await engineWithPool(pool).stopEngineTask('s1', 'task-9')
    expect(pool.stopTask).toHaveBeenCalledWith('s1', 'task-9')
  })

  it('stop 映射到 pool.killSession（终止进程，不留会话）', async () => {
    const pool = { killSession: vi.fn() }
    await expect(engineWithPool(pool).stop('s1')).resolves.toBeUndefined()
    expect(pool.killSession).toHaveBeenCalledWith('s1')
  })

  it('abort 映射到 pool.abortSession（中断当前轮，会话保留）', async () => {
    const pool = { abortSession: vi.fn() }
    await expect(engineWithPool(pool).abort('s1')).resolves.toBeUndefined()
    expect(pool.abortSession).toHaveBeenCalledWith('s1')
  })

  it('suspendSession 同步转调，resumeSession 转调并等待', async () => {
    const pool = { suspendSession: vi.fn(), resumeSession: vi.fn(async () => undefined) }
    const engine = engineWithPool(pool)
    engine.suspendSession('s1')
    expect(pool.suspendSession).toHaveBeenCalledWith('s1')

    await engine.resumeSession('s1')
    expect(pool.resumeSession).toHaveBeenCalledWith('s1')
  })
})

describe('委托语义：Promise 与异常的透传', () => {
  it('sendMessage 原样透传池的 Promise，拒绝不被吞掉', async () => {
    const pool = { sendMessage: vi.fn(async () => { throw new Error('permission refused') }) }
    await expect(engineWithPool(pool).sendMessage('s1', 'hi')).rejects.toThrow('permission refused')
    expect(pool.sendMessage).toHaveBeenCalledWith('s1', 'hi', undefined)
  })

  it('sendMessage 的 images 参数原样转发', async () => {
    const pool = { sendMessage: vi.fn(async () => undefined) }
    const images = [{ id: 'i1', name: 'a.png', type: 'image' as const, mimeType: 'image/png', previewUrl: '', data: '...' }]
    await engineWithPool(pool).sendMessage('s1', 'hi', images)
    expect(pool.sendMessage).toHaveBeenCalledWith('s1', 'hi', images)
  })

  it('submitToolAnswer / skipToolAnswer 转调池并 resolve（池层是同步的）', async () => {
    const pool = { submitToolAnswer: vi.fn(), skipToolAnswer: vi.fn() }
    const engine = engineWithPool(pool)

    await expect(engine.submitToolAnswer('s1', 't1', { q: 'a' })).resolves.toBeUndefined()
    expect(pool.submitToolAnswer).toHaveBeenCalledWith('s1', 't1', { q: 'a' })

    await expect(engine.skipToolAnswer('s1', 't1')).resolves.toBeUndefined()
    expect(pool.skipToolAnswer).toHaveBeenCalledWith('s1', 't1')
  })

  it('权限应答三兄弟转调池并 resolve', async () => {
    const pool = { respondPermission: vi.fn(), allowPermission: vi.fn(), denyPermission: vi.fn() }
    const engine = engineWithPool(pool)
    const decision = { behavior: 'allow' as const, updatedInput: {} }

    await expect(engine.respondPermission('s1', 'r1', decision as any)).resolves.toBeUndefined()
    expect(pool.respondPermission).toHaveBeenCalledWith('s1', 'r1', decision)

    await expect(engine.allowPermission('s1', 'r1', { x: 1 }, 'user_permanent', [])).resolves.toBeUndefined()
    expect(pool.allowPermission).toHaveBeenCalledWith('s1', 'r1', { x: 1 }, 'user_permanent', [])

    await expect(engine.denyPermission('s1', 'r1', 'no', { interrupt: true })).resolves.toBeUndefined()
    expect(pool.denyPermission).toHaveBeenCalledWith('s1', 'r1', 'no', { interrupt: true })
  })

  it('setPermissionMode / setModel 转调池，池的拒绝原样抛出', async () => {
    const pool = {
      setPermissionMode: vi.fn(async () => undefined),
      setModel: vi.fn(async () => { throw new Error('model not loaded') }),
    }
    const engine = engineWithPool(pool)

    await expect(engine.setPermissionMode('s1', 'plan')).resolves.toBeUndefined()
    expect(pool.setPermissionMode).toHaveBeenCalledWith('s1', 'plan')

    await expect(engine.setModel('s1', 'opus')).rejects.toThrow('model not loaded')
    expect(pool.setModel).toHaveBeenCalledWith('s1', 'opus')
  })

  it('查询方法（getMcpStatus / getContextUsage / getSettings / getPendingPermissionRequestIds）原样回传', () => {
    const pool = {
      getMcpStatus: vi.fn(() => ({ servers: [] })),
      getContextUsage: vi.fn(() => ({ used: 100 })),
      getSettings: vi.fn(() => ({ model: 'opus' })),
      getPendingPermissionRequestIds: vi.fn(() => ['r1']),
    }
    const engine = engineWithPool(pool)

    expect(engine.getMcpStatus('s1')).toEqual({ servers: [] })
    expect(engine.getContextUsage('s1')).toEqual({ used: 100 })
    expect(engine.getSettings('s1')).toEqual({ model: 'opus' })
    expect(engine.getPendingPermissionRequestIds('s1')).toEqual(['r1'])
  })
})

describe('状态投影', () => {
  it('池无此会话时 getSessionStatus 回 null', () => {
    const engine = engineWithPool({ getSessionStatus: vi.fn(() => null) })
    expect(engine.getSessionStatus('ghost')).toBeNull()
  })

  it('只投影引擎状态字段，池的内部字段（engineVersion 等）不外泄', () => {
    const pool = {
      getSessionStatus: vi.fn(() => ({
        sessionId: 's1',
        engineSessionId: 'eng-1',
        status: 'active',
        isRunning: true,
        permissionMode: 'plan',
        permissionModeVerified: true,
        engineVersion: '9.9.9',
        agentApplied: true,
      })),
    }
    const status = engineWithPool(pool).getSessionStatus('s1')

    expect(status).toEqual({
      sessionId: 's1',
      engineSessionId: 'eng-1',
      status: 'active',
      isRunning: true,
      permissionMode: 'plan',
      permissionModeVerified: true,
    })
  })

  it('getActiveSessions 逐条投影', () => {
    const pool = {
      getActiveSessions: vi.fn(() => [
        { sessionId: 's1', engineSessionId: null, status: 'starting', isRunning: false },
        { sessionId: 's2', engineSessionId: 'eng-2', status: 'suspended', isRunning: false, permissionModeVerified: null },
      ]),
    }
    const sessions = engineWithPool(pool).getActiveSessions()

    expect(sessions).toEqual([
      { sessionId: 's1', engineSessionId: null, status: 'starting', isRunning: false },
      { sessionId: 's2', engineSessionId: 'eng-2', status: 'suspended', isRunning: false, permissionMode: undefined, permissionModeVerified: null },
    ])
  })
})

describe('其它接线', () => {
  it('setMainWindow 转发给池', () => {
    const pool = { setMainWindow: vi.fn() }
    const win = {} as any
    engineWithPool(pool).setMainWindow(win)
    expect(pool.setMainWindow).toHaveBeenCalledWith(win)
  })

  it('listAgents 固定内置名单在前，发现的定义紧随其后', async () => {
    vi.mocked(discoverAgentDefinitions).mockReturnValue([
      { agentType: 'reviewer', description: 'Diff reviewer', source: 'project', file: '/p/.claude/agents/reviewer.md', body: 'Review.' },
    ])
    const agents = await engineWithPool({}).listAgents('/p')

    expect(agents.map(a => a.agentType)).toEqual([
      'general-purpose', 'Explore', 'Plan', 'verification', 'reviewer',
    ])
    // 界面字段之外的东西（定义正文、绝对路径）不外泄
    expect(agents[agents.length - 1]).not.toHaveProperty('file')
    expect(agents[agents.length - 1]).not.toHaveProperty('body')
    expect(discoverAgentDefinitions).toHaveBeenCalledWith({ kinds: ['claude'], cwd: '/p' })
  })
})
