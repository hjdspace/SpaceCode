<template>
  <div class="fe-card">
    <div class="fe-header" @click="toggle">
      <Edit3 :size="14" />
      <span class="path">{{ toolCall.input.file_path }}</span>
    </div>
    <div v-show="expanded" class="fe-body">
      <pre><code>{{ toolCall.output || toolCall.input.new_string }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Edit3 } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
defineProps<{ toolCall: ToolCall }>()
const expanded = ref(false)
const toggle = () => { expanded.value = !expanded.value }
</script>

<style scoped lang="scss">
.fe-card { border: 1px solid var(--surface-border); border-radius: var(--radius-sm); margin: 4px 0; }
.fe-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.path { font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fe-body { padding: 8px 10px; }
pre { margin: 0; font-size: 11px; white-space: pre-wrap; }
</style>
