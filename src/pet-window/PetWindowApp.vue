<!-- src/pet-window/PetWindowApp.vue -->
<script setup lang="ts">
import { reactive, onMounted } from 'vue'
import { initPetWindowI18n } from './i18n'
import PetSprite from '@/components/pets/PetSprite.vue'
import PetReactionBubble from '@/components/pets/PetReactionBubble.vue'
import type { Pet, PetRuntimeState, PetSettings } from '@/types/pet'

const state = reactive<{
  pet: Pet | null
  reaction: string | null
  isPetted: boolean
  scale: number
  locale: 'zh-CN' | 'en-US'
}>({
  pet: null,
  reaction: null,
  isPetted: false,
  scale: 1,
  locale: 'zh-CN'
})

let isDragging = false
let startX = 0
let startY = 0

function onPointerDown(e: PointerEvent) {
  isDragging = true
  startX = e.screenX
  startY = e.screenY
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging) return
  const deltaX = e.screenX - startX
  const deltaY = e.screenY - startY
  startX = e.screenX
  startY = e.screenY
  window.petWindowAPI.emitWindowEvent({ type: 'drag', deltaX, deltaY })
}

function onPointerUp() {
  isDragging = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.petWindowAPI.emitWindowEvent({ type: 'drag-end' })
}

function onSpriteClick() {
  window.petWindowAPI.emitWindowEvent({ type: 'click' })
}

onMounted(async () => {
  state.locale = await window.petWindowAPI.getLocale()
  await initPetWindowI18n(state.locale)

  window.petWindowAPI.onStateUpdate((payload: any) => {
    state.pet = payload.pet
    state.reaction = payload.runtimeState.currentReaction
    state.isPetted = payload.runtimeState.isPetted
    state.scale = payload.settings.scale
    state.locale = payload.locale
  })
})
</script>

<template>
  <div class="pet-window-root" @pointerdown="onPointerDown">
    <PetReactionBubble v-if="state.pet" :text="state.reaction" />
    <PetSprite
      v-if="state.pet"
      :pet="state.pet"
      :is-petted="state.isPetted"
      :scale="state.scale"
    />
  </div>
</template>

<style>
html, body, #pet-window-root {
  margin: 0;
  padding: 0;
  background: transparent;
  overflow: hidden;
  user-select: none;
  width: 100%;
  height: 100%;
}

.pet-window-root {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
}

.pet-window-root:active {
  cursor: grabbing;
}
</style>
