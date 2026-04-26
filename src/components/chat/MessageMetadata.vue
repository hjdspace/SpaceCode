<template>
  <div v-if="showMetadata" class="message-metadata">
    <span v-if="metadata?.model">{{ metadata.model }}</span>
    <span v-if="tokenText">{{ tokenText }}</span>
    <span v-if="metadata?.duration">{{ (metadata.duration / 1000).toFixed(1) }}s</span>
  </div>
</template>

<script setup lang="ts">
import type { MessageMetadata } from '@/types'
import { computed } from 'vue'

const props = defineProps<{
  metadata?: MessageMetadata
}>()

const showMetadata = computed(() => {
  return props.metadata && (props.metadata.model || props.metadata.inputTokens || props.metadata.duration)
})

const tokenText = computed(() => {
  if (!props.metadata) return ''
  const { inputTokens, outputTokens } = props.metadata
  if (inputTokens && outputTokens) {
    return `${inputTokens.toLocaleString()} + ${outputTokens.toLocaleString()} tokens`
  } else if (inputTokens) {
    return `${inputTokens.toLocaleString()} tokens`
  } else if (outputTokens) {
    return `${outputTokens.toLocaleString()} tokens`
  }
  return ''
})
</script>

<style lang="scss" scoped>
.message-metadata {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.7;
  transition: opacity var(--transition-fast);

  &:hover {
    opacity: 1;
  }

  span:not(:last-child)::after {
    content: '·';
    margin-left: 8px;
    opacity: 0.5;
  }
}
</style>
