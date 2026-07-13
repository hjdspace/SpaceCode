<!-- src/components/pets/sprites/DuckSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

const BODY_PATHS = [
  'M 25 25 Q 50 15 75 25 L 80 45 Q 50 55 20 45 Z',
  'M 25 25 Q 50 15 75 25 L 80 45 Q 50 55 20 45 Z',
  'M 25 20 Q 50 10 75 20 L 80 40 Q 50 50 20 40 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <ellipse cx="50" cy="30" rx="10" ry="5" :fill="palette.accent" />
      <circle cx="40" cy="25" r="2.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <circle cx="60" cy="25" r="2.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <ellipse cx="75" cy="38" rx="6" ry="4" :fill="palette.primary" opacity="0.8" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
