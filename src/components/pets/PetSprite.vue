<!-- src/components/pets/PetSprite.vue -->
<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, type Component } from 'vue'
import type { Pet } from '@/types/pet'
import DuckSprite from './sprites/DuckSprite.vue'
import GooseSprite from './sprites/GooseSprite.vue'
import BlobSprite from './sprites/BlobSprite.vue'
import CatSprite from './sprites/CatSprite.vue'
import DragonSprite from './sprites/DragonSprite.vue'
import OctopusSprite from './sprites/OctopusSprite.vue'
import OwlSprite from './sprites/OwlSprite.vue'
import PenguinSprite from './sprites/PenguinSprite.vue'
import TurtleSprite from './sprites/TurtleSprite.vue'
import SnailSprite from './sprites/SnailSprite.vue'
import GhostSprite from './sprites/GhostSprite.vue'
import AxolotlSprite from './sprites/AxolotlSprite.vue'
import CapybaraSprite from './sprites/CapybaraSprite.vue'
import CactusSprite from './sprites/CactusSprite.vue'
import RobotSprite from './sprites/RobotSprite.vue'
import RabbitSprite from './sprites/RabbitSprite.vue'
import MushroomSprite from './sprites/MushroomSprite.vue'
import ChonkSprite from './sprites/ChonkSprite.vue'
import PetImageSprite from './PetImageSprite.vue'

const SPRITE_MAP: Record<string, Component> = {
  duck: DuckSprite, goose: GooseSprite, blob: BlobSprite, cat: CatSprite,
  dragon: DragonSprite, octopus: OctopusSprite, owl: OwlSprite, penguin: PenguinSprite,
  turtle: TurtleSprite, snail: SnailSprite, ghost: GhostSprite, axolotl: AxolotlSprite,
  capybara: CapybaraSprite, cactus: CactusSprite, robot: RobotSprite, rabbit: RabbitSprite,
  mushroom: MushroomSprite, chonk: ChonkSprite,
}

const props = defineProps<{
  pet: Pet
  isPetted: boolean
  scale?: number
}>()

const frame = ref<0 | 1 | 2>(0)
let rafId: number | null = null
let lastFrameAt = 0
const FRAME_INTERVAL = 500

function tick(t: number) {
  if (t - lastFrameAt >= FRAME_INTERVAL) {
    frame.value = ((frame.value + 1) % 3) as 0 | 1 | 2
    lastFrameAt = t
  }
  rafId = requestAnimationFrame(tick)
}

onMounted(() => { rafId = requestAnimationFrame(tick) })
onUnmounted(() => { if (rafId) cancelAnimationFrame(rafId) })

const spriteComponent = computed(() => {
  if (props.pet.visual.type === 'builtin-svg') {
    return SPRITE_MAP[props.pet.visual.species]
  }
  return null
})
</script>

<template>
  <div class="pet-sprite" :style="{ transform: `scale(${scale ?? 1})` }">
    <component
      v-if="pet.visual.type === 'builtin-svg' && spriteComponent"
      :is="spriteComponent"
      :palette="pet.palette!"
      :frame="frame"
      :is-petted="isPetted"
    />
    <PetImageSprite
      v-else-if="pet.visual.type === 'image'"
      :src="pet.visual.path"
      :frame-count="pet.visual.frameCount ?? 1"
      :frame="frame"
      :is-petted="isPetted"
    />
  </div>
</template>

<style scoped>
.pet-sprite {
  display: inline-block;
  transition: transform 0.2s ease;
}
</style>
