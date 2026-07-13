<!-- src/components/pets/sprites/OctopusSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 8 条触手
const BODY_PATHS = [
  'M 25 30 Q 25 15 50 15 Q 75 15 75 30 Q 75 40 50 40 Q 25 40 25 30 Z',
  'M 25 30 Q 25 15 50 15 Q 75 15 75 30 Q 75 40 50 40 Q 25 40 25 30 Z',
  'M 25 25 Q 25 10 50 10 Q 75 10 75 25 Q 75 35 50 35 Q 25 35 25 25 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 8 条触手 -->
      <path d="M 28 38 Q 22 45 25 52" :stroke="palette.primary" stroke-width="3" fill="none" stroke-linecap="round" />
      <path d="M 34 40 Q 30 48 32 55" :stroke="palette.primary" stroke-width="3" fill="none" stroke-linecap="round" />
      <path d="M 40 41 Q 38 50 40 56" :stroke="palette.primary" stroke-width="3" fill="none" stroke-linecap="round" />
      <path d="M 46 42 Q 46 50 45 56" :stroke="palette.primary" stroke-width="3" fill="none" stroke-linecap="round" />
      <path d="M 54 42 Q 54 50 55 56" :stroke="palette.primary" stroke-width="3" fill="none" stroke-linecap="round" />
      <path d="M 60 41 Q 62 50 60 56" :stroke="palette.primary" stroke-width="3" fill="none" stroke-linecap="round" />
      <path d="M 66 40 Q 70 48 68 55" :stroke="palette.primary" stroke-width="3" fill="none" stroke-linecap="round" />
      <path d="M 72 38 Q 78 45 75 52" :stroke="palette.primary" stroke-width="3" fill="none" stroke-linecap="round" />
      <!-- 头部 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 眼睛 -->
      <circle cx="40" cy="25" r="3" :fill="palette.accent" :opacity="eyeOpacity" />
      <circle cx="60" cy="25" r="3" :fill="palette.accent" :opacity="eyeOpacity" />
      <circle cx="40" cy="25" r="1.2" fill="#000" :opacity="eyeOpacity" />
      <circle cx="60" cy="25" r="1.2" fill="#000" :opacity="eyeOpacity" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
