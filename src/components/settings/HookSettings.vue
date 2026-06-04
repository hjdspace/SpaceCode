<template>
  <div class="hook-settings">
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">Settings</div>
      <h1 class="s-masthead-title">{{ t('hookSettings.title') }}</h1>
      <p class="s-masthead-desc">{{ t('hookSettings.description') || '自定义会话生命周期钩子函数' }}</p>
    </div>

    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon engine"><Zap :size="14" /></div>
          <span class="s-panel-title">{{ t('hookSettings.title') }}</span>
        </div>
        <div class="header-actions">
          <div class="view-toggle">
            <button
              v-for="v in viewModes"
              :key="v.id"
              class="view-btn"
              :class="{ active: viewMode === v.id }"
              @click="viewMode = v.id"
              :title="v.label"
            >
              <component :is="v.icon" :size="14" />
            </button>
          </div>
          <button class="s-btn s-btn-primary" @click="showAddModal = true">
            <Plus :size="14" />
            {{ t('hookSettings.addHook') }}
          </button>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="scope-selector">
          <button
            v-for="s in scopes"
            :key="s.value"
            class="scope-btn"
            :class="{ active: store.activeScope === s.value }"
            @click="switchScope(s.value)"
          >
            {{ s.label }}
          </button>
        </div>

        <template v-if="viewMode === 'cards'">
          <div class="event-nav">
            <button
              v-for="evt in eventList"
              :key="evt.value"
              class="event-nav-item"
              :class="{ active: activeEvent === evt.value }"
              @click="activeEvent = evt.value"
            >
              <span class="event-dot" :style="{ background: getEventColor(evt.value) }"></span>
              <span class="event-name">{{ evt.value }}</span>
              <span class="event-count" v-if="getEventHookCount(evt.value)">{{ getEventHookCount(evt.value) }}</span>
            </button>
          </div>

          <div class="hooks-list">
            <div
              v-for="hook in currentEventHooks"
              :key="hook.id"
              class="s-card hook-card"
              :class="{ disabled: hook.disabled, expanded: expandedHook === hook.id }"
            >
              <div class="hook-card-header" @click="toggleExpand(hook.id)">
                <div class="hook-toggle" :class="{ on: !hook.disabled }" @click.stop="store.toggleHook(hook.id)"></div>
                <div class="hook-info">
                  <div class="hook-name">{{ hook.name || hook.command }}</div>
                  <div class="hook-desc">{{ getEventDescription(hook.event) }}</div>
                </div>
                <div class="hook-tags">
                  <span v-if="hook.matcher" class="tag tag-matcher">{{ hook.matcher }}</span>
                  <span class="tag" :class="hook.type === 'command' ? 'tag-command' : 'tag-prompt'">
                    {{ hook.type === 'command' ? 'CMD' : 'LLM' }}
                  </span>
                </div>
                <div class="hook-actions">
                  <button class="s-icon-btn" @click.stop="editHook(hook)" :title="t('common.edit')">
                    <Pencil :size="14" />
                  </button>
                  <button class="s-icon-btn danger" @click.stop="confirmDelete(hook.id)" :title="t('common.delete')">
                    <Trash2 :size="14" />
                  </button>
                  <ChevronDown :size="16" class="s-expand-icon" :class="{ rotated: expandedHook === hook.id }" />
                </div>
              </div>
              <div v-if="expandedHook === hook.id" class="hook-card-body">
                <div class="detail-row">
                  <span class="detail-label">{{ hook.type === 'command' ? t('hookSettings.command') : 'Prompt' }}</span>
                  <code class="detail-value">{{ hook.command }}</code>
                </div>
                <div class="detail-row">
                  <span class="detail-label">{{ t('hookSettings.timeout') }}</span>
                  <code class="detail-value">{{ hook.timeout }}s</code>
                </div>
                <div class="detail-row">
                  <span class="detail-label">{{ t('hookSettings.scope') }}</span>
                  <code class="detail-value">{{ scopeLabels[hook.scope] }}</code>
                </div>
              </div>
            </div>

            <div v-if="currentEventHooks.length === 0" class="s-empty-state">
              <Zap :size="48" class="s-empty-state-icon" />
              <h4 class="s-empty-state-title">{{ t('hookSettings.noHooks') }}</h4>
              <p class="s-empty-state-description">{{ t('hookSettings.noHooksDesc') }}</p>
              <button class="s-btn s-btn-primary" @click="showAddModal = true">
                <Plus :size="14" />
                {{ t('hookSettings.addFirstHook') }}
              </button>
            </div>
          </div>
        </template>

        <template v-if="viewMode === 'table'">
          <div class="table-toolbar">
            <input class="search-input" v-model="searchQuery" :placeholder="t('hookSettings.searchPlaceholder')" />
            <select class="filter-select" v-model="filterEvent">
              <option value="">{{ t('hookSettings.allEvents') }}</option>
              <option v-for="evt in eventList" :key="evt.value" :value="evt.value">{{ evt.value }}</option>
            </select>
            <select class="filter-select" v-model="filterType">
              <option value="">{{ t('hookSettings.allTypes') }}</option>
              <option value="command">Command</option>
              <option value="prompt">Prompt</option>
            </select>
          </div>

          <table class="hook-table" v-if="filteredHooks.length > 0">
            <thead>
              <tr>
                <th style="width:40px;"></th>
                <th>{{ t('hookSettings.name') }}</th>
                <th>{{ t('hookSettings.event') }}</th>
                <th>Matcher</th>
                <th>{{ t('hookSettings.type') }}</th>
                <th>{{ t('hookSettings.commandOrPrompt') }}</th>
                <th>{{ t('hookSettings.scope') }}</th>
                <th style="width:80px;">{{ t('common.edit') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="hook in filteredHooks" :key="hook.id">
                <td>
                  <div class="toggle-sm" :class="{ on: !hook.disabled }" @click="store.toggleHook(hook.id)"></div>
                </td>
                <td class="name-cell">{{ hook.name || '-' }}</td>
                <td><span class="tag tag-event" style="font-size:10px;">{{ hook.event }}</span></td>
                <td><code v-if="hook.matcher">{{ hook.matcher }}</code><span v-else style="color:var(--text-muted);">-</span></td>
                <td><span class="tag" :class="hook.type === 'command' ? 'tag-command' : 'tag-prompt'" style="font-size:10px;">{{ hook.type === 'command' ? 'CMD' : 'LLM' }}</span></td>
                <td class="cmd-cell">{{ hook.command }}</td>
                <td style="font-size:12px;color:var(--text-muted);">{{ scopeLabels[hook.scope] }}</td>
                <td class="actions-cell">
                  <button class="s-icon-btn" @click="editHook(hook)"><Pencil :size="13" /></button>
                  <button class="s-icon-btn danger" @click="confirmDelete(hook.id)"><Trash2 :size="13" /></button>
                </td>
              </tr>
            </tbody>
          </table>

          <div v-else class="s-empty-state">
            <Zap :size="48" class="s-empty-state-icon" />
            <h4 class="s-empty-state-title">{{ t('hookSettings.noHooks') }}</h4>
            <p class="s-empty-state-description">{{ t('hookSettings.noHooksDesc') }}</p>
          </div>
        </template>

        <template v-if="viewMode === 'timeline'">
          <div class="timeline-view">
            <div v-for="evt in timelineEvents" :key="evt.value" class="event-group">
              <div class="event-group-header">
                <div class="event-dot-lg" :style="{ background: getEventColor(evt.value) }"></div>
                <h4>{{ evt.value }}</h4>
                <span class="event-desc">{{ evt.description }}</span>
                <span class="event-hook-count" v-if="getEventHookCount(evt.value)">{{ getEventHookCount(evt.value) }} {{ t('hookSettings.hookUnit') }}</span>
                <span v-else class="event-hook-count muted">0 {{ t('hookSettings.hookUnit') }}</span>
                <button v-if="getEventHookCount(evt.value) === 0" class="s-btn btn-ghost-sm" @click="addHookForEvent(evt.value)">+</button>
              </div>
              <div v-if="getEventHookCount(evt.value) > 0" class="event-hook-list">
                <div v-for="hook in getHooksForEvent(evt.value)" :key="hook.id" class="event-hook-item">
                  <span class="hook-type-badge" :class="hook.type === 'command' ? 'badge-command' : 'badge-prompt'">
                    {{ hook.type === 'command' ? 'CMD' : 'LLM' }}
                  </span>
                  <span class="hook-cmd">{{ hook.command }}</span>
                  <span v-if="hook.matcher" class="hook-matcher-tag">{{ hook.matcher }}</span>
                  <div class="hook-actions-inline">
                    <button class="s-icon-btn" @click="editHook(hook)"><Pencil :size="12" /></button>
                    <button class="s-icon-btn danger" @click="confirmDelete(hook.id)"><Trash2 :size="12" /></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <HookEditModal
          v-if="showAddModal"
          :hook="editingHook"
          :default-event="defaultEventForAdd"
          @save="onSaveHook"
          @close="closeModal"
        />

        <div v-if="deleteConfirmId" class="form-modal-overlay" @click.self="deleteConfirmId = null">
          <div class="form-modal" style="width:400px;">
            <h3>{{ t('hookSettings.confirmDelete') }}</h3>
            <p style="font-size:13px;color:var(--text-secondary);margin:8px 0 0;">{{ t('hookSettings.confirmDeleteDesc') }}</p>
            <div class="form-actions">
              <button class="s-btn s-btn-secondary" @click="deleteConfirmId = null">{{ t('common.cancel') }}</button>
              <button class="s-btn s-danger-btn" @click="doDelete">{{ t('common.delete') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Pencil, Trash2, ChevronDown, Zap, LayoutList, Table2, GitBranch } from 'lucide-vue-next'
import { useHooksStore } from '@/stores/hooks'
import { HOOK_EVENTS, SCOPE_LABELS, getEventDescription } from '@/types/hooks'
import type { HookEventType, HookScope, HookFlatItem } from '@/types/hooks'
import HookEditModal from './HookEditModal.vue'

const { t } = useI18n()
const store = useHooksStore()

const viewMode = ref<'cards' | 'table' | 'timeline'>('cards')
const activeEvent = ref<HookEventType>('PreToolUse')
const expandedHook = ref<string | null>(null)
const showAddModal = ref(false)
const editingHook = ref<HookFlatItem | null>(null)
const defaultEventForAdd = ref<HookEventType>('PreToolUse')
const deleteConfirmId = ref<string | null>(null)
const searchQuery = ref('')
const filterEvent = ref('')
const filterType = ref('')

const viewModes = [
  { id: 'cards' as const, label: t('hookSettings.cardView'), icon: LayoutList },
  { id: 'table' as const, label: t('hookSettings.tableView'), icon: Table2 },
  { id: 'timeline' as const, label: t('hookSettings.timelineView'), icon: GitBranch },
]

const scopes: { value: HookScope; label: string }[] = [
  { value: 'project', label: SCOPE_LABELS.project.label },
  { value: 'user', label: SCOPE_LABELS.user.label },
  { value: 'local', label: SCOPE_LABELS.local.label },
]

const scopeLabels: Record<string, string> = {
  user: SCOPE_LABELS.user.label,
  project: SCOPE_LABELS.project.label,
  local: SCOPE_LABELS.local.label,
}

const eventList = HOOK_EVENTS
const timelineEvents = HOOK_EVENTS

const currentEventHooks = computed(() => store.getHooksForEvent(activeEvent.value))

const filteredHooks = computed(() => {
  let list = store.hooks
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(h =>
      h.name.toLowerCase().includes(q) ||
      h.command.toLowerCase().includes(q) ||
      h.matcher.toLowerCase().includes(q)
    )
  }
  if (filterEvent.value) {
    list = list.filter(h => h.event === filterEvent.value)
  }
  if (filterType.value) {
    list = list.filter(h => h.type === filterType.value)
  }
  return list
})

function getEventHookCount(event: HookEventType): number {
  return store.getHooksForEvent(event).length
}

function getHooksForEvent(event: HookEventType): HookFlatItem[] {
  return store.getHooksForEvent(event)
}

const eventColorMap: Record<string, string> = {
  PreToolUse: '#ef4444',
  PostToolUse: '#22d3ee',
  PostCustomToolCall: '#06b6d4',
  Notification: '#f59e0b',
  UserPromptSubmit: '#a78bfa',
  Stop: '#8b5cf6',
  SubagentStop: '#6366f1',
  PreCompact: '#ec4899',
  SessionStart: '#22c55e',
  SessionEnd: '#6b7280',
}

function getEventColor(event: string): string {
  return eventColorMap[event] ?? '#6b7280'
}

function toggleExpand(id: string) {
  expandedHook.value = expandedHook.value === id ? null : id
}

function switchScope(scope: HookScope) {
  store.activeScope = scope
  store.loadFromSettingsFile()
}

function editHook(hook: HookFlatItem) {
  editingHook.value = { ...hook }
  showAddModal.value = true
}

function addHookForEvent(event: HookEventType) {
  defaultEventForAdd.value = event
  editingHook.value = null
  showAddModal.value = true
}

function closeModal() {
  showAddModal.value = false
  editingHook.value = null
}

function onSaveHook(data: Omit<HookFlatItem, 'id'>) {
  if (editingHook.value) {
    store.updateHook(editingHook.value.id, data)
  } else {
    store.addHook(data)
  }
  store.saveToSettingsFile()
  closeModal()
}

function confirmDelete(id: string) {
  deleteConfirmId.value = id
}

function doDelete() {
  if (deleteConfirmId.value) {
    store.removeHook(deleteConfirmId.value)
    store.saveToSettingsFile()
    deleteConfirmId.value = null
  }
}

onMounted(() => {
  store.loadFromSettingsFile()
})
</script>

<style lang="scss" scoped>
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&display=swap');

.hook-settings { display: flex; flex-direction: column; gap: 20px; max-width: 780px; }
.header-actions { display: flex; align-items: center; gap: 10px; }

.view-toggle {
  display: flex;
  background: var(--surface-soft);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
}
.view-btn {
  @include reset-button;
  width: 30px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
  color: var(--text-muted);
  transition: all 0.15s;
  &:hover { color: var(--text-primary); }
  &.active { background: var(--bg-primary); color: var(--accent-primary); box-shadow: var(--shadow-sm); }
}

.scope-selector { display: flex; gap: 6px; }
.scope-btn {
  @include reset-button;
  padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500;
  border: 1px solid var(--border-default); background: transparent; color: var(--text-muted);
  cursor: pointer; transition: all 0.15s;
  &:hover { border-color: var(--border-strong); color: var(--text-primary); }
  &.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); color: var(--accent-primary); }
}

