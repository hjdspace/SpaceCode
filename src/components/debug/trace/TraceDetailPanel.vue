<template>
  <div class="trace-detail-panel">
    <!-- Header -->
    <div class="detail-header">
      <TypeIcon :kind="span.kind" :status="span.status" />
      <div class="detail-header-info">
        <h4 class="detail-title">{{ displayTitle }}</h4>
        <div class="detail-meta-row">
          <span class="detail-kind-badge">{{ span.kind }}</span>
          <span v-if="span.toolName" class="detail-tool-badge">{{ span.toolName }}</span>
          <span v-if="span.timestamp" class="detail-time">{{ formatClockTime(span.timestamp) }}</span>
          <span v-if="span.durationMs !== undefined" class="detail-duration">{{ formatDurationMs(span.durationMs) }}</span>
        </div>
      </div>
      <StatusPill :status="span.status" />
    </div>

    <!-- Body -->
    <div class="detail-body">
      <!-- ===== Session / Turn Overview ===== -->
      <template v-if="span.kind === 'session' || span.kind === 'turn'">
        <DetailSection :title="t('trace.detail.overview')">
          <div class="overview-grid">
            <div class="overview-card">
              <span class="overview-value">{{ viewModel.diagnosis.modelCalls }}</span>
              <span class="overview-label">{{ t('trace.modelCalls') }}</span>
            </div>
            <div class="overview-card">
              <span class="overview-value">{{ viewModel.diagnosis.toolCalls }}</span>
              <span class="overview-label">{{ t('trace.toolCalls') }}</span>
            </div>
            <div class="overview-card" :class="{ 'has-error': viewModel.diagnosis.errorCount > 0 }">
              <span class="overview-value">{{ viewModel.diagnosis.errorCount }}</span>
              <span class="overview-label">{{ t('trace.errors') }}</span>
            </div>
            <div class="overview-card">
              <span class="overview-value">{{ viewModel.turns.length }}</span>
              <span class="overview-label">Turns</span>
            </div>
          </div>
        </DetailSection>

        <!-- Child Spans list -->
        <DetailSection v-if="childSpans.length > 0" :title="'Child Spans'" :count="childSpans.length">
          <div class="child-span-list">
            <button
              v-for="child in childSpans.slice(0, 20)"
              :key="child.id"
              class="child-span-row"
              :class="{ selected: child.id === span.id }"
              @click="$emit('selectSpan', child.id)"
            >
              <TypeIcon :kind="child.kind" :status="child.status" />
              <span class="child-span-title">{{ child.title }}</span>
              <StatusPill :status="child.status" />
              <span v-if="child.durationMs" class="child-span-duration">{{ formatDurationMs(child.durationMs) }}</span>
            </button>
            <div v-if="childSpans.length > 20" class="child-span-more">
              +{{ childSpans.length - 20 }} more spans
            </div>
          </div>
        </DetailSection>
      </template>

      <!-- ===== LLM Call Detail ===== -->
      <template v-if="span.kind === 'llm'">
        <!-- Token Usage -->
        <DetailSection v-if="span.tokenUsage" :title="t('trace.detail.tokenUsage')">
          <div class="usage-grid">
            <div class="usage-card">
              <div class="usage-icon input">
                <ArrowDown :size="12" />
              </div>
              <div class="usage-info">
                <span class="usage-value">{{ formatTokenCount(span.tokenUsage.inputTokens) }}</span>
                <span class="usage-label">Input</span>
              </div>
            </div>
            <div class="usage-card">
              <div class="usage-icon output">
                <ArrowUp :size="12" />
              </div>
              <div class="usage-info">
                <span class="usage-value">{{ formatTokenCount(span.tokenUsage.outputTokens) }}</span>
                <span class="usage-label">Output</span>
              </div>
            </div>
            <div v-if="span.tokenUsage.cacheReadInputTokens" class="usage-card">
              <div class="usage-icon cache">
                <Database :size="12" />
              </div>
              <div class="usage-info">
                <span class="usage-value">{{ formatTokenCount(span.tokenUsage.cacheReadInputTokens) }}</span>
                <span class="usage-label">Cache Read</span>
              </div>
            </div>
            <div v-if="span.tokenUsage.cacheCreationInputTokens" class="usage-card">
              <div class="usage-icon cache-write">
                <Database :size="12" />
              </div>
              <div class="usage-info">
                <span class="usage-value">{{ formatTokenCount(span.tokenUsage.cacheCreationInputTokens) }}</span>
                <span class="usage-label">Cache Write</span>
              </div>
            </div>
          </div>
        </DetailSection>

        <!-- Model & Provider -->
        <DetailSection v-if="span.call" :title="'Model & Provider'">
          <div class="meta-grid">
            <div v-if="getModel(span)" class="meta-row">
              <span class="meta-key">Model</span>
              <span class="meta-value">{{ getModel(span) }}</span>
            </div>
            <div v-if="getSource(span)" class="meta-row">
              <span class="meta-key">Source</span>
              <span class="meta-value">{{ getSource(span) }}</span>
            </div>
          </div>
        </DetailSection>

        <!-- Response / Output -->
        <DetailSection v-if="span.output" :title="t('trace.detail.response')">
          <pre class="detail-code">{{ formatTraceJson(span.output) }}</pre>
        </DetailSection>

        <!-- Input -->
        <DetailSection v-if="span.input" :title="t('trace.detail.input')">
          <pre class="detail-code">{{ formatTraceJson(span.input) }}</pre>
        </DetailSection>
      </template>

      <!-- ===== Tool Detail ===== -->
      <template v-if="span.kind === 'tool' || span.kind === 'tool_result'">
        <!-- Tool Name & ID -->
        <DetailSection v-if="span.toolName || span.toolUseId" :title="'Tool Info'">
          <div class="meta-grid">
            <div v-if="span.toolName" class="meta-row">
              <span class="meta-key">Name</span>
              <span class="meta-value tool-name">{{ span.toolName }}</span>
            </div>
            <div v-if="span.toolUseId" class="meta-row">
              <span class="meta-key">Tool Use ID</span>
              <span class="meta-value mono">{{ span.toolUseId }}</span>
            </div>
          </div>
        </DetailSection>

        <!-- Input -->
        <DetailSection v-if="span.input" :title="t('trace.detail.input')">
          <pre class="detail-code">{{ formatTraceJson(span.input) }}</pre>
        </DetailSection>

        <!-- Output -->
        <DetailSection v-if="span.output" :title="t('trace.detail.output')">
          <pre class="detail-code">{{ formatTraceJson(span.output) }}</pre>
        </DetailSection>
      </template>

      <!-- ===== Message Detail ===== -->
      <template v-if="span.kind === 'message'">
        <DetailSection v-if="span.message" :title="t('trace.detail.content')">
          <template v-if="messageBlocks.length > 0">
            <MessageBlocks :blocks="messageBlocks" />
          </template>
          <template v-else>
            <div v-if="span.message?.input" class="detail-content-block">
              <pre class="detail-code">{{ formatTraceJson(span.message.input) }}</pre>
            </div>
            <div v-if="span.message?.output" class="detail-content-block">
              <pre class="detail-code">{{ formatTraceJson(span.message.output) }}</pre>
            </div>
          </template>
        </DetailSection>

        <!-- Message Metadata -->
        <DetailSection v-if="span.message?.actor || span.message?.type" :title="'Metadata'">
          <div class="meta-grid">
            <div v-if="span.message?.actor" class="meta-row">
              <span class="meta-key">Actor</span>
              <span class="meta-value">{{ span.message.actor }}</span>
            </div>
            <div v-if="span.message?.type" class="meta-row">
              <span class="meta-key">Type</span>
              <span class="meta-value">{{ span.message.type }}</span>
            </div>
            <div v-if="span.message?.status" class="meta-row">
              <span class="meta-key">Status</span>
              <span class="meta-value">{{ span.message.status }}</span>
            </div>
          </div>
        </DetailSection>
      </template>

      <!-- ===== Event Detail ===== -->
      <template v-if="span.kind === 'event'">
        <DetailSection v-if="span.subtitle || span.event" :title="t('trace.detail.details')">
          <div v-if="span.event" class="meta-grid">
            <div v-if="span.event.phase" class="meta-row">
              <span class="meta-key">Phase</span>
              <span class="meta-value">{{ span.event.phase }}</span>
            </div>
            <div v-if="span.event.severity" class="meta-row">
              <span class="meta-key">Severity</span>
              <span class="meta-value" :class="span.event.severity">{{ span.event.severity }}</span>
            </div>
            <div v-if="span.event.model" class="meta-row">
              <span class="meta-key">Model</span>
              <span class="meta-value">{{ span.event.model }}</span>
            </div>
          </div>
          <pre v-if="span.subtitle" class="detail-code">{{ span.subtitle }}</pre>
        </DetailSection>
      </template>

      <!-- ===== Error Section ===== -->
      <DetailSection v-if="span.message?.error" :title="t('trace.error')" class="error-section">
        <div class="error-box">
          <div class="error-header">
            <AlertTriangle :size="14" />
            <span>{{ span.message.error.message || 'Unknown Error' }}</span>
          </div>
          <pre v-if="span.message.error.stack" class="detail-code error-stack">{{ span.message.error.stack }}</pre>
        </div>
      </DetailSection>

      <!-- ===== Raw Data ===== -->
      <DetailSection :title="t('trace.detail.raw')" :count="'JSON'">
        <pre class="detail-code raw">{{ formatTraceJson(span.raw) }}</pre>
      </DetailSection>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TraceSpan, TraceViewModel } from '@/lib/traceViewModel'
