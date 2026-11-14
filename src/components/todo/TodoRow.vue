<template>
  <div
    class="todo-row"
    :class="{
      'is-completed': todo.status === 'completed',
      'is-selected': selected,
      'is-active': active,
      'is-pending': pending,
      'is-agent': agentTouched,
      'is-dragging': dragging,
      'is-drop-target': dropTarget,
    }"
    :draggable="dragArmed"
    :data-todo-id="todo.id"
    @dragstart="onDragStart"
    @dragover.prevent="emit('drag-over', todo.id)"
    @drop.prevent="emit('drop-on', todo.id)"
    @dragend="onDragEnd"
    @dblclick="emit('open', todo.id)"
  >
    <button
      class="row-grip"
      type="button"
      :title="t('todo.row.drag')"
      :aria-label="t('todo.row.drag')"
      @mousedown="armDrag"
    >
      <GripVertical :size="13" />
    </button>

    <label class="row-select" :class="{ 'is-visible': selected || selectionActive }">
      <input
        type="checkbox"
        :checked="selected"
        :aria-label="t('todo.row.select')"
        @change="emit('select', todo.id)"
      />
      <span class="select-box" aria-hidden="true"><Check :size="10" /></span>
    </label>

    <button
      class="row-check"
      type="button"
      :class="{ 'is-done': todo.status === 'completed' }"
      :title="todo.status === 'completed' ? t('todo.row.reopen') : t('todo.row.complete')"
      :aria-label="todo.status === 'completed' ? t('todo.row.reopen') : t('todo.row.complete')"
      :aria-pressed="todo.status === 'completed'"
      @click="emit('toggle', todo)"
    >
      <Check :size="12" />
    </button>

    <span class="row-priority" :class="`is-${todo.priority}`" :title="t(`todo.priority.${todo.priority}`)">
      <Flag :size="11" />
    </span>

    <button class="row-body" type="button" @click="emit('open', todo.id)">
      <span class="row-title">{{ todo.title }}</span>
      <span class="row-meta">
        <span v-if="group" class="meta-group" :style="{ '--hue': todoGroupHue(group.color) }">
          <span class="group-dot" aria-hidden="true" />
          {{ group.name }}
        </span>

        <span v-if="todo.dueAt !== undefined" class="meta-due" :class="`is-${bucket}`">
          <CalendarClock :size="11" />
          {{ dueLabel }}
        </span>

        <span v-if="pendingReminders > 0" class="meta-item" :title="t('todo.row.reminders', { n: pendingReminders })">
          <Bell :size="11" />
          {{ pendingReminders }}
        </span>

        <span v-if="todo.sessionLinks.length > 0" class="meta-item" :title="t('todo.row.sessions', { n: todo.sessionLinks.length })">
          <MessageSquare :size="11" />
          {{ todo.sessionLinks.length }}
        </span>

        <span v-if="todo.nativeOrigin" class="meta-item is-sync" :title="t('todo.detail.originList', { name: todo.nativeOrigin.listTitle })">
          <component :is="todo.nativeOrigin.canWrite ? RefreshCw : Lock" :size="11" />
          {{ todo.nativeOrigin.canWrite ? t('todo.row.synced') : t('todo.row.readOnly') }}
        </span>

        <span v-for="tag in visibleTags" :key="tag" class="meta-tag">#{{ tag }}</span>
        <span v-if="hiddenTagCount > 0" class="meta-tag is-more">+{{ hiddenTagCount }}</span>

        <span v-if="notesPreview" class="meta-notes">{{ notesPreview }}</span>
      </span>
    </button>

    <span v-if="agentTouched" class="row-agent" :title="t('todo.row.agentTouched')">
      <Sparkles :size="12" />
    </span>

    <button
      ref="menuAnchor"
      class="row-menu-btn"
      type="button"
      :title="t('todo.row.more')"
      :aria-label="t('todo.row.more')"
      :aria-expanded="menuOpen"
      @click.stop="menuOpen = !menuOpen"
    >
      <MoreHorizontal :size="15" />
    </button>

    <PopoverPanel :open="menuOpen" :anchor="menuAnchor" @close="menuOpen = false">
      <div class="row-menu" role="menu">
        <button class="menu-item" type="button" role="menuitem" @click="run('reference')">
          <AtSign :size="14" />
          {{ t('todo.row.reference') }}
        </button>
        <button class="menu-item" type="button" role="menuitem" @click="run('agent')">
          <Sparkles :size="14" />
          {{ t('todo.row.askAgent') }}
        </button>
        <button class="menu-item" type="button" role="menuitem" @click="run('edit')">
          <Pencil :size="14" />
          {{ t('todo.row.edit') }}
        </button>
        <button class="menu-item" type="button" role="menuitem" @click="run('copy')">
          <Copy :size="14" />
          {{ t('todo.row.copyTitle') }}
        </button>
        <div class="menu-divider" />
        <button class="menu-item is-danger" type="button" role="menuitem" @click="run('delete')">
          <Trash2 :size="14" />
          {{ t('todo.row.delete') }}
        </button>
      </div>
    </PopoverPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AtSign,
  Bell,
  CalendarClock,
  Check,
  Copy,
  Flag,
  GripVertical,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-vue-next'
