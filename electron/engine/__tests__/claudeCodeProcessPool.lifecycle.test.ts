// @vitest-environment node
/**
 * ClaudeCodeProcessPool 的生命周期与事件路由测试。
 *
 * permissionMode / thinkingLevel 两个文件已覆盖"权限对账"与"spawn 参数重启"两条线，
 * 这里补齐池子的其余主干：
 *  - startSession 三分支（运行中复用 / 挂起转恢复 / 死条目驱逐）与启动失败传播；
 *  - resumeSession 守卫（不存在 / 非挂起 / 成功恢复后事件仍可达）；
 *  - evictIfNeeded 三级驱逐（安全 idle → 安全 active → 全部阻塞）；
 *  - 发送族守卫（sendMessage / submitToolAnswer / skipToolAnswer / requireRunning 族）；
 *  - setPermissionMode：无进程时存 pending、控制请求被拒时按新模式重启；
 *  - 事件路由（channel 表派发 / 未知类型丢弃 / 窗口不可用降级 / 监听器扇出与退订）；
 *  - killSession / killAll / abortSession / suspendSession 与状态查询。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { isPackaged: false },
}))

vi.mock('../../infra/logger', () => {
  const noop = vi.fn()
  return { info: noop, warn: noop, error: noop, debug: noop }
})

vi.mock('../../session/sessionProcess', async () => {
  const { FakeSessionProcess } = await import('./fixtures/fakeSessionProcess')
  return { SessionProcess: FakeSessionProcess }
})

import { ClaudeCodeProcessPool, MAX_PROCESSES } from '../claudeCodeProcessPool'
import { FakeSessionProcess, fakeInstances } from './fixtures/fakeSessionProcess'
import { warn } from '../../infra/logger'

const SID = 'session-aaaaaaaa'

function baseConfig(extra: Record<string, unknown> = {}) {
  return { cwd: '/repo', provider: 'anthropic', model: 'sonnet', ...extra } as any
}

function fakeWindow() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } } as any
}

function lastProc(): FakeSessionProcess {
  const list = fakeInstances()
  return list[list.length - 1]
}

async function startPool(
  pool: ClaudeCodeProcessPool,
  sessionId = SID,
  config: Record<string, unknown> = {},
) {
  await pool.startSession(sessionId, baseConfig(config))
  return lastProc()
}

/**
 * 对账挂在引擎消息上（fire-and-forget 的监听器）且带 3s 重试间隔，
 * 每一步都要把定时器跑干净再断言。
 */
async function settle() {
  await vi.runAllTimersAsync()
}

/** 撑满进程池上限，返回全部实例（顺序即启动顺序）。 */
async function fillToCap(pool: ClaudeCodeProcessPool): Promise<FakeSessionProcess[]> {
  for (let i = 0; i < MAX_PROCESSES; i++) {
    await pool.startSession(`sess-${String(i).padStart(2, '0')}`, baseConfig())
  }
  return [...fakeInstances()]
}

/** 捕获同步 throw 的辅助（发送族守卫都是同步接口）。 */
function caught(fn: () => unknown): any {
  try {
    fn()
  } catch (e) {
    return e
  }
  return null
}

beforeEach(() => {
  FakeSessionProcess.instances = []
  FakeSessionProcess.failNextStart = null
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── startSession 生命周期 ────────────────────────────────────────

describe('startSession 生命周期', () => {
  it('运行中的会话直接复用，不再起新进程', async () => {
    const pool = new ClaudeCodeProcessPool()
    const first = await startPool(pool)

    await pool.startSession(SID, baseConfig())

    expect(fakeInstances()).toHaveLength(1)
    expect(first.start).toHaveBeenCalledTimes(1)
  })

  it('挂起的会话转交 resumeSession（保住引擎历史），不新起进程', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool)
    proc.suspend()

    await pool.startSession(SID, baseConfig())

    expect(proc.resume).toHaveBeenCalledTimes(1)
    expect(fakeInstances()).toHaveLength(1)
  })

  it('挂起但没有 engineSessionId 时无法恢复 —— 视为死条目驱逐重来', async () => {
    const pool = new ClaudeCodeProcessPool()
    const stale = await startPool(pool)
    stale.engineSessionId = null
    stale.suspend()

    await pool.startSession(SID, baseConfig())

    expect(fakeInstances()).toHaveLength(2)
    expect(fakeInstances()[0]).not.toBe(fakeInstances()[1])
  })

  it('死条目被驱逐后由全新进程接管', async () => {
    const pool = new ClaudeCodeProcessPool()
    const stale = await startPool(pool)
    stale.kill()

    const fresh = await startPool(pool)

    expect(fresh).not.toBe(stale)
    expect(fakeInstances()).toHaveLength(2)
  })

  it('start 失败时错误原样抛给调用方', async () => {
    const pool = new ClaudeCodeProcessPool()
    FakeSessionProcess.failNextStart = new Error('spawn failed')

    await expect(pool.startSession(SID, baseConfig())).rejects.toThrow('spawn failed')
  })
})

