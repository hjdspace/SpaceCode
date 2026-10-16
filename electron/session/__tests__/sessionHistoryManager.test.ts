// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SessionHistoryManager, type SessionLite } from '../sessionHistoryManager'

// --- Mocks ---

const osState = vi.hoisted(() => ({ home: '' }))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const patched = { ...actual, homedir: () => osState.home }
  return { ...patched, default: patched }
})

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// --- Fixtures ---

let tmpRoot = ''
let savedXdg: string | undefined
let savedClaudeConfigDir: string | undefined

function claudeHome(): string {
  return path.join(osState.home, '.claude')
}

function projectsDir(): string {
  return path.join(claudeHome(), 'projects')
}

function projectDir(cwd: string): string {
  const slug = fs.realpathSync(cwd).normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-')
  return path.join(projectsDir(), slug)
}

function writeSession(cwd: string, sessionId: string, lines: unknown[]): string {
  const dir = projectDir(cwd)
  const file = path.join(dir, `${sessionId}.jsonl`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, lines.map((e) => JSON.stringify(e)).join('\n'), 'utf8')
  return file
}

function writeMetadata(cwd: string, sessionId: string, metadata: unknown): void {
  const dir = projectDir(cwd)
  const file = path.join(dir, `${sessionId}.metadata.json`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(metadata), 'utf8')
}

function userMsg(content: unknown, timestamp?: string) {
  return { type: 'user', timestamp, message: { role: 'user', content } }
}

function assistantMsg(timestamp?: string) {
  return { type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }
}

