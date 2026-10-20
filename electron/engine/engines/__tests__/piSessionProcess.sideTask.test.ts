// @vitest-environment node
/**
 * PiSessionProcess.sendMessage 的侧边任务上下文注入：
 * 首条 prompt 把快照包在用户问题前面并清除 config 路径（一次性）；
 * 带 @路径引用前缀的轮次也不得把已包裹的正文冲掉。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PiSessionProcess } from '../PiSessionProcess'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app/root',
    getPath: vi.fn(() => '/tmp/spacecode-test-userdata'),
  },
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), processRaw: vi.fn(), setSessionLogPath: vi.fn(), sdkMessage: vi.fn(), traceEvent: vi.fn(),
}))

describe('PiSessionProcess — side task context injection', () => {
  let tmpRoot = ''
  let contextPath = ''

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'side-pi-'))
    contextPath = path.join(tmpRoot, 'side-task-context-sess-pi.md')
    fs.writeFileSync(contextPath, '<SIDE_CHAT_CONTEXT>snapshot</SIDE_CHAT_CONTEXT>', 'utf8')
  })

  function makeProc(config: Record<string, unknown>): { proc: PiSessionProcess; rpcRequest: ReturnType<typeof vi.fn> } {
    const proc = new PiSessionProcess('sess-pi-side', config as any)
    ;(proc as any)._process = { pid: 1 }
    ;(proc as any).status = 'idle'
    const rpcRequest = vi.fn().mockResolvedValue({ success: true })
    ;(proc as any).rpcRequest = rpcRequest
    return { proc, rpcRequest }
  }

  function lastPrompt(rpcRequest: ReturnType<typeof vi.fn>): string {
    const frame = rpcRequest.mock.calls[rpcRequest.mock.calls.length - 1][1]
    return frame.message
  }

  it('首条 prompt 包裹快照并清除 config 路径，第二条不再注入', async () => {
    const { proc, rpcRequest } = makeProc({ cwd: tmpRoot, sideTaskContextPath: contextPath })

    await proc.sendMessage('主会话在做什么？')
    const first = lastPrompt(rpcRequest)
    expect(first).toContain('<SIDE_CHAT_CONTEXT>snapshot</SIDE_CHAT_CONTEXT>')
    expect(first.endsWith('主会话在做什么？')).toBe(true)
    expect((proc as any).config.sideTaskContextPath).toBeUndefined()
    // 注入落地后快照文件即清理
    expect(fs.existsSync(contextPath)).toBe(false)

    await proc.sendMessage('第二条')
    expect(lastPrompt(rpcRequest)).toBe('第二条')
  })

  it('prompt 被拒时回滚标记与路径，下一条补注入', async () => {
    const { proc, rpcRequest } = makeProc({ cwd: tmpRoot, sideTaskContextPath: contextPath })
    rpcRequest.mockRejectedValueOnce(new Error('Agent is already processing...'))

    await expect(proc.sendMessage('主会话在做什么？')).rejects.toThrow('already processing')
    expect((proc as any).config.sideTaskContextPath).toBe(contextPath)
    expect(fs.existsSync(contextPath)).toBe(true)

    await proc.sendMessage('重试')
    const retry = lastPrompt(rpcRequest)
    expect(retry).toContain('<SIDE_CHAT_CONTEXT>snapshot</SIDE_CHAT_CONTEXT>')
    expect(retry.endsWith('重试')).toBe(true)
    expect(fs.existsSync(contextPath)).toBe(false)
  })

  it('@路径引用前缀叠加在已包裹正文之前，不冲掉快照', async () => {
    const { proc, rpcRequest } = makeProc({ cwd: tmpRoot, sideTaskContextPath: contextPath })
    ;(proc as any).saveImageToTemp = vi.fn(() => '/tmp/upload/img.png')

    await proc.sendMessage('看看这张图', [{ id: 'i1', name: 'img.png', type: 'image', mimeType: 'image/png', previewUrl: '', data: 'x' }])

    const prompt = lastPrompt(rpcRequest)
    expect(prompt.indexOf('@"/tmp/upload/img.png"')).toBeLessThan(prompt.indexOf('<SIDE_CHAT_CONTEXT>'))
    expect(prompt.endsWith('看看这张图')).toBe(true)
  })
})
