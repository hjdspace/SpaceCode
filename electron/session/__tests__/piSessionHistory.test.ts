// @vitest-environment node
/**
 * pi 历史恢复适配层。
 *
 * 核心约束：pi JSONL 的 id 是 pi 自己的 UUID，SpaceCode 的 sessionId 只在
 * pi-sessions.json 里；因此列表必须从注册表出发，消息要归一化成 Claude JSONL
 * 形状，才能复用渲染层的水合管线。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const H = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => H.userDataDir } }))
vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

let tmpRoot = ''
let sessionDir = ''

function writeRegistry(records: Record<string, { sessionFile: string; cwd: string; ephemeral?: boolean }>) {
  fs.mkdirSync(H.userDataDir, { recursive: true })
  fs.writeFileSync(path.join(H.userDataDir, 'pi-sessions.json'), JSON.stringify(records, null, 2), 'utf8')
}

function writePiFile(name: string, records: unknown[]): string {
  fs.mkdirSync(sessionDir, { recursive: true })
  const file = path.join(sessionDir, name)
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n'), 'utf8')
  return file
}

const CWD = 'D:\\work\\project'

function header(id: string, timestamp: string) {
  return { type: 'session', version: 3, id, timestamp, cwd: CWD }
}

function userMessage(id: string, text: string, timestamp: string) {
  return {
    type: 'message',
    id,
    timestamp,
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

function assistantMessage(id: string, timestamp: string, content: unknown[]) {
  return {
    type: 'message',
    id,
    timestamp,
    message: { role: 'assistant', content, model: 'glm-5.3-flash' },
  }
}

function toolResult(id: string, toolCallId: string, timestamp: string, text: string, isError = false) {
  return {
    type: 'message',
    id,
    timestamp,
    message: {
      role: 'toolResult',
      toolCallId,
      toolName: 'read',
      content: [{ type: 'text', text }],
      isError,
    },
  }
}

async function loadModule() {
  vi.resetModules()
  return await import('../piSessionHistory')
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-history-'))
  H.userDataDir = path.join(tmpRoot, 'userData')
  sessionDir = path.join(tmpRoot, '.pi', 'agent', 'sessions', '--D--work-project--')
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('listPiSessions', () => {
  it('uses pi-sessions.json keys as SpaceCode ids and ignores ephemeral side tasks', async () => {
    const file = writePiFile('2026-10-20T03-20-57-838Z_pi-internal-1.jsonl', [
      header('pi-internal-1', '2026-10-20T03:20:57.838Z'),
      userMessage('u1', '第一轮问题', '2026-10-20T03:21:00.000Z'),
      assistantMessage('a1', '2026-10-20T03:21:05.000Z', [{ type: 'text', text: '回答' }]),
    ])
    const ephFile = writePiFile('2026-10-20T04-00-00-000Z_pi-internal-2.jsonl', [
      header('pi-internal-2', '2026-10-20T04:00:00.000Z'),
      userMessage('u2', '侧边任务', '2026-10-20T04:00:01.000Z'),
    ])
    writeRegistry({
      'spacecode-session-1': { sessionFile: file, cwd: CWD },
      'spacecode-side-task': { sessionFile: ephFile, cwd: CWD, ephemeral: true },
      'spacecode-missing': { sessionFile: path.join(sessionDir, 'nope.jsonl'), cwd: CWD },
    })

    const { listPiSessions } = await loadModule()
    const sessions = listPiSessions()

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'spacecode-session-1',
      engineType: 'pi',
      engineSessionId: 'pi-internal-1',
      projectPath: CWD,
      firstUserMessage: '第一轮问题',
      lastMessageTimestamp: Date.parse('2026-10-20T03:21:05.000Z'),
      createdAt: Date.parse('2026-10-20T03:20:57.838Z'),
    })
  })

  it('filters by project cwd', async () => {
    const file = writePiFile('s.jsonl', [
      header('pi-1', '2026-10-20T03:20:57.838Z'),
      userMessage('u1', 'hello', '2026-10-20T03:21:00.000Z'),
    ])
    writeRegistry({ 's-1': { sessionFile: file, cwd: CWD } })

    const { listPiSessions } = await loadModule()

    expect(listPiSessions('D:/WORK/PROJECT/')).toHaveLength(1)
    expect(listPiSessions('D:\\other')).toHaveLength(0)
  })

  it('reads only the head and tail of large transcripts', async () => {
    const records: unknown[] = [
      header('pi-large', '2026-10-20T03:20:57.838Z'),
      userMessage('u1', 'large session', '2026-10-20T03:21:00.000Z'),
    ]
    // 每条约 300B，凑到 384KB 以上，强制走 head/tail 分支
    for (let i = 0; i < 1600; i++) {
      records.push(toolResult(`t${i}`, `call-${i}`, '2026-10-20T03:30:00.000Z', 'x'.repeat(200)))
    }
    records.push(assistantMessage('a-last', '2026-10-20T05:00:00.000Z', [{ type: 'text', text: 'done' }]))
    const file = writePiFile('large.jsonl', records)
    expect(fs.statSync(file).size).toBeGreaterThan(384 * 1024)
    writeRegistry({ 'spacecode-large': { sessionFile: file, cwd: CWD } })

    const { listPiSessions } = await loadModule()
    const [session] = listPiSessions()

    expect(session.firstUserMessage).toBe('large session')
    expect(session.engineSessionId).toBe('pi-large')
    expect(session.lastMessageTimestamp).toBe(Date.parse('2026-10-20T05:00:00.000Z'))
  })
})

describe('getPiFullSession', () => {
  it('normalizes user/assistant/toolResult into the Claude JSONL shape', async () => {
    const file = writePiFile('chat.jsonl', [
      header('pi-internal-9', '2026-10-20T03:20:57.838Z'),
      { type: 'model_change', id: 'mc', timestamp: '2026-10-20T03:20:58.000Z', provider: 'openai-compat', modelId: 'glm' },
      userMessage('u1', '读一下文件', '2026-10-20T03:21:00.000Z'),
      assistantMessage('a1', '2026-10-20T03:21:05.000Z', [
        { type: 'thinking', thinking: '先看文件' },
        { type: 'text', text: '我来读' },
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'x.ts' } },
      ]),
      toolResult('t1', 'call-1', '2026-10-20T03:21:06.000Z', 'file body'),
      assistantMessage('a2', '2026-10-20T03:21:07.000Z', [{ type: 'text', text: '读完了' }]),
    ])
    writeRegistry({ 'spacecode-9': { sessionFile: file, cwd: CWD } })

    const { getPiFullSession } = await loadModule()
    const full = getPiFullSession('spacecode-9', 'D:/work/project')

    expect(full).not.toBeNull()
    expect(full!.engineType).toBe('pi')
    expect(full!.engineSessionId).toBe('pi-internal-9')
    expect(full!.projectPath).toBe(CWD)
    expect(full!.messages).toHaveLength(4)

    const assistant = full!.messages[1] as any
    expect(assistant.type).toBe('assistant')
    expect(assistant.message.content).toEqual([
      { type: 'thinking', thinking: '先看文件' },
      { type: 'text', text: '我来读' },
      { type: 'tool_use', id: 'call-1', name: 'Read', input: { path: 'x.ts' } },
    ])

    const tool = full!.messages[2] as any
    expect(tool.type).toBe('user')
    expect(tool.message.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'call-1',
      is_error: false,
    })
  })

  it('refuses a cwd mismatch so a pi transcript is never replayed in the wrong project', async () => {
    const file = writePiFile('chat.jsonl', [header('pi-1', '2026-10-20T03:20:57.838Z')])
    writeRegistry({ 's-1': { sessionFile: file, cwd: CWD } })

    const { getPiFullSession } = await loadModule()

    expect(getPiFullSession('s-1', 'D:\\other')).toBeNull()
    expect(getPiFullSession('s-1')).not.toBeNull()
  })

  it('returns null when the transcript file is gone', async () => {
    writeRegistry({ 's-1': { sessionFile: path.join(sessionDir, 'missing.jsonl'), cwd: CWD } })

    const { getPiFullSession } = await loadModule()

    expect(getPiFullSession('s-1')).toBeNull()
  })
})
