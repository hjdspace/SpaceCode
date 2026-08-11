<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <Globe v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.webFetch') }}</span>
      <template v-if="urlDisplay">
        <span class="tool-separator">·</span>
        <span class="tool-target">{{ urlDisplay }}</span>
      </template>
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
      <div v-if="prompt" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.webFetchPrompt') }}</div>
        <div class="tool-section-body">
          <p class="prompt-text">{{ prompt }}</p>
        </div>
      </div>
      <div v-if="toolCall.output" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.webFetchContent') }}</div>
        <div class="tool-section-body">
          <MarkdownRenderer :content="truncatedContent" class="fetched-content" />
        </div>
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
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

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
  return c.length > MAX_CONTENT ? c.slice(0, MAX_CONTENT) + '\n\n' + t('toolCards.webFetchTruncated') : c
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
@use './tool-card.scss' as *;

.prompt-text {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.fetched-content {
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

  :deep(a) {
    color: var(--accent-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
