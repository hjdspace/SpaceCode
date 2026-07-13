<!-- src/components/pets/sprites/GooseSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 整体偏移：frame 2 上移表现跳跃；被抚摸时也轻微上浮
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  return props.frame === 2 ? -5 : 0
})

// 眯眼帧：强势性格不眨眼而是眯眼成线
const isSquinting = computed(() => props.frame === 1 && !props.isPetted)
// 吼叫帧：脖子前伸 + 张嘴
const isHonking = computed(() => props.frame === 2 && !props.isPetted)

// 脖子 path：frame 2 时前伸（更直更长，表现吼叫姿态）
const neckPath = computed(() => {
  if (isHonking.value) {
    return 'M 45 32 Q 52 24 60 18 Q 66 14 72 13 L 76 13 Q 74 17 68 21 Q 60 27 54 35 Z'
  }
  return 'M 45 32 Q 50 22 58 16 Q 64 12 70 11 L 74 11 Q 72 15 66 19 Q 58 25 52 33 Z'
})

// 下喙 path：frame 2 时下移张嘴吼叫
const beakBottomPath = computed(() => {
  if (isHonking.value) {
    return 'M 75 15 L 84 17 L 75 18 Z'
  }
  return 'M 75 14 L 84 15 L 75 16 Z'
})

// 翅膀旋转：frame 2 时展开（鹅激动时展翅）
const wingTransform = computed(() =>
  isHonking.value ? 'rotate(-12 28 38)' : 'rotate(0 28 38)'
)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体渐变：白色到浅灰，营造立体感 -->
      <radialGradient id="gooseShade" cx="40%" cy="30%" r="80%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.5)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.25)" />
      </radialGradient>
      <!-- 阴影模糊滤镜 -->
      <filter id="gooseShadow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="35" cy="55" rx="22" ry="2.5" fill="rgba(0,0,0,0.2)" filter="url(#gooseShadow)" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 脚蹼（橙色） -->
      <path d="M 26 49 Q 22 51 22 54 L 32 54 Q 32 51 30 49 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
      <path d="M 40 49 Q 36 51 36 54 L 46 54 Q 46 51 44 49 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
      <line x1="24" y1="52" x2="30" y2="52" stroke="rgba(0,0,0,0.3)" stroke-width="0.4" />
      <line x1="38" y1="52" x2="44" y2="52" stroke="rgba(0,0,0,0.3)" stroke-width="0.4" />

      <!-- 身体（鹅蛋形，偏左下） -->
      <ellipse cx="35" cy="42" rx="18" ry="11" :fill="palette.primary" />
      <ellipse cx="35" cy="42" rx="18" ry="11" fill="url(#gooseShade)" />

      <!-- 翅膀（frame 2 时展开旋转） -->
      <g :transform="wingTransform">
        <path d="M 28 36 Q 18 38 18 48 Q 25 46 32 42 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
        <path d="M 28 36 Q 18 38 18 48 Q 25 46 32 42 Z" fill="url(#gooseShade)" />
        <!-- 白色羽毛细节（弧线纹理） -->
        <path d="M 22 40 Q 24 42 24 45" stroke="rgba(0,0,0,0.18)" stroke-width="0.5" fill="none" />
        <path d="M 25 38 Q 27 40 27 43" stroke="rgba(0,0,0,0.18)" stroke-width="0.5" fill="none" />
        <path d="M 28 37 Q 30 39 30 42" stroke="rgba(0,0,0,0.18)" stroke-width="0.5" fill="none" />
      </g>

      <!-- 身体高光 -->
      <ellipse cx="28" cy="36" rx="6" ry="2" fill="rgba(255,255,255,0.5)" />
      <!-- 身体羽毛细节 -->
      <path d="M 30 45 Q 33 47 36 45" stroke="rgba(0,0,0,0.12)" stroke-width="0.5" fill="none" />
      <path d="M 35 48 Q 38 50 41 48" stroke="rgba(0,0,0,0.12)" stroke-width="0.5" fill="none" />

      <!-- 长曲脖子（S 形，frame 2 时前伸） -->
      <path :d="neckPath" :fill="palette.primary" stroke="rgba(0,0,0,0.15)" stroke-width="0.6" />
      <path :d="neckPath" fill="url(#gooseShade)" />

      <!-- 头部 -->
      <circle cx="70" cy="13" r="7" :fill="palette.primary" stroke="rgba(0,0,0,0.15)" stroke-width="0.6" />
      <circle cx="70" cy="13" r="7" fill="url(#gooseShade)" />
      <!-- 头部高光 -->
      <ellipse cx="67" cy="10" rx="2.5" ry="1.5" fill="rgba(255,255,255,0.5)" />

      <!-- 愤怒眉毛（强势性格，V 形下压中间） -->
      <path d="M 64 9 L 68 11" stroke="rgba(0,0,0,0.7)" stroke-width="1.2" stroke-linecap="round" />
      <path d="M 72 11 L 76 9" stroke="rgba(0,0,0,0.7)" stroke-width="1.2" stroke-linecap="round" />

      <!-- 眼睛：默认圆眼，frame 1 眯成一条线 -->
      <g v-if="!isSquinting">
        <circle cx="67" cy="13" r="1.5" fill="rgba(0,0,0,0.85)" />
        <circle cx="73" cy="13" r="1.5" fill="rgba(0,0,0,0.85)" />
        <circle cx="66.5" cy="12.5" r="0.4" fill="rgba(255,255,255,0.9)" />
        <circle cx="72.5" cy="12.5" r="0.4" fill="rgba(255,255,255,0.9)" />
      </g>
      <g v-else>
        <line x1="65.5" y1="13" x2="68.5" y2="13" stroke="rgba(0,0,0,0.85)" stroke-width="1.4" stroke-linecap="round" />
        <line x1="71.5" y1="13" x2="74.5" y2="13" stroke="rgba(0,0,0,0.85)" stroke-width="1.4" stroke-linecap="round" />
      </g>

      <!-- 黑色喙根（紧贴头部，强化鹅的特征） -->
      <path d="M 73 11 L 76 11 L 76 16 L 73 16 Z" fill="rgba(0,0,0,0.55)" />
      <!-- 橙色喙：上喙固定，下喙 frame 2 时下移张嘴吼叫 -->
      <path d="M 75 11 L 84 13 L 75 14 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.4" />
      <path :d="beakBottomPath" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.4" />
    </g>

    <!-- 抚摸爱心 -->
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
