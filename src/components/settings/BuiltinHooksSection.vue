<template>
  <div class="builtin-section">
    <div class="builtin-header" @click="expanded = !expanded">
      <div class="builtin-header-left">
        <div class="s-panel-icon engine"><Package :size="14" /></div>
        <span class="s-panel-title">{{ t('hookSettings.builtin.title') }}</span>
        <span class="builtin-badge" v-if="store.enabledCount">{{ store.enabledCount }}</span>
        <span class="builtin-hint">({{ store.definitions.length }} {{ t('hookSettings.builtin.totalHooks') }})</span>
      </div>
      <div class="builtin-header-right">
        <ChevronDown :size="16" class="s-expand-icon" :class="{ rotated: expanded }" />
      </div>
    </div>

    <div v-if="expanded" class="builtin-body">
      <!-- Node 状态提示：检测失败时给出明显告警 -->
      <div v-if="nodeStatus === 'missing'" class="node-banner warn">
        <AlertCircle :size="14" />
        <div class="node-banner-text">
          <strong>{{ t('hookSettings.builtin.nodeMissing') }}</strong>
          <div>{{ t('hookSettings.builtin.nodeMissingHint') }}</div>
        </div>
        <a href="https://nodejs.org/" target="_blank" class="node-link">nodejs.org →</a>
      </div>
      <div v-else-if="nodeStatus === 'ok'" class="node-banner ok">
        <CheckCircle :size="12" />
        <span>{{ t('hookSettings.builtin.nodeOk', { version: nodeVersion }) }}</span>
        <button class="node-repair-btn" @click="onRepairPaths" :disabled="repairing">
          <Wrench :size="11" />
          {{ repairing ? t('hookSettings.builtin.repairing') : t('hookSettings.builtin.repairPaths') }}
        </button>
      </div>

      <div class="builtin-toolbar">
        <input
          class="search-input"
          v-model="searchQuery"
          :placeholder="t('hookSettings.builtin.searchPlaceholder')"
        />
        <div class="source-filters">
          <button
            class="source-filter-btn"
            :class="{ active: sourceFilter === '' }"
            @click="sourceFilter = ''"
          >{{ t('hookSettings.builtin.all') }}</button>
          <button
            v-for="src in sourceGroups"
            :key="src.source"
            class="source-filter-btn"
            :class="{ active: sourceFilter === src.source }"
            @click="sourceFilter = src.source"
          >
            {{ src.source }}
            <span class="src-count">{{ src.hooks.length }}</span>
          </button>
        </div>
      </div>

      <div
        v-for="group in filteredGroups"
        :key="`${group.source}-${group.event}`"
        class="event-group"
      >
        <div class="event-group-header" @click="toggleEventGroup(group.event)">
          <span class="event-dot" :style="{ background: getEventColor(group.event) }"></span>
          <span class="event-label">{{ group.event }}</span>
          <span class="source-badge" :class="`source-${(group.source || 'default').toLowerCase()}`">{{ group.source }}</span>
          <span class="event-count">
            {{ group.hooks.filter(h => store.getState(h.id).enabled).length }}/{{ group.hooks.length }}
          </span>
          <ChevronDown :size="12" class="event-chevron" :class="{ rotated: expandedEvents.has(group.event) }" />
        </div>

        <div v-if="expandedEvents.has(group.event)" class="event-hooks">
          <div
            v-for="hook in group.hooks"
            :key="hook.id"
            class="builtin-card"
            :class="{
              enabled: store.getState(hook.id).enabled,
              configured: store.isConfigured(hook.id),
            }"
          >
            <div class="builtin-card-main">
              <div class="builtin-toggle"
                :class="{ on: store.getState(hook.id).enabled }"
                @click="onToggle(hook.id)"
                :title="store.getState(hook.id).enabled ? t('hookSettings.builtin.disable') : t('hookSettings.builtin.enable')"
              ></div>

              <div class="builtin-icon">
                <component :is="hook.icon" :size="16" />
              </div>

              <div class="builtin-info">
                <div class="builtin-name">{{ hook.name }}</div>
                <div class="builtin-desc-text">{{ hook.description }}</div>
              </div>

              <div class="builtin-tags">
                <span class="tag tag-timeout" v-if="(hook.timeout ?? 30) !== 30">{{ hook.timeout }}s</span>
                <span class="tag tag-category" :class="`cat-${hook.category}`">
                  {{ t(`hookSettings.builtin.cat.${hook.category}`) }}
                </span>
                <span class="tag tag-matcher" v-if="hook.matcher && hook.matcher !== '*'">{{ hook.matcher }}</span>
              </div>

              <div class="builtin-actions">
                <button
                  class="s-btn btn-sm btn-outline"
                  @click="onConfigure(hook.id)"
                >
                  <Settings :size="13" />
                </button>
              </div>
            </div>

            <div v-if="store.getState(hook.id).enabled" class="builtin-card-footer">
              <div class="status-row">
                <CheckCircle :size="12" class="status-icon active" />
                <span class="status-text">
                  {{ t('hookSettings.builtin.runningVia') }}
                  <strong>{{ getProviderLabel(hook.id) }}</strong>
                </span>
              </div>
            </div>
            <div v-else-if="store.isConfigured(hook.id)" class="builtin-card-footer">
              <div class="status-row">
                <AlertCircle :size="12" class="status-icon idle" />
                <span class="status-text idle">{{ t('hookSettings.builtin.configuredButDisabled') }}</span>
              </div>
            </div>
            <div v-else class="builtin-card-footer">
              <div class="status-row">
                <span class="status-text muted">{{ t('hookSettings.builtin.notConfigured') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="filteredGroups.length === 0" class="s-empty-state">
        <p class="builtin-desc">{{ t('hookSettings.builtin.noResults') }}</p>
      </div>
    </div>

    <BuiltinHookConfigModal
      v-if="configModalId"
      :builtin-id="configModalId"
      :initial-provider-id="editDefaults.providerId"
      :initial-config="editDefaults.config"
      :initial-scope="editDefaults.scope"
      @apply="onApplyConfig"
      @close="configModalId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Package, ChevronDown, Settings, CheckCircle, AlertCircle, Wrench } from 'lucide-vue-next'
import { getBuiltinProvider } from '@/types/builtinHooks'
import type { HookScope } from '@/types/hooks'
import { useBuiltinHooksStore } from '@/stores/builtinHooks'
import { api as electronAPIService } from '@/services/electronAPI'
import { useDialog } from '@/composables/useDialog'
import BuiltinHookConfigModal from './BuiltinHookConfigModal.vue'

const { t } = useI18n()
const store = useBuiltinHooksStore()
const { showAlert } = useDialog()

const expanded = ref(true)
const configModalId = ref<string | null>(null)
const searchQuery = ref('')
const sourceFilter = ref('')
const expandedEvents = ref(new Set<string>())

// Node 检测状态
const nodeStatus = ref<'unknown' | 'ok' | 'missing'>('unknown')
const nodeVersion = ref('')
const repairing = ref(false)

onMounted(async () => {
  try {
    const res = await electronAPIService.checkNode()
    if (res.success && res.version) {
      nodeStatus.value = 'ok'
      nodeVersion.value = res.version
    } else {
      nodeStatus.value = 'missing'
    }
  } catch {
    nodeStatus.value = 'missing'
  }
})

async function onRepairPaths() {
  if (repairing.value) return
  repairing.value = true
  try {
    const res = await store.repairAllInstalledHooks()
    console.info('[BuiltinHooksSection] repair updated', res.updated, 'hooks')
  } finally {
    repairing.value = false
  }
}

interface EditDefaults {
  providerId: string
  config: Record<string, string>
  scope: HookScope
}

const editDefaults = reactive<EditDefaults>({
  providerId: '',
  config: {},
  scope: 'user',
})

const eventColorMap: Record<string, string> = {
  PreToolUse: '#ef4444',
  PostToolUse: '#22d3ee',
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

// 按 source + event 分组
interface GroupedHooks {
  source: string
  event: string
  hooks: typeof store.definitions
}

const allGroups = computed<GroupedHooks[]>(() => {
  const map = new Map<string, GroupedHooks>()
  for (const hook of store.definitions) {
    const src = hook.source || 'SpaceCode'
    const key = `${src}::${hook.event}`
    if (!map.has(key)) {
      map.set(key, { source: src, event: hook.event, hooks: [] })
    }
    map.get(key)!.hooks.push(hook)
  }
  return [...map.values()].sort((a, b) => {
    // event 排序：PreToolUse → PostToolUse → Stop → PreCompact → SessionStart → SessionEnd
    const order = ['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact', 'SessionStart', 'SessionEnd']
    const ai = order.indexOf(a.event)
    const bi = order.indexOf(b.event)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.event.localeCompare(b.event)
  })
})

const sourceGroups = computed(() => {
  const map = new Map<string, { source: string; hooks: typeof store.definitions }>()
  for (const hook of store.definitions) {
    const src = hook.source || 'SpaceCode'
    if (!map.has(src)) map.set(src, { source: src, hooks: [] })
    map.get(src)!.hooks.push(hook)
  }
  return [...map.values()]
})

const filteredGroups = computed(() => {
  let groups = allGroups.value
  if (sourceFilter.value) {
    groups = groups.filter(g => g.source === sourceFilter.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    groups = groups
      .map(g => {
        const filtered = g.hooks.filter(
          h => h.name.toLowerCase().includes(q) || h.description.toLowerCase().includes(q) || h.event.toLowerCase().includes(q),
        )
        return filtered.length > 0 ? { ...g, hooks: filtered } : null
      })
      .filter(Boolean) as GroupedHooks[]
  }
  return groups
})

function toggleEventGroup(event: string) {
  if (expandedEvents.value.has(event)) {
    expandedEvents.value.delete(event)
  } else {
    expandedEvents.value.add(event)
  }
}

function getProviderLabel(builtinId: string): string {
  const st = store.getState(builtinId)
  if (!st.providerId) return ''
  const p = getBuiltinProvider(builtinId, st.providerId)
  return p?.label ?? st.providerId
}

function onConfigure(builtinId: string) {
  const st = store.getState(builtinId)
  editDefaults.providerId = st.providerId
  editDefaults.config = { ...st.config }
  editDefaults.scope = st.scope || 'user'
  configModalId.value = builtinId
}

async function onToggle(builtinId: string) {
  const st = store.getState(builtinId)
  if (st.enabled) {
    await store.disable(builtinId)
    return
  }
  // 启用前检查：若 hook 的 provider 需要 node 且未检测到，提示用户
  const def = store.definitions.find(d => d.id === builtinId)
  if (def && nodeStatus.value === 'missing') {
    const needsNode = def.providers.some(p => p.requiresNode)
    if (needsNode) {
      await showAlert(t('hookSettings.builtin.nodeRequiredAlert'))
      return
    }
  }
  if (!store.isConfigured(builtinId)) {
    onConfigure(builtinId)
    return
  }
  const result = await store.enable(builtinId)
  if (!result.ok) {
    onConfigure(builtinId)
  }
}

async function onApplyConfig(
  builtinId: string,
  providerId: string,
  config: Record<string, string>,
  scope: HookScope,
) {
  const st = store.getState(builtinId)
  if (st.enabled) {
    await store.reconfigure(builtinId, providerId, config, scope)
  } else {
    await store.applyAndEnable(builtinId, providerId, config, scope)
  }
  configModalId.value = null
}
</script>

<style lang="scss" scoped>
.builtin-section {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface-card);
}
.builtin-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; cursor: pointer;
  &:hover { background: var(--bg-hover); }
}
.builtin-header-left { display: flex; align-items: center; gap: 8px; }
.s-panel-icon {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 8px;
  &.engine { background: var(--accent-primary-glow); color: var(--accent-primary); }
}
.s-panel-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.builtin-badge {
  font-size: 10px; background: var(--accent-primary); color: white;
  padding: 1px 6px; border-radius: 4px; font-weight: 600;
}
.builtin-hint { font-size: 11px; color: var(--text-muted); }
.builtin-header-right { display: flex; align-items: center; }
.s-expand-icon { color: var(--text-muted); transition: transform 0.2s; &.rotated { transform: rotate(180deg); } }

.builtin-body {
  padding: 0 12px 12px;
  border-top: 1px solid var(--border-default);
}
.builtin-desc { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: 12px 0; }

.builtin-toolbar {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 0;
}

.node-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 6px; margin-top: 10px;
  font-size: 11px;
  &.warn { background: var(--warning-glow); color: var(--warning); border: 1px solid var(--warning); }
  &.ok { background: var(--accent-primary-glow); color: var(--accent-primary); }
  .node-banner-text { flex: 1;
    strong { display: block; font-size: 12px; margin-bottom: 2px; }
    div { color: var(--text-secondary); font-size: 11px; }
  }
}
.node-link {
  color: inherit; text-decoration: underline; font-size: 11px;
  &:hover { opacity: 0.8; }
}
.node-repair-btn {
  @include reset-button;
  display: inline-flex; align-items: center; gap: 4px;
  margin-left: auto; padding: 3px 8px; border-radius: 4px;
  background: transparent; border: 1px solid currentColor;
  font-size: 10px; cursor: pointer;
  &:hover:not(:disabled) { background: var(--bg-hover); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.search-input {
  padding: 7px 10px; background: var(--surface-soft); border: 1px solid var(--border-default);
  border-radius: 6px; color: var(--text-primary); font-size: 12px; outline: none;
  &:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 2px var(--accent-primary-glow); }
  &::placeholder { color: var(--text-muted); }
}
.source-filters { display: flex; gap: 4px; flex-wrap: wrap; }
.source-filter-btn {
  @include reset-button;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 5px; font-size: 11px; font-weight: 500;
  border: 1px solid var(--border-default); background: transparent; color: var(--text-muted);
  cursor: pointer; transition: all 0.15s;
  &:hover { border-color: var(--border-strong); color: var(--text-primary); }
  &.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); color: var(--accent-primary); }
}
.src-count { font-size: 10px; color: var(--text-muted); }

