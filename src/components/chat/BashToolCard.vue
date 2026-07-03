<template>
  <div class="bash-card">
    <div class="bash-header" @click="toggle">
      <Terminal :size="14" />
      <span class="cmd">{{ toolCall.input.command }}</span>
      <span v-if="duration" class="dur">{{ duration }}s</span>
    </div>
    <div v-show="expanded" class="bash-body">
      <pre v-if="stdout" class="stdout">{{ stdout }}</pre>
      <pre v-if="stderr" class="stderr">{{ stderr }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Terminal } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
const props = defineProps<{ toolCall: ToolCall }>()
const expanded = ref(true)
const toggle = () => { expanded.value = !expanded.value }
const duration = computed(() => {
  if (!props.toolCall.startTime) return 0
  const end = props.toolCall.endTime || Date.now()
  return ((end - props.toolCall.startTime) / 1000).toFixed(1)
})
const output = computed(() => props.toolCall.output || '')
const stdout = computed(() => output.value.split('\n--- stderr ---\n')[0] || '')
const stderr = computed(() => output.value.split('\n--- stderr ---\n')[1] || '')
</script>

<style scoped lang="scss">
.bash-card { border: 1px solid var(--surface-border); border-radius: var(--radius-sm); margin: 4px 0; }
.bash-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.cmd { font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dur { color: var(--text-muted); }
.bash-body { padding: 8px 10px; }
pre { margin: 0; font-size: 11px; white-space: pre-wrap; }
.stdout { color: var(--text-primary); }
.stderr { color: #ef4444; }
</style>
