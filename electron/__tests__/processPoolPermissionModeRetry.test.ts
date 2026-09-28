// @vitest-environment node
/**
 * ProcessPool 权限模式恢复重试逻辑（Linux AppImage 冷启动场景）：
 * CLI 可能超过 setPermissionMode 的 10s 超时窗口才开始消费控制请求，
 * 恢复失败后必须有限重试，避免会话静默停留在 bypass 启动模式。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { isPackaged: false },
}))

vi.mock('../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../session/sessionProcess', () => ({
  SessionProcess: class {
    static instances: any[] = []
    sessionId: string
    config: any
    status = 'active'
    process = { pid: 4321 }
    start = vi.fn().mockResolvedValue(undefined)
    resume = vi.fn().mockResolvedValue(undefined)
    isRunning = vi.fn().mockReturnValue(true)
    canSafelySuspend = vi.fn().mockReturnValue(true)
    lastActivityAt = Date.now()
    setPermissionMode = vi.fn().mockResolvedValue(undefined)
    on = vi.fn()
    removeListener = vi.fn()
    constructor(sessionId: string, config: any) {
      this.sessionId = sessionId
      this.config = config
      ;(this.constructor as any).instances.push(this)
    }
  },
}))

import { ClaudeCodeProcessPool } from '../engine/claudeCodeProcessPool'
import { SessionProcess } from '../session/sessionProcess'

const SID = 'abcdefgh1234'
const TIMEOUT_ERR = new Error("control_request 'set_permission_mode' timed out after 10000ms")

function fakeProc(): any {
  // startSession 内部 new SessionProcess(...)，取回最新实例
  return (SessionProcess as any).instances.at(-1)
}

async function flushRetries() {
  // 覆盖两次 3s 重试间隔，允许期间的所有微任务完成
  await vi.advanceTimersByTimeAsync(3_000)
  await vi.advanceTimersByTimeAsync(3_000)
}

describe('ClaudeCodeProcessPool applyPermissionModeWithRetry', () => {
  let pool: ClaudeCodeProcessPool

  beforeEach(() => {
    vi.useFakeTimers()
    ;(SessionProcess as any).instances = []
    pool = new ClaudeCodeProcessPool()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('startSession: 前两次超时失败、第三次成功 — 共调用 3 次', async () => {
    const started = pool.startSession(SID, { cwd: '/tmp', permissionMode: 'acceptEdits' })
    const proc = fakeProc()
    proc.setPermissionMode
      .mockRejectedValueOnce(TIMEOUT_ERR)
      .mockRejectedValueOnce(TIMEOUT_ERR)
      .mockResolvedValueOnce(undefined)

    await flushRetries()
    await started

    expect(proc.setPermissionMode).toHaveBeenCalledTimes(3)
    expect(proc.setPermissionMode).toHaveBeenLastCalledWith('acceptEdits')
  })

  it('startSession: 全部失败 — 最多尝试 3 次且不抛错', async () => {
    const started = pool.startSession(SID, { cwd: '/tmp', permissionMode: 'acceptEdits' })
    const proc = fakeProc()
    proc.setPermissionMode.mockRejectedValue(TIMEOUT_ERR)

    await flushRetries()
    await expect(started).resolves.toBeUndefined()

    expect(proc.setPermissionMode).toHaveBeenCalledTimes(3)
  })

  it('startSession: 进程退出后立即放弃重试', async () => {
    const started = pool.startSession(SID, { cwd: '/tmp', permissionMode: 'acceptEdits' })
    const proc = fakeProc()
    let running = true
    proc.isRunning = vi.fn(() => running)
    proc.setPermissionMode.mockImplementation(() => {
      running = false
      return Promise.reject(new Error('No active process'))
    })

    await vi.advanceTimersByTimeAsync(10_000)
    await started

    expect(proc.setPermissionMode).toHaveBeenCalledTimes(1)
  })

  it('resumeSession: 恢复后同样走重试路径', async () => {
    const suspended = new (SessionProcess as any)(SID, { cwd: '/tmp', permissionMode: 'acceptEdits' })
    suspended.status = 'suspended'
    suspended.engineSessionId = 'engine-1'
    ;(pool as any).processes.set(SID, suspended)
    suspended.setPermissionMode
      .mockRejectedValueOnce(TIMEOUT_ERR)
      .mockResolvedValueOnce(undefined)

    const resumed = pool.resumeSession(SID)
    await vi.advanceTimersByTimeAsync(3_000)
    await resumed

    expect(suspended.setPermissionMode).toHaveBeenCalledTimes(2)
  })
})
