// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import * as path from 'path'
import { PiSessionProcess } from '../PiSessionProcess'
import type { EngineSessionConfig } from '../types'

/**
 * plan 模式在 Pi 这条路上的三个协议动作 (issue #45)：
 *
 *   1. spawn 时把权限闸扩展带上 —— Pi 没有 `--permission-mode` 可拼，`--extension` 是唯一入口；
 *   2. 相信扩展的回执而不是自己的命令行 —— 扩展用 `setStatus('plan-mode')` 报它在不在 plan，
 *      宿主只有收到「在」才敢把界面写成计划模式已生效；
 *   3. 应答扩展的对话框 —— RPC 里 select/confirm/input/editor 会 await 宿主回帧，宿主不回，
 *      整条会话就停在那儿，比「plan 下还能写文件」更糟。
 *
 * 只 fake 子进程与文件系统；分帧、回执判定、扩展路径解析都跑真实现 —— 解析扩展的候选序列
 * 与打包态那条路径本身就是被测的一部分。
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
/** 与 piCliResolver / piPlanModeExtension 同一个 __dirname 相对候选 */
const DEV_CLI = path.resolve(SRC_DIR, '..', '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const DEV_EXT = path.resolve(SRC_DIR, '..', '..', 'node_modules', '@narumitw', 'pi-plan-mode', 'dist', 'index.ts')

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
      child.stdin = { write: vi.fn(), end: vi.fn() }
      child.pid = 42000 + H.spawnCalls.length
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
  const proc = new PiSessionProcess('pi-plan-0001', { ...BASE, ...config })
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

function setStatus(statusText?: string, statusKey = 'plan-mode'): Record<string, unknown> {
  const frame: Record<string, unknown> = { type: 'extension_ui_request', id: 'ui-1', method: 'setStatus', statusKey }
  if (statusText !== undefined) frame.statusText = statusText
  return frame
}

function ackOf(id: string): Record<string, unknown> {
  return { id, type: 'response', command: 'prompt', success: true, data: { disposition: 'handled' } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  H.spawnCalls = []
  H.children = []
  H.existing = new Set([DEV_CLI, DEV_EXT])
  open = []
})

afterEach(() => {
  for (const proc of open) {
    void proc.kill()
    proc.removeAllListeners()
  }
  open = []
  vi.useRealTimers()
})

describe('spawn 参数里的权限闸扩展', () => {
  it('意图是 plan：命令行带 --extension，并把「带上了」记进会话', async () => {
    await startedSession({ permissionMode: 'plan' })

    const args = H.spawnCalls[0].args
    const at = args.indexOf('--extension')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(args[at + 1]).toBe(DEV_EXT)
  })

  it('非 plan 的会话一律不带扩展 —— 那两个 plan helper 工具不该凭空出现在模型面前', async () => {
    for (const permissionMode of ['default', 'acceptEdits', 'bypassPermissions'] as const) {
      H.spawnCalls = []
      const { proc } = await startedSession({ permissionMode })

      expect(H.spawnCalls[0].args).not.toContain('--extension')
      expect(proc.planModeExtensionLoaded).toBe(false)
    }
  })

  it('扩展不在盘上时不硬拼一个不存在的路径，plan 只算「无从核验」', async () => {
    H.existing.delete(DEV_EXT)

    const { proc } = await startedSession({ permissionMode: 'plan' })

    expect(H.spawnCalls[0].args).not.toContain('--extension')
    expect(proc.planModeExtensionLoaded).toBe(false)
    expect(proc.planModeActive).toBeNull()
  })
})

describe('plan 模式回执', () => {
  it('扩展 setStatus 带 statusText = 在 plan，并把变化广播给池', async () => {
    const { proc, child } = await startedSession({ permissionMode: 'plan' })
    const states: Array<boolean | null> = []
    proc.on('planModeState', (state) => states.push(state))

    feed(child, setStatus('plan active'))

    expect(proc.planModeActive).toBe(true)
    expect(states).toEqual([true])
  })

  it('statusText 缺省 = 扩展报「不在 plan」', async () => {
    const { proc, child } = await startedSession({ permissionMode: 'plan' })

    feed(child, setStatus('plan active'))
    feed(child, setStatus())

    expect(proc.planModeActive).toBe(false)
  })

  // formatStatus 在 state.enabled 为 false 时也会发文本（存好的计划 / 正在实现，那时写权限
  // 是放开的）。把「带文本」当成在 plan 就是在实现阶段不设闸 —— 反方向的 #45 (#45)
  it.each([
    ['plan active', true],
    ['plan ready', true],
    ['plan saved', false],
    ['plan implementing', false],
  ])('statusText「%s」判为在 plan = %s', async (text, expected) => {
    const { proc, child } = await startedSession({ permissionMode: 'plan' })

    feed(child, setStatus(text))

    expect(proc.planModeActive).toBe(expected)
  })

  it('认不出的 statusText 算「无从核验」，不替引擎编一个状态', async () => {
    const { proc, child } = await startedSession({ permissionMode: 'plan' })

    feed(child, setStatus('plan whatever'))

    expect(proc.planModeActive).toBeNull()
  })

  it('别的扩展的 setStatus 不算我们的模式回执', async () => {
    const { proc, child } = await startedSession({ permissionMode: 'plan' })

    feed(child, setStatus('whatever', 'other-ext'))

    expect(proc.planModeActive).toBeNull()
  })

  it('每次 spawn 重新算：上一次进程收到的回执不能替这一次说话', async () => {
    const { proc, child } = await startedSession({ permissionMode: 'plan' })
    feed(child, setStatus('plan active'))
    expect(proc.planModeActive).toBe(true)

    const again = proc.start()
    await vi.advanceTimersByTimeAsync(500)
    await again

    expect(proc.planModeActive).toBeNull()
  })
})

describe('扩展对话框的往返（宿主不回帧就挂死）', () => {
  it.each(['select', 'confirm', 'input', 'editor'])('%s 一律立即回 cancelled', async (method) => {
    const { child } = await startedSession({ permissionMode: 'plan' })

    feed(child, { type: 'extension_ui_request', id: 'ui-9', method, title: 'Plan mode — what next?', options: ['A', 'B'] })

    expect(writtenFrames(child)).toEqual([{ type: 'extension_ui_response', id: 'ui-9', cancelled: true }])
    expect(loggerWarn).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining(`Extension dialog cancelled by host | method=${method}`),
    )
  })

  it('fire-and-forget 的方法不该被应答', async () => {
    const { child } = await startedSession({ permissionMode: 'plan' })

    feed(child, setStatus('plan active'))
    feed(child, { type: 'extension_ui_request', id: 'ui-n', method: 'notify', message: 'Plan mode enabled.', notifyType: 'info' })
    feed(child, { type: 'extension_ui_request', id: 'ui-w', method: 'setWidget', widgetKey: 'plan-mode-plan', widgetLines: ['x'] })

    expect(child.stdinWrite).not.toHaveBeenCalled()
  })

  it('没有 id 的对话框帧无从应答：记一行 warn，不写坏帧', async () => {
    const { child } = await startedSession({ permissionMode: 'plan' })

    feed(child, { type: 'extension_ui_request', method: 'confirm', title: 'Allow?' })

    expect(child.stdinWrite).not.toHaveBeenCalled()
    expect(loggerWarn).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining('Extension dialog request without an id'),
    )
  })
})

