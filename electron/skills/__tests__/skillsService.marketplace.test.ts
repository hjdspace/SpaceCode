// @vitest-environment node
/**
 * Marketplace surface of skillsService: search, resolve, install, readme, uninstall.
 *
 * The contract that matters here is *fallback order and honesty*:
 *  - searchMarketplace must serve the online API first, but degrade to the
 *    bundled default list on HTTP errors / non-JSON bodies — the UI never sees
 *    a hard failure. Successful payloads are cached per normalized query (1h),
 *    so repeated queries must not re-hit the network.
 *  - install resolution walks 12 direct candidate URLs (main/master x plugin-dev
 *    paths) BEFORE the GitHub tree API fallback; selectMarketplaceSkillPath is
 *    the final arbiter and must prefer `<skillId>/SKILL.md` directories over
 *    bare `<id>.md` files, normalising backslashes first.
 *  - install writes only after content is found; a failed install leaves no
 *    half-created target directory behind, and every step appends to `logs`.
 *
 * Module state (marketplaceCache) is per-import, so each test loads a fresh
 * module via resetModules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  netFetch: vi.fn(),
  fetchCalls: [] as string[],
  getPath: vi.fn((_name: string) => ''),
  getAppPath: vi.fn(() => ''),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return false
    },
    getPath: electronMock.getPath,
    getAppPath: electronMock.getAppPath,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, handler)
    }),
  },
  net: { fetch: electronMock.netFetch },
}))

type SkillsModule = typeof import('../skillsService')

interface FakeResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
  json?: unknown
}

function okText(body: string): FakeResponse {
  return { ok: true, status: 200, statusText: 'OK', body }
}
function okJson(data: unknown): FakeResponse {
  return { ok: true, status: 200, statusText: 'OK', body: JSON.stringify(data), json: data }
}
function notFound(): FakeResponse {
  return { ok: false, status: 404, statusText: 'Not Found', body: '' }
}

let home: string
let userData: string

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electronMock.handlers.get(channel)
  if (!handler) throw new Error(`handler ${channel} was not registered`)
  return (await handler({}, ...args)) as T
}

async function loadSkills(): Promise<SkillsModule> {
  vi.resetModules()
  const mod = (await import('../skillsService')) as SkillsModule
  mod.registerSkillsIPCHandlers()
  return mod
}

function route(routes: Array<{ matches: (url: string) => boolean; respond: () => FakeResponse }>): void {
  electronMock.netFetch.mockImplementation(async (url: string) => {
    electronMock.fetchCalls.push(url)
    const hit = routes.find((r) => r.matches(url))
    if (!hit) return notFound()
    const res = hit.respond()
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      text: async () => res.body,
      json: async () => {
        if (res.json === undefined) throw new SyntaxError('Unexpected token, not JSON')
        return res.json
      },
    }
  })
}

interface SearchItem {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
  isInstalled?: boolean
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sc-skills-market-'))
  userData = mkdtempSync(join(tmpdir(), 'sc-skills-user-'))
  electronMock.getPath.mockImplementation((name: string) => (name === 'userData' ? userData : home))
  electronMock.getAppPath.mockReturnValue(home)
  electronMock.handlers.clear()
  electronMock.fetchCalls = []
  electronMock.netFetch.mockReset()
  await loadSkills()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

describe('selectMarketplaceSkillPath — candidate selection', () => {
  it('prefers the SKILL.md whose parent directory equals the id over a bare markdown file', async () => {
    const mod = await loadSkills()
    expect(
      mod.selectMarketplaceSkillPath(
        ['skills/git-expert.md', 'skills/Git-Expert/SKILL.md'],
        'git-expert',
      ),
    ).toBe('skills/Git-Expert/SKILL.md')
  })

  it('falls back to an exact <id>.md file when no directory matches', async () => {
    const mod = await loadSkills()
    expect(mod.selectMarketplaceSkillPath(['docs/skills/alpha.md', 'README.md'], 'alpha')).toBe(
      'docs/skills/alpha.md',
    )
  })

  it('normalises backslashes and leading/trailing slashes before matching', async () => {
    const mod = await loadSkills()
    expect(mod.selectMarketplaceSkillPath(['\\skills\\misc\\nova\\SKILL.md\\'], 'nova')).toBe(
      'skills/misc/nova/SKILL.md',
    )
  })

  it('matches a single-segment SKILL.md only through the filename rule, never the directory rule', async () => {
    const mod = await loadSkills()
    // directory rule needs >= 2 segments, so 'SKILL.md' alone cannot match id 'skill' that way;
    // the lowercase filename rule ('skill.md') does match.
    expect(mod.selectMarketplaceSkillPath(['SKILL.md'], 'skill')).toBe('SKILL.md')
    expect(mod.selectMarketplaceSkillPath(['SKILL.md'], 'nova')).toBeNull()
  })

  it('returns null for a blank id even when paths contain matches', async () => {
    const mod = await loadSkills()
    expect(mod.selectMarketplaceSkillPath(['skills/nova/SKILL.md'], '  ')).toBeNull()
  })

  it('filters out empty segments caused by slash-heavy input', async () => {
    const mod = await loadSkills()
    expect(mod.selectMarketplaceSkillPath(['///', ''], 'nova')).toBeNull()
  })
})

describe('skills:searchMarketplace — API, cache and degradation', () => {
  interface SearchResult {
    skills: SearchItem[]
  }

  it('serves the API payload and flags names that already live in the global dirs', async () => {
    writeGlobalSkill('alpha-one', 'alpha-one')
    route([
      {
        matches: (u) => u.startsWith('https://skills.sh/api/search'),
        respond: () =>
          okJson({
            skills: [
              { id: 'a1', skillId: 'alpha-one', name: 'alpha-one', installs: 7, source: 'acme/alpha-one.md' },
              { id: 'b2', skillId: 'beta-two', name: 'beta-two', installs: 3, source: 'acme/beta-two.md' },
            ],
          }),
      },
    ])

    const result = await invoke<SearchResult>('skills:searchMarketplace', 'alpha')

    expect(electronMock.fetchCalls).toEqual(['https://skills.sh/api/search?q=alpha&limit=200'])
    // local filter keeps only the name/source containing 'alpha'
    expect(result.skills).toEqual([
      { id: 'a1', skillId: 'alpha-one', name: 'alpha-one', installs: 7, source: 'acme/alpha-one.md', isInstalled: true },
    ])
  })

  it('treats a blank query as the full index and does not filter locally', async () => {
    route([
      {
        matches: (u) => u.startsWith('https://skills.sh/api/search'),
        respond: () => okJson({ skills: [{ id: 'x', skillId: 'x', name: 'zeta', installs: 1, source: 'a/zeta.md' }] }),
      },
    ])

    const result = await invoke<SearchResult>('skills:searchMarketplace', '   ')
    expect(electronMock.fetchCalls).toEqual(['https://skills.sh/api/search?q=skill&limit=200'])
    expect(result.skills.map((s) => s.name)).toEqual(['zeta'])
  })

  it('answers a repeated query from cache without another network call', async () => {
    route([
      {
        matches: (u) => u.startsWith('https://skills.sh/api/search'),
        respond: () => okJson({ skills: [{ id: 'x', skillId: 'x', name: 'cachedq-skill', installs: 2, source: 'a/cachedq.md' }] }),
      },
    ])

    const first = await invoke<SearchResult>('skills:searchMarketplace', 'cachedq')
    const second = await invoke<SearchResult>('skills:searchMarketplace', 'cachedq')

    expect(electronMock.fetchCalls).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('degrades to the five default skills when the API answers 500', async () => {
    route([
      {
        matches: (u) => u.startsWith('https://skills.sh/api/search'),
        respond: () => ({ ok: false, status: 500, statusText: 'Server Error', body: '' }),
      },
    ])

    const result = await invoke<SearchResult>('skills:searchMarketplace', '')
    expect(result.skills.map((s) => s.name)).toEqual([
      'web-search',
      'git-expert',
      'code-reviewer',
      'test-writer',
      'doc-generator',
    ])
    expect(result.skills.every((s) => s.isInstalled === false)).toBe(true)
  })

  it('degrades to the defaults when the body is not JSON', async () => {
    route([
      { matches: (u) => u.startsWith('https://skills.sh/api/search'), respond: () => okText('<html>not json</html>') },
    ])

    const result = await invoke<SearchResult>('skills:searchMarketplace', '')
    expect(result.skills).toHaveLength(5)
  })

  it('returns an empty list when the JSON payload has no skills array', async () => {
    route([
      {
        matches: (u) => u.startsWith('https://skills.sh/api/search'),
        respond: () => okJson({ tools: [] }),
      },
    ])

    const result = await invoke<SearchResult>('skills:searchMarketplace', '')
    expect(result).toEqual({ skills: [] })
  })
})

describe('skills:installMarketplaceSkill — resolution and writing', () => {
  interface InstallResult {
    success: boolean
    skillName?: string
    installPath?: string
    error?: string
    logs: string[]
  }

  it('installs through the first direct candidate URL into the global skills dir', async () => {
    const candidate = 'https://raw.githubusercontent.com/o/r/main/plugins/plugin-dev/skills/nova/SKILL.md'
    route([
      { matches: (u) => u === candidate, respond: () => okText('# nova skill') },
    ])

    const result = await invoke<InstallResult>('skills:installMarketplaceSkill', 'o/r', 'nova', true)

    expect(result.success).toBe(true)
    expect(result.skillName).toBe('nova')
    expect(result.installPath).toBe(join(home, '.claude', 'skills', 'nova'))
    expect(electronMock.fetchCalls[0]).toBe(candidate)
    // the probe hit and the content download both target the resolved URL
    expect(electronMock.fetchCalls).toEqual([candidate, candidate])
    expect(readFileSync(join(home, '.claude', 'skills', 'nova', 'SKILL.md'), 'utf-8')).toBe('# nova skill')
  })

  it('falls back to the GitHub tree API and builds the raw URL from the default branch', async () => {
    route([
      {
        matches: (u) => u === 'https://api.github.com/repos/o/r',
        respond: () => okJson({ default_branch: 'release' }),
      },
      {
        matches: (u) => u === 'https://api.github.com/repos/o/r/git/trees/release?recursive=1',
        respond: () =>
          okJson({
            tree: [
              { path: 'docs/skills/nova/SKILL.md', type: 'blob' },
              { path: 'docs/skills/nova', type: 'tree' },
              { path: 'README.md', type: 'blob' },
            ],
          }),
      },
      {
        matches: (u) => u === 'https://raw.githubusercontent.com/o/r/release/docs/skills/nova/SKILL.md',
        respond: () => okText('# nova from tree'),
      },
    ])

    const result = await invoke<InstallResult>('skills:installMarketplaceSkill', 'o/r', 'nova', true)

    expect(result.success).toBe(true)
    expect(readFileSync(join(home, '.claude', 'skills', 'nova', 'SKILL.md'), 'utf-8')).toBe('# nova from tree')
    expect(result.logs).toContain('✓ Found skill file at: https://raw.githubusercontent.com/o/r/release/docs/skills/nova/SKILL.md')
  })

  it('creates missing project directories when installing with project scope', async () => {
    const cwd = join(home, 'project')
    route([
      {
        matches: (u) => u.startsWith('https://raw.githubusercontent.com/o/r/'),
        respond: () => okText('# nova project'),
      },
    ])

    const result = await invoke<InstallResult>('skills:installMarketplaceSkill', 'o/r', 'nova', false, cwd)

    expect(result.success).toBe(true)
    expect(result.installPath).toBe(join(cwd, '.claude', 'skills', 'nova'))
    expect(readFileSync(join(cwd, '.claude', 'skills', 'nova', 'SKILL.md'), 'utf-8')).toBe('# nova project')
  })

  it('reports failure without creating a target directory when no skill file exists', async () => {
    route([{ matches: () => true, respond: () => notFound() }])

    const result = await invoke<InstallResult>('skills:installMarketplaceSkill', 'o/r', 'ghost', true)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Could not find skill file for ghost in o/r')
    expect(result.logs[result.logs.length - 1]).toBe('✗ Error: Could not find skill file for ghost in o/r')
    expect(existsSync(join(home, '.claude', 'skills', 'ghost'))).toBe(false)
  })

  it('survives transport errors on every candidate and still fails cleanly', async () => {
    electronMock.netFetch.mockImplementation(async (url: string) => {
      electronMock.fetchCalls.push(url)
      throw new Error('ETIMEDOUT')
    })

    const result = await invoke<InstallResult>('skills:installMarketplaceSkill', 'o/r', 'nova', true)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Could not find skill file for nova in o/r')
  })

  it('converts a github.com blob URL source into the raw URL and writes under the skillId', async () => {
    route([
      {
        matches: (u) => u === 'https://raw.githubusercontent.com/o/r/main/skills/nova/SKILL.md',
        respond: () => okText('# nova via url'),
      },
    ])

    const result = await invoke<InstallResult>(
      'skills:installMarketplaceSkill',
      'https://github.com/o/r/blob/main/skills/nova/SKILL.md',
      'url-nova',
      true,
    )

    expect(result.success).toBe(true)
    expect(result.skillName).toBe('url-nova')
    expect(readFileSync(join(home, '.claude', 'skills', 'url-nova', 'SKILL.md'), 'utf-8')).toBe('# nova via url')
  })

  it('fails the URL branch with the HTTP status when the download is not ok', async () => {
    route([
      {
        matches: (u) => u.startsWith('https://raw.githubusercontent.com/'),
        respond: () => ({ ok: false, status: 451, statusText: 'Unavailable', body: '' }),
      },
    ])

    const result = await invoke<InstallResult>(
      'skills:installMarketplaceSkill',
      'https://github.com/o/r/blob/main/skills/nova/SKILL.md',
      'nova',
      true,
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to fetch skill: HTTP 451')
  })

  it('derives the skill name from the URL tail when no skillId is given', async () => {
    route([
      {
        matches: (u) => u.startsWith('https://raw.githubusercontent.com/'),
        respond: () => okText('# tail'),
      },
    ])

    const result = await invoke<InstallResult>(
      'skills:installMarketplaceSkill',
      'https://github.com/o/r/blob/main/skills/tail-skill.md',
      '',
      true,
    )

    expect(result.success).toBe(true)
    expect(result.skillName).toBe('tail-skill')
    expect(existsSync(join(home, '.claude', 'skills', 'tail-skill', 'SKILL.md'))).toBe(true)
  })
})

describe('skills:uninstallMarketplaceSkill', () => {
  it('removes both the directory form and the legacy flat file across global dirs', async () => {
    mkdirSync(join(home, '.claude', 'skills', 'oldie'), { recursive: true })
    writeFileSync(join(home, '.claude', 'skills', 'oldie', 'SKILL.md'), '# oldie', 'utf-8')
    mkdirSync(join(home, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(home, '.claude', 'commands', 'oldie.md'), '# legacy', 'utf-8')

    const result = await invoke<{ success: boolean }>('skills:uninstallMarketplaceSkill', 'oldie', true)

    expect(result).toEqual({ success: true })
    expect(existsSync(join(home, '.claude', 'skills', 'oldie'))).toBe(false)
    expect(existsSync(join(home, '.claude', 'commands', 'oldie.md'))).toBe(false)
  })

  it('rejects when the skill is not installed in any scope', async () => {
    await expect(invoke('skills:uninstallMarketplaceSkill', 'ghost', true)).rejects.toThrow(
      "Skill 'ghost' is not installed",
    )
  })
})

describe('skills:fetchMarketplaceReadme', () => {
  it('fetches a converted raw URL directly for http sources', async () => {
    route([
      {
        matches: (u) => u === 'https://raw.githubusercontent.com/o/r/main/skills/nova/SKILL.md',
        respond: () => okText('# readme body'),
      },
    ])

    const result = await invoke<{ content: string | null }>(
      'skills:fetchMarketplaceReadme',
      'https://github.com/o/r/blob/main/skills/nova/SKILL.md',
      'nova',
    )
    expect(result).toEqual({ content: '# readme body' })
  })

  it('returns null without inventing content when the source path cannot be resolved', async () => {
    route([{ matches: () => true, respond: () => notFound() }])

    const result = await invoke<{ content: string | null }>(
      'skills:fetchMarketplaceReadme',
      'o/r',
      'ghost',
    )
    expect(result).toEqual({ content: null })
  })

  it('returns null when the readme download fails', async () => {
    route([
      {
        matches: (u) => u.startsWith('https://raw.githubusercontent.com/'),
        respond: () => ({ ok: false, status: 503, statusText: 'Down', body: '' }),
      },
    ])

    const result = await invoke<{ content: string | null }>(
      'skills:fetchMarketplaceReadme',
      'https://github.com/o/r/blob/main/skills/nova.md',
      'nova',
    )
    expect(result).toEqual({ content: null })
  })
})

function writeGlobalSkill(dirName: string, name: string): void {
  const dir = join(home, '.claude', 'skills', dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} d\n---\n`, 'utf-8')
}
