// @vitest-environment node
/**
 * 侧边任务 transcript 快照摘要：
 * - claude/pi 两种 JSONL → 对话主线的抽取规则（跳过 sidechain/meta/thinking/tool_result）；
 * - buildSideTaskContext 走真实 SessionHistoryManager 读 ~/.claude（CLAUDE_CONFIG_DIR 指到临时目录）
 *   与 mock 的 piSessionRegistry，两侧都是"模块 import 进来"的缝上测试（ADR-0011）；
 * - resolveSideTaskContextPath 落盘/降级契约。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/spacecode-test-userdata'),
  },
}))

vi.mock('../../engine/engines/piSessionRegistry', () => ({
  findPiSessionFile: vi.fn(),
}))

import {
  digestFromClaudeMessages,
  digestFromPiEntries,
  buildSideTaskContext,
  resolveSideTaskContextPath,
  readSideTaskContextFile,
} from '../transcriptDigest'
import { findPiSessionFile } from '../../engine/engines/piSessionRegistry'

const mockedFindPiSessionFile = vi.mocked(findPiSessionFile)

function sanitizeForClaudeDir(p: string): string {
  return fs.realpathSync(p).normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-')
}

let tmpRoot = ''

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'side-digest-'))
  process.env.CLAUDE_CONFIG_DIR = tmpRoot
})

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('digestFromClaudeMessages', () => {
  it('保留 user/assistant 文本与 tool_use 一行摘要，跳过 sidechain/meta/summary/纯 tool_result', () => {
    const lines = digestFromClaudeMessages([
      { type: 'summary', summary: 'title' },
      { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
      { type: 'user', message: { role: 'user', content: '帮我修 bug' } },
      { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'sidechain noise' }] } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'internal' },
            { type: 'text', text: '好的，先看代码' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'd:/x/a.ts' } },
          ],
        },
      },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'file body' }] } },
    ])

    expect(lines).toEqual([
      { role: 'user', text: '帮我修 bug' },
      { role: 'assistant', text: '好的，先看代码\n(tool: Read: d:/x/a.ts)' },
    ])
  })
})

describe('digestFromPiEntries', () => {
  it('只认 type:message，text 进主线、toolCall 压一行、thinking 与其余事件跳过', () => {
    const lines = digestFromPiEntries([
      { type: 'session', version: 3, id: 'x', cwd: '/p' },
      { type: 'model_change', provider: 'openai', modelId: 'gpt' },
      { type: 'message', message: { role: 'user', content: [{ type: 'text', text: '你是什么模型' }] } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'reasoning' },
            { type: 'toolCall', id: '1', name: 'bash', arguments: { command: 'ls' } },
            { type: 'text', text: '我是 pi' },
          ],
        },
      },
    ])

    expect(lines).toEqual([
      { role: 'user', text: '你是什么模型' },
      { role: 'assistant', text: '(tool: bash: ls)\n我是 pi' },
    ])
  })
})

describe('buildSideTaskContext', () => {
  it('claude 源：读 ~/.claude/projects 的 JSONL，输出角色提示 + 对话主线', async () => {
    const projectDir = path.join(tmpRoot, 'projects', sanitizeForClaudeDir(tmpRoot))
    fs.mkdirSync(projectDir, { recursive: true })
    const entry = { type: 'user', message: { role: 'user', content: '主会话的问题' } }
    fs.writeFileSync(
      path.join(projectDir, 'src-sess-1.jsonl'),
      JSON.stringify(entry) + '\n' + '{broken line}\n',
      'utf8',
    )

    const context = await buildSideTaskContext({
      sideTaskSourceSessionId: 'src-sess-1',
      sideTaskSourceEngine: 'claude-code',
      cwd: tmpRoot,
    })

    expect(context).toContain('<SIDE_CHAT_CONTEXT>')
    expect(context).toContain('[user] 主会话的问题')
    expect(context).toContain('</main_session_transcript>')
  })

  it('claude 源：transcript 不存在时返回 null（静默退化为普通新会话）', async () => {
    const context = await buildSideTaskContext({
      sideTaskSourceSessionId: 'no-such-sess',
      sideTaskSourceEngine: 'claude-code',
      cwd: tmpRoot,
    })
    expect(context).toBeNull()
  })

  it('pi 源：经 piSessionRegistry 找到 session file 后按 pi 格式解析', async () => {
    const sessionFile = path.join(tmpRoot, 'pi-session.jsonl')
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'pi 主线' }] } }),
      'utf8',
    )
    mockedFindPiSessionFile.mockReturnValue(sessionFile)

    const context = await buildSideTaskContext({
      sideTaskSourceSessionId: 'src-pi-1',
      sideTaskSourceEngine: 'pi',
      cwd: tmpRoot,
    })

    expect(mockedFindPiSessionFile).toHaveBeenCalledWith('src-pi-1', tmpRoot)
    expect(context).toContain('[user] pi 主线')
  })

  it('缺来源或缺 cwd 直接返回 null', async () => {
    expect(await buildSideTaskContext({ sideTaskSourceSessionId: 'x', cwd: '' })).toBeNull()
    expect(await buildSideTaskContext({ cwd: tmpRoot })).toBeNull()
  })
})

describe('resolveSideTaskContextPath', () => {
  it('有来源时落盘快照文件并可回读；无来源返回 undefined', async () => {
    const projectDir = path.join(tmpRoot, 'projects', sanitizeForClaudeDir(tmpRoot))
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(
      path.join(projectDir, 'src-sess-2.jsonl'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
      'utf8',
    )

    const filePath = await resolveSideTaskContextPath('side-sess-2', {
      sideTaskSourceSessionId: 'src-sess-2',
      sideTaskSourceEngine: 'claude-code',
      cwd: tmpRoot,
    })

    expect(filePath).toBeTruthy()
    expect(path.basename(filePath as string)).toBe('side-task-context-side-sess-2.md')
    expect(readSideTaskContextFile(filePath as string)).toContain('[user] hello')

    expect(await resolveSideTaskContextPath('side-sess-3', { cwd: tmpRoot })).toBeUndefined()
  })
})
