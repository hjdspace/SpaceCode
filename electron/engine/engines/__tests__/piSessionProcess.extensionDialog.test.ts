// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import * as path from 'path'
import { PiSessionProcess } from '../PiSessionProcess'
import type { EngineSessionConfig } from '../types'

/**
 * pi 扩展对话框的往返 (issue #54)。
 *
 * RPC 里 `select`/`confirm`/`input`/`editor` 会 await 宿主回帧，宿主不回，这一轮就永远
 * 停在那儿。#45 当时的处置是一律立刻回 cancelled —— 会话不挂死了，但扩展的交互全退化成
 * 自动拒绝。#54 给这四类做了能应答的界面，于是这里核验的是三件事：
 *
 *   1. 应答按 pi 给的那个 UUID 落帧，四种方法的载荷形状各自正确；
 *   2. 对话框在飞期间会话不许被挂起/淘汰（不然问题连人带卡一起被撕掉）；
 *   3. 自动取消退回成兜底：进程没了、abort 了、超时了才补 cancelled，不再是默认动作。
 *
 * 只 fake 子进程与文件系统；分帧、登记、结账都跑真实现。
 */

interface FakeChild {
  child: EventEmitter
  stdout: EventEmitter
  stdinWrite: ReturnType<typeof vi.fn>
  stdinEnd: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
}

interface SpawnCall {
  command: string
  args: string[]
}

const SRC_DIR = path.resolve(__dirname, '..')
const DEV_CLI = path.resolve(SRC_DIR, '..', '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')

