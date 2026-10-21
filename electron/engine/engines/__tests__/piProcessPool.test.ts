// @vitest-environment node
/**
 * PiProcessPool 生命周期与事件路由。
 *
 * 进程池是 Pi 引擎会话的持有者：startSession 按四态路由（运行中复用 / suspended
 * 复活 / 死条目驱逐重建 / 新建），达到 MAX_PROCESSES 时按「最老优先、先 idle 后
 * active、canSafelySuspend 门槛」的阶梯挂起驱逐；引擎事件经 mapPiEvent 归一化后
 * 派发给 mainWindow（channel 表动态反查）与 routeEventListeners（H5 Server 订阅）。
 *
 * Pinned here:
 *   - 四态路由各自的实例化/handler 绑定副作用，含 start 失败的清理与 rethrow
 *   - 历史接续：pi 会话文件按 SpaceCode sessionId 查/写（进程只活一轮，映射必须落盘），
 *     以及「死条目重建时旧实例的认知优先于磁盘记录」
 *   - 驱逐阶梯的候选过滤（isRunning / canSafelySuspend）与 lastActivityAt 排序
 *   - routeEvent 的丢弃路径（mapPiEvent null、channel 表未命中、窗口缺失）与
 *     监听器隔离（单 listener 抛错不影响其余）
 *   - 控制面（sendMessage/abort/suspend/resume/kill）的前置校验与转发
 *
 * mapPiEvent 用 mock 注入归一化结果：真实实现产不出合成事件类型，channel 表
 * 未命中分支必须靠它触发。channel 表用真实实现（eventChannelsBySuffix），期望
 * channel 名在测试内同函数派生，真实表改名时测试自适应。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import { eventChannelsBySuffix } from '@/shared/channelMap'
import { parseEngineBlockedError } from '@/shared/engineErrors'
import type { EngineSessionConfig, ImageAttachment } from '../types'
import { MAX_PROCESSES, PiProcessPool } from '../PiProcessPool'
import { PiSessionProcess } from '../PiSessionProcess'
import { mapPiEvent } from '../PiEventMapper'
import { warn as loggerWarn } from '../../../infra/logger'

const CHANNEL_BY_SUFFIX = eventChannelsBySuffix(claudeCodeNamespace.events, 'claude-code:')

const CFG: EngineSessionConfig = { cwd: '/workspace' }

const IMG: ImageAttachment = {
  id: 'i1',
  name: 'a.png',
  type: 'image',
  mimeType: 'image/png',
  previewUrl: '',
  data: 'AAA',
}

const H = vi.hoisted(() => {
  const state = {
    mapped: null as { type: string; data: unknown } | null,
    /** #45：池只问「扩展在不在盘上」，装不上时不得谎报 plan 已生效 */
    planModeExtensionPath: null as string | null,
  }

  class FakePiProcess {
    static instances: FakePiProcess[] = []
    static nextStartError: Error | null = null
    static nextResumeError: Error | null = null
    /** 非空 = 「get_state 问到了会话文件」，空 = 引擎没答上 */
    static nextCapturedSessionFile: string | null = null

    sessionId: string
    config: unknown
    /** 构造时注入的 pi 会话文件（池从历史记录里查出来的） */
    resumeSessionFile: string | undefined
    /** 进程当前绑定的 pi 会话文件；captureSessionFile 模拟「问到了」 */
    sessionFile: string | null = null
    // 池代码分别读取 isRunning() 与 status，二者解耦以便独立驱动各分支；
    // 但挂起模拟真实语义：isRunning 变 false（否则 startSession 走复用分支）
    status: 'idle' | 'active' | 'suspended' | 'exited' = 'idle'
    running = true
    lastActivityAt = 1000
    /** 进程解析到的 pi 版本 —— 池要把它带到 EngineSessionStatus 上，界面才不至于空口声称能力可用 (#52) */
    engineVersion: string | null = '1.3.0'
    engineVersionCompatible: boolean | null = true
    /** #45：这两个字段是池判定「plan 到底生效没有」的唯一依据，扩展没装上下次就再重启也白搭 */
    planModeExtensionLoaded = false
    planModeActive: boolean | null = null
    /** #46：所选 agent 有没有落到这次 spawn 上，由进程报给池再报给界面 */
    agentApplied: boolean | null = null
    /** #46：子代理扩展（委派能力）这次随 spawn 装没装进来 */
    subagentsExtensionLoaded = false

    /** setPlanMode 的回执：'confirmed' 返回 true 并把 planModeActive 置上；'refused' 返回 false；'throw' 抛错 */
    static nextSetPlanMode: 'confirmed' | 'refused' | 'throw' = 'confirmed'

    setPlanMode = vi.fn(async (active: boolean) => {
      if (FakePiProcess.nextSetPlanMode === 'throw') throw new Error('no running process')
      if (FakePiProcess.nextSetPlanMode === 'refused') return false
      this.planModeActive = active
      return true
    })

    handlers = new Map<string, Set<(...args: any[]) => void>>()

    start = vi.fn(async () => {
      if (FakePiProcess.nextStartError) throw FakePiProcess.nextStartError
      this.running = true
      this.status = 'idle'
      this.refreshPlanModeExtension()
    })
    resume = vi.fn(async () => {
      if (FakePiProcess.nextResumeError) throw FakePiProcess.nextResumeError
      this.running = true
      this.status = 'idle'
      this.refreshPlanModeExtension()
    })
    /**
     * 真实进程在 buildArgs 里按「意图是 plan 且扩展在盘上」决定这次 spawn 带不带扩展，
     * fake 用同一个口径 —— 池的重启分支全靠这个标志位走 (issue #45)。
     */
    refreshPlanModeExtension() {
      this.planModeExtensionLoaded =
        (this.config as EngineSessionConfig).permissionMode === 'plan' && H.state.planModeExtensionPath !== null
    }
    suspend = vi.fn(() => {
      this.status = 'suspended'
      this.running = false
    })
    kill = vi.fn(() => {
      this.running = false
    })
    abort = vi.fn()
    /** #54：池把用户的应答转交给持有这条 stdin 的进程 */
    respondExtensionDialog = vi.fn()
    cancelPendingExtensionDialogs = vi.fn()
    sendMessage = vi.fn(async () => {})
    isRunning = vi.fn(() => this.running)
    canSafelySuspend = vi.fn(() => true)
    getPendingToolCount = vi.fn(() => 0)
    getPiSessionFile = vi.fn(() => this.sessionFile)
    captureSessionFile = vi.fn(async () => {
      if (FakePiProcess.nextCapturedSessionFile) this.sessionFile = FakePiProcess.nextCapturedSessionFile
    })
    on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      const set = this.handlers.get(event) ?? new Set()
      set.add(handler)
      this.handlers.set(event, set)
    })
    removeListener = vi.fn((event: string, handler: (...args: any[]) => void) => {
      this.handlers.get(event)?.delete(handler)
    })

    constructor(sessionId: string, config: unknown, resumeSessionFile?: string) {
      this.sessionId = sessionId
      this.config = config
      this.resumeSessionFile = resumeSessionFile
      this.sessionFile = resumeSessionFile ?? null
      FakePiProcess.instances.push(this)
    }

    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.forEach(handler => handler(...args))
    }
  }

  return {
    FakePiProcess,
    state,
    mapPiEvent: vi.fn((_sessionId: string, _raw: unknown) => state.mapped),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    findPiSessionFile: vi.fn((): string | null => null),
    rememberPiSessionFile: vi.fn(),
    resolvePlanModeExtensionPath: vi.fn((): string | null => state.planModeExtensionPath),
  }
})

