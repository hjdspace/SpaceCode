<template>
  <div class="diff-viewer">
    <div class="diff-header">
      <FileDiff :size="14" />
      <span>Code Changes</span>
    </div>
    
    <div class="diff-content" v-if="diffLines.length > 0">
      <div 
        v-for="(line, index) in diffLines" 
        :key="index"
        class="diff-line"
        :class="line.type"
      >
        <span class="line-number">{{ line.oldNumber || '' }}</span>
        <span class="line-number">{{ line.newNumber || '' }}</span>
        <span class="line-content">{{ line.content }}</span>
      </div>
    </div>
    
    <div class="empty-diff" v-else>
      <p>No changes to display</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { FileDiff } from 'lucide-vue-next'
import type { DiffLine } from '@/types'

const diffLines = ref<DiffLine[]>([])

onMounted(() => {
  diffLines.value = [
    { type: 'context', content: 'function example() {', oldNumber: 1, newNumber: 1 },
    { type: 'context', content: '  // Old implementation', oldNumber: 2, newNumber: 2 },
    { type: 'remove', content: '-  const oldVar = "deprecated";', oldNumber: 3 },
    { type: 'add', content: '+  const newVar = "updated";', newNumber: 3 },
    { type: 'add', content: '+  console.log("Added feature");', newNumber: 4 },
    { type: 'context', content: '  return result;', oldNumber: 4, newNumber: 5 },
    { type: 'context', content: '}', oldNumber: 5, newNumber: 6 }
  ]
})
</script>

<style lang="scss" scoped>
.diff-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.diff-content {
  flex: 1;
  overflow: auto;
  @include scrollbar;
  font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.diff-line {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid transparent;
  
  .line-number {
    min-width: 40px;
    padding: 0 8px;
    text-align: right;
    color: var(--text-muted);
    user-select: none;
    background: var(--bg-secondary);
  }
  
  .line-content {
    flex: 1;
    padding: 0 12px;
    white-space: pre;
  }
  
  &.context {
    .line-content {
      color: var(--text-secondary);
    }
  }
  
  &.add {
    background: rgba(40, 167, 69, 0.08);
    
    .line-number {
      background: rgba(40, 167, 69, 0.12);
    }
    
    .line-content {
      color: var(--success);
    }
  }
  
  &.remove {
    background: rgba(220, 53, 69, 0.08);
    
    .line-number {
      background: rgba(220, 53, 69, 0.12);
    }
    
    .line-content {
      color: var(--error);
    }
  }
}

.empty-diff {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-muted);
  font-size: 13px;
}
</style>