describe('setPlanMode', () => {
  /** 取出宿主为这次切换写出去的 prompt 帧 */
  function promptFrame(child: FakeChild): any {
    const frame = writtenFrames(child).find(f => f.type === 'prompt')
    expect(frame, '没有写出 prompt 帧').toBeTruthy()
    return frame
  }

  it('进 plan 发 /plan start，回执到了才算成功', async () => {
    const { proc, child } = await startedSession({ permissionMode: 'plan' })

    const pending = proc.setPlanMode(true)
    const frame = promptFrame(child)
    expect(frame.message).toBe('/plan start')
    // 轮次进行中的命令帧必须排队，否则 pi 直接抛「already processing」
    expect(frame.streamingBehavior).toBe('followUp')

    feed(child, ackOf(frame.id))
    await vi.advanceTimersByTimeAsync(0)
    feed(child, setStatus('plan active'))

    await expect(pending).resolves.toBe(true)
    expect(proc.planModeActive).toBe(true)
  })

  it('退 plan 发 /plan exit', async () => {
    const { proc, child } = await startedSession({ permissionMode: 'plan' })
    feed(child, setStatus('plan active'))

    const pending = proc.setPlanMode(false)
    const frame = promptFrame(child)
    expect(frame.message).toBe('/plan exit')

    feed(child, ackOf(frame.id))
    await vi.advanceTimersByTimeAsync(0)
    feed(child, setStatus())

    await expect(pending).resolves.toBe(true)
  })

  it('ack 只说明命令被接住：回执等不到就是没生效', async () => {
    const { proc, child } = await startedSession({ permissionMode: 'plan' })

    const pending = proc.setPlanMode(true)
    const frame = promptFrame(child)
    feed(child, ackOf(frame.id))

    await vi.advanceTimersByTimeAsync(5_000)

    await expect(pending).resolves.toBe(false)
  })

  it('进程没带扩展时不发命令，直接报「无从生效」', async () => {
    H.existing.delete(DEV_EXT)
    const { proc, child } = await startedSession({ permissionMode: 'plan' })

    await expect(proc.setPlanMode(true)).resolves.toBe(false)
    expect(writtenFrames(child)).toHaveLength(0)
  })

  it('进程已经没了就抛 —— 静默 resolve 等于谎报「已下发」', async () => {
    const { proc } = await startedSession({ permissionMode: 'plan' })
    await proc.kill()

    await expect(proc.setPlanMode(true)).rejects.toThrow(/no running process to apply plan mode/)
  })
})
