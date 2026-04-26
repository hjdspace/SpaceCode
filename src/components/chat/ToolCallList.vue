<template>
  <div class="tool-call-list">
    <ToolCallCard
      v-for="tool in toolCalls"
      :key="tool.id"
      :tool-call="tool"
    />
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import ToolCallCard from './ToolCallCard.vue'

defineProps<{
  toolCalls: ToolCall[]
}>()
</script>

<style lang="scss" scoped>
.tool-call-list {
  margin: 4px 0 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 4px;
  border-left: 2px solid var(--surface-border);
}
</style>
