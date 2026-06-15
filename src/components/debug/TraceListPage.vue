<template>
  <div class="trace-list-page">
    <!-- Header -->
    <header class="trace-list-header">
      <div class="header-left">
        <div class="header-eyebrow">
          <Workflow :size="14" aria-hidden="true" />
          <span>{{ t('trace.list.eyebrow') }}</span>
        </div>
        <div class="header-title-row">
          <h2 class="header-title">{{ t('trace.list.title') }}</h2>
          <span v-if="state.status === 'ready'" class="header-count">{{ state.data.total }} {{ t('trace.list.sessions') }}</span>
        </div>
      </div>
      <div class="header-actions">
        <div class="search-box">
          <Search :size="14" class="search-icon" aria-hidden="true" />
          <input
            v-model="queryInput"
            class="search-input"
            :placeholder="t('trace.list.searchPlaceholder')"
            type="text"
          />
        </div>
        <button class="icon-btn" @click="load()" :disabled="state.status === 'loading'" :aria-label="t('trace.refresh')">
          <RefreshCw :size="14" :class="{ spin: state.status === 'loading' }" aria-hidden="true" />
        </button>
        <button class="icon-btn close-btn" @click="closeViewer" :aria-label="t('trace.close')">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
    </header>

    <!-- Stats -->
    <div v-if="state.status === 'ready' && state.data.traces.length > 0" class="trace-stats">
      <div class="stat-chip">
        <Zap :size="12" aria-hidden="true" />
        <span>{{ summary.apiCalls }} {{ t('trace.list.apiCalls') }}</span>
      </div>
      <div v-if="summary.failedCalls > 0" class="stat-chip error">
        <AlertCircle :size="12" aria-hidden="true" />
        <span>{{ summary.failedCalls }} {{ t('trace.list.failed') }}</span>
      </div>
      <div class="stat-chip">
        <Cpu :size="12" aria-hidden="true" />
        <span>{{ summary.models }} {{ t('trace.list.models') }}</span>
      </div>
    </div>

    <!-- Content -->
    <div class="trace-list-body">
      <!-- Loading -->
      <div v-if="state.status === 'loading'" class="trace-empty">
        <Loader2 :size="24" class="spin" aria-hidden="true" />
        <span>{{ t('trace.loading') }}</span>
      </div>

      <!-- Error -->
      <div v-else-if="state.status === 'error'" class="trace-empty error">
        <AlertCircle :size="24" aria-hidden="true" />
        <span>{{ state.message }}</span>
        <button class="retry-btn" @click="load()">{{ t('common.retry') }}</button>
      </div>

      <!-- Empty -->
      <div v-else-if="state.status === 'ready' && state.data.traces.length === 0" class="trace-empty">
        <FileX :size="24" aria-hidden="true" />
        <span>{{ t('trace.list.noSessions') }}</span>
      </div>

      <!-- Trace Rows -->
      <div v-else-if="state.status === 'ready'" class="trace-rows" role="list">
        <div
          v-for="item in state.data.traces"
          :key="item.sessionId"
          class="trace-row"
          role="listitem"
          tabindex="0"
          @click="emit('selectSession', item.sessionId)"
          @keydown.enter="emit('selectSession', item.sessionId)"
          @keydown.space.prevent="emit('selectSession', item.sessionId)"
        >
          <div class="trace-row-info">
            <span class="trace-row-title">{{ item.session?.title || item.sessionId.slice(0, 16) }}</span>
            <div class="trace-row-meta">
              <span class="meta-chip"><Zap :size="10" /> {{ item.summary.apiCalls }}</span>
              <span v-if="item.summary.failedCalls > 0" class="meta-chip error"><AlertCircle :size="10" /> {{ item.summary.failedCalls }}</span>
              <span v-for="m in item.summary.models.slice(0, 2)" :key="m.model" class="meta-chip model">{{ formatModelName(m.model) }}</span>
              <span v-if="item.summary.models.length > 2" class="meta-chip">+{{ item.summary.models.length - 2 }}</span>
            </div>
          </div>
          <div class="trace-row-right">
            <span class="trace-row-path">{{ item.session?.projectPath }}</span>
            <span class="trace-row-time">{{ formatRelativeTime(item.fileUpdatedAt) }}</span>
          </div>
          <ChevronRight :size="14" class="trace-row-arrow" aria-hidden="true" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import type { TraceSessionList, TraceSessionListItem } from '@/types/trace'
