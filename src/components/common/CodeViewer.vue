<template>
  <div class="code-viewer">
    <div class="viewer-header">
      <FileCode :size="14" />
      <span class="file-name">{{ appStore.currentFile?.name || 'No file selected' }}</span>
      <span class="language-badge" v-if="appStore.currentFile">{{ appStore.currentFile.language }}</span>
      <span class="line-badge" v-if="appStore.currentLine > 0">
        {{ appStore.currentEndLine > appStore.currentLine
          ? `Lines ${appStore.currentLine}-${appStore.currentEndLine}`
          : `Line ${appStore.currentLine}` }}
      </span>
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

    <div class="code-container" ref="codeContainer" v-if="appStore.currentFile">
      <div class="code-with-lines">
        <div class="line-numbers">
          <div
            v-for="lineNum in lineCount"
            :key="lineNum"
            class="line-number"
            :class="{ 'current-line': isLineHighlighted(lineNum) }"
            :ref="el => registerLineRef(lineNum, el as HTMLElement | null)"
          >{{ lineNum }}</div>
        </div>
        <pre class="code-content"><code :class="`language-${appStore.currentFile.language}`" v-html="highlightedCode"></code></pre>
      </div>
    </div>
    <div class="empty-state" v-else>
      <FileCode :size="48" />
      <p>Select a file to view its content</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, markRaw } from 'vue'
import { useAppStore } from '@/stores/app'
import { FileCode, Eye, FileText } from 'lucide-vue-next'
import hljs from 'highlight.js'

const appStore = useAppStore()
const codeContainer = ref<HTMLElement | null>(null)
const lineRefs = new Map<number, HTMLElement>()

function registerLineRef(lineNum: number, el: HTMLElement | null) {
  if (el) lineRefs.set(lineNum, el)
  else lineRefs.delete(lineNum)
}

function isLineHighlighted(lineNum: number): boolean {
  const start = appStore.currentLine
  if (!start) return false
  const end = appStore.currentEndLine > start ? appStore.currentEndLine : start
  return lineNum >= start && lineNum <= end
}

const isMarkdownFile = computed(() => {
  return appStore.currentFile?.language === 'markdown'
})

const lineCount = computed(() => {
  if (!appStore.currentFile) return 0
  return appStore.currentFile.content.split('\n').length
})

function switchToPreview() {
  const file = appStore.currentFile
  if (file) {
    appStore.openInfoTab({
      id: `markdown::${file.path}`,
      type: 'markdown',
      title: file.name,
      icon: markRaw(FileText),
      data: file,
      closeable: true
    })
  }
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

function scrollToLine(lineNumber: number) {
  if (!lineNumber) return

  nextTick(() => {
    const container = codeContainer.value
    if (!container) return

    // Use the real DOM offset of the line element so zoom / font changes
    // don't desync the scroll. Fall back to an estimate if the ref is missing.
    const lineEl = lineRefs.get(lineNumber)
    let targetTop: number
    if (lineEl) {
      targetTop = lineEl.offsetTop - container.clientHeight / 3
    } else {
      const estimated = 21.6
      targetTop = (lineNumber - 1) * estimated - container.clientHeight / 3
    }
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  })
}

watch(
  () => [appStore.currentFile?.path, appStore.currentLine],
  ([, line]) => {
    if ((line as number) > 0) {
      scrollToLine(line as number)
    }
  }
)
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
  border-bottom: 1px solid var(--border-default);
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

  .line-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.15);
    color: var(--accent-primary);
    font-weight: 500;
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
}

.code-with-lines {
  display: flex;
  min-height: 100%;
}

.line-numbers {
  flex-shrink: 0;
  padding: 16px 0;
  padding-right: 12px;
  padding-left: 12px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-default);
  user-select: none;
  text-align: right;

  .line-number {
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-muted);
    height: 21.6px;

    &.current-line {
      color: var(--accent-primary);
      font-weight: 600;
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.1);
      margin: 0 -12px;
      padding: 0 12px;
    }
  }
}

.code-content {
  flex: 1;
  margin: 0;
  padding: 16px;
  overflow-x: auto;

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
    font-size: var(--font-size-base);
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
