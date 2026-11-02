<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatDurationMs } from '@/utils/formatDuration'

export type LoadingVariant = 'Drive' | 'Dots' | 'Orbit'

const props = withDefaults(
  defineProps<{
    /** 固定文案。与 `labels` 同时给出时 `labels` 优先。 */
    label?: string
    /** 轮询文案池：按 `rotateMs` 依次切换，用于「回合仍在跑但暂无具体可报」的阶段 */
    labels?: string[]
    rotateMs?: number
    variant?: LoadingVariant
    /**
     * 计时起点（epoch ms），缺省为挂载时刻。
     * 传入回合发起时间后，组件因页面切换被卸载重建时计时保持连续不归零；
     * 轮询下标同样由它推导，重建不会把文案拨回池首。
     */
    startTime?: number
    /** 状态行下方的补充说明（如 MCP 连接失败名单） */
    note?: string
  }>(),
  {
    label: 'Churning',
    labels: undefined,
    rotateMs: 2400,
    variant: 'Drive',
    startTime: undefined,
    note: undefined,
  },
)

const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3)
  const column = index % 3
  return (column + Math.abs(row - 1)) * 90
})

const orbitOrder = [0, 1, 2, 5, 8, 7, 6, 3]
const orbit = Array.from({ length: 9 }, (_, index) => {
  const order = orbitOrder.indexOf(index)
  return order === -1 ? null : order * 110
})

const patterns: Record<
  LoadingVariant,
  { delays: Array<number | null>; duration: number; round: boolean }
> = {
  Drive: { delays: chevron, duration: 650, round: false },
  Dots: { delays: chevron, duration: 650, round: true },
  Orbit: { delays: orbit, duration: 950, round: false },
}

const anchor = ref(props.startTime && props.startTime > 0 ? props.startTime : Date.now())
watch(() => props.startTime, (value) => {
  if (value && value > 0) anchor.value = value
})

const now = ref(Date.now())
let timer: number | undefined

onMounted(() => {
  now.value = Date.now()
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 100)
})

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer)
})

const elapsedMs = computed(() => Math.max(0, now.value - anchor.value))
const elapsed = computed(() => formatDurationMs(elapsedMs.value))

const currentLabel = computed(() => {
  const pool = props.labels
  if (!pool?.length) return props.label
  return pool[Math.floor(elapsedMs.value / props.rotateMs) % pool.length]
})

const pattern = computed(() => patterns[props.variant])
</script>

<template>
  <div class="loading-state" role="status" :aria-label="`${currentLabel}, ${elapsed}`">
    <div class="loading-row">
      <span class="pixel-grid" aria-hidden="true">
        <span
          v-for="(delay, index) in pattern.delays"
          :key="`${variant}-${index}`"
          class="pixel"
          :class="{
            'pixel--round': pattern.round,
            'pixel--idle': delay === null,
            'pixel--animated': delay !== null,
          }"
          :style="
            delay === null
              ? undefined
              : {
                  '--pixel-duration': `${pattern.duration}ms`,
                  '--pixel-delay': `${delay}ms`,
                }
          "
        />
      </span>
      <span class="loading-label">{{ currentLabel }}</span>
      <span class="elapsed">{{ elapsed }}</span>
    </div>
    <div v-if="note" class="loading-note">{{ note }}</div>
  </div>
</template>

<style scoped>
.loading-state {
  display: flex;
  width: fit-content;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.loading-row {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 10px;
}

.loading-note {
  padding-left: 26px;
  color: var(--status-warning, #e6a700);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.pixel-grid {
  display: grid;
  grid-template-columns: repeat(3, 4px);
  gap: 1.5px;
}

.pixel {
  width: 4px;
  height: 4px;
  border-radius: 1px;
  background: var(--text-primary, var(--ink));
  opacity: 0.15;
}

.pixel--round {
  border-radius: 999px;
}

.pixel--idle {
  opacity: 0.07;
}

.pixel--animated {
  animation: pixel-on var(--pixel-duration) ease-in-out var(--pixel-delay) infinite;
}

.loading-label {
  color: transparent;
  background-image: linear-gradient(
    90deg,
    var(--text-muted, var(--ink-3)) 35%,
    var(--text-primary, var(--ink)) 50%,
    var(--text-muted, var(--ink-3)) 65%
  );
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  font-size: var(--text-md);
  font-weight: 500;
  animation: shimmer-text 1.4s linear infinite;
}

.elapsed {
  color: var(--text-muted, var(--ink-3));
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

@keyframes shimmer-text {
  0% {
    background-position: 150%;
  }
  100% {
    background-position: -50%;
  }
}

@keyframes pixel-on {
  0%,
  100% {
    opacity: 0.15;
  }
  18%,
  42% {
    opacity: 1;
  }
  62% {
    opacity: 0.15;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pixel,
  .loading-label {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
