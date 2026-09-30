// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: electronMock.getPath, getAppPath: vi.fn(() => rootDir), isPackaged: true },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, handler)
    }),
  },
  net: {},
}))

import { registerLocalLibraryIPCHandlers } from '../skills/skillsService'

interface PackSkill {
  name: string
  description: string
  packId?: string
  packName?: string
  packCategory?: string
}

interface ScanResult {
  skills: PackSkill[]
  bundles: unknown[]
  packs: Array<{
    id: string
    name: string
    packDir: string
    category?: string
    categories: Array<{ name: string; skillCount: number }>
    skillCount: number
    installedCount: number
  }>
}

let rootDir: string
let libRoot: string

function writeSkill(skillDir: string, name: string): void {
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n---\n`,
    'utf-8',
  )
}

/** berkshire 形态：SKILL.md 带 UTF-8 BOM，description 为带冒号的双引号值 */
function writeBomSkill(skillDir: string, name: string): void {
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `\uFEFF---\nname: ${name}\ndescription: "AI Berkshire skill: ${name} 系列：8 篇长文拆一家公司."\n---\n\n# 正文\n`,
    'utf-8',
  )
}

async function scan(dirPaths: string[]): Promise<ScanResult> {
  const handler = electronMock.handlers.get('skills:scan-local-library')
  if (!handler) throw new Error('skills:scan-local-library handler was not registered')
  return handler({}, dirPaths) as Promise<ScanResult>
}

describe('skills:scan-local-library — skill packs', () => {
  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'spacecode-skill-packs-'))
    // 伪装打包环境，让 getSkillsLibRoot() 指向 <rootDir>/resources/skills-lib
    ;(process as unknown as { resourcesPath: string }).resourcesPath = join(rootDir, 'resources')
    electronMock.getPath.mockReturnValue(join(rootDir, 'home'))
    electronMock.handlers.clear()
    registerLocalLibraryIPCHandlers()

    libRoot = join(rootDir, 'resources', 'skills-lib')

    // skills-grouped：<pack>/skills/<category>/<skill>
    writeSkill(join(libRoot, 'matt-skills', 'skills', 'engineering', 'alpha'), 'alpha')
    writeSkill(join(libRoot, 'matt-skills', 'skills', 'engineering', 'beta'), 'beta')
    writeSkill(join(libRoot, 'matt-skills', 'skills', 'misc', 'gamma'), 'gamma')

    // grouped + BOM：berkshire 形态（包级分类覆盖 + BOM frontmatter）
    writeBomSkill(join(libRoot, 'berkshire', 'deep-research', 'berkshire-series'), 'berkshire-series')
    writeBomSkill(join(libRoot, 'berkshire', 'earnings', 'berkshire-earnings'), 'berkshire-earnings')

    // grouped：<pack>/<category>/<skill>
    writeSkill(join(libRoot, 'grouped-pack', 'cat-one', 'delta'), 'delta')

    // flat：<pack>/<skill>（仅内置技能库识别）
    writeSkill(join(libRoot, 'flat-pack', 'echo'), 'echo')
    writeSkill(join(libRoot, 'flat-pack', 'foxtrot'), 'foxtrot')

    // 内置库顶层散装技能（自身含 SKILL.md）——不得判为包
    writeSkill(join(libRoot, 'plain-skill'), 'plain-skill')

    // 自定义目录：嵌套一层技能保持平铺现状
    writeSkill(join(rootDir, 'custom-dir', 'nested-golf'), 'nested-golf')
    // 自定义目录：两层嵌套识别为 grouped 包（原先扫描不到，纯增益）
    writeSkill(join(rootDir, 'custom-dir2', 'deep-pack', 'cat-two', 'india'), 'india')
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('detects all three pack layouts and keeps loose skills ungrouped', async () => {
    const result = await scan([
      'resources/skills-lib',
      join(rootDir, 'custom-dir'),
      join(rootDir, 'custom-dir2'),
    ])

    const packNames = result.packs.map((pack) => pack.name)
    expect(packNames).toContain('matt-skills')
    expect(packNames).toContain('berkshire')
    expect(packNames).toContain('grouped-pack')
    expect(packNames).toContain('flat-pack')
    expect(packNames).toContain('deep-pack')
    expect(packNames).not.toContain('plain-skill')
    expect(packNames).not.toContain('nested-golf')

    const mattLike = result.packs.find((pack) => pack.name === 'matt-skills')
    expect(mattLike?.categories).toEqual([
      { name: 'engineering', skillCount: 2 },
      { name: 'misc', skillCount: 1 },
    ])
    expect(mattLike?.skillCount).toBe(3)
    // 包级分类覆盖：matt-skills 是开发流程相关分类
    expect(mattLike?.category).toBe('development')

    const berkshire = result.packs.find((pack) => pack.name === 'berkshire')
    expect(berkshire?.categories).toEqual([
      { name: 'deep-research', skillCount: 1 },
      { name: 'earnings', skillCount: 1 },
    ])
    // 包级分类覆盖：berkshire 是金融相关分类
    expect(berkshire?.category).toBe('finance')

    // BOM 不应导致 front matter 解析失败 —— description 绝不能是 '---'
    const series = result.skills.find((skill) => skill.name === 'berkshire-series')
    expect(series?.description).toBe('AI Berkshire skill: berkshire-series 系列：8 篇长文拆一家公司.')
    expect(series?.description).not.toBe('---')

    const grouped = result.packs.find((pack) => pack.name === 'grouped-pack')
    expect(grouped?.categories).toEqual([{ name: 'cat-one', skillCount: 1 }])

    const flat = result.packs.find((pack) => pack.name === 'flat-pack')
    expect(flat?.categories).toEqual([])
    expect(flat?.skillCount).toBe(2)

    // 包内技能带 pack 信息；散装技能不带
    const alpha = result.skills.find((skill) => skill.name === 'alpha')
    expect(alpha?.packName).toBe('matt-skills')
    expect(alpha?.packCategory).toBe('engineering')
    const echo = result.skills.find((skill) => skill.name === 'echo')
    expect(echo?.packName).toBe('flat-pack')
    expect(echo?.packCategory).toBeUndefined()
    const plain = result.skills.find((skill) => skill.name === 'plain-skill')
    expect(plain?.packId).toBeUndefined()
    const golf = result.skills.find((skill) => skill.name === 'nested-golf')
    expect(golf?.packId).toBeUndefined()
    const india = result.skills.find((skill) => skill.name === 'india')
    expect(india?.packName).toBe('deep-pack')
    expect(india?.packCategory).toBe('cat-two')
  })

  it('installs a pack-nested skill by name without skillPath', async () => {
    const handler = electronMock.handlers.get('skills:install-local')
    if (!handler) throw new Error('skills:install-local handler was not registered')

    const cwd = join(rootDir, 'project')
    // 只传技能名（Work 助手启动时的调用方式），无 skillPath，需在包内递归命中
    const result = (await handler({}, 'delta', 'project', cwd)) as { success: boolean }
    expect(result.success).toBe(true)
    // 安装目标是 getProjectSkillsDirs(cwd)[0]（既有行为：.claude/commands）
    expect(existsSync(join(cwd, '.claude', 'commands', 'delta', 'SKILL.md'))).toBe(true)
  })
})