describe('SessionHistoryManager', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hist-'))
    osState.home = path.join(tmpRoot, 'home')
    fs.mkdirSync(path.join(osState.home, '.claude'), { recursive: true })
    savedXdg = process.env.XDG_CONFIG_HOME
    savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    delete process.env.XDG_CONFIG_HOME
    delete process.env.CLAUDE_CONFIG_DIR
  })

  afterEach(() => {
    if (savedXdg !== undefined) process.env.XDG_CONFIG_HOME = savedXdg
    else delete process.env.XDG_CONFIG_HOME
    if (savedClaudeConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir
    else delete process.env.CLAUDE_CONFIG_DIR
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  // ── listProjectSessions ──────────────────────────────────────

  describe('listProjectSessions', () => {
    it('项目目录不存在时返回空数组', async () => {
      const result = await SessionHistoryManager.listProjectSessions(path.join(tmpRoot, 'nope'))
      expect(result).toEqual([])
    })

    it('返回指定项目的所有会话', async () => {
      const projectPath = path.join(tmpRoot, 'myproject')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 's1', [
        userMsg('hello', '2026-01-01T00:00:00.000Z'),
        assistantMsg('2026-01-01T00:00:01.000Z'),
      ])
      writeSession(projectPath, 's2', [
        userMsg('world', '2026-01-02T00:00:00.000Z'),
        assistantMsg('2026-01-02T00:00:01.000Z'),
      ])

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result).toHaveLength(2)
      expect(result.map((s) => s.sessionId).sort()).toEqual(['s1', 's2'])
    })

    it('按 lastMessageTimestamp 降序排序', async () => {
      const projectPath = path.join(tmpRoot, 'myproject')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 'old', [
        userMsg('old', '2026-01-01T00:00:00.000Z'),
      ])
      writeSession(projectPath, 'new', [
        userMsg('new', '2026-02-01T00:00:00.000Z'),
      ])

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result[0].sessionId).toBe('new')
      expect(result[1].sessionId).toBe('old')
    })

    it('提取 firstUserMessage（字符串 content）', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 's1', [
        userMsg('hello world', '2026-01-01T00:00:00.000Z'),
      ])

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result[0].firstUserMessage).toBe('hello world')
    })

    it('提取 firstUserMessage（数组 content 中的 text block）', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 's1', [
        userMsg([{ type: 'text', text: 'array message' }], '2026-01-01T00:00:00.000Z'),
      ])

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result[0].firstUserMessage).toBe('array message')
    })

    it('从 metadata.json 读取 lastMessageTimestamp', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 's1', [userMsg('hi')])
      writeMetadata(projectPath, 's1', {
        timestamps: { lastMessageAt: '2026-06-01T12:00:00.000Z' },
      })

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result[0].lastMessageTimestamp).toBe(Date.parse('2026-06-01T12:00:00.000Z'))
    })

    it('无 metadata 时从 JSONL 的 timestamp 字段推断 lastMessageTimestamp', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 's1', [
        userMsg('a', '2026-01-01T00:00:00.000Z'),
        assistantMsg('2026-01-02T00:00:00.000Z'),
      ])

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result[0].lastMessageTimestamp).toBe(Date.parse('2026-01-02T00:00:00.000Z'))
    })

    it('读取 metadata 中的 customTitle', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 's1', [userMsg('hi')])
      writeMetadata(projectPath, 's1', { customTitle: 'My Custom Title' })

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result[0].metadata?.customTitle).toBe('My Custom Title')
    })

    it('JSONL 中 cwd 字段覆盖 projectPath', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 's1', [
        { type: 'user', cwd: 'D:\\real\\path', message: { role: 'user', content: 'hi' } },
      ])

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result[0].projectPath).toBe('D:\\real\\path')
    })

    it('跳过以 . 开头和 .tmp 结尾的 session 文件', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 's1', [userMsg('visible', '2026-01-01T00:00:00.000Z')])
      writeSession(projectPath, '.hidden', [userMsg('hidden', '2026-01-01T00:00:00.000Z')])
      writeSession(projectPath, 'temp.tmp', [userMsg('temp', '2026-01-01T00:00:00.000Z')])

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result).toHaveLength(1)
      expect(result[0].sessionId).toBe('s1')
    })

    it('损坏的 JSON 行被跳过，有效行照常解析', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      const file = path.join(projectDir(projectPath), 's1.jsonl')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, [
        JSON.stringify(userMsg('hello', '2026-01-01T00:00:00.000Z')),
        '{ broken }',
        JSON.stringify(assistantMsg('2026-01-01T00:00:01.000Z')),
      ].join('\n'), 'utf8')

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result).toHaveLength(1)
      expect(result[0].firstUserMessage).toBe('hello')
    })

    it('CLAUDE_CONFIG_DIR 优先于 XDG_CONFIG_HOME', async () => {
      const customConfigDir = path.join(tmpRoot, 'custom-claude-config')
      fs.mkdirSync(path.join(customConfigDir, 'projects'), { recursive: true })
      process.env.CLAUDE_CONFIG_DIR = customConfigDir

      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      // Write to the custom config dir's projects
      const slug = fs.realpathSync(projectPath).normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-')
      const customProjectDir = path.join(customConfigDir, 'projects', slug)
      fs.mkdirSync(customProjectDir, { recursive: true })
      fs.writeFileSync(
        path.join(customProjectDir, 's1.jsonl'),
        JSON.stringify(userMsg('from-custom-dir', '2026-01-01T00:00:00.000Z')),
        'utf8',
      )

      const result = await SessionHistoryManager.listProjectSessions(projectPath)
      expect(result).toHaveLength(1)
      expect(result[0].firstUserMessage).toBe('from-custom-dir')
    })
  })

  // ── listAllSessions ──────────────────────────────────────────
  //
  // loadAllProjectsSessions 读取 projectsDir 下的子目录名，用 decodeSanitizedPath
  // 还原出路径，再用 getProjectDir(decodedPath) 重新 sanitize → projects/slug。
  // 这要求 decoded path 能被 realpathSync 解析（即路径必须真实存在）。
  // 在 Windows 上，sanitizePath 把非 ASCII 字符（如中文用户名）替换成 '-'，
  // decodeSanitizedPath 无法无损还原，导致 round-trip 失败。
  // 所以 listAllSessions 的测试直接用简单英文路径创建项目目录，
  // 并直接在 projectsDir 下以 sanitized 名字创建子目录写入 session 文件。

  describe('listAllSessions', () => {
    it('projects 目录不存在时返回空数组', async () => {
      const result = await SessionHistoryManager.listAllSessions()
      expect(result).toEqual([])
    })

    it('返回所有项目的所有会话并去重', async () => {
      // 直接在 projectsDir 下创建 sanitized 项目目录
      // loadAllProjectsSessions → decodeSanitizedPath → loadSameProjectSessions → getProjectDir
      // 用 'proj1' 和 'proj2' 作为 sanitized 目录名，decode 后 'proj1'/'proj2' 原样返回
      const proj1Dir = path.join(projectsDir(), 'proj1')
      const proj2Dir = path.join(projectsDir(), 'proj2')
      fs.mkdirSync(proj1Dir, { recursive: true })
      fs.mkdirSync(proj2Dir, { recursive: true })
      fs.writeFileSync(path.join(proj1Dir, 's1.jsonl'), JSON.stringify(userMsg('p1-s1', '2026-01-01T00:00:00.000Z')) + '\n', 'utf8')
      fs.writeFileSync(path.join(proj1Dir, 's2.jsonl'), JSON.stringify(userMsg('p1-s2', '2026-01-02T00:00:00.000Z')) + '\n', 'utf8')
      fs.writeFileSync(path.join(proj2Dir, 's3.jsonl'), JSON.stringify(userMsg('p2-s3', '2026-01-03T00:00:00.000Z')) + '\n', 'utf8')

      const result = await SessionHistoryManager.listAllSessions()
      expect(result).toHaveLength(3)
    })

    it('相同 sessionId 在不同项目目录出现时只保留第一个', async () => {
      const proj1Dir = path.join(projectsDir(), 'proj1')
      const proj2Dir = path.join(projectsDir(), 'proj2')
      fs.mkdirSync(proj1Dir, { recursive: true })
      fs.mkdirSync(proj2Dir, { recursive: true })
      fs.writeFileSync(path.join(proj1Dir, 'shared-id.jsonl'), JSON.stringify(userMsg('first', '2026-01-01T00:00:00.000Z')) + '\n', 'utf8')
      fs.writeFileSync(path.join(proj2Dir, 'shared-id.jsonl'), JSON.stringify(userMsg('second', '2026-01-02T00:00:00.000Z')) + '\n', 'utf8')

      const result = await SessionHistoryManager.listAllSessions()
      expect(result).toHaveLength(1)
    })

    it('按 lastMessageTimestamp 降序排序', async () => {
      const proj1Dir = path.join(projectsDir(), 'proj1')
      const proj2Dir = path.join(projectsDir(), 'proj2')
      fs.mkdirSync(proj1Dir, { recursive: true })
      fs.mkdirSync(proj2Dir, { recursive: true })
      fs.writeFileSync(path.join(proj1Dir, 'old.jsonl'), JSON.stringify(userMsg('old', '2026-01-01T00:00:00.000Z')) + '\n', 'utf8')
      fs.writeFileSync(path.join(proj2Dir, 'new.jsonl'), JSON.stringify(userMsg('new', '2026-03-01T00:00:00.000Z')) + '\n', 'utf8')

      const result = await SessionHistoryManager.listAllSessions()
      expect(result).toHaveLength(2)
      expect(result[0].sessionId).toBe('new')
      expect(result[1].sessionId).toBe('old')
    })

    it('跳过非目录文件', async () => {
      const strayFile = path.join(projectsDir(), 'stray.txt')
      fs.mkdirSync(projectsDir(), { recursive: true })
      fs.writeFileSync(strayFile, 'not a directory', 'utf8')

      const result = await SessionHistoryManager.listAllSessions()
      expect(result).toEqual([])
    })
  })

  // ── getFullSession ───────────────────────────────────────────

  describe('getFullSession', () => {
    it('session 文件不存在时返回 null', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      const result = await SessionHistoryManager.getFullSession(projectPath, 'nope')
      expect(result).toBeNull()
    })

    it('返回完整的 messages 数组和 metadata', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      writeSession(projectPath, 's1', [
        userMsg('hello', '2026-01-01T00:00:00.000Z'),
        assistantMsg('2026-01-01T00:00:01.000Z'),
      ])
      writeMetadata(projectPath, 's1', { customTitle: 'Test' })

      const result = await SessionHistoryManager.getFullSession(projectPath, 's1')
      expect(result).not.toBeNull()
      expect(result!.messages).toHaveLength(2)
      expect(result!.metadata?.customTitle).toBe('Test')
      expect(result!.sessionId).toBe('s1')
      expect(result!.projectPath).toBe(projectPath)
    })

    it('损坏的 JSON 行被跳过', async () => {
      const projectPath = path.join(tmpRoot, 'proj')
      fs.mkdirSync(projectPath, { recursive: true })
      const file = path.join(projectDir(projectPath), 's1.jsonl')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, [
        JSON.stringify(userMsg('hello')),
        '{ broken }',
      ].join('\n'), 'utf8')

      const result = await SessionHistoryManager.getFullSession(projectPath, 's1')
      expect(result!.messages).toHaveLength(1)
    })
  })

  // ── getSessionTitle ──────────────────────────────────────────

  describe('getSessionTitle', () => {
    it('优先返回 customTitle', () => {
      const session: SessionLite = {
        projectPath: '/p',
        sessionId: 's1',
        metadata: { customTitle: 'Custom' },
        firstUserMessage: 'first message',
      }
      expect(SessionHistoryManager.getSessionTitle(session)).toBe('Custom')
    })

    it('无 customTitle 时返回 firstUserMessage（截断到 60 字符）', () => {
      const long = 'a'.repeat(100)
      const session: SessionLite = {
        projectPath: '/p',
        sessionId: 's1',
        firstUserMessage: long,
      }
      const title = SessionHistoryManager.getSessionTitle(session)
      expect(title).toBe('a'.repeat(60) + '...')
    })

    it('firstUserMessage 不足 60 字符时不截断', () => {
      const session: SessionLite = {
        projectPath: '/p',
        sessionId: 's1',
        firstUserMessage: 'short message',
      }
      expect(SessionHistoryManager.getSessionTitle(session)).toBe('short message')
    })

    it('无 customTitle 和 firstUserMessage 时返回 Session + 前 8 字符', () => {
      const session: SessionLite = {
        projectPath: '/p',
        sessionId: 'abcdefgh1234',
      }
      expect(SessionHistoryManager.getSessionTitle(session)).toBe('Session abcdefgh')
    })
  })

  // ── formatTimestamp ─────────────────────────────────────────

  describe('formatTimestamp', () => {
    it('无 timestamp 返回空字符串', () => {
      expect(SessionHistoryManager.formatTimestamp(undefined)).toBe('')
      expect(SessionHistoryManager.formatTimestamp(0)).toBe('')
    })

    it('24 小时内返回时间（HH:MM 格式）', () => {
      const ts = Date.now() - 1000 * 60 * 30 // 30 minutes ago
      const result = SessionHistoryManager.formatTimestamp(ts)
      expect(result).toMatch(/\d{1,2}:\d{2}/)
    })

    it('超过 24 小时但不到 7 天返回 weekday', () => {
      const ts = Date.now() - 3 * 24 * 60 * 60 * 1000 // 3 days ago
      const result = SessionHistoryManager.formatTimestamp(ts)
      expect(result).toBeTruthy()
      expect(result).not.toMatch(/^\d/)
    })

    it('超过 7 天返回 month + day', () => {
      const ts = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago
      const result = SessionHistoryManager.formatTimestamp(ts)
      expect(result).toBeTruthy()
    })
  })

  // ── getAgentTranscriptPath ──────────────────────────────────

  describe('getAgentTranscriptPath', () => {
    it('返回正确的子代理 transcript 路径', () => {
      const projectPath = path.join(tmpRoot, 'myproject')
      fs.mkdirSync(projectPath, { recursive: true })
      const result = SessionHistoryManager.getAgentTranscriptPath(projectPath, 'sess123', 'agent456')
      expect(result).toContain('subagents')
      expect(result).toContain('agent-agent456.jsonl')
      expect(result).toContain('sess123')
    })
  })

  // ── findAgentTranscriptByToolUse ────────────────────────────

  describe('findAgentTranscriptByToolUse', () => {
    function subagentsDir(projectPath: string, sessionId: string): string {
      return path.dirname(SessionHistoryManager.getAgentTranscriptPath(projectPath, sessionId, 'probe'))
    }

    function writeAgent(projectPath: string, sessionId: string, agentId: string, meta: unknown, withTranscript = true): string {
      const dir = subagentsDir(projectPath, sessionId)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta), 'utf8')
      const transcript = path.join(dir, `agent-${agentId}.jsonl`)
      if (withTranscript) fs.writeFileSync(transcript, '{"type":"user"}\n', 'utf8')
      return transcript
    }

    it('按 meta.json 里的 toolUseId 命中同名 transcript', () => {
      const projectPath = path.join(tmpRoot, 'myproject')
      fs.mkdirSync(projectPath, { recursive: true })
      const expected = writeAgent(projectPath, 's1', 'a111', { toolUseId: 'call_1', agentType: 'Explore' })
      writeAgent(projectPath, 's1', 'a222', { toolUseId: 'call_2', agentType: 'Plan' })

      expect(SessionHistoryManager.findAgentTranscriptByToolUse(projectPath, 's1', 'call_1')).toBe(expected)
    })

    it('没有匹配的 toolUseId 时返回 null', () => {
      const projectPath = path.join(tmpRoot, 'myproject')
      fs.mkdirSync(projectPath, { recursive: true })
      writeAgent(projectPath, 's1', 'a111', { toolUseId: 'call_1' })

      expect(SessionHistoryManager.findAgentTranscriptByToolUse(projectPath, 's1', 'call-nope')).toBeNull()
    })

    it('meta 已写但 transcript 尚未落盘时返回 null（留给下一轮重试）', () => {
      const projectPath = path.join(tmpRoot, 'myproject')
      fs.mkdirSync(projectPath, { recursive: true })
      writeAgent(projectPath, 's1', 'a111', { toolUseId: 'call_1' }, false)

      expect(SessionHistoryManager.findAgentTranscriptByToolUse(projectPath, 's1', 'call_1')).toBeNull()
    })

    it('subagents 目录不存在时返回 null 而不是抛错', () => {
      const projectPath = path.join(tmpRoot, 'myproject')
      fs.mkdirSync(projectPath, { recursive: true })

      expect(SessionHistoryManager.findAgentTranscriptByToolUse(projectPath, 'missing', 'call_1')).toBeNull()
    })

    it('损坏的 meta.json 被跳过，仍能命中后面的 agent', () => {
      const projectPath = path.join(tmpRoot, 'myproject')
      fs.mkdirSync(projectPath, { recursive: true })
      const dir = subagentsDir(projectPath, 's1')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'agent-a000.meta.json'), '{ not json', 'utf8')
      const expected = writeAgent(projectPath, 's1', 'a111', { toolUseId: 'call_1' })

      expect(SessionHistoryManager.findAgentTranscriptByToolUse(projectPath, 's1', 'call_1')).toBe(expected)
    })

    it('参数缺失时直接返回 null', () => {
      expect(SessionHistoryManager.findAgentTranscriptByToolUse('', 's1', 'call_1')).toBeNull()
      expect(SessionHistoryManager.findAgentTranscriptByToolUse('/p', '', 'call_1')).toBeNull()
      expect(SessionHistoryManager.findAgentTranscriptByToolUse('/p', 's1', '')).toBeNull()
    })
  })
})
