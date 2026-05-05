<template>
  <div class="trace-viewer">
    <div class="trace-header">
      <div class="trace-title-row">
        <Activity :size="18" />
        <span class="trace-title">{{ t('trace.title') }}</span>
      </div>
      <div class="trace-header-actions">
        <button class="header-btn" @click="loadData" :disabled="loading" :title="t('trace.refresh')">
          <RefreshCw :size="14" :class="{ spin: loading }" />
        </button>
        <button class="header-btn close-btn" @click="closeViewer" :title="t('trace.close')">
          <X :size="14" />
        </button>
      </div>
    </div>

    <div class="trace-tabs">
      <button
        class="trace-tab"
        :class="{ active: activeView === 'sessions' }"
        @click="activeView = 'sessions'"
      >{{ t('trace.sessions') }}</button>
      <button
        class="trace-tab"
        :class="{ active: activeView === 'logs' }"
        @click="activeView = 'logs'"
      >{{ t('trace.rawLogs') }}</button>
    </div>

    <div class="trace-body">
      <div v-if="activeView === 'sessions'" class="sessions-layout">
        <div class="sessions-sidebar">
          <div v-if="loading && traceSessions.length === 0" class="trace-empty">
            <Loader2 :size="20" class="spin" />
            <span>{{ t('trace.loading') }}</span>
          </div>
          <div v-else-if="traceSessions.length === 0" class="trace-empty">
            <FileX :size="20" />
            <span>{{ t('trace.noSessions') }}</span>
          </div>
          <div v-else class="session-list">
            <div
              v-for="session in traceSessions"
              :key="session.sessionId"
              class="session-item"
              :class="{ active: selectedSessionId === session.sessionId }"
              @click="selectSession(session.sessionId)"
            >
              <div class="session-info">
                <span class="session-id">{{ session.sessionId.slice(0, 16) }}</span>
                <span class="session-meta">{{ session.eventCount }} {{ t('trace.events') }}</span>
              </div>
              <span class="session-time">{{ formatTime(session.modifiedAt) }}</span>
            </div>
          </div>
        </div>

        <div class="events-panel">
          <div v-if="!selectedSessionId" class="trace-empty">
            <ClipboardList :size="32" />
            <span>{{ t('trace.selectSession') }}</span>
          </div>
          <div v-else-if="traceEvents.length === 0" class="trace-empty">
            <FileX :size="24" />
            <span>{{ t('trace.noEvents') }}</span>
          </div>
          <template v-else>
            <div class="events-toolbar">
              <span class="events-count">{{ filteredEvents.length }} / {{ traceEvents.length }} {{ t('trace.events') }}</span>
              <div class="events-filters">
                <button
                  v-for="f in filterOptions"
                  :key="f.value"
                  class="filter-chip"
                  :class="{ active: activeFilters.has(f.value) }"
                  @click="toggleFilter(f.value)"
                >
                  <component :is="f.icon" :size="11" />
                  {{ f.label }}
                </button>
              </div>
            </div>
            <div class="events-timeline">
              <div
                v-for="event in filteredEvents"
                :key="event.id || event.timestamp"
                class="trace-event"
                :class="[`type-${event.type}`, `status-${event.status}`]"
              >
                <div class="event-indicator">
                  <div class="event-dot" :class="[`type-${event.type}`, `status-${event.status}`]"></div>
                  <div class="event-line"></div>
                </div>
                <div class="event-content">
                  <div class="event-header-row" @click="toggleEventExpand(event.id || event.timestamp || '')">
                    <span class="event-type-badge" :class="`type-${event.type}`">{{ formatEventType(event.type) }}</span>
                    <span v-if="event.title" class="event-title-text">{{ event.title }}</span>
                    <span v-if="event.status" class="event-status" :class="`status-${event.status}`">
                      <Check v-if="event.status === 'completed'" :size="10" />
                      <X v-else-if="event.status === 'failed'" :size="10" />
                      <Loader2 v-else-if="event.status === 'running'" :size="10" class="spin" />
                      {{ event.status }}
                    </span>
                    <span class="event-time">{{ formatTimestamp(event.timestamp) }}</span>
                    <ChevronDown
                      v-if="hasExpandableContent(event)"
                      :size="12"
                      class="expand-chevron"
                      :class="{ expanded: expandedEvents[event.id || event.timestamp || ''] }"
                    />
                  </div>
                  <div v-if="expandedEvents[event.id || event.timestamp || '']" class="event-details">
                    <div v-if="event.input" class="detail-block">
                      <span class="detail-label">{{ t('trace.input') }}</span>
                      <pre class="detail-code">{{ formatJson(event.input) }}</pre>
                    </div>
                    <div v-if="event.output" class="detail-block">
                      <span class="detail-label">{{ t('trace.output') }}</span>
                      <pre class="detail-code output">{{ typeof event.output === 'string' ? truncateStr(event.output, 4000) : formatJson(event.output) }}</pre>
                    </div>
                    <div v-if="event.artifacts?.length" class="detail-block">
                      <span class="detail-label">{{ t('trace.artifacts') }}</span>
                      <div class="artifact-list">
                        <div v-for="(a, i) in event.artifacts" :key="i" class="artifact-item">
                          <FileEdit :size="12" />
                          <span>{{ a.kind }}</span>
                          <span v-if="a.path" class="artifact-path">{{ a.path }}</span>
                        </div>
                      </div>
                    </div>
                    <div v-if="event.evidence?.length" class="detail-block">
                      <span class="detail-label">{{ t('trace.evidence') }}</span>
                      <div class="evidence-list">
                        <div v-for="(e, i) in event.evidence" :key="i" class="evidence-item" :class="`result-${e.result}`">
                          <component :is="e.kind === 'test' ? Beaker : e.kind === 'lint' ? Shield : e.kind === 'build' ? Hammer : CheckCircle" :size="12" />
                          <span class="evidence-kind">{{ e.kind }}</span>
                          <span class="evidence-result">{{ e.result || 'unknown' }}</span>
                        </div>
                      </div>
                    </div>
                    <div v-if="event.error" class="detail-block error-block">
                      <span class="detail-label">{{ t('trace.error') }}</span>
                      <pre class="detail-code error">{{ event.error.message }}</pre>
                      <pre v-if="event.error.stack" class="detail-code error stack">{{ event.error.stack }}</pre>
                    </div>
                    <div v-if="event.metadata && Object.keys(event.metadata).length" class="detail-block">
                      <span class="detail-label">{{ t('trace.metadata') }}</span>
                      <pre class="detail-code meta">{{ formatJson(event.metadata) }}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div v-if="activeView === 'logs'" class="logs-layout">
        <div class="logs-sidebar">
          <div v-if="loading && debugFiles.length === 0" class="trace-empty">
            <Loader2 :size="20" class="spin" />
            <span>{{ t('trace.loading') }}</span>
          </div>
          <div v-else-if="debugFiles.length === 0" class="trace-empty">
            <FileX :size="20" />
            <span>{{ t('trace.noLogs') }}</span>
          </div>
          <div v-else class="log-file-list">
            <div
              v-for="file in debugFiles"
              :key="file.path"
              class="log-file-item"
              :class="{ active: selectedLogPath === file.path }"
              @click="selectLogFile(file.path)"
            >
              <FileText :size="14" />
              <div class="log-file-info">
                <span class="log-file-name">{{ file.name }}</span>
                <span class="log-file-meta">{{ formatSize(file.size) }} · {{ formatTime(file.modifiedAt) }}</span>
              </div>
              <span class="log-file-kind" :class="file.kind">{{ file.kind }}</span>
            </div>
          </div>
        </div>
        <div class="log-content-panel">
          <div v-if="!logContent" class="trace-empty">
            <FileText :size="32" />
            <span>{{ t('trace.selectLog') }}</span>
          </div>
          <div v-else class="log-content">
            <pre class="log-text">{{ logContent }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import type { DebugFileEntry, TraceSessionEntry, AgentTraceEvent } from '@/services/electronAPI'
import {
  Activity, RefreshCw, Loader2, FileX, FileText, ChevronDown,
  Check, X, User, Bot, Wrench, FileEdit, Beaker, Shield,
  Hammer, CheckCircle, Terminal, AlertCircle, ClipboardList
} from 'lucide-vue-next'

const { t } = useI18n()
const appStore = useAppStore()

const loading = ref(false)
const activeView = ref<'sessions' | 'logs'>('sessions')
const traceSessions = ref<TraceSessionEntry[]>([])
const debugFiles = ref<DebugFileEntry[]>([])
const selectedSessionId = ref<string | null>(null)
const traceEvents = ref<AgentTraceEvent[]>([])
const selectedLogPath = ref<string | null>(null)
const logContent = ref<string | null>(null)
const expandedEvents = reactive<Record<string, boolean>>({})
const activeFilters = reactive<Set<string>>(new Set())

const filterOptions = [
  { value: 'user_message', label: t('trace.filterUser'), icon: User },
  { value: 'assistant_text', label: t('trace.filterAssistant'), icon: Bot },
  { value: 'tool_call', label: t('trace.filterTool'), icon: Wrench },
  { value: 'file_change', label: t('trace.filterFile'), icon: FileEdit },
  { value: 'command_run', label: t('trace.filterCommand'), icon: Terminal },
  { value: 'verification', label: t('trace.filterVerification'), icon: CheckCircle },
  { value: 'error', label: t('trace.filterError'), icon: AlertCircle },
  { value: 'final_summary', label: t('trace.filterSummary'), icon: ClipboardList },
]

const filteredEvents = computed(() => {
  if (activeFilters.size === 0) return traceEvents.value
  return traceEvents.value.filter(e => activeFilters.has(e.type))
})

function toggleFilter(value: string) {
  if (activeFilters.has(value)) {
    activeFilters.delete(value)
  } else {
    activeFilters.add(value)
  }
}

function closeViewer() {
  appStore.showTraceViewer = false
}

async function loadData() {
  loading.value = true
  try {
    const [sessions, files] = await Promise.all([
      api.debug.listTraceSessions(),
      api.debug.listFiles(),
    ])
    traceSessions.value = sessions
    debugFiles.value = files
  } catch (e) {
    console.error('[TraceViewer] Failed to load data:', e)
  } finally {
    loading.value = false
  }
}

async function selectSession(sessionId: string) {
  selectedSessionId.value = sessionId
  selectedLogPath.value = null
  logContent.value = null
  try {
    const result = await api.debug.readTraceEvents(sessionId, 2000)
    if (result.success && result.events) {
      traceEvents.value = result.events
    } else {
      traceEvents.value = []
    }
  } catch {
    traceEvents.value = []
  }
}

async function selectLogFile(filePath: string) {
  selectedLogPath.value = filePath
  selectedSessionId.value = null
  traceEvents.value = []
  try {
    const result = await api.debug.readFile(filePath, 512 * 1024)
    if (result.success && result.content) {
      logContent.value = result.content
    } else {
      logContent.value = result.error || 'Failed to read log file'
    }
  } catch {
    logContent.value = 'Failed to read log file'
  }
}

function toggleEventExpand(key: string) {
  expandedEvents[key] = !expandedEvents[key]
}

function hasExpandableContent(event: AgentTraceEvent): boolean {
  return !!(
    event.input ||
    event.output ||
    event.error ||
    event.artifacts?.length ||
    event.evidence?.length ||
    (event.metadata && Object.keys(event.metadata).length > 0)
  )
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  user_message: 'User',
  assistant_text: 'Assistant',
  assistant_reasoning: 'Thinking',
  assistant_turn: 'Turn',
  tool_call: 'Tool',
  tool_result: 'Result',
  file_change: 'File',
  command_run: 'Command',
  verification: 'Verify',
  error: 'Error',
  final_summary: 'Summary',
  session_created: 'Session',
  engine_session_start: 'Engine',
  plan: 'Plan',
}

function formatEventType(type: string): string {
  return EVENT_TYPE_LABELS[type] || type
}

function formatTimestamp(ts?: string): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ts
  }
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function truncateStr(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '\n... (' + (str.length - max) + ' more chars)'
}

