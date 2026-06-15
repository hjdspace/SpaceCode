<template>
  <div class="trace-list-page">
    <!-- Header -->
    <header class="trace-list-header">
      <div class="header-top">
        <div class="header-brand">
          <div class="brand-icon">
            <Workflow :size="16" aria-hidden="true" />
          </div>
          <div class="brand-text">
            <span class="brand-eyebrow">{{ t('trace.list.eyebrow') }}</span>
            <h2 class="brand-title">{{ t('trace.list.title') }}</h2>
          </div>
        </div>
        <div class="header-actions">
          <button class="icon-btn" @click="load()" :disabled="state.status === 'loading'" :aria-label="t('trace.refresh')">
            <RefreshCw :size="14" :class="{ spin: state.status === 'loading' }" aria-hidden="true" />
          </button>
          <button class="icon-btn close-btn" @click="closeViewer" :aria-label="t('trace.close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- Search -->
      <div class="header-search">
        <Search :size="14" class="search-icon" aria-hidden="true" />
        <input
          v-model="queryInput"
          class="search-input"
          :placeholder="t('trace.list.searchPlaceholder')"
          type="text"
        />
        <span v-if="queryInput" class="search-clear" @click="queryInput = ''">×</span>
      </div>

      <!-- Summary Stats -->
      <div v-if="state.status === 'ready' && state.data.traces.length > 0" class="summary-bar">
        <div class="summary-item">
          <Zap :size="12" />
          <span class="summary-value">{{ summary.apiCalls }}</span>
          <span class="summary-label">{{ t('trace.list.apiCalls') }}</span>
        </div>
        <div class="summary-divider" />
        <div v-if="summary.failedCalls > 0" class="summary-item error">
          <AlertCircle :size="12" />
          <span class="summary-value">{{ summary.failedCalls }}</span>
          <span class="summary-label">{{ t('trace.list.failed') }}</span>
        </div>
        <template v-if="summary.failedCalls > 0"><div class="summary-divider" /></template>
        <div class="summary-item">
          <Cpu :size="12" />
          <span class="summary-value">{{ summary.models }}</span>
          <span class="summary-label">{{ t('trace.list.models') }}</span>
        </div>
        <div class="summary-divider" />
        <div class="summary-item">
          <Hash :size="12" />
          <span class="summary-value">{{ summary.totalTokens }}</span>
          <span class="summary-label">tokens</span>
        </div>
        <div class="summary-divider" />
        <div class="summary-item">
          <Layers :size="12" />
          <span class="summary-value">{{ state.data.total }}</span>
          <span class="summary-label">{{ t('trace.list.sessions') }}</span>
        </div>
      </div>
    </header>

    <!-- Content -->
    <div class="trace-list-body">
      <!-- Loading -->
      <div v-if="state.status === 'loading'" class="trace-state">
        <div class="state-icon">
          <Loader2 :size="28" class="spin" aria-hidden="true" />
        </div>
        <span class="state-text">{{ t('trace.loading') }}</span>
      </div>

      <!-- Error -->
      <div v-else-if="state.status === 'error'" class="trace-state error">
        <div class="state-icon error-icon">
          <AlertCircle :size="28" aria-hidden="true" />
        </div>
        <span class="state-text">{{ state.message }}</span>
        <button class="retry-btn" @click="load()">
          <RefreshCw :size="12" />
          {{ t('common.retry') }}
        </button>
      </div>

      <!-- Empty -->
      <div v-else-if="state.status === 'ready' && state.data.traces.length === 0" class="trace-state">
        <div class="state-icon empty-icon">
          <Inbox :size="32" aria-hidden="true" />
        </div>
        <span class="state-text">{{ query ? t('trace.list.noResults') : t('trace.list.noSessions') }}</span>
        <span v-if="!query" class="state-subtitle">Start a conversation to generate trace data</span>
      </div>

      <!-- Trace Rows -->
      <div v-else-if="state.status === 'ready'" class="trace-rows" role="list">
        <TransitionGroup name="row-fade">
          <div
            v-for="item in paginatedTraces"
            :key="item.sessionId"
            class="trace-card"
            role="listitem"
            tabindex="0"
            @click="emit('selectSession', item.sessionId)"
            @keydown.enter="emit('selectSession', item.sessionId)"
            @keydown.space.prevent="emit('selectSession', item.sessionId)"
          >
            <div class="card-main">
              <div class="card-info">
                <span class="card-title">{{ item.session?.title || formatSessionId(item.sessionId) }}</span>
                <div class="card-meta">
                  <span v-if="item.session?.projectPath" class="meta-path" :title="item.session.projectPath">
                    <Folder :size="10" />
                    {{ extractProjectName(item.session.projectPath) }}
                  </span>
                  <span class="meta-time">
                    <Clock :size="10" />
                    {{ formatRelativeTime(item.fileUpdatedAt) }}
                  </span>
                </div>
              </div>

              <div class="card-stats">
                <div class="stat-pill" :title="'API calls'">
                  <Zap :size="10" />
                  <span>{{ item.summary.apiCalls }}</span>
                </div>
                <div v-if="item.summary.failedCalls > 0" class="stat-pill error" :title="'Failed calls'">
                  <AlertCircle :size="10" />
                  <span>{{ item.summary.failedCalls }}</span>
                </div>
              </div>
            </div>

            <!-- Models row -->
            <div v-if="item.summary.models.length > 0" class="card-models">
              <span v-for="m in item.summary.models.slice(0, 3)" :key="m.model" class="model-tag">
                {{ formatModelName(m.model) }}
                <span class="model-count">×{{ m.calls }}</span>
              </span>
              <span v-if="item.summary.models.length > 3" class="model-tag more">
                +{{ item.summary.models.length - 3 }}
              </span>

              <!-- Token count -->
              <div class="card-tokens">
                <span class="token-item" title="Input tokens">↓ {{ formatTokenCount(item.summary.totalInputTokens) }}</span>
                <span class="token-separator">/</span>
                <span class="token-item" title="Output tokens">↑ {{ formatTokenCount(item.summary.totalOutputTokens) }}</span>
              </div>
            </div>

            <div class="card-arrow">
              <ChevronRight :size="14" aria-hidden="true" />
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="state.status === 'ready' && totalPages > 1" class="trace-pagination">
      <button
        class="page-btn"
        :disabled="currentPage <= 1"
        @click="currentPage--"
      >
        <ChevronLeft :size="14" />
      </button>
      <div class="page-info">
        <span>{{ currentPage }}</span>
        <span class="page-separator">/</span>
        <span>{{ totalPages }}</span>
      </div>
      <button
        class="page-btn"
        :disabled="currentPage >= totalPages"
        @click="currentPage++"
      >
        <ChevronRight :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import type { TraceSessionList } from '@/types/trace'
