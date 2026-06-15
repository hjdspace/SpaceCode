<template>
  <span class="type-icon" :class="[kind, status]" :title="`${kind} · ${status}`">
    <span class="type-icon-inner">
      <Bot v-if="kind === 'llm'" :size="11" aria-hidden="true" />
      <Wrench v-else-if="kind === 'tool' || kind === 'tool_result'" :size="11" aria-hidden="true" />
      <User v-else-if="kind === 'message'" :size="11" aria-hidden="true" />
      <Zap v-else-if="kind === 'event'" :size="11" aria-hidden="true" />
      <Layers v-else-if="kind === 'session'" :size="11" aria-hidden="true" />
      <GitBranch v-else-if="kind === 'turn'" :size="11" aria-hidden="true" />
      <Circle v-else :size="11" aria-hidden="true" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { Bot, Wrench, User, Zap, Layers, GitBranch, Circle } from 'lucide-vue-next'
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
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex-shrink: 0;
  position: relative;

  .type-icon-inner {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border-radius: inherit;
  }

  // Background tints per kind
  &.llm .type-icon-inner {
    background: rgba(99, 102, 241, 0.12);
    color: #818cf8;
  }
  &.tool .type-icon-inner,
  &.tool_result .type-icon-inner {
    background: rgba(16, 185, 129, 0.12);
    color: #34d399;
  }
  &.message .type-icon-inner {
    background: rgba(139, 92, 246, 0.12);
    color: #a78bfa;
  }
  &.event .type-icon-inner {
    background: rgba(156, 163, 175, 0.12);
    color: #9ca3af;
  }
  &.session .type-icon-inner {
    background: rgba(245, 158, 11, 0.12);
    color: #fbbf24;
  }
  &.turn .type-icon-inner {
    background: rgba(59, 130, 246, 0.12);
    color: #60a5fa;
  }

  // Status overrides
  &.error .type-icon-inner {
    background: rgba(239, 68, 68, 0.12);
    color: #f87171;
  }
  &.pending .type-icon-inner {
    animation: icon-pulse 2s ease-in-out infinite;
  }
}

@keyframes icon-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
