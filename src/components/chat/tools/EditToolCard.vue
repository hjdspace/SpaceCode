<template>
  <div class="edit-tool-card" :class="[statusClass]">
    <div class="edit-header" @click="toggleExpand">
      <div class="edit-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <FileEdit v-else :size="14" />
      </div>
      <span class="edit-label">Edit</span>
      <span class="edit-path">{{ filePath }}</span>
      <button
        class="panel-btn"
        @click.stop="openInPanel"
        :title="t('infoPanel.openInPanel')"
      >
        <ExternalLink :size="13" />
      </button>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <div v-show="isExpanded" class="edit-body">
      <!-- Unified Diff 视图 -->
      <div v-if="diffLines.length > 0" class="unified-diff">
        <div
          v-for="(line, index) in diffLines"
          :key="index"
          class="diff-line"
          :class="line.type"
        >
          <span class="line-prefix">{{ line.prefix }}</span>
          <span class="line-number">{{ line.displayNumber }}</span>
          <span class="line-content" v-html="getHighlightedContent(line, index)"></span>
        </div>
      </div>

      <!-- 无 diff 数据时的回退显示 -->
      <div v-else class="empty-diff">
        <span>No changes to display</span>
      </div>

      <!-- Result 输出 -->
      <div v-if="toolCall.output" class="result-section">
        <div class="block-label">Result</div>
        <pre class="code-block result-text"><code>{{ toolCall.output }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FileEdit, ChevronDown, ExternalLink, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import * as Diff from 'diff'
import hljs from 'highlight.js'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const appStore = useAppStore()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const filePath = computed(() => props.toolCall.input?.file_path || props.toolCall.input?.path || 'unknown')

function toggleExpand() { isExpanded.value = !isExpanded.value }

// Diff 行数据接口
interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  displayNumber?: number
  oldNumber?: number
  newNumber?: number
  prefix: string
}

// 生成 unified diff 行数据
const diffLines = computed<DiffLine[]>(() => {
  const oldStr = props.toolCall.input?.old_string || ''
  const newStr = props.toolCall.input?.new_string || ''

  if (!oldStr && !newStr) return []

  const changes = Diff.diffLines(oldStr, newStr)
  const lines: DiffLine[] = []
  let oldNum = 0
  let newNum = 0

  for (const change of changes) {
    const count = change.count || 0
    const value = change.value
    const splitLines = value.split('\n')
    const trailingNewline = value.endsWith('\n')
    const contentLines = trailingNewline ? splitLines.slice(0, -1) : splitLines

    if (change.added) {
      for (const line of contentLines) {
        newNum++
        lines.push({
          type: 'add',
          content: line,
          displayNumber: newNum,
          newNumber: newNum,
          prefix: '+'
        })
      }
    } else if (change.removed) {
      for (const line of contentLines) {
        oldNum++
        lines.push({
          type: 'remove',
          content: line,
          displayNumber: oldNum,
          oldNumber: oldNum,
          prefix: '-'
        })
      }
    } else {
      for (const line of contentLines) {
        oldNum++
        newNum++
        lines.push({
          type: 'context',
          content: line,
          displayNumber: newNum,
          oldNumber: oldNum,
          newNumber: newNum,
          prefix: ' '
        })
      }
    }
  }

  return lines
})

// 对所有行进行高亮处理（缓存结果）
const highlightedLines = computed<string[]>(() => {
  const data = diffLines.value
  if (data.length === 0) return []

  // 分别高亮旧内容和新内容
  const oldContent = data
    .filter(l => l.type === 'remove' || l.type === 'context')
    .map(l => l.content)
    .join('\n')

  const newContent = data
    .filter(l => l.type === 'add' || l.type === 'context')
    .map(l => l.content)
    .join('\n')

  const language = appStore.getLanguageFromPath(filePath.value)

  const oldHighlighted = highlightAndSplit(oldContent, language)
  const newHighlighted = highlightAndSplit(newContent, language)

  // 映射回每行
  let oldIdx = 0
  let newIdx = 0

  return data.map(line => {
    if (line.type === 'remove') {
      return oldHighlighted[oldIdx++] || escapeHtml(line.content)
    } else {
      return newHighlighted[newIdx++] || escapeHtml(line.content)
    }
  })
})

// 高亮并按行分割（处理跨行 span 标签）
function highlightAndSplit(content: string, language: string): string[] {
  if (!content) return ['']

  let highlighted: string
  try {
    if (language && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(content, { language }).value
    } else {
      highlighted = hljs.highlightAuto(content).value
    }
  } catch {
    highlighted = escapeHtml(content)
  }

  return splitHtmlByNewlines(highlighted)
}

// 分割 HTML 时保持跨行 span 标签的完整性
function splitHtmlByNewlines(html: string): string[] {
  const rawLines = html.split('\n')
  const result: string[] = []
  let openSpans = ''

  for (const line of rawLines) {
    const fullLine = openSpans + line
    const opens: string[] = []
    let closes = 0

    const spanRegex = /<span[^>]*>/g
    const closeSpanRegex = /<\/span>/g
    let match
    while ((match = spanRegex.exec(fullLine)) !== null) {
      opens.push(match[0])
    }
    while ((match = closeSpanRegex.exec(fullLine)) !== null) {
      closes++
    }

    const unclosedCount = opens.length - closes
    result.push(fullLine + '</span>'.repeat(Math.max(0, unclosedCount)))
    openSpans = opens.slice(closes).join('')
  }

  return result
}

