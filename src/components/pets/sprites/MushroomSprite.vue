<!-- src/components/pets/sprites/MushroomSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 圆帽 + 白点
const BODY_PATHS = [
  'M 20 50 L 20 40 Q 20 35 25 35 L 75 35 Q 80 35 80 40 L 80 50 Z',
  'M 20 50 L 20 40 Q 20 35 25 35 L 75 35 Q 80 35 80 40 L 80 50 Z',
  'M 20 50 L 20 36 Q 20 31 25 31 L 75 31 Q 80 31 80 36 L 80 50 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 茎 -->
      <path :d="currentPath" :fill="palette.accent" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 圆帽 -->
      <path d="M 15 30 Q 15 10 50 10 Q 85 10 85 30 Q 85 35 50 35 Q 15 35 15 30 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 白点 -->
      <circle cx="32" cy="22" r="3" :fill="palette.accent" />
      <circle cx="50" cy="16" r="3.5" :fill="palette.accent" />
      <circle cx="68" cy="22" r="3" :fill="palette.accent" />
      <circle cx="42" cy="28" r="2" :fill="palette.accent" />
      <circle cx="60" cy="28" r="2" :fill="palette.accent" />
      <!-- 眼睛 -->
      <circle cx="40" cy="42" r="1.8" fill="#000" :opacity="eyeOpacity" />
      <circle cx="60" cy="42" r="1.8" fill="#000" :opacity="eyeOpacity" />
      <!-- 嘴 -->
      <path d="M 47 46 Q 50 48 53 46" stroke="#000" stroke-width="1" fill="none" :opacity="eyeOpacity" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
