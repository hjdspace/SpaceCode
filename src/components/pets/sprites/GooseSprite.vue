<!-- src/components/pets/sprites/GooseSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 白色身体 + 长脖子
const BODY_PATHS = [
  'M 25 38 Q 50 28 75 38 L 80 50 Q 50 56 20 50 Z',
  'M 25 38 Q 50 28 75 38 L 80 50 Q 50 56 20 50 Z',
  'M 25 33 Q 50 23 75 33 L 80 45 Q 50 51 20 45 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 长脖子 -->
      <path d="M 55 38 Q 56 22 60 12 L 68 12 Q 70 22 66 38 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 头部 -->
      <circle cx="64" cy="11" r="5.5" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 喙 -->
      <path d="M 69 10 L 76 12 L 69 14 Z" :fill="palette.accent" />
      <!-- 眼睛 -->
      <circle cx="64" cy="10" r="1.5" :fill="palette.accent" :opacity="eyeOpacity" />
    </g>
    <text v-if="isPetted" x="80" y="8" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