.btn-ghost-sm {
  @include reset-button;
  padding: 3px 8px; border-radius: 4px; font-size: 12px;
  background: transparent; color: var(--text-muted);
  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.event-nav {
  display: flex; gap: 4px; flex-wrap: wrap;
  padding: 8px; background: var(--surface-soft); border-radius: 10px;
}
.event-nav-item {
  @include reset-button;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 500;
  color: var(--text-muted); cursor: pointer; transition: all 0.15s;
  &:hover { background: var(--bg-hover); color: var(--text-primary); }
  &.active { background: var(--accent-primary-glow); color: var(--accent-primary); }
}
.event-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.event-name { font-family: var(--font-mono); font-size: 11px; }
.event-count { font-size: 10px; background: var(--surface-soft); padding: 1px 6px; border-radius: 4px; }

.hooks-list { display: flex; flex-direction: column; gap: 8px; }

.hook-card {
  overflow: hidden; transition: all 0.2s;
  &.disabled { opacity: 0.6; }
  &.expanded { border-color: var(--accent-primary); }
}
.hook-card-header {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px; cursor: pointer;
  &:hover { background: var(--bg-hover); }
}
.hook-toggle {
  position: relative; width: 36px; height: 20px; border-radius: 10px;
  background: var(--border-default); cursor: pointer; transition: all var(--transition-fast); flex-shrink: 0;
  &.on { background: var(--accent-primary); }
  &::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 16px; height: 16px; border-radius: 50%; background: var(--bg-elevated); transition: all var(--transition-fast);
  }
  &.on::after { left: 18px; }
}
.hook-info { flex: 1; min-width: 0; }
.hook-name { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hook-desc { font-size: 12px; color: var(--text-muted); }
.hook-tags { display: flex; gap: 6px; flex-shrink: 0; }
.tag {
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 500;
  &.tag-event { background: var(--accent-primary-glow); color: var(--accent-primary); }
  &.tag-command { background: var(--accent-secondary-glow); color: var(--accent-secondary); }
  &.tag-prompt { background: var(--accent-tertiary-glow, rgba(124,58,237,0.12)); color: var(--accent-tertiary); }
  &.tag-matcher { background: var(--warning-glow); color: var(--warning); }
}
.hook-actions { display: flex; align-items: center; gap: 4px; }
.s-expand-icon { color: var(--text-muted); transition: transform 0.2s; margin-left: 4px; &.rotated { transform: rotate(180deg); } }

.hook-card-body { padding: 0 16px 14px; border-top: 1px solid var(--border-default); background: var(--bg-tertiary); }
.detail-row { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-default); &:last-child { border-bottom: none; } }
.detail-label { font-size: 12px; font-weight: 500; color: var(--text-muted); min-width: 80px; }
.detail-value { font-size: 12px; color: var(--text-primary); font-family: var(--font-mono); background: var(--surface-soft); padding: 4px 8px; border-radius: 4px; word-break: break-all; }

