<!-- src/components/pets/sprites/SnailSprite.vue -->
<!-- 稀有度：common —— 优化版：螺旋壳内旋层次、身体纹理、粘液拖痕更生动、触角球更大 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

const uid = Math.random().toString(36).slice(2, 8)

const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  return props.frame === 2 ? -5 : 0
})

// 触角纵向缩放 + 摆动
const stalkScale = computed(() => {
  if (props.frame === 1 && !props.isPetted) return 0.65
  if (props.frame === 2 && !props.isPetted) return 1.05
  return 1
})
const stalkRotate = computed(() => (props.frame === 2 && !props.isPetted) ? 8 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 壳立体渐变 -->
      <radialGradient :id="`snShell${uid}`" cx="36%" cy="28%" r="78%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.55)" />
        <stop offset="50%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.38)" />
      </radialGradient>
      <!-- 身体渐变 -->
      <radialGradient :id="`snBody${uid}`" cx="38%" cy="28%" r="78%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.45)" />
        <stop offset="60%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.3)" />
      </radialGradient>
      <filter :id="`snShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="54" rx="32" ry="2.5" fill="rgba(0,0,0,0.2)" :filter="`url(#snShadow${uid})`" />

    <!-- 粘液拖痕（从底部延伸到左侧外） -->
    <path d="M 12 53 Q 8 51 4 53 Q 0 55 -3 53" stroke="rgba(255,255,255,0.5)" stroke-width="1.8" fill="none" stroke-linecap="round" />
    <path d="M 14 53.5 Q 10 52 6 53.5 Q 2 55 -1 53.5" stroke="rgba(255,255,255,0.3)" stroke-width="1.2" fill="none" stroke-linecap="round" />
    <!-- 粘液闪光点 -->
    <circle cx="9" cy="53" r="0.6" fill="rgba(255,255,255,0.6)" />
    <circle cx="3" cy="54" r="0.4" fill="rgba(255,255,255,0.5)" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 身体 -- 柔软贴地的长条 -->
      <path d="M 16 49 Q 16 42 28 40 L 82 40 Q 90 42 90 49 Q 90 52 82 52 L 26 52 Q 16 52 16 49 Z"
            :fill="palette.primary" />
      <path d="M 16 49 Q 16 42 28 40 L 82 40 Q 90 42 90 49 Q 90 52 82 52 L 26 52 Q 16 52 16 49 Z"
            :fill="`url(#snBody${uid})`" />
      <!-- 身体高光条纹 -->
      <ellipse cx="38" cy="44" rx="16" ry="2.5" fill="rgba(255,255,255,0.3)" />
      <ellipse cx="70" cy="43" rx="8" ry="2" fill="rgba(255,255,255,0.2)" />

      <!-- 螺旋壳 -->
      <circle cx="42" cy="28" r="17" :fill="palette.accent" />
      <circle cx="42" cy="28" r="17" :fill="`url(#snShell${uid})`" />
      <!-- 螺旋纹理：从外到内 4 圈 -->
      <circle cx="42" cy="28" r="13" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1.1" />
      <circle cx="43" cy="29" r="9" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="0.9" />
      <circle cx="43.5" cy="29.5" r="5" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" />
      <circle cx="44" cy="30" r="2" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="0.7" />
      <circle cx="44.5" cy="30.5" r="0.8" fill="rgba(0,0,0,0.35)" />
      <!-- 壳高光 -->
      <ellipse cx="35" cy="20" rx="7" ry="3" fill="rgba(255,255,255,0.4)" />
      <ellipse cx="32" cy="18" rx="3" ry="1.5" fill="rgba(255,255,255,0.3)" />

      <!-- 两根触角（带圆眼球）-->
      <g :transform="`rotate(${stalkRotate}, 80, 40)`">
        <!-- 上触角 -->
        <g :transform="`translate(80, 40) scale(1, ${stalkScale}) translate(-80, -40)`">
          <path d="M 80 40 Q 81 30 83 20" :stroke="palette.primary" stroke-width="2.2" fill="none" stroke-linecap="round" />
          <circle cx="83" cy="19" r="3.2" :fill="palette.primary" />
          <ellipse cx="82" cy="18" rx="1" ry="0.8" fill="rgba(255,255,255,0.5)" />
          <!-- 眼睛 -->
          <template v-if="!isBlinking">
            <circle cx="83" cy="19" r="1.4" fill="rgba(0,0,0,0.85)" />
            <circle cx="83.5" cy="18.5" r="0.5" fill="rgba(255,255,255,0.9)" />
          </template>
          <template v-else>
            <path d="M 81.2 19 Q 83 17.8 84.8 19" stroke="rgba(0,0,0,0.8)" stroke-width="1.1" fill="none" stroke-linecap="round" />
          </template>
        </g>
        <!-- 下触角 -->
        <g :transform="`translate(86, 40) scale(1, ${stalkScale}) translate(-86, -40)`">
          <path d="M 86 40 Q 88 30 90 22" :stroke="palette.primary" stroke-width="2" fill="none" stroke-linecap="round" />
          <circle cx="90" cy="21" r="2.8" :fill="palette.primary" />
          <ellipse cx="89" cy="20" rx="0.8" ry="0.6" fill="rgba(255,255,255,0.5)" />
          <template v-if="!isBlinking">
            <circle cx="90" cy="21" r="1.2" fill="rgba(0,0,0,0.85)" />
            <circle cx="90.4" cy="20.6" r="0.4" fill="rgba(255,255,255,0.9)" />
          </template>
          <template v-else>
            <path d="M 88.4 21 Q 90 19.8 91.6 21" stroke="rgba(0,0,0,0.8)" stroke-width="1" fill="none" stroke-linecap="round" />
          </template>
        </g>
      </g>

      <!-- 微笑 -->
      <path d="M 76 48 Q 80 51 84 48" stroke="rgba(0,0,0,0.5)" stroke-width="1" fill="none" stroke-linecap="round" />
    </g>

    <text v-if="isPetted" x="40" y="12" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>