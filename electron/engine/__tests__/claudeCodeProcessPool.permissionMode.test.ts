// @vitest-environment node
/**
 * ClaudeCodeProcessPool 的权限模式对账（issue #40 问题 1）。
 *
 * 旧设计是"一律以 --dangerously-skip-permissions 起来、再用控制请求切回用户模式"，
 * 于是恢复失败 = 会话静默留在全放行，而启动照样返回成功、消息照转。现在的契约：
 *  - spawn 参数就是意图，正常情况下根本不需要补发控制请求；
 *  - 意图 ≠ spawn 参数（无进程时先切的模式）才补发，且先等控制协议就绪；
 *  - 补发失败就按意图重启进程（--resume 保历史），不做无声放弃；
 *  - 引擎坚持跑在比意图更宽的模式上（bypass）时，转发消息前拦下来。
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

async function startPool(pool: ClaudeCodeProcessPool, config: Record<string, unknown> = {}) {
  await pool.startSession(SID, { cwd: '/repo', provider: 'anthropic', model: 'sonnet', ...config } as any)
  return lastProc()
}

/**
 * 对账与重启都挂在引擎消息上（fire-and-forget 的监听器）且带 3s 重试间隔，
 * 所以每一步都要把定时器跑干净再断言。
 */
async function settle() {
  await vi.runAllTimersAsync()
}

beforeEach(() => {
  FakeSessionProcess.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('spawn 参数即意图', () => {
  it('启动时不补发控制请求 —— 恢复失败不再等于权限失控', async () => {
    const pool = new ClaudeCodeProcessPool()

    const proc = await startPool(pool, { permissionMode: 'plan' })

    expect(proc.setPermissionMode).not.toHaveBeenCalled()
    expect(proc.waitForInit).not.toHaveBeenCalled()
  })

  it('引擎回报与意图一致时同样无需补发', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool, { permissionMode: 'plan' })

    proc.emitInit('plan')
    await settle()

    expect(proc.setPermissionMode).not.toHaveBeenCalled()
    expect(pool.getSessionStatus(SID)?.permissionModeVerified).toBe(true)
  })
})

describe('意图与 spawn 参数不一致（进程不在时先切了模式）', () => {
  it('等控制协议就绪后补发，并把意图写回启动参数', async () => {
    const pool = new ClaudeCodeProcessPool()
    await pool.setPermissionMode(SID, 'plan')

    const proc = await startPool(pool, { permissionMode: 'default' })
    await settle()

    expect(proc.waitForInit).toHaveBeenCalled()
    expect(proc.setPermissionMode).toHaveBeenCalledWith('plan')
    expect(proc.config.permissionMode).toBe('plan')
  })

  it('控制协议未就绪时直接按意图重启，不额外等待三轮权限请求超时', async () => {
    const pool = new ClaudeCodeProcessPool()
    await pool.setPermissionMode(SID, 'plan')
    const started = pool.startSession(SID, {
      cwd: '/repo', provider: 'anthropic', permissionMode: 'default',
    })
    const proc = lastProc()
    proc.engineSessionId = null
    proc.waitForInit.mockResolvedValue(false)

    await started

    expect(proc.setPermissionMode).not.toHaveBeenCalled()
    expect(proc.kill).toHaveBeenCalledTimes(1)
    expect(proc.start).toHaveBeenCalledTimes(2)
    expect(proc.config.permissionMode).toBe('plan')
    await pool.sendMessage(SID, 'hello')
    expect(proc.sendMessage).toHaveBeenCalledWith('hello', undefined)
  })

  it('前两次超时、第三次成功时共下发 3 次（Linux AppImage 冷启动窗口）', async () => {
    const pool = new ClaudeCodeProcessPool()
    await pool.setPermissionMode(SID, 'plan')

    const started = pool.startSession(SID, {
      cwd: '/repo', provider: 'anthropic', model: 'sonnet', permissionMode: 'default',
    } as any)
    const proc = lastProc()
    const timeout = new Error("control_request 'set_permission_mode' timed out after 10000ms")
    proc.setPermissionMode
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(undefined)

    await settle()
    await started

    expect(proc.setPermissionMode).toHaveBeenCalledTimes(3)
    expect(proc.resume).not.toHaveBeenCalled()
  })

  it('补发全部失败时按意图重启进程，而不是无声留在原模式', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool, { permissionMode: 'default' })
    proc.setPermissionMode.mockRejectedValue(new Error("control_request 'set_permission_mode' timed out after 10000ms"))

    await pool.setPermissionMode(SID, 'plan')
    await settle()

    expect(proc.config.permissionMode).toBe('plan')
    expect(proc.resume.mock.calls.length + proc.start.mock.calls.length).toBeGreaterThan(0)
  })

  it('进程已退出时立即放弃，不再空等三轮', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool, { permissionMode: 'default' })
    proc.setPermissionMode.mockImplementation(() => {
      proc.process = null
      return Promise.reject(new Error('No active process'))
    })

    await pool.setPermissionMode(SID, 'plan')
    await settle()

    expect(proc.setPermissionMode).toHaveBeenCalledTimes(1)
  })
})

