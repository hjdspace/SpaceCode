<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <FileText v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.read') }}</span>
      <span class="tool-separator">·</span>
      <span class="tool-target">{{ filePath }}</span>
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
      <div class="tool-section">
        <div class="tool-section-header">
          <span class="meta-item" v-if="offset"><ArrowUp :size="11" /> {{ t('toolCards.readLine', { offset }) }}</span>
          <span class="meta-item" v-if="limit"><ArrowDown :size="11" /> {{ t('toolCards.readLines', { count: limit }) }}</span>
          <span class="meta-item"><FileOutput :size="11" /> {{ t('toolCards.readLines', { count: outputLines }) }}</span>
        </div>
        <div class="tool-section-body">
          <MarkdownRenderer
            v-if="isMarkdownFile(filePath)"
            :content="props.toolCall.output || t('toolCards.readEmptyFile')"
            class="markdown-content"
          />
          <pre v-else class="code-content"><code v-html="highlightedOutput"></code></pre>
        </div>
      </div>
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
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const appStore = useAppStore()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const filePath = computed(() => props.toolCall.input?.file_path || props.toolCall.input?.path || t('toolCards.readUnknownFile'))
const offset = computed(() => props.toolCall.input?.offset)
const limit = computed(() => props.toolCall.input?.limit)
const outputLines = computed(() => (props.toolCall.output || '').split('\n').length)

function isMarkdownFile(path: string): boolean {
  const lower = path.toLowerCase()
  const basename = lower.split(/[\\/]/).pop() || ''
  return lower.endsWith('.md')
    || lower.endsWith('.markdown')
    || basename.startsWith('readme')
    || basename.startsWith('changelog')
}

const highlightedOutput = computed(() => {
  const content = props.toolCall.output || ''
  if (!content) return t('toolCards.readEmptyFile')

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
  const rawFp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!rawFp) return
  const fp = appStore.resolveSessionPath(rawFp)

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
@use './tool-card.scss' as *;

.tool-section-header {
  gap: 12px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text-muted);
}

.markdown-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);

  :deep(.md-heading) {
    margin-top: 12px;
    margin-bottom: 8px;
    color: var(--text-primary);
  }

  :deep(.md-paragraph) {
    margin-bottom: 8px;
  }

  :deep(.md-list) {
    margin-bottom: 8px;
    padding-left: 20px;
  }

  :deep(.md-blockquote) {
    border-left: 3px solid var(--surface-border);
    padding-left: 12px;
    margin: 8px 0;
    color: var(--text-muted);
  }

  :deep(pre.code-block) {
    margin: 8px 0;
  }
}

.code-content {
  margin: 0;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
  tab-size: 2;
  max-height: 500px;
  overflow-y: auto;
  background: transparent;
  color: var(--text-secondary);

  code {
    display: block;
    padding: 10px 12px;
    background: var(--code-bg, #0d1117);
    border-radius: 6px;
    color: var(--code-fg, #f0f6fc);
  }

  /* highlight.js 主题（适配更亮的文字色） */
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
</style>
