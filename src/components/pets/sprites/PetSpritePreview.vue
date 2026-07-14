<!-- src/components/pets/sprites/PetSpritePreview.vue -->
<!-- 临时对比预览页：嵌入 App 中查看新宠物 SVG 效果 -->
<script setup lang="ts">
import { ref } from 'vue'
import type { PetPalette } from '@/types/pet'
import BlobSprite from './BlobSprite.vue'
import GhostSprite from './GhostSprite.vue'
import OctopusSprite from './OctopusSprite.vue'
import MushroomSprite from './MushroomSprite.vue'
import SnailSprite from './SnailSprite.vue'

const frame = ref<0 | 1 | 2>(0)
const isPetted = ref(false)
const FRAME_INTERVAL = 800
let intervalId: ReturnType<typeof setInterval> | null = null

function togglePlay() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    return
  }
  intervalId = setInterval(() => {
    frame.value = ((frame.value + 1) % 3) as 0 | 1 | 2
  }, FRAME_INTERVAL)
}
function togglePetted() { isPetted.value = !isPetted.value }

const sprites: Array<{ name: string; comp: any; palette: PetPalette; desc: string }> = [
  { name: 'Blob', comp: BlobSprite, palette: { primary: '#A8E6CF', accent: '#FF8B94' }, desc: '果冻质感 · 流动气泡 · 通透渐变' },
  { name: 'Ghost', comp: GhostSprite, palette: { primary: '#E1BEE7', accent: '#7C4DFF' }, desc: '灵魂渐变 · 底部波纹 · 鬼火光环' },
  { name: 'Octopus', comp: OctopusSprite, palette: { primary: '#FF6B9D', accent: '#4ECDC4' }, desc: '吸盘触手 · 墨汁粒子 · 流线圆头' },
  { name: 'Mushroom', comp: MushroomSprite, palette: { primary: '#EF5350', accent: '#FFFFFF' }, desc: '菌褶层叠 · 斑点分布 · 孢子飘散' },
  { name: 'Snail', comp: SnailSprite, palette: { primary: '#9CCC65', accent: '#FF8A65' }, desc: '螺旋内旋 · 粘液拖痕 · 大触角球' },
]
</script>

<template>
  <div class="preview-panel" @mouseenter="togglePlay" @mouseleave="togglePlay">
    <div class="header">
      <strong>新宠物 SVG 预览</strong>
      <div class="controls">
        <button @click="togglePlay">{{ intervalId ? '暂停' : '播放' }}动画</button>
        <button @click="togglePetted">{{ isPetted ? '取消抚摸' : '抚摸♥' }}</button>
        <span class="frame-label">帧: {{ frame }}</span>
      </div>
    </div>
    <div class="sprite-grid">
      <div v-for="s in sprites" :key="s.name" class="sprite-card">
        <div class="sprite-view">
          <component :is="s.comp" :palette="s.palette" :frame="frame" :is-petted="isPetted" />
        </div>
        <div class="sprite-name">{{ s.name }}</div>
        <div class="sprite-desc">{{ s.desc }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.preview-panel {
  position: fixed;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  background: rgba(30, 30, 40, 0.92);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  padding: 12px 16px;
  color: #eee;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  user-select: none;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    gap: 12px;
  }
  .controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  button {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.15);
    color: #ddd;
    padding: 3px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    &:hover { background: rgba(255,255,255,0.2); }
  }
  .frame-label { color: #999; font-size: 11px; margin-left: 4px; }
  .sprite-grid {
    display: flex;
    gap: 16px;
  }
  .sprite-card {
    text-align: center;
    .sprite-view {
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      padding: 8px 4px;
      display: flex;
      justify-content: center;
    }
    .sprite-name {
      font-weight: 600;
      margin-top: 4px;
    }
    .sprite-desc {
      color: #999;
      font-size: 10px;
      margin-top: 2px;
    }
  }
}
</style>