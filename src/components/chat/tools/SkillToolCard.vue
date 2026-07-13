<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <Zap v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.skill') }}</span>
      <span class="tool-separator">·</span>
      <span class="tool-target">/{{ skillName }}</span>
      <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-if="isExpanded" class="tool-body">
      <div v-if="promptArg" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.skillPromptArg') }}</div>
        <div class="tool-section-body">
          <pre class="code-block"><code>{{ promptArg }}</code></pre>
        </div>
      </div>
      <div v-if="toolCall.output" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.skillResult') }}</div>
        <div class="tool-section-body">
          <pre class="code-block"><code>{{ toolCall.output }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Zap, ChevronDown, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const skillName = computed(() => props.toolCall.input?.skill || props.toolCall.input?.command || 'unknown')
const promptArg = computed(() => props.toolCall.input?.prompt || '')
function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.code-block {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--code-bg, #0d1117);
  color: var(--code-fg, #f0f6fc);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  max-height: 400px;
}
</style>
