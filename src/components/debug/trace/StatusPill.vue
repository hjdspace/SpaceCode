<template>
  <span class="status-pill" :class="status" :title="status">
    <Check v-if="status === 'ok'" :size="10" aria-hidden="true" />
    <AlertCircle v-else-if="status === 'error'" :size="10" aria-hidden="true" />
    <Loader2 v-else-if="status === 'pending'" :size="10" class="spin" aria-hidden="true" />
  </span>
</template>

<script setup lang="ts">
import { Check, AlertCircle, Loader2 } from 'lucide-vue-next'
import type { TraceSpanStatus } from '@/lib/traceViewModel'

defineProps<{ status: TraceSpanStatus }>()
</script>

<style lang="scss" scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &.ok { color: var(--success); }
  &.error { color: var(--error); }
  &.pending { color: var(--accent-primary); }
}

.spin {
  animation: spin 1s linear infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
