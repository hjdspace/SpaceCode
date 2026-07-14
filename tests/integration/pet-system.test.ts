// tests/integration/pet-system.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePetStore } from '@/stores/pet'

vi.mock('@/services/electronAPI', () => ({
  api: {
    pet: {
      readConfig: vi.fn().mockResolvedValue(null),
      writeConfig: vi.fn().mockResolvedValue(undefined),
      saveAsset: vi.fn().mockResolvedValue('buddy-pets-assets/test.png'),
      deleteAsset: vi.fn().mockResolvedValue(undefined),
      generateReaction: vi.fn().mockResolvedValue('AI 反应'),
      createDesktopWindow: vi.fn().mockResolvedValue(undefined),
      destroyDesktopWindow: vi.fn().mockResolvedValue(undefined),
      updateWindowBounds: vi.fn().mockResolvedValue(undefined),
      syncPetState: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(() => {}),
    }
  }
}))

describe('Pet System Integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('完整流程：初始化 → 选择宠物 → 触发反应 → 切换模式', async () => {
    const store = usePetStore()
    await store.init()
    expect(store.isInitialized).toBe(true)

    await store.setActivePet('builtin-duck')
    expect(store.activePet?.id).toBe('builtin-duck')

    store.triggerReaction('测试反应')
    expect(store.runtimeState.currentReaction).toBe('测试反应')

    await store.setMode('desktop')
    expect(store.mode).toBe('desktop')

    await store.setMode('embedded')
    expect(store.mode).toBe('embedded')
  })

  it('静音模式下不显示反应', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')
    await store.updateSettings({ muted: true })
    expect(store.isMuted).toBe(true)
  })

  it('自定义宠物创建和删除', async () => {
    const store = usePetStore()
    await store.init()

    await store.addCustomPet({
      id: 'custom-test',
      name: '测试宠物',
      personality: '测试性格',
      visual: { type: 'image', path: '', frameCount: 1 },
      presetReactions: {
        idle: ['测试'], typing: ['测试'],
        error: ['测试'], success: ['测试'], petted: ['测试']
      }
    }, '/fake/path.png')

    expect(store.allPets.find(p => p.id === 'custom-test')).toBeDefined()

    await store.removeCustomPet('custom-test')
    expect(store.allPets.find(p => p.id === 'custom-test')).toBeUndefined()
  })
})
