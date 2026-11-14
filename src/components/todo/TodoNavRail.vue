<template>
  <nav class="todo-nav" :aria-label="t('todo.nav.views')">
    <div class="nav-section">
      <span class="nav-label">{{ t('todo.nav.views') }}</span>
      <button
        v-for="item in views"
        :key="item.view"
        class="nav-item"
        :class="{ 'is-active': todoStore.view === item.view }"
        type="button"
        @click="todoStore.setView(item.view)"
      >
        <component :is="item.icon" :size="14" class="nav-icon" :class="item.tone" />
        <span class="nav-text">{{ t(`todo.nav.${item.view}`) }}</span>
        <span v-if="countFor(item.view) > 0" class="nav-count" :class="{ 'is-alert': item.view === 'today' && todoStore.overdueCount > 0 }">
          {{ countFor(item.view) }}
        </span>
      </button>
    </div>

    <div class="nav-divider" />

    <div class="nav-section">
      <div class="nav-label-row">
        <span class="nav-label">{{ t('todo.nav.groups') }}</span>
        <button
          class="nav-add"
          type="button"
          :title="t('todo.nav.newGroup')"
          :aria-label="t('todo.nav.newGroup')"
          @click="startCreate"
        >
          <Plus :size="13" />
        </button>
      </div>

      <div v-if="creating" class="group-editor">
        <input
          ref="createInput"
          v-model="draftName"
          class="group-input"
          type="text"
          maxlength="60"
          :placeholder="t('todo.nav.groupPlaceholder')"
          :aria-label="t('todo.nav.groupPlaceholder')"
          @keydown.enter.prevent="submitCreate"
          @keydown.esc="creating = false"
        />
        <div class="hue-row" role="group" :aria-label="t('todo.nav.groups')">
          <button
            v-for="hue in hues"
            :key="hue"
            type="button"
            class="hue-dot"
            :class="{ 'is-active': draftColor === hue }"
            :style="{ '--hue': todoGroupHue(hue) }"
            :aria-label="hue"
            :aria-pressed="draftColor === hue"
            @click="draftColor = hue"
          />
        </div>
        <div class="editor-actions">
          <button class="editor-btn is-primary" type="button" :disabled="!draftName.trim()" @click="submitCreate">
            {{ t('todo.nav.groupCreate') }}
          </button>
          <button class="editor-btn" type="button" @click="creating = false">{{ t('todo.nav.groupCancel') }}</button>
        </div>
      </div>

      <div class="group-list">
        <div
          v-for="group in todoStore.groups"
          :key="group.id"
          class="nav-item is-group"
          :class="{ 'is-active': todoStore.view === 'group' && todoStore.activeGroupId === group.id }"
        >
          <template v-if="renamingId === group.id">
            <input
              :ref="setRenameInput"
              v-model="renameDraft"
              class="group-input is-inline"
              type="text"
              maxlength="60"
              :aria-label="t('todo.nav.groupRename')"
              @keydown.enter.prevent="submitRename(group.id)"
              @keydown.esc="renamingId = null"
              @blur="submitRename(group.id)"
            />
          </template>
          <template v-else>
            <button class="group-open" type="button" @click="todoStore.openGroup(group.id)">
              <span class="group-dot" :style="{ '--hue': todoGroupHue(group.color) }" aria-hidden="true" />
              <span class="nav-text">{{ group.name }}</span>
              <span v-if="groupCount(group.id) > 0" class="nav-count">{{ groupCount(group.id) }}</span>
            </button>
            <button
              :ref="(el) => setMenuAnchor(group.id, el)"
              class="group-menu-btn"
              type="button"
              :title="t('todo.nav.groupMenu')"
              :aria-label="t('todo.nav.groupMenu')"
              @click.stop="toggleMenu(group.id)"
            >
              <MoreHorizontal :size="14" />
            </button>
            <PopoverPanel :open="menuId === group.id" :anchor="menuAnchors.get(group.id) ?? null" @close="menuId = null">
              <div class="group-menu" role="menu">
                <button class="menu-item" type="button" role="menuitem" @click="startRename(group.id, group.name)">
                  <Pencil :size="13" />
                  {{ t('todo.nav.groupRename') }}
                </button>
                <button class="menu-item is-danger" type="button" role="menuitem" @click="removeGroup(group.id, group.name)">
                  <Trash2 :size="13" />
                  {{ t('todo.nav.groupDelete') }}
                </button>
              </div>
            </PopoverPanel>
          </template>
        </div>

        <div
          class="nav-item is-ungrouped"
          :class="{ 'is-active': todoStore.view === 'group' && todoStore.activeGroupId === '' }"
        >
          <button class="group-open" type="button" @click="todoStore.openGroup('')">
            <span class="group-dot is-hollow" aria-hidden="true" />
            <span class="nav-text">{{ t('todo.nav.ungrouped') }}</span>
            <span v-if="todoStore.counts.ungrouped > 0" class="nav-count">{{ todoStore.counts.ungrouped }}</span>
          </button>
        </div>

        <p v-if="todoStore.groups.length === 0 && !creating" class="nav-empty">{{ t('todo.nav.emptyGroups') }}</p>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarRange, CheckCircle2, Inbox, MoreHorizontal, Pencil, Plus, SunMedium, Trash2 } from 'lucide-vue-next'
