<!-- src/components/pets/sprites/RabbitSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 长耳朵 + 蓬尾
const BODY_PATHS = [
  'M 28 38 Q 28 25 50 25 Q 72 25 72 38 Q 72 50 50 50 Q 28 50 28 38 Z',
  'M 28 38 Q 28 25 50 25 Q 72 25 72 38 Q 72 50 50 50 Q 28 50 28 38 Z',
  'M 28 33 Q 28 20 50 20 Q 72 20 72 33 Q 72 45 50 45 Q 28 45 28 33 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 长耳朵 -->
      <ellipse cx="42" cy="12" rx="3" ry="10" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <ellipse cx="58" cy="12" rx="3" ry="10" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 耳朵内侧 -->
      <ellipse cx="42" cy="12" rx="1.5" ry="7" :fill="palette.accent" opacity="0.6" />
      <ellipse cx="58" cy="12" rx="1.5" ry="7" :fill="palette.accent" opacity="0.6" />
      <!-- 身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 蓬尾 -->
      <circle cx="74" cy="38" r="4" :fill="palette.primary" opacity="0.85" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 眼睛 -->
      <circle cx="42" cy="33" r="2" :fill="palette.accent" :opacity="eyeOpacity" />
      <circle cx="58" cy="33" r="2" :fill="palette.accent" :opacity="eyeOpacity" />
      <!-- 鼻子 -->
      <path d="M 48 40 L 52 40 L 50 42 Z" :fill="palette.accent" />
    </g>
    <text v-if="isPetted" x="80" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
