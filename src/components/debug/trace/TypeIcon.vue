<template>
  <span class="type-icon" :class="[kind, status]" :title="`${kind} · ${status}`">
    <Bot v-if="kind === 'llm'" :size="12" aria-hidden="true" />
    <Wrench v-else-if="kind === 'tool' || kind === 'tool_result'" :size="12" aria-hidden="true" />
    <User v-else-if="kind === 'message'" :size="12" aria-hidden="true" />
    <Activity v-else-if="kind === 'event'" :size="12" aria-hidden="true" />
    <LayoutDashboard v-else-if="kind === 'session'" :size="12" aria-hidden="true" />
    <RotateCcw v-else-if="kind === 'turn'" :size="12" aria-hidden="true" />
    <Circle v-else :size="12" aria-hidden="true" />
  </span>
</template>

<script setup lang="ts">
import { Bot, Wrench, User, Activity, LayoutDashboard, RotateCcw, Circle } from 'lucide-vue-next'
import type { TraceSpanKind, TraceSpanStatus } from '@/lib/traceViewModel'

defineProps<{
  kind: TraceSpanKind
  status: TraceSpanStatus
}>()
</script>

<style lang="scss" scoped>
.type-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;

  &.llm { color: var(--accent-primary); }
  &.tool, &.tool_result { color: var(--success); }
  &.message { color: var(--accent-secondary); }
  &.event { color: var(--text-muted); }
  &.session { color: var(--text-primary); }
  &.turn { color: var(--text-secondary); }

  &.error { color: var(--error); }
  &.pending { color: var(--accent-primary); animation: pulse 2s infinite; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
