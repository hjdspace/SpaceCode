<!-- src/components/pets/sprites/BlobSprite.vue -->
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
// frame 2 时果冻 Q 弹挤压成扁椭圆（body path 改变，非整体上移）
const isSquished = computed(() => props.frame === 2 && !props.isPetted)
// 跳跃偏移：frame 2 上移（挤压同时跳起），被抚摸时轻微上移
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  if (props.frame === 2) return -5
  return 0
})
// 根据 frame 选择身体 path：frame 2 时变宽变扁（Q 弹挤压）
const bodyPath = computed(() => {
  if (isSquished.value) {
    // 挤压态：更宽更扁（x 范围 18-82，y 范围 24-50）
    return 'M 18 42 Q 18 24 50 24 Q 82 24 82 42 Q 82 50 50 50 Q 18 50 18 42 Z'
  }
  // 默认态：圆润椭圆（x 范围 22-78，y 范围 18-50）
  return 'M 22 36 Q 22 18 50 18 Q 78 18 78 36 Q 78 50 50 50 Q 22 50 22 36 Z'
})
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体径向渐变：中心亮、边缘暗，营造果冻透明感 -->
      <radialGradient id="blobBodyGrad" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.55)" />
        <stop offset="50%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.3)" />
      </radialGradient>
      <!-- 内部气泡渐变（带高光感） -->
      <radialGradient id="blobBubbleGrad" cx="30%" cy="30%" r="80%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.7)" />
        <stop offset="60%" stop-color="rgba(255,255,255,0.15)" />
        <stop offset="100%" stop-color="rgba(255,255,255,0)" />
      </radialGradient>
      <!-- 接地阴影模糊 -->
      <filter id="blobShadowFilter" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
      <!-- 顶部高光柔化模糊 -->
      <filter id="blobHighlightGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="0.8" />
      </filter>
    </defs>

    <!-- 接地阴影（不随跳跃移动） -->
    <ellipse cx="50" cy="55" rx="28" ry="2.5" fill="rgba(0,0,0,0.22)" filter="url(#blobShadowFilter)" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 身体基础填充 -->
      <path :d="bodyPath" :fill="palette.primary" stroke="rgba(0,0,0,0.18)" stroke-width="0.6" />
      <!-- 身体渐变叠加（果冻质感） -->
      <path :d="bodyPath" fill="url(#blobBodyGrad)" />

      <!-- 内含小气泡（3 个不同大小，营造果冻内含物感） -->
      <circle cx="35" cy="30" r="2.4" fill="url(#blobBubbleGrad)" />
      <circle cx="64" cy="35" r="1.8" fill="url(#blobBubbleGrad)" />
      <circle cx="55" cy="24" r="1.3" fill="url(#blobBubbleGrad)" />

      <!-- 顶部高光（果冻反光感，两层叠加） -->
      <ellipse cx="38" cy="22" rx="11" ry="3.2" fill="rgba(255,255,255,0.4)" filter="url(#blobHighlightGlow)" />
      <ellipse cx="42" cy="20" rx="4.5" ry="1.6" fill="rgba(255,255,255,0.65)" />

      <!-- 眼睛（frame 1 时变为 ^^ 弯月闭眼） -->
      <template v-if="!isBlinking">
        <circle cx="42" cy="33" r="2" fill="#000" />
        <circle cx="58" cy="33" r="2" fill="#000" />
        <!-- 眼睛高光 -->
        <circle cx="42.8" cy="32.2" r="0.7" fill="rgba(255,255,255,0.95)" />
        <circle cx="58.8" cy="32.2" r="0.7" fill="rgba(255,255,255,0.95)" />
      </template>
      <template v-else>
        <!-- 眨眼：^^ 弯月闭眼 -->
        <path d="M 40 33 Q 42 31 44 33" stroke="#000"
              stroke-width="1.1" fill="none" stroke-linecap="round" />
        <path d="M 56 33 Q 58 31 60 33" stroke="#000"
              stroke-width="1.1" fill="none" stroke-linecap="round" />
      </template>

      <!-- 嘴（微笑，符合"随和灵活"性格） -->
      <path d="M 46 39 Q 50 42 54 39" stroke="#000"
            stroke-width="1" fill="none" stroke-linecap="round" />

      <!-- 腮红（使用 accent 粉色，符合"果冻感"可爱风） -->
      <ellipse cx="33" cy="38" rx="2.8" ry="1.9" :fill="palette.accent" opacity="0.65" />
      <ellipse cx="67" cy="38" rx="2.8" ry="1.9" :fill="palette.accent" opacity="0.65" />
    </g>

    <!-- 抚摸爱心（位置不可变） -->
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
