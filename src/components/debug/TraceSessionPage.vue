<template>
  <div class="trace-session-page">
    <!-- Header -->
    <header class="session-header">
      <button class="back-btn" @click="emit('back')" :aria-label="t('trace.back')">
        <ArrowLeft :size="14" aria-hidden="true" />
        <span>{{ t('trace.back') }}</span>
      </button>
      <div class="session-header-info">
        <h3 class="session-header-title">{{ sessionId.slice(0, 16) }}</h3>
        <div v-if="viewModel" class="session-header-stats">
          <span class="stat">{{ viewModel.diagnosis.modelCalls }} {{ t('trace.modelCalls') }}</span>
          <span class="stat">{{ viewModel.diagnosis.toolCalls }} {{ t('trace.toolCalls') }}</span>
          <span v-if="viewModel.diagnosis.errorCount > 0" class="stat error">{{ viewModel.diagnosis.errorCount }} {{ t('trace.errors') }}</span>
        </div>
      </div>
      <button class="icon-btn" @click="loadData" :disabled="loading" :aria-label="t('trace.refresh')">
        <RefreshCw :size="14" :class="{ spin: loading }" aria-hidden="true" />
      </button>
    </header>

    <!-- Diagnosis Banner -->
    <div
      v-if="viewModel && viewModel.diagnosis.status !== 'healthy' && viewModel.diagnosis.status !== 'empty'"
      class="diagnosis-banner"
      :class="viewModel.diagnosis.status"
    >
      <AlertCircle v-if="viewModel.diagnosis.status === 'blocked'" :size="14" aria-hidden="true" />
      <Clock v-else :size="14" aria-hidden="true" />
      <span class="diagnosis-text">{{ diagnosisText }}</span>
      <button v-if="viewModel.diagnosis.focusSpanId" class="focus-btn" @click="selectSpan(viewModel.diagnosis.focusSpanId)">
        {{ t('trace.focus') }}
      </button>
    </div>

    <!-- Split Layout -->
    <div class="session-body">
      <!-- Loading -->
      <div v-if="loading && !viewModel" class="trace-empty">
        <Loader2 :size="24" class="spin" aria-hidden="true" />
        <span>{{ t('trace.loading') }}</span>
      </div>

      <!-- Empty -->
      <div v-else-if="viewModel && viewModel.spans.length <= 1" class="trace-empty">
        <FileX :size="24" aria-hidden="true" />
        <span>{{ t('trace.noEvents') }}</span>
      </div>

      <!-- Split: Tree + Detail -->
      <template v-else-if="viewModel">
        <div class="split-layout" ref="splitContainer">
          <!-- Left: Span Tree -->
          <div class="split-left" :style="{ width: leftWidth + 'px' }">
            <div class="tree-toolbar">
              <div class="tree-search">
                <Search :size="12" class="search-icon" aria-hidden="true" />
                <input v-model="treeSearch" class="tree-search-input" :placeholder="t('trace.searchSpans')" type="text" />
              </div>
              <div class="tree-filters">
                <button
                  v-for="f in filterOptions"
                  :key="f.value"
                  class="filter-btn"
                  :class="{ active: activeFilter === f.value }"
                  @click="activeFilter = activeFilter === f.value ? 'all' : f.value"
                  :aria-pressed="activeFilter === f.value"
                >
                  <component :is="f.icon" :size="11" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div class="span-tree" role="tree" @keydown="handleTreeKeydown">
              <!-- Turn Groups -->
              <div v-for="turn in filteredTurns" :key="turn.id" class="turn-group">
                <button
                  class="turn-header"
                  @click="toggleTurn(turn.id)"
                  :aria-expanded="!collapsedTurns.has(turn.id)"
                >
                  <ChevronRight :size="12" class="turn-chevron" :class="{ expanded: !collapsedTurns.has(turn.id) }" aria-hidden="true" />
                  <span class="turn-title">{{ turn.title }}</span>
                  <span class="turn-index">Turn {{ turn.index + 1 }}</span>
                  <span class="turn-count">{{ turn.spanIds.length }}</span>
                </button>

                <div v-if="!collapsedTurns.has(turn.id)" class="turn-spans">
                  <button
                    v-for="spanId in getFilteredSpanIds(turn.spanIds)"
                      :key="spanId"
                    class="span-row"
                    :class="{ selected: selectedSpanId === spanId, [getSpanKind(viewModel!.spansById.get(spanId)!)]: true }"
                    :ref="el => { if (el) spanRefs[spanId] = el as HTMLElement }"
                    @click="selectSpan(spanId)"
                    role="treeitem"
                    :aria-selected="selectedSpanId === spanId"
                    tabindex="0"
                  >
                    <TypeIcon :kind="viewModel!.spansById.get(spanId)!.kind" :status="viewModel!.spansById.get(spanId)!.status" />
                    <span class="span-title">{{ viewModel!.spansById.get(spanId)!.title }}</span>
                    <StatusPill :status="viewModel!.spansById.get(spanId)!.status" />
                    <span v-if="viewModel!.spansById.get(spanId)!.durationMs" class="span-duration">
                      {{ formatDurationMs(viewModel!.spansById.get(spanId)!.durationMs) }}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Drag Handle -->
          <div class="split-handle" @mousedown="startResize" />

          <!-- Right: Detail Panel -->
          <div class="split-right">
            <div v-if="!selectedSpanId" class="detail-empty">
              <ClipboardList :size="24" aria-hidden="true" />
              <span>{{ t('trace.selectSpan') }}</span>
            </div>
            <TraceDetailPanel v-else :span="selectedSpan!" :view-model="viewModel!" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, reactive, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { buildTraceViewModel, type TraceViewModel, type TraceTurn, type TraceSpan } from '@/lib/traceViewModel'
