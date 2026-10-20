import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// localSkills store — 安装/卸载/自定义目录等异步动作与错误路径

const mocks = vi.hoisted(() => ({
  scanLocalLibrary: vi.fn(),
  installLocal: vi.fn(),
  uninstallLocal: vi.fn(),
  installLocalBundle: vi.fn(),
  uninstallLocalBundle: vi.fn(),
  installLocalSkillsBatch: vi.fn(),
  addCustomDir: vi.fn(),
  removeCustomDir: vi.fn(),
  getCustomDirs: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: { skills: mocks },
}))

import { useLocalSkillsStore, type LocalSkill } from '../localSkills'

function makeSkill(overrides: Partial<LocalSkill> = {}): LocalSkill {
  return {
    name: 'alpha',
    description: 'd',
    content: '',
    category: 'other',
    tags: [],
    sourceDir: 'D:/lib',
    skillPath: 'D:/lib/alpha',
    isInstalled: false,
    ...overrides,
  }
}

async function seedStore(skills: LocalSkill[] = [makeSkill()]) {
  const store = useLocalSkillsStore()
  mocks.scanLocalLibrary.mockResolvedValue({ skills, bundles: [], packs: [] })
  await store.fetchLocalSkills()
  return store
}

describe('localSkills store — installSkill / uninstallSkill', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.scanLocalLibrary.mockResolvedValue({ skills: [], bundles: [], packs: [] })
  })

  it('安装成功：更新安装状态并在 finally 复位 installingId', async () => {
    const store = await seedStore()
    mocks.installLocal.mockResolvedValue(undefined)

    await expect(store.installSkill('alpha', 'project', 'D:/proj')).resolves.toBe(true)

    expect(mocks.installLocal).toHaveBeenCalledWith('alpha', 'project', 'D:/proj', 'D:/lib/alpha')
    const skill = store.skills[0]
    expect(skill.isInstalled).toBe(true)
    expect(skill.installedScope).toBe('project')
    expect(skill.installedAt).toBeInstanceOf(Date)
    expect(store.installingId).toBeNull()
  })

  it('安装不在列表中的技能：skillPath 传 undefined 仍调用 api', async () => {
    const store = await seedStore()
    mocks.installLocal.mockResolvedValue(undefined)

    await store.installSkill('ghost', 'global')

    expect(mocks.installLocal).toHaveBeenCalledWith('ghost', 'global', undefined, undefined)
    expect(store.installingId).toBeNull()
  })

  it('安装失败：抛出且 installingId 复位', async () => {
    const store = await seedStore()
    mocks.installLocal.mockRejectedValue(new Error('install boom'))

    await expect(store.installSkill('alpha', 'global')).rejects.toThrow('install boom')
    expect(store.installingId).toBeNull()
    expect(store.skills[0].isInstalled).toBe(false)
  })

  it('卸载成功：清理安装状态', async () => {
    const store = await seedStore([makeSkill({ isInstalled: true, installedScope: 'global', installedAt: new Date() })])
    mocks.uninstallLocal.mockResolvedValue(undefined)

    await expect(store.uninstallSkill('alpha', 'D:/proj')).resolves.toBe(true)

    expect(mocks.uninstallLocal).toHaveBeenCalledWith('alpha', 'D:/proj')
    const skill = store.skills[0]
    expect(skill.isInstalled).toBe(false)
    expect(skill.installedScope).toBeUndefined()
    expect(skill.installedAt).toBeUndefined()
  })

  it('卸载失败：抛出', async () => {
    const store = await seedStore()
    mocks.uninstallLocal.mockRejectedValue(new Error('uninstall boom'))

    await expect(store.uninstallSkill('alpha')).rejects.toThrow('uninstall boom')
  })
})