import {
  Workflow, RefreshCw, Search, X, Loader2, FileX, AlertCircle,
  ChevronRight, Zap, Cpu
} from 'lucide-vue-next'

type TraceListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TraceSessionList }

const POLL_MS = 5_000
const SEARCH_DEBOUNCE_MS = 250

const emit = defineEmits<{
  selectSession: [sessionId: string]
}>()

const { t } = useI18n()
const appStore = useAppStore()

const state = ref<TraceListState>({ status: 'loading' })
const queryInput = ref('')
const query = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

// Search debounce
watch(queryInput, (val) => {
  setTimeout(() => { query.value = val.trim() }, SEARCH_DEBOUNCE_MS)
})

const summary = computed(() => {
  if (state.value.status !== 'ready') return { apiCalls: 0, failedCalls: 0, models: 0 }
  const modelNames = new Set<string>()
  let apiCalls = 0, failedCalls = 0
  for (const item of state.value.data.traces) {
    apiCalls += item.summary.apiCalls
    failedCalls += item.summary.failedCalls
    for (const m of item.summary.models) modelNames.add(m.model)
  }
  return { apiCalls, failedCalls, models: modelNames.size }
})

async function load(options?: { silent?: boolean }) {
  try {
    if (!options?.silent) state.value = { status: 'loading' }
    const data = await api.trace.list({ query: query.value })
    state.value = { status: 'ready', data }
  } catch (e) {
    state.value = { status: 'error', message: e instanceof Error ? e.message : t('trace.list.loadFailed') }
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => { load({ silent: true }) }, POLL_MS)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

function closeViewer() {
  appStore.showTraceViewer = false
}

function formatModelName(model: string): string {
  if (!model) return 'unknown'
  const parts = model.split('-')
  if (parts.length > 1) return parts.slice(0, -1).join('-')
  return model
}

function formatRelativeTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return t('trace.justNow')
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`
    return d.toLocaleDateString()
  } catch { return iso }
}

onMounted(() => { load(); startPolling() })
onUnmounted(stopPolling)
</script>

<style lang="scss" scoped>
.trace-list-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.trace-list-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--surface-border);
  gap: 16px;
  flex-shrink: 0;
}

.header-left {
  min-width: 0;
}

.header-eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

.header-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 4px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.header-count {
  font-size: 12px;
  color: var(--text-muted);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast);

  &:focus-within { border-color: var(--accent-primary); }

  .search-icon { color: var(--text-muted); flex-shrink: 0; }
  .search-input {
    border: none; background: transparent; outline: none;
    font-size: 12px; color: var(--text-primary); width: 180px;
    &::placeholder { color: var(--text-muted); }
  }
}

.icon-btn {
  background: none;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  padding: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) { background: var(--surface-glass-hover); color: var(--text-primary); }
  &:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 1px; }
  &:disabled { opacity: 0.5; }
}

.close-btn {
  &:hover { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: var(--error); }
}

.trace-stats {
  display: flex;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.stat-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-radius: var(--radius-full);

  &.error { color: var(--error); background: rgba(239, 68, 68, 0.1); }
}

.trace-list-body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.trace-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 16px;
  color: var(--text-muted);
  font-size: 13px;

  &.error { color: var(--error); }
}

.retry-btn {
  padding: 4px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent-primary);
  font-size: 12px;
  cursor: pointer;
  &:hover { background: var(--surface-glass-hover); }
}

.trace-rows {
  overflow-y: auto;
  padding: 4px 8px;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: var(--surface-border); border-radius: 3px; }
}

.trace-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast);
  gap: 12px;

  &:hover { background: var(--surface-glass-hover); }
  &:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -1px; }
}

.trace-row-info {
  flex: 1;
  min-width: 0;
}

.trace-row-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trace-row-meta {
  display: flex;
  gap: 6px;
  margin-top: 3px;
  flex-wrap: wrap;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-muted);

  &.error { color: var(--error); }
  &.model { color: var(--accent-primary); }
}

.trace-row-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}

.trace-row-path {
  font-size: 10px;
  color: var(--text-muted);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-row-time {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.trace-row-arrow {
  color: var(--text-muted);
  flex-shrink: 0;
}

.spin {
  animation: spin 1s linear infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
