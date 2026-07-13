<!-- src/components/pets/sprites/PenguinSprite.vue -->
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

// 眨眼帧：frame 1 变弯月闭眼
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
// 跳跃帧：frame 2 翅膀扇动 + 金毛晃动
const isJumping = computed(() => props.frame === 2 && !props.isPetted)

// 翅膀旋转：frame 2 时扇动
const leftWingTransform = computed(() =>
  isJumping.value ? 'rotate(-15 30 32)' : 'rotate(0 30 32)'
)
const rightWingTransform = computed(() =>
  isJumping.value ? 'rotate(15 70 32)' : 'rotate(0 70 32)'
)

// 头顶金毛旋转：frame 2 时晃动
const crestTransform = computed(() =>
  isJumping.value ? 'rotate(-15 50 18)' : 'rotate(0 50 18)'
)

// 脚蹼偏移：frame 2 时随跳跃抬起
const feetTransform = computed(() =>
  isJumping.value ? 'translate(0, -3)' : 'translate(0, 0)'
)

// 防止多实例 SVG id 冲突
const uid = Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体渐变：深灰色立体感 -->
      <radialGradient :id="'penguinShade-' + uid" cx="50%" cy="30%" r="75%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.25)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.35)" />
      </radialGradient>
      <!-- 阴影模糊滤镜 -->
      <filter :id="'penguinShadow-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" />
      </filter>
      <!-- rare 发光描边滤镜：黄色光环（用 palette.accent 色） -->
      <filter :id="'penguinGlow-' + uid" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="blur" />
        <feFlood :flood-color="palette.accent" flood-opacity="0.5" result="glowColor" />
        <feComposite in="glowColor" in2="blur" operator="in" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="25" ry="2.5" fill="rgba(0,0,0,0.2)" :filter="'url(#penguinShadow-' + uid + ')'" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 脚蹼（橙色，frame 2 时随跳跃抬起） -->
      <g :transform="feetTransform">
        <path d="M 42 49 Q 38 51 38 54 L 46 54 Q 46 51 44 49 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
        <path d="M 58 49 Q 62 51 62 54 L 54 54 Q 54 51 56 49 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
        <line x1="40" y1="52" x2="44" y2="52" stroke="rgba(0,0,0,0.3)" stroke-width="0.4" />
        <line x1="56" y1="52" x2="60" y2="52" stroke="rgba(0,0,0,0.3)" stroke-width="0.4" />
      </g>

      <!-- 身体（深灰，圆胖，头身一体）+ rare 发光描边 -->
      <path d="M 30 35 Q 30 18 50 18 Q 70 18 70 35 Q 70 52 50 52 Q 30 52 30 35 Z" :fill="palette.primary" :filter="'url(#penguinGlow-' + uid + ')'" />
      <path d="M 30 35 Q 30 18 50 18 Q 70 18 70 35 Q 70 52 50 52 Q 30 52 30 35 Z" :fill="'url(#penguinShade-' + uid + ')'" />

      <!-- 翅膀（企鹅小翅膀，贴身体，frame 2 时扇动） -->
      <g :transform="leftWingTransform">
        <path d="M 30 28 Q 22 32 24 44 Q 30 40 34 36 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.3)" stroke-width="0.6" />
      </g>
      <g :transform="rightWingTransform">
        <path d="M 70 28 Q 78 32 76 44 Q 70 40 66 36 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.3)" stroke-width="0.6" />
      </g>

      <!-- 白肚皮（企鹅标志性特征，身体前部白色区域，上窄下宽梨形） -->
      <path d="M 40 33 Q 36 38 36 44 Q 36 50 50 51 Q 64 50 64 44 Q 64 38 60 33 Q 50 35 40 33 Z" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.1)" stroke-width="0.4" />

      <!-- 头顶金毛（rare 装饰元素，frame 2 时晃动旋转） -->
      <path d="M 46 18 Q 48 12 50 14 Q 52 12 54 18 Z" :fill="palette.accent" :transform="crestTransform" stroke="rgba(0,0,0,0.2)" stroke-width="0.4" opacity="0.9" />

      <!-- 眼睛：默认圆眼，frame 1 变弯月闭眼 ^^ -->
      <g v-if="!isBlinking">
        <circle cx="44" cy="27" r="1.8" fill="rgba(0,0,0,0.85)" />
        <circle cx="56" cy="27" r="1.8" fill="rgba(0,0,0,0.85)" />
        <circle cx="43.5" cy="26.5" r="0.5" fill="rgba(255,255,255,0.9)" />
        <circle cx="55.5" cy="26.5" r="0.5" fill="rgba(255,255,255,0.9)" />
      </g>
      <g v-else>
        <path d="M 41 27 Q 44 25 47 27" stroke="rgba(0,0,0,0.85)" stroke-width="1.4" fill="none" stroke-linecap="round" />
        <path d="M 53 27 Q 56 25 59 27" stroke="rgba(0,0,0,0.85)" stroke-width="1.4" fill="none" stroke-linecap="round" />
      </g>

      <!-- 橙色尖喙（向前突出的小三角） -->
      <path d="M 47 30 L 53 30 L 50 34 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.4" />

      <!-- 白色胸斑（喙下方小白斑，连接喙到白肚皮，企鹅特征） -->
      <path d="M 47 34 L 53 34 L 52 37 L 48 37 Z" fill="rgba(255,255,255,0.95)" />
    </g>

    <!-- 抚摸爱心 -->
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