describe('引擎回报与意图冲突', () => {
  it('回报 bypass 而意图是 plan：先对账，对账不成则重启', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool, { permissionMode: 'plan' })
    proc.setPermissionMode.mockRejectedValue(new Error('engine refuses mode switch'))

    proc.emitInit('bypassPermissions')
    await settle()

    expect(proc.setPermissionMode).toHaveBeenCalledWith('plan')
    expect(proc.resume).toHaveBeenCalled()
  })

  it('同一个模式只重启补救一次，不会无限重启', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool, { permissionMode: 'plan' })
    proc.setPermissionMode.mockRejectedValue(new Error('engine refuses mode switch'))

    proc.emitInit('bypassPermissions')
    await settle()
    const resumesAfterFirstRepair = proc.resume.mock.calls.length

    proc.emitInit('bypassPermissions')
    await settle()

    expect(proc.resume.mock.calls.length).toBe(resumesAfterFirstRepair)
  })

  it('引擎比意图更保守（意图 bypass、回报 default）不算危险，消息照发', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await startPool(pool, { permissionMode: 'bypassPermissions' })
    proc.setPermissionMode.mockRejectedValue(new Error('engine refuses mode switch'))

    proc.emitInit('default')
    await settle()
    const forward = vi.fn()
    proc.sendMessage = forward

    await pool.sendMessage(SID, 'hello')
    await settle()

    expect(forward).toHaveBeenCalledWith('hello', undefined)
  })
})

describe('危险偏差下阻断发送', () => {
  /** 走完整条自愈链：控制请求被拒 → 重启补救一次 → 重启后引擎仍回报 bypass。 */
  async function stuckInBypass(pool: ClaudeCodeProcessPool) {
    const proc = await startPool(pool, { permissionMode: 'plan' })
    proc.setPermissionMode.mockRejectedValue(new Error('engine refuses mode switch'))
    proc.emitInit('bypassPermissions')
    await settle()
    // 重启后的新进程再次回报同样的偏差（此时该模式的重启配额已用完）。
    proc.emitInit('bypassPermissions')
    await settle()
    return proc
  }

  it('引擎仍在 bypass、意图是 plan：消息不转发，并把失败抛给调用方', async () => {
    const pool = new ClaudeCodeProcessPool()
    const proc = await stuckInBypass(pool)
    const forward = vi.fn()
    proc.sendMessage = forward

    // 先挂上断言再跑定时器，否则拒绝回调晚一步才注册，Node 会报未处理的 Promise。
    const rejected = expect(pool.sendMessage(SID, 'write the file')).rejects.toThrow(/permission mode not applied/)
    await settle()

    await rejected
    expect(forward).not.toHaveBeenCalled()
  })

  it('阻断时向渲染层发 error 事件，携带 reason code 与结构化上下文', async () => {
    const pool = new ClaudeCodeProcessPool()
    const routed: Array<{ channel: string; payload: any }> = []
    const send = vi.fn((channel: string, payload: any) => routed.push({ channel, payload }))
    pool.setMainWindow({ isDestroyed: () => false, webContents: { send } } as any)
    await stuckInBypass(pool)

    const rejected = expect(pool.sendMessage(SID, 'hi')).rejects.toThrow()
    await settle()

    await rejected
    const errorEvent = routed.find(entry => entry.channel === 'claude-code:error')
    expect(errorEvent).toBeDefined()
    expect(errorEvent!.payload.data).toMatchObject({
      reason: 'permission-mode-not-applied',
      context: { engine: 'claude-code', intent: 'plan', reported: 'bypassPermissions' },
    })
    // 事件里不再有整句英文；detail 只作为排查信息存在。
    expect(errorEvent!.payload.data).not.toHaveProperty('message')
    expect(String(errorEvent!.payload.data.detail)).toMatch(/permission mode not applied/)
  })
})