import { formatDurationMs } from '@/lib/trace/formatters'
import {
  ArrowLeft, RefreshCw, Loader2, FileX, AlertCircle, Clock,
  ChevronRight, Search, Zap, Wrench, Bot, User, Activity, ClipboardList
} from 'lucide-vue-next'
import TypeIcon from './trace/TypeIcon.vue'
import StatusPill from './trace/StatusPill.vue'
import TraceDetailPanel from './trace/TraceDetailPanel.vue'

const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ back: [] }>()

const { t } = useI18n()

const loading = ref(false)
const viewModel = ref<TraceViewModel | null>(null)
const selectedSpanId = ref<string | null>(null)
const treeSearch = ref('')
const activeFilter = ref<'all' | 'llm' | 'tool' | 'error'>('all')
const collapsedTurns = reactive(new Set<string>())
const leftWidth = ref(340)
const spanRefs = reactive<Record<string, HTMLElement>>({})

let pollTimer: ReturnType<typeof setInterval> | null = null

const filterOptions = [
  { value: 'llm' as const, icon: Bot },
  { value: 'tool' as const, icon: Wrench },
  { value: 'error' as const, icon: AlertCircle },
]

const selectedSpan = computed(() => {
  if (!viewModel.value || !selectedSpanId.value) return null
  return viewModel.value.spansById.get(selectedSpanId.value) ?? null
})

const filteredTurns = computed(() => {
  if (!viewModel.value) return []
  return viewModel.value.turns
})

const diagnosisText = computed(() => {
  if (!viewModel.value) return ''
  const d = viewModel.value.diagnosis
  const REASONS: Record<string, string> = {
    model_error: t('trace.diagnosis.modelError'),
    tool_error: t('trace.diagnosis.toolError'),
    event_error: t('trace.diagnosis.eventError'),
    pending_model: t('trace.diagnosis.pendingModel'),
    pending_tool: t('trace.diagnosis.pendingTool'),
    waiting_for_agent: t('trace.diagnosis.waitingAgent'),
  }
  return REASONS[d.reason] || d.reason
})

function getFilteredSpanIds(spanIds: string[]): string[] {
  if (!viewModel.value) return []
  return spanIds.filter(id => {
    const span = viewModel.value!.spansById.get(id)
    if (!span) return false
    if (span.isLifecycleNoise) return false
    if (activeFilter.value === 'llm') return span.kind === 'llm'
    if (activeFilter.value === 'tool') return span.kind === 'tool' || span.kind === 'tool_result'
    if (activeFilter.value === 'error') return span.status === 'error'
    if (treeSearch.value) {
      const q = treeSearch.value.toLowerCase()
      return span.title.toLowerCase().includes(q) || span.subtitle.toLowerCase().includes(q)
    }
    return true
  })
}

function getSpanKind(span: TraceSpan): string {
  return span.kind
}

async function loadData() {
  loading.value = true
  try {
    const result = await api.debug.readTraceEvents(props.sessionId, 5000)
    if (result.success && result.events) {
      viewModel.value = buildTraceViewModel(result.events)
    }
  } catch (e) {
    console.error('[TraceSession] Failed to load:', e)
  } finally {
    loading.value = false
  }
}

function selectSpan(spanId: string) {
  selectedSpanId.value = spanId
}

function toggleTurn(turnId: string) {
  if (collapsedTurns.has(turnId)) collapsedTurns.delete(turnId)
  else collapsedTurns.add(turnId)
}