// ── resumeSession 守卫 ───────────────────────────────────────────

describe('resumeSession 守卫', () => {
  it('不存在的会话抛错', async () => {
    const pool = new ClaudeCodeProcessPool()
    await expect(pool.resumeSession('missing')).rejects.toThrow('not found')
  })

  it('非挂起状态（含运行中）抛错', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool)

    await expect(pool.resumeSession(SID)).rejects.toThrow('not suspended')
    expect(proc.resume).not.toHaveBeenCalled()
  })

  it('挂起会话成功恢复，事件处理重新挂接后照常路由', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    const proc = await startPool(pool)
    proc.suspend()

    await pool.resumeSession(SID)

    expect(proc.resume).toHaveBeenCalledTimes(1)
    proc.emit('log', 'hello')
    expect(win.webContents.send).toHaveBeenCalledWith('claude-code:log', {
      sessionId: SID,
      data: 'hello',
    })
  })
})

// ── evictIfNeeded 三级驱逐 ───────────────────────────────────────

describe('evictIfNeeded 三级驱逐', () => {
  it('未达上限时不驱逐任何会话', async () => {
    const pool = new ClaudeCodeProcessPool()
    const procs: FakeSessionProcess[] = []
    for (let i = 0; i < MAX_PROCESSES - 1; i++) {
      await pool.startSession(`sess-${String(i).padStart(2, '0')}`, baseConfig())
      procs.push(lastProc())
    }

    await pool.startSession('sess-new', baseConfig()) // 第 20 个，无需驱逐

    expect(procs.every(p => p.suspend.mock.calls.length === 0)).toBe(true)
  })

  it('达上限：最旧的空闲会话被挂起，并向渲染层发 suspended(eviction)', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    const procs = await fillToCap(pool)
    procs.forEach(p => { p.status = 'idle' })
    procs[3].lastActivityAt = 1 // 最旧

    await pool.startSession('sess-new', baseConfig())

    expect(procs[3].suspend).toHaveBeenCalledTimes(1)
    expect(win.webContents.send).toHaveBeenCalledWith('claude-code:suspended', {
      sessionId: 'sess-03',
      data: { reason: 'eviction' },
    })
  })

  it('idle 优先于 active：即使 active 更旧也不动它', async () => {
    const pool = new ClaudeCodeProcessPool()
    pool.setMainWindow(fakeWindow())
    const procs = await fillToCap(pool)
    procs.forEach(p => { p.status = 'idle' })
    procs[0].status = 'active'   // 唯一的 active
    procs[0].lastActivityAt = 0  // 而且最旧

    await pool.startSession('sess-new', baseConfig())

    expect(procs[0].suspend).not.toHaveBeenCalled()
    expect(procs[1].suspend).toHaveBeenCalledTimes(1) // 最旧的 idle 被驱逐
  })

  it('无安全 idle 时驱逐最旧的安全 active 会话', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    const procs = await fillToCap(pool) // 默认 status=active
    procs[7].lastActivityAt = 1 // 最旧

    await pool.startSession('sess-new', baseConfig())

    expect(procs[7].suspend).toHaveBeenCalledTimes(1)
    expect(win.webContents.send).toHaveBeenCalledWith('claude-code:suspended', {
      sessionId: 'sess-07',
      data: { reason: 'eviction' },
    })
  })

  it('全部不可安全挂起时不强制驱逐，逐个发 eviction_blocked', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    const procs = await fillToCap(pool)
    procs.forEach(p => { p.canSafelySuspend.mockReturnValue(false) })

    await pool.startSession('sess-new', baseConfig())

    expect(procs.every(p => p.suspend.mock.calls.length === 0)).toBe(true)
    const blocked = win.webContents.send.mock.calls.filter(
      ([ch]: [string]) => ch === 'claude-code:eviction_blocked',
    )
    expect(blocked).toHaveLength(MAX_PROCESSES)
    expect(blocked[0][1]).toMatchObject({
      sessionId: 'sess-00',
      data: { reason: 'pending_operations', pendingTools: 0 },
    })
  })
})

