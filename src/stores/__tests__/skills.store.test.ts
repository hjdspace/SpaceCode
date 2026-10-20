import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// skills store — CRUD / marketplace / 错误路径
// mock @/services/electronAPI 的 api.skills.*（与 localSkills.categoryFilter.test.ts 同一缝）

const skillsApiMocks = vi.hoisted(() => ({
  getSkills: vi.fn(),
  getBundledSkills: vi.fn(),
  createSkill: vi.fn(),
  saveSkill: vi.fn(),
  deleteSkill: vi.fn(),
  searchMarketplace: vi.fn(),
  installMarketplaceSkill: vi.fn(),
  uninstallMarketplaceSkill: vi.fn(),
  fetchMarketplaceReadme: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: { skills: skillsApiMocks },
}))

import { useSkillsStore, type Skill } from '../skills'

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'skill-a',
    description: 'desc',
    content: 'body',
    source: 'global',
    filePath: '/home/u/.claude/commands/skill-a.md',
    ...overrides,
  }
}

function readStoredSkills(): Skill[] {
  const raw = localStorage.getItem('claude_desktop_skills')
  return raw ? (JSON.parse(raw) as Skill[]) : []
}

describe('skills store — fetchSkills', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    skillsApiMocks.getSkills.mockResolvedValue({ skills: [] })
    skillsApiMocks.getBundledSkills.mockResolvedValue({ skills: [] })
  })

  it('合并用户技能与内置技能，user 在前 bundled 在后', async () => {
    const user = makeSkill({ name: 'user-skill' })
    const bundled = makeSkill({ name: 'bundled-skill', source: 'builtin', filePath: '/res/skills/bundled.md' })
    skillsApiMocks.getSkills.mockResolvedValue({ skills: [user] })
    skillsApiMocks.getBundledSkills.mockResolvedValue({ skills: [bundled] })

    const store = useSkillsStore()
    await store.fetchSkills('D:/proj')

    expect(skillsApiMocks.getSkills).toHaveBeenCalledWith('D:/proj')
    expect(store.skills.map(s => s.name)).toEqual(['user-skill', 'bundled-skill'])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('接口返回缺少 skills 字段时回退为空数组', async () => {
    skillsApiMocks.getSkills.mockResolvedValue({})
    skillsApiMocks.getBundledSkills.mockResolvedValue({})

    const store = useSkillsStore()
    await store.fetchSkills()

    expect(store.skills).toEqual([])
    expect(store.error).toBeNull()
  })

  it('请求期间 loading 为 true，结束后复位', async () => {
    const store = useSkillsStore()
    let loadingDuringFetch: boolean | undefined
    skillsApiMocks.getSkills.mockImplementation(async () => {
      loadingDuringFetch = store.loading
      return { skills: [] }
    })

    await store.fetchSkills()

    expect(loadingDuringFetch).toBe(true)
    expect(store.loading).toBe(false)
  })

  it('Error 实例时 error 取 message', async () => {
    skillsApiMocks.getSkills.mockRejectedValue(new Error('boom'))

    const store = useSkillsStore()
    await store.fetchSkills()

    expect(store.error).toBe('boom')
    expect(store.loading).toBe(false)
  })

  it('非 Error 抛出物时 error 取回退文案', async () => {
    skillsApiMocks.getSkills.mockRejectedValue('plain-string')

    const store = useSkillsStore()
    await store.fetchSkills()

    expect(store.error).toBe('Failed to fetch skills')
    expect(store.loading).toBe(false)
  })
})

