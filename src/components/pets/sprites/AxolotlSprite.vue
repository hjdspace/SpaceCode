<!-- src/components/pets/sprites/AxolotlSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 鳃 + 尾巴
const BODY_PATHS = [
  'M 30 35 Q 30 25 50 25 Q 70 25 75 30 L 78 40 Q 50 48 25 42 Z',
  'M 30 35 Q 30 25 50 25 Q 70 25 75 30 L 78 40 Q 50 48 25 42 Z',
  'M 30 30 Q 30 20 50 20 Q 70 20 75 25 L 78 35 Q 50 43 25 37 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 尾巴 -->
      <path d="M 75 32 Q 88 30 92 22 Q 90 28 88 35 Q 82 40 78 38 Z" :fill="palette.primary" opacity="0.9" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 头部 -->
      <circle cx="30" cy="33" r="8" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 左侧 3 条鳃 -->
      <path d="M 24 28 Q 16 22 14 30 Q 18 28 22 30" :fill="palette.accent" opacity="0.8" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
      <path d="M 22 33 Q 12 32 12 38 Q 18 35 22 35" :fill="palette.accent" opacity="0.8" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
      <path d="M 24 38 Q 16 42 18 48 Q 20 44 24 40" :fill="palette.accent" opacity="0.8" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
      <!-- 右侧 3 条鳃 -->
      <path d="M 36 28 Q 44 22 46 30 Q 42 28 38 30" :fill="palette.accent" opacity="0.8" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
      <path d="M 38 33 Q 48 32 48 38 Q 42 35 38 35" :fill="palette.accent" opacity="0.8" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
      <path d="M 36 38 Q 44 42 42 48 Q 40 44 36 40" :fill="palette.accent" opacity="0.8" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
      <!-- 眼睛 -->
      <circle cx="27" cy="30" r="2" :fill="palette.accent" :opacity="eyeOpacity" />
      <circle cx="33" cy="30" r="2" :fill="palette.accent" :opacity="eyeOpacity" />
      <!-- 嘴 -->
      <path d="M 27 36 Q 30 38 33 36" stroke="rgba(0,0,0,0.5)" stroke-width="1" fill="none" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