describe('localSkills store — bundle / pack 动作', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.scanLocalLibrary.mockResolvedValue({ skills: [], bundles: [], packs: [] })
  })

  it('installBundle：调用 api 并触发重新拉取', async () => {
    const store = await seedStore()
    const callsBefore = mocks.scanLocalLibrary.mock.calls.length
    mocks.installLocalBundle.mockResolvedValue(undefined)

    await expect(store.installBundle('b1', 'project', 'D:/proj')).resolves.toBe(true)

    expect(mocks.installLocalBundle).toHaveBeenCalledWith('b1', 'project', 'D:/proj')
    expect(mocks.scanLocalLibrary.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(store.installingId).toBeNull()
  })

  it('installBundle 失败：抛出且 installingId 复位', async () => {
    const store = await seedStore()
    mocks.installLocalBundle.mockRejectedValue(new Error('bundle boom'))

    await expect(store.installBundle('b1', 'global')).rejects.toThrow('bundle boom')
    expect(store.installingId).toBeNull()
  })

  it('uninstallBundle：调用 api 并触发重新拉取', async () => {
    const store = await seedStore()
    const callsBefore = mocks.scanLocalLibrary.mock.calls.length
    mocks.uninstallLocalBundle.mockResolvedValue(undefined)

    await expect(store.uninstallBundle('bundle-name', 'D:/proj')).resolves.toBe(true)

    expect(mocks.uninstallLocalBundle).toHaveBeenCalledWith('bundle-name', 'D:/proj')
    expect(mocks.scanLocalLibrary.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('installPackSkills：批量安装结果透传并触发重新拉取', async () => {
    const store = await seedStore()
    const items = [{ name: 's1', skillPath: 'p1' }, { name: 's2' }]
    const results = [{ name: 's1', success: true }, { name: 's2', success: false, error: 'busy' }]
    mocks.installLocalSkillsBatch.mockResolvedValue({ results })

    const out = await store.installPackSkills(items, 'project', 'D:/proj')

    expect(mocks.installLocalSkillsBatch).toHaveBeenCalledWith(items, 'project', 'D:/proj')
    expect(out).toEqual(results)
  })

  it('installPackSkills：results 缺省时回退空数组', async () => {
    const store = await seedStore()
    mocks.installLocalSkillsBatch.mockResolvedValue({})

    await expect(store.installPackSkills([{ name: 's1' }], 'global')).resolves.toEqual([])
  })

  it('installPackSkills 失败：抛出', async () => {
    const store = await seedStore()
    mocks.installLocalSkillsBatch.mockRejectedValue(new Error('batch boom'))

    await expect(store.installPackSkills([{ name: 's1' }], 'global')).rejects.toThrow('batch boom')
  })
})

describe('localSkills store — 自定义目录', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.scanLocalLibrary.mockResolvedValue({ skills: [], bundles: [], packs: [] })
  })

  it('addCustomDirectory：去重添加并触发重新拉取', async () => {
    const store = await seedStore()
    const callsBefore = mocks.scanLocalLibrary.mock.calls.length
    mocks.addCustomDir.mockResolvedValue(undefined)

    await expect(store.addCustomDirectory('D:/extra')).resolves.toBe(true)

    expect(mocks.addCustomDir).toHaveBeenCalledWith('D:/extra')
    expect(store.customDirectories).toEqual(['D:/extra'])
    expect(mocks.scanLocalLibrary.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('addCustomDirectory：重复路径不重复追加但 api 仍被调用', async () => {
    const store = await seedStore()
    mocks.getCustomDirs.mockResolvedValue({ directories: ['D:/exists'] })
    await store.loadCustomDirectories()
    mocks.addCustomDir.mockResolvedValue(undefined)

    await store.addCustomDirectory('D:/exists')

    expect(mocks.addCustomDir).toHaveBeenCalledWith('D:/exists')
    expect(store.customDirectories).toEqual(['D:/exists'])
  })

  it('addCustomDirectory 失败：抛出', async () => {
    const store = await seedStore()
    mocks.addCustomDir.mockRejectedValue(new Error('mkdir boom'))

    await expect(store.addCustomDirectory('D:/bad')).rejects.toThrow('mkdir boom')
    expect(store.customDirectories).toEqual([])
  })

  it('removeCustomDirectory：移除；若是当前选中目录则重置选中', async () => {
    const store = await seedStore()
    mocks.getCustomDirs.mockResolvedValue({ directories: ['D:/a', 'D:/b'] })
    await store.loadCustomDirectories()
    store.selectDirectory('D:/b')
    mocks.removeCustomDir.mockResolvedValue(undefined)

    await expect(store.removeCustomDirectory('D:/b')).resolves.toBe(true)

    expect(store.customDirectories).toEqual(['D:/a'])
    expect(store.selectedDirectory).toBeNull()
  })

  it('removeCustomDirectory：移除非选中目录不影响选中', async () => {
    const store = await seedStore()
    mocks.getCustomDirs.mockResolvedValue({ directories: ['D:/a', 'D:/b'] })
    await store.loadCustomDirectories()
    store.selectDirectory('D:/a')
    mocks.removeCustomDir.mockResolvedValue(undefined)

    await store.removeCustomDirectory('D:/b')

    expect(store.selectedDirectory).toBe('D:/a')
  })

  it('removeCustomDirectory 失败：抛出', async () => {
    const store = await seedStore()
    mocks.removeCustomDir.mockRejectedValue(new Error('rm boom'))

    await expect(store.removeCustomDirectory('D:/a')).rejects.toThrow('rm boom')
  })

  it('loadCustomDirectories：directories 缺省回退空数组', async () => {
    const store = await seedStore()
    mocks.getCustomDirs.mockResolvedValue({})

    await store.loadCustomDirectories()

    expect(store.customDirectories).toEqual([])
  })

  it('loadCustomDirectories 失败：吞掉错误不抛出', async () => {
    const store = await seedStore()
    mocks.getCustomDirs.mockRejectedValue(new Error('load boom'))

    await expect(store.loadCustomDirectories()).resolves.toBeUndefined()
    expect(store.error).toBeNull()
  })
})

describe('localSkills store — fetchLocalSkills 错误文案', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('Error 实例时取 message', async () => {
    mocks.scanLocalLibrary.mockRejectedValue(new Error('disk gone'))
    const store = useLocalSkillsStore()
    await store.fetchLocalSkills()
    expect(store.error).toBe('disk gone')
    expect(store.loading).toBe(false)
  })

  it('非 Error 抛出物时取回退文案', async () => {
    mocks.scanLocalLibrary.mockRejectedValue('plain')
    const store = useLocalSkillsStore()
    await store.fetchLocalSkills()
    expect(store.error).toBe('Failed to fetch local skills')
    expect(store.loading).toBe(false)
  })
})
