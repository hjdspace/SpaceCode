<template>
  <aside class="todo-detail" data-testid="todo-detail">
    <header class="detail-head">
      <div class="head-left">
        <span class="head-icon"><ClipboardList :size="15" /></span>
        <span class="head-title">{{ t('todo.detail.title') }}</span>
      </div>
      <div class="head-right">
        <Transition name="save-fade">
          <span v-if="saveState !== 'idle'" class="save-state" :class="`is-${saveState}`">
            <Loader2 v-if="saveState === 'saving'" :size="11" class="spin" />
            <Check v-else :size="11" />
            {{ saveState === 'saving' ? t('todo.detail.saving') : t('todo.detail.saved') }}
          </span>
        </Transition>
        <button
          type="button"
          class="icon-btn"
          :title="t('todo.detail.close')"
          :aria-label="t('todo.detail.close')"
          @click="todoStore.openDetail(null)"
        >
          <X :size="15" />
        </button>
      </div>
    </header>

    <div v-if="readOnly" class="readonly-banner">
      <Lock :size="13" />
      <span>{{ t('todo.detail.readOnlyHint') }}</span>
    </div>

    <div class="detail-scroll">
      <div class="title-block">
        <button
          type="button"
          class="status-toggle"
          :class="{ 'is-done': todo.status === 'completed' }"
          :disabled="readOnly"
          :title="todo.status === 'open' ? t('todo.row.complete') : t('todo.row.reopen')"
          @click="todoStore.toggleStatus(todo)"
        >
          <Check :size="14" />
        </button>
        <textarea
          v-model="titleDraft"
          class="title-input"
          :class="{ 'is-done': todo.status === 'completed' }"
          rows="2"
          :maxlength="TODO_TITLE_MAX_LENGTH"
          :readonly="readOnly"
          :placeholder="t('todo.detail.titlePlaceholder')"
          :aria-label="t('todo.detail.titleLabel')"
          @focus="editing = 'title'"
          @blur="onBlur('title')"
          @input="scheduleCommit('title')"
          @keydown.enter.prevent="flush('title')"
        />
      </div>

      <section class="field">
        <span class="field-label"><Flag :size="12" />{{ t('todo.priority.label') }}</span>
        <div class="segmented" role="group" :aria-label="t('todo.priority.label')">
          <button
            v-for="level in priorities"
            :key="level"
            type="button"
            class="seg-btn"
            :class="[`is-${level}`, { 'is-active': todo.priority === level }]"
            :disabled="readOnly"
            @click="todoStore.setPriority(todo.id, level)"
          >
            {{ t(`todo.priority.${level}`) }}
          </button>
        </div>
      </section>

      <section class="field">
        <span class="field-label"><CalendarClock :size="12" />{{ t('todo.detail.due') }}</span>
        <TodoDueField :model-value="todo.dueAt ?? null" :disabled="readOnly" @update:model-value="onDue" />
        <div class="preset-row">
          <button
            v-for="preset in presets"
            :key="preset.key"
            type="button"
            class="preset-chip"
            :class="{ 'is-active': activePreset === preset.key }"
            :disabled="readOnly"
            @click="applyPreset(preset.key)"
          >
            {{ t(`todo.quickAdd.${preset.key}`) }}
          </button>
        </div>
      </section>

      <section class="field">
        <span class="field-label"><Folder :size="12" />{{ t('todo.detail.group') }}</span>
        <select
          class="field-select"
          :value="todo.groupId ?? ''"
          :disabled="readOnly"
          :aria-label="t('todo.detail.group')"
          @change="onGroup"
        >
          <option value="">{{ t('todo.quickAdd.noGroup') }}</option>
          <option v-for="group in todoStore.groups" :key="group.id" :value="group.id">{{ group.name }}</option>
        </select>
      </section>

      <section class="field">
        <span class="field-label">
          <Tags :size="12" />{{ t('todo.detail.tags') }}
          <span class="label-count">{{ todo.tags.length }}/{{ TODO_TAG_MAX_COUNT }}</span>
        </span>
        <div class="tag-editor" :class="{ 'is-readonly': readOnly }">
          <span v-for="tag in todo.tags" :key="tag" class="tag-chip">
            {{ tag }}
            <button
              v-if="!readOnly"
              type="button"
              class="tag-remove"
              :aria-label="t('todo.detail.removeTag', { tag })"
              @click="removeTag(tag)"
            >
              <X :size="10" />
            </button>
          </span>
          <input
            v-if="!readOnly && todo.tags.length < TODO_TAG_MAX_COUNT"
            v-model="tagDraft"
            class="tag-input"
            :maxlength="TODO_TAG_MAX_LENGTH"
            :placeholder="t('todo.detail.tagsPlaceholder')"
            :aria-label="t('todo.detail.addTag')"
            @keydown.enter.prevent="addTag"
            @keydown.tab="addTag"
            @blur="addTag"
          />
        </div>
      </section>

      <section class="field">
        <span class="field-label"><NotebookPen :size="12" />{{ t('todo.detail.notes') }}</span>
        <textarea
          v-model="notesDraft"
          class="notes-input"
          rows="6"
          :readonly="readOnly"
          :placeholder="t('todo.detail.notesPlaceholder')"
          :aria-label="t('todo.detail.notes')"
          @focus="editing = 'notes'"
          @blur="onBlur('notes')"
          @input="scheduleCommit('notes')"
        />
        <span class="field-hint">{{ t('todo.detail.notesHint') }}</span>
      </section>

      <section class="field">
        <span class="field-label">
          <Bell :size="12" />{{ t('todo.detail.reminders') }}
          <span v-if="todo.reminders.length > 0" class="label-count">{{ todo.reminders.length }}</span>
        </span>
        <span class="field-hint">{{ t('todo.detail.remindersHint') }}</span>
        <div v-if="todo.reminders.length > 0" class="reminder-list">
          <div v-for="reminder in sortedReminders" :key="reminder.id" class="reminder-item">
            <BellRing :size="12" class="reminder-icon" :class="{ 'is-muted': reminder.status !== 'pending' }" />
            <span class="reminder-time">{{ formatTime(reminder.snoozedUntil ?? reminder.triggerAt) }}</span>
            <span class="reminder-origin" :class="{ 'is-due': reminder.origin === 'due' }">
              {{ reminder.origin === 'due' ? t('todo.detail.reminderFollowsDue') : t('todo.detail.reminderManual') }}
            </span>
            <span v-if="reminder.status !== 'pending'" class="reminder-status">
              {{ reminder.status === 'completed' ? t('todo.detail.reminderCompleted') : t('todo.detail.reminderAcknowledged') }}
            </span>
            <button
              v-if="reminder.origin === 'manual' && !readOnly"
              type="button"
              class="reminder-remove"
              :title="t('todo.detail.reminderRemove')"
              :aria-label="t('todo.detail.reminderRemove')"
              @click="removeReminder(reminder.id)"
            >
              <X :size="11" />
            </button>
          </div>
        </div>
        <div v-if="!readOnly" class="reminder-add">
          <TodoDueField v-model="newReminderAt" />
          <button
            type="button"
            class="mini-btn"
            :disabled="newReminderAt === null"
            @click="addReminder"
          >
            <Plus :size="12" />
            {{ t('todo.detail.reminderAdd') }}
          </button>
        </div>
      </section>

      <section class="field">
        <span class="field-label"><MessageSquare :size="12" />{{ t('todo.detail.sessions') }}</span>
        <div v-if="todo.sessionLinks.length === 0" class="field-hint">{{ t('todo.detail.sessionsEmpty') }}</div>
        <div v-else class="session-list">
          <button
            v-for="link in sortedSessions"
            :key="link.sessionId"
            type="button"
            class="session-item"
            :title="t('todo.detail.openSession')"
            @click="openSession(link.sessionId)"
          >
            <span class="session-dot" />
            <span class="session-name">{{ t('todo.agent.session', { id: link.sessionId.slice(0, 8) }) }}</span>
            <span class="session-time">{{ t('todo.detail.sessionLast', { time: relative(link.lastTouchedAt) }) }}</span>
            <ArrowUpRight :size="12" class="session-open" />
          </button>
        </div>
      </section>

      <section v-if="todo.nativeOrigin" class="field">
        <span class="field-label"><RefreshCw :size="12" />{{ t('todo.detail.origin') }}</span>
        <div class="origin-box">
          <span>{{ t('todo.detail.originList', { name: todo.nativeOrigin.listTitle }) }}</span>
          <span v-if="readOnly" class="origin-lock"><Lock :size="11" />{{ t('todo.row.readOnly') }}</span>
        </div>
      </section>

      <section class="meta-block">
        <span class="meta-title">{{ t('todo.detail.meta') }}</span>
        <span class="meta-line">{{ t('todo.detail.created', { time: formatTime(todo.createdAt) }) }}</span>
        <span class="meta-line">{{ t('todo.detail.updated', { time: relative(todo.updatedAt) }) }}</span>
        <span v-if="todo.completedAt" class="meta-line is-success">
          {{ t('todo.detail.completedAt', { time: formatTime(todo.completedAt) }) }}
        </span>
      </section>
    </div>

    <footer class="detail-foot">
      <button type="button" class="foot-btn is-primary" @click="referenceInComposer(todo)">
        <AtSign :size="13" />
        {{ t('todo.detail.reference') }}
      </button>
      <button type="button" class="foot-btn" @click="handToAgent(todo)">
        <Sparkles :size="13" />
        {{ t('todo.detail.askAgent') }}
      </button>
      <button
        type="button"
        class="foot-btn is-danger is-icon"
        :disabled="readOnly"
        :title="t('todo.detail.delete')"
        :aria-label="t('todo.detail.delete')"
        @click="onDelete"
      >
        <Trash2 :size="14" />
      </button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowUpRight,
  AtSign,
  Bell,
  BellRing,
  CalendarClock,
  Check,
  ClipboardList,
  Flag,
  Folder,
  Loader2,
  Lock,
  MessageSquare,
  NotebookPen,
  Plus,
  RefreshCw,
  Sparkles,
  Tags,
  Trash2,
  X,
} from 'lucide-vue-next'
import { useTodoStore } from '@/stores/todo'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTodoActions } from '@/composables/useTodoActions'
import { useDialog } from '@/composables/useDialog'
import TodoDueField from './TodoDueField.vue'
import { combineDateAndTime, formatDueShort, formatRelativeFromNow, splitDueAt } from '@/utils/todoTime'
import { TODO_TAG_MAX_COUNT, TODO_TAG_MAX_LENGTH, TODO_TITLE_MAX_LENGTH } from '@/shared/channels/todo'
import type { Todo, TodoPriority } from '@/shared/channels/todo'

