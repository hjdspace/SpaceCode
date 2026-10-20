// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import { PiSessionProcess } from '../PiSessionProcess'
import type { EngineSessionConfig } from '../types'
import { warn as loggerWarn } from '../../../infra/logger'

/**
 * 所选 agent 在 Pi 这条路上到底怎么落地 (issue #46)。
 *
 * Pi 1.3.0 没有 `--agent` 旗子，也没有能设主线程人设的 RPC 命令。而 Claude 的 `--agent`
 * 本身就是把定义正文当成主线程 system prompt（engine/src/main.tsx:2586）—— 所以这里
 * 用 `--append-system-prompt <persona 文件>` 才是同构做法，另按意图带上子代理扩展。
 *
 * fs 与 os 被虚拟掉，为的是让 argv 断言确定：真实用户目录里的 `.claude/agents` 不该渗进
 * 测试，临时文件名也是命令行的一部分。扫描与去重本身的口径钉在 agentDefinitions.test.ts。
 */

const HOME = '/home/u'
const PI_AGENT_AGENTS = path.join(HOME, '.pi', 'agent', 'agents')
const CWD = 'D:/repo'
const CLAUDE_DIR = path.join(CWD, '.claude', 'agents')
const PI_DIR = path.join(CWD, '.pi', 'agents')
const TMP_DIR = '/tmp'
const PERSONA_DIR = path.join(TMP_DIR, 'SpaceCode')
const EXT_ENTRY = path.resolve(__dirname, '..', '..', '..', 'node_modules', '@tintinweb', 'pi-subagents', 'src', 'index.ts')

const H = vi.hoisted(() => ({
  /** 目录 → 该目录下的 *.md 文件名 */
  dirs: new Map<string, string[]>(),
  /** 文件 → 内容 */
  files: new Map<string, string>(),
  writes: [] as Array<{ path: string; content: string }>,
  mkdirs: [] as string[],
  writeThrows: false,
  existing: new Set<string>(),
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => {
    const key = String(p)
    return H.existing.has(key) || H.dirs.has(key) || H.files.has(key)
  },
  readdirSync: (dir: unknown) => H.dirs.get(String(dir)) ?? [],
  statSync: (p: unknown) => ({ isFile: () => H.files.has(String(p)) }),
  readFileSync: (p: unknown) => {
    const key = String(p)
    if (!H.files.has(key)) throw new Error(`ENOENT: ${key}`)
    return H.files.get(key) as string
  },
  mkdirSync: (p: unknown) => {
    H.mkdirs.push(String(p))
  },
  writeFileSync: (p: unknown, data: unknown) => {
    if (H.writeThrows) throw new Error('EPERM: operation not permitted')
    H.writes.push({ path: String(p), content: String(data) })
  },
}))

