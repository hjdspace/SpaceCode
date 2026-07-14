// tests/lib/defaultReactions.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_PRESET_REACTIONS } from '@/lib/defaultReactions'

describe('defaultReactions', () => {
  it('包含所有 5 种触发场景', () => {
    expect(DEFAULT_PRESET_REACTIONS.idle).toBeDefined()
    expect(DEFAULT_PRESET_REACTIONS.typing).toBeDefined()
    expect(DEFAULT_PRESET_REACTIONS.error).toBeDefined()
    expect(DEFAULT_PRESET_REACTIONS.success).toBeDefined()
    expect(DEFAULT_PRESET_REACTIONS.petted).toBeDefined()
  })

  it('每种场景至少有 2 条语料', () => {
    expect(DEFAULT_PRESET_REACTIONS.idle.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_PRESET_REACTIONS.typing.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_PRESET_REACTIONS.error.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_PRESET_REACTIONS.success.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_PRESET_REACTIONS.petted.length).toBeGreaterThanOrEqual(2)
  })

  it('所有语料为非空字符串', () => {
    Object.values(DEFAULT_PRESET_REACTIONS).forEach(reactions => {
      reactions.forEach(text => {
        expect(typeof text).toBe('string')
        expect(text.length).toBeGreaterThan(0)
      })
    })
  })
})