describe('skills store — createSkill', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('成功路径：返回的 skill 追加进列表并同步 localStorage', async () => {
    const returned = makeSkill({ name: 'created' })
    skillsApiMocks.createSkill.mockResolvedValue({ skill: returned })

    const store = useSkillsStore()
    const result = await store.createSkill('created', 'global', 'body', 'D:/proj')

    expect(skillsApiMocks.createSkill).toHaveBeenCalledWith('created', 'global', 'body', 'D:/proj')
    expect(result).toBe(returned)
    expect(store.skills).toEqual([returned])
    expect(readStoredSkills().map(s => s.name)).toEqual(['created'])
  })

  it('fallback：无 data.skill 时 global 作用域内存构造，描述取首行并剥离 # 前缀', async () => {
    skillsApiMocks.createSkill.mockResolvedValue(null)

    const store = useSkillsStore()
    const result = await store.createSkill('mycmd', 'global', '# Title\nrest')

    expect(result.source).toBe('global')
    expect(result.filePath).toBe('~/.claude/commands/mycmd.md')
    expect(result.description).toBe('Title')
    expect(result.content).toBe('# Title\nrest')
    expect(store.skills[0]).toStrictEqual(result)
  })

  it('fallback：project 作用域 filePath 基于 cwd 派生', async () => {
    skillsApiMocks.createSkill.mockResolvedValue(null)

    const store = useSkillsStore()
    const result = await store.createSkill('pcmd', 'project', 'body', 'D:/proj')

    expect(result.source).toBe('project')
    expect(result.filePath).toBe('D:/proj/.claude/commands/pcmd.md')
  })

  it('fallback：空 content 时描述回退为 Skill: /name', async () => {
    skillsApiMocks.createSkill.mockResolvedValue(null)

    const store = useSkillsStore()
    const result = await store.createSkill('empty', 'global', '')

    expect(result.description).toBe('Skill: /empty')
  })

  it('api 抛错时向上传播且不写 localStorage', async () => {
    skillsApiMocks.createSkill.mockRejectedValue(new Error('disk full'))

    const store = useSkillsStore()
    await expect(store.createSkill('x', 'global', 'body')).rejects.toThrow('disk full')
    expect(store.skills).toEqual([])
    expect(localStorage.getItem('claude_desktop_skills')).toBeNull()
  })
})

describe('skills store — saveSkill', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('builtin 技能直接拒绝且不触碰 api', async () => {
    const store = useSkillsStore()
    const builtin = makeSkill({ name: 'b', source: 'builtin', filePath: '/res/skills/b.md' })

    await expect(store.saveSkill(builtin, 'new')).rejects.toThrow('Built-in skills cannot be modified')
    expect(skillsApiMocks.saveSkill).not.toHaveBeenCalled()
  })

  it('成功路径：按 name+source+installedSource 匹配替换', async () => {
    const store = useSkillsStore()
    const original = makeSkill({ name: 'a', source: 'global' })
    store.skills.push(original)

    const updated = makeSkill({ name: 'a', source: 'global', content: 'new-body' })
    skillsApiMocks.saveSkill.mockResolvedValue({ skill: updated })

    const result = await store.saveSkill(original, 'new-body')

    expect(skillsApiMocks.saveSkill).toHaveBeenCalledWith(original, 'new-body')
    expect(result).toBe(updated)
    expect(store.skills[0]).toStrictEqual(updated)
    expect(readStoredSkills()[0].content).toBe('new-body')
  })

  it('成功路径但列表无匹配索引时不更新列表', async () => {
    const store = useSkillsStore()
    store.skills.push(makeSkill({ name: 'a' }))

    // 传入的 skill（name+source+installedSource）在列表中无匹配 → 不替换
    const updated = makeSkill({ name: 'zzz-not-present', source: 'global' })
    skillsApiMocks.saveSkill.mockResolvedValue({ skill: updated })

    const result = await store.saveSkill(makeSkill({ name: 'ghost' }), 'new-body')

    expect(store.skills[0].name).toBe('a')
    expect(result).toBe(updated)
  })

  it('fallback：无 data.skill 时仅内存更新匹配项', async () => {
    const store = useSkillsStore()
    const original = makeSkill({ name: 'a', source: 'global' })
    store.skills.push(original)
    skillsApiMocks.saveSkill.mockResolvedValue(null)

    const result = await store.saveSkill(original, 'patched')

    expect(store.skills[0].content).toBe('patched')
    expect(result).toBe(original)
   })

  it('api 抛错时向上传播', async () => {
    const store = useSkillsStore()
    skillsApiMocks.saveSkill.mockRejectedValue(new Error('io err'))

    await expect(store.saveSkill(makeSkill(), 'x')).rejects.toThrow('io err')
  })
})

describe('skills store — deleteSkill', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('builtin 技能直接拒绝且不触碰 api', async () => {
    const store = useSkillsStore()
    const builtin = makeSkill({ source: 'builtin', filePath: '/res/skills/b.md' })

    await expect(store.deleteSkill(builtin)).rejects.toThrow('Built-in skills cannot be deleted')
    expect(skillsApiMocks.deleteSkill).not.toHaveBeenCalled()
  })

  it('成功路径：按三元组过滤移除并同步 localStorage', async () => {
    const store = useSkillsStore()
    const keep = makeSkill({ name: 'keep' })
    const drop = makeSkill({ name: 'drop', filePath: '/d/drop.md' })
    store.skills.push(keep, drop)
    skillsApiMocks.deleteSkill.mockResolvedValue(undefined)

    await store.deleteSkill(drop)

    expect(skillsApiMocks.deleteSkill).toHaveBeenCalledWith('/d/drop.md')
    expect(store.skills.map(s => s.name)).toEqual(['keep'])
    expect(readStoredSkills().map(s => s.name)).toEqual(['keep'])
  })

  it('api 抛错时向上传播', async () => {
    const store = useSkillsStore()
    skillsApiMocks.deleteSkill.mockRejectedValue(new Error('nope'))

    await expect(store.deleteSkill(makeSkill())).rejects.toThrow('nope')
  })
})

