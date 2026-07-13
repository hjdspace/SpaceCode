// tests/composables/usePetReaction.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePetStore } from '@/stores/pet'
import { usePetReaction } from '@/composables/usePetReaction'

vi.mock('@/services/electronAPI', () => ({
  api: {
    pet: {
      readConfig: vi.fn().mockResolvedValue(null),
      writeConfig: vi.fn().mockResolvedValue(undefined),
      generateReaction: vi.fn().mockResolvedValue('AI 反应文本'),
      syncPetState: vi.fn(),
    },
    loadGuiSettings: vi.fn().mockResolvedValue({ success: false, data: null }),
  }
}))

describe('usePetReaction', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('generateReaction 返回预设语料当 reactionMode 为 preset', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')

    const reaction = usePetReaction()
    const text = await reaction.generateReaction('idle')
    expect(text).toBeTruthy()
    expect(typeof text).toBe('string')
  })

  it('generateReaction 返回 AI 反应当 reactionMode 为 ai', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')
    await store.updateSettings({ reactionMode: 'ai' })

    const reaction = usePetReaction()
    const text = await reaction.generateReaction('idle')
    expect(text).toBe('AI 反应文本')
  })

  it('generateReaction 返回 null 当 muted', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')
    await store.updateSettings({ muted: true })

    const reaction = usePetReaction()
    const text = await reaction.generateReaction('idle')
    expect(text).toBeNull()
  })

  it('generateReaction 触发后 store.runtimeState.currentReaction 更新', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')

    const reaction = usePetReaction()
    await reaction.generateReaction('idle')
    expect(store.runtimeState.currentReaction).toBeTruthy()
  })
})
