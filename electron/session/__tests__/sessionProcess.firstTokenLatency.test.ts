// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionProcess, type SessionConfig } from '../sessionProcess'

/**
 * 首 Token 延迟账本（latencyMarks → first_token_latency）。
 *
 * 冷启动的三十秒分属四段互不相干的成本：宿主准备参数（buildArgs/buildEnv 里的
 * 同步子进程探测）、进程拉起、引擎 init（含全部 MCP 握手）、上游 TTFT。挤在一个
 * 总数里就无从判断该优化哪一段，所以这里钉死拆分口径：
 *   - 「冷」的判据是 system/init 晚于本次 stdin 写入 —— 只有那时启动成本才算在
 *     这条消息头上，预热命中时四段 boot 字段必须缺席（否则会拿历史 boot 数据
 *     冒充本轮成本，把优化效果算虚）；
 *   - 一次发送只报第一个可见 Token；工具入参增量与主进程合成的 Bash 增量都不算
 *     模型开始吐字。
 *
 * 全程走真实 start() / stdout 分帧 / sendMessage，只在 child_process 处收缝。
 */

const cp = vi.hoisted(() => ({ calls: [] as any[] }))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const { EventEmitter } = await import('events')
  return {
    ...actual,
    spawn: (command: string, args: string[], opts: any) => {
      const child: any = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdin = new EventEmitter()
      child.stdin.writable = true
      child.stdin.write = vi.fn()
      child.pid = 55000 + cp.calls.length
      child.killed = false
      child.kill = vi.fn(() => true)
      cp.calls.push({ command, args, opts, child })
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
  }
})

vi.mock('fs', () => ({
  existsSync: () => false,
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: () => '{}',
  readdirSync: () => [],
  realpathSync: (p: unknown) => String(p),
  statSync: () => ({ isFile: () => true, size: 1_000_000 }),
  copyFileSync: vi.fn(),
  chmodSync: vi.fn(),
  appendFileSync: vi.fn(),
}))

vi.mock('os', () => ({ homedir: () => '/home/u', tmpdir: () => '/tmp' }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => '/home/u') },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  processRaw: vi.fn(), sdkMessage: vi.fn(), setSessionLogPath: vi.fn(), traceEvent: vi.fn(),
}))

vi.mock('../../infra/proxyManager', () => ({
  proxyManager: { getProxyUrl: vi.fn(() => null), start: vi.fn() },
  buildProxyConfigFromSettings: vi.fn(() => null),
}))

vi.mock('../../tools/mcpConfigStore', () => ({
  buildEnabledMcpConfig: vi.fn(() => ({ mcpServers: { 'cdp-bridge': { type: 'stdio', command: 'uvx' } } })),
  anyServerNeedsPackageManagerLauncher: vi.fn(() => true),
}))
vi.mock('../../tools/officeCliService', () => ({
  getOfficeCliInstallDir: vi.fn(() => '/office/bin'),
  syncInstalledOfficeCli: vi.fn(() => ({ copied: false, reason: 'up-to-date', bundledVersion: null, installedVersion: null })),
}))
vi.mock('../../tools/rtkManager', () => ({
  rtkManager: { isBinaryInstalled: vi.fn(() => false), getBinaryDir: vi.fn(() => '/rtk/bin') },
}))
vi.mock('../engineChildProcess', () => ({
  killTree: vi.fn(),
  resolveBunPath: vi.fn(() => 'bun'),
  resolveBunPathForPackagedDesktop: vi.fn(() => null),
  isProbableBunExecutable: vi.fn(() => false),
  resolveCliRoot: vi.fn(() => '/engine-root'),
}))

vi.mock('../tempArtifacts', () => ({
  writeSessionTempFile: vi.fn(() => '/tmp/artifact.json'),
  removeTempFiles: vi.fn(),
}))

import { traceEvent } from '../../infra/logger'

const traceMock = vi.mocked(traceEvent)

function makeProc(overrides: Partial<SessionConfig> = {}): any {
  const proc = new SessionProcess('sess-latency-0001', {
    cwd: '/tmp/ws',
    provider: 'anthropic',
    permissionMode: 'default',
    engineSource: 'installed',
    installedCliPath: '/claude/claude',
    ...overrides,
  }) as any
  vi.spyOn(proc, 'buildEnv').mockResolvedValue({})
  return proc
}

