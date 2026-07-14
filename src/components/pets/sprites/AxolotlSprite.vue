<!-- src/components/pets/sprites/AxolotlSprite.vue -->
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
const bodyOffsetY = computed(() => (isJumping.value ? -5 : 0))
const gillSway = computed(() => (props.frame === 2 ? 7 : 0)) // 鳃羽摆动角度
const showCheer = computed(() => props.frame === 2) // 跳跃时嘴更开
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 头部立体渐变 -->
      <radialGradient :id="'headGrad-' + uid" cx="42%" cy="30%" r="72%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/>
        <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.25"/>
      </radialGradient>
      <!-- 身体渐变 -->
      <radialGradient :id="'bodyGrad-' + uid" cx="50%" cy="30%" r="70%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.22"/>
      </radialGradient>
      <!-- 接地阴影模糊 -->
      <filter :id="'shadow-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6"/>
      </filter>
      <!-- epic 灵气光晕 -->
      <filter :id="'halo-' + uid" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="2.8"/>
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="26" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="'url(#shadow-' + uid + ')'"/>

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- epic 灵气光晕（围绕身体的模糊 accent） -->
      <ellipse cx="50" cy="32" rx="28" ry="22" :fill="palette.accent" opacity="0.15" :filter="'url(#halo-' + uid + ')'"/>

      <!-- 长尾巴（从身体右侧延伸，弧线收尾） -->
      <path d="M 60 40 Q 74 38 80 30 Q 78 34 76 40 Q 72 46 64 44 Z"
            :fill="palette.primary" stroke="rgba(0,0,0,0.15)" stroke-width="0.8"/>
      <!-- 尾巴渐变叠加 -->
      <path d="M 60 40 Q 74 38 80 30 Q 78 34 76 40 Q 72 46 64 44 Z"
            :fill="'url(#bodyGrad-' + uid + ')'"/>

      <!-- 身体（头部下方） -->
      <ellipse cx="50" cy="42" rx="16" ry="9" :fill="palette.primary" stroke="rgba(0,0,0,0.15)" stroke-width="0.8"/>
      <!-- 身体渐变叠加 -->
      <ellipse cx="50" cy="42" rx="16" ry="9" :fill="'url(#bodyGrad-' + uid + ')'"/>
      <!-- 肚皮高光 -->
      <ellipse cx="50" cy="46" rx="11" ry="3" fill="rgba(255,255,255,0.25)"/>

      <!-- 小爪子（左右各一） -->
      <ellipse cx="40" cy="49" rx="3" ry="2" :fill="palette.primary" stroke="rgba(0,0,0,0.18)" stroke-width="0.6"/>
      <ellipse cx="60" cy="49" rx="3" ry="2" :fill="palette.primary" stroke="rgba(0,0,0,0.18)" stroke-width="0.6"/>

      <!-- 左侧 3 根鳃羽（frame 2 时摆动） -->
      <g :transform="`rotate(${-gillSway} 41 22)`">
        <!-- 鳃羽 1（上） -->
        <path d="M 41 22 Q 34 14 30 8" :stroke="palette.accent" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>
        <circle cx="34" cy="16" r="1.3" :fill="palette.accent" opacity="0.85"/>
        <circle cx="31" cy="12" r="1.1" :fill="palette.accent" opacity="0.85"/>
        <circle cx="30" cy="8" r="1" :fill="palette.accent" opacity="0.85"/>
        <!-- 鳃羽 2（中） -->
        <path d="M 40 24 Q 30 22 24 18" :stroke="palette.accent" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>
        <circle cx="32" cy="22" r="1.3" :fill="palette.accent" opacity="0.85"/>
        <circle cx="28" cy="20" r="1.1" :fill="palette.accent" opacity="0.85"/>
        <circle cx="24" cy="18" r="1" :fill="palette.accent" opacity="0.85"/>
        <!-- 鳃羽 3（下） -->
        <path d="M 40 26 Q 30 28 24 28" :stroke="palette.accent" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>
        <circle cx="32" cy="28" r="1.3" :fill="palette.accent" opacity="0.85"/>
        <circle cx="28" cy="28" r="1.1" :fill="palette.accent" opacity="0.85"/>
        <circle cx="24" cy="28" r="1" :fill="palette.accent" opacity="0.85"/>
      </g>

      <!-- 右侧 3 根鳃羽（镜像摆动） -->
      <g :transform="`rotate(${gillSway} 59 22)`">
        <path d="M 59 22 Q 66 14 70 8" :stroke="palette.accent" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>
        <circle cx="66" cy="16" r="1.3" :fill="palette.accent" opacity="0.85"/>
        <circle cx="69" cy="12" r="1.1" :fill="palette.accent" opacity="0.85"/>
        <circle cx="70" cy="8" r="1" :fill="palette.accent" opacity="0.85"/>
        <path d="M 60 24 Q 70 22 76 18" :stroke="palette.accent" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>
        <circle cx="68" cy="22" r="1.3" :fill="palette.accent" opacity="0.85"/>
        <circle cx="72" cy="20" r="1.1" :fill="palette.accent" opacity="0.85"/>
        <circle cx="76" cy="18" r="1" :fill="palette.accent" opacity="0.85"/>
        <path d="M 60 26 Q 70 28 76 28" :stroke="palette.accent" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>
        <circle cx="68" cy="28" r="1.3" :fill="palette.accent" opacity="0.85"/>
        <circle cx="72" cy="28" r="1.1" :fill="palette.accent" opacity="0.85"/>
        <circle cx="76" cy="28" r="1" :fill="palette.accent" opacity="0.85"/>
      </g>

      <!-- 头部（大圆，primary 底色） -->
      <circle cx="50" cy="26" r="11.5" :fill="palette.primary" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>
      <!-- 头部渐变叠加（立体感） -->
      <circle cx="50" cy="26" r="11.5" :fill="'url(#headGrad-' + uid + ')'"/>
      <!-- 头顶高光 -->
      <ellipse cx="45" cy="19" rx="5" ry="2.5" fill="rgba(255,255,255,0.35)"/>

      <!-- 眼睛 -->
      <template v-if="!isBlinking">
        <!-- 睁眼 -->
        <circle cx="45" cy="25" r="2.2" fill="#fff"/>
        <circle cx="55" cy="25" r="2.2" fill="#fff"/>
        <circle cx="45" cy="25.5" r="1.3" fill="rgba(0,0,0,0.82)"/>
        <circle cx="55" cy="25.5" r="1.3" fill="rgba(0,0,0,0.82)"/>
        <circle cx="45.5" cy="24.8" r="0.5" fill="#fff"/>
        <circle cx="55.5" cy="24.8" r="0.5" fill="#fff"/>
      </template>
      <template v-else>
        <!-- 眨眼弯月 ^^ -->
        <path d="M 43 25 Q 45 23 47 25" stroke="rgba(0,0,0,0.82)" stroke-width="1.3" fill="none" stroke-linecap="round"/>
        <path d="M 53 25 Q 55 23 57 25" stroke="rgba(0,0,0,0.82)" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      </template>

      <!-- 微笑嘴（frame 2 时更开） -->
      <path :d="showCheer ? 'M 46 31 Q 50 36 54 31' : 'M 47 31 Q 50 34 53 31'"
            stroke="rgba(0,0,0,0.65)" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <!-- 嘴角小腮红 -->
      <circle cx="43" cy="29" r="1.2" fill="rgba(0,0,0,0.12)"/>
      <circle cx="57" cy="29" r="1.2" fill="rgba(0,0,0,0.12)"/>
    </g>

    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
