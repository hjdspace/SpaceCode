<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// ── 真实计时器 ──
// 组件在 loading=true 且无 assistant 内容时挂载，
// 挂载时刻即为"等待首个 token"的近似起点。
const mountTime = ref(Date.now())
const now = ref(Date.now())
let timerId: ReturnType<typeof setInterval> | null = null

function tick() {
  now.value = Date.now()
}

onMounted(() => {
  mountTime.value = Date.now()
  now.value = Date.now()
  timerId = setInterval(tick, 100)
})

onUnmounted(() => {
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
})

const elapsedMs = computed(() => Math.max(0, now.value - mountTime.value))

const elapsedText = computed(() => {
  const totalSec = Math.floor(elapsedMs.value / 1000)
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  const tenths = Math.floor((elapsedMs.value % 1000) / 100)
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(1, '0')}.${tenths}s`
  }
  return `${secs}.${tenths}s`
})
</script>

<template>
  <div class="thinking-state" role="status" :aria-label="t('chat.thinkingState.active')">
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="var(--text-muted)"
      class="thinking-star"
      aria-hidden="true"
    >
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
    <span class="thinking-label" aria-hidden="true">
      {{ t('chat.thinkingState.active') }}
    </span>
    <span class="thinking-elapsed">{{ elapsedText }}</span>
  </div>
</template>

<style scoped>
.thinking-state {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
}

.thinking-star {
  flex-shrink: 0;
  animation: star-pulse 2s ease-in-out infinite;
}

.thinking-label {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  color: transparent;
  background-image: linear-gradient(
    90deg,
    var(--text-muted) 35%,
    var(--text-primary) 50%,
    var(--text-muted) 65%
  );
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  animation: shimmer-text 1.4s linear infinite;
}

.thinking-elapsed {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@keyframes shimmer-text {
  0% {
    background-position: 150%;
  }
  100% {
    background-position: -50%;
  }
}

@keyframes star-pulse {
  0%, 100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .thinking-label,
  .thinking-star {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
