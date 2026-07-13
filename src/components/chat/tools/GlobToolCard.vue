<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <Search v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.glob') }}</span>
      <span class="tool-separator">·</span>
      <code class="tool-target">{{ pattern }}</code>
      <span v-if="matchCount !== null" class="tool-meta">{{ matchCount }} {{ t('toolCards.globResults') }}</span>
      <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-if="isExpanded" class="tool-body">
      <div class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.globResults') }}</div>
        <div class="tool-section-body">
          <pre class="file-list"><code>{{ formattedOutput }}</code></pre>
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

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const pattern = computed(() => props.toolCall.input?.pattern || props.toolCall.input?.path || '*')
const matchCount = computed(() => {
  const out = props.toolCall.output || ''
  if (!out || out === 'No matching files') return 0
  return out.split('\n').filter(l => l.trim()).length
})
const formattedOutput = computed(() => props.toolCall.output || t('toolCards.globNoResults'))
function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.file-list {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
  max-height: 350px;
  white-space: pre;
  background: var(--code-bg, #0d1117);
  color: var(--code-fg, #f0f6fc);
  border-radius: 6px;
}
</style>
