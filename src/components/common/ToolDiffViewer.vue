<template>
  <div class="tool-diff-viewer">
    <div class="diff-header">
      <FileDiff :size="14" />
      <span class="diff-path">{{ diffData?.filePath }}</span>
      <span class="language-badge" v-if="diffData?.language">
        {{ diffData.language }}
      </span>
      <div class="diff-stats" v-if="!isActionCompleted && (stats.additions || stats.deletions)">
        <span class="stat-additions">+{{ stats.additions }}</span>
        <span class="stat-deletions">-{{ stats.deletions }}</span>
      </div>
      <div class="diff-actions" v-if="hasActions">
        <button class="action-btn accept-btn" @click="handleAccept" :title="t('infoPanel.accept')">
          <Check :size="14" />
          <span>{{ t('infoPanel.accept') }}</span>
        </button>
        <button class="action-btn revert-btn" @click="handleRevert" :title="t('infoPanel.revert')">
          <Undo2 :size="14" />
          <span>{{ t('infoPanel.revert') }}</span>
        </button>
      </div>
    </div>

    <div class="diff-content" v-if="diffData?.type === 'read' || (isActionCompleted && (diffData?.type === 'write' || diffData?.type === 'edit'))">
      <pre><code :class="`language-${diffData.language}`" v-html="highlightedCode"></code></pre>
    </div>

    <div class="diff-content webfetch-content" v-else-if="diffData?.type === 'webfetch'">
      <MarkdownRenderer :content="diffData.displayContent || ''" />
    </div>

    <div class="diff-content" v-else-if="diffData?.type === 'grep'">
      <div class="grep-results">
        <div
          v-for="(line, index) in grepLines"
          :key="index"
          class="grep-line"
          :class="{ 'is-match': line.isMatch }"
        >
          <span class="grep-path" v-if="line.path">{{ line.path }}</span>
          <span class="grep-linenum" v-if="line.lineNum">{{ line.lineNum }}</span>
          <span class="grep-text" v-html="line.html"></span>
        </div>
      </div>
    </div>

    <div class="diff-content" v-else>
      <div
        v-for="(line, index) in renderedDiffLines"
        :key="index"
        class="diff-line"
        :class="line.type"
      >
        <span class="line-number">{{ line.displayNumber || '' }}</span>
        <span class="line-prefix">{{ line.prefix }}</span>
        <span class="line-content" v-html="getHighlightedLine(line)"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore, type ToolDiffData } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { FileDiff, Check, Undo2 } from 'lucide-vue-next'
import * as Diff from 'diff'
import MarkdownRenderer from './MarkdownRenderer.vue'
import hljs from 'highlight.js'
import { api } from '@/services/electronAPI'

const appStore = useAppStore()
const { t } = useI18n()

const diffData = computed(() => appStore.toolDiffData)

const isActionCompleted = computed(() => diffData.value?.actionCompleted === true)

const hasActions = computed(() => {
  const data = diffData.value
  if (!data) return false
  if (data.actionCompleted) return false
  return data.type === 'edit' || data.type === 'write'
})

interface DiffLineView {
  type: 'add' | 'remove' | 'context'
  content: string
  displayNumber?: number
  oldNumber?: number
  newNumber?: number
  prefix: string
}

const renderedDiffLines = computed<DiffLineView[]>(() => {
  const data = diffData.value
  if (!data || data.type === 'read' || data.type === 'webfetch' || data.type === 'grep') return []

  const changes = Diff.diffLines(data.originalContent, data.modifiedContent)
  const lines: DiffLineView[] = []
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
        lines.push({ type: 'add', content: line, displayNumber: newNum, newNumber: newNum, prefix: '+' })
      }
    } else if (change.removed) {
      for (const line of contentLines) {
        oldNum++
        lines.push({ type: 'remove', content: line, displayNumber: oldNum, oldNumber: oldNum, prefix: '-' })
      }
    } else {
      for (const line of contentLines) {
        oldNum++
        newNum++
        lines.push({ type: 'context', content: line, displayNumber: newNum, oldNumber: oldNum, newNumber: newNum, prefix: ' ' })
      }
    }
  }

  return lines
})

const stats = computed(() => {
  let additions = 0
  let deletions = 0
  for (const line of renderedDiffLines.value) {
    if (line.type === 'add') additions++
    if (line.type === 'remove') deletions++
  }
  return { additions, deletions }
})

const highlightedOriginalLines = computed<string[]>(() => {
  const data = diffData.value
  if (!data || !data.originalContent) return []
  return highlightAndSplit(data.originalContent, data.language)
})

const highlightedModifiedLines = computed<string[]>(() => {
  const data = diffData.value
  if (!data || !data.modifiedContent) return []
  return highlightAndSplit(data.modifiedContent, data.language)
})

function highlightAndSplit(content: string, language: string): string[] {
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

function getHighlightedLine(line: DiffLineView): string {
  if (line.type === 'remove' && line.oldNumber) {
    return highlightedOriginalLines.value[line.oldNumber - 1] || escapeHtml(line.content)
  }
  if (line.newNumber) {
    return highlightedModifiedLines.value[line.newNumber - 1] || escapeHtml(line.content)
  }
  return escapeHtml(line.content)
}

const highlightedCode = computed(() => {
  const data = diffData.value
  if (!data) return ''
  if (data.type !== 'read' && !isActionCompleted.value) return ''
  try {
    const language = data.language
    const content = data.modifiedContent
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value
    }
    return hljs.highlightAuto(content).value
  } catch {
    return escapeHtml(data.modifiedContent)
  }
})

