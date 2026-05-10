<template>
  <div class="markdown-viewer">
    <div class="viewer-toolbar">
      <FileText :size="14" class="toolbar-icon" />
      <span v-if="fileName" class="file-name">{{ fileName }}</span>
      <span class="language-badge">markdown</span>

      <div class="view-toggle" role="tablist">
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: mode === 'preview' }"
          @click="mode = 'preview'"
          :title="t('infoPanel.previewMode')"
          role="tab"
          :aria-selected="mode === 'preview'"
        >
          <Eye :size="13" />
          <span>{{ t('infoPanel.previewMode') }}</span>
        </button>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: mode === 'source' }"
          @click="mode = 'source'"
          :title="t('infoPanel.sourceMode')"
          role="tab"
          :aria-selected="mode === 'source'"
        >
          <Code2 :size="13" />
          <span>{{ t('infoPanel.sourceMode') }}</span>
        </button>
      </div>
    </div>

    <div class="viewer-body">
      <div v-if="mode === 'preview'" class="preview-pane">
        <MarkdownRenderer :content="content" />
      </div>

      <div v-else class="source-pane">
        <pre class="source-code"><code class="hljs language-markdown" v-html="highlightedSource"></code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, Code2, FileText } from 'lucide-vue-next'
import hljs from 'highlight.js'
import MarkdownRenderer from './MarkdownRenderer.vue'

type ViewMode = 'preview' | 'source'

const props = withDefaults(defineProps<{
  content: string
  fileName?: string
  defaultMode?: ViewMode
}>(), {
  defaultMode: 'preview',
})

const { t } = useI18n()

const mode = ref<ViewMode>(props.defaultMode)

// Reset to default mode when content source changes (e.g. opening a different file)
watch(() => props.fileName, () => {
  mode.value = props.defaultMode
})

const highlightedSource = computed(() => {
  const content = props.content || ''
  if (!content) return ''
  try {
    return hljs.highlight(content, { language: 'markdown' }).value
  } catch {
    return escapeHtml(content)
  }
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
</script>

<style lang="scss" scoped>
.markdown-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-secondary);
  flex-shrink: 0;

  .toolbar-icon {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .file-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .language-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
}

.view-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  flex-shrink: 0;

  .toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover:not(.active) {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }

    &.active {
      background: var(--accent-primary);
      color: white;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }
  }
}

.viewer-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
  @include scrollbar;
}

.preview-pane {
  padding: 20px 24px;
  max-width: 100%;
}

.source-pane {
  padding: 16px;
  min-height: 100%;
  background: var(--bg-primary);
}

.source-code {
  margin: 0;
  padding: 0;
  overflow-x: auto;
  font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;

  code {
    background: transparent;
    padding: 0;
  }

  :deep(.hljs) {
    color: var(--code-fg, var(--text-primary));
    background: transparent;
  }
  :deep(.hljs-keyword) { color: var(--code-keyword, #ff7b72); }
  :deep(.hljs-string) { color: var(--code-string, #a5d6ff); }
  :deep(.hljs-comment) { color: var(--code-comment, #6a737d); font-style: italic; }
  :deep(.hljs-section) { color: var(--code-function, #d2a8ff); font-weight: 600; }
  :deep(.hljs-bullet) { color: var(--code-attr, #ffa657); }
  :deep(.hljs-emphasis) { font-style: italic; }
  :deep(.hljs-strong) { font-weight: 700; }
  :deep(.hljs-code) { color: var(--code-string, #a5d6ff); }
  :deep(.hljs-link) { color: var(--accent-primary, #79c0ff); text-decoration: underline; }
  :deep(.hljs-symbol) { color: var(--code-builtin, #79c0ff); }
  :deep(.hljs-title) { color: var(--code-function, #d2a8ff); }
  :deep(.hljs-meta) { color: var(--code-meta, #6a737d); }
  :deep(.hljs-quote) { color: var(--code-comment, #6a737d); font-style: italic; }
  :deep(.hljs-attribute) { color: var(--code-attr, #ffa657); }
}
</style>
