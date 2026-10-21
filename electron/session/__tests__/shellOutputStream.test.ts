// @vitest-environment node
/**
 * claude-code 的 Bash 实时输出旁路：从 CLI 的 task output 文件 tail 增量。
 *
 * 这里钉住三件事：
 *  - tasks 目录推导与 cwd 口径（找不到时按 sessionId 扫描兜底）
 *  - 文件认领只发生在「工具启动之后出现的文件」，按 tool_use 顺序 FIFO
 *  - 读取是快照语义：ANSI/CR 清理、超长只留尾部、release 后不再推送
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => '/home/u') },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

import {
  ShellOutputStream,
  claudeTempDirName,
  resolveExactTasksDir,
  sanitizeTerminalText,
} from '../shellOutputStream'

const ENGINE_SESSION_ID = 'engine-session-1234'

let tempRoot: string
let tasksDir: string

function setupTasksDir(): void {
  tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-shell-output-')))
  tasksDir = path.join(tempRoot, claudeTempDirName(), 'D--proj', ENGINE_SESSION_ID, 'tasks')
  fs.mkdirSync(tasksDir, { recursive: true })
}

function writeOutput(name: string, content: string): string {
  const filePath = path.join(tasksDir, name)
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

function makeStream(onSnapshot: (toolUseId: string, text: string) => void, overrides: Record<string, unknown> = {}) {
  return new ShellOutputStream({
    engineSessionId: ENGINE_SESSION_ID,
    cwd: 'D:/proj',
    tempRoot,
    pollIntervalMs: 20,
    onSnapshot,
    ...overrides,
  })
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

beforeEach(setupTasksDir)

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

describe('tasks 目录推导', () => {
  it('按 realpath(cwd) + sessionId 拼出精确目录', () => {
    expect(resolveExactTasksDir({ tempRoot, cwd: 'D:/proj', engineSessionId: ENGINE_SESSION_ID }))
      .toBe(path.join(tempRoot, claudeTempDirName(), 'D--proj', ENGINE_SESSION_ID, 'tasks'))
  })

  it('cwd 缺失时返回 null，由扫描兜底', () => {
    expect(resolveExactTasksDir({ tempRoot, engineSessionId: ENGINE_SESSION_ID })).toBeNull()
  })
})

describe('sanitizeTerminalText', () => {
  it('剥掉 CSI/OSC 并保留 \\r 进度条最后一帧', () => {
    const raw = '\u001b[31mred\u001b[0m\nprogress 1\rprogress 2\n\u001b]0;title\u0007done'
    expect(sanitizeTerminalText(raw)).toBe('red\nprogress 2\ndone')
  })
})

describe('ShellOutputStream', () => {
  it('把文件增量合成快照，release 后停止推送', async () => {
    const snapshots: Array<{ toolUseId: string; text: string }> = []
    const stream = makeStream((toolUseId, text) => snapshots.push({ toolUseId, text }))
    stream.registerTool('tu-1')

    writeOutput('local_bash_1.output', 'hello')
    await waitFor(() => {
      expect(snapshots.some(s => s.toolUseId === 'tu-1' && s.text.includes('hello'))).toBe(true)
    })

    fs.appendFileSync(path.join(tasksDir, 'local_bash_1.output'), '\nworld', 'utf8')
    await waitFor(() => {
      expect(snapshots[snapshots.length - 1]?.text).toContain('world')
    })

    stream.releaseTool('tu-1')
    const count = snapshots.length
    fs.appendFileSync(path.join(tasksDir, 'local_bash_1.output'), '\nafter release', 'utf8')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(snapshots.length).toBe(count)
    expect(stream.hasPendingTools()).toBe(false)
    stream.dispose()
  })

  it('超长输出只保留尾部', async () => {
    const snapshots: string[] = []
    const stream = makeStream((_toolUseId, text) => snapshots.push(text))
    stream.registerTool('tu-long')

    writeOutput('local_bash_long.output', 'HEAD_MARK\n' + 'a'.repeat(40_000) + '\nTAIL_END')
    await waitFor(() => {
      expect(snapshots[snapshots.length - 1]?.endsWith('TAIL_END')).toBe(true)
    })
    expect(snapshots[snapshots.length - 1]!.length).toBeLessThanOrEqual(30_000)
    expect(snapshots[snapshots.length - 1]!.includes('HEAD_MARK')).toBe(false)
    stream.dispose()
  })

  it('按 tool_use 顺序认领并发输出文件', async () => {
    const snapshots: Array<{ toolUseId: string; text: string }> = []
    const stream = makeStream((toolUseId, text) => snapshots.push({ toolUseId, text }))
    stream.registerTool('tu-a')
    stream.registerTool('tu-b')

    writeOutput('local_bash_a.output', 'output A')
    await waitFor(() => {
      expect(snapshots.some(s => s.toolUseId === 'tu-a' && s.text.includes('output A'))).toBe(true)
    })

    writeOutput('local_bash_b.output', 'output B')
    await waitFor(() => {
      expect(snapshots.some(s => s.toolUseId === 'tu-b' && s.text.includes('output B'))).toBe(true)
    })
    stream.dispose()
  })

  it('cwd 对不上时按 sessionId 扫描目录', async () => {
    const snapshots: string[] = []
    const stream = makeStream((_toolUseId, text) => snapshots.push(text), {
      cwd: 'E:/somewhere/else',
    })
    stream.registerTool('tu-scan')

    writeOutput('local_bash_scan.output', 'scanned output')
    await waitFor(() => {
      expect(snapshots[snapshots.length - 1]).toContain('scanned output')
    })
    stream.dispose()
  })

  it('dispose 后不再读取文件', async () => {
    const snapshots: string[] = []
    const stream = makeStream((_toolUseId, text) => snapshots.push(text))
    stream.registerTool('tu-dispose')
    writeOutput('local_bash_dispose.output', 'before dispose')
    await waitFor(() => {
      expect(snapshots[snapshots.length - 1]).toContain('before dispose')
    })

    stream.dispose()
    const count = snapshots.length
    fs.appendFileSync(path.join(tasksDir, 'local_bash_dispose.output'), '\nafter dispose', 'utf8')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(snapshots.length).toBe(count)
    expect(stream.hasPendingTools()).toBe(false)
  })
})