// 获取某行的高亮 HTML
function getHighlightedContent(line: DiffLine, index: number): string {
  return highlightedLines.value[index] || escapeHtml(line.content)
}

// HTML 转义（XSS 防护）
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function openInPanel() {
  const fp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!fp) return

  const modifiedContent = await api.readFile(fp)
  if (modifiedContent === null) return

  let originalContent = modifiedContent
  const oldStr = props.toolCall.input?.old_string || ''
  const newStr = props.toolCall.input?.new_string || ''
  if (newStr && modifiedContent.includes(newStr)) {
    originalContent = modifiedContent.replace(newStr, oldStr)
  }

  const language = appStore.getLanguageFromPath(fp)
  appStore.showToolDiff({
    type: 'edit',
    filePath: fp,
    originalContent,
    modifiedContent,
    toolCallId: props.toolCall.id,
    language,
  })
}
</script>

<style lang="scss" scoped>
.edit-tool-card {
  border-radius: 6px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  overflow: hidden;
  font-size: 13px;
}

.edit-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;

  &:hover {
    background: rgba(255,255,255,0.03);
  }
}

.edit-icon-wrapper {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: rgba(249, 115, 22, 0.12);
  color: #fb923c;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.status-running .edit-icon-wrapper {
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
}

.status-error .edit-icon-wrapper {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.edit-label {
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #fb923c;
  flex-shrink: 0;
}

.edit-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--text-secondary);
}

.panel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;

  &:hover {
    background: rgba(255,255,255,0.1);
    color: var(--text-primary);
  }
}

.expand-icon {
  color: var(--text-tertiary);
  transition: transform 0.15s;

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.edit-body {
  border-top: 1px solid var(--surface-border);
}

/* Unified Diff 样式 */
.unified-diff {
  background: #0d1117;
  border-radius: 6px;
  margin: 8px;
  overflow: hidden;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 4px;

    &:hover {
      background: rgba(255, 255, 255, 0.25);
    }
  }
}

.diff-line {
  display: flex;
  padding: 0 12px;
  border-left: 3px solid transparent;
  min-height: 21px;

  &.context {
    background: rgba(255, 255, 255, 0.02);
  }

  &.add {
    background: rgba(46, 160, 67, 0.15);
    border-left-color: #2ea043;

    .line-prefix {
      color: #3fb950;
    }
  }

  &.remove {
    background: rgba(248, 81, 73, 0.15);
    border-left-color: #f85149;

    .line-prefix {
      color: #f85149;
    }
  }
}

.line-prefix {
  width: 20px;
  text-align: center;
  color: #6e7681;
  user-select: none;
  flex-shrink: 0;
  padding-top: 1px;
}

.line-number {
  width: 40px;
  text-align: right;
  padding-right: 12px;
  color: #6e7681;
  user-select: none;
  flex-shrink: 0;
  padding-top: 1px;
}

.line-content {
  flex: 1;
  white-space: pre;
  word-break: break-all;
  color: #c9d1d9;
  padding-top: 1px;

  /* 继承 highlight.js 的语法高亮颜色 */
  :deep(.hljs) {
    color: inherit;
    background: transparent;
  }

  :deep(.hljs-comment),
  :deep(.hljs-quote) {
    color: #6a737d;
    font-style: italic;
  }

  :deep(.hljs-keyword),
  :deep(.hljs-selector-tag),
  :deep(.hljs-addition) {
    color: #ff7b72;
  }

  :deep(.hljs-number),
  :deep(.hljs-string),
  :deep(.hljs-meta .hljs-meta-string),
  :deep(.hljs-literal),
  :deep(.hljs-doctag),
  :deep(.hljs-regexp) {
    color: #a5d6ff;
  }

  :deep(.hljs-title),
  :deep(.hljs-section),
  :deep(.hljs-name),
  :deep(.hljs-selector-id),
  :deep(.hljs-selector-class) {
    color: #d2a8ff;
  }

  :deep(.hljs-attribute),
  :deep(.hljs-attr),
  :deep(.hljs-variable),
  :deep(.hljs-template-variable),
  :deep(.hljs-class .hljs-title),
  :deep(.hljs-type) {
    color: #79c0ff;
  }

  :deep(.hljs-symbol),
  :deep(.hljs-bullet),
  :deep(.hljs-subst),
  :deep(.hljs-meta),
  :deep(.hljs-selector-attr),
  :deep(.hljs-selector-pseudo),
  :deep(.hljs-link) {
    color: #79c0ff;
  }

  :deep(.hljs-built_in),
  :deep(.hljs-deletion) {
    color: #ffa657;
  }

  :deep(.hljs-formula) {
    background: #083254;
    color: #f8e71c;
  }

  :deep(.hljs-emphasis) {
    font-style: italic;
  }

  :deep(.hljs-strong) {
    font-weight: bold;
  }
}

.empty-diff {
  padding: 20px;
  text-align: center;
  color: #6e7681;
  font-size: 12px;
}

.result-section {
  padding: 10px 12px;
  border-top: 1px solid var(--surface-border);
}

.block-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 6px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.code-block {
  margin: 0;
  padding: 10px 12px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.result-text {
  background: #0d1117;
  color: #c9d1d9;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>