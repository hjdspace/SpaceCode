<template>
  <div v-if="teamContext" class="team-status-bar">
    <div class="team-summary">
      <Users :size="14" />
      <span class="team-name">{{ teamContext.teamName }}</span>
      <span class="team-count">{{ teammateEntries.length }} members</span>
    </div>

    <div class="teammate-tabs">
      <button
        v-for="[taskId, teammate] in teammateEntries"
        :key="taskId"
        class="teammate-tab"
        :class="[`color-${teammate.color}`, { active: taskId === viewingAgentTaskId }]"
        type="button"
        @click="$emit('view-teammate', taskId)"
      >
        <span class="color-dot"></span>
        <span class="teammate-name">{{ teammate.name }}</span>
        <span v-if="teammate.messageCount" class="message-count">{{ teammate.messageCount }}</span>
        <span class="status-icon" :class="teammate.status">
          <span v-if="teammate.status === 'running'" class="running-dot"></span>
          <Check v-else-if="teammate.status === 'completed'" :size="12" />
          <X v-else-if="teammate.status === 'failed'" :size="12" />
          <span v-else class="idle-dot"></span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Check, Users, X } from 'lucide-vue-next'
import type { TeamContext } from '@/types'

const props = defineProps<{
  teamContext: TeamContext | null
  viewingAgentTaskId?: string
}>()

defineEmits<{
  'view-teammate': [taskId: string]
}>()

const teammateEntries = computed(() =>
  Object.entries(props.teamContext?.teammates || {})
)
</script>

<style lang="scss" scoped>
.team-status-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 8px 16px;
  border-top: 1px solid var(--surface-border);
  background: var(--surface-glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  overflow: hidden;
}

.team-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.team-name {
  color: var(--text-primary);
  font-weight: 600;
}

.team-count {
  color: var(--text-muted);
}

.teammate-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
}

.teammate-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: all var(--transition-fast);
  white-space: nowrap;

  &:hover,
  &.active {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }

  &.active {
    border-color: currentColor;
  }
}

.color-dot,
.running-dot,
.idle-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.message-count {
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
  color: var(--text-muted);
  font-size: 10px;
  line-height: 16px;
}

.status-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &.completed {
    color: var(--success);
  }

  &.failed {
    color: var(--error);
  }
}

.running-dot {
  background: var(--accent-primary);
  animation: team-status-pulse 1.2s ease-in-out infinite;
}

.idle-dot {
  background: var(--text-muted);
}

.color-red .color-dot { background: #ef4444; }
.color-blue .color-dot { background: #3b82f6; }
.color-green .color-dot { background: #22c55e; }
.color-yellow .color-dot { background: #eab308; }
.color-purple .color-dot { background: #a855f7; }
.color-orange .color-dot { background: #f97316; }
.color-pink .color-dot { background: #ec4899; }
.color-cyan .color-dot { background: #06b6d4; }

@keyframes team-status-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.75); }
}
</style>
