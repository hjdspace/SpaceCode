<template>
  <section v-if="reminders.length > 0" class="todo-reminder-rail" data-testid="todo-reminder-rail">
    <header class="rail-head">
      <span class="rail-icon"><BellRing :size="14" /></span>
      <span class="rail-title">{{ t('todo.reminder.title') }}</span>
      <span class="rail-count">{{ t('todo.reminder.count', { n: reminders.length }) }}</span>
      <button
        type="button"
        class="rail-toggle"
        :title="collapsed ? t('todo.quickAdd.expand') : t('todo.quickAdd.collapse')"
        @click="collapsed = !collapsed"
      >
        <ChevronDown :size="14" :class="{ 'is-collapsed': collapsed }" />
      </button>
    </header>

    <div v-show="!collapsed" class="rail-cards">
      <article
        v-for="reminder in reminders"
        :key="reminder.id"
        class="reminder-card"
        :class="`priority-${reminder.priority}`"
      >
        <div class="card-main">
          <span class="card-pulse" aria-hidden="true" />
          <div class="card-text">
            <button type="button" class="card-title" @click="todoStore.openDetail(reminder.todoId)">
              {{ reminder.todoTitle }}
            </button>
            <span class="card-time">
              <Clock :size="11" />
              {{ t('todo.reminder.dueAt', { time: formatTime(reminder.snoozedUntil ?? reminder.triggerAt) }) }}
            </span>
          </div>
        </div>
        <div class="card-actions">
          <button type="button" class="card-btn is-done" @click="complete(reminder)">
            <Check :size="12" />
            {{ t('todo.reminder.complete') }}
          </button>
          <button
            type="button"
            class="card-btn"
            :ref="el => setAnchor(reminder.id, el)"
            @click="toggleSnooze(reminder.id)"
          >
            <AlarmClock :size="12" />
            {{ t('todo.reminder.snooze') }}
          </button>
          <button
            type="button"
            class="card-btn is-ghost"
            :title="t('todo.reminder.acknowledge')"
            :aria-label="t('todo.reminder.acknowledge')"
            @click="todoStore.acknowledgeReminder(reminder.todoId, reminder.id)"
          >
            <EyeOff :size="12" />
          </button>
          <button
            type="button"
            class="card-btn is-ghost"
            :title="t('todo.reminder.open')"
            :aria-label="t('todo.reminder.open')"
            @click="todoStore.openDetail(reminder.todoId)"
          >
            <ArrowUpRight :size="12" />
          </button>
        </div>
      </article>
    </div>

    <PopoverPanel :open="snoozeId !== null" :anchor="snoozeAnchor" @close="snoozeId = null">
      <div class="snooze-menu">
        <button
          v-for="option in snoozeOptions"
          :key="option.minutes"
          type="button"
          class="snooze-item"
          @click="applySnooze(option.minutes)"
        >
          <AlarmClock :size="13" />
          {{ t(`todo.reminder.${option.key}`) }}
        </button>
      </div>
    </PopoverPanel>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlarmClock, ArrowUpRight, BellRing, Check, ChevronDown, Clock, EyeOff } from 'lucide-vue-next'
import PopoverPanel from '@/components/common/PopoverPanel.vue'
import { useTodoStore } from '@/stores/todo'
import { formatDueShort } from '@/utils/todoTime'
import type { ActiveTodoReminder } from '@/shared/channels/todo'

const { t, locale } = useI18n()
const todoStore = useTodoStore()

const collapsed = ref(false)
const snoozeId = ref<string | null>(null)
const anchors = new Map<string, HTMLElement>()

const reminders = computed(() => todoStore.activeReminders)
const snoozeAnchor = computed(() => (snoozeId.value ? anchors.get(snoozeId.value) ?? null : null))
const snoozeOptions = [
  { key: 'snooze10m', minutes: 10 },
  { key: 'snooze1h', minutes: 60 },
  { key: 'snoozeTomorrow', minutes: 1440 },
] as const

function setAnchor(id: string, el: unknown): void {
  if (el instanceof HTMLElement) anchors.set(id, el)
  else anchors.delete(id)
}

function formatTime(ms: number): string {
  return formatDueShort(ms, Date.now(), locale.value)
}

function toggleSnooze(id: string): void {
  snoozeId.value = snoozeId.value === id ? null : id
}

function applySnooze(minutes: number): void {
  const id = snoozeId.value
  snoozeId.value = null
  if (!id) return
  const reminder = reminders.value.find(item => item.id === id)
  if (!reminder) return
  void todoStore.snoozeReminder(reminder.todoId, reminder.id, minutes)
}

async function complete(reminder: ActiveTodoReminder): Promise<void> {
  const todo = todoStore.findTodo(reminder.todoId)
  if (todo) await todoStore.updateTodo({ id: todo.id, status: 'completed', expectedUpdatedAt: todo.updatedAt })
  await todoStore.acknowledgeReminder(reminder.todoId, reminder.id)
}
</script>

<style lang="scss" scoped>
.todo-reminder-rail {
  border: 1px solid color-mix(in srgb, var(--todo-hue-amber) 35%, transparent);
  border-radius: var(--radius-lg);
  background: linear-gradient(
    120deg,
    color-mix(in srgb, var(--todo-hue-amber) 12%, transparent),
    color-mix(in srgb, var(--todo-hue-rose) 8%, transparent)
  );
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.rail-head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.rail-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--todo-hue-amber) 20%, transparent);
  color: var(--todo-hue-amber);
  animation: todo-bell-swing 2.4s ease-in-out infinite;
}

@keyframes todo-bell-swing {
  0%,
  72%,
  100% {
    transform: rotate(0deg);
  }
  78% {
    transform: rotate(-12deg);
  }
  84% {
    transform: rotate(10deg);
  }
  90% {
    transform: rotate(-6deg);
  }
}

.rail-title {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.rail-count {
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--todo-hue-amber) 22%, transparent);
  color: var(--todo-hue-amber);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
}

.rail-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  svg {
    transition: transform var(--transition-fast);
  }

  .is-collapsed {
    transform: rotate(-90deg);
  }

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.rail-cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 208px;
  overflow-y: auto;
  padding-right: 2px;

  @include scrollbar-thin;
}

.reminder-card {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--todo-hue-amber);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-sm);

  &.priority-high {
    border-left-color: var(--todo-hue-rose);
  }

  &.priority-low {
    border-left-color: var(--todo-hue-cyan);
  }
}

.card-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 160px;
}

.card-pulse {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--todo-hue-amber);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--todo-hue-amber) 60%, transparent);
  animation: todo-reminder-pulse 1.8s ease-out infinite;
}

@keyframes todo-reminder-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--todo-hue-amber) 55%, transparent);
  }
  70% {
    box-shadow: 0 0 0 7px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

.card-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.card-title {
  padding: 0;
  border: none;
  background: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    color: var(--accent-primary);
    text-decoration: underline;
  }
}

.card-time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.card-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);

  &:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  &.is-done {
    border-color: color-mix(in srgb, var(--success) 35%, transparent);
    color: var(--success);

    &:hover {
      background: color-mix(in srgb, var(--success) 12%, transparent);
      color: var(--success);
    }
  }

  &.is-ghost {
    padding: 4px;
    border-color: transparent;
    background: transparent;
    color: var(--text-muted);
  }
}

.snooze-menu {
  display: flex;
  flex-direction: column;
  padding: 4px;
  min-width: 148px;
}

.snooze-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-md);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}
</style>