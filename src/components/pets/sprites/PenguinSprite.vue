<!-- src/components/pets/sprites/PenguinSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 白肚子 + 翅膀
const BODY_PATHS = [
  'M 30 20 Q 30 15 50 15 Q 70 15 70 20 L 72 45 Q 50 52 28 45 Z',
  'M 30 20 Q 30 15 50 15 Q 70 15 70 20 L 72 45 Q 50 52 28 45 Z',
  'M 30 15 Q 30 10 50 10 Q 70 10 70 15 L 72 40 Q 50 47 28 40 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 身体 -->
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <!-- 白肚子 -->
      <ellipse cx="50" cy="35" rx="14" ry="13" fill="#FFFFFF" opacity="0.9" />
      <!-- 左翅 -->
      <path d="M 30 22 Q 22 30 26 42 Q 30 35 32 28 Z" :fill="palette.primary" opacity="0.9" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 右翅 -->
      <path d="M 70 22 Q 78 30 74 42 Q 70 35 68 28 Z" :fill="palette.primary" opacity="0.9" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
      <!-- 眼睛 -->
      <circle cx="43" cy="22" r="2" :fill="palette.accent" :opacity="eyeOpacity" />
      <circle cx="57" cy="22" r="2" :fill="palette.accent" :opacity="eyeOpacity" />
      <!-- 喙 -->
      <path d="M 47 25 L 53 25 L 50 29 Z" :fill="palette.accent" />
      <!-- 脚 -->
      <path d="M 42 50 L 38 53 L 46 53 Z" :fill="palette.accent" />
      <path d="M 58 50 L 54 53 L 62 53 Z" :fill="palette.accent" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