import { formatTraceJson } from '@/lib/traceViewModel'
import { formatDurationMs, formatTokenCount, formatClockTime } from '@/lib/trace/formatters'
import type { NormalizedBlock } from '@/lib/trace/types'
import { ArrowDown, ArrowUp, Database, AlertTriangle } from 'lucide-vue-next'
import TypeIcon from './TypeIcon.vue'
import StatusPill from './StatusPill.vue'
import DetailSection from './DetailSection.vue'
import MessageBlocks from './MessageBlocks.vue'

const props = defineProps<{
  span: TraceSpan
  viewModel: TraceViewModel
}>()

defineEmits<{
  selectSpan: [spanId: string]
}>()

const { t } = useI18n()

const displayTitle = computed(() => {
  return props.span.title || `${props.span.kind} · ${props.span.id}`
})

const childSpans = computed(() => {
  const span = props.span
  if (!span.childIds || span.childIds.length === 0) return []
  return span.childIds
    .map((id) => props.viewModel.spansById.get(id))
    .filter((s): s is TraceSpan => !!s)
})

const messageBlocks = computed((): NormalizedBlock[] => {
  const msg = props.span.message
  if (!msg) return []
  const blocks: NormalizedBlock[] = []
  // Try to extract blocks from input/output
  const tryExtract = (value: unknown) => {
    if (typeof value === 'string') {
      blocks.push({ type: 'text', text: value })
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>
          if (rec.type === 'text' && typeof rec.text === 'string') blocks.push({ type: 'text', text: rec.text })
          else if (rec.type === 'thinking' && typeof rec.thinking === 'string') blocks.push({ type: 'thinking', thinking: rec.thinking })
          else if (rec.type === 'tool_use') blocks.push({ type: 'tool_use', name: String(rec.name || ''), input: rec.input, ...(rec.id ? { id: String(rec.id) } : {}) })
          else if (rec.type === 'tool_result') blocks.push({ type: 'tool_result', content: rec.content, ...(rec.tool_use_id ? { toolUseId: String(rec.tool_use_id) } : {}), ...(rec.is_error ? { isError: true } : {}) })
        }
      }
    }
  }
  if (msg.input) tryExtract(msg.input)
  if (msg.output) tryExtract(msg.output)
  return blocks
})

