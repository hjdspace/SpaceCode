<template>
  <div class="tool-call-list">
    <div class="tool-list-header">
      <Wrench :size="14" />
      <span>工具调用 ({{ toolCalls.length }})</span>
    </div>
    <div class="tool-list-content">
      <ToolCallCard
        v-for="tool in toolCalls"
        :key="tool.id"
        :tool-call="tool"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Wrench } from 'lucide-vue-next'
import ToolCallCard from './ToolCallCard.vue'

defineProps<{
  toolCalls: ToolCall[]
}>()
</script>

<style lang="scss" scoped>
.tool-call-list {
  margin: 8px 0;
}

.tool-list-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  padding: 0 4px;
}

.tool-list-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
