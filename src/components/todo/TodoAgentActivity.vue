<template>
  <PopoverPanel :open="open" :anchor="anchor" @close="emit('close')">
    <div class="agent-activity" data-testid="todo-agent-activity">
      <header class="activity-head">
        <span class="activity-icon"><Sparkles :size="14" /></span>
        <div class="activity-heads">
          <div class="activity-title">{{ t('todo.agent.title') }}</div>
          <div class="activity-subtitle">{{ t('todo.agent.subtitle') }}</div>
        </div>
        <button
          v-if="operations.length > 0"
          type="button"
          class="activity-clear"
          :title="t('todo.agent.clear')"
          :aria-label="t('todo.agent.clear')"
          @click="todoStore.clearAgentActivity()"
        >
          <Eraser :size="13" />
        </button>
      </header>

      <div v-if="operations.length === 0" class="activity-empty">
        <Bot :size="20" />
        <span class="empty-title">{{ t('todo.agent.empty') }}</span>
        <span class="empty-hint">{{ t('todo.agent.hint') }}</span>
      </div>

      <div v-else class="activity-list">
        <div v-for="(operation, index) in operations" :key="`${operation.todoId}-${index}`" class="activity-item">
          <span class="item-icon" :class="`is-${operation.action}`">
            <component :is="actionIcon(operation.action)" :size="12" />
          </span>
          <div class="item-body">
            <div class="item-line">
              <span class="item-action">{{ t(`todo.agent.${operation.action}`) }}</span>
              <button
                v-if="exists(operation.todoId)"
                type="button"
                class="item-title"
                :title="t('todo.agent.openTodo')"
                @click="openTodo(operation.todoId)"
              >
                {{ operation.title }}
              </button>
              <span v-else class="item-title is-gone">{{ operation.title }}</span>
            </div>
            <span v-if="operation.sessionId" class="item-session">
              <MessageSquare :size="10" />
              {{ t('todo.agent.session', { id: operation.sessionId.slice(0, 8) }) }}
            </span>
          </div>
          <button
            v-if="exists(operation.todoId)"
            type="button"
            class="item-agent"
            :title="t('todo.agent.askAgent')"
            :aria-label="t('todo.agent.askAgent')"
            @click="askAgent(operation.todoId)"
          >
            <AtSign :size="12" />
          </button>
        </div>
      </div>
    </div>
  </PopoverPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AtSign,
  Bot,
  Check,
  Eraser,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-vue-next'
import PopoverPanel from '@/components/common/PopoverPanel.vue'
import { useTodoStore } from '@/stores/todo'
import { useTodoActions } from '@/composables/useTodoActions'
import type { TodoAgentOperation } from '@/shared/channels/todo'

defineProps<{
  open: boolean
  anchor: HTMLElement | null
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const todoStore = useTodoStore()
const { handToAgent } = useTodoActions()

const operations = computed(() => todoStore.agentActivity)

function actionIcon(action: TodoAgentOperation['action']) {
  switch (action) {
    case 'created':
      return Plus
    case 'completed':
      return Check
    case 'reopened':
      return RotateCcw
    case 'deleted':
      return Trash2
    default:
      return Pencil
  }
}

function exists(id: string): boolean {
  return todoStore.findTodo(id) !== null
}

function openTodo(id: string): void {
  emit('close')
  todoStore.openDetail(id)
}

function askAgent(id: string): void {
  const todo = todoStore.findTodo(id)
  if (!todo) return
  emit('close')
  handToAgent(todo)
}
</script>

<style lang="scss" scoped>
.agent-activity {
  width: 320px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
}

.activity-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(
    120deg,
    color-mix(in srgb, var(--todo-hue-violet) 12%, transparent),
    color-mix(in srgb, var(--todo-hue-magenta) 8%, transparent)
  );
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.activity-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--todo-hue-violet) 20%, transparent);
  color: var(--todo-hue-violet);
}

.activity-heads {
  min-width: 0;
}

.activity-title {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.activity-subtitle {
  font-size: var(--text-2xs);
  color: var(--text-muted);
}

.activity-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.activity-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 16px;
  text-align: center;
  color: var(--text-disabled);
}

.empty-title {
  font-size: var(--text-md);
  color: var(--text-secondary);
}

.empty-hint {
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text-disabled);
}

.activity-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;

  @include scrollbar-thin;
}

.activity-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);

    .item-agent {
      opacity: 1;
    }
  }
}

.item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  color: var(--todo-hue-violet);
  background: color-mix(in srgb, var(--todo-hue-violet) 14%, transparent);

  &.is-created {
    color: var(--todo-hue-teal);
    background: color-mix(in srgb, var(--todo-hue-teal) 14%, transparent);
  }

  &.is-completed {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }

  &.is-reopened {
    color: var(--todo-hue-amber);
    background: color-mix(in srgb, var(--todo-hue-amber) 14%, transparent);
  }

  &.is-deleted {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 14%, transparent);
  }
}

.item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-line {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.item-action {
  flex-shrink: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.item-title {
  padding: 0;
  border: none;
  background: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-md);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    color: var(--accent-primary);
    text-decoration: underline;
  }

  &.is-gone {
    color: var(--text-disabled);
    text-decoration: line-through;
    cursor: default;
  }
}

.item-session {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-2xs);
  color: var(--text-disabled);
  font-variant-numeric: tabular-nums;
}

.item-agent {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }
}
</style>