vi.mock('electron', () => ({ BrowserWindow: class {} }))

vi.mock('../PiSessionProcess', () => ({ PiSessionProcess: H.FakePiProcess }))

vi.mock('../piSessionRegistry', () => ({
  findPiSessionFile: H.findPiSessionFile,
  rememberPiSessionFile: H.rememberPiSessionFile,
}))

vi.mock('../PiEventMapper', async (importOriginal) => ({
  ...(await importOriginal()),
  mapPiEvent: H.mapPiEvent,
}))

vi.mock('../piPlanModeExtension', () => ({
  resolvePlanModeExtensionPath: H.resolvePlanModeExtensionPath,
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(),
  warn: H.loggerWarn,
  error: H.loggerError,
  debug: vi.fn(),
}))

const FakePiProcess = PiSessionProcess as unknown as typeof H.FakePiProcess
type FakePiProcessInstance = InstanceType<typeof H.FakePiProcess>

function makeWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  }
}

function makePool({ withWindow = true } = {}) {
  const pool = new PiProcessPool()
  const win = withWindow ? makeWindow() : null
  if (win) pool.setMainWindow(win as any)
  return { pool, win }
}

async function seedSessions(pool: PiProcessPool, count: number): Promise<FakePiProcessInstance[]> {
  const procs: FakePiProcessInstance[] = []
  for (let i = 0; i < count; i++) {
    await pool.startSession(`seed-${i}`, CFG)
    procs.push(FakePiProcess.instances[FakePiProcess.instances.length - 1])
    procs[i].lastActivityAt = i * 10
  }
  return procs
}

beforeEach(() => {
  vi.resetAllMocks()
  H.state.mapped = null
  H.state.planModeExtensionPath = null
  FakePiProcess.nextSetPlanMode = 'confirmed'
  FakePiProcess.instances = []
  FakePiProcess.nextStartError = null
  FakePiProcess.nextResumeError = null
  FakePiProcess.nextCapturedSessionFile = null
})

