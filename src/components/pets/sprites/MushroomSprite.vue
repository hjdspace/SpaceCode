<!-- src/components/pets/sprites/MushroomSprite.vue -->
<!-- 稀有度：common —— 优化版：菌帽立体层叠、菌褶细节、斑点大小渐变、孢子粒子 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  if (props.frame === 2) return -5
  return 0
})
// 帽子摆动 + 整体轻微倾斜
const capTilt = computed(() => (props.frame === 2 ? 5 : 0))
const capTransform = computed(() => `rotate(${capTilt} 50 32)`)
// 孢子飘散位移
const sporeDrift = computed(() => (props.frame === 2 ? 2 : 0))

const uid = Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 菌帽立体渐变 -->
      <radialGradient :id="`mCapGrad${uid}`" cx="32%" cy="22%" r="82%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.5)" />
        <stop offset="50%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.42)" />
      </radialGradient>
      <!-- 菌柄渐变 -->
      <linearGradient :id="`mStemGrad${uid}`" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="rgba(0,0,0,0.22)" />
        <stop offset="30%" stop-color="rgba(255,255,255,0)" />
        <stop offset="70%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.25)" />
      </linearGradient>
      <filter :id="`mShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="28" ry="2.5" fill="rgba(0,0,0,0.22)" :filter="`url(#mShadow${uid})`" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 地面装饰：草丛 -->
      <path d="M 20 53 Q 22 49 24 53" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" fill="none" />
      <path d="M 76 53 Q 78 49 80 53" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" fill="none" />
      <circle cx="18" cy="53" r="1" fill="rgba(0,0,0,0.2)" />
      <circle cx="82" cy="53" r="1" fill="rgba(0,0,0,0.2)" />

      <!-- 菌柄 -->
      <path d="M 30 50 L 30 36 Q 30 32 35 32 L 65 32 Q 70 32 70 36 L 70 50 Z"
            :fill="palette.accent" stroke="rgba(0,0,0,0.18)" stroke-width="0.6" />
      <path d="M 30 50 L 30 36 Q 30 32 35 32 L 65 32 Q 70 32 70 36 L 70 50 Z"
            :fill="`url(#mStemGrad${uid})`" />

      <!-- 菌褶细节 -->
      <path d="M 20 33 Q 35 31 50 31 Q 65 31 80 33" stroke="rgba(0,0,0,0.3)" stroke-width="0.7" fill="none" />
      <path d="M 24 32 Q 37 30 50 30 Q 63 30 76 32" stroke="rgba(0,0,0,0.18)" stroke-width="0.5" fill="none" />
      <line x1="28" y1="31.5" x2="72" y2="31.5" stroke="rgba(0,0,0,0.12)" stroke-width="0.4" />

      <!-- 帽子 -->
      <g :transform="capTransform">
        <path d="M 12 32 Q 12 6 50 6 Q 88 6 88 32 Q 50 37 12 32 Z"
              :fill="palette.primary" stroke="rgba(0,0,0,0.25)" stroke-width="0.7" />
        <path d="M 12 32 Q 12 6 50 6 Q 88 6 88 32 Q 50 37 12 32 Z"
              :fill="`url(#mCapGrad${uid})`" />

        <!-- 白色圆斑（大小渐变分布） -->
        <circle cx="30" cy="20" r="4" :fill="palette.accent" stroke="rgba(0,0,0,0.08)" stroke-width="0.3" />
        <circle cx="50" cy="12" r="4.5" :fill="palette.accent" stroke="rgba(0,0,0,0.08)" stroke-width="0.3" />
        <circle cx="70" cy="20" r="4" :fill="palette.accent" stroke="rgba(0,0,0,0.08)" stroke-width="0.3" />
        <circle cx="40" cy="26" r="3" :fill="palette.accent" stroke="rgba(0,0,0,0.08)" stroke-width="0.3" />
        <circle cx="62" cy="26" r="3" :fill="palette.accent" stroke="rgba(0,0,0,0.08)" stroke-width="0.3" />
        <circle cx="22" cy="28" r="2.2" :fill="palette.accent" stroke="rgba(0,0,0,0.08)" stroke-width="0.3" />
        <circle cx="78" cy="28" r="2.2" :fill="palette.accent" stroke="rgba(0,0,0,0.08)" stroke-width="0.3" />

        <!-- 帽顶高光 -->
        <ellipse cx="42" cy="10" rx="10" ry="3" fill="rgba(255,255,255,0.4)" />
      </g>

      <!-- 眼睛 -->
      <template v-if="!isBlinking">
        <circle cx="42" cy="40" r="2.4" fill="rgba(0,0,0,0.85)" />
        <circle cx="58" cy="40" r="2.4" fill="rgba(0,0,0,0.85)" />
        <circle cx="43" cy="39" r="0.8" fill="rgba(255,255,255,0.95)" />
        <circle cx="59" cy="39" r="0.8" fill="rgba(255,255,255,0.95)" />
      </template>
      <template v-else>
        <path d="M 40 40 Q 42 38 44 40" stroke="rgba(0,0,0,0.85)" stroke-width="1.1" fill="none" stroke-linecap="round" />
        <path d="M 56 40 Q 58 38 60 40" stroke="rgba(0,0,0,0.85)" stroke-width="1.1" fill="none" stroke-linecap="round" />
      </template>

      <!-- 微笑 -->
      <path d="M 47 44 Q 50 47 53 44" stroke="rgba(0,0,0,0.6)" stroke-width="1" fill="none" stroke-linecap="round" />

      <!-- 腮红 -->
      <ellipse cx="37" cy="44" rx="2" ry="1.6" :fill="palette.primary" opacity="0.35" />
      <ellipse cx="63" cy="44" rx="2" ry="1.6" :fill="palette.primary" opacity="0.35" />

      <!-- 飘散孢子粒子 -->
      <circle :cx="16 - sporeDrift" cy="28" r="1" :fill="palette.accent" opacity="0.45" />
      <circle cx="84" cy="26" r="0.8" :fill="palette.accent" opacity="0.35" />
      <circle :cx="10 - sporeDrift" cy="34" r="0.7" :fill="palette.accent" opacity="0.3" />
    </g>

    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>