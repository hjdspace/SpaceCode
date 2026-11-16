<template>
  <div class="todo-empty">
    <div class="empty-orb" :class="`is-${key}`" aria-hidden="true">
      <component :is="icon" :size="26" />
    </div>
    <div class="empty-title">{{ t(`todo.empty.${key}Title`) }}</div>
    <p class="empty-body">{{ t(`todo.empty.${key}Body`) }}</p>
    <div class="empty-actions">
      <button v-if="searching" class="empty-btn" type="button" @click="todoStore.search = ''">
        <Eraser :size="14" />
        {{ t('todo.empty.clearSearch') }}
      </button>
      <template v-else>
        <button class="empty-btn is-primary" type="button" @click="emit('create')">
          <Plus :size="14" />
          {{ t('todo.empty.cta') }}
        </button>
        <button class="empty-btn" type="button" @click="askAgent">
          <Sparkles :size="14" />
          {{ t('todo.empty.askAgent') }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarCheck, CalendarRange, CheckCircle2, Eraser, FolderOpen, Plus, SearchX, Sparkles } from 'lucide-vue-next'
import { useTodoStore } from '@/stores/todo'
import { useAppStore } from '@/stores/app'

const emit = defineEmits<{
  create: []
}>()

const { t } = useI18n()
const todoStore = useTodoStore()
const appStore = useAppStore()

const searching = computed(() => todoStore.search.trim().length > 0)

const key = computed(() => {
  if (searching.value) return 'search'
  return todoStore.view
})

const icon = computed(() => {
  switch (key.value) {
    case 'today':
      return CalendarCheck
    case 'upcoming':
      return CalendarRange
    case 'completed':
      return CheckCircle2
    case 'group':
      return FolderOpen
    case 'search':
      return SearchX
    default:
      return CalendarCheck
  }
})

function askAgent(): void {
  appStore.showTodoManager = false
  appStore.activeCenterTab = 'chat'
  appStore.pushToInput({ text: t('todo.agent.draftPrompt'), replace: true })
}
</script>

<style lang="scss" scoped>
.todo-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 48px 24px;
  max-width: 460px;
  margin: 0 auto;
}

.empty-orb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: var(--radius-full);
  color: var(--accent-primary);
  background:
    radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--todo-hue-teal) 26%, transparent), transparent 70%),
    linear-gradient(140deg, color-mix(in srgb, var(--todo-hue-blue) 18%, transparent), color-mix(in srgb, var(--todo-hue-violet) 16%, transparent));
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm);

  &.is-completed {
    color: var(--success);
    background:
      radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--todo-hue-green) 26%, transparent), transparent 70%),
      linear-gradient(140deg, color-mix(in srgb, var(--todo-hue-teal) 16%, transparent), color-mix(in srgb, var(--todo-hue-cyan) 16%, transparent));
  }

  &.is-upcoming {
    color: var(--todo-hue-blue);
  }

  &.is-group {
    color: var(--todo-hue-violet);
    background:
      radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--todo-hue-violet) 24%, transparent), transparent 70%),
      linear-gradient(140deg, color-mix(in srgb, var(--todo-hue-magenta) 16%, transparent), color-mix(in srgb, var(--todo-hue-blue) 16%, transparent));
  }

  &.is-search {
    color: var(--text-muted);
    background: var(--bg-tertiary);
  }
}

.empty-title {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.empty-body {
  margin: 0;
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
  color: var(--text-muted);
}

.empty-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 4px;
}

.empty-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: var(--text-md);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }

  &.is-primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--bg-elevated);

    &:hover {
      background: var(--accent-primary-hover);
    }
  }
}
</style>