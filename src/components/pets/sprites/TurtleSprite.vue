<!-- src/components/pets/sprites/TurtleSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 龟壳花纹
const BODY_PATHS = [
  'M 25 30 Q 25 22 50 22 Q 75 22 75 30 Q 75 45 50 45 Q 25 45 25 30 Z',
  'M 25 30 Q 25 22 50 22 Q 75 22 75 30 Q 75 45 50 45 Q 25 45 25 30 Z',
  'M 25 26 Q 25 18 50 18 Q 75 18 75 26 Q 75 41 50 41 Q 25 41 25 26 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 头 -->
      <circle cx="78" cy="33" r="5" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <circle cx="80" cy="32" r="1.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <!-- 4 条腿 -->
      <ellipse cx="30" cy="44" rx="4" ry="3" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
      <ellipse cx="70" cy="44" rx="4" ry="3" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
      <ellipse cx="30" cy="24" rx="4" ry="3" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
      <ellipse cx="70" cy="24" rx="4" ry="3" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
      <!-- 尾巴 -->
      <path d="M 22 33 L 16 30 L 22 36 Z" :fill="palette.primary" />
      <!-- 龟壳 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 龟壳花纹（六边形） -->
      <path d="M 50 25 L 56 28 L 56 36 L 50 39 L 44 36 L 44 28 Z" :fill="palette.accent" opacity="0.6" stroke="rgba(0,0,0,0.2)" stroke-width="0.5" />
      <path d="M 36 27 L 42 30 L 42 36 L 36 38 L 32 35 L 32 30 Z" :fill="palette.accent" opacity="0.4" stroke="rgba(0,0,0,0.2)" stroke-width="0.5" />
      <path d="M 64 27 L 68 30 L 68 35 L 64 38 L 58 36 L 58 30 Z" :fill="palette.accent" opacity="0.4" stroke="rgba(0,0,0,0.2)" stroke-width="0.5" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
