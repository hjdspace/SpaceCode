<template>
  <div ref="rootRef" class="todo-manager" :class="{ 'is-narrow': narrow }" data-testid="todo-manager">
    <div class="manager-top">
      <button
        type="button"
        class="back-btn"
        :title="t('todo.backToChat')"
        :aria-label="t('todo.backToChat')"
        @click="appStore.showTodoManager = false"
      >
        <ArrowLeft :size="18" />
      </button>

      <div class="manager-heading">
        <span class="heading-icon"><ListTodo :size="19" /></span>
        <div class="heading-text">
          <div class="heading-title">{{ t('todo.title') }}</div>
          <div class="heading-subtitle">{{ t('todo.subtitle') }}</div>
        </div>
        <div class="heading-stats">
          <span class="stat-chip">{{ t('todo.stats.open', { n: todoStore.openCount }) }}</span>
          <span class="stat-chip is-today">{{ t('todo.stats.today', { n: todoStore.counts.today }) }}</span>
          <span v-if="todoStore.overdueCount > 0" class="stat-chip is-alert">
            <AlertTriangle :size="11" />
            {{ t('todo.stats.overdue', { n: todoStore.overdueCount }) }}
          </span>
          <span class="stat-chip is-done">{{ t('todo.stats.completed', { n: todoStore.counts.completed }) }}</span>
        </div>
      </div>

      <div class="manager-tools">
        <button
          type="button"
          class="tool-btn nav-toggle"
          :title="t('todo.nav.views')"
          :aria-label="t('todo.nav.views')"
          @click="navOpen = !navOpen"
        >
          <PanelLeft :size="15" />
        </button>

        <div class="search-box">
          <Search :size="13" class="search-icon" />
          <input
            v-model="todoStore.search"
            type="text"
            class="search-input"
            :placeholder="t('todo.searchPlaceholder')"
            :aria-label="t('todo.searchLabel')"
          />
          <button
            v-if="todoStore.search"
            type="button"
            class="search-clear"
            :title="t('todo.clearSearch')"
            :aria-label="t('todo.clearSearch')"
            @click="todoStore.search = ''"
          >
            <X :size="12" />
          </button>
        </div>

        <label class="sort-box">
          <ArrowUpDown :size="13" />
          <select v-model="todoStore.sortMode" class="sort-select" :aria-label="t('todo.sortLabel')">
            <option v-for="mode in sortModes" :key="mode" :value="mode">{{ t(`todo.sort.${mode}`) }}</option>
          </select>
        </label>

        <button
          ref="agentBtnRef"
          type="button"
          class="tool-btn"
          :class="{ 'is-active': agentOpen }"
          :title="t('todo.agent.title')"
          :aria-label="t('todo.agent.title')"
          @click="agentOpen = !agentOpen"
        >
          <Sparkles :size="15" />
          <span v-if="todoStore.agentActivity.length > 0" class="tool-badge">
            {{ todoStore.agentActivity.length }}
          </span>
        </button>

        <button
          type="button"
          class="tool-btn"
          :class="{ 'is-active': syncVisible, 'has-conflict': todoStore.conflictCount > 0 }"
          :title="syncTitle"
          :aria-label="t('todo.sync.title')"
          @click="syncVisible = true"
        >
          <RefreshCw :size="15" :class="{ spin: todoStore.syncState.syncing }" />
          <span v-if="todoStore.conflictCount > 0" class="tool-badge is-alert">
            {{ todoStore.conflictCount }}
          </span>
          <span v-else-if="todoStore.syncState.config.enabled" class="tool-dot" />
        </button>

        <button type="button" class="create-btn" @click="focusQuickAdd">
          <Plus :size="15" />
          <span class="create-label">{{ t('todo.newTodo') }}</span>
        </button>
      </div>
    </div>

    <div class="manager-body">
      <div v-if="narrow && navOpen" class="rail-scrim" @click="navOpen = false" />
      <TodoNavRail v-show="!narrow || navOpen" class="manager-rail" :class="{ 'is-overlay': narrow }" />

      <div class="manager-main">
        <TodoReminderRail />

        <div v-if="todoStore.error" class="error-banner" role="alert">
          <AlertCircle :size="14" />
          <span class="error-text">{{ t(`todo.error.${todoStore.error}`) }}</span>
          <button
            v-if="todoStore.error === 'load-failed'"
            type="button"
            class="error-retry"
            @click="todoStore.load()"
          >
            <RotateCcw :size="12" />
            {{ t('todo.error.retry') }}
          </button>
          <button
            type="button"
            class="error-close"
            :title="t('todo.error.dismiss')"
            :aria-label="t('todo.error.dismiss')"
            @click="todoStore.clearError()"
          >
            <X :size="12" />
          </button>
        </div>

        <TodoQuickAdd ref="quickAddRef" @created="onCreated" />

        <div v-if="todoStore.loading && !todoStore.loaded" class="loading-state">
          <Loader2 :size="16" class="spin" />
        </div>
        <TodoList v-else @create="focusQuickAdd" />
      </div>

      <TodoDetailDrawer
        v-if="todoStore.detailTodo"
        :key="todoStore.detailTodo.id"
        :todo="todoStore.detailTodo"
        class="manager-detail"
        :class="{ 'is-overlay': narrow }"
      />
    </div>

    <div class="manager-notices">
      <Transition name="notice-slide">
        <div v-if="todoStore.undoBatch" class="notice-bar is-undo">
          <Trash2 :size="14" />
          <span class="notice-text">{{ t('todo.undo.removed', { n: todoStore.undoBatch.todos.length }) }}</span>
          <button type="button" class="notice-action" @click="todoStore.undoRemove()">
            <Undo2 :size="13" />
            {{ t('todo.undo.undo') }}
          </button>
          <button
            type="button"
            class="notice-close"
            :title="t('todo.undo.dismiss')"
            :aria-label="t('todo.undo.dismiss')"
            @click="todoStore.dismissUndo()"
          >
            <X :size="12" />
          </button>
          <span :key="todoStore.undoBatch.expiresAt" class="notice-drain" aria-hidden="true" />
        </div>
      </Transition>

      <Transition name="notice-slide">
        <div v-if="notice" class="notice-bar is-success">
          <CheckCircle2 :size="14" />
          <span class="notice-text">{{ notice }}</span>
          <button
            type="button"
            class="notice-close"
            :title="t('todo.undo.dismiss')"
            :aria-label="t('todo.undo.dismiss')"
            @click="dismissNotice()"
          >
            <X :size="12" />
          </button>
        </div>
      </Transition>
    </div>

    <TodoAgentActivity :open="agentOpen" :anchor="agentBtnRef" @close="agentOpen = false" />
    <TodoSyncPanel v-model:visible="syncVisible" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  CheckCircle2,
  ListTodo,
  Loader2,
  PanelLeft,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useTodoStore } from '@/stores/todo'
