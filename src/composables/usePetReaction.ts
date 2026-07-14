// src/composables/usePetReaction.ts
import { usePetStore } from '@/stores/pet'
import { api } from '@/services/electronAPI'
import { DEFAULT_PRESET_REACTIONS } from '@/lib/defaultReactions'
import type { PetReactionTrigger } from '@/types/pet'

const MAX_RECENT_MESSAGES = 6
const MESSAGE_TRUNCATE_LENGTH = 200

export function usePetReaction() {
  const petStore = usePetStore()
  let lastReactionAt = 0

  function pickPresetReaction(trigger: PetReactionTrigger): string | null {
    const pet = petStore.activePet
    if (!pet) return null

    const reactions = pet.presetReactions[trigger]
    const pool = reactions.length > 0 ? reactions : DEFAULT_PRESET_REACTIONS[trigger]
    if (pool.length === 0) return null

    return pool[Math.floor(Math.random() * pool.length)]
  }

  async function generateAIReaction(trigger: PetReactionTrigger): Promise<string | null> {
    const pet = petStore.activePet
    if (!pet) return null

    let recentMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    try {
      const { useChatSessionStore } = await import('@/stores/chatSession')
      const chatStore = useChatSessionStore()
      const messages = chatStore.currentMessages ?? []
      recentMessages = messages
        .slice(-MAX_RECENT_MESSAGES)
        .map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: (typeof m.content === 'string' ? m.content : '').slice(0, MESSAGE_TRUNCATE_LENGTH)
        }))
    } catch { /* chatSession 未初始化时忽略 */ }

    return await api.pet.generateReaction({
      petName: pet.name,
      personality: pet.personality,
      recentMessages,
      trigger
    })
  }

  async function generateReaction(trigger: PetReactionTrigger): Promise<string | null> {
    if (petStore.isMuted) return null
    if (!petStore.activePet) return null

    const intervalMs = petStore.config?.settings.reactionIntervalMs ?? 60000
    if (trigger !== 'petted' && Date.now() - lastReactionAt < intervalMs) {
      return null
    }

    const reactionMode = petStore.config?.settings.reactionMode ?? 'preset'
    const text = reactionMode === 'ai'
      ? await generateAIReaction(trigger)
      : pickPresetReaction(trigger)

    if (text) {
      petStore.triggerReaction(text)
      lastReactionAt = Date.now()
    }

    return text
  }

  function onUserTyping(): void { generateReaction('typing') }
  function onTaskError(): void { generateReaction('error') }
  function onTaskSuccess(): void { generateReaction('success') }
  function onUserPetted(): void { generateReaction('petted') }
  function onIdleInterval(): void { generateReaction('idle') }

  return {
    generateReaction,
    onUserTyping,
    onTaskError,
    onTaskSuccess,
    onUserPetted,
    onIdleInterval,
  }
}

// 模块级单例，供非组件上下文调用（如 eventHandlers）
let globalInstance: ReturnType<typeof usePetReaction> | null = null

export function initPetReactionGlobal() {
  if (!globalInstance) {
    globalInstance = usePetReaction()
  }
  return globalInstance
}

export function triggerPetReaction(trigger: PetReactionTrigger) {
  if (!globalInstance) {
    initPetReactionGlobal()
  }
  return globalInstance!.generateReaction(trigger)
}