describe('startSession 四态路由', () => {
  it('无条目时新建进程：实例化、config 透传、挂四个事件 handler、调用 start', async () => {
    const { pool } = makePool()

    await pool.startSession('s1', CFG)

    expect(FakePiProcess.instances).toHaveLength(1)
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance
    expect(proc.sessionId).toBe('s1')
    expect(proc.config).toBe(CFG)
    expect(proc.start).toHaveBeenCalledTimes(1)
    // 第四个是 extension_dialog_closed：对话框退场由宿主记账产生，不走 message (#54)
    expect([...proc.handlers.keys()].sort()).toEqual(['error', 'exit', 'extension_dialog_closed', 'message'])
    expect(proc.handlers.get('message')!.size).toBe(1)
  })

  it('运行中会话再次 startSession 直接复用，不新建进程', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)

    await pool.startSession('seed-0', CFG)

    expect(FakePiProcess.instances).toHaveLength(1)
    expect(proc.start).toHaveBeenCalledTimes(1)
  })

  it('suspended 会话走 resume 路径且 handler 无重复注册', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    proc.status = 'suspended'
    proc.running = false

    await pool.startSession('seed-0', CFG)

    expect(FakePiProcess.instances).toHaveLength(1)
    expect(proc.resume).toHaveBeenCalledTimes(1)
    expect(proc.start).toHaveBeenCalledTimes(1)
    for (const event of ['message', 'exit', 'error']) {
      expect(proc.handlers.get(event)!.size).toBe(1)
    }
  })

  it('死亡条目被驱逐重建：旧 handler 解绑、旧进程不被 kill', async () => {
    const { pool } = makePool()
    const [dead] = await seedSessions(pool, 1)
    dead.running = false
    dead.status = 'exited'

    await pool.startSession('seed-0', CFG)

    expect(FakePiProcess.instances).toHaveLength(2)
    expect(dead.removeListener).toHaveBeenCalledTimes(4)
    expect(dead.kill).not.toHaveBeenCalled()
    const fresh = pool.getProcess('seed-0')!
    expect(fresh).not.toBe(dead)
    expect(fresh.start).toHaveBeenCalledTimes(1)
  })

  it('start 失败时解绑 handler、移除条目并向上抛错', async () => {
    const { pool } = makePool()
    FakePiProcess.nextStartError = new Error('boom')

    await expect(pool.startSession('s1', CFG)).rejects.toThrow('boom')

    expect(pool.getProcess('s1')).toBeUndefined()
    expect(FakePiProcess.instances[0].removeListener).toHaveBeenCalledTimes(4)
  })
})

describe('Pi 历史接续：会话文件映射', () => {
  const PI_FILE = '/home/u/.pi/agent/sessions/--workspace--/2026-10-18T12-55-29-647Z_abc.jsonl'
  // 刚起来的探测要等得过 pi 装载扩展与模型表那十几秒
  const PROBE_TIMEOUT = 30_000

  it('查到历史记录时把它交给新进程，并补写回磁盘以免下次重启再丢', async () => {
    H.findPiSessionFile.mockReturnValue(PI_FILE)
    const { pool } = makePool()

    await pool.startSession('s1', CFG)

    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance
    expect(proc.resumeSessionFile).toBe(PI_FILE)
    // 文件已在手，不必再问引擎一次
    expect(proc.captureSessionFile).not.toHaveBeenCalled()
    expect(H.rememberPiSessionFile).toHaveBeenCalledWith('s1', PI_FILE, '/workspace')
  })

  it('无历史记录的新会话起进程后探测一次，问到才落盘', async () => {
    FakePiProcess.nextCapturedSessionFile = PI_FILE
    const { pool } = makePool()

    await pool.startSession('s1', CFG)

    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance
    expect(proc.resumeSessionFile).toBeUndefined()
    expect(proc.captureSessionFile).toHaveBeenCalledWith(PROBE_TIMEOUT)
    expect(H.rememberPiSessionFile).toHaveBeenCalledWith('s1', PI_FILE, '/workspace')
  })

  it('探测没问到文件时不落盘', async () => {
    const { pool } = makePool()

    await pool.startSession('s1', CFG)

    expect(H.rememberPiSessionFile).not.toHaveBeenCalled()
  })

  it('prompt 被 ack 后补探测一次 —— 起进程那趟可能赶在引擎活过来之前就超时了', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    FakePiProcess.nextCapturedSessionFile = PI_FILE

    await pool.sendMessage('seed-0', 'hi')

    expect(proc.captureSessionFile).toHaveBeenLastCalledWith(PROBE_TIMEOUT)
    expect(H.rememberPiSessionFile).toHaveBeenCalledWith('seed-0', PI_FILE, '/workspace')
  })

  it('死条目重建时优先带旧实例已知的文件，不再查磁盘', async () => {
    const { pool } = makePool()
    const [dead] = await seedSessions(pool, 1)
    dead.sessionFile = PI_FILE
    dead.running = false
    dead.status = 'exited'
    H.findPiSessionFile.mockClear()

    await pool.startSession('seed-0', CFG)

    const fresh = pool.getProcess('seed-0')! as unknown as FakePiProcessInstance
    expect(H.findPiSessionFile).not.toHaveBeenCalled()
    expect(fresh.resumeSessionFile).toBe(PI_FILE)
    expect(H.rememberPiSessionFile).toHaveBeenCalledWith('seed-0', PI_FILE, '/workspace')
  })

  it('挂起过的会话复活时把已知文件补写回磁盘', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    proc.sessionFile = PI_FILE
    proc.status = 'suspended'
    H.rememberPiSessionFile.mockClear()
    proc.captureSessionFile.mockClear()

    await pool.resumeSession('seed-0')

    // 文件已在手，不必再问引擎一次
    expect(proc.captureSessionFile).not.toHaveBeenCalled()
    expect(H.rememberPiSessionFile).toHaveBeenCalledWith('seed-0', PI_FILE, '/workspace')
  })
})