// ── 发送族守卫 ───────────────────────────────────────────────────

describe('发送族守卫', () => {
  it('sendMessage 无进程时抛 engineBlockedError（session-not-active）', async () => {
    const pool = new ClaudeCodeProcessPool()
    const err = await pool.sendMessage(SID, 'hi').catch(e => e)

    expect(err.engineBlocked).toMatchObject({
      reason: 'session-not-active',
      context: { engine: 'claude-code', operation: 'sendMessage' },
    })
  })

  it('sendMessage 进程已退出同样抛错', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool)
    proc.kill()

    await expect(pool.sendMessage(SID, 'hi')).rejects.toMatchObject({
      engineBlocked: { reason: 'session-not-active' },
    })
  })

  it('sendMessage 正常路径转发内容与图片', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool)

    await pool.sendMessage(SID, 'hello', [{ id: 'img-1' }])

    expect(proc.sendMessage).toHaveBeenCalledWith('hello', [{ id: 'img-1' }])
  })

  it('submitToolAnswer / skipToolAnswer 无活动进程时抛错', () => {
    const pool = new ClaudeCodeProcessPool()

    expect(caught(() => pool.submitToolAnswer(SID, 't1', { q: 'a' })).engineBlocked)
      .toMatchObject({ reason: 'session-not-active', context: { operation: 'submitToolAnswer' } })
    expect(caught(() => pool.skipToolAnswer(SID, 't1')).engineBlocked)
      .toMatchObject({ reason: 'session-not-active', context: { operation: 'skipToolAnswer' } })
  })

  it('submitToolAnswer / skipToolAnswer 正常路径透传给进程', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool)

    pool.submitToolAnswer(SID, 'tool-1', { q: 'a' })
    pool.skipToolAnswer(SID, 'tool-2')

    expect(proc.submitToolAnswer).toHaveBeenCalledWith('tool-1', { q: 'a' })
    expect(proc.skipToolAnswer).toHaveBeenCalledWith('tool-2')
  })

  it('requireRunning 族无活动进程时抛错并带操作名', () => {
    const pool = new ClaudeCodeProcessPool()
    const ops: Array<[() => unknown, string]> = [
      [() => pool.respondPermission(SID, 'r1', 'allow' as any), 'respondPermission'],
      [() => pool.allowPermission(SID, 'r1'), 'allowPermission'],
      [() => pool.denyPermission(SID, 'r1'), 'denyPermission'],
      [() => pool.setModel(SID, 'opus'), 'setModel'],
      [() => pool.stopTask(SID, 'task-1'), 'stopTask'],
    ]
    for (const [op, name] of ops) {
      expect(caught(op).engineBlocked).toMatchObject({
        reason: 'session-not-active',
        context: { operation: name },
      })
    }
  })

  it('requireRunning 族在活动进程上正常透传', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool)

    pool.respondPermission(SID, 'r1', 'allow' as any)
    pool.allowPermission(SID, 'r2')
    pool.denyPermission(SID, 'r3', 'no', { interrupt: true })
    await pool.setModel(SID, 'opus')
    await pool.stopTask(SID, 'task-1')

    expect(proc.respondPermission).toHaveBeenCalledWith('r1', 'allow')
    expect(proc.allowPermission).toHaveBeenCalledWith('r2', undefined, undefined, undefined)
    expect(proc.denyPermission).toHaveBeenCalledWith('r3', 'no', { interrupt: true })
    expect(proc.setModel).toHaveBeenCalledWith('opus')
    expect(proc.stopTask).toHaveBeenCalledWith('task-1')
  })

  it('getMcpStatus / getContextUsage / getSettings 无活动进程时返回 undefined', async () => {
    const pool = new ClaudeCodeProcessPool()

    expect(await pool.getMcpStatus(SID)).toBeUndefined()
    expect(await pool.getContextUsage(SID)).toBeUndefined()
    expect(await pool.getSettings(SID)).toBeUndefined()
  })

  it('getMcpStatus / getContextUsage / getSettings 活动进程时透传', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool)

    expect(await pool.getMcpStatus(SID)).toEqual({ servers: [] })
    expect(await pool.getContextUsage(SID)).toEqual({ used: 1 })
    expect(await pool.getSettings(SID)).toEqual({})
    expect(proc.getMcpStatus).toHaveBeenCalled()
  })

  it('getPendingPermissionRequestIds：未知会话返回空数组，活动会话透传', async () => {
    const pool = new ClaudeCodeProcessPool()
    expect(pool.getPendingPermissionRequestIds(SID)).toEqual([])

    const proc = await startPool(pool)
    ;(proc.getPendingPermissionRequestIds as any).mockReturnValue(['req-1'])
    expect(pool.getPendingPermissionRequestIds(SID)).toEqual(['req-1'])
  })
})