interface GrepLine {
  path: string
  lineNum: string
  html: string
  isMatch: boolean
}

const grepLines = computed<GrepLine[]>(() => {
  const data = diffData.value
  if (!data || data.type !== 'grep') return []

  const query = data.searchQuery || ''
  const output = data.displayContent || ''
  const lines = output.split('\n')

  return lines.filter(l => l.trim()).map(line => {
    const sepIdx = line.indexOf(':')
    if (sepIdx === -1) {
      return { path: '', lineNum: '', html: escapeHtml(line), isMatch: false }
    }
    const pathPart = line.slice(0, sepIdx)
    const rest = line.slice(sepIdx + 1)
    const numSepIdx = rest.indexOf(':')
    if (numSepIdx === -1) {
      const isMatch = !!(query && rest.toLowerCase().includes(query.toLowerCase()))
      return {
        path: pathPart,
        lineNum: '',
        html: isMatch ? highlightMatch(rest, query) : escapeHtml(rest),
        isMatch
      }
    }
    const lineNum = rest.slice(0, numSepIdx)
    const text = rest.slice(numSepIdx + 1)
    const isMatch = !!(query && text.toLowerCase().includes(query.toLowerCase()))
    return {
      path: pathPart,
      lineNum,
      html: isMatch ? highlightMatch(text, query) : escapeHtml(text),
      isMatch
    }
  })
})

function highlightMatch(text: string, query: string): string {
  const escaped = escapeHtml(text)
  const escapedQuery = escapeHtml(query)
  const regex = new RegExp(`(${escapeRegex(escapedQuery)})`, 'gi')
  return escaped.replace(regex, '<mark class="grep-highlight">$1</mark>')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function handleAccept() {
  if (diffData.value) {
    diffData.value.actionCompleted = true
    appStore.markToolActionCompleted(diffData.value.toolCallId)
  }
}

async function handleRevert() {
  const data = diffData.value
  if (!data) return

  try {
    const result = await api.writeFile(data.filePath, data.originalContent)
    if (result.success) {
      data.actionCompleted = true
      appStore.markToolActionCompleted(data.toolCallId)
      window.dispatchEvent(new CustomEvent('refresh-file-tree'))
    } else {
      console.error('Revert failed:', result.error)
    }
  } catch (err) {
    console.error('Revert failed:', err)
  }
}
</script>

<style lang="scss" scoped>
.tool-diff-viewer {
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
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  flex-wrap: wrap;

  .diff-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
    font-size: 11px;
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

.diff-stats {
  display: flex;
  gap: 6px;
  font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
  font-size: 11px;
  flex-shrink: 0;

  .stat-additions { color: var(--success); }
  .stat-deletions { color: var(--error); }
}

.diff-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;

  &.accept-btn {
    background: rgba(40, 167, 69, 0.1);
    color: var(--success);
    border-color: rgba(40, 167, 69, 0.3);

    &:hover {
      background: rgba(40, 167, 69, 0.2);
    }
  }

  &.revert-btn {
    background: rgba(220, 53, 69, 0.1);
    color: var(--error);
    border-color: rgba(220, 53, 69, 0.3);

    &:hover {
      background: rgba(220, 53, 69, 0.2);
    }
  }
}

.diff-content {
  flex: 1;
  overflow: auto;
  font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;

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

  &.webfetch-content {
    font-family: inherit;
    padding: 16px;
  }
}

.diff-line {
  display: flex;
  align-items: stretch;
  min-height: 20px;

  .line-number {
    min-width: 40px;
    padding: 0 8px;
    text-align: right;
    color: var(--text-muted);
    user-select: none;
    background: var(--bg-secondary);
    font-size: 11px;
    flex-shrink: 0;
  }

  .line-prefix {
    width: 16px;
    text-align: center;
    user-select: none;
    flex-shrink: 0;
    font-weight: 700;
  }

  .line-content {
    flex: 1;
    padding: 0 8px;
    white-space: pre;
    overflow-x: auto;
  }

  &.context {
    .line-content { color: var(--text-secondary); }
  }

  &.add {
    background: rgba(40, 167, 69, 0.08);
    .line-number { background: rgba(40, 167, 69, 0.12); }
    .line-prefix { color: var(--success); }
  }

  &.remove {
    background: rgba(220, 53, 69, 0.08);
    .line-number { background: rgba(220, 53, 69, 0.12); }
    .line-prefix { color: var(--error); }
  }
}

:deep(.diff-line) {
  &.add .line-content :deep(span) {
    opacity: 0.9;
  }

  &.remove .line-content :deep(span) {
    opacity: 0.7;
  }
}

.grep-results {
  padding: 8px 0;
}

.grep-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 2px 12px;
  font-size: 12px;
  line-height: 1.5;

  &.is-match {
    background: rgba(139, 92, 246, 0.06);
  }

  .grep-path {
    color: var(--accent-color);
    font-size: 11px;
    flex-shrink: 0;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grep-linenum {
    color: var(--text-muted);
    font-size: 11px;
    flex-shrink: 0;
    min-width: 24px;
    text-align: right;
  }

  .grep-text {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    white-space: pre;
    color: var(--text-secondary);
  }
}

:deep(.grep-highlight) {
  background: rgba(139, 92, 246, 0.25);
  color: #c4b5fd;
  border-radius: 2px;
  padding: 0 2px;
}
</style>