function feed(proc: any, obj: Record<string, any>): void {
  cp.calls[cp.calls.length - 1].child.stdout.emit('data', Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8'))
}

function latencyEvents(): Record<string, any>[] {
  return traceMock.mock.calls
    .map(([e]: [any]) => e)
    .filter(e => e?.type === 'first_token_latency')
}

beforeEach(() => {
  cp.calls.length = 0
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SessionProcess 首 Token 延迟账本', () => {
  it('首条消息前等待控制协议就绪不应等只能在发送后出现的 system/init', async () => {
    const proc = makeProc({ warmed: true, permissionMode: 'plan' })
    await proc.start()
    const child = cp.calls[0].child
    child.stdin.write.mockImplementation((line: string) => {
      const message = JSON.parse(line)
      if (message.request?.subtype === 'initialize') {
        setTimeout(() => feed(proc, {
          type: 'control_response',
          response: { subtype: 'success', request_id: message.request_id, response: {} },
        }), 100)
      }
    })

    let ready = false
    const waiting = proc.waitForInit().then((value: boolean) => { ready = value })
    await vi.advanceTimersByTimeAsync(100)
    expect(ready).toBe(true)
    await waiting
    expect(proc.engineSessionId).toBeNull()
    expect(proc.reportedPermissionMode).toBeNull()
    expect(latencyEvents()).toHaveLength(0)
    proc.kill()
  })

  it('并发等待只发一次 initialize，握手成功后不再发送', async () => {
    const proc = makeProc()
    await proc.start()
    const child = cp.calls[0].child
    const first = proc.waitForInit()
    const second = proc.waitForInit()
    expect(child.stdin.write).toHaveBeenCalledTimes(1)
    const request = JSON.parse(child.stdin.write.mock.calls[0][0])
    feed(proc, { type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: {} } })

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    await expect(proc.waitForInit()).resolves.toBe(true)
    expect(child.stdin.write).toHaveBeenCalledTimes(1)
    proc.kill()
  })

  it('握手超时有界，进程退出后清理控制请求和等待者', async () => {
    const proc = makeProc()
    await proc.start()
    const child = cp.calls[0].child
    const waiting = proc.waitForInit(100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(waiting).resolves.toBe(false)
    const next = proc.waitForInit()
    child.emit('exit', 1, null)
    await expect(next).resolves.toBe(false)
    await expect(proc.waitForInit()).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('initialize 被拒不冒充已就绪，也不改变权限核验结果', async () => {
    const proc = makeProc({ permissionMode: 'plan' })
    await proc.start()
    const waiting = proc.waitForInit()
    const request = JSON.parse(cp.calls[0].child.stdin.write.mock.calls[0][0])
    feed(proc, { type: 'control_response', response: { subtype: 'error', request_id: request.request_id, error: 'unsupported' } })
    await expect(waiting).resolves.toBe(false)
    expect(proc.permissionModeVerified).toBeNull()
    expect(proc.currentPermissionMode).toBe('plan')
    proc.kill()
  })

  it('恢复进程不能拿旧 engineSessionId 当作新进程已经就绪', async () => {
    const proc = makeProc()
    await proc.start()
    feed(proc, { type: 'system', subtype: 'init', session_id: 'eng-resume' })
    await expect(proc.waitForInit()).resolves.toBe(true)
    proc.kill()
    await proc.start()

    let ready = false
    const waiting = proc.waitForInit().then((value: boolean) => { ready = value })
    await vi.advanceTimersByTimeAsync(1)
    expect(ready).toBe(false)
    const child = cp.calls[1].child
    const request = JSON.parse(child.stdin.write.mock.calls[0][0])
    expect(request.request.subtype).toBe('initialize')
    feed(proc, { type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: {} } })
    await waiting
    expect(ready).toBe(true)
    proc.kill()
  })

  it('旧进程晚到的 stdout、stderr、error 和 exit 不影响重启后的握手', async () => {
    const proc = makeProc()
    await proc.start()
    const oldChild = cp.calls[0].child
    proc.kill()
    await proc.start()
    const child = cp.calls[1].child
    const waiting = proc.waitForInit()
    const request = JSON.parse(child.stdin.write.mock.calls[0][0])
    const onError = vi.fn()
    const onExit = vi.fn()
    const onLog = vi.fn()
    proc.on('error', onError)
    proc.on('exit', onExit)
    proc.on('log', onLog)

    oldChild.stdout.emit('data', Buffer.from('{"type":"system","subtype":"init","session_id":"old"}\n'))
    oldChild.stderr.emit('data', Buffer.from('old error'))
    oldChild.emit('error', new Error('late old error'))
    oldChild.emit('exit', 1, null)
    expect(proc.process).toBe(child)
    expect(proc.engineSessionId).toBeNull()
    expect(onError).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    expect(onLog).not.toHaveBeenCalled()

    feed(proc, { type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: {} } })
    await expect(waiting).resolves.toBe(true)
    proc.kill()
  })

  it('停止时立即清理未完成握手和半截 JSON，避免污染下一次启动', async () => {
    const proc = makeProc()
    await proc.start()
    const waiting = proc.waitForInit()
    cp.calls[0].child.stdout.emit('data', Buffer.from('{"type":'))
    proc.kill()
    await expect(waiting).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await proc.start()
    const next = proc.waitForInit()
    const request = JSON.parse(cp.calls[1].child.stdin.write.mock.calls[0][0])
    feed(proc, { type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: {} } })
    await expect(next).resolves.toBe(true)
    proc.kill()
  })

  it('发送时引擎还没 init：把成本拆成宿主准备 / 拉起 / 引擎 boot / init 之后四段', async () => {
    const proc = makeProc()
    await proc.start()

    vi.setSystemTime(1_000)
    proc.sendMessage('hello')

    vi.setSystemTime(8_000)
    feed(proc, { type: 'system', subtype: 'init', session_id: 'eng-1' })

    vi.setSystemTime(12_000)
    feed(proc, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } })

    const events = latencyEvents()
    expect(events).toHaveLength(1)
    expect(events[0].metadata).toMatchObject({
      ttftMs: 11_000,
      coldStart: true,
      sendToInitMs: 7_000,
      afterInitMs: 4_000,
      engineBootMs: 8_000,
      mcpServerCount: 1,
    })
    // 宿主准备段与进程拉起段各自独立，才能分别归因
    expect(events[0].metadata).toHaveProperty('hostPrepMs')
    expect(events[0].metadata).toHaveProperty('spawnMs')
    proc.kill()
  })

  it('预热命中（init 早于发送）：只报本轮 TTFT，不带任何 boot 段', async () => {
    const proc = makeProc({ warmed: true })
    await proc.start()

    vi.setSystemTime(30_000)
    feed(proc, { type: 'system', subtype: 'init', session_id: 'eng-2' })

    vi.setSystemTime(40_000)
    proc.sendMessage('hello')

    vi.setSystemTime(41_500)
    feed(proc, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', text: '…' } } })

    const events = latencyEvents()
    expect(events).toHaveLength(1)
    expect(events[0].metadata).toMatchObject({ ttftMs: 1_500, coldStart: false, warmedSpawn: true })
    for (const bootKey of ['hostPrepMs', 'spawnMs', 'engineBootMs', 'sendToInitMs', 'afterInitMs']) {
      expect(events[0].metadata).not.toHaveProperty(bootKey)
    }
    proc.kill()
  })

  it('一轮只报第一个可见 Token；工具入参与合成的 Bash 增量不算模型开始吐字', async () => {
    const proc = makeProc()
    await proc.start()
    vi.setSystemTime(1_000)
    feed(proc, { type: 'system', subtype: 'init', session_id: 'eng-3' })

    vi.setSystemTime(2_000)
    proc.sendMessage('hello')

    // 主进程 Bash 旁路合成的增量：type 名字像 delta，但不代表首 Token
    feed(proc, {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'tool_execution_delta', toolCallId: 'tu-1', partialResult: { content: [] } } },
    })
    feed(proc, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } } })
    expect(latencyEvents()).toHaveLength(0)

    vi.setSystemTime(3_000)
    feed(proc, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } })
    vi.setSystemTime(9_000)
    feed(proc, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } } })
    expect(latencyEvents()).toHaveLength(1)

    // 下一次发送重新起算，账本不会把上一轮的 stdinAt 带过来
    vi.setSystemTime(20_000)
    proc.sendMessage('again')
    vi.setSystemTime(20_500)
    feed(proc, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'c' } } })
    const events = latencyEvents()
    expect(events).toHaveLength(2)
    expect(events[1].metadata).toMatchObject({ ttftMs: 500, coldStart: false })
    proc.kill()
  })

  it('没有本次发送时到达的 Token 不记账（引擎自主注入的事件不产生假样本）', async () => {
    const proc = makeProc()
    await proc.start()
    vi.setSystemTime(1_000)
    feed(proc, { type: 'system', subtype: 'init', session_id: 'eng-4' })
    vi.setSystemTime(2_000)
    feed(proc, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } })

    expect(latencyEvents()).toHaveLength(0)
    proc.kill()
  })
})