// ── setPermissionMode ────────────────────────────────────────────

describe('setPermissionMode', () => {
  it('无进程时存为 pending，进程起来后按意图下发并写回启动参数', async () => {
    const pool = new ClaudeCodeProcessPool()

    await pool.setPermissionMode(SID, 'plan') // 此时没有进程

    const proc = await startPool(pool) // 默认 spawn 配置（default）
    await settle()

    expect(proc.setPermissionMode).toHaveBeenCalledWith('plan')
    expect(proc.config.permissionMode).toBe('plan')
    expect(pool.getSessionStatus(SID)?.permissionMode).toBe('plan')
  })

  it('条目存在但已退出：存 pending 并当场同步 currentPermissionMode', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool)
    proc.kill()

    await pool.setPermissionMode(SID, 'plan')

    expect(pool.getSessionStatus(SID)?.permissionMode).toBe('plan')
  })

  it('控制请求被拒时按新模式重启进程（无历史 → kill + start）', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool, SID, { permissionMode: 'plan' })
    proc.engineSessionId = null // 刚 spawn、没有历史可保
    proc.setPermissionMode.mockRejectedValue(new Error('refused: restart required'))

    await pool.setPermissionMode(SID, 'bypassPermissions')

    expect(proc.kill).toHaveBeenCalledTimes(1)
    expect(proc.start).toHaveBeenCalledTimes(2) // 初始 + 重启
    expect(proc.config.permissionMode).toBe('bypassPermissions')
    expect(proc.currentPermissionMode).toBe('bypassPermissions')
  })

  it('重启补救已被同一模式用过时不再重启，错误抛给调用方', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool, SID, { permissionMode: 'plan' })
    // 先制造一次"已按 bypass 重启过"的状态：直接拒绝两次，第一次触发重启，
    // 第二次因 modeRepairTried 命中而失败抛出。
    proc.engineSessionId = null
    proc.setPermissionMode.mockRejectedValue(new Error('refused'))

    await pool.setPermissionMode(SID, 'bypassPermissions') // 第一次：触发重启
    await expect(pool.setPermissionMode(SID, 'bypassPermissions')).rejects.toThrow('refused')

    // 第二次未再重启：start 仍只有 2 次（初始 + 第一次重启）
    expect(proc.start).toHaveBeenCalledTimes(2)
  })
})

// ── 会话收尾 ─────────────────────────────────────────────────────

