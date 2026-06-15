<template>
  <div class="trace-session-page">
    <!-- Header -->
    <header class="session-header">
      <button class="back-btn" @click="emit('back')" :aria-label="t('trace.back')">
        <ArrowLeft :size="14" aria-hidden="true" />
      </button>
      <div class="session-header-info">
        <div class="session-title-row">
          <h3 class="session-header-title">{{ displayTitle }}</h3>
          <StatusPill v-if="viewModel" :status="viewModel.spansById.get(rootId)?.status || 'ok'" />
        </div>
        <div v-if="viewModel" class="session-header-stats">
          <div class="header-stat">
            <Bot :size="11" />
            <span>{{ viewModel.diagnosis.modelCalls }}</span>
          </div>
          <div class="header-stat">
            <Wrench :size="11" />
            <span>{{ viewModel.diagnosis.toolCalls }}</span>
          </div>
          <div v-if="viewModel.diagnosis.errorCount > 0" class="header-stat error">
            <AlertCircle :size="11" />
            <span>{{ viewModel.diagnosis.errorCount }}</span>
          </div>
          <div class="header-stat">
            <GitBranch :size="11" />
            <span>{{ viewModel.turns.length }} turns</span>
          </div>
          <span v-if="totalDuration" class="header-stat duration">{{ totalDuration }}</span>
        </div>
      </div>
      <button class="icon-btn" @click="loadData" :disabled="loading" :aria-label="t('trace.refresh')">
        <RefreshCw :size="14" :class="{ spin: loading }" aria-hidden="true" />
      </button>
    </header>

    <!-- Diagnosis Banner -->
    <Transition name="banner-slide">
      <div
        v-if="viewModel && viewModel.diagnosis.status !== 'healthy' && viewModel.diagnosis.status !== 'empty'"
        class="diagnosis-banner"
        :class="viewModel.diagnosis.status"
      >
        <div class="diagnosis-icon" :class="viewModel.diagnosis.status">
          <AlertTriangle v-if="viewModel.diagnosis.status === 'blocked'" :size="14" aria-hidden="true" />
          <Clock v-else-if="viewModel.diagnosis.status === 'attention'" :size="14" aria-hidden="true" />
          <Loader2 v-else :size="14" class="spin" aria-hidden="true" />
        </div>
        <span class="diagnosis-text">{{ diagnosisText }}</span>
        <button v-if="viewModel.diagnosis.focusSpanId" class="focus-btn" @click="selectSpan(viewModel.diagnosis.focusSpanId!)">
          {{ t('trace.focus') }}
          <ArrowRight :size="11" />
        </button>
      </div>
    </Transition>

    <!-- Body -->
    <div class="session-body">
      <!-- Loading -->
      <div v-if="loading && !viewModel" class="trace-state">
        <div class="state-icon">
          <Loader2 :size="28" class="spin" aria-hidden="true" />
        </div>
        <span class="state-text">{{ t('trace.loading') }}</span>
      </div>

      <!-- Empty -->
      <div v-else-if="viewModel && viewModel.spans.length <= 1" class="trace-state">
        <div class="state-icon">
          <Inbox :size="32" aria-hidden="true" />
        </div>
        <span class="state-text">{{ t('trace.noEvents') }}</span>
      </div>

      <!-- Split: Tree + Detail -->
      <div v-else-if="viewModel" class="split-layout" ref="splitContainer">
        <!-- Left: Span Tree -->
        <div class="split-left" :style="{ width: leftWidth + 'px' }">
          <!-- Toolbar -->
          <div class="tree-toolbar">
            <div class="tree-search">
              <Search :size="12" class="search-icon" aria-hidden="true" />
              <input v-model="treeSearch" class="tree-search-input" :placeholder="t('trace.searchSpans')" type="text" />
              <span v-if="treeSearch" class="search-clear-btn" @click="treeSearch = ''">×</span>
            </div>
            <div class="tree-filters">
              <button
                v-for="f in filterOptions"
                :key="f.value"
                class="filter-btn"
                :class="{ active: activeFilter === f.value }"
                @click="activeFilter = activeFilter === f.value ? 'all' : f.value"
                :aria-pressed="activeFilter === f.value"
                :title="f.label"
              >
                <component :is="f.icon" :size="12" aria-hidden="true" />
              </button>
            </div>
          </div>

          <!-- Span Tree -->
          <div class="span-tree" role="tree" @keydown="handleTreeKeydown">
            <div v-for="turn in filteredTurns" :key="turn.id" class="turn-group">
              <button
                class="turn-header"
                @click="toggleTurn(turn.id)"
                :aria-expanded="!collapsedTurns.has(turn.id)"
              >
                <ChevronRight
                  :size="11"
                  class="turn-chevron"
                  :class="{ expanded: !collapsedTurns.has(turn.id) }"
                  aria-hidden="true"
                />
                <span class="turn-title">{{ turn.title }}</span>
                <span class="turn-count">{{ turn.spanIds.length }}</span>
              </button>

              <Transition name="turn-slide">
                <div v-if="!collapsedTurns.has(turn.id)" class="turn-spans">
                  <button
                    v-for="spanId in getFilteredSpanIds(turn.spanIds)"
                    :key="spanId"
                    class="span-row"
                    :class="{
                      selected: selectedSpanId === spanId,
                      ['kind-' + getSpanKind(viewModel!.spansById.get(spanId)!)]: true,
                      ['status-' + getSpanStatus(viewModel!.spansById.get(spanId)!)]: true,
                    }"
                    :ref="el => { if (el) spanRefs[spanId] = el as HTMLElement }"
                    @click="selectSpan(spanId)"
                    role="treeitem"
                    :aria-selected="selectedSpanId === spanId"
                    tabindex="0"
                  >
                    <TypeIcon :kind="viewModel!.spansById.get(spanId)!.kind" :status="viewModel!.spansById.get(spanId)!.status" />
                    <span class="span-title">{{ viewModel!.spansById.get(spanId)!.title }}</span>
                    <span v-if="viewModel!.spansById.get(spanId)!.durationMs" class="span-duration">
                      {{ formatDurationMs(viewModel!.spansById.get(spanId)!.durationMs) }}
                    </span>
                  </button>
                </div>
              </Transition>
            </div>
          </div>
        </div>

        <!-- Drag Handle -->
        <div class="split-handle" @mousedown="startResize" />

        <!-- Right: Detail Panel -->
        <div class="split-right">
          <Transition name="detail-fade" mode="out-in">
            <div v-if="!selectedSpanId" class="detail-empty" key="empty">
              <div class="empty-icon">
                <MousePointerClick :size="28" aria-hidden="true" />
              </div>
              <span class="empty-text">{{ t('trace.selectSpan') }}</span>
            </div>
            <TraceDetailPanel
              v-else
              :key="selectedSpanId"
              :span="selectedSpan!"
              :view-model="viewModel!"
              @select-span="selectSpan"
            />
          </Transition>
        </div>
      </div>
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
  ArrowLeft, ArrowRight, RefreshCw, Loader2, AlertCircle, AlertTriangle, Clock,
  ChevronRight, Search, Zap, Wrench, Bot, GitBranch, Inbox, MousePointerClick
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
const leftWidth = ref(360)
const spanRefs = reactive<Record<string, HTMLElement>>({})