describe('skills store — marketplace', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('searchMarketplace 成功填充结果并复位 loading', async () => {
    const ms = { id: 'm1', skillId: 'm1', name: 'market-skill', installs: 3, source: 'github' }
    skillsApiMocks.searchMarketplace.mockResolvedValue({ skills: [ms] })

    const store = useSkillsStore()
    await store.searchMarketplace('market')

    expect(skillsApiMocks.searchMarketplace).toHaveBeenCalledWith('market')
    expect(store.marketplaceSkills).toEqual([ms])
    expect(store.marketplaceLoading).toBe(false)
  })

  it('searchMarketplace 失败时清空结果且不设置 error', async () => {
    skillsApiMocks.searchMarketplace.mockRejectedValue(new Error('net down'))

    const store = useSkillsStore()
    store.marketplaceSkills.push({ id: 'old', skillId: 'old', name: 'old', installs: 0, source: 'x' })

    await store.searchMarketplace('q')

    expect(store.marketplaceSkills).toEqual([])
    expect(store.marketplaceLoading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('searchMarketplace 缺少 skills 字段时回退空数组', async () => {
    skillsApiMocks.searchMarketplace.mockResolvedValue({})

    const store = useSkillsStore()
    await store.searchMarketplace('q')

    expect(store.marketplaceSkills).toEqual([])
  })

  it('installMarketplaceSkill 透传结果', async () => {
    const result = { success: true, logs: ['ok'], installPath: '/p' }
    skillsApiMocks.installMarketplaceSkill.mockResolvedValue(result)

    const store = useSkillsStore()
    const out = await store.installMarketplaceSkill('github', 'sid', false, 'D:/proj')

    expect(skillsApiMocks.installMarketplaceSkill).toHaveBeenCalledWith('github', 'sid', false, 'D:/proj')
    expect(out).toBe(result)
  })

  it('installMarketplaceSkill 失败时抛出', async () => {
    skillsApiMocks.installMarketplaceSkill.mockRejectedValue(new Error('install fail'))

    const store = useSkillsStore()
    await expect(store.installMarketplaceSkill('src', 'id', true)).rejects.toThrow('install fail')
  })

  it('uninstallMarketplaceSkill 成功返回 true，失败抛出', async () => {
    const store = useSkillsStore()
    skillsApiMocks.uninstallMarketplaceSkill.mockResolvedValue(undefined)
    await expect(store.uninstallMarketplaceSkill('sn', false, 'D:/proj')).resolves.toBe(true)
    expect(skillsApiMocks.uninstallMarketplaceSkill).toHaveBeenCalledWith('sn', false, 'D:/proj')

    skillsApiMocks.uninstallMarketplaceSkill.mockRejectedValue(new Error('uninstall fail'))
    await expect(store.uninstallMarketplaceSkill('sn', true)).rejects.toThrow('uninstall fail')
  })

  it('fetchMarketplaceReadme 成功返回内容，失败返回 null', async () => {
    const store = useSkillsStore()
    skillsApiMocks.fetchMarketplaceReadme.mockResolvedValue('# readme')
    await expect(store.fetchMarketplaceReadme('src', 'id')).resolves.toBe('# readme')

    skillsApiMocks.fetchMarketplaceReadme.mockRejectedValue(new Error('404'))
    await expect(store.fetchMarketplaceReadme('src', 'id')).resolves.toBeNull()
  })
})

describe('skills store — source 分类 computed', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('按 source 过滤五类列表', () => {
    const store = useSkillsStore()
    store.skills.push(
      makeSkill({ name: 'g', source: 'global' }),
      makeSkill({ name: 'i', source: 'installed', installedSource: 'agents' }),
      makeSkill({ name: 'p', source: 'plugin' }),
      makeSkill({ name: 'pr', source: 'project' }),
      makeSkill({ name: 'b', source: 'builtin' })
    )

    expect(store.globalSkills.map(s => s.name)).toEqual(['g'])
    expect(store.installedSkills.map(s => s.name)).toEqual(['i'])
    expect(store.pluginSkills.map(s => s.name)).toEqual(['p'])
    expect(store.projectSkills.map(s => s.name)).toEqual(['pr'])
    expect(store.builtinSkills.map(s => s.name)).toEqual(['b'])
  })
})
