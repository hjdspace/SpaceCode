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
// 内部状态：pointer 已按下但还未达到 drag 阈值
let isPointerDown = false
let startX = 0
let startY = 0
// 移动超过此阈值（像素）才认定为 drag，否则视为 click
const DRAG_THRESHOLD = 4

function onPointerDown(e: PointerEvent) {
  isPointerDown = true
  isDragging = false
  startX = e.screenX
  startY = e.screenY
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!isPointerDown) return
  const dx = e.screenX - startX
  const dy = e.screenY - startY

  // 未达到 drag 阈值时不移动，让浏览器正常触发 click
  if (!isDragging) {
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
      return
    }
    isDragging = true
  }

  // 已进入 drag，按增量移动窗口
  const deltaX = e.screenX - startX
  const deltaY = e.screenY - startY
  startX = e.screenX
  startY = e.screenY
  window.petWindowAPI!.emitWindowEvent({ type: 'drag', deltaX, deltaY })
}

function onPointerUp() {
  if (!isPointerDown) return
  isPointerDown = false
  const wasDragging = isDragging
  isDragging = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  // 只有真正发生 drag 时才通知 drag-end；否则视为 click，由 @click 处理
  if (wasDragging) {
    window.petWindowAPI!.emitWindowEvent({ type: 'drag-end' })
  }
}

function onSpriteClick() {
  window.petWindowAPI!.emitWindowEvent({ type: 'click' })
}

onMounted(async () => {
  state.locale = await window.petWindowAPI!.getLocale()
  await initPetWindowI18n(state.locale)

  window.petWindowAPI!.onStateUpdate((payload: any) => {
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
