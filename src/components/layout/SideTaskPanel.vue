<template>
  <div class="side-task-panel">
    <div class="side-task-bar">
      <div class="side-task-tabs">
        <div
          v-for="task in appStore.sideTasks"
          :key="task.sessionId"
          class="side-task-tab"
          :class="{ active: task.sessionId === appStore.activeSideTaskSessionId }"
          role="button"
          tabindex="0"
          :title="task.title"
          @click="appStore.selectSideTask(task.sessionId)"
          @keydown.enter.prevent="appStore.selectSideTask(task.sessionId)"
        >
          <MessagesSquare :size="12" class="tab-icon" />
          <span class="tab-label">{{ task.title }}</span>
          <span v-if="turnStore.getIsLoading(task.sessionId)" class="tab-running" aria-hidden="true" />
          <button
            class="tab-close"
            type="button"
            :aria-label="t('common.close')"
            :title="t('common.close')"
            @click.stop="appStore.closeSideTask(task.sessionId)"
          >
            <X :size="11" />
          </button>
        </div>
      </div>
      <button
        class="side-task-add"
        type="button"
        :aria-label="t('sideTask.newTask')"
        :title="t('sideTask.newTask')"
        @click="appStore.addSideTask()"
      >
        <Plus :size="13" />
      </button>
    </div>

    <p class="side-task-hint">{{ t('sideTask.tempHint') }}</p>

    <ChatPanel
      v-if="appStore.activeSideTaskSessionId"
      :key="appStore.activeSideTaskSessionId"
      :session-id="appStore.activeSideTaskSessionId"
      compact
    />
    <div v-else class="side-task-empty">
      <p>{{ t('sideTask.empty') }}</p>
      <button type="button" class="side-task-create" @click="appStore.addSideTask()">
        {{ t('sideTask.newTask') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { MessagesSquare, Plus, X } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useTurnStore } from '@/stores/turn'
import ChatPanel from './ChatPanel.vue'

const appStore = useAppStore()
const turnStore = useTurnStore()
const { t } = useI18n()
</script>

<style lang="scss" scoped>
.side-task-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.side-task-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 8px 10px 0;
}

.side-task-tabs {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.side-task-tab {
  display: inline-flex;
  height: 26px;
  max-width: 160px;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  padding: 0 6px 0 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: var(--surface-hover);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);

  &:hover {
    background: var(--surface-active);
    color: var(--text-primary);
  }

  &.active {
    border-color: var(--surface-border-strong);
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .tab-icon {
    flex-shrink: 0;
  }

  .tab-label {
    min-width: 0;
    overflow: hidden;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.tab-running {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--accent-primary);
  animation: side-task-pulse 1.2s ease-in-out infinite;
}

@keyframes side-task-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.tab-close {
  display: flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--surface-active);
    color: var(--text-primary);
  }
}

.side-task-add {
  display: flex;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);

  &:hover {
    background: var(--surface-hover);
    color: var(--accent-secondary);
  }
}

.side-task-hint {
  flex-shrink: 0;
  margin: 6px 12px 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.side-task-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.side-task-create {
  padding: 6px 14px;
  border: 1px solid var(--surface-border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-hover);
  color: var(--text-primary);
  font-size: var(--text-xs);
  cursor: pointer;

  &:hover {
    background: var(--surface-active);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tab-running {
    animation: none;
  }
}
</style>
