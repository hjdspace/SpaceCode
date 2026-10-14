// @vitest-environment node
/**
 * ProcessPool 的思考开关 —— issue #40 问题 2 的后半段。
 *
 * CLI 没有 set_thinking 控制请求，`--thinking` 只在 spawn 时读一次，所以输入框上的
 * 开关此前对运行中的 Claude 会话完全无效（IPC 处理只在 Pi 引擎分支里动作）。
 * 现在的契约：配置当场改掉（进程下次起来就用新值），空闲时立刻挂起让下一条消息以新
 * 参数恢复，而正在跑的那一轮不能被打断。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { isPackaged: false },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../session/sessionProcess', () => {
  class FakeSessionProcess {
    static instances: any[] = []
    sessionId: string
    config: any
    status = 'active'
    process = { pid: 4321 }
    lastActivityAt = Date.now()
    start = vi.fn().mockResolvedValue(undefined)
    resume = vi.fn().mockResolvedValue(undefined)
    isRunning = vi.fn().mockReturnValue(true)
    canSafelySuspend = vi.fn().mockReturnValue(true)
    getPendingToolCount = vi.fn().mockReturnValue(0)
    suspend = vi.fn()
    on = vi.fn()
    removeListener = vi.fn()

    constructor(sessionId: string, config: any) {
      this.sessionId = sessionId
      this.config = config
      ;(this.constructor as any).instances.push(this)
    }
  }
  return { SessionProcess: FakeSessionProcess }
})

import { ClaudeCodeProcessPool } from '../claudeCodeProcessPool'
import { SessionProcess } from '../../session/sessionProcess'

const SID = 'session-aaaaaaaa'

function lastProcess(): any {
  const instances = (SessionProcess as unknown as { instances: any[] }).instances
  return instances[instances.length - 1]
}

async function startOne() {
  const pool = new ClaudeCodeProcessPool()
  await pool.startSession(SID, {
    cwd: '/repo',
    provider: 'openai',
    model: 'qwen3.8-27b',
    thinkingEnabled: true,
  } as any)
  return { pool, proc: lastProcess() }
}

beforeEach(() => {
  ;(SessionProcess as unknown as { instances: any[] }).instances = []
})

describe('updateThinkingLevel', () => {
  it('改掉会话配置并挂起空闲进程，下一条消息就以新参数起来', async () => {
    const { pool, proc } = await startOne()

    pool.updateThinkingLevel(SID, false)

    expect(proc.config.thinkingEnabled).toBe(false)
    expect(proc.suspend).toHaveBeenCalledTimes(1)
  })

  it('正在跑的一轮不打断：只改配置，先不挂起', async () => {
    const { pool, proc } = await startOne()
    proc.canSafelySuspend.mockReturnValue(false)

    pool.updateThinkingLevel(SID, false)

    expect(proc.config.thinkingEnabled).toBe(false)
    expect(proc.suspend).not.toHaveBeenCalled()
  })

  it('进程本来就没起来时只改配置', async () => {
    const { pool, proc } = await startOne()
    proc.isRunning.mockReturnValue(false)

    pool.updateThinkingLevel(SID, true)

    expect(proc.config.thinkingEnabled).toBe(true)
    expect(proc.suspend).not.toHaveBeenCalled()
  })

  it('会话已被回收时不抛错', () => {
    const pool = new ClaudeCodeProcessPool()

    expect(() => pool.updateThinkingLevel('never-seen-session', true)).not.toThrow()
  })
})
