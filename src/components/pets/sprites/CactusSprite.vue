<!-- src/components/pets/sprites/CactusSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 刺 + 花
const BODY_PATHS = [
  'M 40 50 L 40 20 Q 40 12 50 12 Q 60 12 60 20 L 60 50 Z',
  'M 40 50 L 40 20 Q 40 12 50 12 Q 60 12 60 20 L 60 50 Z',
  'M 40 50 L 40 15 Q 40 7 50 7 Q 60 7 60 15 L 60 50 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 左臂 -->
      <path d="M 40 30 Q 30 30 28 38 L 28 50 L 34 50 L 34 38 Q 36 36 40 36 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 右臂 -->
      <path d="M 60 25 Q 70 25 72 33 L 72 50 L 66 50 L 66 33 Q 64 31 60 31 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 主体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 花 -->
      <circle cx="50" cy="10" r="3" :fill="palette.accent" />
      <circle cx="46" cy="9" r="2.5" :fill="palette.accent" opacity="0.8" />
      <circle cx="54" cy="9" r="2.5" :fill="palette.accent" opacity="0.8" />
      <circle cx="50" cy="6" r="2.5" :fill="palette.accent" opacity="0.8" />
      <circle cx="50" cy="10" r="1.2" fill="#FFD93D" />
      <!-- 刺 -->
      <line x1="45" y1="20" x2="43" y2="18" stroke="#fff" stroke-width="0.8" />
      <line x1="55" y1="20" x2="57" y2="18" stroke="#fff" stroke-width="0.8" />
      <line x1="45" y1="30" x2="43" y2="28" stroke="#fff" stroke-width="0.8" />
      <line x1="55" y1="30" x2="57" y2="28" stroke="#fff" stroke-width="0.8" />
      <line x1="45" y1="40" x2="43" y2="38" stroke="#fff" stroke-width="0.8" />
      <line x1="55" y1="40" x2="57" y2="38" stroke="#fff" stroke-width="0.8" />
      <!-- 眼睛 -->
      <circle cx="46" cy="28" r="1.5" fill="#000" :opacity="eyeOpacity" />
      <circle cx="54" cy="28" r="1.5" fill="#000" :opacity="eyeOpacity" />
      <!-- 嘴 -->
      <path d="M 47 34 Q 50 36 53 34" stroke="#000" stroke-width="1" fill="none" :opacity="eyeOpacity" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
