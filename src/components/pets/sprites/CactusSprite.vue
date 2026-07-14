<!-- src/components/pets/sprites/CactusSprite.vue -->
<!-- 稀有度：common —— 基础渐变 + 阴影 + 高光 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 是否眨眼（frame 1 切换为 ^^ 弯月闭眼）
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
// 跳跃偏移：frame 2 上移，被抚摸时轻微上移
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  if (props.frame === 2) return -5
  return 0
})
// 顶部小花摆动角度（frame 2 时左右摇曳）
const flowerRotation = computed(() => (props.frame === 2 ? 14 : 0))
// 花朵旋转中心 (50, 9)
const flowerTransform = computed(() => `rotate(${flowerRotation.value} 50 9)`)

// 防止多实例 SVG id 冲突
const uid = Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体径向渐变：模拟柱体光影 -->
      <radialGradient :id="'cactusBodyGrad-' + uid" cx="35%" cy="40%" r="80%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
        <stop offset="50%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.35)" />
      </radialGradient>
      <!-- 接地阴影模糊 -->
      <filter :id="'cactusShadowFilter-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
      <!-- 花朵光晕 -->
      <filter :id="'cactusFlowerGlow-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="0.8" />
      </filter>
    </defs>

    <!-- 接地阴影（不随跳跃移动） -->
    <ellipse cx="50" cy="55" rx="28" ry="2.5" fill="rgba(0,0,0,0.22)" :filter="'url(#cactusShadowFilter-' + uid + ')'" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 沙土基座（用中性色营造土丘感，不引入第三种调色板外颜色） -->
      <ellipse cx="50" cy="52" rx="24" ry="3" fill="rgba(0,0,0,0.2)" />
      <ellipse cx="50" cy="51" rx="20" ry="1.6" fill="rgba(255,255,255,0.18)" />

      <!-- 左臂（带渐变） -->
      <path d="M 40 32 Q 30 32 28 38 L 28 50 L 34 50 L 34 38 Q 36 36 40 36 Z"
            :fill="palette.primary" stroke="rgba(0,0,0,0.25)" stroke-width="0.6" />
      <path d="M 40 32 Q 30 32 28 38 L 28 50 L 34 50 L 34 38 Q 36 36 40 36 Z"
            :fill="'url(#cactusBodyGrad-' + uid + ')'" />
      <!-- 右臂（带渐变） -->
      <path d="M 60 27 Q 70 27 72 33 L 72 50 L 66 50 L 66 33 Q 64 31 60 31 Z"
            :fill="palette.primary" stroke="rgba(0,0,0,0.25)" stroke-width="0.6" />
      <path d="M 60 27 Q 70 27 72 33 L 72 50 L 66 50 L 66 33 Q 64 31 60 31 Z"
            :fill="'url(#cactusBodyGrad-' + uid + ')'" />

      <!-- 主体（柱状仙人掌） -->
      <path d="M 40 50 L 40 18 Q 40 10 50 10 Q 60 10 60 18 L 60 50 Z"
            :fill="palette.primary" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" />
      <path d="M 40 50 L 40 18 Q 40 10 50 10 Q 60 10 60 18 L 60 50 Z"
            :fill="'url(#cactusBodyGrad-' + uid + ')'" />

      <!-- 竖向棱条（4 条线模拟 5 条棱凸起，明暗交替增强立体感） -->
      <line x1="44" y1="14" x2="44" y2="48" stroke="rgba(0,0,0,0.22)" stroke-width="0.7" />
      <line x1="48" y1="12" x2="48" y2="48" stroke="rgba(255,255,255,0.3)" stroke-width="0.6" />
      <line x1="52" y1="12" x2="52" y2="48" stroke="rgba(0,0,0,0.22)" stroke-width="0.7" />
      <line x1="56" y1="14" x2="56" y2="48" stroke="rgba(255,255,255,0.25)" stroke-width="0.6" />

      <!-- 针刺（小三角形围绕身体左右两侧） -->
      <polygon points="42,18 40.5,15 43.5,17" fill="rgba(255,255,255,0.9)" />
      <polygon points="58,18 56.5,17 59.5,15" fill="rgba(255,255,255,0.9)" />
      <polygon points="40,25 37,23 40,21" fill="rgba(255,255,255,0.9)" />
      <polygon points="60,25 60,21 63,23" fill="rgba(255,255,255,0.9)" />
      <polygon points="40,33 37,31 40,29" fill="rgba(255,255,255,0.9)" />
      <polygon points="60,33 60,29 63,31" fill="rgba(255,255,255,0.9)" />
      <polygon points="40,41 37,39 40,37" fill="rgba(255,255,255,0.9)" />
      <polygon points="60,41 60,37 63,39" fill="rgba(255,255,255,0.9)" />

      <!-- 顶部小花（frame 2 时绕中心点摆动） -->
      <g :transform="flowerTransform">
        <!-- 花瓣光晕 -->
        <circle cx="50" cy="9" r="4" :fill="palette.accent" opacity="0.35" :filter="'url(#cactusFlowerGlow-' + uid + ')'" />
        <!-- 花瓣（4 片） -->
        <circle cx="50" cy="10" r="3" :fill="palette.accent" />
        <circle cx="46" cy="9" r="2.5" :fill="palette.accent" opacity="0.85" />
        <circle cx="54" cy="9" r="2.5" :fill="palette.accent" opacity="0.85" />
        <circle cx="50" cy="6" r="2.5" :fill="palette.accent" opacity="0.85" />
        <!-- 花心（白色高光点） -->
        <circle cx="50" cy="9" r="1.3" fill="rgba(255,255,255,0.95)" />
      </g>

      <!-- 眼睛（frame 1 时变为 ^^ 弯月闭眼） -->
      <template v-if="!isBlinking">
        <circle cx="46" cy="28" r="1.8" fill="#000" />
        <circle cx="54" cy="28" r="1.8" fill="#000" />
        <!-- 眼睛高光 -->
        <circle cx="46.6" cy="27.4" r="0.6" fill="rgba(255,255,255,0.95)" />
        <circle cx="54.6" cy="27.4" r="0.6" fill="rgba(255,255,255,0.95)" />
      </template>
      <template v-else>
        <!-- 眨眼：^^ 弯月闭眼 -->
        <path d="M 44.5 28 Q 46 26.5 47.5 28" stroke="#000"
              stroke-width="1" fill="none" stroke-linecap="round" />
        <path d="M 52.5 28 Q 54 26.5 55.5 28" stroke="#000"
              stroke-width="1" fill="none" stroke-linecap="round" />
      </template>

      <!-- 嘴（微笑，符合"带刺善良"性格） -->
      <path d="M 47 33 Q 50 35 53 33" stroke="#000"
            stroke-width="0.9" fill="none" stroke-linecap="round" />

      <!-- 腮红（使用 accent 红色） -->
      <circle cx="42" cy="32" r="1.3" :fill="palette.accent" opacity="0.4" />
      <circle cx="58" cy="32" r="1.3" :fill="palette.accent" opacity="0.4" />
    </g>

    <!-- 抚摸爱心（位置不可变） -->
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