import PopoverPanel from '@/components/common/PopoverPanel.vue'
import { useTodoStore } from '@/stores/todo'
import type { TodoView } from '@/stores/todo'
import { useDialog } from '@/composables/useDialog'
import { todoGroupHue } from '@/utils/todoColor'
import { TODO_GROUP_COLORS } from '@/shared/channels/todo'

const { t } = useI18n()
const todoStore = useTodoStore()
const { showConfirm } = useDialog()

const hues = TODO_GROUP_COLORS
const views: Array<{ view: Exclude<TodoView, 'group'>; icon: unknown; tone: string }> = [
  { view: 'all', icon: Inbox, tone: 'is-all' },
  { view: 'today', icon: SunMedium, tone: 'is-today' },
  { view: 'upcoming', icon: CalendarRange, tone: 'is-upcoming' },
  { view: 'completed', icon: CheckCircle2, tone: 'is-completed' },
]

const creating = ref(false)
const draftName = ref('')
const draftColor = ref<string>(hues[0])
const createInput = ref<HTMLInputElement | null>(null)
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const menuId = ref<string | null>(null)
const menuAnchors = ref(new Map<string, HTMLElement>())

function setMenuAnchor(id: string, el: unknown): void {
  if (el instanceof HTMLElement) menuAnchors.value.set(id, el)
  else menuAnchors.value.delete(id)
}

function toggleMenu(id: string): void {
  menuId.value = menuId.value === id ? null : id
}

function countFor(view: Exclude<TodoView, 'group'>): number {
  return todoStore.counts[view]
}

function groupCount(id: string): number {
  return todoStore.counts.byGroup.get(id) ?? 0
}

function startCreate(): void {
  creating.value = true
  draftName.value = ''
  draftColor.value = hues[todoStore.groups.length % hues.length]
  nextTick(() => createInput.value?.focus())
}

async function submitCreate(): Promise<void> {
  const name = draftName.value.trim()
  if (!name) return
  const group = await todoStore.createGroup(name, draftColor.value)
  if (!group) return
  creating.value = false
  todoStore.openGroup(group.id)
}

function setRenameInput(el: unknown): void {
  renameInput.value = el instanceof HTMLInputElement ? el : null
}

function startRename(id: string, name: string): void {
  menuId.value = null
  renamingId.value = id
  renameDraft.value = name
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

async function submitRename(id: string): Promise<void> {
  const name = renameDraft.value.trim()
  const current = todoStore.groups.find(group => group.id === id)
  renamingId.value = null
  if (!name || !current || name === current.name) return
  await todoStore.renameGroup(id, name)
}

async function removeGroup(id: string, name: string): Promise<void> {
  menuId.value = null
  const ok = await showConfirm(t('todo.nav.groupDeleteConfirm', { name }), { variant: 'danger' })
  if (ok) await todoStore.removeGroup(id)
}
</script>

<style lang="scss" scoped>
.todo-nav {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 208px;
  padding: 12px 10px;
  overflow-y: auto;
  height: 100%;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);

  @include scrollbar-thin;
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 2px;
}

.nav-label {
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-disabled);
  padding: 0 6px 4px;
}

.nav-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-bottom: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--accent-primary);
  }
}

.nav-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 2px 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-md);
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

  &.is-active {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
    font-weight: var(--font-weight-medium-plus);
  }

  &.is-group {
    padding: 0 2px 0 0;
    cursor: default;

    &:hover .group-menu-btn {
      opacity: 1;
    }
  }

  &.is-ungrouped {
    padding: 0 2px 0 0;
    cursor: default;
    margin-top: 2px;
  }
}

.nav-icon {
  flex-shrink: 0;

  &.is-today {
    color: var(--todo-hue-amber);
  }

  &.is-upcoming {
    color: var(--todo-hue-blue);
  }

  &.is-completed {
    color: var(--success);
  }
}

.nav-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-count {
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
  color: var(--text-muted);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  text-align: center;

  &.is-alert {
    background: color-mix(in srgb, var(--error) 16%, transparent);
    color: var(--error);
  }
}

.group-open {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 6px 4px 6px 8px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: var(--text-md);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.group-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--hue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hue) 18%, transparent);

  &.is-hollow {
    background: transparent;
    border: 1.5px dashed var(--border-strong);
    box-shadow: none;
  }
}

.group-menu-btn {
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
  opacity: 0;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-active);
    color: var(--text-primary);
  }
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nav-empty {
  margin: 4px 8px;
  font-size: var(--text-2xs);
  line-height: var(--leading-relaxed);
  color: var(--text-disabled);
}

.group-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  margin-bottom: 4px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.group-input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--text-md);
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  &.is-inline {
    margin: 3px 4px;
    width: calc(100% - 8px);
  }
}

.hue-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.hue-dot {
  width: 14px;
  height: 14px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--hue);
  cursor: pointer;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);

  &:hover {
    transform: scale(1.15);
  }

  &.is-active {
    box-shadow: 0 0 0 2px var(--bg-elevated), 0 0 0 4px var(--hue);
  }
}

.editor-actions {
  display: flex;
  gap: 6px;
}

.editor-btn {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
  }

  &.is-primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--bg-elevated);

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }
}

.group-menu {
  display: flex;
  flex-direction: column;
  padding: 4px;
  min-width: 160px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-md);
  font-family: inherit;
  text-align: left;
  cursor: pointer;

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
</style>