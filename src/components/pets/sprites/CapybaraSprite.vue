<!-- src/components/pets/sprites/CapybaraSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 圆耳朵 + 小眼睛
const BODY_PATHS = [
  'M 20 35 Q 20 22 50 22 Q 80 22 80 35 Q 80 50 50 50 Q 20 50 20 35 Z',
  'M 20 35 Q 20 22 50 22 Q 80 22 80 35 Q 80 50 50 50 Q 20 50 20 35 Z',
  'M 20 30 Q 20 17 50 17 Q 80 17 80 30 Q 80 45 50 45 Q 20 45 20 30 Z'
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
      <!-- 左耳 -->
      <circle cx="32" cy="22" r="4" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <circle cx="32" cy="22" r="2" :fill="palette.accent" opacity="0.6" />
      <!-- 右耳 -->
      <circle cx="68" cy="22" r="4" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <circle cx="68" cy="22" r="2" :fill="palette.accent" opacity="0.6" />
      <!-- 小眼睛 -->
      <circle cx="38" cy="32" r="1.5" fill="#000" :opacity="eyeOpacity" />
      <circle cx="62" cy="32" r="1.5" fill="#000" :opacity="eyeOpacity" />
      <!-- 鼻子 -->
      <ellipse cx="50" cy="40" rx="3" ry="2" :fill="palette.accent" />
      <circle cx="48" cy="40" r="0.6" fill="#000" />
      <circle cx="52" cy="40" r="0.6" fill="#000" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
