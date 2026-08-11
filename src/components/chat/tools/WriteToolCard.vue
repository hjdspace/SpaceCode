<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <FilePlus v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.write') }}</span>
      <template v-if="filePath">
        <span class="tool-separator">·</span>
        <span class="tool-target">{{ filePath }}</span>
      </template>
      <span v-if="toolCall.status === 'running'" class="tool-meta status-running">{{ t('toolCards.writeStreaming') }}</span>
      <span v-else-if="outputSummary" class="tool-meta" :class="summaryClass">{{ outputSummary }}</span>
      <div class="tool-actions">
        <button
          class="action-btn"
          @click.stop="openInPanel"
          :title="t('infoPanel.openInPanel')"
        >
          <ExternalLink :size="14" />
        </button>
        <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
      </div>
    </div>

    <div v-if="isExpanded" class="tool-body">
      <div v-if="toolCall.input.content" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.writeContentPreview') }}</div>
        <div class="tool-section-body">
          <pre class="code-block"><code v-html="highlightedPreview"></code></pre>
          <div v-if="previewTruncated" class="truncated-notice">
            {{ t('toolCards.writeTruncated', { total: (toolCall.input.content || '').length }) }}
          </div>
        </div>
      </div>
      <div v-if="toolCall.output" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.writeResult') }}</div>
        <div class="tool-section-body">
          <pre class="code-block"><code>{{ toolCall.output }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FilePlus, ChevronDown, ExternalLink, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import hljs from 'highlight.js'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const appStore = useAppStore()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const filePath = computed(() => {
  const fp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (fp) return fp
  // 流式期间 input 尚未填充，不显示"未知文件"，留空让模板隐藏
  if (props.toolCall.status === 'running') return ''
  return t('toolCards.writeUnknownFile')
})
const outputSummary = computed(() => {
  const out = props.toolCall.output || ''
  if (out.includes('successfully')) return t('toolCards.writeSuccess')
  if (out.includes('Error') || out.includes('error')) return t('toolCards.writeFailed')
  return null
})
const summaryClass = computed(() => {
  const out = props.toolCall.output || ''
  if (out.includes('successfully')) return 'status-completed'
  if (out.includes('Error') || out.includes('error')) return 'status-error'
  return ''
})
const PREVIEW_MAX = 800
const rawPreview = computed(() => {
  const c = props.toolCall.input?.content || ''
  return c.length > PREVIEW_MAX ? c.slice(0, PREVIEW_MAX) : c
})

const highlightedPreview = computed(() => {
  const content = rawPreview.value
  if (!content) return ''

  const language = appStore.getLanguageFromPath(filePath.value)

  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value
    }
    return hljs.highlightAuto(content).value
  } catch (error) {
    console.error('Highlight error:', error)
    return escapeHtml(content)
  }
})

const previewTruncated = computed(() => {
  const c = props.toolCall.input?.content || ''
  return c.length > PREVIEW_MAX
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function toggleExpand() { isExpanded.value = !isExpanded.value }

async function openInPanel() {
  const rawFp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!rawFp) return
  const fp = appStore.resolveSessionPath(rawFp)

  // 可在内置浏览器预览的产物（html）直接用 webview 打开
  if (/\.html?$/i.test(fp)) {
    appStore.openFileInWebview(fp)
    return
  }

  const modifiedContent = await api.readFile(fp)
  if (modifiedContent === null) return

  let originalContent = ''
  try {
    const projectRoot = appStore.projectRoot
    if (projectRoot) {
      // strip the project root prefix and normalize to forward slashes — git
      // expects POSIX-style paths in `git show HEAD:<path>` even on Windows.
      const relativePath = fp
        .replace(projectRoot, '')
        .replace(/^[/\\]/, '')
        .replace(/\\/g, '/')
      if (relativePath) {
        const headContent = await api.git.showFile(projectRoot, relativePath)
        if (headContent !== null) {
          originalContent = headContent
        }
      }
    }
  } catch { /* not in git repo or file not tracked */ }

  const language = appStore.getLanguageFromPath(fp)
  appStore.showToolDiff({
    type: 'write',
    filePath: fp,
    originalContent,
    modifiedContent,
    toolCallId: props.toolCall.id,
    language,
  })
}
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.code-block {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--code-bg, #0d1117);
  color: var(--code-fg, #c9d1d9);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
  max-height: 300px;
  white-space: pre-wrap;
  word-break: break-word;

  /* highlight.js 主题 */
  :deep(.hljs) { color: #c9d1d9; background: transparent; }
  :deep(.hljs-comment), :deep(.hljs-quote) { color: #6a737d; font-style: italic; }
  :deep(.hljs-keyword), :deep(.hljs-selector-tag) { color: #ff7b72; }
  :deep(.hljs-string), :deep(.hljs-regexp) { color: #a5d6ff; }
  :deep(.hljs-title), :deep(.hljs-section), :deep(.hljs-name), :deep(.hljs-selector-id), :deep(.hljs-selector-class) { color: #d2a8ff; }
  :deep(.hljs-attribute), :deep(.hljs-attr), :deep(.hljs-variable), :deep(.hljs-template-variable), :deep(.hljs-class .hljs-title), :deep(.hljs-type) { color: #79c0ff; }
  :deep(.hljs-built_in) { color: #ffa657; }
  :deep(.hljs-literal) { color: #79c0ff; }
  :deep(.hljs-addition) { color: #aff5b4; }
  :deep(.hljs-deletion) { color: #ffd8d3; }
}

.truncated-notice {
  padding: 8px 0 0;
  font-size: 11px;
  color: var(--text-disabled);
  font-style: italic;
  text-align: center;
}

.tool-meta {
  &.status-completed { color: var(--success); }
  &.status-error { color: var(--error); }
  &.status-running { color: var(--accent-primary); }
}
</style>
