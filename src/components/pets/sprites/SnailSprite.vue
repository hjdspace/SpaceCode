<!-- src/components/pets/sprites/SnailSprite.vue -->
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

// 眨眼：frame 1 时触角收缩、眼睛闭合
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)

// 跳跃偏移：frame 2 上移 5px，被抚摸时上移 3px
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  return props.frame === 2 ? -5 : 0
})

// 触角纵向缩放：frame 1 收缩变短（0.7），frame 2 伸长（1.05）
const stalkScale = computed(() => {
  if (props.frame === 1 && !props.isPetted) return 0.7
  if (props.frame === 2 && !props.isPetted) return 1.05
  return 1
})
// frame 2 触角整体轻微摆动（围绕触角根部旋转）
const stalkRotate = computed(() => (props.frame === 2 && !props.isPetted) ? 6 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 螺旋壳立体感渐变 -->
      <radialGradient :id="`snShellShade${uid}`" cx="38%" cy="30%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.5)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.35)" />
      </radialGradient>
      <!-- 身体立体感渐变 -->
      <radialGradient :id="`snBodyShade${uid}`" cx="40%" cy="30%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
        <stop offset="60%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.3)" />
      </radialGradient>
      <!-- 接地阴影模糊滤镜 -->
      <filter :id="`snShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="54" rx="30" ry="2.5" fill="rgba(0,0,0,0.22)" :filter="`url(#snShadow${uid})`" />

    <!-- slime 痕迹（地面波浪线，在蜗牛身后）-->
    <path d="M 14 53 Q 11 51 7 53 Q 3 55 0 53" stroke="rgba(255,255,255,0.5)" stroke-width="1.6" fill="none" stroke-linecap="round" />
    <path d="M 16 53.5 Q 13 52 10 53.5" stroke="rgba(255,255,255,0.3)" stroke-width="1" fill="none" stroke-linecap="round" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 身体（贴地的柔软长条）-->
      <path d="M 18 49 Q 18 43 28 42 L 80 42 Q 88 43 88 49 Q 88 52 80 52 L 26 52 Q 18 52 18 49 Z" :fill="palette.primary" />
      <path d="M 18 49 Q 18 43 28 42 L 80 42 Q 88 43 88 49 Q 88 52 80 52 L 26 52 Q 18 52 18 49 Z" :fill="`url(#snBodyShade${uid})`" />
      <!-- 身体高光 -->
      <ellipse cx="40" cy="45" rx="14" ry="2" fill="rgba(255,255,255,0.35)" />

      <!-- 螺旋蜗牛壳 -->
      <circle cx="42" cy="30" r="15" :fill="palette.accent" />
      <circle cx="42" cy="30" r="15" :fill="`url(#snShellShade${uid})`" />
      <!-- 螺旋纹路（同心圆弧模拟螺旋）-->
      <circle cx="42" cy="30" r="11" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1" />
      <circle cx="43" cy="31" r="7" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="0.9" />
      <circle cx="43.5" cy="31.5" r="3.5" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" />
      <circle cx="44" cy="32" r="1.2" fill="rgba(0,0,0,0.35)" />
      <!-- 壳高光 -->
      <ellipse cx="37" cy="23" rx="6" ry="2" fill="rgba(255,255,255,0.45)" />

      <!-- 两根触角（带顶端圆球，frame 2 摆动）-->
      <g :transform="`rotate(${stalkRotate}, 78, 42)`">
        <!-- 上触角（frame 1 纵向收缩）-->
        <g :transform="`translate(78, 42) scale(1, ${stalkScale}) translate(-78, -42)`">
          <path d="M 78 42 Q 79 33 81 24" :stroke="palette.primary" stroke-width="1.8" fill="none" stroke-linecap="round" />
          <circle cx="81" cy="23" r="2.6" :fill="palette.primary" />
          <ellipse cx="80.2" cy="22.3" rx="0.8" ry="0.6" fill="rgba(255,255,255,0.5)" />
          <!-- 眼睛/触角顶端 -->
          <template v-if="!isBlinking">
            <circle cx="81" cy="23" r="1.1" fill="rgba(0,0,0,0.85)" />
            <circle cx="81.3" cy="22.6" r="0.4" fill="rgba(255,255,255,0.9)" />
          </template>
          <template v-else>
            <!-- 眨眼弯月 -->
            <path d="M 79.6 23 Q 81 21.6 82.4 23" stroke="rgba(0,0,0,0.8)" stroke-width="1" fill="none" stroke-linecap="round" />
          </template>
        </g>
        <!-- 下触角 -->
        <g :transform="`translate(84, 42) scale(1, ${stalkScale}) translate(-84, -42)`">
          <path d="M 84 42 Q 86 33 88 23" :stroke="palette.primary" stroke-width="1.8" fill="none" stroke-linecap="round" />
          <circle cx="88" cy="22" r="2.4" :fill="palette.primary" />
          <ellipse cx="87.3" cy="21.4" rx="0.7" ry="0.5" fill="rgba(255,255,255,0.5)" />
          <template v-if="!isBlinking">
            <circle cx="88" cy="22" r="1" fill="rgba(0,0,0,0.85)" />
            <circle cx="88.3" cy="21.6" r="0.35" fill="rgba(255,255,255,0.9)" />
          </template>
          <template v-else>
            <path d="M 86.8 22 Q 88 20.8 89.2 22" stroke="rgba(0,0,0,0.8)" stroke-width="1" fill="none" stroke-linecap="round" />
          </template>
        </g>
      </g>

      <!-- 微笑（在身体前端）-->
      <path d="M 76 49 Q 80 51 84 49" stroke="rgba(0,0,0,0.5)" stroke-width="0.9" fill="none" stroke-linecap="round" />
    </g>

    <text v-if="isPetted" x="40" y="12" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
