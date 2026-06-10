<template>
  <div class="cron-manager">
    <div class="cron-top-bar">
      <button class="back-btn" @click="handleClose" :title="t('cron.backToChat')">
        <ArrowLeft :size="18" />
      </button>
    </div>
    <CronEmptyState v-if="cronStore.tasks.length === 0 && !cronStore.loading" @create="showNewTaskModal = true" />
    <template v-else>
      <div class="cron-header">
        <div class="cron-header-left">
          <div class="cron-header-icon">
            <Clock :size="20" />
          </div>
          <div>
            <div class="cron-title">{{ t('cron.title') }}</div>
            <div class="cron-subtitle">{{ t('cron.subtitle') }}</div>
          </div>
        </div>
        <button class="btn-create" @click="showNewTaskModal = true">
          <Plus :size="16" />
          {{ t('cron.newTask') }}
        </button>
      </div>
      <CronTaskList />
    </template>
    <NewCronTaskModal v-model:visible="showNewTaskModal" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Clock, Plus, ArrowLeft } from 'lucide-vue-next'
import { useCronStore } from '@/stores/cron'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import CronTaskList from './CronTaskList.vue'
import CronEmptyState from './CronEmptyState.vue'
import NewCronTaskModal from './NewCronTaskModal.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const cronStore = useCronStore()
const appStore = useAppStore()
const showNewTaskModal = ref(false)

let unsubscribeFired: (() => void) | null = null
let unsubscribeCompleted: (() => void) | null = null

onMounted(async () => {
  const projectRoot = appStore.projectRoot
  if (projectRoot) {
    await cronStore.fetchTasks(projectRoot)
  }
  unsubscribeFired = api.cron.onTaskFired?.(() => {
    if (projectRoot) cronStore.fetchTasks(projectRoot)
  }) || null
  unsubscribeCompleted = api.cron.onRunCompleted?.(() => {
    if (projectRoot) cronStore.fetchTasks(projectRoot)
  }) || null
})

onUnmounted(() => {
  unsubscribeFired?.()
  unsubscribeCompleted?.()
})

function handleClose() {
  appStore.showCronManager = false
}
</script>

<style lang="scss" scoped>
.cron-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.cron-top-bar {
  padding: 12px 16px 0;
  flex-shrink: 0;
}

.cron-header {
  padding: 20px 28px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.cron-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.cron-header-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cron-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.cron-subtitle {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 1px;
}

.btn-create {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  box-shadow: 0 1px 3px rgba(13, 148, 136, 0.25);

  &:hover {
    background: var(--accent-primary-hover);
    box-shadow: 0 2px 8px rgba(13, 148, 136, 0.3);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
}
</style>
