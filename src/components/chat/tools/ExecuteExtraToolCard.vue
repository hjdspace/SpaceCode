<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <Play v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.executeExtraTool') }}</span>
      <span class="tool-separator">·</span>
      <span class="tool-target">{{ targetToolName }}</span>
      <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <div v-if="isExpanded" class="tool-body">
      <div v-if="hasParams" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.executeExtraToolParams') }}</div>
        <div class="tool-section-body">
          <pre class="json-block"><code>{{ formattedParams }}</code></pre>
        </div>
      </div>

      <div v-if="hasResult" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.executeExtraToolResult') }}</div>
        <div class="tool-section-body">
          <pre class="json-block"><code>{{ formattedResult }}</code></pre>
        </div>
      </div>

      <div v-if="!hasParams && !hasResult" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.executeExtraToolNoResult') }}</div>
        <div class="tool-section-body">
          <pre class="json-block"><code>{{ toolCall.output || t('toolCards.executeExtraToolNoResult') }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Play, ChevronDown, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

interface ExecuteExtraToolOutput {
  tool_name: string
  result: unknown
}

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const targetToolName = computed(() => props.toolCall.input?.tool_name || '')

const params = computed(() => props.toolCall.input?.params ?? {})
const hasParams = computed(() => Object.keys(params.value).length > 0)
const formattedParams = computed(() => JSON.stringify(params.value, null, 2))

const outputData = computed<ExecuteExtraToolOutput | null>(() => {
  const output = props.toolCall.output
  if (!output) return null
  try {
    const parsed = JSON.parse(output) as ExecuteExtraToolOutput
    if (parsed && typeof parsed.tool_name === 'string') {
      return parsed
    }
    return null
  } catch {
    return null
  }
})

const hasResult = computed(() => outputData.value !== null)
const formattedResult = computed(() => {
  if (!outputData.value) return ''
  return JSON.stringify(outputData.value.result, null, 2)
})

function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.json-block {
  margin: 0;
}
</style>
