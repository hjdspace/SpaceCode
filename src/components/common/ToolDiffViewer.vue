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
      <!-- 视图模式切换按钮 -->
      <button
        class="view-toggle-btn"
        @click="toggleViewMode"
        :title="viewMode === DiffModeEnum.Unified ? 'Split View' : 'Unified View'"
        v-if="diffData?.type === 'edit' && !isActionCompleted"
      >
        <Columns3 :size="14" />
      </button>
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

    <div
      class="diff-content markdown-content"
      v-if="isMarkdownFile && (diffData?.type === 'read' || (isActionCompleted && (diffData?.type === 'write' || diffData?.type === 'edit')))"
    >
      <MarkdownViewer :content="diffData.modifiedContent || ''" :file-name="fileName" />
    </div>

    <div class="diff-content" v-else-if="diffData?.type === 'read' || (isActionCompleted && (diffData?.type === 'write' || diffData?.type === 'edit'))">
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

    <!-- 专业 Diff 展示 -->
    <div class="diff-content git-diff-full-height" v-else-if="diffFile">
      <DiffView
        :diff-file="diffFile"
        :diff-view-mode="viewMode"
        :diff-view-highlight="true"
        class="git-diff-container"
      />
    </div>

    <!-- 无 diff 时的回退：直接展示当前文件内容（已是 HEAD 状态） -->
    <div
      class="diff-content"
      v-else-if="diffData?.type === 'edit' || diffData?.type === 'write'"
    >
      <div class="empty-diff-notice">{{ t('infoPanel.noChangesToDisplay') || 'No changes to display' }}</div>
      <pre><code :class="`language-${diffData.language}`" v-html="fallbackHighlightedCode"></code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, ref as vueRef } from 'vue'
import { useAppStore, type ToolDiffData } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { FileDiff, Check, Undo2, Columns3 } from 'lucide-vue-next'
import MarkdownRenderer from './MarkdownRenderer.vue'
import MarkdownViewer from './MarkdownViewer.vue'
import hljs from 'highlight.js'
import { api } from '@/services/electronAPI'
import { DiffView, DiffModeEnum } from '@git-diff-view/vue'
import { generateDiffFile } from '@git-diff-view/file'
import '@git-diff-view/vue/styles/diff-view.css'

const appStore = useAppStore()
const { t } = useI18n()

const diffData = computed(() => appStore.toolDiffData)

const isActionCompleted = computed(() => diffData.value?.actionCompleted === true)

const fileName = computed(() => {
  const fp = diffData.value?.filePath || ''
  return fp.split(/[\\/]/).pop() || fp
})

const isMarkdownFile = computed(() => {
  const data = diffData.value
  if (!data) return false
  if (data.language === 'markdown') return true
  const fp = data.filePath || ''
  return /\.(md|markdown|mdx)$/i.test(fp)
})

const hasActions = computed(() => {
  const data = diffData.value
  if (!data) return false
  if (data.actionCompleted) return false
  return data.type === 'edit' || data.type === 'write'
})

// 视图模式切换
const viewMode = vueRef<DiffModeEnum>(DiffModeEnum.Unified)

function toggleViewMode() {
  viewMode.value = viewMode.value === DiffModeEnum.Unified ? DiffModeEnum.Split : DiffModeEnum.Unified
}

const stats = computed(() => {
  const data = diffData.value
  if (!data || !data.originalContent || !data.modifiedContent) {
    return { additions: 0, deletions: 0 }
  }

  const oldLines = data.originalContent.split('\n').filter(l => l.trim()).length
  const newLines = data.modifiedContent.split('\n').filter(l => l.trim()).length

  return {
    additions: Math.max(0, newLines - oldLines),
    deletions: Math.max(0, oldLines - newLines)
  }
})

// Normalize line endings to LF before diffing. Git stores files with LF,
// but on Windows `api.readFile` reads CRLF from the working tree, which
// would otherwise make every line look changed.
function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

