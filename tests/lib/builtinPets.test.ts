// tests/lib/builtinPets.test.ts
import { describe, it, expect } from 'vitest'
import { BUILTIN_PETS } from '@/lib/builtinPets'

describe('builtinPets', () => {
  it('包含 18 种宠物', () => {
    expect(BUILTIN_PETS).toHaveLength(18)
  })

  it('所有 id 以 builtin- 开头且唯一', () => {
    const ids = BUILTIN_PETS.map(p => p.id)
    ids.forEach(id => expect(id.startsWith('builtin-')).toBe(true))
    expect(new Set(ids).size).toBe(18)
  })

  it('所有宠物都有名称和性格描述', () => {
    BUILTIN_PETS.forEach(pet => {
      expect(pet.name.length).toBeGreaterThan(0)
      expect(pet.personality.length).toBeGreaterThan(0)
    })
  })

  it('所有内置宠物使用 builtin-svg 视觉类型', () => {
    BUILTIN_PETS.forEach(pet => {
      expect(pet.visual.type).toBe('builtin-svg')
    })
  })

  it('所有宠物都有调色板', () => {
    BUILTIN_PETS.forEach(pet => {
      expect(pet.palette).toBeDefined()
      expect(pet.palette!.primary).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(pet.palette!.accent).toMatch(/^#[0-9a-fA-F]{6}$/)
    })
  })

  it('所有宠物都有预设反应语料', () => {
    BUILTIN_PETS.forEach(pet => {
      expect(pet.presetReactions.idle.length).toBeGreaterThanOrEqual(2)
      expect(pet.presetReactions.typing.length).toBeGreaterThanOrEqual(1)
      expect(pet.presetReactions.error.length).toBeGreaterThanOrEqual(1)
      expect(pet.presetReactions.success.length).toBeGreaterThanOrEqual(1)
      expect(pet.presetReactions.petted.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('包含所有 18 种 species', () => {
    const species = BUILTIN_PETS.map(p => (p.visual as { type: 'builtin-svg'; species: string }).species)
    const expected = ['duck', 'goose', 'blob', 'cat', 'dragon', 'octopus',
      'owl', 'penguin', 'turtle', 'snail', 'ghost', 'axolotl',
      'capybara', 'cactus', 'robot', 'rabbit', 'mushroom', 'chonk']
    expected.forEach(s => expect(species).toContain(s))
  })
})
