// @vitest-environment node
/**
 * ProcessPool 的思考开关（issue #40 问题 2）。
 *
 * CLI 没有 set_thinking 控制请求，`--thinking` 只在 spawn 时读一次，所以输入框上的
 * 开关此前对运行中的 Claude 会话完全无效：轮次进行中改的配置，既不会重启进程，也没有
 * 任何回收器会去重启它 —— 下一条消息仍按启动参数跑。
 * 现在的契约：配置当场改掉；空闲立即挂起（下一条消息以新参数恢复），轮次进行中则在本轮
 * result 之后挂起，最迟在下一条消息转发前重启补齐。
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

import { ClaudeCodeProcessPool } from '../claudeCodeProcessPool'
import { FakeSessionProcess } from './fixtures/fakeSessionProcess'

const SID = 'session-aaaaaaaa'

function lastProc(): FakeSessionProcess {
  const list = FakeSessionProcess.instances
  return list[list.length - 1]
}

async function startOne(thinkingEnabled = true) {
  const pool = new ClaudeCodeProcessPool()
  await pool.startSession(SID, {
    cwd: '/repo',
    provider: 'openai',
    model: 'qwen3.8-27b',
    permissionMode: 'default',
    thinkingEnabled,
  } as any)
  return { pool, proc: lastProc() }
}

beforeEach(() => {
  FakeSessionProcess.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('updateThinkingLevel', () => {
  it('改掉会话配置并挂起空闲进程，下一条消息就以新参数起来', async () => {
    const { pool, proc } = await startOne()

    const applied = pool.updateThinkingLevel(SID, false)

    expect(applied).toBe('now')
    expect(proc.config.thinkingEnabled).toBe(false)
    expect(proc.suspend).toHaveBeenCalledTimes(1)
  })

  it('正在跑的一轮不打断：只改配置并回报"下一轮生效"', async () => {
    const { pool, proc } = await startOne()
    proc.canSafelySuspend.mockReturnValue(false)

    const applied = pool.updateThinkingLevel(SID, false)

    expect(applied).toBe('next-turn')
    expect(proc.config.thinkingEnabled).toBe(false)
    expect(proc.suspend).not.toHaveBeenCalled()
  })

  it('进程本来就没起来时只改配置', async () => {
    const { pool, proc } = await startOne()
    proc.isRunning.mockReturnValue(false)

    const applied = pool.updateThinkingLevel(SID, true)

    expect(applied).toBe('now')
    expect(proc.config.thinkingEnabled).toBe(true)
    expect(proc.suspend).not.toHaveBeenCalled()
  })

  it('会话已被回收时不抛错', () => {
    const pool = new ClaudeCodeProcessPool()

    expect(() => pool.updateThinkingLevel('never-seen-session', true)).not.toThrow()
  })
})

describe('轮次结束后补上欠下的重启', () => {
  it('result 一到就挂起，下一条消息以新参数恢复', async () => {
    const { pool, proc } = await startOne()
    proc.canSafelySuspend.mockReturnValue(false)
    pool.updateThinkingLevel(SID, false)
    expect(proc.suspend).not.toHaveBeenCalled()

    // 本轮收口：状态回到 idle，挂起不再有风险
    proc.canSafelySuspend.mockReturnValue(true)
    proc.emitResult()
    await vi.runAllTimersAsync()

    expect(proc.suspend).toHaveBeenCalledTimes(1)
    expect(proc.resume).not.toHaveBeenCalled()

    // 渲染层每条消息前都会先 init：挂起条目在这里被恢复，恢复用的是新配置。
    const forward = vi.fn()
    proc.sendMessage = forward
    await pool.startSession(SID, {
      cwd: '/repo', provider: 'openai', model: 'qwen3.8-27b', permissionMode: 'default', thinkingEnabled: false,
    } as any)
    await vi.runAllTimersAsync()
    await pool.sendMessage(SID, 'next question')

    expect(proc.resume).toHaveBeenCalledTimes(1)
    expect(proc.spawnedThinkingEnabled).toBe(false)
    expect(forward).toHaveBeenCalledWith('next question', undefined)
  })

  it('没等到 result（例如切换发生在轮次之外但进程还热）时，转发前也会先重启', async () => {
    const { pool, proc } = await startOne()
    pool.updateThinkingLevel(SID, false)
    // 上面这次把进程挂起了；换成"挂起没发生"的场景：直接改回热进程
    proc.process = { pid: 1 }
    proc.status = 'idle'
    proc.spawnedThinkingEnabled = true
    proc.suspend.mockClear()
    proc.resume.mockClear()
    const forward = vi.fn()
    proc.sendMessage = forward

    await pool.sendMessage(SID, 'question')
    await vi.runAllTimersAsync()

    expect(proc.resume).toHaveBeenCalledTimes(1)
    expect(proc.spawnedThinkingEnabled).toBe(false)
    expect(forward).toHaveBeenCalledWith('question', undefined)
  })

  it('思考开关没动过时不会因为发消息而重启', async () => {
    const { pool, proc } = await startOne(false)
    const forward = vi.fn()
    proc.sendMessage = forward

    await pool.sendMessage(SID, 'question')
    await vi.runAllTimersAsync()

    expect(proc.resume).not.toHaveBeenCalled()
    expect(forward).toHaveBeenCalledWith('question', undefined)
  })
})
