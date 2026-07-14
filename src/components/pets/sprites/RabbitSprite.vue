<!-- src/components/pets/sprites/RabbitSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 唯一 ID 后缀，避免多实例 SVG defs ID 冲突
const uid = Math.random().toString(36).slice(2, 8)

// 眨眼：frame 1 时弯月闭眼
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)

// 跳跃偏移：frame 2 上移 5px，被抚摸时上移 3px
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  return props.frame === 2 ? -5 : 0
})

// 右耳 frame 2 下垂（围绕耳根旋转）
const rightEarRotate = computed(() => (props.frame === 2 && !props.isPetted) ? 35 : 0)
// 左耳 frame 2 微微外撇
const leftEarRotate = computed(() => (props.frame === 2 && !props.isPetted) ? -8 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体感渐变 -->
      <radialGradient :id="`rbShade${uid}`" cx="38%" cy="32%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.45)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.3)" />
      </radialGradient>
      <!-- 接地阴影模糊滤镜 -->
      <filter :id="`rbShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="26" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="`url(#rbShadow${uid})`" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 蓬球尾 -->
      <circle cx="76" cy="40" r="4.5" :fill="palette.primary" />
      <circle cx="75" cy="38.5" r="2" fill="rgba(255,255,255,0.4)" />

      <!-- 左耳（直立，frame 2 微外撇）-->
      <g :transform="`rotate(${leftEarRotate}, 43, 22)`">
        <ellipse cx="43" cy="13" rx="3.6" ry="11" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
        <ellipse cx="43" cy="13" rx="1.7" ry="8" :fill="palette.accent" opacity="0.7" />
      </g>
      <!-- 右耳（frame 2 下垂）-->
      <g :transform="`rotate(${rightEarRotate}, 57, 22)`">
        <ellipse cx="57" cy="13" rx="3.6" ry="11" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
        <ellipse cx="57" cy="13" rx="1.7" ry="8" :fill="palette.accent" opacity="0.7" />
      </g>

      <!-- 强壮后腿 -->
      <ellipse cx="32" cy="47" rx="5.5" ry="3.5" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />
      <ellipse cx="68" cy="47" rx="5.5" ry="3.5" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.8" />

      <!-- 身体（圆球）-->
      <ellipse cx="50" cy="38" rx="22" ry="14" :fill="palette.primary" />
      <ellipse cx="50" cy="38" rx="22" ry="14" :fill="`url(#rbShade${uid})`" />
      <!-- 身体高光 -->
      <ellipse cx="44" cy="32" rx="8" ry="4" fill="rgba(255,255,255,0.35)" />

      <!-- 眼睛 -->
      <template v-if="!isBlinking">
        <!-- 圆眼 + 瞳孔 + 高光 -->
        <circle cx="44" cy="35" r="2.6" fill="rgba(255,255,255,0.92)" />
        <circle cx="56" cy="35" r="2.6" fill="rgba(255,255,255,0.92)" />
        <circle cx="44.5" cy="35.5" r="1.6" fill="rgba(0,0,0,0.85)" />
        <circle cx="56.5" cy="35.5" r="1.6" fill="rgba(0,0,0,0.85)" />
        <circle cx="45" cy="35" r="0.5" fill="rgba(255,255,255,0.9)" />
        <circle cx="57" cy="35" r="0.5" fill="rgba(255,255,255,0.9)" />
      </template>
      <template v-else>
        <!-- 眨眼弯月 ^^ -->
        <path d="M 41 35 Q 44 32.5 47 35" stroke="rgba(0,0,0,0.8)" stroke-width="1.3" fill="none" stroke-linecap="round" />
        <path d="M 53 35 Q 56 32.5 59 35" stroke="rgba(0,0,0,0.8)" stroke-width="1.3" fill="none" stroke-linecap="round" />
      </template>

      <!-- 粉鼻（小三角）-->
      <path d="M 48 40 L 52 40 L 50 42.5 Z" :fill="palette.accent" />
      <!-- 嘴线 -->
      <path d="M 50 42.5 L 50 44" stroke="rgba(0,0,0,0.5)" stroke-width="0.8" />
      <path d="M 50 44 Q 47 45.5 45 44.5" stroke="rgba(0,0,0,0.5)" stroke-width="0.8" fill="none" stroke-linecap="round" />
      <path d="M 50 44 Q 53 45.5 55 44.5" stroke="rgba(0,0,0,0.5)" stroke-width="0.8" fill="none" stroke-linecap="round" />

      <!-- 大门牙（两颗）-->
      <rect x="47.5" y="44.5" width="2.2" height="3" rx="0.5" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.2)" stroke-width="0.3" />
      <rect x="50.3" y="44.5" width="2.2" height="3" rx="0.5" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.2)" stroke-width="0.3" />
    </g>

    <text v-if="isPetted" x="80" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
