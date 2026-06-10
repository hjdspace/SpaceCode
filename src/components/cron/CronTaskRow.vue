<template>
  <div class="task-row" :class="{ disabled: task.enabled === false }">
    <div class="task-row-main">
      <div class="task-status-dot" :class="statusClass"></div>
      <div class="task-info">
        <div class="task-name-row">
          <span class="task-name">{{ task.name || task.id }}</span>
          <span class="task-badge" :class="task.recurring !== false ? 'recurring' : 'oneshot'">
            {{ task.recurring !== false ? t('cron.recurring') : t('cron.oneShot') }}
          </span>
        </div>
        <div class="task-meta">
          <span class="task-meta-item">
            <Clock :size="13" />
            {{ humanFrequency }}
          </span>
          <span class="task-cron-expr">{{ task.cron }}</span>
          <span v-if="task.enabled === false" class="task-meta-item task-disabled-label">
            {{ t('cron.disabled') }}
          </span>
          <span v-else class="task-meta-item task-next-fire">
            <RotateCcw :size="13" />
            {{ t('cron.nextFire') }}: {{ nextFireText }}
          </span>
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn primary" :title="t('cron.runNow')" @click="handleRunNow">
          <Play :size="16" />
        </button>
        <button class="task-action-btn" :title="t('cron.viewRuns')" @click="handleToggleExpanded">
          <FileText :size="16" />
        </button>
        <button class="task-action-btn" :title="t('cron.edit')" @click="handleEdit">
          <Pencil :size="16" />
        </button>
        <button class="task-action-btn" :title="task.enabled === false ? t('cron.enable') : t('cron.disable')" @click="handleToggle">
          <PowerOff v-if="task.enabled !== false" :size="16" />
          <Power v-else :size="16" />
        </button>
        <button class="task-action-btn danger" :title="t('cron.delete')" @click="handleDelete">
          <Trash2 :size="16" />
        </button>
      </div>
    </div>
    <CronRunsPanel v-if="expanded" :task-id="task.id" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Clock, Play, FileText, Pencil, PowerOff, Power, Trash2, RotateCcw } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useCronStore, type CronTask } from '@/stores/cron'
import { useAppStore } from '@/stores/app'
import { cronToHuman, computeNextCronRun, formatNextFire } from '@/lib/cronHelper'
import CronRunsPanel from './CronRunsPanel.vue'

const props = defineProps<{
  task: CronTask
  expanded: boolean
}>()

const { t } = useI18n()
const cronStore = useCronStore()
const appStore = useAppStore()

const statusClass = computed(() => {
  if (props.task.enabled === false) return 'paused'
  return 'active'
})

const humanFrequency = computed(() => cronToHuman(props.task.cron))

const nextFireText = computed(() => {
  const next = computeNextCronRun(props.task.cron)
  return formatNextFire(next)
})

function handleRunNow() {
  const projectRoot = appStore.projectRoot
  if (projectRoot) {
    cronStore.runTaskNow(projectRoot, props.task.id)
  }
}

function handleToggleExpanded() {
  cronStore.toggleExpanded(props.task.id)
}

function handleEdit() {
  // TODO: emit or navigate to edit modal
}

function handleToggle() {
  const projectRoot = appStore.projectRoot
  if (projectRoot) {
    cronStore.toggleTask(projectRoot, props.task.id, props.task.enabled === false)
  }
}

function handleDelete() {
  const name = props.task.name || props.task.id
  const confirmed = window.confirm(
    t('cron.deleteConfirm', { name })
  )
  if (!confirmed) return
  const projectRoot = appStore.projectRoot
  if (projectRoot) {
    cronStore.deleteTask(projectRoot, props.task.id)
  }
}
</script>

<style lang="scss" scoped>
.task-row {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  transition: all var(--transition-fast);

  &:hover {
    border-color: var(--border-default);
    box-shadow: var(--shadow-sm);
  }

  &.disabled {
    opacity: 0.6;
  }
}

.task-row-main {
  display: flex;
  align-items: center;
  gap: 14px;
}

.task-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.active {
    background: var(--success);
    box-shadow: 0 0 6px var(--success-glow);
  }

  &.paused {
    background: var(--warning);
  }

  &.stopped {
    background: var(--text-disabled);
  }
}

.task-info {
  flex: 1;
  min-width: 0;
}

.task-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.task-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;

  &.recurring {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }

  &.oneshot {
    background: var(--accent-secondary-glow);
    color: var(--accent-secondary);
  }
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.task-meta-item {
  display: flex;
  align-items: center;
  gap: 4px;

  :deep(svg) {
    opacity: 0.7;
  }
}

.task-cron-expr {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-disabled);
  background: var(--bg-secondary);
  padding: 1px 5px;
  border-radius: var(--radius-xs);
}

.task-next-fire {
  color: var(--accent-primary);
  font-weight: 500;
}

.task-disabled-label {
  color: var(--warning);
  font-weight: 500;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.task-action-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: all var(--transition-fast);
  border: none;
  background: none;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.danger:hover {
    background: var(--error-glow);
    color: var(--error);
  }

  &.primary:hover {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }
}
</style>
