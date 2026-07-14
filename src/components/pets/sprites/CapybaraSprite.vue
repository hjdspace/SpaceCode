<!-- src/components/pets/sprites/CapybaraSprite.vue -->
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

// 禅意半闭眼路径：frame 1 时眯得更平（更闭），其余为温和上扬弧（满足眯眼）
const zenEyes = computed(() => {
  if (props.frame === 1 && !props.isPetted) {
    return {
      left: 'M 38 35.5 Q 41 34.5 44 35.5',
      right: 'M 56 35.5 Q 59 34.5 62 35.5',
    }
  }
  return {
    left: 'M 38 36 Q 41 33.5 44 36',
    right: 'M 56 36 Q 59 33.5 62 36',
  }
})

// 跳跃偏移：frame 2 上移 5px，被抚摸时上移 3px
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  return props.frame === 2 ? -5 : 0
})

// 柚子片 frame 2 摇晃
const yuzuRotate = computed(() => (props.frame === 2 && !props.isPetted) ? 8 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体感渐变 -->
      <radialGradient :id="`cbShade${uid}`" cx="38%" cy="30%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.45)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.32)" />
      </radialGradient>
      <!-- rare 发光描边滤镜 -->
      <filter :id="`cbGlow${uid}`" x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur stdDeviation="1.8" />
      </filter>
      <!-- 接地阴影模糊滤镜 -->
      <filter :id="`cbShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="30" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="`url(#cbShadow${uid})`" />

    <!-- rare 发光光环（身体后方模糊光环）-->
    <ellipse cx="50" cy="38" rx="33" ry="18" :fill="palette.accent" opacity="0.22" :filter="`url(#cbGlow${uid})`" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 四肢摊开坐姿（先画，在身体后）-->
      <ellipse cx="26" cy="48" rx="5" ry="3.5" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.7" />
      <ellipse cx="74" cy="48" rx="5" ry="3.5" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="0.7" />
      <ellipse cx="36" cy="50" rx="4.5" ry="3" :fill="palette.primary" opacity="0.9" />
      <ellipse cx="64" cy="50" rx="4.5" ry="3" :fill="palette.primary" opacity="0.9" />

      <!-- 身体（圆胖坐姿）-->
      <path d="M 22 40 Q 22 24 50 24 Q 78 24 78 40 Q 78 52 50 52 Q 22 52 22 40 Z" :fill="palette.primary" />
      <path d="M 22 40 Q 22 24 50 24 Q 78 24 78 40 Q 78 52 50 52 Q 22 52 22 40 Z" :fill="`url(#cbShade${uid})`" />
      <!-- 身体高光 -->
      <ellipse cx="42" cy="30" rx="9" ry="4" fill="rgba(255,255,255,0.35)" />

      <!-- 小圆耳 -->
      <circle cx="33" cy="24" r="4" :fill="palette.primary" stroke="rgba(0,0,0,0.12)" stroke-width="0.7" />
      <circle cx="33" cy="24" r="2" :fill="palette.accent" opacity="0.6" />
      <circle cx="67" cy="24" r="4" :fill="palette.primary" stroke="rgba(0,0,0,0.12)" stroke-width="0.7" />
      <circle cx="67" cy="24" r="2" :fill="palette.accent" opacity="0.6" />

      <!-- 半闭禅意眼（一直眯着）-->
      <path :d="zenEyes.left" stroke="rgba(0,0,0,0.8)" stroke-width="1.3" fill="none" stroke-linecap="round" />
      <path :d="zenEyes.right" stroke="rgba(0,0,0,0.8)" stroke-width="1.3" fill="none" stroke-linecap="round" />

      <!-- 方形钝鼻头 -->
      <rect x="46" y="38" width="8" height="5.5" rx="1.5" :fill="palette.accent" stroke="rgba(0,0,0,0.15)" stroke-width="0.6" />
      <!-- 鼻孔 -->
      <circle cx="48.5" cy="41" r="0.6" fill="rgba(0,0,0,0.55)" />
      <circle cx="51.5" cy="41" r="0.6" fill="rgba(0,0,0,0.55)" />

      <!-- 嘴（禅意微笑）-->
      <path d="M 47 45 Q 50 47 53 45" stroke="rgba(0,0,0,0.45)" stroke-width="0.9" fill="none" stroke-linecap="round" />

      <!-- 头顶柚子片（capybara 经典梗，frame 2 摇晃）-->
      <g :transform="`rotate(${yuzuRotate}, 50, 18)`">
        <!-- 柚子外圈 -->
        <circle cx="50" cy="18" r="4.5" fill="rgba(255,193,7,0.9)" stroke="rgba(255,152,0,0.85)" stroke-width="0.5" />
        <!-- 柚子瓣分隔线 -->
        <line x1="50" y1="13.5" x2="50" y2="22.5" stroke="rgba(255,152,0,0.8)" stroke-width="0.5" />
        <line x1="45.5" y1="18" x2="54.5" y2="18" stroke="rgba(255,152,0,0.8)" stroke-width="0.5" />
        <line x1="46.8" y1="14.8" x2="53.2" y2="21.2" stroke="rgba(255,152,0,0.7)" stroke-width="0.4" />
        <line x1="53.2" y1="14.8" x2="46.8" y2="21.2" stroke="rgba(255,152,0,0.7)" stroke-width="0.4" />
        <!-- 中心点 -->
        <circle cx="50" cy="18" r="0.8" fill="rgba(255,255,255,0.6)" />
      </g>
    </g>

    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
