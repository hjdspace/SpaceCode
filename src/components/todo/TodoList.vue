<template>
  <div class="todo-list">
    <div v-if="todoStore.selectionCount > 0" class="bulk-bar">
      <span class="bulk-count">{{ t('todo.bulk.selected', { n: todoStore.selectionCount }) }}</span>
      <div class="bulk-actions">
        <button class="bulk-btn" type="button" @click="todoStore.bulkStatus(todoStore.selectedIds, 'completed')">
          <CheckCheck :size="13" />
          {{ t('todo.bulk.complete') }}
        </button>
        <button class="bulk-btn" type="button" @click="todoStore.bulkStatus(todoStore.selectedIds, 'open')">
          <RotateCcw :size="13" />
          {{ t('todo.bulk.reopen') }}
        </button>
        <select class="bulk-select" :value="''" :aria-label="t('todo.bulk.move')" @change="onBulkMove">
          <option value="" disabled>{{ t('todo.bulk.move') }}</option>
          <option value="__none__">{{ t('todo.nav.ungrouped') }}</option>
          <option v-for="group in todoStore.groups" :key="group.id" :value="group.id">{{ group.name }}</option>
        </select>
        <button class="bulk-btn is-danger" type="button" @click="onBulkRemove">
          <Trash2 :size="13" />
          {{ t('todo.bulk.remove') }}
        </button>
        <button class="bulk-btn is-ghost" type="button" :title="t('todo.bulk.clear')" @click="todoStore.clearSelection()">
          <X :size="13" />
        </button>
      </div>
    </div>

    <div v-else class="list-toolbar">
      <label class="select-all">
        <input
          type="checkbox"
          :checked="todoStore.allVisibleSelected"
          :disabled="todoStore.sortedTodos.length === 0"
          :aria-label="t('todo.bulk.selectAll')"
          @change="todoStore.toggleSelectAllVisible()"
        />
        <span class="select-box" aria-hidden="true"><Check :size="10" /></span>
      </label>
      <span class="toolbar-count">{{ t('todo.stats.open', { n: todoStore.sortedTodos.length }) }}</span>
      <span v-if="todoStore.sortMode === 'manual'" class="toolbar-hint">
        <GripVertical :size="12" />
        {{ t('todo.row.drag') }}
      </span>
    </div>

    <div class="list-scroll">
      <TransitionGroup name="todo-row" tag="div" class="list-rows">
        <TodoRow
          v-for="todo in todoStore.sortedTodos"
          :key="todo.id"
          :todo="todo"
          :selected="todoStore.selectedIds.includes(todo.id)"
          :selection-active="todoStore.selectionCount > 0"
          :active="todoStore.detailId === todo.id"
          :pending="todoStore.pendingIds.includes(todo.id)"
          :agent-touched="todoStore.agentHighlights[todo.id] !== undefined"
          :dragging="draggingId === todo.id"
          :drop-target="dropId === todo.id && draggingId !== todo.id"
          @toggle="todoStore.toggleStatus"
          @open="todoStore.openDetail"
          @select="todoStore.toggleSelect"
          @action="onRowAction"
          @drag-start="draggingId = $event"
          @drag-over="dropId = $event"
          @drop-on="onDrop"
          @drag-end="clearDrag"
        />
      </TransitionGroup>

      <TodoEmptyState v-if="todoStore.sortedTodos.length === 0 && !todoStore.loading" @create="emit('create')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CheckCheck, GripVertical, RotateCcw, Trash2, X } from 'lucide-vue-next'
import { useTodoStore } from '@/stores/todo'
import { useTodoActions } from '@/composables/useTodoActions'
import { useDialog } from '@/composables/useDialog'
import TodoRow from './TodoRow.vue'
import type { TodoRowAction } from './TodoRow.vue'
import TodoEmptyState from './TodoEmptyState.vue'
import type { Todo } from '@/shared/channels/todo'

const emit = defineEmits<{
  create: []
}>()

const { t } = useI18n()
const todoStore = useTodoStore()
const { referenceInComposer, handToAgent, copyTitle } = useTodoActions()
const { showConfirm } = useDialog()

const draggingId = ref<string | null>(null)
const dropId = ref<string | null>(null)

function clearDrag(): void {
  draggingId.value = null
  dropId.value = null
}

function onDrop(targetId: string): void {
  const sourceId = draggingId.value
  clearDrag()
  if (!sourceId || sourceId === targetId) return
  const ids = todoStore.sortedTodos.map(todo => todo.id)
  const from = ids.indexOf(sourceId)
  const to = ids.indexOf(targetId)
  if (from < 0 || to < 0) return
  ids.splice(from, 1)
  ids.splice(to, 0, sourceId)
  void todoStore.reorder(ids)
}

async function onBulkMove(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  if (!value) return
  const groupId = value === '__none__' ? null : value
  const ids = [...todoStore.selectedIds]
  for (const id of ids) await todoStore.moveToGroup(id, groupId)
  todoStore.clearSelection()
  ;(event.target as HTMLSelectElement).value = ''
}

async function onBulkRemove(): Promise<void> {
  const ids = [...todoStore.selectedIds]
  const ok = await showConfirm(t('todo.bulk.removeConfirm', { n: ids.length }), { variant: 'danger' })
  if (ok) await todoStore.bulkRemove(ids)
}

async function onRowAction(action: TodoRowAction, todo: Todo): Promise<void> {
  switch (action) {
    case 'reference':
      referenceInComposer(todo)
      break
    case 'agent':
      handToAgent(todo)
      break
    case 'edit':
      todoStore.openDetail(todo.id)
      break
    case 'copy':
      await copyTitle(todo)
      break
    case 'delete': {
      const ok = await showConfirm(t('todo.row.deleteConfirm', { title: todo.title }), { variant: 'danger' })
      if (ok) await todoStore.removeTodo(todo.id)
      break
    }
  }
}
</script>

<style lang="scss" scoped>
.todo-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.bulk-bar,
.list-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  min-height: 34px;
  flex-shrink: 0;
}

.bulk-bar {
  padding: 6px 10px;
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);
  border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
  flex-wrap: wrap;
}

.bulk-count {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--accent-primary);
}

.bulk-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-wrap: wrap;
}

.bulk-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  &.is-danger {
    color: var(--error);
    border-color: color-mix(in srgb, var(--error) 35%, transparent);

    &:hover {
      background: color-mix(in srgb, var(--error) 12%, transparent);
    }
  }

  &.is-ghost {
    border-color: transparent;
    background: transparent;
    padding: 4px;
  }
}

.bulk-select {
  padding: 4px 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  max-width: 140px;
}

.select-all {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  cursor: pointer;

  input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }

  .select-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-xs);
    background: var(--bg-primary);
    color: transparent;
  }

  input:checked + .select-box {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--bg-elevated);
  }

  input:disabled + .select-box {
    opacity: 0.4;
  }
}

.toolbar-count {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.toolbar-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: var(--text-2xs);
  color: var(--text-disabled);
}

.list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 4px 24px 0;

  @include scrollbar-overlay;
}

.list-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.todo-row-enter-active,
.todo-row-leave-active {
  transition: opacity var(--transition-normal), transform var(--transition-normal);
}

.todo-row-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.todo-row-leave-to {
  opacity: 0;
  transform: translateX(12px);
}

.todo-row-move {
  transition: transform var(--transition-normal);
}
</style>