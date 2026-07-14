<!-- src/components/pets/sprites/RobotSprite.vue -->
<!-- 稀有度：rare —— 在 common 基础上增加稀有度光环 + 电路细节 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

// 是否眨眼（frame 1 且未被抚摸时切换为 ^^ 弯月闭眼）
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
// 跳跃偏移：frame 2 上移，被抚摸时轻微上移
const bodyOffsetY = computed(() => {
  if (props.isPetted) return -3
  if (props.frame === 2) return -6
  return 0
})
// 天线 LED 光晕透明度：frame 2 时闪烁增强
const antennaGlowOpacity = computed(() => (props.frame === 2 ? 0.75 : 0.35))

// 防止多实例 SVG id 冲突
const uid = Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体径向渐变：中心亮、边缘暗，营造金属球体立体感 -->
      <radialGradient :id="'robotBodyGrad-' + uid" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.45)" />
        <stop offset="45%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.35)" />
      </radialGradient>
      <!-- 屏幕 LCD 渐变（上深下浅） -->
      <linearGradient :id="'robotScreenGrad-' + uid" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="rgba(0,0,0,0.6)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.4)" />
      </linearGradient>
      <!-- 接地阴影模糊滤镜 -->
      <filter :id="'robotShadowFilter-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
      <!-- LED 眼睛光晕模糊 -->
      <filter :id="'robotEyeGlow-' + uid" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="1.4" />
      </filter>
      <!-- 天线 LED 光晕（更大范围模糊） -->
      <filter :id="'robotAntennaGlow-' + uid" x="-150%" y="-150%" width="400%" height="400%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
      <!-- 稀有度（rare）发光描边光环 -->
      <filter :id="'robotRareAura-' + uid" x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur stdDeviation="1.4" />
      </filter>
    </defs>

    <!-- 接地阴影（不随跳跃移动） -->
    <ellipse cx="50" cy="55" rx="28" ry="2.5" fill="rgba(0,0,0,0.25)" :filter="'url(#robotShadowFilter-' + uid + ')'" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 稀有度光环：在身体外侧的淡色光晕（rare 专属） -->
      <rect x="20" y="18" width="60" height="36" rx="8" ry="8"
            :fill="palette.accent" opacity="0.18" :filter="'url(#robotRareAura-' + uid + ')'" />

      <!-- 天线杆 -->
      <line x1="50" y1="20" x2="50" y2="11"
            stroke="rgba(0,0,0,0.45)" stroke-width="1.2" stroke-linecap="round" />
      <!-- 天线 LED 光晕（frame 2 时增强） -->
      <circle cx="50" cy="9" r="4.5" :fill="palette.accent"
              :opacity="antennaGlowOpacity" :filter="'url(#robotAntennaGlow-' + uid + ')'" />
      <!-- 天线小球 -->
      <circle cx="50" cy="9" r="2.2" :fill="palette.accent" />
      <circle cx="49.3" cy="8.3" r="0.7" fill="rgba(255,255,255,0.85)" />

      <!-- 身体基础填充 -->
      <rect x="22" y="20" width="56" height="32" rx="6" ry="6"
            :fill="palette.primary" stroke="rgba(0,0,0,0.35)" stroke-width="0.8" />
      <!-- 身体立体渐变叠加 -->
      <rect x="22" y="20" width="56" height="32" rx="6" ry="6" :fill="'url(#robotBodyGrad-' + uid + ')'" />

      <!-- 屏幕（黑色 LCD 面板） -->
      <rect x="30" y="24" width="40" height="14" rx="2" ry="2"
            :fill="'url(#robotScreenGrad-' + uid + ')'" stroke="rgba(0,0,0,0.5)" stroke-width="0.5" />
      <!-- 屏幕顶部反光条 -->
      <rect x="31" y="25" width="38" height="1.5" rx="0.7" fill="rgba(255,255,255,0.12)" />

      <!-- LED 眼睛（带光晕，frame 1 时变为 ^^ 弯月闭眼） -->
      <template v-if="!isBlinking">
        <!-- 光晕扩散 -->
        <circle cx="40" cy="31" r="3.2" :fill="palette.accent" opacity="0.4" :filter="'url(#robotEyeGlow-' + uid + ')'" />
        <circle cx="60" cy="31" r="3.2" :fill="palette.accent" opacity="0.4" :filter="'url(#robotEyeGlow-' + uid + ')'" />
        <!-- 眼球本体 -->
        <circle cx="40" cy="31" r="1.9" :fill="palette.accent" />
        <circle cx="60" cy="31" r="1.9" :fill="palette.accent" />
        <!-- 眼球高光 -->
        <circle cx="39.5" cy="30.4" r="0.6" fill="rgba(255,255,255,0.95)" />
        <circle cx="59.5" cy="30.4" r="0.6" fill="rgba(255,255,255,0.95)" />
      </template>
      <template v-else>
        <!-- 眨眼：^^ 弯月闭眼（path 改变，非 opacity） -->
        <path d="M 38 31 Q 40 29 42 31" :stroke="palette.accent"
              stroke-width="1.2" fill="none" stroke-linecap="round" />
        <path d="M 58 31 Q 60 29 62 31" :stroke="palette.accent"
              stroke-width="1.2" fill="none" stroke-linecap="round" />
      </template>

      <!-- 嘴（一字嘴，符合"高效字面化"性格） -->
      <path d="M 46 35.5 L 54 35.5" stroke="rgba(0,0,0,0.7)"
            stroke-width="1" stroke-linecap="round" />

      <!-- 电路纹路（左右对称的细线 + 端点节点） -->
      <path d="M 24 42 L 28 42 L 28 45 L 30 45"
            stroke="rgba(0,0,0,0.4)" stroke-width="0.5" fill="none" stroke-linejoin="round" />
      <path d="M 76 42 L 72 42 L 72 45 L 70 45"
            stroke="rgba(0,0,0,0.4)" stroke-width="0.5" fill="none" stroke-linejoin="round" />
      <circle cx="28" cy="42" r="0.6" :fill="palette.accent" opacity="0.75" />
      <circle cx="72" cy="42" r="0.6" :fill="palette.accent" opacity="0.75" />

      <!-- 胸口按钮排（亮度递减） -->
      <circle cx="35" cy="46" r="1" :fill="palette.accent" />
      <circle cx="42" cy="46" r="1" :fill="palette.accent" opacity="0.7" />
      <circle cx="49" cy="46" r="1" :fill="palette.accent" opacity="0.45" />

      <!-- 关节铆钉（四角） -->
      <circle cx="25.5" cy="22.5" r="0.9" fill="rgba(0,0,0,0.55)" />
      <circle cx="74.5" cy="22.5" r="0.9" fill="rgba(0,0,0,0.55)" />
      <circle cx="25.5" cy="49.5" r="0.9" fill="rgba(0,0,0,0.55)" />
      <circle cx="74.5" cy="49.5" r="0.9" fill="rgba(0,0,0,0.55)" />
    </g>

    <!-- 抚摸爱心（位置不可变） -->
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