onMounted(loadData)
</script>

<style lang="scss" scoped>
.trace-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
}

.trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--surface-border);
}

.trace-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
}

.trace-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.header-btn {
  background: none;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  padding: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.5;
  }
}

.close-btn {
  &:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: var(--error);
  }
}

.trace-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--surface-border);
}

.trace-tab {
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-secondary);
  }

  &.active {
    background: var(--surface-glass-active);
    color: var(--accent-primary);
  }
}

.trace-body {
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
  padding: 40px 16px;
  color: var(--text-muted);
  font-size: 13px;
}

.sessions-layout, .logs-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.sessions-sidebar, .logs-sidebar {
  width: 260px;
  min-width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--surface-border);
}

.session-list, .log-file-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--surface-border);
    border-radius: 3px;
    &:hover {
      background: var(--text-muted);
    }
  }
}

.session-item, .log-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }

  &.active {
    background: var(--surface-glass-active);
  }
}

.session-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.session-id {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  font-weight: 500;
}

.session-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.session-time {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.log-file-item {
  gap: 8px;

  .log-file-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .log-file-name {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .log-file-meta {
    font-size: 10px;
    color: var(--text-muted);
  }

  .log-file-kind {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: var(--radius-full);
    font-weight: 600;
    text-transform: uppercase;
    flex-shrink: 0;

    &.app { background: rgba(59, 130, 246, 0.1); color: var(--accent-primary); }
    &.session { background: rgba(34, 197, 94, 0.1); color: var(--success); }
    &.trace { background: rgba(139, 92, 246, 0.1); color: var(--accent-tertiary); }
  }
}

.events-panel, .log-content-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.events-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--surface-border);
  gap: 12px;
}

