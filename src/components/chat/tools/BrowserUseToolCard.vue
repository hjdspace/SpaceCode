<template>
  <div class="tool-card" :class="`status-${toolCall.status}`">
    <!-- Header -->
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <Check v-else-if="toolCall.status === 'completed'" :size="14" class="tool-icon status-completed" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <Globe v-else :size="14" class="tool-icon" />
      <span class="tool-label">{{ displayLabel }}</span>
      <span class="tool-separator">·</span>
      <span v-if="targetUrl" class="tool-target">{{ targetUrl }}</span>
      <span v-if="stepCount" class="tool-meta">{{ stepCount }} steps</span>
      <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <!-- Expanded body -->
    <div v-if="isExpanded" class="tool-body">
      <!-- Screenshot preview -->
      <div v-if="screenshotSrc" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.browserScreenshot') }}</div>
        <div class="tool-section-body">
          <div class="screenshot-wrapper">
            <img :src="screenshotSrc" :alt="t('toolCards.browserScreenshot')" class="screenshot-img" />
          </div>
        </div>
      </div>

      <!-- URL / Title info -->
      <div v-if="pageUrl || pageTitle" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.browserUrl') }} / {{ t('toolCards.browserTitle') }}</div>
        <div class="tool-section-body">
          <div class="info-row">
            <span v-if="pageUrl" class="info-item">
              <span class="info-label">{{ t('toolCards.browserUrl') }}:</span>
              <span class="info-value url-text">{{ pageUrl }}</span>
            </span>
            <span v-if="pageTitle" class="info-item">
              <span class="info-label">{{ t('toolCards.browserTitle') }}:</span>
              <span class="info-value">{{ pageTitle }}</span>
            </span>
          </div>
        </div>
      </div>

      <!-- Tool result text -->
      <div v-if="resultText" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.browserResult') }}</div>
        <div class="tool-section-body">
          <pre class="code-block"><code>{{ resultText }}</code></pre>
        </div>
      </div>

      <!-- Error -->
      <div v-if="toolCall.status === 'error' && errorMsg" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.browserResult') }}</div>
        <div class="tool-section-body">
          <pre class="error-text">{{ errorMsg }}</pre>
        </div>
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
  return TOOL_LABELS[name] || t('toolCards.browserUse')
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
@use './tool-card.scss' as *;

.screenshot-wrapper {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--surface-border);
  background: var(--code-bg, #111);
}

.screenshot-img {
  width: 100%;
  display: block;
}

.info-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.info-label {
  color: var(--text-muted);
  flex-shrink: 0;
}

.info-value {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url-text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent-primary);
}

.code-block {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--code-bg, #0d1117);
  color: var(--code-fg, #f0f6fc);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
  max-height: 300px;
  white-space: pre-wrap;
  word-break: break-word;
}

.error-text {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12px;
  background: rgba(239, 68, 68, 0.1);
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.2);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