import PopoverPanel from '@/components/common/PopoverPanel.vue'
import { useTodoStore } from '@/stores/todo'
import { dueBucket, formatDueShort } from '@/utils/todoTime'
import { todoGroupHue } from '@/utils/todoColor'
import type { Todo } from '@/shared/channels/todo'

export type TodoRowAction = 'reference' | 'agent' | 'edit' | 'copy' | 'delete'

const props = defineProps<{
  todo: Todo
  selected: boolean
  selectionActive: boolean
  active: boolean
  pending: boolean
  agentTouched: boolean
  dragging: boolean
  dropTarget: boolean
}>()

const emit = defineEmits<{
  toggle: [todo: Todo]
  open: [id: string]
  select: [id: string]
  action: [action: TodoRowAction, todo: Todo]
  'drag-start': [id: string]
  'drag-over': [id: string]
  'drop-on': [id: string]
  'drag-end': []
}>()

const { t, locale } = useI18n()
const todoStore = useTodoStore()

const menuOpen = ref(false)
const menuAnchor = ref<HTMLElement | null>(null)
const dragArmed = ref(false)

const group = computed(() => (props.todo.groupId ? todoStore.groupById.get(props.todo.groupId) ?? null : null))
const bucket = computed(() => dueBucket(props.todo, Date.now()))
const dueLabel = computed(() =>
  props.todo.dueAt === undefined ? '' : formatDueShort(props.todo.dueAt, Date.now(), locale.value),
)
const pendingReminders = computed(() => props.todo.reminders.filter(r => r.status === 'pending').length)
const visibleTags = computed(() => props.todo.tags.slice(0, 3))
const hiddenTagCount = computed(() => Math.max(0, props.todo.tags.length - 3))
const notesPreview = computed(() => {
  const notes = props.todo.notes?.trim()
  if (!notes) return ''
  const firstLine = notes.split('\n')[0]
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
})

