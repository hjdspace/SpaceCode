<template>
  <div class="edit-tool-card" :class="[statusClass]">
    <div class="edit-header" @click="toggleExpand">
      <div class="edit-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <FileEdit v-else :size="14" />
      </div>
      <span class="edit-label">Edit</span>
      <span class="edit-path">{{ filePath }}</span>
      <button
        class="panel-btn"
        @click.stop="openInPanel"
        :title="t('infoPanel.openInPanel')"
      >
        <ExternalLink :size="13" />
      </button>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-show="isExpanded" class="edit-body">
      <div v-if="toolCall.input.old_string" class="diff-section">
        <div class="block-label diff-old">- Removed</div>
        <pre class="code-block old-text"><code>{{ toolCall.input.old_string }}</code></pre>
      </div>
      <div v-if="toolCall.input.new_string" class="diff-section">
        <div class="block-label diff-new">+ Added</div>
        <pre class="code-block new-text"><code>{{ toolCall.input.new_string }}</code></pre>
      </div>
      <div v-if="toolCall.output" class="result-section">
        <div class="block-label">Result</div>
        <pre class="code-block result-text"><code>{{ toolCall.output }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FileEdit, ChevronDown, ExternalLink, Loader2, X } from 'lucide-vue-next'
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
function toggleExpand() { isExpanded.value = !isExpanded.value }

async function openInPanel() {
  const fp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!fp) return

  const modifiedContent = await api.readFile(fp)
  if (modifiedContent === null) return

  let originalContent = modifiedContent
  const oldStr = props.toolCall.input?.old_string || ''
  const newStr = props.toolCall.input?.new_string || ''
  if (newStr && modifiedContent.includes(newStr)) {
    originalContent = modifiedContent.replace(newStr, oldStr)
  }

  const language = appStore.getLanguageFromPath(fp)
  appStore.showToolDiff({
    type: 'edit',
    filePath: fp,
    originalContent,
    modifiedContent,
    toolCallId: props.toolCall.id,
    language,
  })
}
</script>

<style lang="scss" scoped>
.edit-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.edit-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.edit-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(249, 115, 22, 0.12); color: #fb923c; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.status-running .edit-icon-wrapper { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
.status-error .edit-icon-wrapper { background: rgba(239, 68, 68, 0.12); color: #f87171; }
.edit-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #fb923c; flex-shrink: 0; }
.edit-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary); }
.panel-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; flex-shrink: 0; transition: all 0.15s; &:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); } }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.edit-body { border-top: 1px solid var(--surface-border); }
.diff-section, .result-section { padding: 10px 12px; }
.block-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; font-weight: 500; }
.diff-old { color: #f87171; }
.diff-new { color: #4ade80; }
.code-block { margin: 0; padding: 10px 12px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
.old-text { background: rgba(248,113,113,0.12); color: #fca5a5; }
.new-text { background: rgba(74,222,128,0.12); color: #86efac; }
.result-text { background: #0d1117; color: #c9d1d9; }
.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