import { formatTokenCount } from '@/lib/trace/formatters'
import {
  Workflow, RefreshCw, Search, X, Loader2, AlertCircle,
  ChevronRight, ChevronLeft, Zap, Cpu, Layers, Hash,
  Folder, Clock, Inbox
} from 'lucide-vue-next'

type TraceListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TraceSessionList }

const POLL_MS = 5_000
const SEARCH_DEBOUNCE_MS = 250
const PAGE_SIZE = 20

const emit = defineEmits<{
  selectSession: [sessionId: string]
}>()

const { t } = useI18n()
const appStore = useAppStore()

const state = ref<TraceListState>({ status: 'loading' })
const queryInput = ref('')
const query = ref('')
const currentPage = ref(1)
let pollTimer: ReturnType<typeof setInterval> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

// Search debounce
watch(queryInput, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    query.value = val.trim()
    currentPage.value = 1
  }, SEARCH_DEBOUNCE_MS)
})

const totalPages = computed(() => {
  if (state.value.status !== 'ready') return 1
  return Math.max(1, Math.ceil(state.value.data.traces.length / PAGE_SIZE))
})

const paginatedTraces = computed(() => {
  if (state.value.status !== 'ready') return []
  const start = (currentPage.value - 1) * PAGE_SIZE
  return state.value.data.traces.slice(start, start + PAGE_SIZE)
})

const summary = computed(() => {
  if (state.value.status !== 'ready') return { apiCalls: 0, failedCalls: 0, models: 0, totalTokens: '0' }
  const modelNames = new Set<string>()
  let apiCalls = 0, failedCalls = 0, inputTokens = 0, outputTokens = 0
  for (const item of state.value.data.traces) {
    apiCalls += item.summary.apiCalls
    failedCalls += item.summary.failedCalls
    inputTokens += item.summary.totalInputTokens
    outputTokens += item.summary.totalOutputTokens
    for (const m of item.summary.models) modelNames.add(m.model)
  }
  return { apiCalls, failedCalls, models: modelNames.size, totalTokens: formatTokenCount(inputTokens + outputTokens) }
})

async function load(options?: { silent?: boolean }) {
  try {
    if (!options?.silent) state.value = { status: 'loading' }
    const data = await api.trace.list({ query: query.value })
    state.value = { status: 'ready', data }
  } catch (e) {
    if (!options?.silent) {
      state.value = { status: 'error', message: e instanceof Error ? e.message : t('trace.list.loadFailed') }
    }
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => { load({ silent: true }) }, POLL_MS)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null }
}

