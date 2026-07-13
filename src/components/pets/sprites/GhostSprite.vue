<!-- src/components/pets/sprites/GhostSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 防止多实例 SVG id 冲突
const uid = Math.random().toString(36).slice(2, 8)

// 帧动画状态
const isFloating = computed(() => props.frame === 2 || props.isPetted) // 漂浮上升
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
const bodyOffsetY = computed(() => (isFloating.value ? -5 : 0))
// 飘逸底部 path：frame 2 时波纹横向偏移制造摆动感
const bodyPath = computed(() => {
  if (isFloating.value) {
    // 摆动后的波纹底部
    return 'M 25 22 Q 25 8 50 8 Q 75 8 75 22 L 75 46 Q 72 53 68 46 Q 63 52 58 46 Q 53 53 48 46 Q 43 52 38 46 Q 33 53 28 46 Q 24 52 22 46 Z'
  }
  return 'M 25 22 Q 25 8 50 8 Q 75 8 75 22 L 75 46 Q 70 52 65 46 Q 60 52 55 46 Q 50 52 45 46 Q 40 52 35 46 Q 30 52 25 46 Z'
})
const showSpookMouth = computed(() => props.frame === 2) // 惊吓时嘴张大
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体渐变（左上高光 → 右下阴影） -->
      <radialGradient :id="'bodyGrad-' + uid" cx="40%" cy="28%" r="75%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
        <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.22"/>
      </radialGradient>
      <!-- 接地阴影模糊 -->
      <filter :id="'shadow-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6"/>
      </filter>
      <!-- epic 外发光晕（强模糊） -->
      <filter :id="'halo-' + uid" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3.2"/>
      </filter>
    </defs>

    <!-- 接地阴影（幽灵飘起时阴影变淡） -->
    <ellipse cx="50" cy="55" rx="24" :ry="isFloating ? 1.8 : 2.5"
             :fill="isFloating ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.25)'"
             :filter="'url(#shadow-' + uid + ')'"/>

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- epic 外发光晕（身体放大副本 + 强模糊 accent） -->
      <path :d="bodyPath" :fill="palette.accent" opacity="0.22"
            :transform="'translate(-3, -3) scale(1.08)'" :filter="'url(#halo-' + uid + ')'"/>

      <!-- 身体主体（半透明） -->
      <path :d="bodyPath" :fill="palette.primary" opacity="0.78"
            stroke="rgba(0,0,0,0.15)" stroke-width="0.8"/>
      <!-- 身体渐变叠加（立体感，不破坏半透明） -->
      <path :d="bodyPath" :fill="'url(#bodyGrad-' + uid + ')'" opacity="0.9"/>

      <!-- 顶部高光 -->
      <ellipse cx="42" cy="14" rx="7" ry="3" fill="rgba(255,255,255,0.35)"/>

      <!-- 小手臂（飘逸感，frame 2 时摆动） -->
      <path :d="isFloating ? 'M 26 28 Q 18 30 16 24' : 'M 26 28 Q 18 26 16 32'"
            stroke="rgba(0,0,0,0.35)" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.7"/>
      <path :d="isFloating ? 'M 74 28 Q 82 30 84 24' : 'M 74 28 Q 82 26 84 32'"
            stroke="rgba(0,0,0,0.35)" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.7"/>

      <!-- 眼睛 -->
      <template v-if="!isBlinking">
        <!-- 睁眼：椭圆 + 高光 -->
        <ellipse cx="41" cy="24" rx="2.6" ry="3.4" fill="rgba(0,0,0,0.78)"/>
        <ellipse cx="59" cy="24" rx="2.6" ry="3.4" fill="rgba(0,0,0,0.78)"/>
        <ellipse cx="42" cy="22.5" rx="0.9" ry="1.1" fill="#fff" opacity="0.85"/>
        <ellipse cx="60" cy="22.5" rx="0.9" ry="1.1" fill="#fff" opacity="0.85"/>
      </template>
      <template v-else>
        <!-- 眨眼：弯月闭眼 ^^ -->
        <path d="M 38 24 Q 41 21 44 24" stroke="rgba(0,0,0,0.78)" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        <path d="M 56 24 Q 59 21 62 24" stroke="rgba(0,0,0,0.78)" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      </template>

      <!-- O 形嘴（张大，frame 2 时更大） -->
      <ellipse cx="50" :cy="showSpookMouth ? 36 : 34"
               :rx="showSpookMouth ? 4.5 : 3.2"
               :ry="showSpookMouth ? 5.5 : 4"
               :fill="palette.accent" opacity="0.75"/>
      <!-- 嘴内深色 -->
      <ellipse cx="50" :cy="showSpookMouth ? 37 : 35"
               :rx="showSpookMouth ? 3 : 2"
               :ry="showSpookMouth ? 3.8 : 2.6"
               fill="rgba(0,0,0,0.4)"/>
    </g>

    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