let pollTimer: ReturnType<typeof setInterval> | null = null

const rootId = 'session:root'

const filterOptions = [
  { value: 'llm' as const, icon: Bot, label: 'LLM calls' },
  { value: 'tool' as const, icon: Wrench, label: 'Tool calls' },
  { value: 'error' as const, icon: AlertCircle, label: 'Errors' },
]

const displayTitle = computed(() => {
  const root = viewModel.value?.spansById.get(rootId)
  return root?.title || props.sessionId.slice(0, 16)
})

const totalDuration = computed(() => {
  const root = viewModel.value?.spansById.get(rootId)
  return root?.durationMs ? formatDurationMs(root.durationMs) : ''
})

const selectedSpan = computed(() => {
  if (!viewModel.value || !selectedSpanId.value) return null
  return viewModel.value.spansById.get(selectedSpanId.value) ?? null
})

const filteredTurns = computed((): TraceTurn[] => {
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
      return (
        span.title.toLowerCase().includes(q) ||
        span.subtitle.toLowerCase().includes(q) ||
        span.kind.toLowerCase().includes(q) ||
        (span.toolName?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })
}

function getSpanKind(span: TraceSpan): string { return span.kind }
function getSpanStatus(span: TraceSpan): string { return span.status }

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
  leftWidth.value = Math.min(Math.max(resizeStartWidth + diff, 280), 560)
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
  background: var(--bg-primary);
}

// Header
.session-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--surface-border);
  gap: 10px;
  flex-shrink: 0;
}

.back-btn {
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
  flex-shrink: 0;
  &:hover { background: rgba(255, 255, 255, 0.05); color: var(--text-primary); }
}

.session-header-info {
  flex: 1;
  min-width: 0;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-header-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-header-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
}

.header-stat {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-muted);
  &.error { color: #f87171; }
  &.duration {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.04);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
  }
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  color: var(--text-muted);
  padding: 7px;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  &:hover { background: rgba(255, 255, 255, 0.05); color: var(--text-primary); }
  &:disabled { opacity: 0.4; }
}

