// tests/stores/pet-persistence.test.ts
// 回归测试：模拟 GUI 关闭→重开 的完整持久化往返。
// Bug 现象：选择宠物 + 配置 AI 行为模式后，关闭 GUI 再打开，
//         之前选择的宠物和 AI 行为模式都丢失，需要重新选择/配置。
//
// 该测试为 red-capable 反馈回路：捕获 setActivePet/updateSettings 写入的配置，
// 然后用新 store 实例 + 该配置重新 init，断言状态完整恢复。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { PetConfig } from '@/types/pet'

// 持久化层模拟：writeConfig 把传入的 config 存到闭包变量，
// readConfig 返回最近一次写入的 config（模拟磁盘往返）。
let persistedConfig: PetConfig | null = null

vi.mock('@/services/electronAPI', () => ({
  api: {
    pet: {
      readConfig: vi.fn(async () => persistedConfig),
      writeConfig: vi.fn(async (c: PetConfig) => {
        persistedConfig = JSON.parse(JSON.stringify(c)) // 深拷贝，避免引用污染
      }),
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

import { usePetStore } from '@/stores/pet'

describe('PetStore 持久化往返（关闭 GUI → 重开）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    persistedConfig = null
    // 重置所有 mock 调用计数
    vi.clearAllMocks()
  })

  it('选择的宠物 + AI 行为模式在重启后完整恢复', async () => {
    // ── 第一次启动：用户选择宠物 + 配置 AI 行为模式 ──
    const store1 = usePetStore()
    await store1.init()
    expect(store1.isInitialized).toBe(true)

    await store1.setActivePet('builtin-duck')
    await store1.updateSettings({
      reactionMode: 'ai',
      aiModel: 'gpt-4o-mini',
      reactionIntervalMs: 120000,
    })

    expect(store1.activePet?.id).toBe('builtin-duck')
    expect(store1.config?.settings.reactionMode).toBe('ai')
    expect(store1.config?.settings.aiModel).toBe('gpt-4o-mini')
    expect(store1.config?.settings.reactionIntervalMs).toBe(120000)

    // 断言配置确实被写入磁盘
    expect(persistedConfig).not.toBeNull()
    expect(persistedConfig!.activePetId).toBe('builtin-duck')
    expect(persistedConfig!.settings.reactionMode).toBe('ai')
    expect(persistedConfig!.settings.aiModel).toBe('gpt-4o-mini')

    // ── 模拟 GUI 关闭并重新打开：新 store 实例从磁盘读取 ──
    // 关键：必须在新 Pinia 实例上创建新 store，避免共享响应式状态
    setActivePinia(createPinia())
    const store2 = usePetStore()
    expect(store2.isInitialized).toBe(false) // 重启后未初始化

    await store2.init()

    // ── 断言用户的状态完整恢复 ──
    expect(store2.isInitialized).toBe(true)
    expect(store2.config?.activePetId).toBe('builtin-duck')
    expect(store2.activePet?.id).toBe('builtin-duck')
    expect(store2.config?.settings.reactionMode).toBe('ai')
    expect(store2.config?.settings.aiModel).toBe('gpt-4o-mini')
    expect(store2.config?.settings.reactionIntervalMs).toBe(120000)
  })

  it('桌面模式在重启后自动恢复（createDesktopWindow 被调用）', async () => {
    const { api } = await import('@/services/electronAPI')

    // 第一次启动：切到 desktop 模式 + 选择宠物
    const store1 = usePetStore()
    await store1.init()
    await store1.setActivePet('builtin-duck')
    await store1.setMode('desktop')

    expect(store1.mode).toBe('desktop')
    expect(persistedConfig?.mode).toBe('desktop')

    // ── 模拟重启 ──
    setActivePinia(createPinia())
    const createDesktopWindowSpy = api.pet.createDesktopWindow as ReturnType<typeof vi.fn>
    createDesktopWindowSpy.mockClear()

    const store2 = usePetStore()
    await store2.init()

    // 桌面模式应自动重建窗口
    expect(store2.mode).toBe('desktop')
    expect(createDesktopWindowSpy).toHaveBeenCalledTimes(1)
  })

  it('自定义宠物重启后仍出现在 allPets 列表', async () => {
    // 第一次启动：创建自定义宠物
    const store1 = usePetStore()
    await store1.init()
    await store1.addCustomPet({
      id: 'custom-test-pet',
      name: '测试宠物',
      personality: '可爱',
      visual: { type: 'image', path: '', frameCount: 1 },
      presetReactions: {
        idle: ['喵'], typing: ['喵'],
        error: ['喵'], success: ['喵'], petted: ['喵']
      }
    }, '/fake/path.png')
    await store1.setActivePet('custom-test-pet')

    expect(persistedConfig?.customPets.length).toBe(1)
    expect(persistedConfig?.activePetId).toBe('custom-test-pet')

    // ── 模拟重启 ──
    setActivePinia(createPinia())
    const store2 = usePetStore()
    await store2.init()

    expect(store2.activePet?.id).toBe('custom-test-pet')
    expect(store2.allPets.find(p => p.id === 'custom-test-pet')).toBeDefined()
  })
})
