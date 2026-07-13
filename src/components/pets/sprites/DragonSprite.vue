<!-- src/components/pets/sprites/DragonSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 角 + 翅膀 + 尾巴
const BODY_PATHS = [
  'M 28 35 Q 28 22 50 22 Q 72 22 72 35 Q 72 50 50 50 Q 28 50 28 35 Z',
  'M 28 35 Q 28 22 50 22 Q 72 22 72 35 Q 72 50 50 50 Q 28 50 28 35 Z',
  'M 28 30 Q 28 17 50 17 Q 72 17 72 30 Q 72 45 50 45 Q 28 45 28 30 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 尾巴 -->
      <path d="M 72 40 Q 85 35 90 25 L 88 22 L 92 22 L 90 18" :fill="palette.accent" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 左翅 -->
      <path d="M 28 28 Q 12 18 8 32 Q 18 30 28 34 Z" :fill="palette.accent" opacity="0.85" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 右翅 -->
      <path d="M 72 28 Q 88 18 92 32 Q 82 30 72 34 Z" :fill="palette.accent" opacity="0.85" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 左角 -->
      <path d="M 38 22 L 35 10 L 42 18 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 右角 -->
      <path d="M 62 22 L 65 10 L 58 18 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 眼睛 -->
      <circle cx="42" cy="32" r="2.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <circle cx="58" cy="32" r="2.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <!-- 鼻孔 -->
      <circle cx="48" cy="40" r="0.8" fill="rgba(0,0,0,0.5)" />
      <circle cx="52" cy="40" r="0.8" fill="rgba(0,0,0,0.5)" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
