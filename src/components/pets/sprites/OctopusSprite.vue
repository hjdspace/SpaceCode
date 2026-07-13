<!-- src/components/pets/sprites/OctopusSprite.vue -->
<!-- 稀有度：rare —— 优化版：流线型圆头、吸盘纹理触手、墨汁粒子、立体感更强 -->
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
const isJumping = computed(() => props.frame === 2 || props.isPetted)
const bodyOffsetY = computed(() => (isJumping.value ? -5 : 0))

// 触手整体摆动角度
const tentacleSway = computed(() => (props.frame === 2 ? 6 : 0))
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 头部立体渐变 -->
      <radialGradient :id="`ocHead${uid}`" cx="42%" cy="25%" r="76%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.5)" />
        <stop offset="50%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.3)" />
      </radialGradient>
      <!-- rare 发光描边 -->
      <filter :id="`ocGlow${uid}`" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
      <filter :id="`ocShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="32" ry="2.5" fill="rgba(0,0,0,0.22)" :filter="`url(#ocShadow${uid})`" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- rare 光环 -->
      <ellipse cx="50" cy="22" rx="30" ry="22" :fill="palette.accent" opacity="0.12" :filter="`url(#ocGlow${uid})`" />

      <!-- 左侧 4 条触手 -->
      <g :transform="`rotate(${tentacleSway}, 45, 30)`">
        <path d="M 30 30 Q 22 42 26 52 Q 24 56 28 58"
              :stroke="palette.primary" stroke-width="3.6" fill="none" stroke-linecap="round" />
        <circle cx="26" cy="40" r="0.8" fill="rgba(0,0,0,0.15)" />
        <circle cx="25" cy="48" r="0.7" fill="rgba(0,0,0,0.15)" />

        <path d="M 37 30 Q 34 42 36 54 Q 34 57 37 59"
              :stroke="palette.primary" stroke-width="3.6" fill="none" stroke-linecap="round" />
        <circle cx="35" cy="42" r="0.8" fill="rgba(0,0,0,0.15)" />
        <circle cx="35" cy="50" r="0.7" fill="rgba(0,0,0,0.15)" />

        <path d="M 44 30 Q 44 44 42 56 Q 42 58 44 59"
              :stroke="palette.primary" stroke-width="3.6" fill="none" stroke-linecap="round" />
        <circle cx="43" cy="44" r="0.8" fill="rgba(0,0,0,0.15)" />
        <circle cx="43" cy="52" r="0.7" fill="rgba(0,0,0,0.15)" />

        <path d="M 48 30 Q 49 44 47 56 Q 47 58 49 59"
              :stroke="palette.primary" stroke-width="3.6" fill="none" stroke-linecap="round" />
        <circle cx="48" cy="44" r="0.8" fill="rgba(0,0,0,0.15)" />
        <circle cx="48" cy="52" r="0.7" fill="rgba(0,0,0,0.15)" />
      </g>

      <!-- 右侧 4 条触手 -->
      <g :transform="`rotate(${tentacleSway * -1}, 55, 30)`">
        <path d="M 56 30 Q 56 44 58 56 Q 58 58 56 59"
              :stroke="palette.primary" stroke-width="3.6" fill="none" stroke-linecap="round" />
        <circle cx="57" cy="44" r="0.8" fill="rgba(0,0,0,0.15)" />
        <circle cx="57" cy="52" r="0.7" fill="rgba(0,0,0,0.15)" />

        <path d="M 62 30 Q 64 42 62 54 Q 64 57 61 59"
              :stroke="palette.primary" stroke-width="3.6" fill="none" stroke-linecap="round" />
        <circle cx="63" cy="42" r="0.8" fill="rgba(0,0,0,0.15)" />
        <circle cx="63" cy="50" r="0.7" fill="rgba(0,0,0,0.15)" />

        <path d="M 68 30 Q 72 42 68 52 Q 70 56 66 58"
              :stroke="palette.primary" stroke-width="3.6" fill="none" stroke-linecap="round" />
        <circle cx="70" cy="40" r="0.8" fill="rgba(0,0,0,0.15)" />
        <circle cx="69" cy="48" r="0.7" fill="rgba(0,0,0,0.15)" />

        <path d="M 74 30 Q 78 42 74 52 Q 76 56 72 58"
              :stroke="palette.primary" stroke-width="3.6" fill="none" stroke-linecap="round" />
        <circle cx="76" cy="40" r="0.8" fill="rgba(0,0,0,0.15)" />
        <circle cx="75" cy="48" r="0.7" fill="rgba(0,0,0,0.15)" />
      </g>

      <!-- 大圆头 -->
      <path d="M 24 30 Q 24 6 50 6 Q 76 6 76 30 Q 76 36 50 36 Q 24 36 24 30 Z"
            :fill="palette.primary" stroke="rgba(0,0,0,0.15)" stroke-width="0.8" />
      <path d="M 24 30 Q 24 6 50 6 Q 76 6 76 30 Q 76 36 50 36 Q 24 36 24 30 Z"
            :fill="`url(#ocHead${uid})`" />

      <!-- 头顶高光 -->
      <ellipse cx="40" cy="12" rx="10" ry="3.5" fill="rgba(255,255,255,0.4)" />
      <ellipse cx="30" cy="18" rx="4" ry="6" fill="rgba(255,255,255,0.15)" />

      <!-- 墨汁粒子背景装饰 -->
      <circle cx="16" cy="18" r="1.5" :fill="palette.accent" opacity="0.5" />
      <circle cx="84" cy="18" r="1.5" :fill="palette.accent" opacity="0.5" />
      <circle cx="12" cy="26" r="1" :fill="palette.accent" opacity="0.4" />
      <circle cx="88" cy="26" r="1" :fill="palette.accent" opacity="0.4" />

      <!-- frame 2 额外喷出的墨汁 -->
      <template v-if="isJumping">
        <circle cx="10" cy="32" r="2" :fill="palette.accent" opacity="0.45" />
        <circle cx="90" cy="32" r="2" :fill="palette.accent" opacity="0.45" />
        <circle cx="8" cy="38" r="1.3" :fill="palette.accent" opacity="0.35" />
        <circle cx="92" cy="38" r="1.3" :fill="palette.accent" opacity="0.35" />
      </template>

      <!-- 眼睛 -->
      <template v-if="!isBlinking">
        <circle cx="40" cy="20" r="4" fill="rgba(255,255,255,0.95)" />
        <circle cx="60" cy="20" r="4" fill="rgba(255,255,255,0.95)" />
        <circle cx="40" cy="21" r="2.4" fill="rgba(0,0,0,0.85)" />
        <circle cx="60" cy="21" r="2.4" fill="rgba(0,0,0,0.85)" />
        <circle cx="41.5" cy="19.5" r="0.9" fill="rgba(255,255,255,0.9)" />
        <circle cx="61.5" cy="19.5" r="0.9" fill="rgba(255,255,255,0.9)" />
      </template>
      <template v-else>
        <path d="M 36 20 Q 40 16 44 20" stroke="rgba(0,0,0,0.85)" stroke-width="1.6" fill="none" stroke-linecap="round" />
        <path d="M 56 20 Q 60 16 64 20" stroke="rgba(0,0,0,0.85)" stroke-width="1.6" fill="none" stroke-linecap="round" />
      </template>

      <!-- 微笑 -->
      <path d="M 46 28 Q 50 31 54 28" stroke="rgba(0,0,0,0.6)" stroke-width="1" fill="none" stroke-linecap="round" />
    </g>

    <text v-if="isPetted" x="65" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>