function onDragStart(event: DragEvent): void {
  if (!dragArmed.value) {
    event.preventDefault()
    return
  }
  event.dataTransfer?.setData('text/plain', props.todo.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  emit('drag-start', props.todo.id)
}

/** 松手可能发生在把手之外（改主意了），只听把手自己的 mouseup 会让行永久保持可拖。 */
function armDrag(): void {
  dragArmed.value = true
  window.addEventListener('mouseup', disarmDrag, { once: true })
}

function disarmDrag(): void {
  dragArmed.value = false
  window.removeEventListener('mouseup', disarmDrag)
}

function onDragEnd(): void {
  disarmDrag()
  emit('drag-end')
}

onUnmounted(() => window.removeEventListener('mouseup', disarmDrag))

function run(action: TodoRowAction): void {
  menuOpen.value = false
  emit('action', action, props.todo)
}
</script>

<style lang="scss" scoped>
.todo-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 9px 10px 9px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  transition: background var(--transition-fast), border-color var(--transition-fast), opacity var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
    border-color: var(--border-subtle);

    .row-grip,
    .row-menu-btn {
      opacity: 1;
    }
  }

  &.is-active {
    border-color: color-mix(in srgb, var(--accent-primary) 45%, transparent);
    background: var(--accent-primary-glow);
  }

  &.is-selected {
    border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
  }

  &.is-pending {
    opacity: 0.55;
  }

  &.is-dragging {
    opacity: 0.35;
  }

  &.is-drop-target::before {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    top: -3px;
    height: 2px;
    border-radius: var(--radius-full);
    background: var(--accent-primary);
  }

  &.is-agent {
    animation: todo-agent-pulse 1.6s ease-out;
  }

  &.is-completed .row-title {
    text-decoration: line-through;
    color: var(--text-muted);
  }
}

@keyframes todo-agent-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--todo-hue-violet) 45%, transparent);
  }
  100% {
    box-shadow: 0 0 0 10px transparent;
  }
}

.row-grip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  opacity: 0;
  cursor: grab;
  transition: opacity var(--transition-fast);

  &:active {
    cursor: grabbing;
  }
}

.row-select {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 22px;
  flex-shrink: 0;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast);

  &.is-visible {
    opacity: 1;
  }

  input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    margin: 0;
  }

  .select-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-xs);
    color: transparent;
    background: var(--bg-primary);
  }

  input:checked + .select-box {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--bg-elevated);
  }
}

.todo-row:hover .row-select {
  opacity: 1;
}

.row-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  flex-shrink: 0;
  border: 1.5px solid var(--border-strong);
  border-radius: var(--radius-full);
  background: transparent;
  color: transparent;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    border-color: var(--accent-primary);
    color: color-mix(in srgb, var(--accent-primary) 60%, transparent);
  }

  &.is-done {
    background: var(--success);
    border-color: var(--success);
    color: var(--bg-elevated);
  }
}

.row-priority {
  display: flex;
  align-items: center;
  height: 22px;
  flex-shrink: 0;

  &.is-high {
    color: var(--error);
  }

  &.is-medium {
    color: var(--warning);
  }

  &.is-low {
    color: var(--text-disabled);
  }
}

.row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border: none;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}

.row-title {
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--text-primary);
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.row-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}

.meta-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px 1px 5px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--hue) 14%, transparent);
  color: var(--hue);
  font-weight: var(--font-weight-medium);

  .group-dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: currentColor;
  }
}

.meta-due {
  display: inline-flex;
  align-items: center;
  gap: 3px;

  &.is-overdue {
    color: var(--error);
    font-weight: var(--font-weight-medium);
  }

  &.is-today {
    color: var(--accent-primary);
    font-weight: var(--font-weight-medium);
  }
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;

  &.is-sync {
    color: var(--todo-hue-blue);
  }
}

.meta-tag {
  padding: 0 5px;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  color: var(--text-secondary);

  &.is-more {
    background: transparent;
  }
}

.meta-notes {
  min-width: 0;
  color: var(--text-disabled);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.row-agent {
  display: flex;
  align-items: center;
  height: 22px;
  color: var(--todo-hue-violet);
  flex-shrink: 0;
}

.row-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  opacity: 0;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-active);
    color: var(--text-primary);
  }
}

.row-menu {
  display: flex;
  flex-direction: column;
  padding: 4px;
  min-width: 190px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-md);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.is-danger {
    color: var(--error);

    &:hover {
      background: color-mix(in srgb, var(--error) 12%, transparent);
    }
  }
}

.menu-divider {
  height: 1px;
  margin: 4px 2px;
  background: var(--border-subtle);
}
</style>