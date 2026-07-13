// src/stores/pet.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import { BUILTIN_PETS } from '@/lib/builtinPets'
import { DEFAULT_PET_SETTINGS, DEFAULT_PET_RUNTIME_STATE } from '@/types/pet'
import type { Pet, PetConfig, PetSettings, PetMode, PetRuntimeState } from '@/types/pet'

const REACTION_DISPLAY_MS = 10_000
const PETTED_DURATION_MS = 2500

export const usePetStore = defineStore('pet', () => {
  const config = ref<PetConfig | null>(null)
  const runtimeState = ref<PetRuntimeState>({ ...DEFAULT_PET_RUNTIME_STATE })
  const isInitialized = ref(false)

  let reactionTimer: ReturnType<typeof setTimeout> | null = null
  let pettedTimer: ReturnType<typeof setTimeout> | null = null

  const allPets = computed<Pet[]>(() => [
    ...BUILTIN_PETS,
    ...(config.value?.customPets ?? [])
  ])

  const activePet = computed<Pet | null>(() => {
    const id = config.value?.activePetId
    if (!id) return null
    return allPets.value.find(p => p.id === id) ?? null
  })

  const mode = computed<PetMode>(() => config.value?.mode ?? 'embedded')
  const isMuted = computed(() => config.value?.settings.muted ?? false)

  function createDefaultConfig(): PetConfig {
    return {
      version: 1,
      activePetId: '',
      mode: 'embedded',
      embeddedPosition: { x: 0.85, y: 0.78 },
      desktopWindow: { x: 1200, y: 700, width: 120, height: 120 },
      settings: { ...DEFAULT_PET_SETTINGS },
      customPets: []
    }
  }

  function getLocale(): 'zh-CN' | 'en-US' {
    try {
      const saved = localStorage.getItem('claude_desktop_settings')
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.language === 'en-US' ? 'en-US' : 'zh-CN'
      }
    } catch { /* ignore */ }
    return 'zh-CN'
  }

  async function init(): Promise<void> {
    const loaded = await api.pet.readConfig()
    config.value = loaded ?? createDefaultConfig()
    isInitialized.value = true
  }

  async function persist(): Promise<void> {
    if (!config.value) return
    await api.pet.writeConfig(config.value)
  }

  async function setActivePet(petId: string): Promise<void> {
    if (!config.value) return
    config.value.activePetId = petId
    await persist()
  }

  async function updateSettings(patch: Partial<PetSettings>): Promise<void> {
    if (!config.value) return
    config.value.settings = { ...config.value.settings, ...patch }
    await persist()
  }

  async function addCustomPet(pet: Pet, assetSrcPath?: string): Promise<void> {
    if (!config.value) return

    let finalPet = pet
    if (assetSrcPath) {
      const relativePath = await api.pet.saveAsset(assetSrcPath, pet.id)
      finalPet = {
        ...pet,
        visual: { type: 'image', path: relativePath, frameCount: 1 }
      }
    }

    config.value.customPets.push(finalPet)
    config.value.activePetId = finalPet.id
    await persist()
  }

  async function removeCustomPet(petId: string): Promise<void> {
    if (!config.value) return
    const pet = config.value.customPets.find(p => p.id === petId)
    if (!pet) return

    if (pet.visual.type === 'image') {
      await api.pet.deleteAsset(pet.visual.path)
    }

    config.value.customPets = config.value.customPets.filter(p => p.id !== petId)
    if (config.value.activePetId === petId) {
      config.value.activePetId = ''
    }
    await persist()
  }

  async function updatePosition(pos: { x: number; y: number }): Promise<void> {
    if (!config.value) return
    if (mode.value === 'embedded') {
      config.value.embeddedPosition = pos
    } else {
      config.value.desktopWindow.x = pos.x
      config.value.desktopWindow.y = pos.y
    }
    await persist()
  }

  function syncToDesktopWindow(): void {
    if (mode.value !== 'desktop' || !activePet.value || !config.value) return
    api.pet.syncPetState({
      pet: activePet.value,
      runtimeState: runtimeState.value,
      settings: config.value.settings,
      locale: getLocale()
    })
  }

  async function setMode(newMode: PetMode): Promise<void> {
    if (!config.value) return
    const oldMode = config.value.mode
    config.value.mode = newMode
    await persist()

    if (newMode === 'desktop' && oldMode !== 'desktop') {
      await api.pet.createDesktopWindow()
      syncToDesktopWindow()
    } else if (newMode === 'embedded' && oldMode !== 'embedded') {
      await api.pet.destroyDesktopWindow()
    }
  }

  function triggerReaction(text: string): void {
    runtimeState.value.currentReaction = text
    runtimeState.value.reactionAt = Date.now()

    if (reactionTimer) clearTimeout(reactionTimer)
    reactionTimer = setTimeout(() => {
      runtimeState.value.currentReaction = null
      runtimeState.value.reactionAt = null
    }, REACTION_DISPLAY_MS)
    syncToDesktopWindow()
  }

  function triggerPetted(): void {
    runtimeState.value.isPetted = true

    if (pettedTimer) clearTimeout(pettedTimer)
    pettedTimer = setTimeout(() => {
      runtimeState.value.isPetted = false
    }, PETTED_DURATION_MS)
    syncToDesktopWindow()
  }

  function clearReaction(): void {
    runtimeState.value.currentReaction = null
    runtimeState.value.reactionAt = null
    if (reactionTimer) {
      clearTimeout(reactionTimer)
      reactionTimer = null
    }
    syncToDesktopWindow()
  }

  return {
    config,
    activePet,
    runtimeState,
    isInitialized,
    allPets,
    mode,
    isMuted,
    init,
    setActivePet,
    updateSettings,
    addCustomPet,
    removeCustomPet,
    updatePosition,
    setMode,
    syncToDesktopWindow,
    triggerReaction,
    triggerPetted,
    clearReaction,
  }
})
