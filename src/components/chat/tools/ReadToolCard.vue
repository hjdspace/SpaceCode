<template>
  <div class="read-tool-card" :class="[statusClass]">
    <div class="read-header" @click="toggleExpand">
      <div class="read-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <FileText v-else :size="14" />
      </div>
      <span class="read-label">Read</span>
      <span class="read-file-path">{{ filePath }}</span>
      <button
        class="panel-btn"
        @click.stop="openInPanel"
        :title="t('infoPanel.openInPanel')"
      >
        <ExternalLink :size="13" />
      </button>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <div v-show="isExpanded" class="read-body">
      <div class="read-meta-row">
        <span class="meta-item" v-if="offset"><ArrowUp :size="11" /> Line {{ offset }}</span>
        <span class="meta-item" v-if="limit"><ArrowDown :size="11" /> {{ limit }} lines</span>
        <span class="meta-item"><FileOutput :size="11" /> {{ outputLines }} lines</span>
      </div>
      <pre class="code-content"><code v-html="highlightedOutput"></code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FileText, ChevronDown, ArrowUp, ArrowDown, FileOutput, ExternalLink, Loader2, X } from 'lucide-vue-next'
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
const filePath = computed(() => props.toolCall.input?.file_path || props.toolCall.input?.path || 'unknown')
const offset = computed(() => props.toolCall.input?.offset)
const limit = computed(() => props.toolCall.input?.limit)
const outputLines = computed(() => (props.toolCall.output || '').split('\n').length)

const highlightedOutput = computed(() => {
  const content = props.toolCall.output || ''
  if (!content) return '(empty file)'

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toggleExpand() { isExpanded.value = !isExpanded.value }

async function openInPanel() {
  const fp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!fp) return

  const content = await api.readFile(fp)
  if (content === null) return

  const language = appStore.getLanguageFromPath(fp)
  appStore.showToolDiff({
    type: 'read',
    filePath: fp,
    originalContent: content,
    modifiedContent: content,
    toolCallId: props.toolCall.id,
    language,
  })
}
</script>

<style lang="scss" scoped>
.read-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.read-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.read-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(59, 130, 246, 0.12); color: #60a5fa; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.status-running .read-icon-wrapper { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
.status-error .read-icon-wrapper { background: rgba(239, 68, 68, 0.12); color: #f87171; }
.read-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #60a5fa; flex-shrink: 0; }
.read-file-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary); }
.panel-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; flex-shrink: 0; transition: all 0.15s; &:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); } }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.read-body { border-top: 1px solid var(--surface-border); }
.read-meta-row { display: flex; gap: 12px; padding: 6px 12px; border-bottom: 1px solid var(--surface-border); }
.meta-item { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-tertiary); }
.code-content {
  margin: 0;
  padding: 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
  tab-size: 2;
  max-height: 500px;
  overflow-y: auto;
  background: #0d1117;
  color: #f0f6fc;
  border-radius: 4px;

  /* highlight.js 主题（适配更亮的文字色） */
  code {
    :deep(.hljs) { color: #f0f6fc; background: transparent; }
    :deep(.hljs-comment), :deep(.hljs-quote) { color: #6a737d; font-style: italic; }
    :deep(.hljs-keyword), :deep(.hljs-selector-tag) { color: #ff7b72; }
    :deep(.hljs-string), :deep(.hljs-regexp) { color: #a5d6ff; }
    :deep(.hljs-title), :deep(.hljs-section), :deep(.hljs-name), :deep(.hljs-selector-id), :deep(.hljs-selector-class) { color: #d2a8ff; }
    :deep(.hljs-attribute), :deep(.hljs-attr), :deep(.hljs-variable), :deep(.hljs-template-variable), :deep(.hljs-class .hljs-title), :deep(.hljs-type) { color: #79c0ff; }
    :deep(.hljs-built_in) { color: #ffa657; }
    :deep(.hljs-literal) { color: #79c0ff; }
    :deep(.hljs-number) { color: #79c0ff; }
    :deep(.hljs-function .hljs-title) { color: #d2a8ff; }
    :deep(.hljs-params) { color: #ffa657; }
  }
}
.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
