<template>
  <div class="task-list-card" :class="{ collapsed: !isExpanded }">
    <button class="task-list-header" type="button" @click="toggleExpand">
      <div class="header-title">
        <ListChecks :size="16" />
        <span>{{ title }}</span>
      </div>
      <ChevronDown :size="15" class="expand-icon" :class="{ expanded: isExpanded }" />
    </button>

    <div v-show="isExpanded" class="task-list-body">
      <div
        v-for="task in tasks"
        :key="task.id || task.content"
        class="task-row"
        :class="task.status"
      >
        <span class="task-status-icon">
          <CheckCircle2 v-if="task.status === 'completed'" :size="15" />
          <Loader2 v-else-if="task.status === 'in_progress'" :size="15" class="spin-icon" />
          <Circle v-else :size="15" />
        </span>
        <span class="task-content">{{ task.content }}</span>
        <span v-if="task.owner" class="task-owner">{{ task.owner }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckCircle2, ChevronDown, Circle, ListChecks, Loader2 } from 'lucide-vue-next'

export interface TaskListItem {
  id?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string
}

const props = defineProps<{
  tasks: TaskListItem[]
}>()

const isExpanded = ref(true)

const title = computed(() => {
  const total = props.tasks.length
  const completed = props.tasks.filter((task) => task.status === 'completed').length
  return `进度更新 ${completed}/${total}`
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<style lang="scss" scoped>
.task-list-card {
  margin: 6px 0 10px;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--bg-primary);
  overflow: hidden;
}

.task-list-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}

.expand-icon {
  color: var(--text-muted);
  transition: transform var(--transition-fast);

  &.expanded {
    transform: rotate(180deg);
  }
}

.task-list-body {
  padding: 0 12px 12px 32px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.45;

  &.completed {
    color: var(--text-muted);

    .task-content {
      text-decoration: line-through;
    }

    .task-status-icon {
      color: var(--success);
    }
  }

  &.in_progress {
    color: var(--text-primary);

    .task-status-icon {
      color: var(--accent-primary);
    }
  }

  &.pending .task-status-icon {
    color: var(--text-muted);
  }
}

.task-status-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.task-content {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-owner {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