const props = defineProps<{
  todo: Todo
}>()

const { t, locale } = useI18n()
const todoStore = useTodoStore()
const chatSessionStore = useChatSessionStore()
const { referenceInComposer, handToAgent, notify } = useTodoActions()
const { showConfirm } = useDialog()

const priorities: TodoPriority[] = ['low', 'medium', 'high']
const presets = [{ key: 'today' }, { key: 'tomorrow' }, { key: 'nextWeek' }] as const
type PresetKey = (typeof presets)[number]['key']

const readOnly = computed(() => props.todo.nativeOrigin !== undefined && !props.todo.nativeOrigin.canWrite)

const titleDraft = ref(props.todo.title)
const notesDraft = ref(props.todo.notes ?? '')
const tagDraft = ref('')
const newReminderAt = ref<number | null>(null)
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
/** 正在打字的那个字段不接受广播回填，否则 Agent 一动就把用户输入覆盖掉。 */
const editing = ref<'title' | 'notes' | null>(null)

let commitTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null
const AUTOSAVE_MS = 700

// 宿主用 :key="todo.id" 挂载，切换待办即重建，草稿不需要跨条目复用。
watch(
  () => [props.todo.title, props.todo.notes] as const,
  ([title, notes]) => {
    if (editing.value !== 'title') titleDraft.value = title
    if (editing.value !== 'notes') notesDraft.value = notes ?? ''
  },
)

