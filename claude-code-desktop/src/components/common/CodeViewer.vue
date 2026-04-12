<template>
  <div class="code-viewer">
    <div class="viewer-header">
      <FileCode :size="14" />
      <span class="file-name">{{ appStore.currentFile?.name || 'No file selected' }}</span>
      <span class="language-badge" v-if="appStore.currentFile">{{ appStore.currentFile.language }}</span>
      <button 
        v-if="isMarkdownFile" 
        class="preview-btn"
        @click="switchToPreview"
        title="Preview Markdown"
      >
        <Eye :size="14" />
        <span>Preview</span>
      </button>
    </div>
    
    <div class="code-container" v-if="appStore.currentFile">
      <pre><code :class="`language-${appStore.currentFile.language}`" v-html="highlightedCode"></code></pre>
    </div>
    <div class="empty-state" v-else>
      <FileCode :size="48" />
      <p>Select a file to view its content</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { FileCode, Eye } from 'lucide-vue-next'
import hljs from 'highlight.js'

const appStore = useAppStore()

const isMarkdownFile = computed(() => {
  return appStore.currentFile?.language === 'markdown'
})

function switchToPreview() {
  appStore.showInfoPanel('markdown')
}

const highlightedCode = computed(() => {
  const file = appStore.currentFile
  if (!file) return ''
  
  try {
    const language = file.language
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(file.content, { language }).value
    }
    return hljs.highlightAuto(file.content).value
  } catch (error) {
    console.error('Highlight error:', error)
    return escapeHtml(file.content)
  }
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
</script>

<style lang="scss" scoped>
.code-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.viewer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  
  .file-name {
    font-weight: 500;
    color: var(--text-primary);
    @include truncate;
    flex: 1;
  }

  .language-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .preview-btn {
    @include reset-button;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    transition: all 0.15s;
    
    &:hover {
      background: var(--accent-color);
      color: white;
    }
  }
}

.code-container {
  flex: 1;
  margin: 0;
  overflow: auto;
  @include scrollbar;
  background: var(--bg-primary);
  
  pre {
    margin: 0;
    padding: 16px;
    min-height: 100%;
  }
  
  code {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre;
    color: var(--text-primary);
  }
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-muted);
  
  p {
    font-size: 14px;
  }
}
</style>

<style lang="scss">
.hljs {
  color: var(--text-primary);
  background: transparent;
}

.hljs-comment,
.hljs-quote {
  color: #6a737d;
  font-style: italic;
}

.hljs-keyword,
.hljs-selector-tag,
.hljs-addition {
  color: #ff7b72;
}

.hljs-number,
.hljs-string,
.hljs-meta .hljs-meta-string,
.hljs-literal,
.hljs-doctag,
.hljs-regexp {
  color: #a5d6ff;
}

.hljs-title,
.hljs-section,
.hljs-name,
.hljs-selector-id,
.hljs-selector-class {
  color: #d2a8ff;
}

.hljs-attribute,
.hljs-attr,
.hljs-variable,
.hljs-template-variable,
.hljs-class .hljs-title,
.hljs-type {
  color: #79c0ff;
}

.hljs-symbol,
.hljs-bullet,
.hljs-subst,
.hljs-meta,
.hljs-meta .hljs-keyword,
.hljs-selector-attr,
.hljs-selector-pseudo,
.hljs-link {
  color: #ffa657;
}

.hljs-built_in,
.hljs-deletion {
  color: #ffa198;
}

.hljs-formula {
  background: #161b22;
}

.hljs-emphasis {
  font-style: italic;
}

.hljs-strong {
  font-weight: bold;
}
</style>
