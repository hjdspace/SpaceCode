// @vitest-environment node
/**
 * 每个引擎的 agent 名单必须只含它自己真能用上的定义 (issue #46)。
 *
 * 这一层是「下拉框说的」与「引擎做的」之间唯一的对账处：以前 PiEngine 硬编码一条
 * `general-purpose`，Claude 的名单又无条件出现在 Pi 会话里，两边都在展示对方能力清单。
 * 所以钉三件事：
 *   - Pi 同时认 `.claude/agents` 与 pi 原生位置，同名按优先级只留一个
 *   - Pi 不展示 Claude 引擎内置的那几个（pi 侧没有对应定义，列出来就是再说一次「选了不生效」）
 *   - Claude 的名单不因为 pi 目录里有个同名文件就长出一项
 *
 * 名单只带界面字段，不带定义正文与绝对路径 —— 那条边界也在下面钉住，H5 客户端拿到的是同一份。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
  BrowserWindow: class {},
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

vi.mock('../claudeCodeProcessPool', () => ({
  ClaudeCodeProcessPool: class {},
}))

vi.mock('../PiProcessPool', () => ({
  PiProcessPool: class {},
}))

import { ClaudeCodeEngine } from '../ClaudeCodeEngine'
import { PiEngine } from '../PiEngine'

let root: string
const previousEnv: Record<string, string | undefined> = {}

function writeAgent(dir: string, file: string, frontmatter: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, file), `---\n${frontmatter}\n---\n\n${body}`, 'utf8')
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'list-agents-')))
  for (const key of ['HOME', 'USERPROFILE', 'PI_CODING_AGENT_DIR']) {
    previousEnv[key] = process.env[key]
  }
  // 扫描用的是 os.homedir() 与 PI_CODING_AGENT_DIR，两者都指到临时目录才碰得到真实文件系统分支
  process.env.HOME = path.join(root, 'home')
  process.env.USERPROFILE = path.join(root, 'home')
  process.env.PI_CODING_AGENT_DIR = path.join(root, 'home', '.pi', 'agent')
})

afterEach(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(root, { recursive: true, force: true })
})

describe('PiEngine.listAgents', () => {
  it('lists definitions from both .claude and pi native locations, project before user', async () => {
    const cwd = path.join(root, 'project')
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer\ndescription: Diff reviewer', 'Review the diff.')
    writeAgent(path.join(root, 'home', '.pi', 'agent', 'agents'), 'scout.md', 'name: scout', 'Scout the repo.')

    const agents = await new PiEngine().listAgents(cwd)

    expect(agents.map(a => a.agentType)).toEqual(['reviewer', 'scout'])
    expect(agents.map(a => a.source)).toEqual(['project', 'user'])
  })

  it('drops the fabricated general-purpose entry', async () => {
    const agents = await new PiEngine().listAgents(path.join(root, 'project'))

    expect(agents.map(a => a.agentType)).not.toContain('general-purpose')
  })

  it('keeps the pi-native definition when both locations claim one name', async () => {
    const cwd = path.join(root, 'project')
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer', 'From claude dir.')
    writeAgent(path.join(cwd, '.pi', 'agents'), 'reviewer.md', 'name: reviewer', 'From pi dir.')

    const agents = await new PiEngine().listAgents(cwd)

    expect(agents).toHaveLength(1)
    expect(agents[0]).not.toHaveProperty('body')
    expect(agents[0]).not.toHaveProperty('file')
  })

  it('comes back empty rather than inventing an entry when nothing is defined', async () => {
    expect(await new PiEngine().listAgents(path.join(root, 'empty-project'))).toEqual([])
  })
})

describe('ClaudeCodeEngine.listAgents', () => {
  it('keeps its built-ins and adds only .claude definitions', async () => {
    const cwd = path.join(root, 'project')
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer\ndescription: d', 'Body.')
    writeAgent(path.join(cwd, '.pi', 'agents'), 'pi-only.md', 'name: pi-only', 'Body.')

    const agents = await new ClaudeCodeEngine().listAgents(cwd)

    expect(agents.map(a => a.agentType)).toContain('reviewer')
    expect(agents.map(a => a.agentType)).toContain('Explore')
    expect(agents.map(a => a.agentType)).not.toContain('pi-only')
  })

  it('does not list a file that carries no frontmatter name', async () => {
    const cwd = path.join(root, 'project')
    fs.mkdirSync(path.join(cwd, '.claude', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(cwd, '.claude', 'agents', 'notes.md'), 'Just prose, no agent header.', 'utf8')

    const agents = await new ClaudeCodeEngine().listAgents(cwd)

    expect(agents.map(a => a.agentType)).not.toContain('notes')
  })
})