/* Event groups */
.event-group {
  margin-bottom: 8px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  overflow: hidden;
}
.event-group-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; cursor: pointer;
  background: var(--surface-soft);
  &:hover { background: var(--bg-hover); }
}
.event-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.event-label { font-size: 12px; font-weight: 600; color: var(--text-primary); font-family: var(--font-mono); }
.source-badge {
  font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 500;
  &.source-spacecode { background: var(--accent-primary-glow); color: var(--accent-primary); }
  &.source-ecc { background: var(--accent-secondary-glow); color: var(--accent-secondary); }
  &.source-default { background: var(--surface-soft); color: var(--text-muted); }
}
.event-count { font-size: 11px; color: var(--text-muted); margin-left: auto; }
.event-chevron { color: var(--text-muted); transition: transform 0.2s; &.rotated { transform: rotate(180deg); } }

.event-hooks { padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }

/* Cards */
.builtin-card {
  border: 1px solid var(--border-default); border-radius: 8px;
  overflow: hidden; transition: all 0.15s;
  &.enabled { border-color: var(--accent-primary-glow); background: var(--accent-primary-glow); }
  &.configured { border-color: var(--border-strong); }
}
.builtin-card-main {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
}
.builtin-toggle {
  position: relative; width: 32px; height: 18px; border-radius: 9px;
  background: var(--border-default); cursor: pointer; transition: all var(--transition-fast); flex-shrink: 0;
  &.on { background: var(--accent-primary); }
  &::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 14px; height: 14px; border-radius: 50%; background: var(--bg-elevated); transition: all var(--transition-fast);
  }
  &.on::after { left: 16px; }
}
.builtin-icon {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  background: var(--accent-primary-glow); color: var(--accent-primary); flex-shrink: 0;
}
.builtin-info { flex: 1; min-width: 0; }
.builtin-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.builtin-desc-text { font-size: 11px; color: var(--text-muted); line-height: 1.4; }

