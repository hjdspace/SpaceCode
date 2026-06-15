<template>
  <div class="trace-detail-panel">
    <div class="detail-header">
      <TypeIcon :kind="span.kind" :status="span.status" />
      <h4 class="detail-title">{{ span.title }}</h4>
      <StatusPill :status="span.status" />
      <span v-if="span.durationMs" class="detail-duration">{{ formatDurationMs(span.durationMs) }}</span>
      <span class="detail-time">{{ formatClockTime(span.timestamp) }}</span>
    </div>

    <div class="detail-body">
      <!-- LLM Call -->
      <template v-if="span.kind === 'llm'">
        <DetailSection :title="t('trace.detail.response')">
          <div v-if="span.output" class="detail-content">
            <pre class="detail-code">{{ formatTraceJson(span.output) }}</pre>
          </div>
        </DetailSection>
        <DetailSection v-if="span.tokenUsage" :title="t('trace.detail.tokenUsage')">
          <div class="usage-grid">
            <div class="usage-item"><span class="usage-label">Input</span><span class="usage-value">{{ formatTokenCount(span.tokenUsage.inputTokens) }}</span></div>
            <div class="usage-item"><span class="usage-label">Output</span><span class="usage-value">{{ formatTokenCount(span.tokenUsage.outputTokens) }}</span></div>
            <div v-if="span.tokenUsage.cacheReadInputTokens" class="usage-item"><span class="usage-label">Cache Read</span><span class="usage-value">{{ formatTokenCount(span.tokenUsage.cacheReadInputTokens) }}</span></div>
          </div>
        </DetailSection>
      </template>

      <!-- Tool Call -->
      <template v-if="span.kind === 'tool' || span.kind === 'tool_result'">
        <DetailSection v-if="span.input" :title="t('trace.detail.input')">
          <pre class="detail-code">{{ formatTraceJson(span.input) }}</pre>
        </DetailSection>
        <DetailSection v-if="span.output" :title="t('trace.detail.output')">
          <pre class="detail-code">{{ formatTraceJson(span.output) }}</pre>
        </DetailSection>
      </template>

      <!-- Message -->
      <template v-if="span.kind === 'message'">
        <DetailSection :title="t('trace.detail.content')">
          <div v-if="span.message?.input" class="detail-content">
            <pre class="detail-code">{{ formatTraceJson(span.message.input) }}</pre>
          </div>
          <div v-if="span.message?.output" class="detail-content">
            <pre class="detail-code">{{ formatTraceJson(span.message.output) }}</pre>
          </div>
        </DetailSection>
      </template>

      <!-- Event -->
      <template v-if="span.kind === 'event'">
        <DetailSection v-if="span.subtitle" :title="t('trace.detail.details')">
          <pre class="detail-code">{{ span.subtitle }}</pre>
        </DetailSection>
      </template>

      <!-- Error -->
      <DetailSection v-if="span.message?.error" :title="t('trace.error')" class="error-section">
        <pre class="detail-code error">{{ span.message.error.message }}</pre>
        <pre v-if="span.message.error.stack" class="detail-code stack">{{ span.message.error.stack }}</pre>
      </DetailSection>

      <!-- Raw Data -->
      <DetailSection :title="t('trace.detail.raw')">
        <pre class="detail-code raw">{{ formatTraceJson(span.raw) }}</pre>
      </DetailSection>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TraceSpan, TraceViewModel } from '@/lib/traceViewModel'
import { formatTraceJson } from '@/lib/traceViewModel'
import { formatDurationMs, formatTokenCount, formatClockTime } from '@/lib/trace/formatters'
import TypeIcon from './TypeIcon.vue'
import StatusPill from './StatusPill.vue'
import DetailSection from './DetailSection.vue'

const props = defineProps<{
  span: TraceSpan
  viewModel: TraceViewModel
}>()

const { t } = useI18n()
</script>

<style lang="scss" scoped>
.trace-detail-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.detail-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-duration {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.detail-time {
  font-size: 11px;
  color: var(--text-muted);
}

.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: var(--surface-border); border-radius: 3px; }
}

.detail-content {
  margin-top: 4px;
}

.detail-code {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--surface-border);
  max-height: 400px;
  overflow-y: auto;

  &.error { border-color: rgba(239, 68, 68, 0.3); color: var(--error); background: rgba(239, 68, 68, 0.04); }
  &.stack { font-size: 11px; max-height: 150px; }
  &.raw { max-height: 300px; }
}

.usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.usage-item {
  display: flex;
  flex-direction: column;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  border: 1px solid var(--surface-border);
}

.usage-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

.usage-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
}

.error-section {
  :deep(.section-title) { color: var(--error); }
}
</style>
