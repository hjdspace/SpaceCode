<template>
  <aside class="info-panel" :class="[mode]">
    <div class="panel-header">
      <span class="panel-title">{{ panelTitle }}</span>
      <button class="close-btn" @click="appStore.hideInfoPanel">
        <X :size="16" />
      </button>
    </div>
    
    <div class="panel-content">
      <DiffViewer v-if="mode === 'diff'" />
      <CodeViewer v-else-if="mode === 'file'" />
      <MarkdownRenderer v-else-if="mode === 'markdown'" :content="appStore.currentFile?.content || ''" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { X } from 'lucide-vue-next'
import DiffViewer from '../common/DiffViewer.vue'
import CodeViewer from '../common/CodeViewer.vue'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'

const props = defineProps<{
  mode: 'diff' | 'file' | 'markdown'
}>()

const appStore = useAppStore()

const panelTitle = computed(() => {
  switch (props.mode) {
    case 'diff': return 'Changes'
    case 'file': return 'File Viewer'
    case 'markdown': return 'Preview'
    default: return 'Info'
  }
})
</script>

<style lang="scss" scoped>
.info-panel {
  width: 400px;
  min-width: 300px;
  max-width: 50vw;
  height: 100%;
  background: var(--surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-left: 1px solid var(--surface-border);
  display: flex;
  flex-direction: column;
  position: relative;
  animation: slideInRight var(--transition-normal) ease-out;
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 1px;
    background: linear-gradient(180deg, 
      transparent 0%, 
      var(--accent-primary-glow) 30%, 
      var(--accent-secondary-glow) 70%, 
      transparent 100%
    );
    opacity: 0.4;
  }
}

.panel-header {
  height: 48px;
  padding: 0 16px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  @include flex-between;
  position: relative;
  
  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, 
      transparent 0%, 
      var(--surface-border-strong) 50%, 
      transparent 100%
    );
  }
  
  .panel-title {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }
  
  .close-btn {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    @include flex-center;
    transition: all var(--transition-fast);
    
    &:hover {
      background: var(--surface-glass-hover);
      color: var(--error);
      transform: scale(1.05);
    }
    
    &:active {
      transform: scale(0.95);
    }
  }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  @include scrollbar;
}
</style>
