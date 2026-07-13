<!-- src/components/pets/sprites/OwlSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 大眼睛 + 翅膀
const BODY_PATHS = [
  'M 25 32 Q 25 18 50 18 Q 75 18 75 32 Q 75 50 50 50 Q 25 50 25 32 Z',
  'M 25 32 Q 25 18 50 18 Q 75 18 75 32 Q 75 50 50 50 Q 25 50 25 32 Z',
  'M 25 27 Q 25 13 50 13 Q 75 13 75 27 Q 75 45 50 45 Q 25 45 25 27 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0.3 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 翅膀 -->
      <path d="M 25 30 Q 15 35 20 45 Q 25 38 28 35 Z" :fill="palette.primary" opacity="0.8" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <path d="M 75 30 Q 85 35 80 45 Q 75 38 72 35 Z" :fill="palette.primary" opacity="0.8" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 耳簇 -->
      <path d="M 35 18 L 32 10 L 40 16 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <path d="M 65 18 L 68 10 L 60 16 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 大眼睛外圈 -->
      <circle cx="40" cy="30" r="6" :fill="palette.accent" :opacity="eyeOpacity" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
      <circle cx="60" cy="30" r="6" :fill="palette.accent" :opacity="eyeOpacity" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
      <!-- 大眼睛内圈 -->
      <circle cx="40" cy="30" r="2.5" fill="#000" :opacity="eyeOpacity" />
      <circle cx="60" cy="30" r="2.5" fill="#000" :opacity="eyeOpacity" />
      <!-- 喙 -->
      <path d="M 48 36 L 52 36 L 50 40 Z" :fill="palette.accent" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