function getModel(span: TraceSpan): string | null {
  if (!span.call) return null
  const call = span.call as Record<string, unknown>
  return typeof call.model === 'string' ? call.model : null
}

function getSource(span: TraceSpan): string | null {
  if (!span.call) return null
  const call = span.call as Record<string, unknown>
  return typeof call.source === 'string' ? call.source : null
}
</script>

<style lang="scss" scoped>
.trace-detail-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.detail-header-info {
  flex: 1;
  min-width: 0;
}

.detail-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px 0;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.detail-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.detail-kind-badge {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.detail-tool-badge {
  font-size: 10px;
  font-family: var(--font-mono);
  color: #34d399;
  background: rgba(16, 185, 129, 0.08);
  padding: 1px 6px;
  border-radius: 3px;
}

.detail-time {
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.detail-duration {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  background: rgba(255, 255, 255, 0.04);
  padding: 1px 5px;
  border-radius: 3px;
}

.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 24px;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.08); border-radius: 3px; }
}

// Overview Grid
.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.overview-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: border-color 0.15s ease;

  &:hover { border-color: rgba(255, 255, 255, 0.1); }
  &.has-error { border-color: rgba(239, 68, 68, 0.2); }
}

.overview-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
  line-height: 1;
}

.overview-label {
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-top: 4px;
}

// Usage Grid
.usage-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.usage-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.usage-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  flex-shrink: 0;

  &.input { background: rgba(99, 102, 241, 0.12); color: #818cf8; }
  &.output { background: rgba(16, 185, 129, 0.12); color: #34d399; }
  &.cache { background: rgba(245, 158, 11, 0.12); color: #fbbf24; }
  &.cache-write { background: rgba(139, 92, 246, 0.12); color: #a78bfa; }
}

.usage-info {
  display: flex;
  flex-direction: column;
}

.usage-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
  line-height: 1.1;
}

.usage-label {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  margin-top: 2px;
}

// Meta Grid
.meta-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.meta-key {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  min-width: 70px;
  flex-shrink: 0;
}

.meta-value {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;

  &.mono { font-family: var(--font-mono); font-size: 11px; }
  &.tool-name { color: #34d399; font-family: var(--font-mono); }
  &.error { color: #f87171; }
  &.warning { color: #fbbf24; }
  &.info { color: #60a5fa; }
}

// Code blocks
.detail-code {
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(0, 0, 0, 0.2);
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.06);
  max-height: 400px;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }

  &.error-stack {
    font-size: 11px;
    max-height: 180px;
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.15);
    background: rgba(239, 68, 68, 0.04);
  }

  &.raw {
    max-height: 350px;
    font-size: 11px;
  }
}

// Error
.error-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 8px;
  color: #f87171;
  font-size: 12px;
  font-weight: 500;
}

.error-section {
  :deep(.section-title) { color: #f87171; }
}

// Child Span List
.child-span-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.child-span-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  border-radius: 6px;
  transition: background 0.12s ease;

  &:hover { background: rgba(255, 255, 255, 0.04); }
}

.child-span-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.child-span-duration {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.child-span-more {
  font-size: 11px;
  color: var(--text-muted);
  padding: 6px 8px;
  text-align: center;
}
</style>