const sortedReminders = computed(() =>
  [...props.todo.reminders].sort(
    (a, b) => (a.snoozedUntil ?? a.triggerAt) - (b.snoozedUntil ?? b.triggerAt),
  ),
)
const sortedSessions = computed(() =>
  [...props.todo.sessionLinks].sort((a, b) => b.lastTouchedAt - a.lastTouchedAt),
)

function formatTime(ms: number): string {
  return formatDueShort(ms, Date.now(), locale.value)
}

function relative(ms: number): string {
  return formatRelativeFromNow(ms, Date.now(), locale.value)
}

function markSaved(): void {
  saveState.value = 'saved'
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = setTimeout(() => {
    saveState.value = 'idle'
    savedTimer = null
  }, 1600)
}

async function commit(field: 'title' | 'notes'): Promise<void> {
  if (readOnly.value) return
  const value = field === 'title' ? titleDraft.value.trim() : notesDraft.value
  const current = field === 'title' ? props.todo.title : props.todo.notes ?? ''
  if (value === current) return
  if (field === 'title' && !value) {
    titleDraft.value = props.todo.title
    return
  }
  saveState.value = 'saving'
  const updated = await todoStore.updateTodo({
    id: props.todo.id,
    [field]: value,
    expectedUpdatedAt: props.todo.updatedAt,
  })
  if (updated) {
    if (field === 'title') titleDraft.value = updated.title
    else notesDraft.value = updated.notes ?? ''
    markSaved()
  } else {
    saveState.value = 'idle'
  }
}

