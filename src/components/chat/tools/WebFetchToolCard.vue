<template>
  <div class="fetch-tool-card" :class="[statusClass]">
    <div class="fetch-header" @click="toggleExpand">
      <div class="fetch-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <Globe v-else :size="14" />
      </div>
      <span class="fetch-label">{{ t('toolCards.webFetch') }}</span>
      <span class="fetch-url">{{ urlDisplay }}</span>
      <button
        class="panel-btn"
        @click.stop="openInPanel"
        :title="t('infoPanel.openInPanel')"
      >
        <ExternalLink :size="13" />
      </button>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-if="isExpanded" class="fetch-body">
      <div v-if="prompt" class="fetch-prompt">
        <div class="block-label">{{ t('toolCards.webFetchPrompt') }}</div>
        <p class="prompt-text">{{ prompt }}</p>
      </div>
      <div v-if="toolCall.output" class="fetch-content">
        <div class="block-label">{{ t('toolCards.webFetchContent') }}</div>
        <pre class="content-preview"><code>{{ truncatedContent }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Globe, ChevronDown, ExternalLink, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const appStore = useAppStore()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const urlDisplay = computed(() => {
  const url = props.toolCall.input?.url || ''
  try {
    const u = new URL(url)
    return u.hostname + u.pathname.slice(0, 40) + (u.pathname.length > 40 ? '...' : '')
  } catch { return url.length > 50 ? url.slice(0, 50) + '...' : url }
})
const prompt = computed(() => props.toolCall.input?.prompt || '')
const MAX_CONTENT = 3000
const truncatedContent = computed(() => {
  const c = props.toolCall.output || ''
  return c.length > MAX_CONTENT ? c.slice(0, MAX_CONTENT) + '\n' + t('toolCards.webFetchTruncated') : c
})
function toggleExpand() { isExpanded.value = !isExpanded.value }

function openInPanel() {
  const url = props.toolCall.input?.url || 'WebFetch Result'
  appStore.showToolDiff({
    type: 'webfetch',
    filePath: url,
    originalContent: '',
    modifiedContent: '',
    toolCallId: props.toolCall.id,
    language: 'markdown',
    displayContent: props.toolCall.output || '',
  })
}
</script>

<style lang="scss" scoped>
.fetch-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.fetch-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.fetch-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(249, 115, 22, 0.12); color: #fb923c; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.status-running .fetch-icon-wrapper { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
.status-error .fetch-icon-wrapper { background: rgba(239, 68, 68, 0.12); color: #f87171; }
.fetch-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #fb923c; flex-shrink: 0; }
.fetch-url { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
.panel-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; flex-shrink: 0; transition: all 0.15s; &:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); } }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.fetch-body { border-top: 1px solid var(--surface-border); }
.fetch-prompt, .fetch-content { padding: 10px 12px; }
.block-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-tertiary); margin-bottom: 6px; font-weight: 500; }
.prompt-text { margin: 0; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.content-preview { margin: 0; padding: 10px 12px; border-radius: 4px; font-size: 12px; line-height: 1.6; overflow: auto; max-height: 450px; white-space: pre-wrap; background: #0d1117; color: #f0f6fc; word-break: break-word; }
.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
