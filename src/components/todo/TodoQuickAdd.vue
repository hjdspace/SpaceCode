<template>
  <div class="todo-quick-add" :class="{ 'is-expanded': expanded, 'is-focused': focused }">
    <div class="quick-add-main">
      <span class="quick-add-icon" aria-hidden="true">
        <Plus :size="15" />
      </span>
      <input
        ref="inputRef"
        v-model="title"
        class="quick-add-input"
        type="text"
        :placeholder="t('todo.quickAdd.placeholder')"
        :aria-label="t('todo.quickAdd.label')"
        maxlength="500"
        @focus="focused = true"
        @blur="focused = false"
        @keydown.enter.prevent="submit"
        @keydown.esc="reset"
      />
      <button
        class="quick-add-submit"
        type="button"
        :disabled="!title.trim() || submitting"
        @click="submit"
      >
        <CornerDownLeft :size="13" />
        {{ t('todo.quickAdd.add') }}
      </button>
    </div>

    <div class="quick-add-controls">
      <div class="chip-row">
        <button
          v-for="preset in presets"
          :key="preset.key"
          type="button"
          class="due-chip"
          :class="{ 'is-active': activePreset === preset.key }"
          @click="applyPreset(preset.key)"
        >
          {{ t(`todo.quickAdd.${preset.key}`) }}
        </button>
        <TodoDueField v-model="dueAt" :date-label="t('todo.quickAdd.dueLabel')" :time-label="t('todo.quickAdd.timeLabel')" />
      </div>

      <div class="control-row">
        <div class="priority-picker" role="group" :aria-label="t('todo.quickAdd.priorityLabel')">
          <button
            v-for="level in priorities"
            :key="level"
            type="button"
            class="priority-dot"
            :class="[`is-${level}`, { 'is-active': priority === level }]"
            :title="t(`todo.priority.${level}`)"
            :aria-label="t(`todo.priority.${level}`)"
            :aria-pressed="priority === level"
            @click="priority = level"
          >
            <Flag :size="11" />
          </button>
        </div>

        <select v-model="groupId" class="group-select" :aria-label="t('todo.quickAdd.groupLabel')">
          <option value="">{{ t('todo.quickAdd.noGroup') }}</option>
          <option v-for="group in todoStore.groups" :key="group.id" :value="group.id">{{ group.name }}</option>
        </select>

        <button
          type="button"
          class="expand-btn"
          :title="expanded ? t('todo.quickAdd.collapse') : t('todo.quickAdd.expand')"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          <ChevronDown :size="14" :class="{ 'is-flipped': expanded }" />
        </button>
      </div>
    </div>

    <textarea
      v-if="expanded"
      v-model="notes"
      class="quick-add-notes"
      rows="2"
      :placeholder="t('todo.quickAdd.notesPlaceholder')"
      :aria-label="t('todo.detail.notes')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, CornerDownLeft, Flag, Plus } from 'lucide-vue-next'
import { useTodoStore } from '@/stores/todo'
import { useTodoActions } from '@/composables/useTodoActions'
import TodoDueField from './TodoDueField.vue'
import { combineDateAndTime, splitDueAt } from '@/utils/todoTime'
import type { Todo, TodoPriority } from '@/shared/channels/todo'

const emit = defineEmits<{
  created: [todo: Todo]
}>()

const { t } = useI18n()
const todoStore = useTodoStore()
const { notify } = useTodoActions()

const priorities: TodoPriority[] = ['low', 'medium', 'high']
const presets = [{ key: 'today' }, { key: 'tomorrow' }, { key: 'nextWeek' }] as const
type PresetKey = (typeof presets)[number]['key']

const title = ref('')
const notes = ref('')
const dueAt = ref<number | null>(null)
const priority = ref<TodoPriority>('medium')
const groupId = ref('')
const expanded = ref(false)
const focused = ref(false)
const submitting = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

/** 在分组视图里新建，默认就落在那个分组；今天视图默认今天 18:00。 */
watch(
  () => [todoStore.view, todoStore.activeGroupId] as const,
  ([view, activeGroup]) => {
    groupId.value = view === 'group' && activeGroup ? activeGroup : ''
    if (view === 'today' && dueAt.value === null) dueAt.value = atHour(0, 18)
  },
  { immediate: true },
)

function atHour(dayOffset: number, hour: number): number | null {
  const base = new Date()
  base.setDate(base.getDate() + dayOffset)
  return combineDateAndTime(splitDueAt(base.getTime()).date, `${String(hour).padStart(2, '0')}:00`)
}

const activePreset = computed<PresetKey | null>(() => {
  if (dueAt.value === null) return null
  for (const [key, offset] of [['today', 0], ['tomorrow', 1], ['nextWeek', 7]] as const) {
    const target = atHour(offset, 18)
    if (target !== null && splitDueAt(target).date === splitDueAt(dueAt.value).date) return key
  }
  return null
})

function applyPreset(key: PresetKey): void {
  if (activePreset.value === key) {
    dueAt.value = null
    return
  }
  const offset = key === 'today' ? 0 : key === 'tomorrow' ? 1 : 7
  dueAt.value = atHour(offset, 18)
}

function reset(): void {
  title.value = ''
  notes.value = ''
  expanded.value = false
}

async function submit(): Promise<void> {
  const trimmed = title.value.trim()
  if (!trimmed || submitting.value) return
  submitting.value = true
  const created = await todoStore.createTodo({
    title: trimmed,
    notes: notes.value.trim() || undefined,
    priority: priority.value,
    dueAt: dueAt.value ?? undefined,
    groupId: groupId.value || undefined,
  })
  submitting.value = false
  if (!created) return
  reset()
  notify(t('todo.quickAdd.created', { title: created.title }))
  emit('created', created)
  inputRef.value?.focus()
}

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<style lang="scss" scoped>
.todo-quick-add {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

  &.is-focused {
    border-color: color-mix(in srgb, var(--accent-primary) 55%, transparent);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }
}

.quick-add-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quick-add-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
}

.quick-add-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-base);
  font-family: inherit;
  padding: 4px 0;

  &::placeholder {
    color: var(--text-muted);
  }

  &:focus {
    outline: none;
  }
}

.quick-add-submit {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 5px 10px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--accent-primary);
  color: var(--bg-elevated);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--accent-primary-hover);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.quick-add-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.chip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.due-chip {
  padding: 3px 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  &.is-active {
    border-color: color-mix(in srgb, var(--accent-primary) 60%, transparent);
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.priority-picker {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
}

.priority-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);

  &.is-low.is-active {
    background: color-mix(in srgb, var(--info) 18%, transparent);
    color: var(--info);
  }

  &.is-medium.is-active {
    background: color-mix(in srgb, var(--warning) 20%, transparent);
    color: var(--warning);
  }

  &.is-high.is-active {
    background: color-mix(in srgb, var(--error) 18%, transparent);
    color: var(--error);
  }

  &:hover:not(.is-active) {
    color: var(--text-secondary);
  }
}

.group-select {
  max-width: 130px;
  padding: 3px 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
}

.expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .is-flipped {
    transform: rotate(180deg);
  }

  svg {
    transition: transform var(--transition-fast);
  }
}

.quick-add-notes {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--text-md);
  font-family: inherit;
  line-height: var(--leading-body);
  padding: 8px 10px;
  resize: vertical;
  min-height: 52px;

  @include scrollbar-thin;

  &::placeholder {
    color: var(--text-muted);
  }

  &:focus {
    outline: none;
    border-color: var(--border-default);
  }
}
</style>