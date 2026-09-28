import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const scanLocalLibraryMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/electronAPI', () => ({
  api: {
    skills: {
      scanLocalLibrary: scanLocalLibraryMock,
    },
  },
}))

import { useLocalSkillsStore } from '../localSkills'

describe('localSkills store — 技能包分类过滤', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    scanLocalLibraryMock.mockResolvedValue({
      skills: [],
      bundles: [],
      packs: [
        {
          id: 'p-berkshire',
          name: 'berkshire',
          category: 'finance',
          packDir: 'D:/lib/berkshire',
          categories: [{ name: 'deep-research', skillCount: 2 }],
          skillCount: 2,
          installedCount: 0,
        },
        {
          id: 'p-matt',
          name: 'matt-skills',
          category: 'development',
          packDir: 'D:/lib/matt-skills',
          categories: [{ name: 'engineering', skillCount: 3 }],
          skillCount: 3,
          installedCount: 0,
        },
      ],
    })
    await useLocalSkillsStore().fetchLocalSkills()
  })

  it('all 分类下显示全部技能包', () => {
    const store = useLocalSkillsStore()
    store.selectedCategory = 'all'
    expect(store.filteredPacks.map(p => p.name)).toEqual(['berkshire', 'matt-skills'])
  })

  it('选择分类时只显示匹配的技能包', () => {
    const store = useLocalSkillsStore()

    store.selectedCategory = 'finance'
    expect(store.filteredPacks.map(p => p.name)).toEqual(['berkshire'])

    store.selectedCategory = 'development'
    expect(store.filteredPacks.map(p => p.name)).toEqual(['matt-skills'])

    store.selectedCategory = 'office'
    expect(store.filteredPacks).toHaveLength(0)
  })

  it('侧边栏分类计数包含技能包', () => {
    const store = useLocalSkillsStore()
    const stats = store.categoryStats

    expect(stats['finance']).toBe(1)
    expect(stats['development']).toBe(1)
    // 无散装技能与 bundle 时，all = 包数量
    expect(stats['all']).toBe(2)
  })
})
