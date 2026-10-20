import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// localSkills store — 过滤 / 搜索 / 目录边界（纯 computed 行为）
// isWithinDirectory 未导出，通过 selectedDirectory + filtered* 间接验证其边界分支

const scanLocalLibraryMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/electronAPI', () => ({
  api: {
    skills: {
      scanLocalLibrary: scanLocalLibraryMock,
    },
  },
}))

import { useLocalSkillsStore, type LocalSkill, type LocalSkillBundle, type LocalSkillPack } from '../localSkills'

const LIB = 'D:/lib/mine'

function makeSkill(overrides: Partial<LocalSkill> = {}): LocalSkill {
  return {
    name: 'skill',
    description: 'desc',
    content: '',
    category: 'other',
    tags: [],
    sourceDir: LIB,
    skillPath: LIB + '/skill',
    isInstalled: false,
    ...overrides,
  }
}

function makeBundle(overrides: Partial<LocalSkillBundle> = {}): LocalSkillBundle {
  return {
    id: 'b1',
    name: 'bundle-a',
    category: 'office',
    bundleDir: LIB + '/bundles/a',
    hasHooks: false,
    hasCommands: false,
    hasAgents: false,
    skillCount: 1,
    isInstalled: false,
    ...overrides,
  }
}

function makePack(overrides: Partial<LocalSkillPack> = {}): LocalSkillPack {
  return {
    id: 'p1',
    name: 'pack-b',
    packDir: LIB + '/packs/b',
    categories: [{ name: 'deep-research', skillCount: 2 }],
    skillCount: 2,
    installedCount: 0,
    ...overrides,
  }
}

const SEED = {
  skills: [
    makeSkill({ name: 'excel-helper', description: 'Office helper', category: 'office', tags: ['Excel', 'VBA'] }),
    makeSkill({ name: 'web-dev', description: 'Frontend tricks', category: 'development' }),
    // bundle / pack 子技能不应出现在 filteredSkills
    makeSkill({ name: 'bundle-child', category: 'office', bundleId: 'b1', bundleName: 'bundle-a' }),
    makeSkill({ name: 'pack-child', category: 'development', packId: 'p1', packName: 'pack-b' }),
    // sourceDir 在别处、但 skillPath 落在选中目录 → 目录过滤按"或"命中
    makeSkill({ name: 'by-skillpath', sourceDir: 'E:/nowhere', skillPath: LIB + '/indirect/x.md' }),
    // Windows 反斜杠路径的目录匹配分支
    makeSkill({ name: 'win-path', sourceDir: 'D:\\lib\\mine\\winpath', skillPath: 'D:\\lib\\mine\\winpath\\x.md' }),
    // 兄弟目录：前缀相近但不应命中（D:/lib/mine-x 不属于 D:/lib/mine）
    makeSkill({ name: 'sibling', sourceDir: 'D:/lib/mine-x', skillPath: 'D:/lib/mine-x/x.md' }),
  ],
  bundles: [
    makeBundle({ id: 'b1', name: 'pdf-tools', category: 'office', keywords: ['PDF', 'export'] }),
    makeBundle({ id: 'b2', name: 'nodesc-bundle', category: 'development', bundleDir: 'E:/other/b2' }),
  ],
  packs: [
    makePack({ id: 'p1', name: 'research-pack' }), // 无 category → 归入 other
    makePack({ id: 'p2', name: 'finance-pack', category: 'finance', packDir: 'E:/elsewhere/p2', categories: [{ name: 'engineering', skillCount: 1 }] }),
  ],
}

