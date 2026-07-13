<!-- src/components/pets/sprites/MushroomSprite.vue -->
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
// 菌帽倾斜角度（frame 2 时轻微摆动，模拟"果体抖动"）
const capRotation = computed(() => (props.frame === 2 ? 5 : 0))
// 帽子旋转中心 (50, 32)（帽下沿中心）
const capTransform = computed(() => `rotate(${capRotation.value} 50 32)`)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 菌帽径向渐变：模拟圆顶光影 -->
      <radialGradient id="mushroomCapGrad" cx="35%" cy="25%" r="80%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.45)" />
        <stop offset="50%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.4)" />
      </radialGradient>
      <!-- 菌柄线性渐变：模拟圆柱体光影 -->
      <linearGradient id="mushroomStemGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(0,0,0,0.2)" />
        <stop offset="35%" stop-color="rgba(255,255,255,0)" />
        <stop offset="65%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.25)" />
      </linearGradient>
      <!-- 接地阴影模糊 -->
      <filter id="mushroomShadowFilter" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
    </defs>

    <!-- 接地阴影（不随跳跃移动） -->
    <ellipse cx="50" cy="55" rx="28" ry="2.5" fill="rgba(0,0,0,0.22)" filter="url(#mushroomShadowFilter)" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 地面装饰：小草剪影（用中性色，不引入第三种调色板外颜色） -->
      <path d="M 22 53 Q 24 50 26 53" stroke="rgba(0,0,0,0.35)" stroke-width="0.8" fill="none" />
      <path d="M 74 53 Q 76 50 78 53" stroke="rgba(0,0,0,0.35)" stroke-width="0.8" fill="none" />
      <circle cx="20" cy="53" r="0.9" fill="rgba(0,0,0,0.25)" />
      <circle cx="80" cy="53" r="0.9" fill="rgba(0,0,0,0.25)" />

      <!-- 菌柄（白色圆柱） -->
      <path d="M 32 50 L 32 38 Q 32 35 35 35 L 65 35 Q 68 35 68 38 L 68 50 Z"
            :fill="palette.accent" stroke="rgba(0,0,0,0.2)" stroke-width="0.6" />
      <!-- 菌柄渐变叠加（柱体光影） -->
      <path d="M 32 50 L 32 38 Q 32 35 35 35 L 65 35 Q 68 35 68 38 L 68 50 Z"
            fill="url(#mushroomStemGrad)" />

      <!-- 菌褶（帽下平行线，3 条由深到浅） -->
      <line x1="22" y1="34" x2="78" y2="34" stroke="rgba(0,0,0,0.35)" stroke-width="0.6" />
      <line x1="26" y1="33" x2="74" y2="33" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
      <line x1="30" y1="32" x2="70" y2="32" stroke="rgba(0,0,0,0.18)" stroke-width="0.4" />

      <!-- 圆帽（可旋转摆动） -->
      <g :transform="capTransform">
        <!-- 帽基础填充 -->
        <path d="M 15 32 Q 15 8 50 8 Q 85 8 85 32 Q 50 36 15 32 Z"
              :fill="palette.primary" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" />
        <!-- 帽立体渐变叠加 -->
        <path d="M 15 32 Q 15 8 50 8 Q 85 8 85 32 Q 50 36 15 32 Z"
              fill="url(#mushroomCapGrad)" />

        <!-- 白色斑点（7 个不同大小，营造自然分布） -->
        <ellipse cx="32" cy="20" rx="3.5" ry="2.8" :fill="palette.accent" />
        <ellipse cx="50" cy="13" rx="4" ry="3.2" :fill="palette.accent" />
        <ellipse cx="68" cy="20" rx="3.5" ry="2.8" :fill="palette.accent" />
        <ellipse cx="42" cy="26" rx="2.5" ry="2" :fill="palette.accent" />
        <ellipse cx="60" cy="26" rx="2.5" ry="2" :fill="palette.accent" />
        <ellipse cx="24" cy="28" rx="2" ry="1.6" :fill="palette.accent" />
        <ellipse cx="76" cy="28" rx="2" ry="1.6" :fill="palette.accent" />

        <!-- 帽顶高光（半透明白色椭圆，强化圆顶反光感） -->
        <ellipse cx="42" cy="12" rx="7" ry="2.2" fill="rgba(255,255,255,0.4)" />
        <ellipse cx="44" cy="11" rx="3" ry="1" fill="rgba(255,255,255,0.55)" />
      </g>

      <!-- 眼睛（frame 1 时变为 ^^ 弯月闭眼） -->
      <template v-if="!isBlinking">
        <circle cx="42" cy="42" r="1.9" fill="#000" />
        <circle cx="58" cy="42" r="1.9" fill="#000" />
        <!-- 眼睛高光 -->
        <circle cx="42.7" cy="41.3" r="0.7" fill="rgba(255,255,255,0.95)" />
        <circle cx="58.7" cy="41.3" r="0.7" fill="rgba(255,255,255,0.95)" />
      </template>
      <template v-else>
        <!-- 眨眼：^^ 弯月闭眼 -->
        <path d="M 40 42 Q 42 40.5 44 42" stroke="#000"
              stroke-width="1" fill="none" stroke-linecap="round" />
        <path d="M 56 42 Q 58 40.5 60 42" stroke="#000"
              stroke-width="1" fill="none" stroke-linecap="round" />
      </template>

      <!-- 嘴（微笑，符合"安静洞察"性格——嘴角微微上扬） -->
      <path d="M 47 46 Q 50 48 53 46" stroke="#000"
            stroke-width="0.9" fill="none" stroke-linecap="round" />

      <!-- 腮红（使用 primary 红色） -->
      <circle cx="38" cy="45" r="1.5" :fill="palette.primary" opacity="0.35" />
      <circle cx="62" cy="45" r="1.5" :fill="palette.primary" opacity="0.35" />
    </g>

    <!-- 抚摸爱心（位置不可变） -->
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