function scheduleCommit(field: 'title' | 'notes'): void {
  editing.value = field
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = setTimeout(() => {
    commitTimer = null
    void commit(field)
  }, AUTOSAVE_MS)
}

function flush(field: 'title' | 'notes'): void {
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = null
  void commit(field)
}

function onBlur(field: 'title' | 'notes'): void {
  flush(field)
  editing.value = null
}

onUnmounted(() => {
  if (commitTimer) clearTimeout(commitTimer)
  if (savedTimer) clearTimeout(savedTimer)
})

function onDue(value: number | null): void {
  void todoStore.updateTodo({ id: props.todo.id, dueAt: value })
}

function atHour(dayOffset: number, hour: number): number | null {
  const base = new Date()
  base.setDate(base.getDate() + dayOffset)
  return combineDateAndTime(splitDueAt(base.getTime()).date, `${String(hour).padStart(2, '0')}:00`)
}

const activePreset = computed<PresetKey | null>(() => {
  const due = props.todo.dueAt
  if (due === undefined) return null
  for (const [key, offset] of [['today', 0], ['tomorrow', 1], ['nextWeek', 7]] as const) {
    const target = atHour(offset, 18)
    if (target !== null && splitDueAt(target).date === splitDueAt(due).date) return key
  }
  return null
})

function applyPreset(key: PresetKey): void {
  if (activePreset.value === key) {
    onDue(null)
    return
  }
  onDue(atHour(key === 'today' ? 0 : key === 'tomorrow' ? 1 : 7, 18))
}

function onGroup(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void todoStore.moveToGroup(props.todo.id, value || null)
}

function addTag(): void {
  const tag = tagDraft.value.trim().slice(0, TODO_TAG_MAX_LENGTH)
  tagDraft.value = ''
  if (!tag || props.todo.tags.includes(tag) || props.todo.tags.length >= TODO_TAG_MAX_COUNT) return
  void todoStore.updateTodo({ id: props.todo.id, tags: [...props.todo.tags, tag] })
}