describe('evictIfNeeded 驱逐阶梯', () => {
  it('活跃数未达上限时不驱逐', async () => {
    const { pool } = makePool()
    const procs = await seedSessions(pool, MAX_PROCESSES - 1)

    await pool.startSession('new', CFG)

    for (const proc of procs) expect(proc.suspend).not.toHaveBeenCalled()
    expect(FakePiProcess.instances).toHaveLength(MAX_PROCESSES)
  })

  it.each(['idle', 'active'] as const)('满载时按 lastActivityAt 挂起最老的 %s 会话', async (status) => {
    const { pool, win } = makePool()
    const procs = await seedSessions(pool, MAX_PROCESSES)
    for (const proc of procs) proc.status = status
    H.state.mapped = { type: 'suspended', data: { reason: 'eviction' } }
    const listener = vi.fn()
    pool.onRouteEvent(listener)

    await pool.startSession('new', CFG)

    const victim = procs[0] // lastActivityAt = 0，最老
    expect(victim.suspend).toHaveBeenCalledTimes(1)
    for (const proc of procs.slice(1)) expect(proc.suspend).not.toHaveBeenCalled()
    expect(FakePiProcess.instances).toHaveLength(MAX_PROCESSES + 1)
    expect(win!.webContents.send).toHaveBeenCalledWith(
      CHANNEL_BY_SUFFIX['suspended'],
      { sessionId: 'seed-0', data: { reason: 'eviction' } },
    )
    expect(listener).toHaveBeenCalledWith('seed-0', 'suspended', { reason: 'eviction' })
  })

  it('全部不可安全挂起时仅告警，不驱逐且新会话仍启动', async () => {
    const { pool } = makePool()
    const procs = await seedSessions(pool, MAX_PROCESSES)
    for (const proc of procs) proc.canSafelySuspend.mockReturnValue(false)

    await pool.startSession('new', CFG)

    for (const proc of procs) expect(proc.suspend).not.toHaveBeenCalled()
    expect(FakePiProcess.instances).toHaveLength(MAX_PROCESSES + 1)
    expect(loggerWarn).toHaveBeenCalledWith('PiProcessPool', expect.stringContaining('Cannot evict'))
  })

  it('非运行中的死条目不参与驱逐候选', async () => {
    const { pool } = makePool()
    const procs = await seedSessions(pool, MAX_PROCESSES)
    procs[0].lastActivityAt = -100 // 伪装成最老，但已死亡
    procs[0].running = false
    procs[0].status = 'exited'
    // 先补一个新会话使运行数回到 MAX（死条目不计入），下一次 start 才会触发驱逐
    await pool.startSession('new', CFG)
    const added = FakePiProcess.instances[FakePiProcess.instances.length - 1]
    added.lastActivityAt = 1000

    await pool.startSession('new2', CFG)

    expect(procs[0].suspend).not.toHaveBeenCalled()
    expect(procs[1].suspend).toHaveBeenCalledTimes(1) // 运行条目中最老者被挂起
  })
})

