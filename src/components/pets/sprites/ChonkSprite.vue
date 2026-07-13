<!-- src/components/pets/sprites/ChonkSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 大圆身体 + 小头
const BODY_PATHS = [
  'M 15 40 Q 15 25 50 25 Q 85 25 85 40 Q 85 55 50 55 Q 15 55 15 40 Z',
  'M 15 40 Q 15 25 50 25 Q 85 25 85 40 Q 85 55 50 55 Q 15 55 15 40 Z',
  'M 15 36 Q 15 21 50 21 Q 85 21 85 36 Q 85 51 50 51 Q 15 51 15 36 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 大身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 小头 -->
      <circle cx="50" cy="20" r="9" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 小耳朵 -->
      <circle cx="44" cy="13" r="2.5" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
      <circle cx="56" cy="13" r="2.5" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
      <!-- 眼睛 -->
      <circle cx="46" cy="19" r="1.5" fill="#000" :opacity="eyeOpacity" />
      <circle cx="54" cy="19" r="1.5" fill="#000" :opacity="eyeOpacity" />
      <!-- 鼻子 -->
      <ellipse cx="50" cy="23" rx="2" ry="1.2" :fill="palette.accent" />
      <!-- 肚皮斑纹 -->
      <ellipse cx="50" cy="42" rx="20" ry="8" :fill="palette.accent" opacity="0.3" />
      <!-- 小爪 -->
      <ellipse cx="22" cy="52" rx="4" ry="2" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
      <ellipse cx="78" cy="52" rx="4" ry="2" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