// 创建 DiffFile 实例（用于 DiffView 组件）
const diffFile = computed(() => {
  const data = diffData.value
  if (!data) return null
  if (data.type !== 'edit' && data.type !== 'write') return null
  // Need at least the modified content; allow empty original for new files.
  if (data.modifiedContent === undefined || data.modifiedContent === null) return null

  const oldContent = normalizeEol(data.originalContent || '')
  const newContent = normalizeEol(data.modifiedContent)
  if (oldContent === newContent) return null

  const fName = fileName.value || 'file'

  // 使用 generateDiffFile 自动比较两个文件内容并生成 diff
  const file = generateDiffFile(
    `${fName}.old`,
    oldContent,
    `${fName}.new`,
    newContent,
    data.language || 'text',
    data.language || 'text'
  )

  // 根据当前主题初始化
  const isDarkTheme = document.documentElement.getAttribute('data-theme')?.includes('dark')
  file.initTheme(isDarkTheme ? 'dark' : 'light')
  file.init()

  // 根据当前视图模式构建 diff 行
  if (viewMode.value === DiffModeEnum.Unified) {
    file.buildUnifiedDiffLines()
    // 展开全部隐藏行，以 Cursor 风格显示完整文件 + 行内 diff
    file.onAllExpand('unified')
  } else {
    file.buildSplitDiffLines()
    file.onAllExpand('split')
  }

  return file
})

// 监听视图模式变化，重新构建 diff 行
watch(viewMode, () => {
  if (diffFile.value) {
    if (viewMode.value === DiffModeEnum.Unified) {
      diffFile.value.buildUnifiedDiffLines()
      diffFile.value.onAllExpand('unified')
    } else {
      diffFile.value.buildSplitDiffLines()
      diffFile.value.onAllExpand('split')
    }
  }
})

const highlightedCode = computed(() => {
  const data = diffData.value
  if (!data) return ''
  if (data.type !== 'read' && data.type !== 'write' && data.type !== 'edit') return ''
  if (!isActionCompleted.value && data.type !== 'read') return ''
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

// 当 diff 不可用（例如 originalContent === modifiedContent）时，
// 直接以当前文件内容做语法高亮做兜底展示。
const fallbackHighlightedCode = computed(() => {
  const data = diffData.value
  if (!data) return ''
  const content = data.modifiedContent || ''
  try {
    const language = data.language
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value
    }
    return hljs.highlightAuto(content).value
  } catch {
    return escapeHtml(content)
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
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0; /* 关键：允许 flex 子元素收缩 */
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-default);
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
  border: 1px solid var(--border-default);
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
  min-height: 0; /* 关键：允许在 flex 容器中正确收缩 */
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

  &.markdown-content {
    font-family: inherit;
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
}

/* Git Diff View 样式 */
.git-diff-full-height {
  display: flex;
  flex-direction: column;
  flex: 1; /* 关键：填充剩余空间 */
  min-height: 0; /* 关键：允许收缩 */
}

.git-diff-container {
  flex: 1;
  overflow-y: auto;
  min-height: 0; /* 关键：确保高度正确传递给 DiffView */

  /* 覆盖默认样式以匹配当前主题 */
  --gdc-bg-color: var(--gdc-bg-color, #0d1117);
  --gdc-text-color: var(--gdc-text-color, #c9d1d9);
  --gdc-border-color: var(--gdc-border-color, #30363d);

  /* 添加行 */
  --gdc-add-bg-color: var(--gdc-add-bg-color, rgba(46, 160, 67, 0.15));
  --gdc-add-text-color: var(--gdc-add-text-color, #3fb950);
  --gdc-add-gutter-bg-color: var(--gdc-add-gutter-bg-color, rgba(46, 160, 67, 0.25));

  /* 删除行 */
  --gdc-remove-bg-color: var(--gdc-remove-bg-color, rgba(248, 81, 73, 0.15));
  --gdc-remove-text-color: var(--gdc-remove-text-color, #f85149);
  --gdc-remove-gutter-bg-color: var(--gdc-remove-gutter-bg-color, rgba(248, 81, 73, 0.25));

  /* Gutter */
  --gdc-gutter-bg-color: var(--gdc-gutter-bg-color, #161b22);
  --gdc-gutter-text-color: var(--gdc-gutter-text-color, #6e7681);

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

/* 视图模式切换按钮 */
.view-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-color: var(--accent-color);
  }
}

.grep-results {
  padding: 8px 0;
}

.empty-diff-notice {
  padding: 8px 12px;
  font-size: 11px;
  font-family: var(--font-body);
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-default);
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