describe('routeEvent 事件路由', () => {
  it('mapPiEvent 返回 null 时整条事件丢弃', async () => {
    const { pool, win } = makePool()
    const [proc] = await seedSessions(pool, 1)
    const listener = vi.fn()
    pool.onRouteEvent(listener)

    proc.emit('message', { type: 'raw' })

    expect(win!.webContents.send).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('命中事件按 channel 表派发窗口并依序通知监听器', async () => {
    const { pool, win } = makePool()
    const [proc] = await seedSessions(pool, 1)
    H.state.mapped = { type: 'system', data: { foo: 'bar' } }
    const seen: Array<[string, string, unknown]> = []
    pool.onRouteEvent((sid, type, data) => seen.push([sid, type, data]))

    proc.emit('message', { type: 'raw-ignored' })

    expect(win!.webContents.send).toHaveBeenCalledTimes(1)
    expect(win!.webContents.send).toHaveBeenCalledWith(CHANNEL_BY_SUFFIX['system'], {
      sessionId: 'seed-0',
      data: { foo: 'bar' },
    })
    expect(seen).toEqual([['seed-0', 'system', { foo: 'bar' }]])
  })

  it('窗口缺失时仍派发给监听器并告警', async () => {
    const { pool } = makePool({ withWindow: false })
    const [proc] = await seedSessions(pool, 1)
    H.state.mapped = { type: 'system', data: {} }
    const listener = vi.fn()
    pool.onRouteEvent(listener)

    proc.emit('message', {})

    expect(listener).toHaveBeenCalledWith('seed-0', 'system', {})
    expect(loggerWarn).toHaveBeenCalledWith('PiProcessPool', expect.stringContaining('Cannot route'))
  })

  it('窗口已销毁时不发送窗口但仍派发监听器', async () => {
    const { pool, win } = makePool()
    const [proc] = await seedSessions(pool, 1)
    win!.isDestroyed.mockReturnValue(true)
    H.state.mapped = { type: 'system', data: {} }
    const listener = vi.fn()
    pool.onRouteEvent(listener)

    proc.emit('message', {})

    expect(win!.webContents.send).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith('seed-0', 'system', {})
    expect(loggerWarn).toHaveBeenCalledWith('PiProcessPool', expect.stringContaining('Cannot route'))
  })

  it('channel 表未命中的事件类型只派发监听器', async () => {
    const { pool, win } = makePool()
    const [proc] = await seedSessions(pool, 1)
    H.state.mapped = { type: 'no-such-type', data: { x: 1 } }
    const listener = vi.fn()
    pool.onRouteEvent(listener)

    proc.emit('message', {})

    expect(win!.webContents.send).not.toHaveBeenCalled()
    expect(loggerWarn).toHaveBeenCalledWith('PiProcessPool', expect.stringContaining('not in channel table'))
    expect(listener).toHaveBeenCalledWith('seed-0', 'no-such-type', { x: 1 })
  })

  it('单个监听器抛错不影响其余监听器', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    H.state.mapped = { type: 'system', data: {} }
    const second = vi.fn()
    pool.onRouteEvent(() => {
      throw new Error('listener boom')
    })
    pool.onRouteEvent(second)

    proc.emit('message', {})

    expect(second).toHaveBeenCalledTimes(1)
  })

  it('onRouteEvent 返回的退订函数生效', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    H.state.mapped = { type: 'system', data: {} }
    const listener = vi.fn()
    const off = pool.onRouteEvent(listener)

    off()
    proc.emit('message', {})

    expect(listener).not.toHaveBeenCalled()
  })

  it('exit/error handler 将原始载荷合并转发给 mapPiEvent', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)

    proc.emit('exit', 0, null, 'stderr tail')
    proc.emit('error', new Error('x'))

    expect(H.mapPiEvent).toHaveBeenNthCalledWith(1, 'seed-0', {
      type: 'exit',
      code: 0,
      signal: null,
      stderr: 'stderr tail',
    })
    expect(H.mapPiEvent).toHaveBeenNthCalledWith(2, 'seed-0', {
      type: 'error',
      message: 'x',
    })
  })
})

