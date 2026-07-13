<!-- src/components/pets/sprites/OwlSprite.vue -->
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
  return props.frame === 2 ? -5 : 0
})

// 眨眼帧：frame 1 变弯月闭眼
const isBlinking = computed(() => props.frame === 1 && !props.isPetted)
// 扇翅帧：frame 2 翅膀展开
const isFlapping = computed(() => props.frame === 2 && !props.isPetted)

// 翅膀旋转：frame 2 时向外展开
const leftWingTransform = computed(() =>
  isFlapping.value ? 'rotate(-25 28 32)' : 'rotate(0 28 32)'
)
const rightWingTransform = computed(() =>
  isFlapping.value ? 'rotate(25 72 32)' : 'rotate(0 72 32)'
)

// 防止多实例 SVG id 冲突
const uid = Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- 身体立体渐变：棕色立体感 -->
      <radialGradient :id="'owlShade-' + uid" cx="50%" cy="30%" r="70%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.35)" />
        <stop offset="55%" stop-color="rgba(255,255,255,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.3)" />
      </radialGradient>
      <!-- 阴影模糊滤镜 -->
      <filter :id="'owlShadow-' + uid" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" />
      </filter>
      <!-- rare 发光描边滤镜：金色光环（用 palette.accent 色） -->
      <filter :id="'owlGlow-' + uid" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="blur" />
        <feFlood :flood-color="palette.accent" flood-opacity="0.55" result="glowColor" />
        <feComposite in="glowColor" in2="blur" operator="in" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- 接地阴影 -->
    <ellipse cx="50" cy="58" rx="25" ry="1.5" fill="rgba(0,0,0,0.25)" :filter="'url(#owlShadow-' + uid + ')'" />
    <!-- 树枝（猫头鹰站立的横木，颜色用 palette.primary 棕色） -->
    <path d="M 30 56 L 70 56" :stroke="palette.primary" stroke-width="2.2" stroke-linecap="round" />
    <path d="M 28 55 L 32 57 M 68 55 L 72 57" :stroke="palette.primary" stroke-opacity="0.6" stroke-width="1" stroke-linecap="round" />

    <g :transform="`translate(0, ${bodyOffsetY})`">
      <!-- 翅膀（frame 2 时向外展开） -->
      <g :transform="leftWingTransform">
        <path d="M 28 30 Q 18 35 22 48 Q 28 44 32 38 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" />
        <path d="M 28 30 Q 18 35 22 48 Q 28 44 32 38 Z" :fill="'url(#owlShade-' + uid + ')'" />
      </g>
      <g :transform="rightWingTransform">
        <path d="M 72 30 Q 82 35 78 48 Q 72 44 68 38 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" />
        <path d="M 72 30 Q 82 35 78 48 Q 72 44 68 38 Z" :fill="'url(#owlShade-' + uid + ')'" />
      </g>

      <!-- 身体（圆胖，头身一体）+ rare 发光描边 -->
      <path d="M 28 35 Q 28 15 50 15 Q 72 15 72 35 Q 72 52 50 52 Q 28 52 28 35 Z" :fill="palette.primary" :filter="'url(#owlGlow-' + uid + ')'" />
      <path d="M 28 35 Q 28 15 50 15 Q 72 15 72 35 Q 72 52 50 52 Q 28 52 28 35 Z" :fill="'url(#owlShade-' + uid + ')'" />

      <!-- 身体高光 -->
      <ellipse cx="42" cy="22" rx="6" ry="2.5" fill="rgba(255,255,255,0.35)" />

      <!-- 耳羽簇（rare 装饰元素，头顶两个尖） -->
      <path d="M 32 16 L 28 7 L 36 14 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.25)" stroke-width="0.6" />
      <path d="M 68 16 L 72 7 L 64 14 Z" :fill="palette.primary" stroke="rgba(0,0,0,0.25)" stroke-width="0.6" />

      <!-- V 形眉羽（眼睛上方倒 V） -->
      <path d="M 34 22 L 40 19 L 46 22" :stroke="palette.primary" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M 54 22 L 60 19 L 66 22" :stroke="palette.primary" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      <!-- 眉羽深色描边（增加层次） -->
      <path d="M 34 22 L 40 19 L 46 22" stroke="rgba(0,0,0,0.35)" stroke-width="0.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M 54 22 L 60 19 L 66 22" stroke="rgba(0,0,0,0.35)" stroke-width="0.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />

      <!-- 大眼睛：金虹膜 + 黑瞳 + 白高光，frame 1 变弯月闭眼 ^^ -->
      <g v-if="!isBlinking">
        <!-- 左眼金虹膜 -->
        <circle cx="40" cy="28" r="7" :fill="palette.accent" stroke="rgba(0,0,0,0.35)" stroke-width="0.6" />
        <!-- 左眼黑瞳 -->
        <circle cx="40" cy="28" r="3" fill="rgba(0,0,0,0.85)" />
        <!-- 左眼高光 -->
        <circle cx="39" cy="27" r="1" fill="rgba(255,255,255,0.9)" />
        <!-- 右眼金虹膜 -->
        <circle cx="60" cy="28" r="7" :fill="palette.accent" stroke="rgba(0,0,0,0.35)" stroke-width="0.6" />
        <!-- 右眼黑瞳 -->
        <circle cx="60" cy="28" r="3" fill="rgba(0,0,0,0.85)" />
        <!-- 右眼高光 -->
        <circle cx="59" cy="27" r="1" fill="rgba(255,255,255,0.9)" />
      </g>
      <g v-else>
        <!-- 闭眼 ^^（智慧啰嗦的猫头鹰眨眼时显得沉思） -->
        <path d="M 35 28 Q 40 25 45 28" stroke="rgba(0,0,0,0.85)" stroke-width="1.6" fill="none" stroke-linecap="round" />
        <path d="M 55 28 Q 60 25 65 28" stroke="rgba(0,0,0,0.85)" stroke-width="1.6" fill="none" stroke-linecap="round" />
      </g>

      <!-- 喙（小三角，向下勾） -->
      <path d="M 47 35 L 53 35 L 50 39 Z" :fill="palette.accent" stroke="rgba(0,0,0,0.25)" stroke-width="0.4" />

      <!-- 胸前 V 字纹（多条 V 形线，猫头鹰胸部羽毛纹理） -->
      <path d="M 42 43 L 45 46 L 48 43" stroke="rgba(0,0,0,0.28)" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M 52 43 L 55 46 L 58 43" stroke="rgba(0,0,0,0.28)" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M 47 47 L 50 50 L 53 47" stroke="rgba(0,0,0,0.28)" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round" />

      <!-- 爪子抓树枝（猫头鹰特征，三趾向前） -->
      <path d="M 42 51 L 40 55 M 42 51 L 44 55 M 42 51 L 42 55" stroke="rgba(0,0,0,0.75)" stroke-width="0.9" stroke-linecap="round" />
      <path d="M 58 51 L 56 55 M 58 51 L 60 55 M 58 51 L 58 55" stroke="rgba(0,0,0,0.75)" stroke-width="0.9" stroke-linecap="round" />
    </g>

    <!-- 抚摸爱心 -->
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