function removeTag(tag: string): void {
  void todoStore.updateTodo({ id: props.todo.id, tags: props.todo.tags.filter(item => item !== tag) })
}

/**
 * reminders 是整表替换，且主进程会自动补一条跟随计划时间的提醒。
 * 所以这里只提交 manual 那几条的有效时刻（延后过的用延后后的时间）。
 */
function manualTimes(): number[] {
  return props.todo.reminders
    .filter(reminder => reminder.origin === 'manual')
    .map(reminder => reminder.snoozedUntil ?? reminder.triggerAt)
}

function addReminder(): void {
  const at = newReminderAt.value
  if (at === null) return
  newReminderAt.value = null
  void todoStore.updateTodo({ id: props.todo.id, reminders: [...manualTimes(), at] })
}

function removeReminder(id: string): void {
  const target = props.todo.reminders.find(reminder => reminder.id === id)
  if (!target) return
  const at = target.snoozedUntil ?? target.triggerAt
  const times = manualTimes()
  const index = times.indexOf(at)
  if (index >= 0) times.splice(index, 1)
  void todoStore.updateTodo({ id: props.todo.id, reminders: times })
}

function openSession(sessionId: string): void {
  if (!chatSessionStore.sessions.some(session => session.id === sessionId)) {
    notify(t('todo.detail.sessionMissing'))
    return
  }
  todoStore.openDetail(null)
  void chatSessionStore.selectSession(sessionId)
  referenceInComposer(props.todo)
}

async function onDelete(): Promise<void> {
  const ok = await showConfirm(t('todo.row.deleteConfirm', { title: props.todo.title }), { variant: 'danger' })
  if (ok) await todoStore.removeTodo(props.todo.id)
}
</script>

<style lang="scss" scoped>
.todo-detail {
  width: 340px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--todo-hue-teal) 10%, transparent),
    color-mix(in srgb, var(--todo-hue-violet) 8%, transparent)
  );
  flex-shrink: 0;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.head-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--todo-hue-teal) 16%, transparent);
  color: var(--todo-hue-teal);
}

.head-title {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.save-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-2xs);
  color: var(--text-muted);

  &.is-saved {
    color: var(--success);
  }
}

.spin {
  animation: todo-detail-spin 900ms linear infinite;
}

@keyframes todo-detail-spin {
  to {
    transform: rotate(360deg);
  }
}

.save-fade-enter-active,
.save-fade-leave-active {
  transition: opacity var(--transition-fast);
}

.save-fade-enter-from,
.save-fade-leave-to {
  opacity: 0;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.readonly-banner {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 12px;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--warning) 25%, transparent);
  flex-shrink: 0;

  svg {
    flex-shrink: 0;
    margin-top: 2px;
  }
}

.detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  @include scrollbar-thin;
}

.title-block {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.status-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: 3px;
  flex-shrink: 0;
  border: 1.5px solid var(--border-strong);
  border-radius: var(--radius-full);
  background: transparent;
  color: transparent;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    border-color: var(--success);
    color: color-mix(in srgb, var(--success) 55%, transparent);
  }

  &.is-done {
    background: var(--success);
    border-color: var(--success);
    color: var(--bg-elevated);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.title-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-base-plus);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-normal);
  resize: none;
  transition: all var(--transition-fast);

  &.is-done {
    color: var(--text-muted);
    text-decoration: line-through;
  }

  &:hover:not([readonly]) {
    background: var(--surface-glass);
  }

  &:focus {
    outline: none;
    background: var(--bg-primary);
    border-color: var(--accent-primary);
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);

  svg {
    color: var(--text-muted);
  }
}

.label-count {
  margin-left: auto;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-disabled);
}

.field-hint {
  font-size: var(--text-2xs);
  line-height: var(--leading-normal);
  color: var(--text-disabled);
}

.segmented {
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: var(--radius-md);
  background: var(--surface-soft);
}

