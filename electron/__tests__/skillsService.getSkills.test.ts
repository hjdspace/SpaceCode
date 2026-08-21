import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: electronMock.getPath },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, handler)
    }),
  },
  net: {},
}))

import { registerSkillsIPCHandlers, selectMarketplaceSkillPath } from '../skillsService'

let homeDir: string

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value), 'utf-8')
}

function writeSkill(skillDir: string, name: string): void {
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n---\n`,
    'utf-8',
  )
}

async function getSkills(cwd?: string): Promise<{ skills: Array<{ name: string; source: string }> }> {
  const handler = electronMock.handlers.get('skills:getSkills')
  if (!handler) throw new Error('skills:getSkills handler was not registered')
  return handler({}, cwd) as Promise<{ skills: Array<{ name: string; source: string }> }>
}

describe('skills:getSkills', () => {
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'spacecode-skills-'))
    electronMock.getPath.mockReturnValue(homeDir)
    electronMock.handlers.clear()
    registerSkillsIPCHandlers()
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('discovers a global skill installed as a directory link', async () => {
    const sourceDir = join(homeDir, 'skill-sources', 'linked-skill')
    const linkedDir = join(homeDir, '.claude', 'skills', 'linked-skill')
    writeSkill(sourceDir, 'linked-skill')
    mkdirSync(join(linkedDir, '..'), { recursive: true })
    symlinkSync(sourceDir, linkedDir, 'junction')

    const result = await getSkills()

    expect(result.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'linked-skill', source: 'global' }),
    ]))
  })

  it('discovers enabled Claude Code plugin skills from installed plugin paths', async () => {
    const pluginsRoot = join(homeDir, '.claude', 'plugins')
    const rootLayout = join(pluginsRoot, 'cache', 'market', 'root-plugin', '1.0.0')
    const manifestLayout = join(pluginsRoot, 'cache', 'market', 'manifest-plugin', '2.0.0')
    const disabledLayout = join(pluginsRoot, 'cache', 'market', 'disabled-plugin', '1.0.0')
    const otherProjectLayout = join(pluginsRoot, 'cache', 'market', 'other-project-plugin', '1.0.0')

    writeSkill(join(rootLayout, 'skills', 'brainstorming'), 'brainstorming')
    writeJson(join(rootLayout, '.claude-plugin', 'plugin.json'), { name: 'root-plugin' })
    writeSkill(join(manifestLayout, '.claude', 'skills', 'design'), 'design')
    writeSkill(join(manifestLayout, '.claude', 'skills', 'undeclared'), 'undeclared')
    writeJson(join(manifestLayout, '.claude-plugin', 'plugin.json'), {
      name: 'manifest-plugin',
      skills: ['./.claude/skills/design'],
    })
    writeSkill(join(disabledLayout, 'skills', 'hidden'), 'hidden')
    writeSkill(join(otherProjectLayout, 'skills', 'other-project'), 'other-project')

    writeJson(join(pluginsRoot, 'installed_plugins.json'), {
      version: 2,
      plugins: {
        'root-plugin@market': [{ scope: 'user', installPath: rootLayout, version: '1.0.0' }],
        'manifest-plugin@market': [{ scope: 'user', installPath: manifestLayout, version: '2.0.0' }],
        'disabled-plugin@market': [{ scope: 'user', installPath: disabledLayout, version: '1.0.0' }],
        'other-project-plugin@market': [{
          scope: 'project',
          projectPath: join(homeDir, 'another-project'),
          installPath: otherProjectLayout,
          version: '1.0.0',
        }],
      },
    })
    writeJson(join(homeDir, '.claude', 'settings.json'), {
      enabledPlugins: {
        'root-plugin@market': true,
        'manifest-plugin@market': true,
        'disabled-plugin@market': false,
        'other-project-plugin@market': true,
      },
    })

    const result = await getSkills()
    const pluginNames = result.skills.filter(skill => skill.source === 'plugin').map(skill => skill.name)

    expect(pluginNames).toContain('root-plugin:brainstorming')
    expect(pluginNames).toContain('manifest-plugin:design')
    expect(pluginNames).not.toContain('manifest-plugin:undeclared')
    expect(pluginNames).not.toContain('disabled-plugin:hidden')
    expect(pluginNames).not.toContain('other-project-plugin:other-project')
  })
})

describe('selectMarketplaceSkillPath', () => {
  it('finds skills nested below a repository skills group', () => {
    expect(selectMarketplaceSkillPath([
      'README.md',
      'skills/misc/git-guardrails-claude-code/SKILL.md',
      'skills/misc/other/SKILL.md',
    ], 'git-guardrails-claude-code')).toBe('skills/misc/git-guardrails-claude-code/SKILL.md')
  })
})
