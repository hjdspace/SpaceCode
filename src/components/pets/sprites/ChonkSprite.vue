<!-- src/components/pets/sprites/ChonkSprite.vue -->
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

// 满足眯眯眼：frame 1 时更眯（弧度更平）
const eyePath = computed(() => {
  if (props.frame === 1 && !props.isPetted) {
    return {
      left: 'M 44 22 Q 47 21 50 22',
      right: 'M 50 22 Q 53 21 56 22',
    }
  }
  return {
    left: 'M 44 22 Q 47 20 50 22',
    right: 'M 50 22 Q 53 20 56 22',
  }
})

// 跳跃偏移：frame 2 上移 5px，被抚摸时上移 3px
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  return props.frame === 2 ? -5 : 0
})

// 短粗尾巴 frame 2 摆动
const tailRotate = computed(() => (props.frame === 2 && !props.isPetted) ? 20 : 0)

// 金色星星 frame 2 闪烁偏移（上下浮动）
const starOffset = computed(() => (props.frame === 2 && !props.isPetted) ? -1 : 0)

// 金色星星点缀配置（3-5 个，围绕身体）
interface Star { x: number; y: number; r: number }
const stars: Star[] = [
  { x: 12, y: 16, r: 2 },
  { x: 90, y: 15, r: 1.8 },
  { x: 8, y: 40, r: 1.6 },
  { x: 92, y: 38, r: 2 },
  { x: 48, y: 4, r: 1.7 },
]

// 生成五角星 path（中心 cx,cy，外径 r）
function starPath(cx: number, cy: number, r: number): string {
  const inner = r * 0.4
  return `M ${cx} ${cy - r} L ${cx + inner * 0.3} ${cy - inner} L ${cx + r} ${cy} L ${cx + inner * 0.3} ${cy + inner} L ${cx} ${cy + r} L ${cx - inner * 0.3} ${cy + inner} L ${cx - r} ${cy} L ${cx - inner * 0.3} ${cy - inner} Z`
}
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体感渐变 -->
      <radialGradient :id="`ckShade${uid}`" cx="38%" cy="30%" r="80%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.5)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.3)" />
      </radialGradient>
      <!-- legendary 金光晕滤镜 -->
      <filter :id="`ckAura${uid}`" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.5" />
      </filter>
      <!-- 接地阴影模糊滤镜 -->
      <filter :id="`ckShadow${uid}`" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="56" rx="34" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="`url(#ckShadow${uid})`" />

    <!-- legendary 金色光晕（身体后方模糊金色椭圆）-->
    <ellipse cx="50" cy="40" rx="40" ry="22" fill="rgba(255,215,0,0.22)" :filter="`url(#ckAura${uid})`" />

    <!-- 围绕身体的金色星星点缀（5 个，frame 2 闪烁）-->
    <path
      v-for="(s, i) in stars"
      :key="i"
      :d="starPath(s.x, s.y + starOffset, s.r)"
      fill="rgba(255,215,0,0.9)"
      stroke="rgba(255,180,0,0.6)"
      stroke-width="0.3"
    />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 短粗尾巴（frame 2 摆动）-->
      <g :transform="`rotate(${tailRotate}, 86, 42)`">
        <ellipse cx="89" cy="40" rx="3.5" ry="2.5" :fill="palette.primary" stroke="rgba(255,215,0,0.6)" stroke-width="0.8" />
      </g>

      <!-- 4 个小短爪（金色描边）-->
      <ellipse cx="22" cy="52" rx="4" ry="2.5" :fill="palette.primary" stroke="rgba(255,215,0,0.6)" stroke-width="0.7" />
      <ellipse cx="78" cy="52" rx="4" ry="2.5" :fill="palette.primary" stroke="rgba(255,215,0,0.6)" stroke-width="0.7" />
      <ellipse cx="34" cy="54" rx="3.5" ry="2.2" :fill="palette.primary" stroke="rgba(255,215,0,0.6)" stroke-width="0.7" />
      <ellipse cx="66" cy="54" rx="3.5" ry="2.2" :fill="palette.primary" stroke="rgba(255,215,0,0.6)" stroke-width="0.7" />

      <!-- 超圆胖身体 + 金色描边 -->
      <path d="M 14 42 Q 14 24 50 24 Q 86 24 86 42 Q 86 56 50 56 Q 14 56 14 42 Z" :fill="palette.primary" stroke="rgba(255,215,0,0.8)" stroke-width="1.2" />
      <path d="M 14 42 Q 14 24 50 24 Q 86 24 86 42 Q 86 56 50 56 Q 14 56 14 42 Z" :fill="`url(#ckShade${uid})`" />
      <!-- 身体高光 -->
      <ellipse cx="40" cy="30" rx="12" ry="4.5" fill="rgba(255,255,255,0.4)" />

      <!-- 肚皮斑纹（accent 椭圆）-->
      <ellipse cx="50" cy="48" rx="24" ry="7" :fill="palette.accent" opacity="0.35" />

      <!-- 小头（顶部）-->
      <circle cx="50" cy="22" r="8.5" :fill="palette.primary" stroke="rgba(255,215,0,0.8)" stroke-width="1" />
      <circle cx="50" cy="22" r="8.5" :fill="`url(#ckShade${uid})`" />

      <!-- 小耳朵 -->
      <circle cx="44" cy="15" r="2.8" :fill="palette.primary" stroke="rgba(255,215,0,0.6)" stroke-width="0.7" />
      <circle cx="56" cy="15" r="2.8" :fill="palette.primary" stroke="rgba(255,215,0,0.6)" stroke-width="0.7" />

      <!-- 眯眯眼（满足表情）-->
      <path :d="eyePath.left" stroke="rgba(0,0,0,0.8)" stroke-width="1.2" fill="none" stroke-linecap="round" />
      <path :d="eyePath.right" stroke="rgba(0,0,0,0.8)" stroke-width="1.2" fill="none" stroke-linecap="round" />

      <!-- 小鼻子 -->
      <ellipse cx="50" cy="25" rx="1.8" ry="1.2" :fill="palette.accent" />
      <!-- 嘴（满足微笑）-->
      <path d="M 47 28 Q 50 30 53 28" stroke="rgba(0,0,0,0.5)" stroke-width="0.9" fill="none" stroke-linecap="round" />
    </g>

    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
