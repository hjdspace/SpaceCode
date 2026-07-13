<!-- src/components/pets/sprites/BlobSprite.vue -->
<!-- 稀有度：common —— 优化版：更浓郁的果冻质感、流动动画、表情更生动 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
const isSquished = computed(() => props.frame === 2 && !props.isPetted)
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  if (props.frame === 2) return -5
  return 0
})

// 身体轮廓：挤压态更扁更宽，弹起时拉长
const bodyPath = computed(() => {
  if (isSquished.value) {
    return 'M 14 42 Q 14 24 50 24 Q 86 24 86 42 Q 86 52 50 52 Q 14 52 14 42 Z'
  }
  return 'M 20 38 Q 20 14 50 14 Q 80 14 80 38 Q 80 52 50 52 Q 20 52 20 38 Z'
})

// 内部流动气泡位移
const bubbleOffset = computed(() => (props.frame === 2 ? 2 : 0))

const uid = Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 果冻身体渐变：亮部更通透 -->
      <radialGradient :id="`blbGrad${uid}`" cx="32%" cy="28%" r="82%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.65)" />
        <stop offset="45%" stop-color="rgba(255,255,255,0.08)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.35)" />
      </radialGradient>
      <!-- 内核光晕（模仿果冻内心发光） -->
      <radialGradient :id="`blbCore${uid}`" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.25)" />
        <stop offset="100%" stop-color="rgba(255,255,255,0)" />
      </radialGradient>
      <filter :id="`blbShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 底部投影 -->
    <ellipse cx="50" cy="55" rx="30" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="`url(#blbShadow${uid})`" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 身体底色 -->
      <path :d="bodyPath" :fill="palette.primary" stroke="rgba(0,0,0,0.12)" stroke-width="0.5" />
      <!-- 立体渐变 -->
      <path :d="bodyPath" :fill="`url(#blbGrad${uid})`" />
      <!-- 内核柔光 -->
      <ellipse cx="50" cy="32" rx="18" ry="10" :fill="`url(#blbCore${uid})`" />

      <!-- 内部气泡粒子 (6 个) -->
      <circle cx="34" cy="30" r="2.8" fill="rgba(255,255,255,0.35)" />
      <circle :cx="62 - bubbleOffset" :cy="36 - bubbleOffset" r="2.2" fill="rgba(255,255,255,0.3)" />
      <circle cx="50" cy="22" r="1.6" fill="rgba(255,255,255,0.4)" />
      <circle :cx="28 + bubbleOffset" cy="42" r="1.4" fill="rgba(255,255,255,0.25)" />
      <circle cx="70" cy="26" r="1.8" fill="rgba(255,255,255,0.2)" />
      <circle cx="45" cy="44" r="1.2" fill="rgba(255,255,255,0.3)" />

      <!-- 顶部高光（两层） -->
      <ellipse cx="36" cy="18" rx="12" ry="4" fill="rgba(255,255,255,0.45)" />
      <ellipse cx="40" cy="16" rx="5" ry="2" fill="rgba(255,255,255,0.6)" />

      <!-- 眼睛 -->
      <template v-if="!isBlinking">
        <circle cx="40" cy="32" r="3" fill="rgba(0,0,0,0.85)" />
        <circle cx="60" cy="32" r="3" fill="rgba(0,0,0,0.85)" />
        <circle cx="41.5" cy="30.5" r="1.1" fill="rgba(255,255,255,0.95)" />
        <circle cx="61.5" cy="30.5" r="1.1" fill="rgba(255,255,255,0.95)" />
      </template>
      <template v-else>
        <path d="M 37 32 Q 40 29 43 32" stroke="rgba(0,0,0,0.85)" stroke-width="1.4" fill="none" stroke-linecap="round" />
        <path d="M 57 32 Q 60 29 63 32" stroke="rgba(0,0,0,0.85)" stroke-width="1.4" fill="none" stroke-linecap="round" />
      </template>

      <!-- 嘴：开心微笑 -->
      <path d="M 45 40 Q 50 44 55 40" stroke="rgba(0,0,0,0.7)" stroke-width="1.2" fill="none" stroke-linecap="round" />

      <!-- 腮红 -->
      <ellipse cx="30" cy="38" rx="3.5" ry="2.5" :fill="palette.accent" opacity="0.45" />
      <ellipse cx="70" cy="38" rx="3.5" ry="2.5" :fill="palette.accent" opacity="0.45" />
    </g>

    <text v-if="isPetted" x="65" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>