vi.mock('os', () => ({
  homedir: () => HOME,
  tmpdir: () => TMP_DIR,
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app/root', getPath: () => HOME },
  BrowserWindow: class {},
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

interface PrivateApi {
  buildArgs(): string[]
}

function privates(proc: PiSessionProcess): PrivateApi {
  return proc as unknown as PrivateApi
}

function newProc(overrides: Partial<EngineSessionConfig> = {}, sessionId = 'sess-1'): PiSessionProcess {
  const config: EngineSessionConfig = {
    cwd: CWD,
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    engineType: 'pi',
    ...overrides,
  }
  return new PiSessionProcess(sessionId, config)
}

/** 取 --append-system-prompt 的全部出现（pi 允许重复并按时序拼接） */
function appended(args: string[]): string[] {
  const out: string[] = []
  args.forEach((arg, i) => {
    if (arg === '--append-system-prompt') out.push(args[i + 1])
  })
  return out
}

function agentFile(dir: string, name: string, frontmatter: string, body: string): void {
  H.dirs.set(dir, [...(H.dirs.get(dir) ?? []), `${name}.md`])
  H.files.set(path.join(dir, `${name}.md`), `---\n${frontmatter}\n---\n\n${body}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  H.dirs.clear()
  H.files.clear()
  H.writes = []
  H.mkdirs = []
  H.writeThrows = false
  H.existing.clear()
  H.existing.add(EXT_ENTRY)
})

describe('buildArgs 的 agent 通道', () => {
  it('把 .claude 定义的正文作为 persona 文件追加到系统提示', () => {
    agentFile(CLAUDE_DIR, 'reviewer', 'name: reviewer\ndescription: d', 'Review the diff closely.')

    const args = privates(newProc({ agent: 'reviewer' })).buildArgs()

    const persona = path.join(PERSONA_DIR, 'pi-agent-sess-1.md')
    expect(appended(args)).toEqual([persona])
    expect(H.writes).toEqual([{ path: persona, content: 'Review the diff closely.' }])
  })

  it('pi 原生位置的定义同样可用，同名时它压过 .claude', () => {
    agentFile(CLAUDE_DIR, 'reviewer', 'name: reviewer', 'From claude dir.')
    agentFile(PI_DIR, 'reviewer', 'name: reviewer', 'From pi dir.')

    const args = privates(newProc({ agent: 'reviewer' })).buildArgs()

    expect(H.writes[0].content).toBe('From pi dir.')
    expect(args).toContain('--append-system-prompt')
  })

  it('用户级 pi 目录也在扫描范围内', () => {
    agentFile(PI_AGENT_AGENTS, 'global-scout', 'name: global-scout', 'Global persona.')

    const args = privates(newProc({ agent: 'global-scout' })).buildArgs()

    expect(appended(args)).toHaveLength(1)
    expect(H.writes[0].content).toBe('Global persona.')
  })

  it('没选 agent 时不带注入，也不带子代理扩展：默认形态不变', () => {
    const args = privates(newProc()).buildArgs()

    expect(appended(args)).toEqual([])
    expect(args).not.toContain('--extension')
    const proc = newProc()
    privates(proc).buildArgs()
    expect(proc.agentApplied).toBeNull()
    expect(proc.subagentsExtensionLoaded).toBe(false)
  })

  it('选了 agent 就带上子代理扩展，即使人设解析不出来也要有委派能力', () => {
    const proc = newProc({ agent: 'ghost' })

    const args = privates(proc).buildArgs()

    expect(args).toContain('--extension')
    expect(args[args.indexOf('--extension') + 1]).toBe(EXT_ENTRY)
    expect(proc.subagentsExtensionLoaded).toBe(true)
    expect(appended(args)).toEqual([])
    expect(proc.agentApplied).toBe(false)
    expect(loggerWarn).toHaveBeenCalled()
  })

  it('Claude 内置的那几个名字在 pi 侧没有定义，不再谎称生效', () => {
    const proc = newProc({ agent: 'Explore' })

    const args = privates(proc).buildArgs()

    expect(appended(args)).toEqual([])
    expect(proc.agentApplied).toBe(false)
  })

  it('定义只有 frontmatter、没有正文时算没落地', () => {
    agentFile(CLAUDE_DIR, 'empty', 'name: empty\ndescription: d', '   ')

    const proc = newProc({ agent: 'empty' })
    const args = privates(proc).buildArgs()

    expect(appended(args)).toEqual([])
    expect(proc.agentApplied).toBe(false)
    expect(H.writes).toEqual([])
  })

  it('persona 写不进盘时算没落地，不假装成功', () => {
    agentFile(CLAUDE_DIR, 'reviewer', 'name: reviewer', 'Body.')
    H.writeThrows = true

    const proc = newProc({ agent: 'reviewer' })
    const args = privates(proc).buildArgs()

    expect(appended(args)).toEqual([])
    expect(proc.agentApplied).toBe(false)
  })

  it('宿主的 appendSystemPrompt 与 persona 各占一次出现，pi 按时序拼接', () => {
    agentFile(CLAUDE_DIR, 'reviewer', 'name: reviewer', 'Persona body.')

    const args = privates(newProc({ agent: 'reviewer', appendSystemPrompt: 'respond in Chinese' })).buildArgs()

    expect(appended(args)).toEqual(['respond in Chinese', path.join(PERSONA_DIR, 'pi-agent-sess-1.md')])
  })

  it('persona 文件名按 sessionId 固定，重启覆盖而不是往临时目录堆', () => {
    agentFile(CLAUDE_DIR, 'reviewer', 'name: reviewer', 'Body.')

    for (const sessionId of ['aaaa1111-1', 'aaaa1111-1', 'bbbb2222-2']) {
      privates(newProc({ agent: 'reviewer' }, sessionId)).buildArgs()
    }

    expect(H.writes.map(w => w.path)).toEqual([
      path.join(PERSONA_DIR, 'pi-agent-aaaa1111-1.md'),
      path.join(PERSONA_DIR, 'pi-agent-aaaa1111-1.md'),
      path.join(PERSONA_DIR, 'pi-agent-bbbb2222-2.md'),
    ])
    expect(H.mkdirs).toContain(PERSONA_DIR)
  })

  it('每次 spawn 重算状态：换进程不能拿上一次的回执说话', () => {
    const proc = newProc({ agent: 'reviewer' })
    agentFile(CLAUDE_DIR, 'reviewer', 'name: reviewer', 'Body.')
    privates(proc).buildArgs()
    expect(proc.agentApplied).toBe(true)

    proc.config.agent = undefined
    privates(proc).buildArgs()
    expect(proc.agentApplied).toBeNull()
    expect(proc.subagentsExtensionLoaded).toBe(false)

    proc.config.agent = 'reviewer'
    H.existing.delete(EXT_ENTRY)
    privates(proc).buildArgs()
    expect(proc.agentApplied).toBe(true)
    expect(proc.subagentsExtensionLoaded).toBe(false)
  })

  it('plan 模式与 agent 各带各的扩展，两次 --extension 互不覆盖', () => {
    const PLAN_EXT = path.resolve(__dirname, '..', '..', '..', 'node_modules', '@narumitw', 'pi-plan-mode', 'dist', 'index.ts')
    H.existing.add(PLAN_EXT)
    agentFile(CLAUDE_DIR, 'reviewer', 'name: reviewer', 'Body.')

    const args = privates(newProc({ agent: 'reviewer', permissionMode: 'plan' })).buildArgs()

    const extensions = args.reduce<string[]>((acc, arg, i) => (arg === '--extension' ? [...acc, args[i + 1]] : acc), [])
    expect(extensions).toEqual([PLAN_EXT, EXT_ENTRY])
  })
})
