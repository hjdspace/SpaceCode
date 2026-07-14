<!-- src/components/pets/sprites/GhostSprite.vue -->
<!-- 稀有度：epic —— 优化版：半透明渐变灵魂体、底部波纹层次、鬼火环绕 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

const uid = Math.random().toString(36).slice(2, 8)

const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
// frame 2 或被抚摸时漂浮上升
const isFloating = computed(() => props.frame === 2 || props.isPetted)

const bodyOffsetY = computed(() => (isFloating.value ? -5 : 0))

// 经典幽灵身体：圆头 + 扩散底部裙摆
const bodyPath = computed(() => {
  if (isFloating.value) {
    // 飘动时底部波纹摆动更明显
    return 'M 24 22 Q 24 6 50 6 Q 76 6 76 22 L 76 46 Q 72 53 66 46 Q 62 53 58 46 Q 53 53 50 46 Q 46 53 42 46 Q 38 53 34 46 Q 28 53 24 46 Z'
  }
  return 'M 24 22 Q 24 6 50 6 Q 76 6 76 22 L 76 46 Q 72 52 68 46 Q 63 52 58 46 Q 53 52 50 46 Q 46 52 42 46 Q 37 52 34 46 Q 28 52 24 46 Z'
})

// 底部装饰波纹层次
const rufflePath = computed(() => {
  if (isFloating.value) {
    return 'M 24 44 Q 28 48 34 44 Q 38 48 42 44 Q 46 48 50 44 Q 54 48 58 44 Q 62 48 68 44 Q 72 48 76 44'
  }
  return 'M 24 44 Q 28 48 32 44 Q 36 48 42 44 Q 46 48 50 44 Q 54 48 58 44 Q 64 48 68 44 Q 72 48 76 44'
})

const showBigMouth = computed(() => props.frame === 2)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 灵魂体渐变：上半亮下半透 -->
      <linearGradient :id="`ghBody${uid}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="palette.primary" stop-opacity="0.92" />
        <stop offset="60%" :stop-color="palette.primary" stop-opacity="0.7" />
        <stop offset="100%" :stop-color="palette.primary" stop-opacity="0.5" />
      </linearGradient>
      <!-- 立体感径向渐变 -->
      <radialGradient :id="`ghShade${uid}`" cx="38%" cy="25%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.45)" />
        <stop offset="50%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.2)" />
      </radialGradient>
      <!-- epic 外发光 -->
      <filter :id="`ghGlow${uid}`" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
      <filter :id="`ghShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2" />
      </filter>
    </defs>

    <!-- 接地阴影（飘起时变淡） -->
    <ellipse cx="50" cy="55" rx="26" :ry="isFloating ? 1.6 : 2.5"
             :fill="isFloating ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.22)'"
             :filter="`url(#ghShadow${uid})`" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- epic 鬼火光环（accent 色发光晕） -->
      <path :d="bodyPath" :fill="palette.accent" opacity="0.15"
            :transform="'translate(-2,-2) scale(1.06)'" :filter="`url(#ghGlow${uid})`" />

      <!-- 身体主体 -->
      <path :d="bodyPath" :fill="`url(#ghBody${uid})`" stroke="rgba(0,0,0,0.1)" stroke-width="0.6" />
      <!-- 立体渐变 -->
      <path :d="bodyPath" :fill="`url(#ghShade${uid})`" />

      <!-- 底部装饰波纹线 -->
      <path :d="rufflePath" stroke="rgba(255,255,255,0.25)" stroke-width="1" fill="none" stroke-linecap="round" />

      <!-- 顶部高光 -->
      <ellipse cx="42" cy="12" rx="8" ry="3.5" fill="rgba(255,255,255,0.35)" />

      <!-- 小圆手 -->
      <path d="M 24 28 Q 16 30 14 24" stroke="rgba(0,0,0,0.2)" stroke-width="1.6" fill="none" stroke-linecap="round" />
      <path d="M 76 28 Q 84 30 86 24" stroke="rgba(0,0,0,0.2)" stroke-width="1.6" fill="none" stroke-linecap="round" />

      <!-- 眼睛：椭圆大眼睛 -->
      <template v-if="!isBlinking">
        <ellipse cx="42" cy="24" rx="3.5" ry="4.5" fill="rgba(0,0,0,0.8)" />
        <ellipse cx="58" cy="24" rx="3.5" ry="4.5" fill="rgba(0,0,0,0.8)" />
        <ellipse cx="43" cy="22" rx="1.2" ry="1.5" fill="rgba(255,255,255,0.85)" />
        <ellipse cx="59" cy="22" rx="1.2" ry="1.5" fill="rgba(255,255,255,0.85)" />
      </template>
      <template v-else>
        <path d="M 38 24 Q 42 20 46 24" stroke="rgba(0,0,0,0.8)" stroke-width="1.5" fill="none" stroke-linecap="round" />
        <path d="M 54 24 Q 58 20 62 24" stroke="rgba(0,0,0,0.8)" stroke-width="1.5" fill="none" stroke-linecap="round" />
      </template>

      <!-- O 形嘴 -->
      <ellipse cx="50" :cy="showBigMouth ? 37 : 35"
               :rx="showBigMouth ? 5 : 3.5"
               :ry="showBigMouth ? 6 : 4.5"
               :fill="palette.accent" opacity="0.7" />
      <ellipse cx="50" :cy="showBigMouth ? 38 : 36"
               :rx="showBigMouth ? 3.5 : 2.2"
               :ry="showBigMouth ? 4 : 3"
               fill="rgba(0,0,0,0.4)" />

      <!-- 腮红 -->
      <circle cx="33" cy="32" r="2.5" :fill="palette.accent" opacity="0.3" />
      <circle cx="67" cy="32" r="2.5" :fill="palette.accent" opacity="0.3" />
    </g>

    <text v-if="isPetted" x="65" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>