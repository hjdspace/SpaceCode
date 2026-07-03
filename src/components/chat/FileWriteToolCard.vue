<template>
  <div class="fw-card">
    <div class="fw-header" @click="toggle">
      <FileCode :size="14" />
      <span class="path">{{ toolCall.input.file_path }}</span>
      <button v-if="toolCall.status === 'completed'" class="open-btn" @click.stop="$emit('open', toolCall.input.file_path)">
        <ExternalLink :size="11" />
      </button>
    </div>
    <div v-show="expanded" class="fw-body">
      <pre><code>{{ toolCall.input.content }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FileCode, ExternalLink } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
defineProps<{ toolCall: ToolCall }>()
defineEmits<{ (e: 'open', path: string): void }>()
const expanded = ref(false)
const toggle = () => { expanded.value = !expanded.value }
</script>

<style scoped lang="scss">
.fw-card { border: 1px solid var(--surface-border); border-radius: var(--radius-sm); margin: 4px 0; }
.fw-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.path { font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.open-btn { background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-xs); padding: 2px; cursor: pointer; }
.fw-body { padding: 8px 10px; }
pre { margin: 0; font-size: 11px; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
</style>
