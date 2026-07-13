<!-- src/components/pets/sprites/CatSprite.vue -->
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

// 眨眼：frame 1 时眼睛闭合成弯月（^^），其余为圆眼带竖立瞳孔
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)

// 整体跳跃：frame 2 上移 5px，被抚摸时上移 3px
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  return props.frame === 2 ? -5 : 0
})

// 尾巴摆动：frame 2 时尾巴向右甩 15°
const tailRotate = computed(() => (props.frame === 2 && !props.isPetted) ? 15 : 0)

// 左耳抖动：frame 2 时左耳微微上抬
const earTwitchY = computed(() => (props.frame === 2 && !props.isPetted) ? -1.5 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体感渐变：左上高光（白叠加）→ 右下阴影（黑叠加）-->
      <radialGradient :id="`catShade${uid}`" cx="38%" cy="30%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.45)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.32)" />
      </radialGradient>
      <!-- 接地阴影模糊滤镜 -->
      <filter :id="`catShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="28" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="`url(#catShadow${uid})`" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 尾巴（在身体后方，frame 2 摆动）-->
      <path
        d="M 72 44 Q 84 40 87 32 Q 89 25 84 23"
        :stroke="palette.primary"
        stroke-width="4.5"
        stroke-linecap="round"
        fill="none"
        :transform="`rotate(${tailRotate}, 72, 44)`"
      />

      <!-- 左耳（frame 2 微抖）-->
      <g :transform="`translate(0, ${earTwitchY})`">
        <path d="M 30 26 L 34 11 L 42 24 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.12)" stroke-width="0.8" />
        <path d="M 32 24 L 34 16 L 40 23 Z" :fill="palette.accent" opacity="0.75" />
      </g>
      <!-- 右耳 -->
      <path d="M 70 26 L 66 11 L 58 24 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.12)" stroke-width="0.8" />
      <path d="M 68 24 L 66 16 L 60 23 Z" :fill="palette.accent" opacity="0.75" />

      <!-- 身体 -->
      <path d="M 28 40 Q 28 24 50 24 Q 72 24 72 40 Q 72 50 50 50 Q 28 50 28 40 Z" :fill="palette.primary" />
      <!-- 身体立体感叠加 -->
      <path d="M 28 40 Q 28 24 50 24 Q 72 24 72 40 Q 72 50 50 50 Q 28 50 28 40 Z" :fill="`url(#catShade${uid})`" />
      <!-- 身体高光 -->
      <ellipse cx="42" cy="30" rx="8" ry="3.5" fill="rgba(255,255,255,0.35)" />

      <!-- 胡须（左右各 3 根）-->
      <g stroke="rgba(0,0,0,0.45)" stroke-width="0.7" stroke-linecap="round">
        <line x1="30" y1="37" x2="20" y2="35" />
        <line x1="30" y1="40" x2="18" y2="40" />
        <line x1="30" y1="43" x2="20" y2="45" />
        <line x1="70" y1="37" x2="80" y2="35" />
        <line x1="70" y1="40" x2="82" y2="40" />
        <line x1="70" y1="43" x2="80" y2="45" />
      </g>

      <!-- 眼睛 -->
      <template v-if="!isBlinking">
        <!-- 圆眼白底 + 竖立瞳孔 -->
        <ellipse cx="42" cy="34" rx="3" ry="4" fill="rgba(255,255,255,0.92)" />
        <ellipse cx="58" cy="34" rx="3" ry="4" fill="rgba(255,255,255,0.92)" />
        <ellipse cx="42" cy="34" rx="1" ry="3.4" fill="rgba(0,0,0,0.85)" />
        <ellipse cx="58" cy="34" rx="1" ry="3.4" fill="rgba(0,0,0,0.85)" />
        <!-- 瞳孔高光 -->
        <circle cx="42.6" cy="32.8" r="0.5" fill="rgba(255,255,255,0.9)" />
        <circle cx="58.6" cy="32.8" r="0.5" fill="rgba(255,255,255,0.9)" />
      </template>
      <template v-else>
        <!-- 眨眼弯月 ^^ -->
        <path d="M 39 34 Q 42 31 45 34" stroke="rgba(0,0,0,0.8)" stroke-width="1.3" fill="none" stroke-linecap="round" />
        <path d="M 55 34 Q 58 31 61 34" stroke="rgba(0,0,0,0.8)" stroke-width="1.3" fill="none" stroke-linecap="round" />
      </template>

      <!-- 椭圆粉鼻 -->
      <ellipse cx="50" cy="39.5" rx="2.2" ry="1.6" :fill="palette.accent" />
      <!-- 鼻下嘴线 -->
      <path d="M 50 41 L 50 43" stroke="rgba(0,0,0,0.5)" stroke-width="0.8" />
      <path d="M 50 43 Q 47 45 45 43.5" stroke="rgba(0,0,0,0.5)" stroke-width="0.8" fill="none" stroke-linecap="round" />
      <path d="M 50 43 Q 53 45 55 43.5" stroke="rgba(0,0,0,0.5)" stroke-width="0.8" fill="none" stroke-linecap="round" />
    </g>

    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