describe('会话收尾', () => {
  it('killSession：杀进程、摘监听器、清条目', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    const proc = await startPool(pool)

    pool.killSession(SID)

    expect(proc.kill).toHaveBeenCalledTimes(1)
    expect(pool.getSessionStatus(SID)).toBeNull()
    proc.emit('message', { type: 'assistant' }) // 监听器已摘，不再路由
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('killSession 对未知会话是 no-op', () => {
    const pool = new ClaudeCodeProcessPool()
    expect(() => pool.killSession('missing')).not.toThrow()
  })

  it('abortSession 转发 abort；未知会话 no-op', async () => {
    const pool = new ClaudeCodeProcessPool()
    pool.abortSession('missing') // 不抛

    const proc = await startPool(pool)
    pool.abortSession(SID)
    expect(proc.abort).toHaveBeenCalledTimes(1)
  })

  it('suspendSession 转发 suspend；未知会话 no-op', async () => {
    const pool = new ClaudeCodeProcessPool()
    pool.suspendSession('missing') // 不抛

    const proc = await startPool(pool)
    pool.suspendSession(SID)
    expect(proc.suspend).toHaveBeenCalledTimes(1)
  })

  it('killAll：杀掉全部并清空条目与监听器', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    const a = await startPool(pool, 'sess-a')
    const b = await startPool(pool, 'sess-b')

    pool.killAll()

    expect(a.kill).toHaveBeenCalled()
    expect(b.kill).toHaveBeenCalled()
    expect(pool.getActiveSessions()).toEqual([])
    a.emit('message', { type: 'assistant' })
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})

// ── 事件路由 ─────────────────────────────────────────────────────

describe('事件路由', () => {
  it('已知事件类型按 channel 表派发给窗口，payload 为 { sessionId, data }', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    const proc = await startPool(pool)

    proc.emit('message', { type: 'assistant', content: 'x' })

    expect(win.webContents.send).toHaveBeenCalledWith('claude-code:assistant', {
      sessionId: SID,
      data: { type: 'assistant', content: 'x' },
    })
  })

  it('exit 事件携带 code/stderr 原样路由', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    const proc = await startPool(pool)

    proc.emit('exit', { code: 1, stderr: 'boom' })

    expect(win.webContents.send).toHaveBeenCalledWith('claude-code:exit', {
      sessionId: SID,
      data: { code: 1, stderr: 'boom' },
    })
  })

  it('未知事件类型被丢弃并告警，不发送', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    const proc = await startPool(pool)

    proc.emit('message', { type: 'mystery-type' })

    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('窗口已销毁时不发送也不抛错，H5 监听器照常收到', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    win.isDestroyed = () => true
    pool.setMainWindow(win)
    const seen: Array<[string, string]> = []
    pool.onRouteEvent((sid, type) => seen.push([sid, type]))
    const proc = await startPool(pool)

    proc.emit('message', { type: 'assistant' })

    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(seen).toEqual([[SID, 'assistant']])
  })

  it('未设置窗口时事件仍扇出给监听器', async () => {
    const pool = new ClaudeCodeProcessPool() // 无 mainWindow
    const seen: string[] = []
    pool.onRouteEvent((_sid, type) => seen.push(type))
    const proc = await startPool(pool)

    proc.emit('message', { type: 'result' })

    expect(seen).toEqual(['result'])
  })

  it('监听器抛错不影响其他监听器', async () => {
    const pool = new ClaudeCodeProcessPool()
    const ok = vi.fn()
    pool.onRouteEvent(() => { throw new Error('bad listener') })
    pool.onRouteEvent(ok)
    const proc = await startPool(pool)

    proc.emit('message', { type: 'assistant' })

    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('onRouteEvent 返回的退订函数生效', async () => {
    const pool = new ClaudeCodeProcessPool()
    const seen: string[] = []
    const unsub = pool.onRouteEvent((_sid, type) => seen.push(type))
    unsub()
    const proc = await startPool(pool)

    proc.emit('message', { type: 'assistant' })

    expect(seen).toEqual([])
  })

  it('权限对账挂在 init 消息上：引擎回报与意图不一致时对账', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool, SID, { permissionMode: 'plan' })
    proc.setPermissionMode.mockClear()

    proc.emitInit('default') // 引擎不认账

    await settle()
    expect(proc.setPermissionMode).toHaveBeenCalledWith('plan')
    expect(proc.config.permissionMode).toBe('plan')
  })
})

// ── 状态查询 ─────────────────────────────────────────────────────

describe('状态查询', () => {
  it('getSessionStatus：未知会话返回 null，已知会话返回快照', async () => {
    const pool = new ClaudeCodeProcessPool()
    expect(pool.getSessionStatus(SID)).toBeNull()

    const proc = await startPool(pool)
    proc.currentPermissionMode = 'plan'

    expect(pool.getSessionStatus(SID)).toMatchObject({
      sessionId: SID,
      engineSessionId: 'engine-1',
      status: 'active',
      isRunning: true,
      permissionMode: 'plan',
    })
  })

  it('getActiveSessions 列出全部会话', async () => {
    const pool = new ClaudeCodeProcessPool()
    expect(pool.getActiveSessions()).toEqual([])

    await startPool(pool, 'sess-a')
    await startPool(pool, 'sess-b')

    expect(pool.getActiveSessions().map(s => s.sessionId)).toEqual(['sess-a', 'sess-b'])
  })

  it('getEngineSessionId：未知会话返回 null，已知返回引擎会话 id', async () => {
    const pool = new ClaudeCodeProcessPool()
    expect(pool.getEngineSessionId(SID)).toBeNull()

    await startPool(pool)
    expect(pool.getEngineSessionId(SID)).toBe('engine-1')
  })
})
