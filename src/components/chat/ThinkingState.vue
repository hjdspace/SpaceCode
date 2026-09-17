<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /**
   * 计时起点（epoch ms）。缺省为挂载时刻。
   * 传入 turn 发起时间（用户消息 timestamp）后，组件因页面切换
   * （聊天区被 v-if 卸载再重建）而重新挂载时，计时保持连续不归零。
   */
  startTime?: number
  /**
   * 指示文案变体：
   * - thinking：等待 LLM 首 token（默认）
   * - responding：工具调用结束后等待 LLM 下一轮响应
   */
  variant?: 'thinking' | 'responding'
}>()

const { t } = useI18n()

// ── 真实计时器 ──
// 起点优先取 startTime（turn 发起时间），保证跨组件重建计时不重置。
const mountTime = ref(props.startTime && props.startTime > 0 ? props.startTime : Date.now())
watch(() => props.startTime, (v) => {
  if (v && v > 0) mountTime.value = v
})
const now = ref(Date.now())
let timerId: ReturnType<typeof setInterval> | null = null

function tick() {
  now.value = Date.now()
}

onMounted(() => {
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

const label = computed(() =>
  props.variant === 'responding'
    ? t('chat.thinkingState.responding')
    : t('chat.thinkingState.active')
)

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
  <div class="thinking-state" role="status" :aria-label="label">
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
      {{ label }}
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