function handleTreeKeydown(e: KeyboardEvent) {
  if (!viewModel.value) return
  const visibleIds = viewModel.value.orderedSpanIds.filter(id => {
    const span = viewModel.value!.spansById.get(id)
    return span && !span.isLifecycleNoise
  })
  const currentIndex = visibleIds.indexOf(selectedSpanId.value || '')
  if (e.key === 'ArrowDown' && currentIndex < visibleIds.length - 1) {
    e.preventDefault()
    selectSpan(visibleIds[currentIndex + 1])
    nextTick(() => spanRefs[visibleIds[currentIndex + 1]]?.focus())
  } else if (e.key === 'ArrowUp' && currentIndex > 0) {
    e.preventDefault()
    selectSpan(visibleIds[currentIndex - 1])
    nextTick(() => spanRefs[visibleIds[currentIndex - 1]]?.focus())
  }
}

// Resize
const splitContainer = ref<HTMLElement | null>(null)
let resizeStartX = 0
let resizeStartWidth = 0

function startResize(e: MouseEvent) {
  resizeStartX = e.clientX
  resizeStartWidth = leftWidth.value
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function handleResize(e: MouseEvent) {
  const diff = e.clientX - resizeStartX
  leftWidth.value = Math.min(Math.max(resizeStartWidth + diff, 260), 560)
}

function stopResize() {
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => { loadData() }, 1500)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

onMounted(() => { loadData(); startPolling() })
onUnmounted(stopPolling)
</script>

<style lang="scss" scoped>
.trace-session-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.session-header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--surface-border);
  gap: 12px;
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
  &:hover { background: var(--surface-glass-hover); color: var(--text-primary); }
}

.session-header-info {
  flex: 1;
  min-width: 0;
}

.session-header-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  font-family: var(--font-mono);
}

.session-header-stats {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  .stat {
    font-size: 11px;
    color: var(--text-muted);
    &.error { color: var(--error); }
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
  transition: all var(--transition-fast);
  &:hover { background: var(--surface-glass-hover); color: var(--text-primary); }
  &:disabled { opacity: 0.5; }
}

// Diagnosis Banner
.diagnosis-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;

  &.blocked {
    background: rgba(239, 68, 68, 0.08);
    color: var(--error);
    border-bottom: 1px solid rgba(239, 68, 68, 0.2);
  }
  &.attention {
    background: rgba(245, 158, 11, 0.08);
    color: #f59e0b;
    border-bottom: 1px solid rgba(245, 158, 11, 0.2);
  }
}

.focus-btn {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
  &:hover { background: rgba(255,255,255,0.1); }
}

// Body
.session-body {
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
  padding: 48px;
  color: var(--text-muted);
  font-size: 13px;
}

// Split Layout
.split-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.split-left {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.split-handle {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.2s;
  flex-shrink: 0;
  &:hover { background: var(--accent-primary); }
}

.split-right {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: var(--text-muted);
  font-size: 13px;
}

// Tree Toolbar
.tree-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.tree-search {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  .search-icon { color: var(--text-muted); flex-shrink: 0; }
  .tree-search-input {
    border: none; background: transparent; outline: none;
    font-size: 11px; color: var(--text-primary); width: 100%;
    &::placeholder { color: var(--text-muted); }
  }
}

.tree-filters {
  display: flex;
  gap: 2px;
}

.filter-btn {
  padding: 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: all var(--transition-fast);
  &:hover { background: var(--surface-glass-hover); }
  &.active { background: var(--surface-glass-active); color: var(--accent-primary); border-color: var(--accent-primary); }
}

// Span Tree
.span-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: var(--surface-border); border-radius: 3px; }
}

.turn-group {
  margin-bottom: 2px;
}

.turn-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
  &:hover { background: var(--surface-glass-hover); }
}

.turn-chevron {
  transition: transform 0.15s ease;
  &.expanded { transform: rotate(90deg); }
}

.turn-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-weight: 500;
}

.turn-index {
  font-size: 10px;
  color: var(--text-muted);
}

.turn-count {
  font-size: 10px;
  padding: 0 5px;
  background: var(--bg-secondary);
  border-radius: var(--radius-full);
  color: var(--text-muted);
}

.turn-spans {
  padding-left: 8px;
}

.span-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
  border-radius: 0;
  border-left: 2px solid transparent;

  &:hover { background: var(--surface-glass-hover); }
  &:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -2px; }

  &.selected {
    background: var(--surface-glass-active);
    border-left-color: var(--accent-primary);
    color: var(--text-primary);
  }

  &.llm .span-title { color: var(--accent-primary); }
  &.tool .span-title { color: var(--success); }
  &.tool_result .span-title { color: var(--success); }
  &.error .span-title { color: var(--error); }
}

.span-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.span-duration {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
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
