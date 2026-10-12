import { describe, it, expect, beforeEach } from 'vitest'
import { CommandRegistry } from '@/lib/commands/commandRegistry'
import type { Skill, SkillSource } from '@/stores/skills'
import type { McpToolInfo } from '@/stores/mcp'

function makeSkill(name: string, source: SkillSource = 'project'): Skill {
  return { name, description: `${name} desc`, content: '', source, filePath: `/p/${name}.md` }
}

function makeMcp(name: string, description?: string) {
  return { serverName: 'srv', tool: { name, description } as McpToolInfo }
}

describe('CommandRegistry.refresh — 合并与去重', () => {
  beforeEach(() => localStorage.clear())

  it('合并内置命令、技能与 MCP 工具', () => {
    const reg = new CommandRegistry()
    reg.refresh([makeSkill('myskill')], [makeMcp('mytool')])
    const names = reg.getAllCommands().map(c => c.name)
    expect(names).toContain('help') // 内置
    expect(names).toContain('myskill')
    expect(names).toContain('mytool')
  })

  it('同名冲突时保留来源优先级更高（数值更小）的命令', () => {
    const reg = new CommandRegistry()
    // 项目技能与内置命令同名 → 内置 (priority 0) 胜出
    reg.refresh([makeSkill('help')])
    const cmd = reg.findCommand('help')
    expect(cmd?.source).toBe('builtin')
  })

  it('技能来源映射：plugin→plugin, builtin→bundled, installed→global', () => {
    const reg = new CommandRegistry()
    reg.refresh([
      makeSkill('s1', 'plugin'),
      makeSkill('s2', 'builtin'),
      makeSkill('s3', 'installed'),
    ])
    expect(reg.findCommand('s1')?.source).toBe('plugin')
    expect(reg.findCommand('s2')?.source).toBe('bundled')
    expect(reg.findCommand('s3')?.source).toBe('global')
  })

  it('plugin 来源技能记录 pluginName', () => {
    const reg = new CommandRegistry()
    const skill = { ...makeSkill('ps', 'plugin'), installedSource: 'claude' as const }
    reg.refresh([skill])
    expect(reg.findCommand('ps')?.pluginName).toBe('claude')
  })

  it('MCP 工具缺省描述时回退到 serverName 描述', () => {
    const reg = new CommandRegistry()
    reg.refresh([], [makeMcp('nodesc')])
    expect(reg.findCommand('nodesc')?.description).toBe('MCP tool from srv')
  })
})

describe('CommandRegistry — 查询', () => {
  beforeEach(() => localStorage.clear())

  it('getAllCommands 过滤 isHidden 命令', () => {
    const reg = new CommandRegistry()
    reg.refresh([makeSkill('visible')])
    // 手动注入隐藏技能命令无法经由 refresh（技能映射无 isHidden），
    // 这里验证同名隐藏内置命令被排除
    const hidden = reg.getAllCommands().filter(c => c.isHidden)
    expect(hidden).toEqual([])
    expect(reg.getAllCommands().map(c => c.name)).toContain('visible')
  })

  it('findCommand 按名称与别名命中', () => {
    const reg = new CommandRegistry()
    reg.refresh([])
    expect(reg.findCommand('clear')?.name).toBe('clear')
    expect(reg.findCommand('reset')?.name).toBe('clear') // 别名
    expect(reg.findCommand('nonexistent')).toBeUndefined()
  })

  it('getGroupedCommands 按固定来源顺序分组并跳过空组', () => {
    const reg = new CommandRegistry()
    reg.refresh([makeSkill('proj', 'project')], [makeMcp('tool')])
    const groups = reg.getGroupedCommands()
    const sources = groups.map(g => g.source)
    // builtin 组（内置命令）在 project 与 mcp 之前；bundled/global/plugin 无内容被跳过
    expect(sources).toEqual(['builtin', 'project', 'mcp'])
    for (const g of groups) {
      expect(g.commands.length).toBeGreaterThan(0)
      expect(g.label).toBeTruthy()
    }
  })
})

describe('CommandRegistry — 使用统计', () => {
  beforeEach(() => localStorage.clear())

  it('recordUsage 累计次数并持久化到 localStorage', () => {
    const reg = new CommandRegistry()
    reg.recordUsage('help')
    reg.recordUsage('help')
    expect(reg.getUsageStats()).toEqual({ help: 2 })

    // 新实例从 localStorage 恢复统计
    const reg2 = new CommandRegistry()
    expect(reg2.getUsageStats()).toEqual({ help: 2 })
  })

  it('getUsageStats 返回副本，修改不影响内部状态', () => {
    const reg = new CommandRegistry()
    reg.recordUsage('help')
    reg.getUsageStats().help = 99
    expect(reg.getUsageStats().help).toBe(1)
  })

  it('getRecentCommands 按使用频次降序并受 limit 约束', () => {
    const reg = new CommandRegistry()
    reg.refresh([])
    for (let i = 0; i < 3; i++) reg.recordUsage('clear')
    reg.recordUsage('help')
    reg.recordUsage('cost')

    const recent = reg.getRecentCommands(2)
    expect(recent.map(c => c.name)).toEqual(['clear', 'help'])
  })

  it('getRecentCommands 跳过统计中存在但命令已不存在的条目', () => {
    const reg = new CommandRegistry()
    reg.recordUsage('ghost') // 无对应命令
    reg.recordUsage('help')
    reg.refresh([])
    expect(reg.getRecentCommands().map(c => c.name)).toEqual(['help'])
  })
})
