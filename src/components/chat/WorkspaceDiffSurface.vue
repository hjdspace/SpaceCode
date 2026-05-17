<template>
  <div class="workspace-diff-surface" :class="className">
    <div class="diff-container">
      <pre class="diff-pre">
        <div
          v-for="(line, index) in visibleLines"
          :key="index"
          :class="getLineClass(line)"
        >
          <span class="line-number">{{ index + 1 }}</span>
          <span :class="['prefix', getPrefixClass(line)]">{{ getLinePrefix(line) }}</span>
          <span :class="['content', getContentClass(line)]" v-html="highlightedContent(line, index)"></span>
        </div>
      </pre>
      
      <div v-if="lines.length > lineLimit" class="diff-footer">
        <span>
          {{ showAllLines 
            ? t('workspace.previewAllLines', { total: lines.length }) 
            : t('workspace.previewLineLimit', { count: visibleLines.length, total: lines.length }) 
          }}
        </span>
        <button @click="toggleShowAll" class="toggle-btn">
          {{ showAllLines ? collapseLabel : showAllLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

interface Props {
  value: string
  path: string
  className?: string
  lineLimit?: number
}

const props = withDefaults(defineProps<Props>(), {
  className: 'min-h-0 flex-1 overflow-auto bg-[var(--color-code-bg)]',
  lineLimit: 2000
})

const showAllLines = ref(false)

const lines = computed(() => props.value.split('\n'))
const visibleLines = computed(() => 
  showAllLines.value ? lines.value : lines.value.slice(0, props.lineLimit)
)

watch(() => [props.path, props.value], () => {
  showAllLines.value = false
})

function getFileExtension(name: string): string {
  const cleanName = name.split('/').pop() ?? name
  const lastDot = cleanName.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === cleanName.length - 1) return ''
  return cleanName.slice(lastDot + 1).toLowerCase()
}

function normalizeLanguage(language: string): string {
  const lower = language.toLowerCase()
  const map: Record<string, string> = {
    text: 'text', typescript: 'typescript', ts: 'typescript', tsx: 'tsx',
    javascript: 'javascript', js: 'javascript', jsx: 'jsx',
    markdown: 'markdown', md: 'markdown', html: 'markup', xml: 'markup',
    shell: 'bash', sh: 'bash', zsh: 'bash', diff: 'diff',
  }
  return map[lower] ?? lower
}

function getLanguageFromPath(path: string): string {
  return normalizeLanguage(getFileExtension(path) || 'text')
}

function getLineClass(line: string): string {
  const isAdded = line.startsWith('+') && !line.startsWith('+++')
  const isRemoved = line.startsWith('-') && !line.startsWith('---')
  const isHunk = line.startsWith('@@')
  
  if (isAdded) return 'diff-line diff-added'
  if (isRemoved) return 'diff-line diff-removed'
  if (isHunk) return 'diff-line diff-hunk'
  return 'diff-line diff-context'
}

function getPrefixClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'prefix-added'
  if (line.startsWith('-') && !line.startsWith('---')) return 'prefix-removed'
  return 'prefix-context'
}

function getLinePrefix(line: string): string {
  if ((line.startsWith('+') || line.startsWith('-')) && 
      !line.startsWith('+++') && !line.startsWith('---')) {
    return line[0]
  }
  return ' '
}

function getContentClass(line: string): string {
  const isFileHeader = line.startsWith('diff --') || line.startsWith('--- ') || line.startsWith('+++ ')
  const isHunk = line.startsWith('@@')
  
  if (isFileHeader) return 'content-header'
  if (isHunk) return 'content-hunk'
  return ''
}

function highlightedContent(line: string, _index: number): string {
  const isAdded = line.startsWith('+') && !line.startsWith('+++')
  const isRemoved = line.startsWith('-') && !line.startsWith('---')
  const isCodeLine = isAdded || isRemoved || line.startsWith(' ')
  
  if (!isCodeLine) return escapeHtml(line) || ' '
  
  const code = line.slice(1)
  return escapeHtml(code) || ' '
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function toggleShowAll() {
  showAllLines.value = !showAllLines.value
}

const collapseLabel = computed(() => t('workspace.collapsePreview'))
const showAllLabel = computed(() => t('workspace.showAllLoadedLines'))
</script>

<style lang="scss" scoped>
.workspace-diff-surface {
  font-family: var(--font-mono, 'Consolas', 'Monaco', monospace);
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-code-fg, #d4d4d4);
  background-color: var(--color-code-bg, #1e1e1e);
  border-radius: var(--radius-md, 6px);
  border: 1px solid var(--color-border, #3c3c3c);
  overflow: auto;
  max-height: 430px;
}

.diff-container {
  position: relative;
  min-width: max-content;
  padding: 8px 0;
}

.diff-pre {
  margin: 0;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  background: transparent;
}

.diff-line {
  display: grid;
  grid-template-columns: 48px 18px max-content;
  gap: 8px;
  padding: 0 12px;
  min-width: 100%;
  width: max-content;

  &:hover {
    background-color: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
  }

  &.diff-added {
    background-color: var(--color-diff-added-bg, rgba(16, 185, 129, 0.15));
  }

  &.diff-removed {
    background-color: var(--color-diff-removed-bg, rgba(239, 68, 68, 0.15));
  }

  &.diff-hunk {
    background-color: var(--color-diff-highlight-bg, rgba(245, 158, 11, 0.15));
  }
}

.line-number {
  text-align: right;
  font-size: 11px;
  color: var(--color-text-tertiary, #888888);
  user-select: none;
}

.prefix {
  text-align: center;
  font-weight: 500;
  user-select: none;

  &.prefix-added {
    color: var(--color-diff-added-text, #10b981);
  }

  &.prefix-removed {
    color: var(--color-diff-removed-text, #ef4444);
  }

  &.prefix-context {
    color: var(--color-text-tertiary, #888888);
  }
}

.content {
  white-space: pre;
  padding-right: 24px;

  &.content-header {
    font-weight: 600;
    color: var(--color-text-secondary, #cccccc);
  }

  &.content-hunk {
    font-weight: 600;
    color: var(--color-warning, #f59e0b);
  }
}

.diff-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--color-border, #3c3c3c);
  background-color: var(--color-surface-glass, rgba(30, 30, 30, 0.9));
  backdrop-filter: blur(8px);
  font-size: 12px;
  color: var(--color-text-tertiary, #888888);
}

.toggle-btn {
  margin-left: auto;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary, #aaaaaa);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-text-primary, #ffffff);
  }
}
</style>
