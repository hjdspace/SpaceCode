/**
 * ClaudeCodeProcessPool 测试用的 SessionProcess 替身。
 *
 * 只实现池真正依赖的那几个成员（start/resume/suspend/kill、setPermissionMode、
 * waitForInit、挂起安全性判定），并把 on('message') 的监听器留成可由测试主动触发的
 * emit —— 权限模式与思考开关的生效时机都挂在引擎消息上（system/init、result），
 * 没有这个入口就测不到。
 *
 * 真身的 spawn 参数（--permission-mode / --dangerously-skip-permissions / --thinking）
 * 由 sessionProcess.buildArgs 的测试单独覆盖，这里只模拟"进程侧"的行为。
 */
import { vi } from 'vitest'

export type FakeMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'

export class FakeSessionProcess {
  static instances: FakeSessionProcess[] = []

  sessionId: string
  config: Record<string, unknown>
  status = 'idle'
  process: { pid: number } | null = { pid: 4321 }
  engineSessionId: string | null = 'engine-1'
  lastActivityAt = Date.now()
  currentPermissionMode: FakeMode = 'default'
  reportedPermissionMode: FakeMode | null = null
  permissionModeVerified: boolean | null = null
  spawnedThinkingEnabled?: boolean
  spawnedEffortLevel?: string

  /** 下一次 start() 直接抛这个错误（模拟 spawn 失败），用后即清。 */
  static failNextStart: Error | null = null
  start = vi.fn(async () => {
    if (FakeSessionProcess.failNextStart) {
      const err = FakeSessionProcess.failNextStart
      FakeSessionProcess.failNextStart = null
      // 对齐真身：spawn 失败时 process 不会赋值，条目是"死"的
      this.process = null
      this.status = 'exited'
      throw err
    }
    this.onStarted()
  })
  resume = vi.fn(async () => { this.onStarted() })
  suspend = vi.fn(() => {
    this.status = 'suspended'
    this.process = null
  })
  kill = vi.fn(() => {
    this.status = 'exited'
    this.process = null
  })
  isRunning = vi.fn(() => this.process !== null)
  canSafelySuspend = vi.fn(() => true)
  getPendingToolCount = vi.fn(() => 0)
  waitForInit = vi.fn(async () => true)
  /** 测试通常把它换成 spy，检查"该不该转发这条消息"。 */
  sendMessage: (content: string, images?: any[]) => void = vi.fn()
  setPermissionMode = vi.fn(async (mode: FakeMode) => {
    this.currentPermissionMode = mode
  })

  // ── 池的其余依赖面（生命周期测试用到，均为无副作用替身）──────
  abort = vi.fn()
  submitToolAnswer = vi.fn()
  skipToolAnswer = vi.fn()
  respondPermission = vi.fn()
  allowPermission = vi.fn()
  denyPermission = vi.fn()
  setModel = vi.fn(async () => {})
  stopTask = vi.fn(async () => {})
  getMcpStatus = vi.fn(async () => ({ servers: [] }))
  getContextUsage = vi.fn(async () => ({ used: 1 }))
  getSettings = vi.fn(async () => ({}))
  getPendingPermissionRequestIds = vi.fn(() => [] as string[])

  private listeners = new Map<string, Array<(data: any) => void>>()

  constructor(sessionId: string, config: Record<string, unknown>) {
    this.sessionId = sessionId
    this.config = config
    this.currentPermissionMode = (config.permissionMode as FakeMode) ?? 'default'
    FakeSessionProcess.instances.push(this)
  }

  on(event: string, handler: (data: any) => void) {
    const list = this.listeners.get(event) ?? []
    list.push(handler)
    this.listeners.set(event, list)
  }

  removeListener(event: string, handler: (data: any) => void) {
    const list = this.listeners.get(event) ?? []
    this.listeners.set(event, list.filter(h => h !== handler))
  }

  /** 最近一次挂上监听器的进程（池复用同一实例，attach/detach 成对出现）。 */
  emit(event: string, data?: any) {
    for (const handler of this.listeners.get(event) ?? []) handler(data)
  }

  /** 模拟一轮回答收口：真身在这之前就把 status/isProcessing 改好了。 */
  emitResult() {
    this.status = 'idle'
    this.emit('message', { type: 'result' })
  }

  /** 模拟引擎在 system/init 里回报它自己认定的权限模式。 */
  emitInit(mode: FakeMode) {
    this.reportedPermissionMode = mode
    this.permissionModeVerified = mode === this.currentPermissionMode
    this.emit('message', { type: 'system', subtype: 'init', session_id: this.engineSessionId, permissionMode: mode })
  }

  private onStarted() {
    this.process = { pid: 4321 }
    this.status = 'active'
    this.spawnedThinkingEnabled = this.config.thinkingEnabled as boolean | undefined
    this.spawnedEffortLevel = this.config.effortLevel as string | undefined
    this.reportedPermissionMode = null
    this.permissionModeVerified = null
    // 真身 spawn 参数即意图，回报也就按意图；测试可用 emitInit 覆盖成"引擎不认账"。
    this.currentPermissionMode = (this.config.permissionMode as FakeMode) ?? 'default'
  }
}

export function fakeInstances() {
  return FakeSessionProcess.instances
}

export function lastFake(): FakeSessionProcess {
  const list = FakeSessionProcess.instances
  return list[list.length - 1]
}