.table-toolbar { display: flex; gap: 8px; align-items: center; }
.search-input {
  flex: 1; padding: 8px 12px; background: var(--surface-soft); border: 1px solid var(--border-default);
  border-radius: 8px; color: var(--text-primary); font-size: 13px; outline: none;
  &:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-primary-glow); }
  &::placeholder { color: var(--text-muted); }
}
.filter-select {
  padding: 8px 12px; background: var(--surface-soft); border: 1px solid var(--border-default);
  border-radius: 8px; color: var(--text-secondary); font-size: 13px; outline: none; cursor: pointer;
}
.hook-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.hook-table th {
  text-align: left; padding: 8px 12px; color: var(--text-muted); font-weight: 500;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  border-bottom: 1px solid var(--border-default); white-space: nowrap;
}
.hook-table td { padding: 10px 12px; border-bottom: 1px solid var(--border-default); vertical-align: middle; }
.hook-table tr:hover td { background: var(--bg-hover); }
.name-cell { font-weight: 500; color: var(--text-primary); }
.cmd-cell { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.actions-cell { display: flex; gap: 4px; }
.toggle-sm {
  position: relative; width: 30px; height: 16px; border-radius: 8px;
  background: var(--border-default); cursor: pointer; transition: all var(--transition-fast);
  &.on { background: var(--accent-primary); }
  &::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--bg-elevated); transition: all var(--transition-fast); }
  &.on::after { left: 16px; }
}