.builtin-tags { display: flex; gap: 3px; flex-shrink: 0; }
.tag {
  display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 3px;
  font-size: 10px; font-weight: 500;
  &.tag-timeout { background: var(--surface-soft); color: var(--text-muted); }
  &.tag-category {
    &.cat-notification { background: var(--accent-secondary-glow); color: var(--accent-secondary); }
    &.cat-safety { background: var(--warning-glow); color: var(--warning); }
    &.cat-workflow { background: var(--accent-tertiary-glow, rgba(124,58,237,0.12)); color: var(--accent-tertiary); }
  }
  &.tag-matcher { background: var(--surface-soft); color: var(--text-muted); font-family: var(--font-mono); font-size: 9px; }
}

.builtin-actions { flex-shrink: 0; }
.btn-sm {
  @include reset-button;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; transition: all 0.15s;
}
.btn-outline {
  background: transparent; border: 1px solid var(--border-default); color: var(--text-muted);
  &:hover { border-color: var(--border-strong); color: var(--text-primary); background: var(--bg-hover); }
}

.builtin-card-footer {
  padding: 6px 12px;
  border-top: 1px solid var(--border-default);
  background: var(--surface-soft);
}
.status-row { display: flex; align-items: center; gap: 5px; }
.status-icon {
  flex-shrink: 0;
  &.active { color: var(--accent-primary); }
  &.idle { color: var(--warning); }
}
.status-text {
  font-size: 10px; color: var(--text-secondary);
  strong { color: var(--text-primary); }
  &.idle { color: var(--warning); }
  &.muted { color: var(--text-muted); }
}

.s-empty-state { padding: 16px; text-align: center; }
</style>