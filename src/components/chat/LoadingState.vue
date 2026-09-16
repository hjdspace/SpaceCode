<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export type LoadingVariant = 'Drive' | 'Dots' | 'Orbit'

const props = withDefaults(
  defineProps<{
    label?: string
    variant?: LoadingVariant
  }>(),
  {
    label: 'Churning',
    variant: 'Drive',
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

const deciseconds = ref(0)
let timer: number | undefined

onMounted(() => {
  timer = window.setInterval(() => {
    deciseconds.value += 1
  }, 100)
})

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer)
})

const elapsed = computed(() => {
  const total = deciseconds.value / 10
  if (total < 60) return `${total.toFixed(1)}s`
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`
})

const pattern = computed(() => patterns[props.variant])
</script>

<template>
  <div class="loading-state" role="status" :aria-label="`${label}, ${elapsed}`">
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
    <span class="loading-label">{{ label }}</span>
    <span class="elapsed">{{ elapsed }}</span>
  </div>
</template>

<style scoped>
.loading-state {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 10px;
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
  font-size: 13px;
  font-weight: 500;
  animation: shimmer-text 1.4s linear infinite;
}

.elapsed {
  color: var(--text-muted, var(--ink-3));
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);
  font-size: 12px;
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
