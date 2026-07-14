// tests/stores/pet.test.ts
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
      syncPetState: vi.fn(),
      generateReaction: vi.fn().mockResolvedValue(null),
      createDesktopWindow: vi.fn().mockResolvedValue(undefined),
      destroyDesktopWindow: vi.fn().mockResolvedValue(undefined),
      updateWindowBounds: vi.fn().mockResolvedValue(undefined),
      onWindowEvent: vi.fn().mockReturnValue(() => {}),
    }
  }
}))

describe('petStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('init 后 isInitialized 为 true', async () => {
    const store = usePetStore()
    await store.init()
    expect(store.isInitialized).toBe(true)
  })

  it('无配置时 activePet 为 null', async () => {
    const store = usePetStore()
    await store.init()
    expect(store.activePet).toBeNull()
  })

  it('setActivePet 更新 activePetId 并持久化', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')
    expect(store.config?.activePetId).toBe('builtin-duck')
    expect(store.activePet?.id).toBe('builtin-duck')
  })

  it('updateSettings 部分更新设置', async () => {
    const store = usePetStore()
    await store.init()
    await store.updateSettings({ muted: true })
    expect(store.config?.settings.muted).toBe(true)
  })

  it('triggerReaction 设置当前反应', async () => {
    const store = usePetStore()
    await store.init()
    store.triggerReaction('测试反应')
    expect(store.runtimeState.currentReaction).toBe('测试反应')
    expect(store.runtimeState.reactionAt).not.toBeNull()
  })

  it('triggerPetted 设置 isPetted', async () => {
    const store = usePetStore()
    await store.init()
    store.triggerPetted()
    expect(store.runtimeState.isPetted).toBe(true)
  })

  it('clearReaction 清除当前反应', async () => {
    const store = usePetStore()
    await store.init()
    store.triggerReaction('测试')
    store.clearReaction()
    expect(store.runtimeState.currentReaction).toBeNull()
  })

  it('allPets 包含内置宠物', async () => {
    const store = usePetStore()
    await store.init()
    expect(store.allPets.length).toBeGreaterThanOrEqual(18)
  })
})
