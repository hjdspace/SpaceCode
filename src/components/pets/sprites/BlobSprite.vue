<!-- src/components/pets/sprites/BlobSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 圆形无装饰
const BODY_PATHS = [
  'M 22 35 Q 22 18 50 18 Q 78 18 78 35 Q 78 52 50 52 Q 22 52 22 35 Z',
  'M 22 35 Q 22 18 50 18 Q 78 18 78 35 Q 78 52 50 52 Q 22 52 22 35 Z',
  'M 22 30 Q 22 13 50 13 Q 78 13 78 30 Q 78 47 50 47 Q 22 47 22 30 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <circle cx="40" cy="32" r="2.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <circle cx="60" cy="32" r="2.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <!-- 小腮红 -->
      <circle cx="32" cy="38" r="2" :fill="palette.accent" opacity="0.4" />
      <circle cx="68" cy="38" r="2" :fill="palette.accent" opacity="0.4" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
