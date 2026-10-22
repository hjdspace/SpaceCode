// @vitest-environment node
/**
 * 历史门面的引擎分派：Claude 与 pi 的条目合并到同一份左栏/历史列表，
 * 且 getFullSession 按引擎取对应的 JSONL，绝不串台。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const H = vi.hoisted(() => ({ home: '', userData: '' }))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const patched = { ...actual, homedir: () => H.home }
  return { ...patched, default: patched }
})
vi.mock('electron', () => ({ app: { getPath: () => H.userData } }))
vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

let tmpRoot = ''
let projectPath = ''

function writeClaudeSession(sessionId: string, lines: unknown[]): void {
  const slug = fs.realpathSync(projectPath).normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-')
  const dir = path.join(H.home, '.claude', 'projects', slug)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n'), 'utf8')
}

function writePiSession(sessionId: string, piId: string, lines: unknown[]): void {
  const dir = path.join(tmpRoot, 'pi-sessions')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${piId}.jsonl`)
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8')
  fs.mkdirSync(H.userData, { recursive: true })
  const storePath = path.join(H.userData, 'pi-sessions.json')
  const current = fs.existsSync(storePath)
    ? JSON.parse(fs.readFileSync(storePath, 'utf8'))
    : {}
  current[sessionId] = { sessionFile: file, cwd: projectPath }
  fs.writeFileSync(storePath, JSON.stringify(current), 'utf8')
}

function claudeUser(text: string, timestamp: string) {
  return { type: 'user', timestamp, message: { role: 'user', content: text } }
}

function claudeAssistant(text: string, timestamp: string) {
  return { type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'text', text }] } }
}

async function loadManager() {
  vi.resetModules()
  return await import('../sessionHistoryManager')
}

beforeEach(() => {
  // 生产代码优先读 CLAUDE_CONFIG_DIR / XDG_CONFIG_HOME；CI runner 会设置后者，
  // 不隔离会让 .claude 目录落到真实 home 之外，测试在 Linux 上必挂。
  vi.stubEnv('CLAUDE_CONFIG_DIR', '')
  vi.stubEnv('XDG_CONFIG_HOME', '')
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'history-engines-'))
  H.home = path.join(tmpRoot, 'home')
  H.userData = path.join(tmpRoot, 'userData')
  projectPath = path.join(tmpRoot, 'project')
  fs.mkdirSync(projectPath, { recursive: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('SessionHistoryManager engine dispatch', () => {
  it('lists Claude and pi sessions together with engine tags', async () => {
    writeClaudeSession('claude-1', [
      claudeUser('claude question', '2026-10-20T01:00:00.000Z'),
      claudeAssistant('claude answer', '2026-10-20T01:00:01.000Z'),
    ])
    writePiSession('pi-1', 'pi-internal-1', [
      { type: 'session', version: 3, id: 'pi-internal-1', timestamp: '2026-10-20T02:00:00.000Z', cwd: projectPath },
      { type: 'message', id: 'u1', timestamp: '2026-10-20T02:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'pi question' }] } },
    ])

    const { SessionHistoryManager } = await loadManager()
    const sessions = await SessionHistoryManager.listProjectSessions(projectPath)

    expect(sessions).toHaveLength(2)
    expect(sessions.find(s => s.sessionId === 'claude-1')?.engineType).toBe('claude-code')
    expect(sessions.find(s => s.sessionId === 'pi-1')).toMatchObject({
      engineType: 'pi',
      engineSessionId: 'pi-internal-1',
      firstUserMessage: 'pi question',
    })
  })

  it('prefers the engine with the newer transcript when both sides share a SpaceCode id', async () => {
    writeClaudeSession('shared-id', [
      claudeUser('claude old', '2026-10-20T01:00:00.000Z'),
      claudeAssistant('claude old answer', '2026-10-20T01:00:01.000Z'),
    ])
    writePiSession('shared-id', 'pi-newer', [
      { type: 'session', version: 3, id: 'pi-newer', timestamp: '2026-10-20T03:00:00.000Z', cwd: projectPath },
      { type: 'message', id: 'u1', timestamp: '2026-10-20T03:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'pi newer' }] } },
    ])

    const { SessionHistoryManager } = await loadManager()
    const sessions = await SessionHistoryManager.listProjectSessions(projectPath)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('shared-id')
    expect(sessions[0].engineType).toBe('pi')
  })

  it('getFullSession honours the requested engine instead of guessing', async () => {
    writeClaudeSession('shared-id', [
      claudeUser('claude text', '2026-10-20T01:00:00.000Z'),
    ])
    writePiSession('shared-id', 'pi-internal', [
      { type: 'session', version: 3, id: 'pi-internal', timestamp: '2026-10-20T02:00:00.000Z', cwd: projectPath },
      { type: 'message', id: 'u1', timestamp: '2026-10-20T02:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'pi text' }] } },
    ])

    const { SessionHistoryManager } = await loadManager()
    const claude = await SessionHistoryManager.getFullSession(projectPath, 'shared-id', 'claude-code')
    const pi = await SessionHistoryManager.getFullSession(projectPath, 'shared-id', 'pi')
    const auto = await SessionHistoryManager.getFullSession(projectPath, 'shared-id')

    expect(claude.engineType).toBe('claude-code')
    expect(claude.messages[0].message.content).toBe('claude text')
    expect(pi.engineType).toBe('pi')
    expect(pi.messages[0].message.content[0].text).toBe('pi text')
    // 未显式指定时，注册表命中 pi 就按 pi 取，避免老记录把 pi 历史送到 Claude。
    expect(auto.engineType).toBe('pi')
  })

  it('does not show pi sessions from another project', async () => {
    writePiSession('pi-1', 'pi-internal-1', [
      { type: 'session', version: 3, id: 'pi-internal-1', timestamp: '2026-10-20T02:00:00.000Z', cwd: projectPath },
    ])

    const { SessionHistoryManager } = await loadManager()

    expect(await SessionHistoryManager.listProjectSessions(path.join(tmpRoot, 'other'))).toEqual([])
  })
})
