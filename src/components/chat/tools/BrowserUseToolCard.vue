<template>
  <div class="browser-use-tool-card" :class="[`status-${toolCall.status}`]">
    <!-- Header -->
    <div class="bu-header" @click="toggleExpand">
      <div class="bu-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <Check v-else-if="toolCall.status === 'completed'" :size="14" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <Globe v-else :size="14" />
      </div>
      <span class="bu-label">{{ displayLabel }}</span>
      <span v-if="targetUrl" class="bu-url">{{ targetUrl }}</span>
      <span v-if="stepCount" class="bu-steps">{{ stepCount }} steps</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <!-- Expanded body -->
    <div v-if="isExpanded" class="bu-body">
      <!-- Screenshot preview -->
      <div v-if="screenshotSrc" class="bu-screenshot-section">
        <div class="bu-section-label">{{ t('toolCards.browserScreenshot') }}</div>
        <div class="bu-screenshot-wrapper">
          <img :src="screenshotSrc" alt="Browser screenshot" class="bu-screenshot-img" />
        </div>
      </div>

      <!-- URL info -->
      <div v-if="pageUrl || pageTitle" class="bu-info-row">
        <span v-if="pageUrl" class="bu-info-item">
          <span class="bu-info-label">{{ t('toolCards.browserUrl') }}:</span>
          <span class="bu-info-value bu-url-text">{{ pageUrl }}</span>
        </span>
        <span v-if="pageTitle" class="bu-info-item">
          <span class="bu-info-label">{{ t('toolCards.browserTitle') }}:</span>
          <span class="bu-info-value">{{ pageTitle }}</span>
        </span>
      </div>

      <!-- Tool result text -->
      <div v-if="resultText" class="bu-result-section">
        <div class="bu-section-label">{{ t('toolCards.browserResult') }}</div>
        <pre class="bu-result-text"><code>{{ resultText }}</code></pre>
      </div>

      <!-- Error -->
      <div v-if="toolCall.status === 'error' && errorMsg" class="bu-error-section">
        <pre class="bu-error-text">{{ errorMsg }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Globe, ChevronDown, ExternalLink, Loader2, Check, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()

const TOOL_LABELS: Record<string, string> = {
  browser_use: 'Browser Use',
  browse: 'Browse Web',
  scrape: 'Scrape Page',
  screenshot: 'Screenshot',
  navigate: 'Navigate',
}

const displayLabel = computed(() => {
  const name = props.toolCall.name.toLowerCase()
  return TOOL_LABELS[name] || props.toolCall.name
})

const targetUrl = computed(() => {
  const input = props.toolCall.input || {}
  return (input.url as string) || (input.task as string) || null
})

const stepCount = computed(() => {
  const input = props.toolCall.input || {}
  return input.max_steps ?? input.maxSteps ?? null
})

const outputData = computed(() => {
  const output = props.toolCall.output
  if (!output) return null
  try {
    return JSON.parse(output)
  } catch {
    return null
  }
})

const pageUrl = computed(() => outputData.value?.url || props.toolCall.input?.url || null)
const pageTitle = computed(() => outputData.value?.title || null)
const resultText = computed(() => {
  if (!outputData.value) {
    const output = props.toolCall.output
    return output ? output.slice(0, 1000) : null
  }
  const result = outputData.value.result || outputData.value.text || null
  return result ? String(result).slice(0, 2000) : null
})

const errorMsg = computed(() => {
  if (props.toolCall.status !== 'error') return null
  return props.toolCall.output || 'Unknown error'
})

const screenshotSrc = computed(() => {
  // 如果 output 包含 base64 图片，显示之
  const output = props.toolCall.output
  if (!output || output.length < 100) return null
  // 检测是否包含 base64 图片数据（浏览器截图的特征）
  const b64Match = output.match(/data:image\/[^;]+;base64,([a-zA-Z0-9+/=]+)/)
  if (b64Match) return b64Match[0]
  // 也检查是否在 output 中的 data 字段里
  return null
})

function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
.browser-use-tool-card {
  border-radius: 6px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  overflow: hidden;
  font-size: 13px;
}

.bu-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  
  &:hover {
    background: rgba(255,255,255,0.03);
  }
}

.bu-icon-wrapper {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.status-running .bu-icon-wrapper {
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
}

.status-error .bu-icon-wrapper {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.bu-label {
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #22c55e;
  flex-shrink: 0;
}

.status-running .bu-label { color: #60a5fa; }
.status-error .bu-label { color: #f87171; }

.bu-url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.bu-steps {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.expand-icon {
  color: var(--text-tertiary);
  transition: transform 0.15s;
  flex-shrink: 0;
  
  &.is-expanded {
    transform: rotate(180deg);
  }
}

.bu-body {
  border-top: 1px solid var(--surface-border);
  padding: 10px 12px;
}

.bu-section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
  font-weight: 500;
}

.bu-screenshot-section {
  margin-bottom: 10px;
}

.bu-screenshot-wrapper {
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--surface-border);
  background: #111;
}

.bu-screenshot-img {
  width: 100%;
  display: block;
}

.bu-info-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
}

.bu-info-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.bu-info-label {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.bu-info-value {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bu-url-text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent-primary);
}

.bu-result-section {
  margin-bottom: 10px;
}

.bu-result-text {
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
  max-height: 300px;
  white-space: pre-wrap;
  background: #0d1117;
  color: #f0f6fc;
  word-break: break-word;
}

.bu-error-section {
  margin-top: 8px;
}

.bu-error-text {
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
  white-space: pre-wrap;
  word-break: break-word;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>