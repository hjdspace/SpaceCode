// @vitest-environment node
/**
 * SessionProcess 的实时 Bash 输出接线：
 * init 拿到 engineSessionId → Bash tool_use 登记 → CLI 的 task output 文件
 * 增量被合成成 pi 同款的 tool_execution_delta → tool_result 后停止。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/home/u'),
  },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  processRaw: vi.fn(),
  sdkMessage: vi.fn(),
  setSessionLogPath: vi.fn(),
  traceEvent: vi.fn(),
}))

vi.mock('../../infra/proxyManager', () => ({
  proxyManager: { getProxyUrl: vi.fn(() => null), start: vi.fn() },
  buildProxyConfigFromSettings: vi.fn(() => null),
}))

vi.mock('../../tools/mcpConfigStore', () => ({
  buildEnabledMcpConfig: vi.fn(() => null),
}))

vi.mock('../../tools/officeCliService', () => ({
  getOfficeCliInstallDir: vi.fn(() => '/office/bin'),
  syncInstalledOfficeCli: vi.fn(() => ({ copied: false, reason: 'up-to-date', bundledVersion: null, installedVersion: null })),
}))

vi.mock('../../tools/rtkManager', () => ({
  rtkManager: { isBinaryInstalled: vi.fn(() => false), getBinaryDir: vi.fn(() => '/rtk') },
}))

vi.mock('../engineChildProcess', () => ({
  killTree: vi.fn(),
  resolveBunPath: vi.fn(() => 'bun'),
  resolveBunPathForPackagedDesktop: vi.fn(() => null),
  isProbableBunExecutable: vi.fn(() => false),
  resolveCliRoot: vi.fn(() => '/engine-root'),
}))

import { SessionProcess, type SessionConfig } from '../sessionProcess'
import { claudeTempDirName } from '../shellOutputStream'

function baseConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return { cwd: '/tmp/ws', provider: 'anthropic', permissionMode: 'default', ...overrides }
}

interface FakeChild {
  child: any
  stdout: EventEmitter
}

function makeChild(): FakeChild {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const child = new EventEmitter() as any
  child.stdout = stdout
  child.stderr = stderr
  child.stdin = { writable: true, write: vi.fn() }
  child.pid = 4242
  child.killed = false
  child.kill = vi.fn(() => true)
  return { child, stdout }
}

function wired(sessionId: string): SessionProcess & { _child: FakeChild } {
  const proc = new SessionProcess(sessionId, baseConfig()) as any
  const fakes = makeChild()
  proc.process = fakes.child
  proc._child = fakes
  proc.attachProcessListeners(fakes.child)
  return proc
}

function feed(proc: any, chunk: string): void {
  proc._child.stdout.emit('data', Buffer.from(chunk, 'utf8'))
}

async function waitFor(assertion: () => void, timeoutMs = 3_000): Promise<void> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      assertion()
      return
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
}

let tempRoot: string | undefined
let previousTmpDir: string | undefined
let proc: any

beforeEach(() => {
  previousTmpDir = process.env.CLAUDE_CODE_TMPDIR
  tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-session-live-')))
  process.env.CLAUDE_CODE_TMPDIR = tempRoot
  proc = undefined
  vi.clearAllMocks()
})

afterEach(() => {
  proc?.kill()
  proc?.removeAllListeners()
  if (previousTmpDir === undefined) delete process.env.CLAUDE_CODE_TMPDIR
  else process.env.CLAUDE_CODE_TMPDIR = previousTmpDir
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

function tasksDirFor(engineSessionId: string): string {
  const dir = path.join(tempRoot!, claudeTempDirName(), '-tmp-ws', engineSessionId, 'tasks')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

describe('SessionProcess live Bash output', () => {
  it('把 task output 文件的增量合成 tool_execution_delta，并在 tool_result 后停止', async () => {
    proc = wired('sess-live-0001')
    const seen: any[] = []
    proc.on('message', (msg: any) => seen.push(msg))

    feed(proc, '{"type":"system","subtype":"init","session_id":"eng-live-1"}\n')
    feed(proc, '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu-live","name":"Bash","input":{"command":"npm test"}}]}}\n')

    const tasksDir = tasksDirFor('eng-live-1')
    const filePath = path.join(tasksDir, 'local_bash_1.output')
    fs.writeFileSync(filePath, 'streamed output', 'utf8')

    const deltas = () =>
      seen.filter(
        msg =>
          msg.type === 'stream_event' &&
          msg.event?.delta?.type === 'tool_execution_delta' &&
          msg.event.delta.toolCallId === 'tu-live',
      )

    await waitFor(() => {
      expect(deltas().some(msg =>
        msg.event.delta.partialResult.content[0].text.includes('streamed output'),
      )).toBe(true)
    })

    // 官方 CLI 的结束形状：user 消息里带 tool_result block
    feed(proc, '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu-live","content":"done"}]}}\n')
    const count = deltas().length
    fs.appendFileSync(filePath, '\nafter result', 'utf8')
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(deltas().length).toBe(count)
  })

  it('没有 init / 没有 tasks 目录时保持静默，不影响消息透传', async () => {
    proc = wired('sess-live-0002')
    const seen: any[] = []
    proc.on('message', (msg: any) => seen.push(msg))

    feed(proc, '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu-none","name":"Bash","input":{"command":"npm test"}}]}}\n')
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(seen.some(msg => msg.type === 'stream_event')).toBe(false)
    expect(seen.some(msg => msg.type === 'assistant')).toBe(true)
  })
})
