// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import {
  getBuiltInAgents,
  getBuiltInAgentIds,
  getBuiltInAgent,
  pathsForAgent,
  sharedSkillsDir,
  agentSkillDirs,
  pluginCachePathForAgent,
} from '../agentRegistry'
import { setHomeOverride } from '../fsutil'

describe('agentRegistry', () => {
  describe('getBuiltInAgents', () => {
    it('returns the built-in agent registry', () => {
      const agents = getBuiltInAgents()
      expect(agents.length).toBeGreaterThanOrEqual(20)
    })

    it('includes the major local skill agents', () => {
      const agents = getBuiltInAgents()
      const ids = agents.map((a) => a.id)
      expect(ids).toContain('claude-code')
      expect(ids).toContain('codex')
      expect(ids).toContain('cursor')
      expect(ids).toContain('trae')
      expect(ids).toContain('gemini')
      expect(ids).toContain('workbuddy')
      expect(ids).toContain('zcode')
      expect(ids).toContain('windsurf')
      expect(ids).toContain('pi')
    })

    it('each agent has a non-empty skillsDir', () => {
      const agents = getBuiltInAgents()
      for (const agent of agents) {
        expect(agent.skillsDir.length).toBeGreaterThan(0)
        expect(agent.displayName.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getBuiltInAgentIds', () => {
    it('returns all registered agent IDs', () => {
      const ids = getBuiltInAgentIds()
      expect(ids.length).toBeGreaterThanOrEqual(20)
      expect(ids).toContain('claude-code')
      expect(ids).toContain('codex')
      expect(ids).toContain('cursor')
      expect(ids).toContain('trae')
    })
  })

  describe('getBuiltInAgent', () => {
    it('returns the agent for a valid ID', () => {
      const agent = getBuiltInAgent('claude-code')
      expect(agent).not.toBeNull()
      expect(agent!.displayName).toBe('Claude Code')
    })

    it('returns null for an unknown ID', () => {
      expect(getBuiltInAgent('unknown-agent')).toBeNull()
    })
  })

  describe('pathsForAgent', () => {
    it('returns paths for claude-code', () => {
      const paths = pathsForAgent('claude-code')
      expect(paths).not.toBeNull()
      expect(paths!.skillDirs.length).toBe(1)
      expect(paths!.skillDirs[0]).toContain('.claude')
      expect(paths!.skillDirs[0]).toContain('skills')
    })

    it('returns paths for codex with shared dir', () => {
      const paths = pathsForAgent('codex')
      expect(paths).not.toBeNull()
      expect(paths!.skillDirs.length).toBe(2)
      expect(paths!.skillDirs[0]).toContain('.codex')
      expect(paths!.skillDirs[1]).toContain('.agents')
    })

    it('returns paths for cursor', () => {
      const paths = pathsForAgent('cursor')
      expect(paths).not.toBeNull()
      expect(paths!.skillDirs[0]).toContain('.cursor')
    })

    it('returns paths for trae', () => {
      const paths = pathsForAgent('trae')
      expect(paths).not.toBeNull()
      expect(paths!.skillDirs[0]).toContain('.trae')
    })

    it('returns null for unknown agent', () => {
      expect(pathsForAgent('unknown')).toBeNull()
    })
  })

  describe('sharedSkillsDir', () => {
    it('returns a path containing .agents/skills', () => {
      const dir = sharedSkillsDir()
      expect(dir).toContain('.agents')
      expect(dir).toContain('skills')
    })
  })
})

/**
 * 票 07 第 6 条：Claude 的路径尊重 `CLAUDE_CONFIG_DIR`，不再硬编码 `~/.claude`。
 * 引擎侧与设置文件读取早就是这个口径，技能目录再硬编码就会把技能装到 Claude 读不到的地方。
 */
describe('claude-code 的 CLAUDE_CONFIG_DIR 覆盖', () => {
  const homeDir = path.join(os.tmpdir(), 'skill-registry-claude-home')

  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    setHomeOverride(null)
  })

  it('未设置时技能目录仍是 ~/.claude/skills', () => {
    setHomeOverride(homeDir)
    expect(getBuiltInAgent('claude-code')?.skillsDir).toBe(path.join(homeDir, '.claude', 'skills'))
  })

  it('空白值按未设置处理', () => {
    setHomeOverride(homeDir)
    process.env.CLAUDE_CONFIG_DIR = '   '
    expect(getBuiltInAgent('claude-code')?.skillsDir).toBe(path.join(homeDir, '.claude', 'skills'))
  })

  it('绝对路径同时决定技能目录、设置文件与插件缓存', () => {
    setHomeOverride(homeDir)
    const configDir = path.join(os.tmpdir(), 'skill-registry-claude-cfg')
    process.env.CLAUDE_CONFIG_DIR = configDir

    const agent = getBuiltInAgent('claude-code')
    expect(agent?.skillsDir).toBe(path.join(configDir, 'skills'))
    expect(agent?.configPath).toBe(path.join(configDir, 'settings.json'))
    expect(agent?.mcpConfigPath).toBe(path.join(configDir, 'settings.json'))
    expect(pluginCachePathForAgent('claude-code')).toBe(path.join(configDir, 'plugins', 'cache'))
  })

  it('~ 前缀按 home 展开', () => {
    setHomeOverride(homeDir)
    process.env.CLAUDE_CONFIG_DIR = '~/my-claude'

    expect(getBuiltInAgent('claude-code')?.skillsDir).toBe(path.join(homeDir, 'my-claude', 'skills'))
  })

  it('pathsForAgent 与 agentSkillDirs 共用覆盖后的目录', () => {
    setHomeOverride(homeDir)
    const configDir = path.join(os.tmpdir(), 'skill-registry-claude-cfg2')
    process.env.CLAUDE_CONFIG_DIR = configDir

    expect(pathsForAgent('claude-code')?.skillDirs).toEqual([path.join(configDir, 'skills')])
    expect(agentSkillDirs('claude-code')).toEqual([path.join(configDir, 'skills')])
  })

  it('其它 Agent 不受这个变量影响', () => {
    setHomeOverride(homeDir)
    process.env.CLAUDE_CONFIG_DIR = path.join(os.tmpdir(), 'skill-registry-claude-cfg3')

    expect(getBuiltInAgent('codex')?.skillsDir).toBe(path.join(homeDir, '.codex', 'skills'))
  })
})

/**
 * 票 08 第 1 条：Pi 的技能目录是 `${PI_CODING_AGENT_DIR || ~/.pi/agent}/skills`。
 * `~/.pi/agents` 是**子代理定义**目录，混用会让「谁装了这份技能」在管理视图里失真；
 * 共享的 `~/.agents/skills` 会被 Pi 读取，但它是 `agents` 伪条目，不是 Pi 的专用 Target。
 */
describe('pi 的技能目录', () => {
  const homeDir = path.join(os.tmpdir(), 'skill-registry-pi-home')

  afterEach(() => {
    delete process.env.PI_CODING_AGENT_DIR
    setHomeOverride(null)
  })

  it('默认是 ~/.pi/agent/skills', () => {
    setHomeOverride(homeDir)

    expect(getBuiltInAgent('pi')?.skillsDir).toBe(path.join(homeDir, '.pi', 'agent', 'skills'))
  })

  it('PI_CODING_AGENT_DIR 覆盖技能目录与配置路径', () => {
    setHomeOverride(homeDir)
    const agentDir = path.join(os.tmpdir(), 'skill-registry-pi-cfg')
    process.env.PI_CODING_AGENT_DIR = agentDir

    const agent = getBuiltInAgent('pi')
    expect(agent?.skillsDir).toBe(path.join(agentDir, 'skills'))
    expect(agent?.configPath).toBe(path.join(agentDir, 'settings.json'))
    expect(agent?.mcpConfigPath).toBe(path.join(agentDir, 'mcp.json'))
  })

  it('空白值按未设置处理', () => {
    setHomeOverride(homeDir)
    process.env.PI_CODING_AGENT_DIR = '   '

    expect(getBuiltInAgent('pi')?.skillsDir).toBe(path.join(homeDir, '.pi', 'agent', 'skills'))
  })

  it('~ 前缀与裸 ~ 都按 home 展开（与 pi 的 getAgentDir 同口径）', () => {
    setHomeOverride(homeDir)
    process.env.PI_CODING_AGENT_DIR = '~/custom-pi'

    expect(getBuiltInAgent('pi')?.skillsDir).toBe(path.join(homeDir, 'custom-pi', 'skills'))

    process.env.PI_CODING_AGENT_DIR = '~'

    expect(getBuiltInAgent('pi')?.skillsDir).toBe(path.join(homeDir, 'skills'))
  })

  it('返回的技能目录从不落在 ~/.pi/agents 下', () => {
    setHomeOverride(homeDir)

    const dirs = [
      getBuiltInAgent('pi')!.skillsDir,
      ...(pathsForAgent('pi')?.skillDirs ?? []),
      ...agentSkillDirs('pi'),
    ]
    const agentDefinitionsDir = path.join(homeDir, '.pi', 'agents')
    for (const dir of dirs) {
      expect(dir === agentDefinitionsDir || dir.startsWith(agentDefinitionsDir + path.sep)).toBe(false)
    }
    expect(dirs).toContain(path.join(homeDir, '.pi', 'agent', 'skills'))
  })

  it('读取共享的 ~/.agents/skills，但 Pi 的主目录仍排在它前面', () => {
    setHomeOverride(homeDir)

    expect(pathsForAgent('pi')?.skillDirs).toEqual([
      path.join(homeDir, '.pi', 'agent', 'skills'),
      sharedSkillsDir(),
    ])
    expect(agentSkillDirs('pi')[0]).toBe(path.join(homeDir, '.pi', 'agent', 'skills'))
  })

  it('PI_CODING_AGENT_DIR 同时决定 pathsForAgent 与 agentSkillDirs', () => {
    setHomeOverride(homeDir)
    const agentDir = path.join(os.tmpdir(), 'skill-registry-pi-cfg2')
    process.env.PI_CODING_AGENT_DIR = agentDir

    expect(pathsForAgent('pi')?.skillDirs[0]).toBe(path.join(agentDir, 'skills'))
    expect(agentSkillDirs('pi')[0]).toBe(path.join(agentDir, 'skills'))
  })
})