describe('会话控制面', () => {
  it.each([
    ['会话不存在', 'ghost'],
    ['会话未运行', 'seed-0'],
  ])('sendMessage 在%s时抛错', async (_name, sessionId) => {
    const { pool } = makePool()
    if (sessionId === 'seed-0') {
      const [proc] = await seedSessions(pool, 1)
      proc.running = false
    }

    await expect(pool.sendMessage(sessionId, 'hi')).rejects.toThrow('has no active process')
  })

  it('sendMessage 转发内容与图片', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)

    await pool.sendMessage('seed-0', 'hello', [IMG])

    expect(proc.sendMessage).toHaveBeenCalledWith('hello', [IMG])
  })

  it('abortSession：无条目静默，有条目转发并等引擎确认停止', async () => {
    const { pool } = makePool()
    await expect(pool.abortSession('ghost')).resolves.toBeUndefined()

    const [proc] = await seedSessions(pool, 1)
    let releaseAbort!: () => void
    ;(proc.abort as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => { releaseAbort = resolve }),
    )

    let settled = false
    const aborting = pool.abortSession('seed-0').then(() => { settled = true })
    await Promise.resolve()

    expect(proc.abort).toHaveBeenCalledTimes(1)
    // 引擎的 abort ack 没回来之前，池不许声称"已经停了"—— 渲染层的重发就靠这个串行
    expect(settled).toBe(false)

    releaseAbort()
    await aborting
    expect(settled).toBe(true)
  })

  it('suspendSession 转发挂起并路由 user_request 事件', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    H.state.mapped = { type: 'suspended', data: { reason: 'user_request' } }
    const listener = vi.fn()
    pool.onRouteEvent(listener)

    pool.suspendSession('seed-0')

    expect(proc.suspend).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('seed-0', 'suspended', { reason: 'user_request' })
  })

  it('resumeSession 会话不存在时抛错', async () => {
    const { pool } = makePool()
    await expect(pool.resumeSession('ghost')).rejects.toThrow('not found')
  })

  it('resumeSession 非 suspended 状态时抛错', async () => {
    const { pool } = makePool()
    await seedSessions(pool, 1)

    await expect(pool.resumeSession('seed-0')).rejects.toThrow('is not suspended')
  })

  it('resumeSession 成功时重挂 handler 并 resume', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    proc.status = 'suspended'

    await pool.resumeSession('seed-0')

    expect(proc.resume).toHaveBeenCalledTimes(1)
    for (const event of ['message', 'exit', 'error']) {
      expect(proc.handlers.get(event)!.size).toBe(1)
    }
  })

  it('resumeSession 失败时向上抛错', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    proc.status = 'suspended'
    FakePiProcess.nextResumeError = new Error('resume boom')

    await expect(pool.resumeSession('seed-0')).rejects.toThrow('resume boom')
  })

  it('killSession：无条目静默，有条目解绑并移除', async () => {
    const { pool } = makePool()
    expect(() => pool.killSession('ghost')).not.toThrow()

    const [proc] = await seedSessions(pool, 1)
    pool.killSession('seed-0')

    expect(proc.kill).toHaveBeenCalledTimes(1)
    expect(proc.removeListener).toHaveBeenCalledTimes(4)
    expect(pool.getProcess('seed-0')).toBeUndefined()
  })

  it('killAll 解绑并清空全部条目', async () => {
    const { pool } = makePool()
    const [a, b] = await seedSessions(pool, 2)

    pool.killAll()

    expect(a.kill).toHaveBeenCalledTimes(1)
    expect(b.kill).toHaveBeenCalledTimes(1)
    expect(a.removeListener).toHaveBeenCalledTimes(4)
    expect(b.removeListener).toHaveBeenCalledTimes(4)
    expect(pool.getProcess('seed-0')).toBeUndefined()
    expect(pool.getProcess('seed-1')).toBeUndefined()

    await pool.startSession('seed-0', CFG)
    expect(FakePiProcess.instances).toHaveLength(3)
  })

  it.each([
    ['getActiveCount 统计运行中的会话', 'getActiveCount', [], 0],
    ['getActiveCount 忽略已停止的会话', 'getActiveCount', [false], 0],
    ['getActiveSessions 无会话时空数组', 'getActiveSessions', [], []],
    ['getSessionStatus 无会话时为 null', 'getSessionStatus', [], null],
  ] as const)('%s', async (_name, method, runningFlags, expected) => {
    const { pool } = makePool()
    for (let i = 0; i < runningFlags.length; i++) {
      await pool.startSession(`seed-${i}`, CFG)
      FakePiProcess.instances[i].running = runningFlags[i]
    }

    const result = (pool as any)[method]('seed-0')
    if (method === 'getActiveCount') expect(result).toBe(expected)
    else if (method === 'getSessionStatus') expect(result).toBe(expected)
    else expect(result).toEqual(expected)
  })

  it('getSessionStatus 返回会话状态快照', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    proc.status = 'active'

    expect(pool.getSessionStatus('seed-0')).toEqual({
      sessionId: 'seed-0',
      engineSessionId: null,
      status: 'active',
      isRunning: true,
      engineVersion: '1.3.0',
      engineVersionCompatible: true,
      // 没选过模式的会话：意图为空，verified 只能报 null（default 在 Pi 侧没有闸可验）
      permissionMode: undefined,
      permissionModeVerified: null,
      // 同理：没选 agent 的会话报 null（不适用），不是「生效了」
      agentApplied: null,
    })
  })

  it('getSessionStatus 把「agent 没落地」原样带回，不替界面粉饰', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)

    proc.agentApplied = false
    expect(pool.getSessionStatus('seed-0')).toMatchObject({ agentApplied: false })

    proc.agentApplied = true
    expect(pool.getSessionStatus('seed-0')).toMatchObject({ agentApplied: true })
  })

  it('选了 agent 却没装上子代理扩展时如实报 false —— 静默无效就是 #46 本身', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)

    // 没选 agent 的会话不报这项：那份能力本来就没被要求
    expect(pool.getSessionStatus('seed-0')).toMatchObject({ agentExtensionLoaded: undefined })

    proc.config = { agent: 'reviewer' }
    proc.subagentsExtensionLoaded = false
    expect(pool.getSessionStatus('seed-0')).toMatchObject({ agentExtensionLoaded: false })

    proc.subagentsExtensionLoaded = true
    expect(pool.getSessionStatus('seed-0')).toMatchObject({ agentExtensionLoaded: true })
  })

  it('getSessionStatus 把「版本没核过」原样带上，不粉饰成可用', async () => {
    const { pool } = makePool()
    const [proc] = await seedSessions(pool, 1)
    proc.engineVersion = '0.73.0'
    proc.engineVersionCompatible = false

    expect(pool.getSessionStatus('seed-0')).toMatchObject({
      engineVersion: '0.73.0',
      engineVersionCompatible: false,
    })
  })

  it('getActiveSessions 列出全部条目且 engineSessionId 为 null', async () => {
    const { pool } = makePool()
    await seedSessions(pool, 2)
    FakePiProcess.instances[1].running = false
    FakePiProcess.instances[1].engineVersion = null
    FakePiProcess.instances[1].engineVersionCompatible = null

    expect(pool.getActiveSessions()).toEqual([
      { sessionId: 'seed-0', engineSessionId: null, status: 'idle', isRunning: true, engineVersion: '1.3.0', engineVersionCompatible: true, permissionMode: undefined, permissionModeVerified: null, agentApplied: null },
      { sessionId: 'seed-1', engineSessionId: null, status: 'idle', isRunning: false, engineVersion: null, engineVersionCompatible: null, permissionMode: undefined, permissionModeVerified: null, agentApplied: null },
    ])
    expect(pool.getActiveCount()).toBe(1)
  })
})