.seg-btn {
  flex: 1;
  padding: 5px 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &.is-active {
    font-weight: var(--font-weight-semibold);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-sm);

    &.is-low {
      color: var(--todo-hue-cyan);
    }

    &.is-medium {
      color: var(--todo-hue-amber);
    }

    &.is-high {
      color: var(--todo-hue-rose);
    }
  }
}

.preset-row {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.preset-chip {
  padding: 3px 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--text-2xs);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  &.is-active {
    color: var(--todo-hue-teal);
    border-color: color-mix(in srgb, var(--todo-hue-teal) 45%, transparent);
    background: color-mix(in srgb, var(--todo-hue-teal) 12%, transparent);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.field-select {
  padding: 6px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-md);
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
}

.tag-editor {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  padding: 6px;
  min-height: 34px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);

  &:focus-within {
    border-color: var(--accent-primary);
  }

  &.is-readonly {
    background: var(--surface-soft);
  }
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 4px 2px 8px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--todo-hue-blue) 12%, transparent);
  color: var(--todo-hue-blue);
  font-size: var(--text-2xs);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: inherit;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--todo-hue-blue) 25%, transparent);
  }
}

.tag-input {
  flex: 1;
  min-width: 90px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-sm);

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: var(--text-disabled);
  }
}

.notes-input {
  padding: 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
  resize: vertical;
  min-height: 92px;

  @include scrollbar-thin;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  &::placeholder {
    color: var(--text-disabled);
  }
}

.reminder-list,
.session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reminder-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  font-size: var(--text-sm);
}

.reminder-icon {
  flex-shrink: 0;
  color: var(--todo-hue-amber);

  &.is-muted {
    color: var(--text-disabled);
  }
}

.reminder-time {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.reminder-origin {
  padding: 1px 6px;
  border-radius: var(--radius-full);
  font-size: var(--text-2xs);
  color: var(--text-muted);
  background: var(--surface-glass-hover);

  &.is-due {
    color: var(--todo-hue-teal);
    background: color-mix(in srgb, var(--todo-hue-teal) 12%, transparent);
  }
}

.reminder-status {
  font-size: var(--text-2xs);
  color: var(--text-disabled);
}

.reminder-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: auto;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-disabled);
  cursor: pointer;

  &:hover {
    color: var(--error);
    background: var(--bg-hover);
  }
}

.reminder-add {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mini-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--accent-primary) 35%, transparent);
  border-radius: var(--radius-sm);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.session-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    border-color: color-mix(in srgb, var(--todo-hue-violet) 40%, transparent);
    background: color-mix(in srgb, var(--todo-hue-violet) 8%, transparent);
    color: var(--text-primary);

    .session-open {
      opacity: 1;
    }
  }
}

.session-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--todo-hue-violet);
}

.session-name {
  font-variant-numeric: tabular-nums;
}

.session-time {
  margin-left: auto;
  font-size: var(--text-2xs);
  color: var(--text-disabled);
}

.session-open {
  flex-shrink: 0;
  opacity: 0.4;
  transition: opacity var(--transition-fast);
}

.origin-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--todo-hue-cyan) 10%, transparent);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.origin-lock {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  font-size: var(--text-2xs);
  color: var(--warning);
}

.meta-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}

.meta-title {
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-disabled);
  margin-bottom: 2px;
}

.meta-line {
  font-size: var(--text-2xs);
  color: var(--text-muted);

  &.is-success {
    color: var(--success);
  }
}

.detail-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-soft);
  flex-shrink: 0;
}

.foot-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  &.is-primary {
    flex: 1;
    border-color: transparent;
    background: var(--accent-primary);
    color: #fff;

    &:hover {
      background: var(--accent-primary-hover);
      color: #fff;
    }
  }

  &.is-danger {
    color: var(--error);
    border-color: color-mix(in srgb, var(--error) 30%, transparent);

    &:hover:not(:disabled) {
      background: color-mix(in srgb, var(--error) 12%, transparent);
      color: var(--error);
    }
  }

  &.is-icon {
    padding: 7px;
    margin-left: auto;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}
</style>