// Diagnosis Banner
.diagnosis-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;

  &.blocked {
    background: rgba(239, 68, 68, 0.06);
    border-bottom: 1px solid rgba(239, 68, 68, 0.15);
    .diagnosis-text { color: #f87171; }
  }
  &.attention {
    background: rgba(245, 158, 11, 0.06);
    border-bottom: 1px solid rgba(245, 158, 11, 0.15);
    .diagnosis-text { color: #fbbf24; }
  }
}

.diagnosis-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;

  &.blocked { background: rgba(239, 68, 68, 0.12); color: #f87171; }
  &.attention { background: rgba(245, 158, 11, 0.12); color: #fbbf24; }
}

.diagnosis-text {
  flex: 1;
}

.focus-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  opacity: 0.8;
  &:hover { opacity: 1; background: rgba(255, 255, 255, 0.05); }
}

// Body
.session-body {
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
  padding: 64px;
  color: var(--text-muted);

  .state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
  }

  .state-text {
    font-size: 13px;
    font-weight: 500;
  }
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
  flex-shrink: 0;
}

.split-handle {
  width: 3px;
  cursor: col-resize;
  background: var(--surface-border);
  transition: background 0.2s ease;
  flex-shrink: 0;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    right: -3px;
  }

  &:hover {
    background: rgba(99, 102, 241, 0.5);
  }
}

.split-right {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border-left: 1px solid var(--surface-border);
}

.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: var(--text-muted);

  .empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
    opacity: 0.5;
  }

  .empty-text {
    font-size: 13px;
    font-weight: 500;
    opacity: 0.6;
  }
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
  gap: 6px;
  flex: 1;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  transition: border-color 0.15s ease;

  &:focus-within { border-color: rgba(99, 102, 241, 0.4); }

  .search-icon { color: var(--text-muted); flex-shrink: 0; opacity: 0.6; }
  .tree-search-input {
    border: none; background: transparent; outline: none;
    font-size: 12px; color: var(--text-primary); width: 100%;
    &::placeholder { color: var(--text-muted); opacity: 0.5; }
  }
  .search-clear-btn {
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    &:hover { color: var(--text-primary); }
  }
}

.tree-filters {
  display: flex;
  gap: 2px;
}

.filter-btn {
  padding: 5px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: all 0.15s ease;

  &:hover { background: rgba(255, 255, 255, 0.05); }
  &.active {
    background: rgba(99, 102, 241, 0.1);
    color: #818cf8;
    border-color: rgba(99, 102, 241, 0.2);
  }
}

// Span Tree
.span-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;

  &::-webkit-scrollbar { width: 5px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.08); border-radius: 3px; }
}

.turn-group {
  margin-bottom: 1px;
}

.turn-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;

  &:hover { background: rgba(255, 255, 255, 0.03); }
}

.turn-chevron {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  opacity: 0.5;
  flex-shrink: 0;
  &.expanded { transform: rotate(90deg); }
}

.turn-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.turn-count {
  font-size: 10px;
  padding: 0 6px;
  min-width: 18px;
  text-align: center;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 9999px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.turn-spans {
  padding-left: 6px;
  overflow: hidden;
}

.span-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 10px 5px 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: all 0.1s ease;
  border-radius: 0;
  border-left: 2px solid transparent;
  position: relative;

  &:hover { background: rgba(255, 255, 255, 0.03); }
  &:focus-visible { outline: 2px solid rgba(99, 102, 241, 0.5); outline-offset: -2px; border-radius: 4px; }

  &.selected {
    background: rgba(99, 102, 241, 0.08);
    border-left-color: #818cf8;
    color: var(--text-primary);
  }

  // Kind-specific left border colors
  &.kind-llm { border-left-color: transparent; &:hover { border-left-color: rgba(99, 102, 241, 0.3); } }
  &.kind-tool, &.kind-tool_result { &:hover { border-left-color: rgba(16, 185, 129, 0.3); } }
  &.kind-message { &:hover { border-left-color: rgba(139, 92, 246, 0.3); } }

  // Selected overrides
  &.selected.kind-llm { border-left-color: #818cf8; }
  &.selected.kind-tool, &.selected.kind-tool_result { border-left-color: #34d399; }
  &.selected.kind-message { border-left-color: #a78bfa; }
  &.status-error { &.selected { border-left-color: #f87171; } }
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
  opacity: 0.7;
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

.banner-slide-enter-active,
.banner-slide-leave-active {
  transition: all 0.25s ease;
}
.banner-slide-enter-from,
.banner-slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  overflow: hidden;
}

.turn-slide-enter-active,
.turn-slide-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  max-height: 2000px;
  opacity: 1;
}
.turn-slide-enter-from,
.turn-slide-leave-to {
  max-height: 0;
  opacity: 0;
}

.detail-fade-enter-active,
.detail-fade-leave-active {
  transition: opacity 0.15s ease;
}
.detail-fade-enter-from,
.detail-fade-leave-to {
  opacity: 0;
}
</style>