import type { TodoSortMode } from '@/stores/todo'
import { useTodoActions } from '@/composables/useTodoActions'
import TodoNavRail from './TodoNavRail.vue'
import TodoQuickAdd from './TodoQuickAdd.vue'
import TodoList from './TodoList.vue'
import TodoDetailDrawer from './TodoDetailDrawer.vue'
import TodoReminderRail from './TodoReminderRail.vue'
import TodoAgentActivity from './TodoAgentActivity.vue'
import TodoSyncPanel from './TodoSyncPanel.vue'
import type { Todo } from '@/shared/channels/todo'

const { t } = useI18n()
const appStore = useAppStore()
const todoStore = useTodoStore()
const { notice, dismissNotice } = useTodoActions()

const sortModes: TodoSortMode[] = ['smart', 'manual', 'due', 'priority', 'created', 'title']
/** 中央面板被三栏布局挤窄时，导航与详情改成浮层，列表始终留出可读宽度。 */
const NARROW_WIDTH = 900

const rootRef = ref<HTMLElement | null>(null)
const quickAddRef = ref<{ focus: () => void } | null>(null)
const agentBtnRef = ref<HTMLElement | null>(null)
const narrow = ref(false)
const navOpen = ref(true)
const agentOpen = ref(false)
const syncVisible = ref(false)

let observer: ResizeObserver | null = null

const syncTitle = computed(() => {
  if (todoStore.conflictCount > 0) return t('todo.sync.badgeConflict', { n: todoStore.conflictCount })
  return todoStore.syncState.config.enabled ? t('todo.sync.badgeOn') : t('todo.sync.badgeOff')
})

function focusQuickAdd(): void {
  nextTick(() => quickAddRef.value?.focus())
}

function onCreated(todo: Todo): void {
  todoStore.openDetail(todo.id)
}

onMounted(() => {
  void todoStore.load()
  const root = rootRef.value
  if (!root) return
  observer = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width ?? root.clientWidth
    const nextNarrow = width < NARROW_WIDTH
    if (nextNarrow !== narrow.value) {
      narrow.value = nextNarrow
      navOpen.value = !nextNarrow
    }
  })
  observer.observe(root)
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})
</script>

<style lang="scss" scoped>
.todo-manager {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--todo-hue-teal) 7%, transparent), transparent 60%),
    radial-gradient(100% 70% at 100% 0%, color-mix(in srgb, var(--todo-hue-violet) 6%, transparent), transparent 55%),
    var(--bg-primary);
}

.manager-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
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

.manager-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
  flex: 1;
}

.heading-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--todo-hue-teal) 22%, transparent),
    color-mix(in srgb, var(--todo-hue-blue) 18%, transparent)
  );
  color: var(--todo-hue-teal);
}

.heading-text {
  min-width: 0;
}

.heading-title {
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  color: var(--text-primary);
}