/**
 * Pi 不内置权限闸：plan 的只读语义全靠 `--extension` 装进来的扩展 (issue #45)。
 * 这里钉的是池的编排 —— 什么时候要求扩展进 plan、什么时候不得不换一个进程、
 * 以及「界面说 plan 而引擎没确认」时绝不把消息转发出去。
 */
describe('plan 模式权限闸编排 (#45)', () => {
  const EXT = '/app/resources/pi-extensions/node_modules/@narumitw/pi-plan-mode/dist/index.ts'
  const planConfig = (): EngineSessionConfig => ({ cwd: '/workspace', permissionMode: 'plan' })

  it('意图是 plan 且扩展在盘上：起进程就要求进 plan，状态如实报已核验', async () => {
    H.state.planModeExtensionPath = EXT
    const { pool } = makePool()

    await pool.startSession('s1', planConfig())
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance

    expect(proc.planModeExtensionLoaded).toBe(true)
    expect(proc.setPlanMode).toHaveBeenCalledWith(true)
    expect(pool.getSessionStatus('s1')).toMatchObject({ permissionMode: 'plan', permissionModeVerified: true })
  })

  it('扩展装不上时不去空转重启，也只报「plan 没核验」', async () => {
    H.state.planModeExtensionPath = null
    const { pool } = makePool()

    await pool.startSession('s1', planConfig())
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance

    await expect(pool.sendMessage('s1', '写个文件')).rejects.toThrow(/plan mode is not enforced/)
    expect(proc.start).toHaveBeenCalledTimes(1)
    expect(proc.sendMessage).not.toHaveBeenCalled()
    expect(pool.getSessionStatus('s1')).toMatchObject({ permissionMode: 'plan', permissionModeVerified: null })
  })

  it('运行中切到 plan：换一个进程装扩展，历史靠 --session 接上', async () => {
    const { pool } = makePool()
    await pool.startSession('s1', { cwd: '/workspace' })
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance
    proc.sessionFile = '/pi/s1.jsonl'
    H.state.planModeExtensionPath = EXT

    await pool.setPermissionMode('s1', 'plan')

    expect(proc.suspend).toHaveBeenCalledTimes(1)
    expect(proc.resume).toHaveBeenCalledTimes(1)
    expect(proc.setPlanMode).toHaveBeenCalledWith(true)
    expect(proc.config).toMatchObject({ permissionMode: 'plan' })
  })

  it('引擎不确认（回执等不到）就抛，并把意图回滚 —— 界面据此退回点击前的模式', async () => {
    H.state.planModeExtensionPath = EXT
    FakePiProcess.nextSetPlanMode = 'refused'
    const { pool } = makePool()
    await pool.startSession('s1', { cwd: '/workspace' })
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance

    await expect(pool.setPermissionMode('s1', 'plan')).rejects.toThrow(/did not confirm plan mode/)
    expect(proc.config).toMatchObject({ permissionMode: undefined })
  })

  it('轮次跑到一半不换进程：那等于掐掉用户正在等的答案', async () => {
    H.state.planModeExtensionPath = EXT
    const { pool } = makePool()
    await pool.startSession('s1', { cwd: '/workspace' })
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance
    proc.canSafelySuspend = vi.fn(() => false)

    await expect(pool.setPermissionMode('s1', 'plan')).rejects.toThrow(/did not confirm plan mode/)
    expect(proc.suspend).not.toHaveBeenCalled()
  })

  it('同一个模式只补一次进程重启：用户再点一次也不再空转换进程', async () => {
    H.state.planModeExtensionPath = EXT
    const { pool } = makePool()
    await pool.startSession('s1', { cwd: '/workspace' })
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance
    proc.sessionFile = '/pi/s1.jsonl'
    // 重起之后仍然算没装上扩展（路径解析得到、子进程那边装不进去）
    proc.refreshPlanModeExtension = () => {}

    await expect(pool.setPermissionMode('s1', 'plan')).rejects.toThrow(/did not confirm plan mode/)
    expect(proc.suspend).toHaveBeenCalledTimes(1)

    await expect(pool.setPermissionMode('s1', 'plan')).rejects.toThrow(/did not confirm plan mode/)
    expect(proc.suspend).toHaveBeenCalledTimes(1)
    expect(proc.sendMessage).not.toHaveBeenCalled()
  })

  it('切回 default：意图当场落地，扩展退不出去也不拦（引擎更保守不算风险）', async () => {
    H.state.planModeExtensionPath = EXT
    const { pool } = makePool()
    await pool.startSession('s1', planConfig())
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance
    FakePiProcess.nextSetPlanMode = 'throw'

    await expect(pool.setPermissionMode('s1', 'default')).resolves.toBeUndefined()
    expect(proc.setPlanMode).toHaveBeenCalledWith(false)
    expect(pool.getSessionStatus('s1')).toMatchObject({ permissionMode: 'default', permissionModeVerified: null })
  })

  it('已经在 plan 里就不再多发一帧切换命令', async () => {
    H.state.planModeExtensionPath = EXT
    const { pool } = makePool()
    await pool.startSession('s1', planConfig())
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance
    proc.setPlanMode.mockClear()

    await pool.sendMessage('s1', '继续')

    expect(proc.setPlanMode).not.toHaveBeenCalled()
    expect(proc.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('拦下消息时把 reason code + 结构化上下文发给渲染层，不只抛给调用方', async () => {
    const { pool } = makePool()
    await pool.startSession('s1', planConfig())
    H.mapPiEvent.mockClear()

    const rejection = await pool.sendMessage('s1', '写个文件').then(() => null, (err) => err)

    // 事件契约：机器可读的 reason + 上下文；不得再带一句英文 message 让渲染层直出。
    const raw = H.mapPiEvent.mock.calls[H.mapPiEvent.mock.calls.length - 1]?.[1] as Record<string, unknown>
    expect(raw).toMatchObject({
      type: 'error',
      reason: 'plan-mode-not-enforced',
      context: { engine: 'pi', intent: 'plan', extensionLoaded: false },
    })
    expect(raw).not.toHaveProperty('message')
    expect(String(raw.detail)).toMatch(/plan mode is not enforced/)

    // IPC 拒绝只保留 message：reason 必须仍能从错误里解析出来，界面才能本地化。
    expect(parseEngineBlockedError(rejection)?.reason).toBe('plan-mode-not-enforced')
  })
})

/**
 * 扩展对话框在池这一侧的编排 (#54)。
 *
 * 池既不认识 pi 的 UUID，也不写 stdin —— 它只管两件事：把用户的应答交给真正持有
 * 这条 stdin 的进程，以及把对话框的退场通知送到渲染层。第二条要紧过第一条：
 * killSession 是先摘事件处理器再拆进程的，账若在那之后才结，通知就没人接，
 * 界面会留一张谁也点不动的卡片。
 */
describe('扩展对话框的池侧编排 (#54)', () => {
  it('应答转发给持有该会话的进程，按 pi 的 id 原样传下去', async () => {
    const { pool } = makePool()
    await pool.startSession('s1', CFG)
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance

    pool.respondExtensionDialog('s1', 'uuid-1', { kind: 'value', value: 'Allow' })

    expect(proc.respondExtensionDialog).toHaveBeenCalledWith('uuid-1', { kind: 'value', value: 'Allow' })
  })

  it('会话不在了要抛错：界面靠这次失败把卡片退回可重试态', async () => {
    const { pool } = makePool()

    expect(() => pool.respondExtensionDialog('ghost', 'uuid-1', { kind: 'cancel' })).toThrow(/No pi session process/)
  })

  it('对话框退场送到渲染层，channel 由事件表反查', async () => {
    const { pool, win } = makePool()
    await pool.startSession('s1', CFG)
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance
    H.state.mapped = { type: 'extension_dialog_closed', data: { dialogId: 'uuid-1', method: 'select', reason: 'timeout' } }

    proc.emit('extension_dialog_closed', { dialogId: 'uuid-1', method: 'select', reason: 'timeout' })

    expect(win!.webContents.send).toHaveBeenCalledWith(
      CHANNEL_BY_SUFFIX['extension_dialog_closed'],
      { sessionId: 's1', data: { dialogId: 'uuid-1', method: 'select', reason: 'timeout' } },
    )
  })

  it('killSession 在摘处理器之前结对话框的账', async () => {
    const { pool } = makePool()
    await pool.startSession('s1', CFG)
    const proc = pool.getProcess('s1')! as unknown as FakePiProcessInstance

    pool.killSession('s1')

    // 顺序错了就是发了没人收的通知：摘掉 handler 之后 emit 的 extension_dialog_closed
    // 到不了窗口，界面留一张谁也点不动的卡 (#54)
    expect(proc.cancelPendingExtensionDialogs).toHaveBeenCalledWith('process_exit')
    expect(proc.cancelPendingExtensionDialogs.mock.invocationCallOrder[0])
      .toBeLessThan(proc.removeListener.mock.invocationCallOrder[0])
  })
})
