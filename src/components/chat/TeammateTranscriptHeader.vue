<template>
  <div v-if="teammate" class="teammate-transcript-header" :class="`color-${teammate.color}`">
    <button class="back-button" type="button" @click="$emit('back')">
      <ArrowLeft :size="14" />
      Back to Leader
    </button>

    <div class="viewing-info">
      <span class="color-dot"></span>
      <span class="label">Viewing</span>
      <span class="name">@{{ teammate.name }}</span>
      <span class="status" :class="teammate.status">{{ teammate.status }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import type { TeamContext } from '@/types'

defineProps<{
  teammate: TeamContext['teammates'][string] | null
}>()

defineEmits<{
  back: []
}>()
</script>

<style lang="scss" scoped>
.teammate-transcript-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-secondary);
}

.back-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: all var(--transition-fast);

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }
}

.viewing-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}

.color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.label {
  color: var(--text-muted);
}

.name {
  color: var(--text-primary);
  font-weight: 600;
}

.status {
  padding: 2px 7px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
  color: var(--text-muted);
  font-size: 10px;
  text-transform: uppercase;

  &.running { color: var(--accent-primary); }
  &.completed { color: var(--success); }
  &.failed { color: var(--error); }
}

.color-red .color-dot { background: #ef4444; }
.color-blue .color-dot { background: #3b82f6; }
.color-green .color-dot { background: #22c55e; }
.color-yellow .color-dot { background: #eab308; }
.color-purple .color-dot { background: #a855f7; }
.color-orange .color-dot { background: #f97316; }
.color-pink .color-dot { background: #ec4899; }
.color-cyan .color-dot { background: #06b6d4; }
</style>