.events-count {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
  font-weight: 500;
}

.events-filters {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.filter-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    border-color: var(--accent-primary);
    color: var(--text-secondary);
  }

  &.active {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
}

.events-timeline {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 16px;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--surface-border);
    border-radius: 3px;
    &:hover {
      background: var(--text-muted);
    }
  }
}

.trace-event {
  display: flex;
  gap: 12px;
  min-height: 32px;
}

.event-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 16px;
  flex-shrink: 0;
  padding-top: 8px;
}

.event-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;

  &.type-user_message { background: #3b82f6; }
  &.type-assistant_text, &.type-assistant_turn { background: #8b5cf6; }
  &.type-tool_call, &.type-tool_result { background: #64748b; }
  &.type-file_change { background: #f59e0b; }
  &.type-command_run { background: #06b6d4; }
  &.type-verification { background: #22c55e; }
  &.type-error { background: #ef4444; }
  &.type-final_summary { background: #ec4899; }
  &.type-session_created, &.type-engine_session_start { background: #64748b; }

  &.status-failed { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.4); }
  &.status-running { background: #3b82f6; box-shadow: 0 0 6px rgba(59, 130, 246, 0.4); }
}

.event-line {
  width: 1px;
  flex: 1;
  min-height: 8px;
  background: var(--surface-border);
}

.event-content {
  flex: 1;
  min-width: 0;
  padding-bottom: 4px;
}

.event-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.event-type-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  flex-shrink: 0;

  &.type-user_message { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
  &.type-assistant_text, &.type-assistant_turn { background: rgba(139, 92, 246, 0.12); color: #8b5cf6; }
  &.type-tool_call, &.type-tool_result { background: rgba(100, 116, 139, 0.12); color: #64748b; }
  &.type-file_change { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
  &.type-command_run { background: rgba(6, 182, 212, 0.12); color: #06b6d4; }
  &.type-verification { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
  &.type-error { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
  &.type-final_summary { background: rgba(236, 72, 153, 0.12); color: #ec4899; }
  &.type-session_created, &.type-engine_session_start { background: rgba(100, 116, 139, 0.12); color: #64748b; }
}

.event-title-text {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.event-status {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 500;
  flex-shrink: 0;

  &.status-completed { color: var(--success); }
  &.status-failed { color: var(--error); }
  &.status-running { color: var(--accent-primary); }
  &.status-started { color: var(--accent-primary); }
}

.event-time {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  flex-shrink: 0;
}

.expand-chevron {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 0.15s ease;

  &.expanded {
    transform: rotate(180deg);
  }
}

.event-details {
  padding: 6px 8px 6px 12px;
}

.detail-block {
  margin-top: 8px;

  &:first-child {
    margin-top: 4px;
  }
}

.detail-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.detail-code {
  margin: 0;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--surface-border);
  max-height: 300px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--surface-border);
    border-radius: 2px;
  }

  &.output { color: var(--text-muted); max-height: 400px; }
  &.error { border-color: rgba(239, 68, 68, 0.3); color: var(--error); }
  &.stack { font-size: 11px; max-height: 150px; }
  &.meta { font-size: 11px; max-height: 200px; }
}

.artifact-list, .evidence-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.artifact-item, .evidence-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--bg-tertiary);
}

.artifact-path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.evidence-item {
  &.result-pass { color: var(--success); }
  &.result-fail { color: var(--error); }
  &.result-unknown { color: var(--text-muted); }
}

.evidence-kind {
  font-weight: 500;
}

.evidence-result {
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  font-weight: 600;
}

.error-block {
  .detail-code.error {
    background: rgba(239, 68, 68, 0.06);
  }
}

.log-content {
  flex: 1;
  overflow: auto;
  padding: 0;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--surface-border);
    border-radius: 3px;
    &:hover {
      background: var(--text-muted);
    }
  }
}

.log-text {
  margin: 0;
  padding: 12px 16px;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.6;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-all;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
