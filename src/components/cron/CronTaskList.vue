<template>
  <div class="cron-task-list">
    <!-- Statistics Cards -->
    <div class="cron-stats">
      <div class="stat-card total">
        <div class="stat-label">{{ t('cron.statsAll') }}</div>
        <div class="stat-value">{{ cronStore.totalCount }}</div>
      </div>
      <div class="stat-card enabled">
        <div class="stat-label">{{ t('cron.statsEnabled') }}</div>
        <div class="stat-value">{{ cronStore.enabledCount }}</div>
      </div>
      <div class="stat-card disabled">
        <div class="stat-label">{{ t('cron.statsDisabled') }}</div>
        <div class="stat-value">{{ cronStore.disabledCount }}</div>
      </div>
      <div class="stat-card oneshot">
        <div class="stat-label">{{ t('cron.statsOneShot') }}</div>
        <div class="stat-value">{{ cronStore.oneShotCount }}</div>
      </div>
    </div>

    <!-- Task List Content -->
    <div class="cron-content">
      <div class="task-list-header">
        <div class="task-list-title">{{ t('cron.taskList') }}</div>
        <div class="task-filter-group">
          <button
            class="task-filter-btn"
            :class="{ active: filter === 'all' }"
            @click="filter = 'all'"
          >{{ t('cron.filterAll') }}</button>
          <button
            class="task-filter-btn"
            :class="{ active: filter === 'enabled' }"
            @click="filter = 'enabled'"
          >{{ t('cron.filterEnabled') }}</button>
          <button
            class="task-filter-btn"
            :class="{ active: filter === 'disabled' }"
            @click="filter = 'disabled'"
          >{{ t('cron.filterDisabled') }}</button>
          <button
            class="task-filter-btn"
            :class="{ active: filter === 'oneshot' }"
            @click="filter = 'oneshot'"
          >{{ t('cron.filterOneShot') }}</button>
        </div>
      </div>

      <div class="task-list">
        <CronTaskRow
          v-for="task in filteredTasks"
          :key="task.id"
          :task="task"
          :expanded="cronStore.expandedTaskId === task.id"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCronStore } from '@/stores/cron'
import CronTaskRow from './CronTaskRow.vue'

type FilterType = 'all' | 'enabled' | 'disabled' | 'oneshot'

const { t } = useI18n()
const cronStore = useCronStore()
const filter = ref<FilterType>('all')

const filteredTasks = computed(() => {
  const tasks = cronStore.tasks
  switch (filter.value) {
    case 'enabled':
      return tasks.filter(t => t.enabled !== false)
    case 'disabled':
      return tasks.filter(t => t.enabled === false)
    case 'oneshot':
      return tasks.filter(t => !t.recurring)
    default:
      return tasks
  }
})
</script>

<style lang="scss" scoped>
.cron-task-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cron-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 20px 28px;
  flex-shrink: 0;
}

.stat-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  transition: all var(--transition-fast);

  &:hover {
    border-color: var(--border-default);
    box-shadow: var(--shadow-sm);
  }

  &.total .stat-value { color: var(--accent-secondary); }
  &.enabled .stat-value { color: var(--success); }
  &.disabled .stat-value { color: var(--warning); }
  &.oneshot .stat-value { color: var(--accent-primary); }
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
}

.cron-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 28px 28px;
}

.task-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.task-list-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.task-filter-group {
  display: flex;
  gap: 4px;
}

.task-filter-btn {
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  color: var(--text-muted);
  transition: all var(--transition-fast);
  border: none;
  background: none;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  &.active {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
    font-weight: 500;
  }
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
