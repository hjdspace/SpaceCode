<template>
  <div class="task-runs-panel">
    <div class="runs-header">
      <span class="runs-title">{{ t('cron.runsTitle') }}</span>
      <button class="runs-close-btn" @click="handleClose">
        <X :size="14" />
      </button>
    </div>
    <div v-if="runs.length === 0" class="runs-empty">
      {{ t('cron.viewRuns') }}
    </div>
    <div v-else class="runs-list">
      <div class="run-item" v-for="run in runs" :key="run.id">
        <div class="run-status-icon" :class="run.status">
          <Check v-if="run.status === 'completed'" :size="10" />
          <X v-else-if="run.status === 'failed' || run.status === 'timeout'" :size="10" />
          <Loader v-else :size="10" class="spin" />
        </div>
        <div class="run-info">
          <div class="run-time">{{ formatRunTime(run.startedAt) }}</div>
          <div class="run-detail">
            {{ run.status === 'completed' ? t('cron.runCompleted') : run.status === 'failed' ? t('cron.runFailed') : run.status === 'timeout' ? t('cron.runTimeout') : t('cron.runRunning') }}
            <template v-if="run.durationMs"> · {{ t('cron.duration') }} {{ formatDuration(run.durationMs) }}</template>
          </div>
        </div>
        <button class="run-output-btn" @click="handleViewOutput(run)">
          {{ run.status === 'failed' || run.status === 'timeout' ? t('cron.viewError') : t('cron.viewOutput') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Check, X, Loader } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useCronStore, type TaskRun } from '@/stores/cron'
import { useAppStore } from '@/stores/app'
import { formatDuration } from '@/lib/cronHelper'

const props = defineProps<{
  taskId: string
}>()

const { t } = useI18n()
const cronStore = useCronStore()
const appStore = useAppStore()

const runs = computed(() => cronStore.taskRunsMap[props.taskId] || [])

onMounted(() => {
  const projectRoot = appStore.projectRoot
  if (projectRoot) {
    cronStore.fetchTaskRuns(projectRoot, props.taskId)
  }
})

function handleClose() {
  cronStore.toggleExpanded(props.taskId)
}

function formatRunTime(isoStr: string): string {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${min}`
}

function handleViewOutput(run: TaskRun) {
  // TODO: open output viewer or navigate to session
  console.log('View output for run:', run.id, run.output || run.error)
}
</script>

<style lang="scss" scoped>
.task-runs-panel {
  margin-top: 12px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 12px;
}

.runs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.runs-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.runs-close-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  transition: all var(--transition-fast);
  border: none;
  background: none;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.runs-empty {
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px 0;
}

.runs-list {
  display: flex;
  flex-direction: column;
}

.run-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.run-status-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &.completed {
    background: var(--success-glow);
    color: var(--success);
  }

  &.failed,
  &.timeout {
    background: var(--error-glow);
    color: var(--error);
  }

  &.running {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
    animation: pulse 2s infinite;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.run-info {
  flex: 1;
  min-width: 0;
}

.run-time {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.run-detail {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 1px;
}

.run-output-btn {
  font-size: 11px;
  color: var(--accent-primary);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  transition: all var(--transition-fast);
  border: none;
  background: none;
  cursor: pointer;

  &:hover {
    background: var(--accent-primary-glow);
  }
}
</style>
