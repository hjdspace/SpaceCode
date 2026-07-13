<!-- src/components/pets/sprites/CatSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 三角耳朵 + 胡须
const BODY_PATHS = [
  'M 25 35 Q 25 22 50 22 Q 75 22 75 35 Q 75 50 50 50 Q 25 50 25 35 Z',
  'M 25 35 Q 25 22 50 22 Q 75 22 75 35 Q 75 50 50 50 Q 25 50 25 35 Z',
  'M 25 30 Q 25 17 50 17 Q 75 17 75 30 Q 75 45 50 45 Q 25 45 25 30 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 左耳 -->
      <path d="M 28 24 L 32 12 L 38 22 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 右耳 -->
      <path d="M 72 24 L 68 12 L 62 22 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 眼睛 -->
      <ellipse cx="40" cy="32" rx="2.5" ry="3.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <ellipse cx="60" cy="32" rx="2.5" ry="3.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <!-- 鼻子 -->
      <path d="M 48 38 L 52 38 L 50 41 Z" :fill="palette.accent" />
      <!-- 胡须 -->
      <line x1="22" y1="36" x2="32" y2="37" stroke="rgba(0,0,0,0.4)" stroke-width="0.8" />
      <line x1="22" y1="40" x2="32" y2="40" stroke="rgba(0,0,0,0.4)" stroke-width="0.8" />
      <line x1="78" y1="36" x2="68" y2="37" stroke="rgba(0,0,0,0.4)" stroke-width="0.8" />
      <line x1="78" y1="40" x2="68" y2="40" stroke="rgba(0,0,0,0.4)" stroke-width="0.8" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
