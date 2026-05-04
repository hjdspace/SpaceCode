<template>
  <div class="write-tool-card" :class="[statusClass]">
    <div class="write-header" @click="toggleExpand">
      <div class="write-icon-wrapper"><FilePlus :size="14" /></div>
      <span class="write-label">Write</span>
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
    <div v-show="isExpanded" class="write-body">
      <div v-if="toolCall.input.content" class="content-preview">
        <div class="block-label">Content Preview</div>
        <pre class="code-block"><code>{{ contentPreview }}</code></pre>
      </div>
      <div v-if="toolCall.output" class="result-block">
        <div class="block-label">Result</div>
        <pre class="code-block"><code>{{ toolCall.output }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FilePlus, ChevronDown, ExternalLink } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const appStore = useAppStore()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const filePath = computed(() => props.toolCall.input?.file_path || props.toolCall.input?.path || 'unknown')
const outputSummary = computed(() => {
  const out = props.toolCall.output || ''
  if (out.includes('successfully')) return '✓ Written'
  if (out.includes('Error') || out.includes('error')) return '✗ Failed'
  return null
})
const PREVIEW_MAX = 800
const contentPreview = computed(() => {
  const c = props.toolCall.input?.content || ''
  return c.length > PREVIEW_MAX ? c.slice(0, PREVIEW_MAX) + '\n... (truncated)' : c
})
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
      const relativePath = fp.replace(projectRoot, '').replace(/^[/\\]/, '')
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
.write-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(249, 115, 22, 0.12); color: #fb923c; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.write-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #fb923c; flex-shrink: 0; }
.write-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary); }
.write-summary { font-size: 11px; flex-shrink: 0; }
.panel-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; flex-shrink: 0; transition: all 0.15s; &:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); } }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.write-body { border-top: 1px solid var(--surface-border); }
.content-preview, .result-block { padding: 10px 12px; }
.block-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-tertiary); margin-bottom: 6px; font-weight: 500; }
.code-block { margin: 0; padding: 10px 12px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; background: #0d1117; color: #f0f6fc; max-height: 400px; overflow-y: auto; }
</style>
