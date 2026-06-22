<template>
  <div class="write-tool-card" :class="[statusClass]">
    <div class="write-header" @click="toggleExpand">
      <div class="write-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <FilePlus v-else :size="14" />
      </div>
      <span class="write-label">{{ t('toolCards.write') }}</span>
      <span class="write-path">{{ filePath }}</span>
      <span v-if="outputSummary" class="write-summary">{{ outputSummary }}</span>
      <button
        class="panel-btn"
        @click.stop="openInPanel"
        :title="t('infoPanel.openInPanel')"
      >
        <ExternalLink :size="13" />
      </button>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-if="isExpanded" class="write-body">
      <div v-if="toolCall.input.content" class="content-preview">
        <div class="block-label">{{ t('toolCards.writeContentPreview') }}</div>
        <pre class="code-block"><code v-html="highlightedPreview"></code></pre>
        <div v-if="previewTruncated" class="truncated-notice">
          {{ t('toolCards.writeTruncated', { total: (toolCall.input.content || '').length }) }}
        </div>
      </div>
      <div v-if="toolCall.output" class="result-block">
        <div class="block-label">{{ t('toolCards.writeResult') }}</div>
        <pre class="code-block"><code>{{ toolCall.output }}</code></pre>
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
const filePath = computed(() => props.toolCall.input?.file_path || props.toolCall.input?.path || t('toolCards.writeUnknownFile'))
const outputSummary = computed(() => {
  const out = props.toolCall.output || ''
  if (out.includes('successfully')) return t('toolCards.writeSuccess')
  if (out.includes('Error') || out.includes('error')) return t('toolCards.writeFailed')
  return null
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
  const fp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!fp) return

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
.write-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.write-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.write-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(34, 197, 94, 0.12); color: #4ade80; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.status-running .write-icon-wrapper { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
.status-error .write-icon-wrapper { background: rgba(239, 68, 68, 0.12); color: #f87171; }
.write-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #4ade80; flex-shrink: 0; }
.write-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); }
.write-summary { font-size: 11px; flex-shrink: 0; }
.panel-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; flex-shrink: 0; transition: all 0.15s; &:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); } }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.write-body { border-top: 1px solid var(--surface-border); }
.content-preview, .result-block { padding: 10px 12px; border-top: 1px solid var(--surface-border); }
.block-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-tertiary); margin-bottom: 6px; font-weight: 500; }
.code-block {
  margin: 0;
  padding: 10px 12px;
  border-radius: 4px;
  background: #0d1117;
  color: #c9d1d9;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
  max-height: 300px;
  white-space: pre-wrap;

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
  padding: 6px 12px;
  font-size: 11px;
  color: #6e7681;
  font-style: italic;
  text-align: center;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
