<!-- src/components/pets/sprites/RobotSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 天线 + 屏幕
const BODY_PATHS = [
  'M 25 20 L 75 20 L 75 50 L 25 50 Z',
  'M 25 20 L 75 20 L 75 50 L 25 50 Z',
  'M 25 16 L 75 16 L 75 46 L 25 46 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0.3 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 天线 -->
      <line x1="50" y1="20" x2="50" y2="10" :stroke="palette.accent" stroke-width="1.5" />
      <circle cx="50" cy="8" r="2.5" :fill="palette.accent" />
      <!-- 身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 屏幕 -->
      <rect x="32" y="24" width="36" height="16" rx="2" :fill="palette.accent" opacity="0.85" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" />
      <!-- 眼睛（屏幕上） -->
      <rect x="38" y="28" width="6" height="6" rx="1" fill="#000" :opacity="eyeOpacity" />
      <rect x="56" y="28" width="6" height="6" rx="1" fill="#000" :opacity="eyeOpacity" />
      <!-- 嘴 -->
      <rect x="42" y="36" width="16" height="2" fill="#000" :opacity="eyeOpacity" />
      <!-- 按钮 -->
      <circle cx="35" cy="46" r="1.5" :fill="palette.accent" />
      <circle cx="42" cy="46" r="1.5" :fill="palette.accent" opacity="0.7" />
      <circle cx="49" cy="46" r="1.5" :fill="palette.accent" opacity="0.5" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
