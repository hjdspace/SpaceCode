<!-- src/components/pets/sprites/DragonSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 防止多实例 SVG id 冲突
const uid = Math.random().toString(36).slice(2, 8)

// 帧动画状态
const isJumping = computed(() => props.frame === 2 || props.isPetted)
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
const bodyOffsetY = computed(() => (isJumping.value ? -6 : 0)) // 跳跃上移
const wingRot = computed(() => (props.frame === 2 ? -22 : 0)) // 翅膀扇动角度
const showSmoke = computed(() => props.frame === 2) // 鼻孔喷烟
const showTongue = computed(() => props.frame === 2) // 吐分叉舌
const showExcitedEyes = computed(() => props.frame === 2) // 跳跃时兴奋眼神
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体渐变：顶部白光高光 → 底部黑色阴影，叠加在 primary 上 -->
      <radialGradient :id="'bodyGrad-' + uid" cx="46%" cy="30%" r="72%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.42"/>
        <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.30"/>
      </radialGradient>
      <!-- 肚皮渐变（更亮的中线） -->
      <linearGradient :id="'bellyGrad-' + uid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <!-- 接地阴影模糊 -->
      <filter :id="'shadow-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6"/>
      </filter>
      <!-- rare 发光光环 -->
      <filter :id="'glow-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.2"/>
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="28" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="'url(#shadow-' + uid + ')'"/>

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- rare 发光光环（身体外圈模糊 accent） -->
      <ellipse cx="50" cy="36" rx="27" ry="19" :fill="palette.accent" opacity="0.16" :filter="'url(#glow-' + uid + ')'"/>

      <!-- 尾巴（带 spade 尖） -->
      <path d="M 70 42 Q 82 44 86 36 Q 84 34 88 34 L 86 30 Q 90 32 88 36 Q 86 42 78 44 Z"
            :fill="palette.primary" stroke="rgba(0,0,0,0.18)" stroke-width="0.8"/>
      <!-- 尾巴尖装饰 -->
      <path d="M 86 30 L 90 28 L 88 34 Z" :fill="palette.accent" opacity="0.92"/>

      <!-- 左翅膀（带扇动旋转） -->
      <g :transform="`rotate(${wingRot} 28 30)`">
        <path d="M 28 28 Q 14 20 6 26 Q 4 34 12 38 Q 20 36 28 34 Z"
              :fill="palette.accent" opacity="0.85" stroke="rgba(0,0,0,0.22)" stroke-width="0.8"/>
        <!-- 翅膀脉络 -->
        <path d="M 28 30 L 10 24 M 22 32 L 14 28 M 26 34 L 18 32"
              stroke="rgba(0,0,0,0.28)" stroke-width="0.6" fill="none" stroke-linecap="round"/>
      </g>

      <!-- 右翅膀（镜像扇动） -->
      <g :transform="`rotate(${-wingRot} 72 30)`">
        <path d="M 72 28 Q 86 20 94 26 Q 96 34 88 38 Q 80 36 72 34 Z"
              :fill="palette.accent" opacity="0.85" stroke="rgba(0,0,0,0.22)" stroke-width="0.8"/>
        <path d="M 72 30 L 90 24 M 78 32 L 86 28 M 74 34 L 82 32"
              stroke="rgba(0,0,0,0.28)" stroke-width="0.6" fill="none" stroke-linecap="round"/>
      </g>

      <!-- 身体底色 -->
      <path d="M 28 38 Q 28 22 50 22 Q 72 22 72 38 Q 72 50 50 50 Q 28 50 28 38 Z"
            :fill="palette.primary" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>
      <!-- 身体渐变叠加（立体感） -->
      <path d="M 28 38 Q 28 22 50 22 Q 72 22 72 38 Q 72 50 50 50 Q 28 50 28 38 Z"
            :fill="'url(#bodyGrad-' + uid + ')'"/>

      <!-- 鳞片纹理（菱形重复图案） -->
      <g fill="rgba(255,255,255,0.20)" stroke="rgba(0,0,0,0.12)" stroke-width="0.3">
        <path d="M 40 28 L 42 30 L 40 32 L 38 30 Z"/>
        <path d="M 48 28 L 50 30 L 48 32 L 46 30 Z"/>
        <path d="M 56 28 L 58 30 L 56 32 L 54 30 Z"/>
        <path d="M 44 35 L 46 37 L 44 39 L 42 37 Z"/>
        <path d="M 52 35 L 54 37 L 52 39 L 50 37 Z"/>
        <path d="M 60 35 L 62 37 L 60 39 L 58 37 Z"/>
      </g>

      <!-- 肚皮高光 -->
      <ellipse cx="50" cy="44" rx="13" ry="5" :fill="'url(#bellyGrad-' + uid + ')'"/>
      <!-- 身体顶部高光 -->
      <ellipse cx="44" cy="26" rx="6" ry="2.6" fill="rgba(255,255,255,0.32)"/>

      <!-- 左角（accent 曲线） -->
      <path d="M 40 22 Q 36 14 33 9" :stroke="palette.accent" stroke-width="3" fill="none" stroke-linecap="round"/>
      <!-- 右角 -->
      <path d="M 60 22 Q 64 14 67 9" :stroke="palette.accent" stroke-width="3" fill="none" stroke-linecap="round"/>

      <!-- 鼻孔 -->
      <circle cx="47" cy="43" r="0.9" fill="rgba(0,0,0,0.55)"/>
      <circle cx="53" cy="43" r="0.9" fill="rgba(0,0,0,0.55)"/>

      <!-- 鼻孔喷烟（frame 2） -->
      <g v-if="showSmoke" :fill="palette.accent" opacity="0.45">
        <circle cx="47" cy="39" r="1.6"/>
        <circle cx="44" cy="35" r="1.2"/>
        <circle cx="41" cy="31" r="0.9"/>
        <circle cx="53" cy="39" r="1.6"/>
        <circle cx="56" cy="35" r="1.2"/>
        <circle cx="59" cy="31" r="0.9"/>
      </g>

      <!-- 分叉舌头（frame 2） -->
      <g v-if="showTongue">
        <path d="M 50 46 L 50 49" stroke="rgba(0,0,0,0.4)" stroke-width="0.8" fill="none"/>
        <path d="M 50 49 L 48 50.5 M 50 49 L 52 50.5"
              :stroke="palette.accent" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      </g>

      <!-- 眼睛 -->
      <template v-if="!isBlinking">
        <!-- 睁眼：白底 + 黑瞳 + 高光 -->
        <circle cx="42" cy="32" r="3" fill="#fff"/>
        <circle cx="58" cy="32" r="3" fill="#fff"/>
        <circle :cx="showExcitedEyes ? 42.5 : 42" :cy="showExcitedEyes ? 31 : 33" r="1.7" fill="rgba(0,0,0,0.82)"/>
        <circle :cx="showExcitedEyes ? 58.5 : 58" :cy="showExcitedEyes ? 31 : 33" r="1.7" fill="rgba(0,0,0,0.82)"/>
        <circle cx="43" cy="31.5" r="0.6" fill="#fff"/>
        <circle cx="59" cy="31.5" r="0.6" fill="#fff"/>
      </template>
      <template v-else>
        <!-- 眨眼：弯月闭眼 ^^ -->
        <path d="M 39 32 Q 42 29 45 32" stroke="rgba(0,0,0,0.82)" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        <path d="M 55 32 Q 58 29 61 32" stroke="rgba(0,0,0,0.82)" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </template>
    </g>

    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
