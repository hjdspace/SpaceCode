// @vitest-environment node
/**
 * Local skill library: bundle scanning, skill/bundle install & uninstall,
 * custom directory registry.
 *
 * Contracts that must not silently drift:
 *  - a directory is a plugin bundle only when it carries
 *    `.claude-plugin/plugin.json` (or marketplace.json); bundle category is
 *    resolved override-table -> manifest category -> child-skills mode ->
 *    keyword inference, in that order.
 *  - bundle install is copy-first, bookkeeping-second: cpSync into the
 *    versioned cache path happens BEFORE installed_plugins.json / settings /
 *    known_marketplaces are touched, so a failed copy leaves no dangling
 *    registry entries (there is no rollback to rely on).
 *  - an existing versioned cache dir is never re-copied (user edits survive a
 *    re-install); a plugin source pointing outside the bundle is rejected.
 *  - uninstall only deletes an installPath when no other plugin entry still
 *    references it; batch skill installs isolate failures per item.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn((_name: string) => ''),
  getAppPath: vi.fn(() => ''),
}))

const runtime = vi.hoisted(() => ({
  isPackaged: true,
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

import { registerLocalLibraryIPCHandlers } from '../skillsService'

interface LocalSkillDto {
  name: string
  description: string
  category: string
  tags?: string[]
  isInstalled: boolean
  bundleId?: string
  bundleName?: string
  packName?: string
  skillPath: string
  sourceDir: string
}

interface BundleDto {
  id: string
  name: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  license?: string
  keywords?: string[]
  category: string
  bundleDir: string
  hasHooks: boolean
  hasCommands: boolean
  hasAgents: boolean
  skillCount: number
  isInstalled: boolean
  installedScope?: 'global' | 'project' | 'mixed'
}

interface ScanResult {
  skills: LocalSkillDto[]
  bundles: BundleDto[]
  packs: unknown[]
}

let home: string
let userData: string
let resources: string
let libRoot: string

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electronMock.handlers.get(channel)
  if (!handler) throw new Error(`handler ${channel} was not registered`)
  return (await handler({}, ...args)) as T
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value), 'utf-8')
}

function readJson<T = Record<string, unknown>>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T
}

function writeSkill(dir: string, name: string, extraFrontMatter = ''): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n${extraFrontMatter}---\n`, 'utf-8')
}

function makeBundle(bundleDir: string, manifest: Record<string, unknown>): void {
  writeJson(join(bundleDir, '.claude-plugin', 'plugin.json'), manifest)
}

function installedPluginsFile(): string {
  return join(home, '.claude', 'plugins', 'installed_plugins.json')
}
function knownMarketplacesFile(): string {
  return join(home, '.claude', 'plugins', 'known_marketplaces.json')
}
function globalSettingsFile(): string {
  return join(home, '.claude', 'settings.json')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-local-lib-'))
  userData = mkdtempSync(join(tmpdir(), 'sc-local-user-'))
  resources = mkdtempSync(join(tmpdir(), 'sc-local-res-'))
  runtime.isPackaged = true
  ;(process as unknown as { resourcesPath: string }).resourcesPath = resources
  libRoot = join(resources, 'skills-lib')
  mkdirSync(libRoot, { recursive: true })
  electronMock.getPath.mockImplementation((name: string) => (name === 'userData' ? userData : home))
  electronMock.getAppPath.mockReturnValue(home)
  electronMock.handlers.clear()
  registerLocalLibraryIPCHandlers()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
  rmSync(resources, { recursive: true, force: true })
})

describe('skills:scan-local-library — plugin bundles', () => {
  it('parses every manifest field the UI needs and honours the explicit category', async () => {
    const bundle = join(home, 'bundles', 'demo')
    makeBundle(bundle, {
      name: 'demo',
      version: '1.2.0',
      description: 'demo bundle',
      author: { name: 'Ada' },
      homepage: 'https://example.com',
      license: 'MIT',
      keywords: ['one', 'two'],
      category: 'AI ML',
    })
    writeSkill(join(bundle, 'skills', 's1'), 's1')
    writeSkill(join(bundle, 'skills', 's2'), 's2', 'tags: [x, y]\n')
    mkdirSync(join(bundle, 'hooks'), { recursive: true })
    mkdirSync(join(bundle, 'agents'), { recursive: true })

    const result = await invoke<ScanResult>('skills:scan-local-library', [bundle])

    expect(result.bundles).toHaveLength(1)
    expect(result.bundles[0]).toMatchObject({
      id: bundle,
      name: 'demo',
      version: '1.2.0',
      description: 'demo bundle',
      author: 'Ada',
      homepage: 'https://example.com',
      license: 'MIT',
      keywords: ['one', 'two'],
      category: 'ai-ml',
      bundleDir: bundle,
      hasHooks: true,
      hasCommands: false,
      hasAgents: true,
      skillCount: 2,
      isInstalled: false,
    })
    const s2 = result.skills.find((s) => s.name === 's2')
    expect(s2?.tags).toEqual(['x', 'y'])
    expect(result.skills.every((s) => s.bundleName === 'demo')).toBe(true)
  })

  it('takes the bundle category from the child-skill majority when the manifest is silent', async () => {
    const bundle = join(home, 'bundles', 'mode-bundle')
    makeBundle(bundle, { name: 'mode-bundle', author: 'Solo Author' })
    writeSkill(join(bundle, 'skills', 'o1'), 'o1', 'category: Office\n')
    writeSkill(join(bundle, 'skills', 'o2'), 'o2', 'category: Office\n')
    writeSkill(join(bundle, 'skills', 'c1'), 'c1', 'category: Creative\n')

    const result = await invoke<ScanResult>('skills:scan-local-library', [bundle])

    expect(result.bundles[0].category).toBe('office')
    expect(result.bundles[0].author).toBe('Solo Author')
    expect(result.bundles[0].keywords).toBeUndefined()
  })

  it('applies the name override table ahead of everything else', async () => {
    const bundle = join(home, 'bundles', 'mcp-builder')
    makeBundle(bundle, { name: 'mcp-builder', category: 'Office' })

    const result = await invoke<ScanResult>('skills:scan-local-library', [bundle])

    // CATEGORY_OVERRIDES wins over the manifest's own category
    expect(result.bundles[0].category).toBe('ai-ml')
  })

  it('marks a bundle installed from v2 user entries, project entries and the legacy plugins dir', async () => {
    const cwd = join(home, 'project')
    const globalBundle = join(home, 'bundles', 'g-demo')
    const projectBundle = join(home, 'bundles', 'p-demo')
    const bothBundle = join(home, 'bundles', 'b-demo')
    makeBundle(globalBundle, { name: 'g-demo' })
    makeBundle(projectBundle, { name: 'p-demo' })
    makeBundle(bothBundle, { name: 'b-demo' })
    writeJson(installedPluginsFile(), {
      version: 2,
      plugins: {
        'g-demo@local-skills': [{ scope: 'user', installPath: join(home, 'x1') }],
        'p-demo@local-skills': [{ scope: 'project', projectPath: cwd, installPath: join(home, 'x2') }],
        'b-demo@local-skills': [
          { scope: 'user', installPath: join(home, 'x3') },
          { scope: 'project', projectPath: cwd, installPath: join(home, 'x4') },
        ],
      },
    })

    const scan = async (dirs: string[], scanCwd?: string) =>
      (await invoke<ScanResult>('skills:scan-local-library', dirs, scanCwd)).bundles[0]

    expect(await scan([globalBundle])).toMatchObject({ isInstalled: true, installedScope: 'global' })
    // a project entry stops matching when a different cwd is supplied
    expect(await scan([projectBundle], join(home, 'other-project'))).toMatchObject({ isInstalled: false })
    expect(await scan([projectBundle], cwd)).toMatchObject({ isInstalled: true, installedScope: 'project' })
    expect(await scan([bothBundle], cwd)).toMatchObject({ installedScope: 'mixed' })

    const legacyBundle = join(home, 'bundles', 'legacy-demo')
    makeBundle(legacyBundle, { name: 'legacy-demo' })
    mkdirSync(join(home, '.claude', 'plugins', 'legacy-demo', '.claude-plugin'), { recursive: true })
    writeFileSync(join(home, '.claude', 'plugins', 'legacy-demo', '.claude-plugin', 'plugin.json'), '{}', 'utf-8')

    expect((await scan([legacyBundle])).isInstalled).toBe(true)
  })

  it('migrates v1 installed_plugins entries into the v2 shape before deciding', async () => {
    const bundle = join(home, 'bundles', 'demo')
    makeBundle(bundle, { name: 'demo' })
    writeJson(installedPluginsFile(), {
      plugins: { 'demo@local-skills': { installPath: join(home, 'x'), version: '0.1.0' } },
    })

    const result = await invoke<ScanResult>('skills:scan-local-library', [bundle])
    expect(result.bundles[0].isInstalled).toBe(true)
  })

  it('resolves the legacy "skills-lib" prefix and warns into the primary path when no root exists', async () => {
    writeSkill(join(libRoot, 'loose', 'finder'), 'finder')

    const viaLegacyPrefix = await invoke<ScanResult>('skills:scan-local-library', ['skills-lib'])
    expect(viaLegacyPrefix.skills.map((s) => s.name)).toContain('finder')

    // packaged with a missing resources dir everywhere -> falls back to primary, scan finds nothing
    ;(process as unknown as { resourcesPath: string }).resourcesPath = join(resources, 'missing')
    const empty = await invoke<ScanResult>('skills:scan-local-library', ['resources/skills-lib'])
    expect(empty).toEqual({ skills: [], bundles: [], packs: [] })
  })
})

describe('skills:install-local / uninstall-local', () => {
  it('copies the whole skill folder for the SKILL.md form and only the file for a flat source', async () => {
    const src = join(home, 'src', 'copied')
    writeSkill(src, 'copied')
    mkdirSync(join(src, 'assets'), { recursive: true })
    writeFileSync(join(src, 'assets', 'data.txt'), 'payload', 'utf-8')

    const result = await invoke<{ success: boolean }>('skills:install-local', 'copied', 'global', undefined, join(src, 'SKILL.md'))

    expect(result).toEqual({ success: true })
    const target = join(home, '.claude', 'commands', 'copied', 'SKILL.md')
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(join(home, '.claude', 'commands', 'copied', 'assets', 'data.txt'), 'utf-8')).toBe('payload')

    const flatSrc = join(home, 'src', 'note.md')
    mkdirSync(join(home, 'src'), { recursive: true })
    writeFileSync(flatSrc, '# note content', 'utf-8')
    await invoke('skills:install-local', 'note', 'global', undefined, flatSrc)
    expect(readFileSync(join(home, '.claude', 'commands', 'note', 'SKILL.md'), 'utf-8')).toBe('# note content')
  })

  it('refuses to install over an existing skill in either the directory or the legacy shape', async () => {
    const src = join(home, 'src')
    writeSkill(src, 'dup')
    await invoke('skills:install-local', 'dup', 'global', undefined, join(src, 'SKILL.md'))

    await expect(invoke('skills:install-local', 'dup', 'global', undefined, join(src, 'SKILL.md'))).rejects.toThrow(
      "Skill 'dup' is already installed",
    )

    mkdirSync(join(home, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(home, '.claude', 'commands', 'legacy.md'), '# old', 'utf-8')
    await expect(invoke('skills:install-local', 'legacy', 'global', undefined, join(src, 'SKILL.md'))).rejects.toThrow(
      "Skill 'legacy' is already installed",
    )
  })

  it('finds a skill by name through the built-in library when no source path is given', async () => {
    writeSkill(join(libRoot, 'libpack', 'skills', 'cat', 'libfind'), 'libfind')

    await invoke('skills:install-local', 'libfind', 'project', join(home, 'project'))

    expect(existsSync(join(home, 'project', '.claude', 'commands', 'libfind', 'SKILL.md'))).toBe(true)
    await expect(invoke('skills:install-local', 'ghost-skill', 'global')).rejects.toThrow(
      "Skill 'ghost-skill' source not found",
    )
  })

  it('installs batch items independently, keeping per-item errors visible', async () => {
    const goodSrc = join(home, 'src', 'good')
    writeSkill(goodSrc, 'good')
    const takenSrc = join(home, 'src', 'taken')
    writeSkill(takenSrc, 'taken')
    mkdirSync(join(home, '.claude', 'commands', 'taken', '..'), { recursive: true })
    mkdirSync(join(home, '.claude', 'commands', 'taken'), { recursive: true })
    writeFileSync(join(home, '.claude', 'commands', 'taken', 'SKILL.md'), '# exists', 'utf-8')

    const result = await invoke<{
      results: Array<{ name: string; success: boolean; error?: string }>
    }>('skills:install-local-batch', [
      { name: 'good', skillPath: join(goodSrc, 'SKILL.md') },
      { name: 'taken', skillPath: join(takenSrc, 'SKILL.md') },
      { name: 'ghost', skillPath: join(home, 'nowhere.md') },
      { name: 'nopath' },
    ], 'global')

    expect(result.results).toEqual([
      { name: 'good', success: true },
      { name: 'taken', success: false, error: "Skill 'taken' is already installed" },
      { name: 'ghost', success: false, error: "Skill 'ghost' source not found" },
      { name: 'nopath', success: false, error: "Skill 'nopath' source not found" },
    ])
    expect(existsSync(join(home, '.claude', 'commands', 'good', 'SKILL.md'))).toBe(true)
  })

  it('uninstalls the skill from every global and project dir in both shapes', async () => {
    mkdirSync(join(home, '.claude', 'commands', 'gone'), { recursive: true })
    writeFileSync(join(home, '.claude', 'commands', 'gone', 'SKILL.md'), '# g', 'utf-8')
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
    writeFileSync(join(home, '.claude', 'skills', 'gone.md'), '# legacy', 'utf-8')
    const cwd = join(home, 'project')
    mkdirSync(join(cwd, '.claude', 'skills', 'gone'), { recursive: true })
    writeFileSync(join(cwd, '.claude', 'skills', 'gone', 'SKILL.md'), '# p', 'utf-8')

    const result = await invoke<{ success: boolean }>('skills:uninstall-local', 'gone', cwd)

    expect(result).toEqual({ success: true })
    expect(existsSync(join(home, '.claude', 'commands', 'gone'))).toBe(false)
    expect(existsSync(join(home, '.claude', 'skills', 'gone.md'))).toBe(false)
    expect(existsSync(join(cwd, '.claude', 'skills', 'gone'))).toBe(false)

    await expect(invoke('skills:uninstall-local', 'gone', cwd)).rejects.toThrow("Skill 'gone' is not installed")
  })
})

describe('skills:install-local-bundle / uninstall-local-bundle', () => {
  function makeInstallableBundle(): string {
    const bundle = join(home, 'src', 'demo')
    makeBundle(bundle, { name: 'demo', version: '1.2.0' })
    writeSkill(join(bundle, 'skills', 's1'), 's1')
    return bundle
  }

  it('copies into the versioned cache first, then records plugin, setting and marketplace', async () => {
    const bundle = makeInstallableBundle()

    const result = await invoke<{ success: boolean; bundleName: string; targetDir: string }>(
      'skills:install-local-bundle', bundle, 'global',
    )

    const targetDir = join(home, '.claude', 'plugins', 'cache', 'local-skills', 'demo', '1.2.0')
    expect(result).toEqual({ success: true, bundleName: 'demo', targetDir })
    expect(readFileSync(join(targetDir, 'skills', 's1', 'SKILL.md'), 'utf-8')).toContain('name: s1')

    const plugins = readJson<{ version: number; plugins: Record<string, Array<Record<string, unknown>>> }>(installedPluginsFile())
    expect(plugins.version).toBe(2)
    expect(plugins.plugins['demo@local-skills'][0]).toMatchObject({
      scope: 'user',
      installPath: targetDir,
      version: '1.2.0',
    })
    expect(readJson<{ enabledPlugins: Record<string, boolean> }>(globalSettingsFile()).enabledPlugins)
      .toEqual({ 'demo@local-skills': true })
    expect(readJson<Record<string, Record<string, unknown>>>(knownMarketplacesFile())['local-skills'])
      .toMatchObject({ installLocation: targetDir, source: { source: 'directory', path: targetDir } })
  })

  it('records the project scope with projectPath and writes the project settings file', async () => {
    const bundle = makeInstallableBundle()
    const cwd = join(home, 'project')

    await invoke('skills:install-local-bundle', bundle, 'project', cwd)

    const plugins = readJson<{ plugins: Record<string, Array<Record<string, unknown>>> }>(installedPluginsFile())
    expect(plugins.plugins['demo@local-skills'][0]).toMatchObject({ scope: 'project', projectPath: cwd })
    expect(readJson<{ enabledPlugins: Record<string, boolean> }>(join(cwd, '.claude', 'settings.json')).enabledPlugins)
      .toEqual({ 'demo@local-skills': true })
  })

  it('keeps user edits in an existing versioned dir instead of re-copying on reinstall', async () => {
    const bundle = makeInstallableBundle()
    await invoke('skills:install-local-bundle', bundle, 'global')
    const edited = join(home, '.claude', 'plugins', 'cache', 'local-skills', 'demo', '1.2.0', 'skills', 's1', 'SKILL.md')
    writeFileSync(edited, '# hand edited', 'utf-8')

    await invoke('skills:install-local-bundle', bundle, 'global')

    expect(readFileSync(edited, 'utf-8')).toBe('# hand edited')
  })

  it('removes the legacy un-versioned plugin dir when a versioned install lands', async () => {
    const bundle = makeInstallableBundle()
    const legacy = join(home, '.claude', 'plugins', 'demo')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'stale.txt'), 'x', 'utf-8')

    await invoke('skills:install-local-bundle', bundle, 'global')

    expect(existsSync(legacy)).toBe(false)
  })

  it('rejects a manifest source that escapes the bundle directory before touching any registry', async () => {
    const bundle = join(home, 'src', 'evil')
    mkdirSync(join(bundle, '.claude-plugin'), { recursive: true })
    writeJson(join(bundle, '.claude-plugin', 'plugin.json'), { name: 'evil', version: '1.0.0' })
    writeJson(join(bundle, '.claude-plugin', 'marketplace.json'), {
      name: 'mymarket',
      plugins: [{ name: 'evil', source: '../outside' }],
    })

    await expect(invoke('skills:install-local-bundle', bundle, 'global')).rejects.toThrow(
      'Plugin source escapes bundle directory',
    )
    expect(existsSync(installedPluginsFile())).toBe(false)
    expect(existsSync(globalSettingsFile())).toBe(false)
  })

  it('fails loudly for a missing dir and for a directory that is not a bundle', async () => {
    await expect(invoke('skills:install-local-bundle', join(home, 'nope'), 'global')).rejects.toThrow(
      'Bundle source not found',
    )
    const bare = join(home, 'bare')
    mkdirSync(bare, { recursive: true })
    await expect(invoke('skills:install-local-bundle', bare, 'global')).rejects.toThrow(
      'Not a valid plugin bundle',
    )
  })

  it('uninstalls both scopes and clears settings, registry and marketplace', async () => {
    const bundle = makeInstallableBundle()
    const cwd = join(home, 'project')
    await invoke('skills:install-local-bundle', bundle, 'global')
    await invoke('skills:install-local-bundle', bundle, 'project', cwd)

    const result = await invoke<{ success: boolean; removed: string[] }>('skills:uninstall-local-bundle', 'demo', cwd)

    const targetDir = join(home, '.claude', 'plugins', 'cache', 'local-skills', 'demo', '1.2.0')
    expect(result.removed).toContain(targetDir)
    expect(existsSync(targetDir)).toBe(false)
    expect(readJson<{ plugins: Record<string, unknown> }>(installedPluginsFile()).plugins).toEqual({})
    expect(readJson<{ enabledPlugins: Record<string, boolean> }>(globalSettingsFile()).enabledPlugins).toEqual({})
    expect(readJson<{ enabledPlugins: Record<string, boolean> }>(join(cwd, '.claude', 'settings.json')).enabledPlugins).toEqual({})
    expect(readJson<Record<string, unknown>>(knownMarketplacesFile())).toEqual({})
  })

  it('refuses to uninstall a bundle that is not installed', async () => {
    await expect(invoke('skills:uninstall-local-bundle', 'ghost', undefined)).rejects.toThrow(
      "Bundle 'ghost' is not installed",
    )
  })

  it('leaves an installPath on disk while another plugin still references it', async () => {
    const shared = join(home, 'shared-install')
    writeSkill(shared, 'inside')
    writeJson(installedPluginsFile(), {
      version: 2,
      plugins: {
        'demo@market-a': [{ scope: 'user', installPath: shared, version: '1.0.0' }],
        'keeper@market-b': [{ scope: 'user', installPath: shared, version: '1.0.0' }],
      },
    })
    writeJson(globalSettingsFile(), { enabledPlugins: { 'demo@market-a': true } })

    // uninstall finds nothing removable (path still referenced) -> reports not installed
    await expect(invoke('skills:uninstall-local-bundle', 'demo')).rejects.toThrow(
      "Bundle 'demo' is not installed",
    )
    // but the registry entry itself was already pruned, the files stay
    expect(existsSync(join(shared, 'SKILL.md'))).toBe(true)
    const plugins = readJson<{ plugins: Record<string, unknown> }>(installedPluginsFile())
    expect(Object.keys(plugins.plugins)).toEqual(['keeper@market-b'])
  })
})

describe('custom directory registry', () => {
  const dirsFile = () => join(userData, 'custom-skill-dirs.json')

  it('adds an existing directory, persists it and refuses duplicates', async () => {
    const extra = mkdtempSync(join(tmpdir(), 'sc-extra-dir-'))
    try {
      expect(await invoke<{ directories: string[] }>('skills:get-custom-dirs')).toEqual({ directories: [] })

      expect(await invoke<{ success: boolean }>('skills:add-custom-dir', extra)).toEqual({ success: true })
      expect(readJson<string[]>(dirsFile())).toEqual([extra])

      await expect(invoke('skills:add-custom-dir', extra)).rejects.toThrow(`Directory already exists: ${extra}`)
    } finally {
      rmSync(extra, { recursive: true, force: true })
    }
  })

  it('rejects a directory that does not exist', async () => {
    const missing = join(home, 'not-there')
    await expect(invoke('skills:add-custom-dir', missing)).rejects.toThrow(`Directory does not exist: ${missing}`)
    expect(existsSync(dirsFile())).toBe(false)
  })

  it('removes a directory from the list and reports the survivors', async () => {
    const a = join(home, 'a')
    const b = join(home, 'b')
    mkdirSync(a, { recursive: true })
    mkdirSync(b, { recursive: true })
    await invoke('skills:add-custom-dir', a)
    await invoke('skills:add-custom-dir', b)

    expect(await invoke<{ success: boolean }>('skills:remove-custom-dir', a)).toEqual({ success: true })
    expect(await invoke<{ directories: string[] }>('skills:get-custom-dirs')).toEqual({ directories: [b] })
  })

  it('returns an empty list when the stored file is corrupt JSON', async () => {
    writeFileSync(dirsFile(), '{ not json', 'utf-8')
    expect(await invoke<{ directories: string[] }>('skills:get-custom-dirs')).toEqual({ directories: [] })
  })
})
