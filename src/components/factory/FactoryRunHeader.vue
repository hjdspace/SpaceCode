<template>
  <header class="run-header">
    <div class="rh-row">
      <div class="rh-title">
        <h2>{{ t('factory.boardTitle') }}</h2>
        <span class="pill" :class="statusClass" data-run-status>{{ t(statusKey) }}</span>
        <span class="pill run-id">{{ t('factory.run.id', { id: run.id }) }}</span>
      </div>

      <div class="rh-stats">
        <span class="stat">
          <span class="stat-label">{{ t('factory.run.concurrencyLabel') }}</span>
          <b data-run-concurrency>{{ t('factory.run.concurrency', { running, max: run.maxConcurrency }) }}</b>
        </span>
        <span class="stat">
          <span class="stat-label">{{ t('factory.run.spend') }}</span>
          <b data-run-spend>${{ run.spendUsd.toFixed(2) }}</b>
        </span>
        <span class="stat">
          <span class="stat-label">{{ t('factory.run.elapsed') }}</span>
          <b data-run-elapsed>{{ formatClock(run.elapsedMs) }}</b>
        </span>
      </div>

      <div class="rh-actions">
        <button
          class="control-btn"
          data-run-pause
          :disabled="!canControl"
          :title="canControl ? t('factory.run.pause') : t('factory.run.disabledHint')"
          @click="emit('pause')"
        >
          <Pause :size="13" />
          {{ t('factory.run.pause') }}
        </button>
        <button
          class="control-btn danger"
          data-run-stop
          :disabled="!canControl"
          :title="canControl ? t('factory.run.stop') : t('factory.run.disabledHint')"
          @click="emit('stop')"
        >
          <Square :size="13" />
          {{ t('factory.run.stop') }}
        </button>
      </div>
    </div>

    <div class="pipeline">
      <span
        v-for="segment in FACTORY_SEGMENTS"
        :key="segment.key"
        class="pseg"
        :data-segment="segment.key"
      >
        <i :style="{ background: segment.color }" />
        <span>{{ t(segment.labelKey) }}</span>
        <b data-segment-count>{{ counts[segment.key] }}</b>
      </span>
    </div>

    <p v-if="!canControl" class="disabled-hint" data-run-disabled-hint>
      {{ t('factory.run.disabledHint') }}
    </p>

    <div v-if="attention.length" class="attention">
      <span class="a-label">
        <AlertTriangle :size="13" />
        {{ t('factory.run.attention', { count: attention.length }) }}
      </span>
      <div class="a-items">
        <button
          v-for="task in attention"
          :key="task.id"
          class="a-chip"
          @click="emit('select', task.id)"
        >
          <span class="mono">{{ task.id }}</span>
          <span>{{ t('factory.run.attentionItem') }}</span>
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Pause, Square } from 'lucide-vue-next'
import type { FactoryRun, FactoryTask } from '@/shared/factory'
import { FACTORY_SEGMENTS, formatClock, laneCounts } from '@/stores/factory/board'

const props = defineProps<{
  run: FactoryRun
  tasks: FactoryTask[]
}>()

const emit = defineEmits<{ pause: []; stop: []; select: [id: string] }>()

const { t } = useI18n()

const counts = computed(() => laneCounts(props.tasks))
const running = computed(() => counts.value.implementing + counts.value.reviewing)
const canControl = computed(() => props.run.status === 'running' || props.run.status === 'paused')
const attention = computed(() => props.tasks.filter((task) => task.lane === 'blocked'))

const statusKey = computed(() => {
  if (props.run.status === 'running' && props.run.paused) return 'factory.run.status.paused'
  return `factory.run.status.${props.run.status}`
})

const statusClass = computed(() => {
  if (props.run.status === 'running' && props.run.paused) return 'paused'
  return props.run.status
})
</script>

<style lang="scss" scoped>
.run-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-elevated);
}

.rh-row {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
}

.rh-title {
  display: flex;
  align-items: center;
  gap: 8px;

  h2 {
    margin: 0;
    font-size: var(--text-base, 14px);
    font-weight: 600;
    color: var(--text-primary);
  }
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--surface-glass);
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  &.running {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }

  &.paused {
    background: var(--warning-glow);
    color: var(--warning);
  }

  &.stopped {
    background: var(--surface-glass);
    color: var(--text-disabled);
  }

  &.run-id {
    font-family: var(--font-mono);
  }
}

.rh-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}

.stat {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  b {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--text-primary);
  }
}

.rh-actions {
  display: flex;
  gap: 6px;
}

.control-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-2xs, 11px);
  cursor: pointer;

  &:disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
    opacity: 0.6;
  }

  &.danger:not(:disabled) {
    color: var(--error);
    border-color: var(--error);
  }
}

.pipeline {
  display: flex;
  gap: 4px;
}

.pseg {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-glass);
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  b {
    margin-left: auto;
    font-weight: 600;
    color: var(--text-secondary);
  }
}

.disabled-hint {
  margin: 0;
  font-size: var(--text-2xs, 11px);
  color: var(--text-disabled);
}

.attention {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.a-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-2xs, 11px);
  color: var(--warning);
}

.a-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.a-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--warning-glow);
  border-radius: var(--radius-full);
  background: var(--warning-glow);
  color: var(--warning);
  font-size: var(--text-2xs, 11px);
  cursor: pointer;

  .mono {
    font-family: var(--font-mono);
  }
}
</style>
