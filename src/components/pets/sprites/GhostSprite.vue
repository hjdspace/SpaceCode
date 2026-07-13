<!-- src/components/pets/sprites/GhostSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 飘逸底部
const BODY_PATHS = [
  'M 25 20 Q 25 10 50 10 Q 75 10 75 20 L 75 45 Q 70 50 65 45 Q 60 50 55 45 Q 50 50 45 45 Q 40 50 35 45 Q 30 50 25 45 Z',
  'M 25 20 Q 25 10 50 10 Q 75 10 75 20 L 75 45 Q 70 50 65 45 Q 60 50 55 45 Q 50 50 45 45 Q 40 50 35 45 Q 30 50 25 45 Z',
  'M 25 15 Q 25 5 50 5 Q 75 5 75 15 L 75 40 Q 70 45 65 40 Q 60 45 55 40 Q 50 45 45 40 Q 40 45 35 40 Q 30 45 25 40 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 身体（飘逸底部） -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" opacity="0.85" />
      <!-- 眼睛 -->
      <ellipse cx="40" cy="25" rx="3" ry="4" fill="#000" :opacity="eyeOpacity" />
      <ellipse cx="60" cy="25" rx="3" ry="4" fill="#000" :opacity="eyeOpacity" />
      <!-- 嘴巴（O 形） -->
      <ellipse cx="50" cy="35" rx="3" ry="4" :fill="palette.accent" opacity="0.7" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
