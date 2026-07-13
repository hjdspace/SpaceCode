<!-- src/components/pets/sprites/TurtleSprite.vue -->
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

// 眨眼：frame 1 闭眼
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)

// 跳跃偏移：frame 2 上移 5px，被抚摸时上移 3px
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  return props.frame === 2 ? -5 : 0
})

// frame 2 头缩进：头向左缩 2px（受惊缩壳）
const headRetractX = computed(() => (props.frame === 2 && !props.isPetted) ? -2 : 0)
// frame 2 腿收：腿向上缩 1px
const legTuckY = computed(() => (props.frame === 2 && !props.isPetted) ? -1 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 壳立体感渐变 -->
      <radialGradient :id="`tlShellShade${uid}`" cx="40%" cy="28%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.5)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.35)" />
      </radialGradient>
      <!-- 头/腿立体感渐变 -->
      <radialGradient :id="`tlBodyShade${uid}`" cx="40%" cy="30%" r="70%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
        <stop offset="60%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.3)" />
      </radialGradient>
      <!-- 接地阴影模糊滤镜 -->
      <filter :id="`tlShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="48" cy="55" rx="26" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="`url(#tlShadow${uid})`" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 短钝尾巴（在壳左后方）-->
      <path d="M 24 33 L 16 30 L 24 36 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.6" />

      <!-- 4 条小短腿（frame 2 收缩）：前左/前右大，后左/后右小（透视）-->
      <ellipse cx="28" :cy="46 + legTuckY" rx="4" ry="2.6" :fill="palette.primary" />
      <ellipse cx="28" :cy="46 + legTuckY" rx="4" ry="2.6" :fill="`url(#tlBodyShade${uid})`" />
      <ellipse cx="64" :cy="46 + legTuckY" rx="4" ry="2.6" :fill="palette.primary" />
      <ellipse cx="64" :cy="46 + legTuckY" rx="4" ry="2.6" :fill="`url(#tlBodyShade${uid})`" />
      <!-- 后排两条腿（偏小、偏暗，营造透视）-->
      <ellipse cx="36" :cy="47 + legTuckY" rx="3.2" ry="2.2" :fill="palette.primary" opacity="0.85" />
      <ellipse cx="56" :cy="47 + legTuckY" rx="3.2" ry="2.2" :fill="palette.primary" opacity="0.85" />

      <!-- 龟壳（accent 棕色）-->
      <ellipse cx="45" cy="33" rx="23" ry="11.5" :fill="palette.accent" />
      <ellipse cx="45" cy="33" rx="23" ry="11.5" :fill="`url(#tlShellShade${uid})`" />
      <!-- 壳缘高光 -->
      <ellipse cx="40" cy="26" rx="14" ry="2.5" fill="rgba(255,255,255,0.4)" />

      <!-- 六边形龟甲花纹 -->
      <g stroke="rgba(0,0,0,0.35)" stroke-width="0.6" :fill="palette.accent" fill-opacity="0.5">
        <!-- 中央六边形 -->
        <path d="M 45 27 L 51 30 L 51 36 L 45 39 L 39 36 L 39 30 Z" />
        <!-- 左六边形 -->
        <path d="M 30 28 L 36 31 L 36 37 L 30 39 L 25 36 L 25 31 Z" />
        <!-- 右六边形 -->
        <path d="M 60 28 L 66 31 L 66 36 L 60 38 L 54 35 L 54 30 Z" />
      </g>

      <!-- 伸出的小头（frame 2 缩进）-->
      <g :transform="`translate(${headRetractX}, 0)`">
        <circle cx="76" cy="36" r="6" :fill="palette.primary" />
        <circle cx="76" cy="36" r="6" :fill="`url(#tlBodyShade${uid})`" />
        <!-- 头部高光 -->
        <ellipse cx="73" cy="33" rx="2.5" ry="1.2" fill="rgba(255,255,255,0.4)" />
        <!-- 眼睛 -->
        <template v-if="!isBlinking">
          <circle cx="78" cy="35" r="1.4" fill="rgba(255,255,255,0.92)" />
          <circle cx="78.4" cy="35.3" r="0.8" fill="rgba(0,0,0,0.85)" />
        </template>
        <template v-else>
          <!-- 眨眼弯月 -->
          <path d="M 76.5 35 Q 78 33.5 79.5 35" stroke="rgba(0,0,0,0.8)" stroke-width="1.1" fill="none" stroke-linecap="round" />
        </template>
        <!-- 嘴 -->
        <path d="M 80 38 Q 82 39 81 40.5" stroke="rgba(0,0,0,0.5)" stroke-width="0.7" fill="none" stroke-linecap="round" />
      </g>
    </g>

    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
