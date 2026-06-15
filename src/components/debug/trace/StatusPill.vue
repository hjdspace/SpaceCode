<template>
  <span class="status-pill" :class="status" :title="status">
    <span class="status-dot" />
    <span class="status-label">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TraceSpanStatus } from '@/lib/traceViewModel'

const props = defineProps<{ status: TraceSpanStatus }>()

const label = computed(() => {
  switch (props.status) {
    case 'ok': return 'OK'
    case 'error': return 'Error'
    case 'pending': return 'Running'
    default: return ''
  }
})
</script>

<style lang="scss" scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  line-height: 1.5;
  text-transform: uppercase;

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  &.ok {
    background: rgba(16, 185, 129, 0.1);
    color: #34d399;
    .status-dot { background: #34d399; }
  }

  &.error {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
    .status-dot { background: #f87171; }
  }

  &.pending {
    background: rgba(99, 102, 241, 0.1);
    color: #818cf8;
    .status-dot {
      background: #818cf8;
      animation: dot-pulse 1.4s ease-in-out infinite;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    }
  }
}

@keyframes dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
</style>
