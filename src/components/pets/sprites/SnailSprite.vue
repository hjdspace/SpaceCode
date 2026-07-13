<!-- src/components/pets/sprites/SnailSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 螺旋壳 + 触角
const BODY_PATHS = [
  'M 20 45 Q 20 38 30 38 L 80 38 Q 85 38 85 45 Q 85 50 80 50 L 25 50 Q 20 50 20 45 Z',
  'M 20 45 Q 20 38 30 38 L 80 38 Q 85 38 85 45 Q 85 50 80 50 L 25 50 Q 20 50 20 45 Z',
  'M 20 40 Q 20 33 30 33 L 80 33 Q 85 33 85 40 Q 85 45 80 45 L 25 45 Q 20 45 20 40 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 螺旋壳 -->
      <circle cx="50" cy="28" r="14" :fill="palette.accent" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <path d="M 50 28 Q 58 22 60 28 Q 58 34 50 32 Q 44 28 48 24 Q 54 22 56 28" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="1.2" />
      <!-- 触角 -->
      <line x1="78" y1="38" x2="82" y2="25" :stroke="palette.primary" stroke-width="1.5" stroke-linecap="round" />
      <line x1="84" y1="38" x2="88" y2="22" :stroke="palette.primary" stroke-width="1.5" stroke-linecap="round" />
      <!-- 触角末端 -->
      <circle cx="82" cy="24" r="1.5" :fill="palette.accent" />
      <circle cx="88" cy="21" r="1.5" :fill="palette.accent" />
      <!-- 眼睛（在触角末端） -->
      <circle cx="82" cy="24" r="0.8" fill="#000" :opacity="eyeOpacity" />
      <circle cx="88" cy="21" r="0.8" fill="#000" :opacity="eyeOpacity" />
    </g>
    <text v-if="isPetted" x="40" y="12" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
