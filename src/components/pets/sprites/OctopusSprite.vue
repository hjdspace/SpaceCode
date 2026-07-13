<!-- src/components/pets/sprites/OctopusSprite.vue -->
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
const leftSway = computed(() => (props.frame === 2 ? 6 : 0)) // 左侧触手摆动
const rightSway = computed(() => (props.frame === 2 ? -6 : 0)) // 右侧触手摆动
const showInkBurst = computed(() => props.frame === 2) // 跳跃时喷墨汁气泡
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 头部立体渐变 -->
      <radialGradient :id="'headGrad-' + uid" cx="45%" cy="28%" r="72%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.42"/>
        <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.28"/>
      </radialGradient>
      <!-- 接地阴影模糊 -->
      <filter :id="'shadow-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6"/>
      </filter>
      <!-- rare 发光描边 -->
      <filter :id="'glow-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2"/>
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="55" rx="30" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="'url(#shadow-' + uid + ')'"/>

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- rare 发光光环（头部外圈模糊 accent） -->
      <ellipse cx="50" cy="22" rx="27" ry="20" :fill="palette.accent" opacity="0.16" :filter="'url(#glow-' + uid + ')'"/>

      <!-- 左侧 4 条触手（frame 2 时摆动） -->
      <g :transform="`rotate(${leftSway} 48 30)`">
        <!-- 触手 1（最左） -->
        <path d="M 30 30 Q 24 40 28 50 Q 26 54 30 56"
              :stroke="palette.primary" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="28" cy="38" r="0.8" :fill="palette.accent" opacity="0.9"/>
        <circle cx="26" cy="44" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <circle cx="28" cy="50" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <!-- 触手 2 -->
        <path d="M 36 30 Q 33 42 37 52 Q 35 55 38 57"
              :stroke="palette.primary" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="34" cy="40" r="0.8" :fill="palette.accent" opacity="0.9"/>
        <circle cx="35" cy="46" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <circle cx="37" cy="52" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <!-- 触手 3 -->
        <path d="M 41 30 Q 40 44 42 54 Q 41 57 43 58"
              :stroke="palette.primary" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="40" cy="40" r="0.8" :fill="palette.accent" opacity="0.9"/>
        <circle cx="41" cy="47" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <circle cx="42" cy="54" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <!-- 触手 4 -->
        <path d="M 46 30 Q 46 44 44 56 Q 44 58 46 58"
              :stroke="palette.primary" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="45" cy="40" r="0.8" :fill="palette.accent" opacity="0.9"/>
        <circle cx="45" cy="48" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <circle cx="44" cy="55" r="0.7" :fill="palette.accent" opacity="0.9"/>
      </g>

      <!-- 右侧 4 条触手（镜像摆动） -->
      <g :transform="`rotate(${rightSway} 52 30)`">
        <!-- 触手 5 -->
        <path d="M 54 30 Q 54 44 56 56 Q 56 58 54 58"
              :stroke="palette.primary" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="55" cy="40" r="0.8" :fill="palette.accent" opacity="0.9"/>
        <circle cx="55" cy="48" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <circle cx="56" cy="55" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <!-- 触手 6 -->
        <path d="M 59 30 Q 60 44 58 54 Q 59 57 57 58"
              :stroke="palette.primary" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="60" cy="40" r="0.8" :fill="palette.accent" opacity="0.9"/>
        <circle cx="59" cy="47" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <circle cx="58" cy="54" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <!-- 触手 7 -->
        <path d="M 64 30 Q 67 42 63 52 Q 65 55 62 57"
              :stroke="palette.primary" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="66" cy="40" r="0.8" :fill="palette.accent" opacity="0.9"/>
        <circle cx="65" cy="46" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <circle cx="63" cy="52" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <!-- 触手 8（最右） -->
        <path d="M 70 30 Q 76 40 72 50 Q 74 54 70 56"
              :stroke="palette.primary" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="72" cy="38" r="0.8" :fill="palette.accent" opacity="0.9"/>
        <circle cx="74" cy="44" r="0.7" :fill="palette.accent" opacity="0.9"/>
        <circle cx="72" cy="50" r="0.7" :fill="palette.accent" opacity="0.9"/>
      </g>

      <!-- 大圆头（mantle，primary 底色） -->
      <path d="M 26 30 Q 26 8 50 8 Q 74 8 74 30 Q 74 34 50 34 Q 26 34 26 30 Z"
            :fill="palette.primary" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>
      <!-- 头部渐变叠加（立体感） -->
      <path d="M 26 30 Q 26 8 50 8 Q 74 8 74 30 Q 74 34 50 34 Q 26 34 26 30 Z"
            :fill="'url(#headGrad-' + uid + ')'"/>
      <!-- 头顶高光 -->
      <ellipse cx="42" cy="13" rx="8" ry="3" fill="rgba(255,255,255,0.35)"/>
      <!-- 侧面高光 -->
      <ellipse cx="33" cy="20" rx="3" ry="5" fill="rgba(255,255,255,0.18)"/>

      <!-- 眼睛 -->
      <template v-if="!isBlinking">
        <!-- 睁眼：白底 + 瞳孔 + 高光 -->
        <circle cx="40" cy="20" r="3.2" fill="#fff"/>
        <circle cx="60" cy="20" r="3.2" fill="#fff"/>
        <circle cx="40" cy="20.5" r="1.9" fill="rgba(0,0,0,0.82)"/>
        <circle cx="60" cy="20.5" r="1.9" fill="rgba(0,0,0,0.82)"/>
        <circle cx="40.8" cy="19.5" r="0.7" fill="#fff"/>
        <circle cx="60.8" cy="19.5" r="0.7" fill="#fff"/>
      </template>
      <template v-else>
        <!-- 眨眼弯月 ^^ -->
        <path d="M 37 20 Q 40 17 43 20" stroke="rgba(0,0,0,0.82)" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        <path d="M 57 20 Q 60 17 63 20" stroke="rgba(0,0,0,0.82)" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </template>

      <!-- 嘴（小 O 形） -->
      <ellipse cx="50" cy="28" rx="1.6" ry="1.2" fill="rgba(0,0,0,0.5)"/>

      <!-- 墨汁气泡点缀（装饰，frame 2 时增多） -->
      <g :fill="palette.accent" opacity="0.5">
        <circle cx="18" cy="22" r="1.5"/>
        <circle cx="82" cy="22" r="1.5"/>
        <circle cx="15" cy="14" r="1"/>
        <circle cx="85" cy="14" r="1"/>
      </g>
      <!-- frame 2 喷出的墨汁气泡 -->
      <g v-if="showInkBurst" :fill="palette.accent" opacity="0.55">
        <circle cx="12" cy="28" r="1.8"/>
        <circle cx="88" cy="28" r="1.8"/>
        <circle cx="10" cy="34" r="1.2"/>
        <circle cx="90" cy="34" r="1.2"/>
      </g>
    </g>

    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
