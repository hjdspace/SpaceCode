<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <Search v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.webSearch') }}</span>
      <template v-if="queryDisplay">
        <span class="tool-separator">·</span>
        <span class="tool-target">{{ queryDisplay }}</span>
      </template>
      <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-if="isExpanded" class="tool-body">
      <div v-if="toolCall.output" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.webSearchResults') }}</div>
        <div class="tool-section-body">
          <MarkdownRenderer :content="toolCall.output" class="search-results" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Search, ChevronDown, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const queryDisplay = computed(() => {
  const q = props.toolCall.input?.query || ''
  return q.length > 60 ? q.slice(0, 60) + '...' : q
})
function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.search-results {
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
