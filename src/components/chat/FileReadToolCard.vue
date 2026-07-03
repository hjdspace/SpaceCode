<template>
  <div class="fr-card">
    <div class="fr-header" @click="toggle">
      <FileText :size="14" />
      <span class="path">{{ toolCall.input.file_path }}</span>
    </div>
    <div v-show="expanded" class="fr-body">
      <pre><code>{{ toolCall.output }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FileText } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
defineProps<{ toolCall: ToolCall }>()
const expanded = ref(false)
const toggle = () => { expanded.value = !expanded.value }
</script>

<style scoped lang="scss">
.fr-card { border: 1px solid var(--surface-border); border-radius: var(--radius-sm); margin: 4px 0; }
.fr-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.path { font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-body { padding: 8px 10px; max-height: 240px; overflow-y: auto; }
pre { margin: 0; font-size: 11px; white-space: pre-wrap; }
</style>