.timeline-view { display: flex; flex-direction: column; gap: 12px; }
.event-group-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; background: var(--surface-card); border-radius: 10px;
  border: 1px solid var(--border-default);
  h4 { font-size: 13px; font-weight: 600; }
}
.event-dot-lg { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.event-desc { font-size: 12px; color: var(--text-muted); }
.event-hook-count { font-size: 12px; color: var(--accent-primary); margin-left: auto; &.muted { color: var(--text-muted); } }
.event-hook-list {
  padding-left: 20px; border-left: 2px solid var(--border-default);
  margin-left: 18px; margin-top: 8px;
}
.event-hook-item {
  position: relative; background: var(--surface-card); border: 1px solid var(--border-default);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 6px; margin-left: 12px;
  display: flex; align-items: center; gap: 10px;
  &::before { content: ''; position: absolute; left: -14px; top: 50%; width: 12px; height: 2px; background: var(--border-default); }
}
.hook-type-badge {
  padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0;
  &.badge-command { background: var(--accent-secondary-glow); color: var(--accent-secondary); }
  &.badge-prompt { background: var(--accent-tertiary-glow, rgba(124,58,237,0.12)); color: var(--accent-tertiary); }
}
.hook-cmd { flex: 1; font-size: 12px; font-family: var(--font-mono); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hook-matcher-tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: var(--warning-glow); color: var(--warning); flex-shrink: 0; }
.hook-actions-inline { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.event-hook-item:hover .hook-actions-inline { opacity: 1; }

.form-modal-overlay {
  position: fixed; inset: 0; background: var(--surface-glass-active);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.form-modal {
  width: 520px; max-height: 80vh; overflow-y: auto;
  background: var(--bg-elevated); border-radius: var(--radius-xl); padding: 24px;
  display: flex; flex-direction: column; gap: 16px;
  box-shadow: var(--shadow-xl);
  h3 { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0; }
}
.form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--border-default); }

.s-icon-btn.danger:hover { background: var(--error-glow); color: var(--error); }
</style>
