<!--
  录音电平波形：中心格最响、向两侧衰减，每 60ms 滚入一格新电平。
  读数来自采音适配器逐帧 RMS；这里只负责把「说话」变成起伏，不参与识别。
-->
<template>
  <div class="voice-waveform" aria-hidden="true">
    <span
      v-for="bar in bars"
      :key="bar.index"
      class="voice-waveform-bar"
      :style="{ height: `${bar.height}px`, opacity: bar.opacity }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ level: number }>()

const BAR_COUNT = 23
const CENTER = (BAR_COUNT - 1) / 2
const HALF = Math.ceil(CENTER)
const SAMPLE_MS = 60
const MIN_HEIGHT = 3
const MAX_HEIGHT = 22

/** 距中心每格保存一格历史电平，左右镜像取用。 */
const samples = ref<number[]>(new Array(HALF + 1).fill(0))

let frameId = 0
let lastSampleAt = 0

function tick(now: number) {
  if (now - lastSampleAt >= SAMPLE_MS) {
    lastSampleAt = now
    const next = samples.value.slice(0, HALF)
    next.unshift(Math.min(1, Math.max(0, props.level)))
    samples.value = next
  }
  frameId = requestAnimationFrame(tick)
}

onMounted(() => {
  frameId = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frameId)
})

const bars = computed(() =>
  Array.from({ length: BAR_COUNT }, (_, index) => {
    const distance = Math.abs(index - CENTER)
    // 中心高、两端低：静止时是排小点，说话时中间先顶起来。
    const envelope = 0.12 + 0.88 * (1 - distance / (HALF + 1)) ** 1.5
    const value = (samples.value[distance] ?? 0) * envelope
    const height = MIN_HEIGHT + value * (MAX_HEIGHT - MIN_HEIGHT)
    const ratio = (height - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT)
    return {
      index,
      height: Math.round(height * 10) / 10,
      // 长得越高越深，形成截图里深浅交错的柱形。
      opacity: 0.18 + 0.82 * ratio,
    }
  }),
)
</script>

<style scoped lang="scss">
.voice-waveform {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 24px;
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
}

.voice-waveform-bar {
  width: 3px;
  flex-shrink: 0;
  border-radius: 2px;
  background: currentColor;
  transition: height 90ms ease-out, opacity 90ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .voice-waveform-bar {
    transition: none;
  }
}
</style>