const H = vi.hoisted(() => ({
  spawnCalls: [] as SpawnCall[],
  children: [] as FakeChild[],
  existing: new Set<string>(),
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const { EventEmitter: Emitter } = await import('events')
  return {
    ...actual,
    spawn: (command: string, args: string[], _opts: unknown) => {
      const child: any = new Emitter()
      child.stdout = new Emitter()
      child.stderr = new Emitter()
      // 真 stdin 是个可写的 Socket：宿主补回帧时按 `stdin.writable` 判能不能写，
      // 假对象少了这个键就等于每次都判「写不出去」，测到的只是这层守卫。
      const stdin: any = { write: vi.fn(), writable: true }
      // end() 之后 real stream 就不可以再写了，假对象也跟着翻这个键 ——
      // 不然「对话框结账发生在关流之前」这件事在这里压根测不出来。
      stdin.end = vi.fn(() => { stdin.writable = false })
      child.stdin = stdin
      child.pid = 43000 + H.spawnCalls.length
      child.killed = false
      child.kill = vi.fn(() => true)
      H.spawnCalls.push({ command, args })
      H.children.push({
        child,
        stdout: child.stdout,
        stdinWrite: child.stdin.write,
        stdinEnd: child.stdin.end,
        kill: child.kill,
      })
      return child
    },
  }
})

vi.mock('fs', () => ({
  existsSync: (p: unknown) => H.existing.has(String(p)),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: (p: unknown) => (String(p).endsWith('package.json') ? '{"version":"1.3.0"}' : '{}'),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app/root', getPath: () => '/home/u' },
}))

vi.mock('os', () => ({ homedir: () => '/home/u' }))

vi.mock('../../../session/engineChildProcess', () => ({
  killTree: vi.fn(),
  isProbableBunExecutable: vi.fn(() => false),
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

import { warn as loggerWarn } from '../../../infra/logger'

const BASE: EngineSessionConfig = { cwd: '/ws', provider: 'anthropic', model: 'claude-sonnet-4' }

let open: PiSessionProcess[] = []

async function startedSession(config: Partial<EngineSessionConfig> = {}): Promise<{ proc: PiSessionProcess; child: FakeChild }> {
  const proc = new PiSessionProcess('pi-dlg-0001', { ...BASE, ...config })
  open.push(proc)
  const starting = proc.start()
  await vi.advanceTimersByTimeAsync(500)
  await starting
  return { proc, child: H.children[H.children.length - 1] }
}

function feed(child: FakeChild, frame: Record<string, unknown>): void {
  child.stdout.emit('data', Buffer.from(JSON.stringify(frame) + '\n', 'utf8'))
}

/** 宿主写回子进程 stdin 的帧，按到达顺序 */
function writtenFrames(child: FakeChild): any[] {
  return child.stdinWrite.mock.calls.map(call => JSON.parse(String(call[0])))
}

function dialogFrame(overrides: Record<string, unknown>): Record<string, unknown> {
  return { type: 'extension_ui_request', id: 'ui-9', ...overrides }
}

/** 订阅宿主自己发的退场通知 —— 界面上的卡片靠它退，不是靠猜 */
function closedEvents(proc: PiSessionProcess): any[] {
  const seen: any[] = []
  proc.on('extension_dialog_closed', payload => seen.push(payload))
  return seen
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  H.spawnCalls = []
  H.children = []
  H.existing = new Set([DEV_CLI])
  open = []
})

afterEach(() => {
  for (const proc of open) {
    try { proc.kill() } catch { /* already dead */ }
  }
  vi.useRealTimers()
})

describe('对话框打开：登记，不再立刻取消', () => {
  it.each(['select', 'confirm', 'input', 'editor'])('%s 只登记，不抢答', async (method) => {
    const { proc, child } = await startedSession()
    const closed = closedEvents(proc)

    feed(child, dialogFrame({ method, title: 'Plan mode — what next?', options: ['A', 'B'] }))

    // 宿主抢着回 cancelled 就是 #45 那个「交互全退化成自动拒绝」的形态
    expect(writtenFrames(child)).toEqual([])
    expect(closed).toEqual([])
  })

  it('没有 id 的对话框无从应答：记一行 warn，不写坏帧', async () => {
    const { proc, child } = await startedSession()

    feed(child, { type: 'extension_ui_request', method: 'confirm', title: 'Allow?' })

    expect(writtenFrames(child)).toEqual([])
    expect(loggerWarn).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining('Extension dialog request without an id'),
    )
    expect(proc.canSafelySuspend()).toBe(true)
  })

  it('fire-and-forget 的方法不登记：发了不回头，没有要用户答的东西', async () => {
    const { proc, child } = await startedSession()

    feed(child, dialogFrame({ method: 'notify', message: 'Plan mode enabled.', notifyType: 'info' }))
    feed(child, dialogFrame({ method: 'setWidget', widgetKey: 'plan-mode-plan', widgetLines: ['x'] }))

    expect(writtenFrames(child)).toEqual([])
    // 登记过就会把挂起挡住，那是凭空的代价
    expect(proc.canSafelySuspend()).toBe(true)
  })
})

describe('应答落帧：按 pi 的 UUID，载荷随方法而变', () => {
  it('select 回选项原文', async () => {
    const { proc, child } = await startedSession()
    feed(child, dialogFrame({ method: 'select', title: 'Dangerous command', options: ['Yes', 'No'] }))

    proc.respondExtensionDialog('ui-9', { kind: 'value', value: 'Yes' })

    expect(writtenFrames(child)).toEqual([{ type: 'extension_ui_response', id: 'ui-9', value: 'Yes' }])
  })

  it('confirm 回布尔，不是字符串', async () => {
    const { proc, child } = await startedSession()
    feed(child, dialogFrame({ method: 'confirm', title: 'Clear session?', message: 'All messages will be lost.' }))

    proc.respondExtensionDialog('ui-9', { kind: 'confirmed', confirmed: false })

    expect(writtenFrames(child)).toEqual([{ type: 'extension_ui_response', id: 'ui-9', confirmed: false }])
  })

  it('input 与 editor 都回 value，editor 的空文本也算答案', async () => {
    const { proc, child } = await startedSession()
    feed(child, dialogFrame({ method: 'input', title: 'Enter a value', placeholder: 'type something...' }))
    proc.respondExtensionDialog('ui-9', { kind: 'value', value: 'export/plan.md' })

    feed(child, dialogFrame({ method: 'editor', id: 'ui-10', title: 'Edit the plan', prefill: 'Line 1' }))
    proc.respondExtensionDialog('ui-10', { kind: 'value', value: '' })

    expect(writtenFrames(child)).toEqual([
      { type: 'extension_ui_response', id: 'ui-9', value: 'export/plan.md' },
      { type: 'extension_ui_response', id: 'ui-10', value: '' },
    ])
  })

  it('界面上点「关闭」算取消：扩展拿到 undefined/false', async () => {
    const { proc, child } = await startedSession()
    feed(child, dialogFrame({ method: 'select', title: 'What next?', options: ['A', 'B'] }))

    proc.respondExtensionDialog('ui-9', { kind: 'cancel' })

    expect(writtenFrames(child)).toEqual([{ type: 'extension_ui_response', id: 'ui-9', cancelled: true }])
  })

  it('应答发出后登记随之清空，第二次提交要失败', async () => {
    const { proc, child } = await startedSession()
    feed(child, dialogFrame({ method: 'select', title: 'What next?', options: ['A'] }))

    proc.respondExtensionDialog('ui-9', { kind: 'value', value: 'A' })

    // 认不出的 id 必须抛：界面靠这次失败把卡片退回可重试态
    expect(() => proc.respondExtensionDialog('ui-9', { kind: 'value', value: 'A' })).toThrow(/No pending extension dialog/)
    expect(writtenFrames(child)).toHaveLength(1)
  })

  it('退场通知带上 id 与方法，界面才知道该收哪张卡', async () => {
    const { proc, child } = await startedSession()
    const closed = closedEvents(proc)
    feed(child, dialogFrame({ method: 'select', title: 'What next?', options: ['A', 'B'] }))

    proc.respondExtensionDialog('ui-9', { kind: 'value', value: 'B' })

    expect(closed).toEqual([{ dialogId: 'ui-9', method: 'select', reason: 'answered' }])
  })
})

describe('在飞的对话框把危险动作挡住', () => {
  it('正等用户答时会话不许挂起，也不许被池淘汰', async () => {
    const { proc, child } = await startedSession()
    expect(proc.canSafelySuspend()).toBe(true)

    feed(child, dialogFrame({ method: 'select', title: 'Allow?', options: ['Yes', 'No'] }))

    // evictIfNeeded 与 reconcilePlanMode 都按这个门禁决定要不要抽走进程；
    // pi 正卡在 await 上，抽走等于把还没出口的问题撕掉
    expect(proc.canSafelySuspend()).toBe(false)

    proc.respondExtensionDialog('ui-9', { kind: 'value', value: 'Yes' })
    expect(proc.canSafelySuspend()).toBe(true)
  })

  it('suspend 把在飞的对话框结掉，且在 stdin 关闭之前', async () => {
    const { proc, child } = await startedSession()
    const closed = closedEvents(proc)
    feed(child, dialogFrame({ method: 'confirm', title: 'Keep going?', message: '?' }))

    // suspend 先等一次 get_state 拿会话文件；假 timer 不推进它就永远不回
    const suspending = proc.suspend()
    await vi.advanceTimersByTimeAsync(3_100)
    await suspending

    // 写帧发生在 stdin.end() 之前（假流 end 后 writable 变 false，晚了就写不出来）
    expect(writtenFrames(child)).toEqual([
      { id: 'req_1', type: 'get_state' },
      { type: 'extension_ui_response', id: 'ui-9', cancelled: true },
    ])
    expect(child.stdinEnd).toHaveBeenCalled()
    expect(closed).toEqual([{ dialogId: 'ui-9', method: 'confirm', reason: 'suspended' }])
    expect(proc.canSafelySuspend()).toBe(true)
  })

  it('abort 先结对话框再发 abort 帧：不能拿 abort 去等一张没人要答的卡', async () => {
    const { proc, child } = await startedSession()
    feed(child, dialogFrame({ method: 'select', title: 'What next?', options: ['A'] }))

    // 两帧都是在 abort 真正 await ack 之前同步写出去的
    const aborting = proc.abort()
    const frames = writtenFrames(child)
    expect(frames[0]).toEqual({ type: 'extension_ui_response', id: 'ui-9', cancelled: true })
    expect(frames[1]).toMatchObject({ type: 'abort' })

    // ack 不会来（没人喂），让它按超时收场，别留悬挂的 promise
    await vi.advanceTimersByTimeAsync(10_100)
    await aborting
  })
})

describe('自动取消退回成兜底', () => {
  it('进程退出时在飞的对话框补 cancelled 并通知退场', async () => {
    const { proc, child } = await startedSession()
    const closed = closedEvents(proc)
    feed(child, dialogFrame({ method: 'select', title: 'What next?', options: ['A', 'B'] }))

    child.child.emit('exit', 1, null)

    expect(writtenFrames(child)).toEqual([{ type: 'extension_ui_response', id: 'ui-9', cancelled: true }])
    expect(closed).toEqual([{ dialogId: 'ui-9', method: 'select', reason: 'process_exit' }])
  })

  it('kill 也结干净，不留点不动的卡片', async () => {
    const { proc, child } = await startedSession()
    const closed = closedEvents(proc)
    feed(child, dialogFrame({ method: 'input', title: 'Enter a value' }))

    await proc.kill()

    expect(writtenFrames(child)).toEqual([{ type: 'extension_ui_response', id: 'ui-9', cancelled: true }])
    expect(closed).toEqual([{ dialogId: 'ui-9', method: 'input', reason: 'process_exit' }])
  })

  it('带 timeout 的帧按 pi 给的时长收：它自己会在那一刻解成 undefined', async () => {
    const { proc, child } = await startedSession()
    const closed = closedEvents(proc)
    feed(child, dialogFrame({ method: 'select', title: 'Allow dangerous command?', options: ['Allow', 'Block'], timeout: 10_000 }))

    await vi.advanceTimersByTimeAsync(9_000)
    expect(closed).toEqual([])

    await vi.advanceTimersByTimeAsync(1_500)

    expect(closed).toEqual([{ dialogId: 'ui-9', method: 'select', reason: 'timeout' }])
    expect(writtenFrames(child)).toEqual([{ type: 'extension_ui_response', id: 'ui-9', cancelled: true }])
  })

  it('没带 timeout 的帧由宿主看门狗兜住，别永远停着', async () => {
    const { proc, child } = await startedSession()
    const closed = closedEvents(proc)
    feed(child, dialogFrame({ method: 'editor', title: 'Edit the plan', prefill: 'Line 1' }))

    // editor 不支持 timeout（pi 的 rpc-mode 里它没有超时），所以只有宿主能收这个账
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(closed).toEqual([])

    await vi.advanceTimersByTimeAsync(65_000)

    expect(closed).toEqual([{ dialogId: 'ui-9', method: 'editor', reason: 'watchdog' }])
    expect(writtenFrames(child)).toEqual([{ type: 'extension_ui_response', id: 'ui-9', cancelled: true }])
  })

  it('用户在时限内答了，看门狗就不再补 cancelled', async () => {
    const { proc, child } = await startedSession()
    feed(child, dialogFrame({ method: 'select', title: 'What next?', options: ['A', 'B'], timeout: 30_000 }))

    proc.respondExtensionDialog('ui-9', { kind: 'value', value: 'A' })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(writtenFrames(child)).toEqual([{ type: 'extension_ui_response', id: 'ui-9', value: 'A' }])
  })
})

describe('多条对话框并存', () => {
  it('按各自的 id 结，互不串台', async () => {
    const { proc, child } = await startedSession()
    const closed = closedEvents(proc)
    feed(child, dialogFrame({ id: 'ui-a', method: 'select', title: 'First?', options: ['A'] }))
    feed(child, dialogFrame({ id: 'ui-b', method: 'confirm', title: 'Second?', message: '?' }))

    proc.respondExtensionDialog('ui-b', { kind: 'confirmed', confirmed: true })
    proc.respondExtensionDialog('ui-a', { kind: 'value', value: 'A' })

    expect(writtenFrames(child)).toEqual([
      { type: 'extension_ui_response', id: 'ui-b', confirmed: true },
      { type: 'extension_ui_response', id: 'ui-a', value: 'A' },
    ])
    expect(closed.map(e => e.dialogId)).toEqual(['ui-b', 'ui-a'])
    expect(proc.canSafelySuspend()).toBe(true)
  })
})