describe('localSkills store — 过滤与搜索', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    scanLocalLibraryMock.mockReset()
    scanLocalLibraryMock.mockResolvedValue(SEED)
    await useLocalSkillsStore().fetchLocalSkills()
  })

  it('filteredSkills 排除 bundle/pack 子技能', () => {
    const store = useLocalSkillsStore()
    expect(store.filteredSkills.map(s => s.name)).toEqual([
      'excel-helper',
      'web-dev',
      'by-skillpath',
      'win-path',
      'sibling',
    ])
  })

  it('分类过滤只保留匹配 category 的散装技能', () => {
    const store = useLocalSkillsStore()
    store.selectedCategory = 'office'
    expect(store.filteredSkills.map(s => s.name)).toEqual(['excel-helper'])

    store.selectedCategory = 'development'
    expect(store.filteredSkills.map(s => s.name)).toEqual(['web-dev'])
  })

  it('目录过滤：精确路径、POSIX 子路径、反斜杠子路径均命中', () => {
    const store = useLocalSkillsStore()

    // 精确等于目录本身
    store.selectDirectory(LIB)
    const names = store.filteredSkills.map(s => s.name)
    expect(names).toContain('excel-helper')

    // POSIX 子目录前缀
    expect(names).toContain('web-dev')
    // skillPath 命中也算（sourceDir 在别处）
    expect(names).toContain('by-skillpath')
    // 反斜杠路径用反斜杠目录命中
    store.selectDirectory('D:\\lib\\mine')
    expect(store.filteredSkills.map(s => s.name)).toEqual(['win-path'])
  })

  it('目录过滤：兄弟目录前缀不误命中', () => {
    const store = useLocalSkillsStore()
    store.selectDirectory(LIB)
    expect(store.filteredSkills.map(s => s.name)).not.toContain('sibling')
  })

  it('搜索：对 name / description / tags 不区分大小写', () => {
    const store = useLocalSkillsStore()

    store.setSearchQuery('vba')
    expect(store.filteredSkills.map(s => s.name)).toEqual(['excel-helper'])

    store.setSearchQuery('FRONTEND')
    expect(store.filteredSkills.map(s => s.name)).toEqual(['web-dev'])

    store.setSearchQuery('helper')
    expect(store.filteredSkills.map(s => s.name)).toEqual(['excel-helper'])
  })

  it('搜索：纯空白 query 不过滤任何技能', () => {
    const store = useLocalSkillsStore()
    store.setSearchQuery('   ')
    expect(store.filteredSkills).toHaveLength(5)
  })

  it('搜索与分类叠加过滤', () => {
    const store = useLocalSkillsStore()
    store.selectedCategory = 'office'
    store.setSearchQuery('excel')
    expect(store.filteredSkills.map(s => s.name)).toEqual(['excel-helper'])

    // 'excel' 不匹配 development 下的技能
    store.selectedCategory = 'development'
    expect(store.filteredSkills).toHaveLength(0)
  })

  it('filteredBundles：分类 / 目录 / 关键词搜索（含 description 缺省守卫）', () => {
    const store = useLocalSkillsStore()

    store.selectedCategory = 'development'
    expect(store.filteredBundles.map(b => b.id)).toEqual(['b2'])

    store.selectedCategory = 'all'
    store.setSearchQuery('export')
    expect(store.filteredBundles.map(b => b.id)).toEqual(['b1'])

    // b2 无 description、无 keywords：按名称命中
    store.setSearchQuery('NODESC')
    expect(store.filteredBundles.map(b => b.id)).toEqual(['b2'])

    store.setSearchQuery('')
    store.selectDirectory('E:/other')
    expect(store.filteredBundles.map(b => b.id)).toEqual(['b2'])
  })

  it('filteredPacks：目录过滤与 categories 子项名称搜索', () => {
    const store = useLocalSkillsStore()

    store.selectDirectory('E:/elsewhere')
    expect(store.filteredPacks.map(p => p.id)).toEqual(['p2'])

    store.selectDirectory(null)
    store.setSearchQuery('deep-research')
    expect(store.filteredPacks.map(p => p.id)).toEqual(['p1'])
  })

  it('categoryStats：all = 散装 + bundles + packs，无 category 的 pack 归入 other', () => {
    const store = useLocalSkillsStore()
    const stats = store.categoryStats

    // 散装: office 1, development 1, other 3；bundle: office +1, development +1；pack: other +1, finance +1
    expect(stats['all']).toBe(9)
    expect(stats['office']).toBe(2)
    expect(stats['development']).toBe(2)
    expect(stats['other']).toBe(4)
    expect(stats['finance']).toBe(1)
  })

  it('categoriesWithCount 将计数映射到分类清单', () => {
    const store = useLocalSkillsStore()
    const byId = Object.fromEntries(store.categoriesWithCount.map(c => [c.id, c.count]))

    expect(byId['all']).toBe(9)
    expect(byId['office']).toBe(2)
    expect(byId['finance']).toBe(1)
    expect(byId['creative']).toBe(0)
  })

  it('getBundleSkills / getPackSkills 按 id 取子技能', () => {
    const store = useLocalSkillsStore()
    expect(store.getBundleSkills('b1').map(s => s.name)).toEqual(['bundle-child'])
    expect(store.getPackSkills('p1').map(s => s.name)).toEqual(['pack-child'])
    expect(store.getBundleSkills('nope')).toEqual([])
  })
})
