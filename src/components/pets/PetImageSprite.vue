<!-- src/components/pets/PetImageSprite.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  src: string
  frameCount?: 1 | 2
  frame: number
  isPetted: boolean
}>()

const loadError = ref(false)

function onLoad() { loadError.value = false }
function onError() { loadError.value = true }
</script>

<template>
  <div class="pet-image-sprite" :class="{ petted: isPetted }">
    <img
      v-if="!loadError && src"
      :src="src"
      width="80"
      height="48"
      @load="onLoad"
      @error="onError"
    />
    <div v-else class="placeholder">
      <span>图片丢失</span>
    </div>
    <span v-if="isPetted && !loadError" class="heart">♥</span>
  </div>
</template>

<style scoped lang="scss">
.pet-image-sprite {
  position: relative;
  width: 80px;
  height: 48px;
  transition: transform 0.3s ease;

  &.petted { transform: scale(1.1); }

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary, #333);
  color: var(--text-muted, #999);
  font-size: 10px;
  border-radius: 4px;
}

.heart {
  position: absolute;
  top: -10px;
  right: 10px;
  font-size: 14px;
  color: #FF6B9D;
}
</style>