function closeViewer() {
  appStore.showTraceViewer = false
}

function formatSessionId(id: string): string {
  return id.slice(0, 16) + '…'
}

function extractProjectName(path: string): string {
  if (!path) return ''
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function formatModelName(model: string): string {
  if (!model) return 'unknown'
  // Shorten common model names
  const short = model
    .replace('claude-', '')
    .replace('gpt-', '')
    .replace('-20250929', '')
    .replace('-20250125', '')
    .replace('-latest', '')
  if (short.length > 25) return short.slice(0, 22) + '…'
  return short
}

function formatRelativeTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return t('trace.justNow')
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
    if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`
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
  background: var(--bg-primary);
}

// Header
.trace-list-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--surface-border);
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15));
  color: #818cf8;
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-eyebrow {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  line-height: 1;
}

.brand-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 2px 0 0;
  line-height: 1.2;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  background: none;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  color: var(--text-muted);
  padding: 7px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;

  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.05); color: var(--text-primary); }
  &:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 1px; }
  &:disabled { opacity: 0.4; cursor: default; }
}

.close-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}

// Search
.header-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 20px 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  transition: border-color 0.15s ease, background 0.15s ease;

  &:focus-within {
    border-color: rgba(99, 102, 241, 0.4);
    background: rgba(99, 102, 241, 0.04);
  }

  .search-icon { color: var(--text-muted); flex-shrink: 0; opacity: 0.6; }
  .search-input {
    border: none; background: transparent; outline: none;
    font-size: 13px; color: var(--text-primary); flex: 1; min-width: 0;
    &::placeholder { color: var(--text-muted); opacity: 0.6; }
  }
  .search-clear {
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
    &:hover { color: var(--text-primary); }
  }
}

// Summary Bar
.summary-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 20px 12px;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  color: var(--text-muted);
  font-size: 11px;

  &:first-child { padding-left: 0; }

  .summary-value {
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .summary-label {
    color: var(--text-muted);
  }

  &.error {
    .summary-value { color: #f87171; }
  }
}

.summary-divider {
  width: 1px;
  height: 14px;
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

// Body
.trace-list-body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

// States
.trace-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 64px 24px;
  color: var(--text-muted);

  .state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-muted);
  }

  .state-text {
    font-size: 13px;
    font-weight: 500;
  }

  .state-subtitle {
    font-size: 12px;
    opacity: 0.6;
  }

  &.error {
    .state-icon { background: rgba(239, 68, 68, 0.08); color: #f87171; }
    .state-text { color: #f87171; }
  }
}

.retry-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
  background: transparent;
  color: #f87171;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover { background: rgba(239, 68, 68, 0.08); }
}

// Trace Rows
.trace-rows {
  overflow-y: auto;
  padding: 8px 12px;
  height: 100%;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.08); border-radius: 3px; }
}

.trace-card {
  position: relative;
  padding: 14px 16px;
  margin-bottom: 4px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(255, 255, 255, 0.06);
  }
  &:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -2px; }

  &:hover .card-arrow {
    opacity: 1;
    transform: translateX(0);
  }
}

.card-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.meta-path, .meta-time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.7;
}

.meta-path {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-stats {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.stat-pill {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  font-variant-numeric: tabular-nums;

  &.error {
    color: #f87171;
    background: rgba(239, 68, 68, 0.08);
  }
}

// Models row
.card-models {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.model-tag {
  font-size: 10px;
  font-family: var(--font-mono);
  color: #818cf8;
  background: rgba(99, 102, 241, 0.08);
  padding: 2px 7px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 3px;

  .model-count {
    font-size: 9px;
    opacity: 0.6;
  }

  &.more {
    color: var(--text-muted);
    background: rgba(255, 255, 255, 0.04);
  }
}

.card-tokens {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.token-item {
  font-family: var(--font-mono);
}

.token-separator {
  opacity: 0.3;
}

// Arrow
.card-arrow {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateX(-4px) translateY(-50%);
  color: var(--text-muted);
  opacity: 0;
  transition: all 0.15s ease;
}

// Pagination
.trace-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.page-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.05); color: var(--text-primary); }
  &:disabled { opacity: 0.3; cursor: default; }
}

.page-info {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  gap: 4px;

  span:first-child { color: var(--text-primary); font-weight: 600; }
  .page-separator { opacity: 0.3; }
}

// Animations
.spin {
  animation: spin 1s linear infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.row-fade-enter-active {
  transition: all 0.25s ease;
}
.row-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
</style>