.heading-subtitle {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.heading-stats {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-left: 4px;
}

.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  white-space: nowrap;

  &.is-today {
    color: var(--todo-hue-blue);
    border-color: color-mix(in srgb, var(--todo-hue-blue) 30%, transparent);
    background: color-mix(in srgb, var(--todo-hue-blue) 10%, transparent);
  }

  &.is-alert {
    color: var(--error);
    border-color: color-mix(in srgb, var(--error) 32%, transparent);
    background: color-mix(in srgb, var(--error) 10%, transparent);
    font-weight: var(--font-weight-semibold);
  }

  &.is-done {
    color: var(--success);
    border-color: color-mix(in srgb, var(--success) 28%, transparent);
    background: color-mix(in srgb, var(--success) 9%, transparent);
  }
}

.manager-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 210px;
  padding: 5px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  transition: border-color var(--transition-fast);

  &:focus-within {
    border-color: var(--accent-primary);
  }
}

.search-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-md);

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: var(--text-disabled);
  }
}

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.sort-box {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-muted);

  &:focus-within {
    border-color: var(--accent-primary);
  }
}

.sort-select {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  max-width: 108px;

  &:focus {
    outline: none;
  }
}

.tool-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  &.is-active {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
    background: var(--accent-primary-glow);
  }

  &.has-conflict {
    color: var(--warning);
    border-color: color-mix(in srgb, var(--warning) 40%, transparent);
  }

  &.nav-toggle {
    display: none;
  }
}

.tool-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: var(--radius-full);
  background: var(--todo-hue-violet);
  color: #fff;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  line-height: 15px;
  text-align: center;

  &.is-alert {
    background: var(--error);
  }
}

.tool-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--success);
  border: 2px solid var(--bg-primary);
}

.spin {
  animation: todo-manager-spin 1.1s linear infinite;
}

@keyframes todo-manager-spin {
  to {
    transform: rotate(360deg);
  }
}

.create-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-md);
  background: var(--accent-primary);
  color: #fff;
  font-family: inherit;
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-fast);

  &:hover {
    background: var(--accent-primary-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  &:active {
    transform: translateY(0);
  }
}

.manager-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 12px 16px 16px;
}

.manager-rail {
  flex-shrink: 0;

  &.is-overlay {
    position: absolute;
    top: 12px;
    bottom: 16px;
    left: 16px;
    z-index: 6;
    box-shadow: var(--shadow-lg);
  }
}

.rail-scrim {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: var(--overlay-scrim);
}

.manager-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.manager-detail.is-overlay {
  position: absolute;
  top: 12px;
  bottom: 16px;
  right: 16px;
  z-index: 7;
  width: min(340px, calc(100% - 32px));
  box-shadow: var(--shadow-xl);
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border: 1px solid color-mix(in srgb, var(--error) 32%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--error) 9%, transparent);
  color: var(--error);
  font-size: var(--text-md);
  flex-shrink: 0;

  svg {
    flex-shrink: 0;
  }
}

.error-text {
  flex: 1;
  min-width: 0;
  line-height: var(--leading-normal);
}

.error-retry {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--error) 35%, transparent);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--error);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--error) 14%, transparent);
  }
}

.error-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: inherit;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--error) 16%, transparent);
  }
}

.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
}

.manager-notices {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  max-width: calc(100% - 32px);
}

.notice-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  font-size: var(--text-md);
  color: var(--text-primary);
  pointer-events: auto;
  overflow: hidden;

  &.is-undo {
    border-color: color-mix(in srgb, var(--todo-hue-amber) 40%, transparent);

    > svg {
      color: var(--todo-hue-amber);
    }
  }

  &.is-success {
    border-color: color-mix(in srgb, var(--success) 40%, transparent);

    > svg {
      color: var(--success);
    }
  }
}

.notice-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent-primary);
  color: #fff;
  font-family: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;

  &:hover {
    background: var(--accent-primary-hover);
  }
}

.notice-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.notice-drain {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background: var(--todo-hue-amber);
  transform-origin: left center;
  animation: todo-undo-drain 10s linear forwards;
}

@keyframes todo-undo-drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.notice-slide-enter-active,
.notice-slide-leave-active {
  transition: opacity var(--transition-normal), transform var(--transition-normal);
}

.notice-slide-enter-from,
.notice-slide-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.todo-manager.is-narrow {
  .manager-top {
    flex-wrap: wrap;
  }

  .manager-tools {
    width: 100%;
    flex-wrap: wrap;
  }

  .search-box {
    flex: 1;
    width: auto;
    min-width: 140px;
  }

  .tool-btn.nav-toggle {
    display: flex;
  }

  .heading-stats {
    margin-left: 46px;
  }
}

@media (max-width: 640px) {
  .create-label {
    display: none;
  }

  .create-btn {
    padding: 7px;
  }

  .heading-subtitle {
    display: none;
  }
}
</style>