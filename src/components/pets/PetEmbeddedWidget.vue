<!-- src/components/pets/PetEmbeddedWidget.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { usePetStore } from '@/stores/pet'
import { usePetDrag } from '@/composables/usePetDrag'
import { usePetReaction } from '@/composables/usePetReaction'
import PetSprite from './PetSprite.vue'
import PetReactionBubble from './PetReactionBubble.vue'

const petStore = usePetStore()
const reaction = usePetReaction()

const position = computed(() => petStore.config?.embeddedPosition ?? { x: 0.85, y: 0.78 })
const scale = computed(() => petStore.config?.settings.scale ?? 1)

const { isDragging, onPointerDown } = usePetDrag({
  mode: 'embedded',
  onDragEnd: (pos) => petStore.updatePosition(pos)
})

function onSpriteClick() {
  reaction.onUserPetted()
  petStore.triggerPetted()
}
</script>

<template>
  <div
    v-if="petStore.activePet"
    class="pet-embedded-widget"
    :style="{
      left: `${position.x * 100}%`,
      top: `${position.y * 100}%`,
      transform: 'translate(-50%, -50%)'
    }"
  >
    <PetReactionBubble
      :text="petStore.runtimeState.currentReaction"
      @dismiss="petStore.clearReaction()"
    />
    <div
      class="pet-sprite-wrapper"
      :class="{ dragging: isDragging }"
      @pointerdown="onPointerDown"
      @click="onSpriteClick"
    >
      <PetSprite
        :pet="petStore.activePet"
        :is-petted="petStore.runtimeState.isPetted"
        :scale="scale"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.pet-embedded-widget {
  position: fixed;
  z-index: 999;
  pointer-events: auto;
  user-select: none;
}

.pet-sprite-wrapper {
  cursor: grab;
  display: inline-block;

  &.dragging { cursor: grabbing; }
  &:hover { filter: brightness(1.05); }
}
</style>
