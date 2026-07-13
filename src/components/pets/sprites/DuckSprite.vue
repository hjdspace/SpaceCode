<!-- src/components/pets/sprites/DuckSprite.vue -->
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
  return props.frame === 2 ? -6 : 0
})

// 眨眼帧：frame 1 且未被抚摸
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
// 跳跃帧：frame 2 且未被抚摸
const isJumping = computed(() => props.frame === 2 && !props.isPetted)

// 翅膀旋转：frame 2 时扇动
const leftWingTransform = computed(() =>
  isJumping.value ? 'rotate(-18 30 38)' : 'rotate(0 30 38)'
)
const rightWingTransform = computed(() =>
  isJumping.value ? 'rotate(18 70 38)' : 'rotate(0 70 38)'
)

// 下喙 path：frame 2 时下移张嘴
const beakBottomPath = computed(() => {
  if (isJumping.value) {
    return 'M 41 30 Q 50 33 59 30 L 59 33 Q 50 35 41 33 Z'
  }
  return 'M 41 29 Q 50 30 59 29 L 59 31 Q 50 31 41 31 Z'
})

// 脚蹼偏移：frame 2 时随身体抬起
const feetTransform = computed(() =>
  isJumping.value ? 'translate(0, -3)' : 'translate(0, 0)'
)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体渐变：中心亮，边缘暗，营造圆润感 -->
      <radialGradient id="duckShade" cx="45%" cy="30%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.28)" />
      </radialGradient>
      <!-- 阴影模糊滤镜 -->
      <filter id="duckShadow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="28" ry="2.5" fill="rgba(0,0,0,0.2)" filter="url(#duckShadow)" />
    <!-- 水波纹底座：鸭子是水禽，用波纹强化物种特征 -->
    <path d="M 22 55 Q 26 53 30 55 T 38 55 T 46 55 T 54 55 T 62 55 T 70 55 T 78 55"
          stroke="rgba(0,0,0,0.18)" stroke-width="0.7" fill="none" stroke-linecap="round" />
    <path d="M 26 58 Q 30 56 34 58 T 42 58 T 50 58 T 58 58 T 66 58 T 74 58"
          stroke="rgba(0,0,0,0.12)" stroke-width="0.6" fill="none" stroke-linecap="round" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 脚蹼（橙色，frame 2 时随跳跃抬起） -->
      <g :transform="feetTransform">
        <path d="M 40 49 Q 35 51 34 54 L 46 54 Q 46 51 44 49 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
        <path d="M 60 49 Q 65 51 66 54 L 54 54 Q 54 51 56 49 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
        <!-- 脚蹼纹理 -->
        <line x1="37" y1="52" x2="44" y2="52" stroke="rgba(0,0,0,0.3)" stroke-width="0.4" />
        <line x1="56" y1="52" x2="63" y2="52" stroke="rgba(0,0,0,0.3)" stroke-width="0.4" />
      </g>

      <!-- 身体（鸭蛋形）底色 + 立体渐变叠加 -->
      <path d="M 26 40 Q 26 28 50 28 Q 74 28 74 40 Q 74 52 50 52 Q 26 52 26 40 Z" :fill="palette.primary" />
      <path d="M 26 40 Q 26 28 50 28 Q 74 28 74 40 Q 74 52 50 52 Q 26 52 26 40 Z" fill="url(#duckShade)" />

      <!-- 左翅膀（frame 2 时扇动旋转） -->
      <g :transform="leftWingTransform">
        <path d="M 30 35 Q 22 38 23 46 Q 28 44 33 40 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
        <path d="M 30 35 Q 22 38 23 46 Q 28 44 33 40 Z" fill="url(#duckShade)" />
      </g>
      <!-- 右翅膀 -->
      <g :transform="rightWingTransform">
        <path d="M 70 35 Q 78 38 77 46 Q 72 44 67 40 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.2)" stroke-width="0.8" />
        <path d="M 70 35 Q 78 38 77 46 Q 72 44 67 40 Z" fill="url(#duckShade)" />
      </g>

      <!-- 身体高光（半透明白椭圆） -->
      <ellipse cx="42" cy="34" rx="7" ry="2.5" fill="rgba(255,255,255,0.45)" />

      <!-- 颈部连接（头身过渡） -->
      <path d="M 44 28 Q 43 31 42 34 L 58 34 Q 57 31 56 28 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.15)" stroke-width="0.6" />

      <!-- 头部 -->
      <circle cx="50" cy="20" r="11" :fill="palette.primary" stroke="rgba(0,0,0,0.15)" stroke-width="0.6" />
      <circle cx="50" cy="20" r="11" fill="url(#duckShade)" />

      <!-- 头部反光（accent 色，类似绿头鸭绿头反光，用橙色调保持配色一致） -->
      <path d="M 41 14 Q 50 9 59 14" :stroke="palette.accent" stroke-width="2" fill="none" opacity="0.7" stroke-linecap="round" />
      <path d="M 43 16 Q 50 12 57 16" :stroke="palette.accent" stroke-width="1" fill="none" opacity="0.45" stroke-linecap="round" />

      <!-- 头部高光 -->
      <ellipse cx="45" cy="15" rx="3.5" ry="2" fill="rgba(255,255,255,0.5)" />

      <!-- 眼睛：默认圆眼，frame 1 变弯月闭眼 ^^ -->
      <g v-if="!isBlinking">
        <circle cx="44" cy="19" r="2.5" fill="rgba(0,0,0,0.85)" />
        <circle cx="56" cy="19" r="2.5" fill="rgba(0,0,0,0.85)" />
        <circle cx="43" cy="18" r="0.7" fill="rgba(255,255,255,0.9)" />
        <circle cx="55" cy="18" r="0.7" fill="rgba(255,255,255,0.9)" />
      </g>
      <g v-else>
        <path d="M 41 19 Q 44 17 47 19" stroke="rgba(0,0,0,0.85)" stroke-width="1.6" fill="none" stroke-linecap="round" />
        <path d="M 53 19 Q 56 17 59 19" stroke="rgba(0,0,0,0.85)" stroke-width="1.6" fill="none" stroke-linecap="round" />
      </g>

      <!-- 扁平橙色喙：上喙固定，下喙 frame 2 时下移张嘴 -->
      <path d="M 41 26 Q 50 24 59 26 L 59 28 Q 50 27 41 28 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
      <path :d="beakBottomPath" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
      <!-- 喙的鼻孔细节 -->
      <circle cx="47" cy="26.5" r="0.4" fill="rgba(0,0,0,0.4)" />
      <circle cx="53" cy="26.5" r="0.4" fill="rgba(0,0,0,0.4)" />
    </g>

    <!-- 抚摸爱心 -->
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
