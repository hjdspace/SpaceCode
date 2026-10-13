// @vitest-environment node
/**
 * Local skill discovery and per-skill CRUD on skillsService.
 *
 * Contract: the scan is forgiving but never invents data.
 *  - a directory only counts as a skill when it carries SKILL.md; a missing
 *    front-matter name falls back to the directory (or file) name, a missing
 *    description falls back to the first body line, and finally to `Skill: /<name>`
 *  - an unreadable SKILL.md or an unreadable skills dir is skipped with an error
 *    log — one broken skill must not blank the whole result
 *  - builtin (bundled) skills read their content from <resources>/engine when
 *    packaged and render the read-only banner otherwise; the sentinel content
 *    `# Skill` counts as "no file" and yields the banner
 *  - delete distinguishes the SKILL.md directory form (drop the whole folder)
 *    from the legacy flat file (drop just the file), and refuses builtin:// paths
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn((_name: string) => ''),
  getAppPath: vi.fn(() => ''),
}))

const runtime = vi.hoisted(() => ({
  isPackaged: false,
  resourcesPath: '',
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return runtime.isPackaged
    },
    getPath: electronMock.getPath,
    getAppPath: electronMock.getAppPath,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, handler)
    }),
  },
  net: { fetch: vi.fn() },
}))

import { BUNDLED_SKILLS, registerSkillsIPCHandlers } from '../skillsService'

interface SkillDto {
  name: string
  description: string
  content: string
  source: string
  filePath: string
  paths?: string[]
}

let home: string
let resources: string

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electronMock.handlers.get(channel)
  if (!handler) throw new Error(`handler ${channel} was not registered`)
  return (await handler({}, ...args)) as T
}

function writeSkill(dir: string, frontMatter: string, body = ''): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `${frontMatter}\n${body}`, 'utf-8')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-skills-scan-'))
  resources = mkdtempSync(join(tmpdir(), 'sc-skills-res-'))
  runtime.isPackaged = false
  ;(process as unknown as { resourcesPath: string }).resourcesPath = resources
  electronMock.getPath.mockImplementation((name: string) => (name === 'userData' ? join(home, 'userdata') : home))
  electronMock.getAppPath.mockReturnValue(home)
  electronMock.handlers.clear()
  registerSkillsIPCHandlers()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(resources, { recursive: true, force: true })
})

describe('skills:getSkills — fallbacks and forgiveness', () => {
  it('reads legacy flat .md commands and derives name and description from the file itself', async () => {
    mkdirSync(join(home, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(home, '.claude', 'commands', 'solo.md'), '# Solo Title\n\nbody text', 'utf-8')

    const result = await invoke<{ skills: SkillDto[] }>('skills:getSkills')

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({
      name: 'solo',
      description: 'Solo Title',
      source: 'global',
      filePath: join(home, '.claude', 'commands', 'solo.md'),
    })
  })

  it('prefers the front-matter name over the directory name and skips folders without SKILL.md', async () => {
    writeSkill(join(home, '.claude', 'skills', 'folder'), '---\nname: real-name\ndescription: d\n---')
    mkdirSync(join(home, '.claude', 'skills', 'not-a-skill'), { recursive: true })

    const result = await invoke<{ skills: SkillDto[] }>('skills:getSkills')

    expect(result.skills.map((s) => s.name)).toEqual(['real-name'])
  })

  it('falls back to the first body line, then to the Skill: /name banner when metadata is absent', async () => {
    // no front matter at all -> first non-empty line becomes the description
    writeSkill(join(home, '.claude', 'skills', 'plain-body'), 'Plain body sentence', '\nmore text')
    // front matter that parses to nothing usable -> every line is a comment/heading,
    // so even the body scan finds nothing and the banner wins
    writeSkill(join(home, '.claude', 'skills', 'heading-only'), '---\n# only a yaml comment\n---', '# Only A Heading')

    const result = await invoke<{ skills: SkillDto[] }>('skills:getSkills')
    const byName = Object.fromEntries(result.skills.map((s) => [s.name, s.description]))

    expect(byName).toEqual({
      'plain-body': 'Plain body sentence',
      'heading-only': 'Skill: /heading-only',
    })
  })

  it('drops an unreadable SKILL.md but keeps the rest of the scan alive', async () => {
    writeSkill(join(home, '.claude', 'skills', 'good'), '---\nname: good\ndescription: d\n---')
    mkdirSync(join(home, '.claude', 'skills', 'broken', 'SKILL.md'), { recursive: true })

    const result = await invoke<{ skills: SkillDto[] }>('skills:getSkills')

    expect(result.skills.map((s) => s.name)).toEqual(['good'])
  })

  it('survives a skills root that is a regular file (readdir throws)', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'skills'), 'not a directory', 'utf-8')
    writeSkill(join(home, '.claude', 'commands', 'cmd'), '---\nname: cmd\ndescription: d\n---')

    const result = await invoke<{ skills: SkillDto[] }>('skills:getSkills')

    expect(result.skills.map((s) => s.name)).toEqual(['cmd'])
  })

  it('scans project directories only when a cwd is supplied', async () => {
    const cwd = join(home, 'project')
    writeSkill(join(cwd, '.claude', 'skills', 'proj'), '---\nname: proj\ndescription: d\n---')

    const withoutCwd = await invoke<{ skills: SkillDto[] }>('skills:getSkills')
    const withCwd = await invoke<{ skills: SkillDto[] }>('skills:getSkills', cwd)

    expect(withoutCwd.skills).toEqual([])
    expect(withCwd.skills.map((s) => s.source)).toEqual(['project'])
  })
})

describe('skills:getBundledSkills', () => {
  it('serves disk content for packaged builds and the read-only banner for the rest', async () => {
    runtime.isPackaged = true
    const diskSkill = join(resources, 'engine', 'src', 'skills', 'bundled', 'debug', 'SKILL.md')
    mkdirSync(join(diskSkill, '..'), { recursive: true })
    writeFileSync(diskSkill, '\n# Debug from disk\n\n', 'utf-8')

    const result = await invoke<{ skills: SkillDto[] }>('skills:getBundledSkills')

    expect(result.skills).toHaveLength(BUNDLED_SKILLS.length)
    const debug = result.skills.find((s) => s.name === 'debug')
    expect(debug?.content).toBe('# Debug from disk')
    const verify = result.skills.find((s) => s.name === 'verify')
    expect(verify?.content).toBe(
      '# /verify\n\nVerify implementation against requirements\n\n> Built-in CLI skill (read-only). ' +
        'This skill is bundled with Claude Code and cannot be edited or deleted.',
    )
    expect(verify).toMatchObject({ source: 'builtin', filePath: 'builtin://verify' })
  })

  it('treats the sentinel "# Skill" file as absent and keeps the banner', async () => {
    runtime.isPackaged = true
    const dir = join(resources, 'engine', 'src', 'skills', 'bundled', 'loop')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '# Skill', 'utf-8')

    const result = await invoke<{ skills: SkillDto[] }>('skills:getBundledSkills')
    const loop = result.skills.find((s) => s.name === 'loop')

    expect(loop?.content).toContain('# /loop')
    expect(loop?.content).not.toBe('# Skill')
  })
})

describe('skills:createSkill / saveSkill / deleteSkill', () => {
  it('creates a global skill under the first global dir and titles the description', async () => {
    const result = await invoke<{ skill: SkillDto }>(
      'skills:createSkill',
      'brand-new',
      'global',
      '# Brand New Title\n\nbody',
    )

    const target = join(home, '.claude', 'commands', 'brand-new', 'SKILL.md')
    expect(result.skill).toMatchObject({
      name: 'brand-new',
      description: 'Brand New Title',
      source: 'global',
      filePath: target,
    })
    expect(existsSync(target)).toBe(true)
  })

  it('creates a project skill under the given cwd', async () => {
    const cwd = join(home, 'project')
    const result = await invoke<{ skill: SkillDto }>('skills:createSkill', 'proj-skill', 'project', 'body', cwd)

    expect(result.skill.filePath).toBe(join(cwd, '.claude', 'commands', 'proj-skill', 'SKILL.md'))
    expect(existsSync(result.skill.filePath)).toBe(true)
  })

  it('refuses to save over a builtin skill', async () => {
    const skill: SkillDto = {
      name: 'debug',
      description: 'd',
      content: 'c',
      source: 'builtin',
      filePath: 'builtin://debug',
    }
    await expect(invoke('skills:saveSkill', skill, 'new content')).rejects.toThrow(
      'Built-in skills cannot be modified',
    )
  })

  it('rewrites content and re-titles the description, keeping the old one for a blank first line', async () => {
    const dir = join(home, '.claude', 'skills', 'edits')
    writeSkill(dir, '---\nname: edits\ndescription: original\n---')
    const filePath = join(dir, 'SKILL.md')

    const titled = await invoke<{ skill: SkillDto }>('skills:saveSkill', {
      name: 'edits',
      description: 'original',
      content: 'x',
      source: 'global',
      filePath,
    }, '# Fresh Title\n\nrest')
    expect(titled.skill.description).toBe('Fresh Title')

    const blank = await invoke<{ skill: SkillDto }>('skills:saveSkill', {
      name: 'edits',
      description: 'original',
      content: 'x',
      source: 'global',
      filePath,
    }, '\nno heading here')
    expect(blank.skill.description).toBe('original')
  })

  it('propagates a write failure when the save target is gone', async () => {
    const missing = join(home, 'nowhere', 'SKILL.md')
    await expect(
      invoke('skills:saveSkill', { name: 'g', description: 'd', content: 'c', source: 'global', filePath: missing }, 'body'),
    ).rejects.toThrow()
  })

  it('deletes the whole skill folder for the SKILL.md form but only the file for the legacy form', async () => {
    const dir = join(home, '.claude', 'skills', 'dirform')
    writeSkill(dir, '---\nname: dirform\ndescription: d\n---')
    writeFileSync(join(dir, 'helper.txt'), 'keep? no', 'utf-8')
    mkdirSync(join(home, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(home, '.claude', 'commands', 'legacy.md'), '# legacy', 'utf-8')

    expect(await invoke<{ success: boolean }>('skills:deleteSkill', join(dir, 'SKILL.md'))).toEqual({ success: true })
    expect(existsSync(dir)).toBe(false)

    expect(await invoke<{ success: boolean }>('skills:deleteSkill', join(home, '.claude', 'commands', 'legacy.md'))).toEqual({ success: true })
    expect(existsSync(join(home, '.claude', 'commands', 'legacy.md'))).toBe(false)
    expect(existsSync(join(home, '.claude', 'commands'))).toBe(true)
  })

  it('treats deleting a missing path as success but refuses builtin:// targets', async () => {
    expect(await invoke<{ success: boolean }>('skills:deleteSkill', join(home, 'gone', 'SKILL.md'))).toEqual({ success: true })
    await expect(invoke('skills:deleteSkill', 'builtin://debug')).rejects.toThrow('Built-in skills cannot be deleted')
  })
})

describe('skills:discoverDynamicSkills', () => {
  it('walks from the file up to the cwd root and visits every .claude/skills exactly once', async () => {
    const cwd = join(home, 'project')
    writeSkill(join(cwd, '.claude', 'skills', 'root-skill'), '---\nname: root-skill\ndescription: d\n---')
    writeSkill(join(cwd, 'src', 'pkg', '.claude', 'skills', 'deep-skill'), '---\nname: deep-skill\ndescription: d\n---')

    const result = await invoke<{ skills: SkillDto[] }>('skills:discoverDynamicSkills', [
      join(cwd, 'src', 'pkg', 'a.ts'),
      join(cwd, 'src', 'other.ts'),
    ], cwd)

    expect(result.skills.map((s) => s.name).sort()).toEqual(['deep-skill', 'root-skill'])
  })

  it('ignores files outside the cwd and dedupes across shared ancestors', async () => {
    const cwd = join(home, 'project')
    const outside = join(home, 'elsewhere')
    writeSkill(join(cwd, '.claude', 'skills', 'inside'), '---\nname: inside\ndescription: d\n---')
    writeSkill(join(outside, '.claude', 'skills', 'leak'), '---\nname: leak\ndescription: d\n---')

    const result = await invoke<{ skills: SkillDto[] }>('skills:discoverDynamicSkills', [
      join(outside, 'x.ts'),
      join(cwd, 'a.ts'),
      join(cwd, 'b.ts'),
    ], cwd)

    expect(result.skills.map((s) => s.name)).toEqual(['inside'])
  })
})

describe('skills:getConditionalSkills', () => {
  it('keeps only skills that declare a non-empty paths list and tags their scope', async () => {
    writeSkill(join(home, '.claude', 'skills', 'gated'), '---\nname: gated\ndescription: d\npaths:\n  - src/**\n  - docs/**\n---')
    writeSkill(join(home, '.claude', 'commands', 'open'), '---\nname: open\ndescription: d\npaths: []\n---')
    // cwd must sit outside the home dir: the scope tag is `dir.includes(home)`
    const cwd = mkdtempSync(join(tmpdir(), 'sc-skills-proj-'))
    try {
      writeSkill(join(cwd, '.claude', 'skills', 'proj-gated'), '---\nname: proj-gated\ndescription: d\npaths: [app/**]\n---')

      const result = await invoke<{ skills: SkillDto[] }>('skills:getConditionalSkills', cwd)
      const byName = Object.fromEntries(result.skills.map((s) => [s.name, s]))

      expect(Object.keys(byName).sort()).toEqual(['gated', 'proj-gated'])
      expect(byName.gated.paths).toEqual(['src/**', 'docs/**'])
      expect(byName.gated.source).toBe('global')
      expect(byName['proj-gated'].paths).toEqual(['app/**'])
      expect(byName['proj-gated'].source).toBe('project')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('skips a conditional scan entry whose SKILL.md cannot be read', async () => {
    mkdirSync(join(home, '.claude', 'skills', 'broken-dir', 'SKILL.md'), { recursive: true })
    writeSkill(join(home, '.claude', 'skills', 'ok'), '---\nname: ok\ndescription: d\npaths: [x/**]\n---')

    const result = await invoke<{ skills: SkillDto[] }>('skills:getConditionalSkills', undefined)

    expect(result.skills.map((s) => s.name)).toEqual(['ok'])
  })
})
