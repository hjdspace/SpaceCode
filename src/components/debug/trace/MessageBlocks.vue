<template>
  <div class="message-blocks">
    <template v-for="(block, idx) in blocks" :key="idx">
      <!-- Text block -->
      <div v-if="block.type === 'text'" class="block block-text">
        <div class="block-label">
          <Type :size="10" /> Text
        </div>
        <pre class="block-content">{{ block.text }}</pre>
      </div>

      <!-- Thinking block -->
      <div v-else-if="block.type === 'thinking'" class="block block-thinking">
        <div class="block-label">
          <Brain :size="10" /> Thinking
        </div>
        <pre class="block-content thinking-text">{{ block.thinking }}</pre>
      </div>

      <!-- Tool Use block -->
      <div v-else-if="block.type === 'tool_use'" class="block block-tool-use">
        <div class="block-label">
          <Wrench :size="10" /> {{ block.name || 'tool_use' }}
          <span v-if="block.id" class="block-id">{{ block.id }}</span>
        </div>
        <pre class="block-content">{{ formatJson(block.input) }}</pre>
      </div>

      <!-- Tool Result block -->
      <div v-else-if="block.type === 'tool_result'" class="block block-tool-result" :class="{ error: block.isError }">
        <div class="block-label">
          <CheckCircle :size="10" /> Tool Result
          <span v-if="block.toolUseId" class="block-id">{{ block.toolUseId }}</span>
          <span v-if="block.isError" class="error-badge">Error</span>
        </div>
        <pre class="block-content">{{ formatContent(block.content) }}</pre>
      </div>

      <!-- Image block -->
      <div v-else-if="block.type === 'image'" class="block block-image">
        <div class="block-label">
          <ImageIcon :size="10" /> Image
          <span v-if="block.mediaType" class="block-id">{{ block.mediaType }}</span>
        </div>
        <img v-if="block.dataUrl" :src="block.dataUrl" class="block-img" alt="trace image" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Type, Brain, Wrench, CheckCircle, ImageIcon } from 'lucide-vue-next'
import type { NormalizedBlock } from '@/lib/trace/types'

defineProps<{
  blocks: NormalizedBlock[]
}>()

function formatJson(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return 'null'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) return (item as { text: string }).text
        try { return JSON.stringify(item) } catch { return String(item) }
      })
      .join('\n')
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
</script>

<style lang="scss" scoped>
.message-blocks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.block-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.block-id {
  font-size: 9px;
  font-family: var(--font-mono);
  opacity: 0.6;
  font-weight: 400;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.error-badge {
  font-size: 9px;
  padding: 0 5px;
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border-radius: 9999px;
  font-weight: 600;
}

.block-content {
  margin: 0;
  padding: 10px 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.15);

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }
}

// Block type specific styles
.block-text .block-label { color: #a78bfa; }
.block-thinking .block-label { color: #fbbf24; }
.block-thinking .thinking-text { font-style: italic; opacity: 0.85; }
.block-tool-use .block-label { color: #34d399; }
.block-tool-result .block-label { color: #60a5fa; }
.block-tool-result.error { border-color: rgba(239, 68, 68, 0.2); }
.block-tool-result.error .block-label { color: #f87171; }
.block-image .block-label { color: #f472b6; }

.block-img {
  display: block;
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
  background: rgba(0, 0, 0, 0.2);
}
</style>
