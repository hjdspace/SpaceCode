// @vitest-environment node
/**
 * SessionProcess.sendMessage 的侧边任务上下文注入：
 * 首条消息把快照包在用户问题前面，config 上的路径随即清除（一次性），
 * 第二条消息不再注入 —— 进程重建也不重复（--resume 的历史里首条已带）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SessionProcess } from '../sessionProcess'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/spacecode-test-userdata'),
  },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), processRaw: vi.fn(), setSessionLogPath: vi.fn(), sdkMessage: vi.fn(), traceEvent: vi.fn(),
}))

function makeFakeProcess(): any {
  return {
    pid: 1234,
    killed: false,
    stdin: { writable: true, write: vi.fn() },
  }
}

function lastUserText(proc: SessionProcess): string {
  const calls = (proc.process!.stdin!.write as ReturnType<typeof vi.fn>).mock.calls
  const frame = JSON.parse(calls[calls.length - 1][0])
  const content = frame.message.content
  return typeof content === 'string' ? content : content.find((b: any) => b.type === 'text')?.text
}

describe('SessionProcess — side task context injection', () => {
  let tmpRoot = ''
  let contextPath = ''

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'side-claude-'))
    contextPath = path.join(tmpRoot, 'side-task-context-sess-side.md')
    fs.writeFileSync(contextPath, '<SIDE_CHAT_CONTEXT>snapshot</SIDE_CHAT_CONTEXT>', 'utf8')
  })

  it('首条消息包裹快照并清除 config 路径，第二条不再注入', () => {
    const proc = new SessionProcess('sess-side', { cwd: tmpRoot, sideTaskContextPath: contextPath })
    proc.process = makeFakeProcess()

    proc.sendMessage('主会话在做什么？')
    const first = lastUserText(proc)
    expect(first).toContain('<SIDE_CHAT_CONTEXT>snapshot</SIDE_CHAT_CONTEXT>')
    expect(first.endsWith('主会话在做什么？')).toBe(true)
    expect(proc.config.sideTaskContextPath).toBeUndefined()
    // 注入落地后快照文件即清理
    expect(fs.existsSync(contextPath)).toBe(false)

    proc.sendMessage('第二条')
    expect(lastUserText(proc)).not.toContain('<SIDE_CHAT_CONTEXT>')
  })

  it('写入失败时回滚标记与路径，下一条消息补注入', () => {
    const proc = new SessionProcess('sess-side-rollback', { cwd: tmpRoot, sideTaskContextPath: contextPath })
    const fake = makeFakeProcess()
    fake.stdin.write.mockImplementationOnce(() => { throw new Error('EPIPE') })
    proc.process = fake

    expect(() => proc.sendMessage('主会话在做什么？')).toThrow('EPIPE')
    expect(proc.config.sideTaskContextPath).toBe(contextPath)

    proc.sendMessage('重试')
    const retry = lastUserText(proc)
    expect(retry).toContain('<SIDE_CHAT_CONTEXT>snapshot</SIDE_CHAT_CONTEXT>')
    expect(retry.endsWith('重试')).toBe(true)
    expect(fs.existsSync(contextPath)).toBe(false)
  })

  it('快照文件缺失时降级为普通消息，路径同样清除', () => {
    const proc = new SessionProcess('sess-side-missing', {
      cwd: tmpRoot,
      sideTaskContextPath: path.join(tmpRoot, 'no-such-file.md'),
    })
    proc.process = makeFakeProcess()

    proc.sendMessage('普通问题')
    expect(lastUserText(proc)).toBe('普通问题')
    expect(proc.config.sideTaskContextPath).toBeUndefined()
  })
})
