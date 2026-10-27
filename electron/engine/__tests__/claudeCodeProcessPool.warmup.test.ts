// @vitest-environment node
/**
 * 预热相关的池行为测试（TTFT 优化方案 ②）：
 *  - startSession 的 per-session single-flight：预热未完成时用户发送，
 *    两侧共享同一个在飞 spawn，不再 double-spawn；
 *  - 配置不同的并发 startSession：等在飞 spawn 落地后按新配置重起（防指纹错配）；
 *  - warmed 会话的空闲回收：超时无用户消息 → 挂起 + 路由 suspended 事件；
 *    发送过消息 / 非 warmed 的会话不回收。
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

import { ClaudeCodeProcessPool, WARM_IDLE_RECYCLE_MS } from '../claudeCodeProcessPool'
import { FakeSessionProcess, fakeInstances } from './fixtures/fakeSessionProcess'

const SID = 'session-aaaaaaaa'

function baseConfig(extra: Record<string, unknown> = {}) {
  return { cwd: '/repo', provider: 'anthropic', model: 'sonnet', ...extra } as any
}

function fakeWindow() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } } as any
}

beforeEach(() => {
  FakeSessionProcess.instances = []
  FakeSessionProcess.failNextStart = null
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── startSession single-flight ────────────────────────────────────

describe('startSession single-flight', () => {
  it('同配置并发启动共享在飞 spawn —— 只拉一个进程，不再 double-spawn', async () => {
    const pool = new ClaudeCodeProcessPool()
    // 不 await：第一次调用挂在 await proc.start() 上，注册条目后返回
    const p1 = pool.startSession(SID, baseConfig())
    const p2 = pool.startSession(SID, baseConfig())

    await Promise.all([p1, p2])

    const instances = fakeInstances()
    expect(instances).toHaveLength(1)
    expect(instances[0].start).toHaveBeenCalledTimes(1)
    // 两侧都拿到运行中的进程
    expect(pool.getSessionStatus(SID)?.isRunning).toBe(true)
  })

  it('配置不同的并发启动：等在飞 spawn 落地后 kill 重起，进程最终跑在新配置上', async () => {
    const pool = new ClaudeCodeProcessPool()
    const p1 = pool.startSession(SID, baseConfig())
    const p2 = pool.startSession(SID, baseConfig({ model: 'opus' }))

    await Promise.all([p1, p2])

    const [first, second] = fakeInstances()
    expect(fakeInstances()).toHaveLength(2)
    // 旧配置的进程被杀掉，新进程带新配置
    expect(first.kill).toHaveBeenCalled()
    expect(second.config.model).toBe('opus')
    expect(second.isRunning()).toBe(true)
    // 旧进程条目被新进程替换
    expect(pool.getSessionStatus(SID)?.isRunning).toBe(true)
  })

  it('resumeSessionId / warmed 不参与配置等价判定 —— 带 resume 参数的预热可被无 resume 的发送共享', async () => {
    const pool = new ClaudeCodeProcessPool()
    const p1 = pool.startSession(SID, baseConfig({ resumeSessionId: 'engine-9', warmed: true }))
    const p2 = pool.startSession(SID, baseConfig())

    await Promise.all([p1, p2])

    expect(fakeInstances()).toHaveLength(1)
    expect(fakeInstances()[0].start).toHaveBeenCalledTimes(1)
  })

  it('在飞 spawn 失败后，共享它的调用方一起收到错误；再次发起的启动在干净条目上重试成功', async () => {
    const pool = new ClaudeCodeProcessPool()
    FakeSessionProcess.failNextStart = new Error('spawn failed')
    const p1 = pool.startSession(SID, baseConfig()).catch(e => e)
    const p2 = pool.startSession(SID, baseConfig()).catch(e => e)

    const [r1, r2] = await Promise.all([p1, p2])

    // 同配置共享在飞 promise：失败也一起承担（渲染层 init single-flight 会负责重发起）
    expect(r1).toBeInstanceOf(Error)
    expect(r2).toBeInstanceOf(Error)
    // 失败留下的死条目被驱逐，重试成功
    await pool.startSession(SID, baseConfig())
    expect(pool.getSessionStatus(SID)?.isRunning).toBe(true)
    expect(fakeInstances()).toHaveLength(2)
  })
})

// ── warmed 会话的空闲回收 ─────────────────────────────────────────

describe('warmed 会话空闲回收', () => {
  it('warmed 会话超时未收到用户消息 → 挂起回收并路由 suspended 事件', async () => {
    const pool = new ClaudeCodeProcessPool()
    const win = fakeWindow()
    pool.setMainWindow(win)
    await pool.startSession(SID, baseConfig({ warmed: true }))
    const proc = fakeInstances()[0]
    // 事件处理注册在 message 上；挂起事件走 routeEvent → webContents.send
    expect(proc.suspend).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(WARM_IDLE_RECYCLE_MS + 1_000)

    expect(proc.suspend).toHaveBeenCalledTimes(1)
    expect(proc.status).toBe('suspended')
    const calls = win.webContents.send.mock.calls.filter(([ch]: [string, unknown]) => String(ch).includes('suspended'))
    expect(calls.length).toBeGreaterThan(0)
    // routeEvent 发送形如 { sessionId, data }
    expect(calls[calls.length - 1][1]).toMatchObject({ data: { reason: 'idle-recycle' } })
    // 挂起后条目保留（engineSessionId 在），后续发送可 resume
    const status = pool.getSessionStatus(SID)
    expect(status?.status).toBe('suspended')
    expect(status?.engineSessionId).toBe('engine-1')
  })

  it('用户发送过消息后，warmed 标记作废 —— 超时也不再回收', async () => {
    const pool = new ClaudeCodeProcessPool()
    await pool.startSession(SID, baseConfig({ warmed: true }))
    const proc = fakeInstances()[0]

    await pool.sendMessage(SID, 'hello')
    await vi.advanceTimersByTimeAsync(WARM_IDLE_RECYCLE_MS + 10_000)

    expect(proc.suspend).not.toHaveBeenCalled()
    expect(pool.getSessionStatus(SID)?.isRunning).toBe(true)
  })

  it('非 warmed 启动的会话不参与空闲回收', async () => {
    const pool = new ClaudeCodeProcessPool()
    await pool.startSession(SID, baseConfig())
    const proc = fakeInstances()[0]

    await vi.advanceTimersByTimeAsync(WARM_IDLE_RECYCLE_MS + 10_000)

    expect(proc.suspend).not.toHaveBeenCalled()
  })

  it('warmed 会话自己退出后，回收 sweep 清掉标记并停表', async () => {
    const pool = new ClaudeCodeProcessPool()
    await pool.startSession(SID, baseConfig({ warmed: true }))
    const proc = fakeInstances()[0]

    // 模拟进程自行退出（exit handler 会清 warmed 标记）
    proc.emit('exit', { code: 0 })
    const timerCountBefore = vi.getTimerCount()
    await vi.advanceTimersByTimeAsync(WARM_IDLE_RECYCLE_MS + 10_000)

    expect(proc.suspend).not.toHaveBeenCalled()
    // sweep 结束后没有剩余的回收定时器
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timerCountBefore)
  })
})
