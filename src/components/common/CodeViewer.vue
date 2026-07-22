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
        :title="t('infoPanel.preview')"
      >
        <Eye :size="14" />
        <span>{{ t('infoPanel.preview') }}</span>
      </button>
      <button
        v-if="isHtmlFile"
        class="preview-btn"
        @click="previewHtml"
        :title="t('infoPanel.previewHtml')"
      >
        <Eye :size="14" />
        <span>{{ t('infoPanel.previewHtml') }}</span>
      </button>
      <button
        class="search-toggle-btn"
        @click="toggleSearch"
        :title="t('codeViewer.search') + ' (Ctrl+F)'"
      >
        <Search :size="14" />
      </button>
    </div>

    <!-- Search bar -->
    <div v-if="showSearch" class="search-bar">
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        :placeholder="t('codeViewer.searchPlaceholder')"
        class="search-input"
        type="text"
        spellcheck="false"
        @keydown.enter="onSearchEnter($event)"
        @keydown.escape="closeSearch"
        @keydown.f3.prevent="nextMatch"
      />
      <button
        class="case-toggle-btn"
        :class="{ active: searchCaseSensitive }"
        @click="toggleCaseSensitive"
        :title="t('codeViewer.caseSensitive')"
      >Aa</button>
      <button
        class="search-nav-btn"
        @click="prevMatch"
        :disabled="matchCount === 0"
        :title="t('codeViewer.previousMatch') + ' (Shift+Enter)'"
      >
        <ChevronUp :size="14" />
      </button>
      <button
        class="search-nav-btn"
        @click="nextMatch"
        :disabled="matchCount === 0"
        :title="t('codeViewer.nextMatch') + ' (Enter)'"
      >
        <ChevronDown :size="14" />
      </button>
      <span class="match-info">
        {{ matchCount === 0
          ? t('codeViewer.noResults')
          : `${currentMatchIndex + 1}/${matchCount}` }}
      </span>
      <button
        class="search-close-btn"
        @click="closeSearch"
        :title="t('codeViewer.closeSearch')"
      >
        <X :size="14" />
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
        <pre class="code-content"><code ref="codeElRef" :class="`language-${appStore.currentFile.language}`" v-html="highlightedCode"></code></pre>
      </div>
    </div>
    <div class="empty-state" v-else>
      <FileCode :size="48" />
      <p>Select a file to view its content</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, markRaw, onMounted, onBeforeUnmount } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { FileCode, Eye, FileText, Search, ChevronUp, ChevronDown, X } from 'lucide-vue-next'
import hljs from 'highlight.js'

const appStore = useAppStore()
const { t } = useI18n()
const codeContainer = ref<HTMLElement | null>(null)
const codeElRef = ref<HTMLElement | null>(null)
const lineRefs = new Map<number, HTMLElement>()

// ── 搜索状态 ──────────────────────────────────────────────────────
const showSearch = ref(false)
const searchQuery = ref('')
const searchCaseSensitive = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
/** 所有匹配的 <mark> DOM 元素 */
let matchElements: HTMLElement[] = []
/** 当前选中的匹配索引 */
const currentMatchIndex = ref(0)
/** 匹配总数（响应式，用于模板显示） */
const matchCount = ref(0)

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

const isHtmlFile = computed(() => {
  return appStore.currentFile?.language === 'html'
})

/** 在右侧 webview 面板中以渲染后的 HTML 预览文件（复用 openFileInWebview） */
function previewHtml() {
  const filePath = appStore.currentFile?.path
  if (filePath) {
    appStore.openFileInWebview(filePath)
  }
}

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

// ── 代码搜索逻辑 ──────────────────────────────────────────────────

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 清除所有搜索高亮 */
function clearHighlights() {
  const codeEl = codeElRef.value
  if (!codeEl) return
  const marks = codeEl.querySelectorAll('mark.search-match')
  marks.forEach(mark => {
    const parent = mark.parentElement
    if (!parent) return
    // 将 mark 的文本内容还原为普通文本节点
    const text = document.createTextNode(mark.textContent || '')
    parent.replaceChild(text, mark)
    // 合并相邻的文本节点
    parent.normalize()
  })
  matchElements = []
  matchCount.value = 0
  currentMatchIndex.value = 0
}

/** 执行搜索并高亮匹配项 */
function performSearch() {
  clearHighlights()
  const query = searchQuery.value.trim()
  if (!query || !codeElRef.value) return

  const escaped = escapeRegExp(query)
  const flags = searchCaseSensitive.value ? 'g' : 'gi'
  const regex = new RegExp(escaped, flags)

  // 使用 TreeWalker 遍历所有文本节点（跳过已有的 mark 元素）
  const walker = document.createTreeWalker(codeElRef.value, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      // 跳过 mark 元素内的文本
      if (parent.tagName === 'MARK' && parent.classList.contains('search-match')) {
        return NodeFilter.FILTER_REJECT
      }
      // 跳过空文本节点
      if (!node.textContent) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) {
    textNodes.push(n as Text)
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || ''
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    const fragments: Node[] = []
    let lastIndex = 0
    let hasMatch = false

    while ((match = regex.exec(text)) !== null) {
      hasMatch = true
      // 匹配前的普通文本
      if (match.index > lastIndex) {
        fragments.push(document.createTextNode(text.slice(lastIndex, match.index)))
      }
      // 匹配的文本 → mark 元素
      const mark = document.createElement('mark')
      mark.className = 'search-match'
      mark.textContent = match[0]
      fragments.push(mark)
      matchElements.push(mark)
      lastIndex = match.index + match[0].length
      // 防止零宽匹配导致死循环
      if (match[0].length === 0) regex.lastIndex++
    }

    if (hasMatch) {
      // 匹配后的剩余文本
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.slice(lastIndex)))
      }
      // 用片段替换原文本节点
      const parent = textNode.parentElement
      if (parent) {
        const frag = document.createDocumentFragment()
        for (const f of fragments) frag.appendChild(f)
        parent.replaceChild(frag, textNode)
      }
    }
  }

  matchCount.value = matchElements.length
  currentMatchIndex.value = 0
  if (matchElements.length > 0) {
    highlightCurrentMatch()
  }
}

/** 高亮当前选中项并滚动到视口 */
function highlightCurrentMatch() {
  matchElements.forEach((el, i) => {
    el.classList.toggle('current', i === currentMatchIndex.value)
  })
  const current = matchElements[currentMatchIndex.value]
  if (current && codeContainer.value) {
    current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

function nextMatch() {
  if (matchElements.length === 0) return
  currentMatchIndex.value = (currentMatchIndex.value + 1) % matchElements.length
  highlightCurrentMatch()
}

function prevMatch() {
  if (matchElements.length === 0) return
  currentMatchIndex.value = (currentMatchIndex.value - 1 + matchElements.length) % matchElements.length
  highlightCurrentMatch()
}

function onSearchEnter(e: KeyboardEvent) {
  if (e.shiftKey) {
    prevMatch()
  } else {
    nextMatch()
  }
}

function toggleSearch() {
  showSearch.value = !showSearch.value
  if (showSearch.value) {
    nextTick(() => {
      searchInputRef.value?.focus()
      searchInputRef.value?.select()
    })
  } else {
    clearHighlights()
    searchQuery.value = ''
  }
}

function closeSearch() {
  showSearch.value = false
  clearHighlights()
  searchQuery.value = ''
}

function toggleCaseSensitive() {
  searchCaseSensitive.value = !searchCaseSensitive.value
  // 重新搜索
  nextTick(() => performSearch())
}

// 搜索输入变化时重新搜索（防抖）
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    if (showSearch.value) performSearch()
  }, 200)
})

// 代码内容变化时重新搜索（v-html 重渲染后 DOM 重建）
watch(highlightedCode, () => {
  if (showSearch.value && searchQuery.value) {
    nextTick(() => performSearch())
  } else if (showSearch.value) {
    // 文件切换时清空搜索
    clearHighlights()
  }
})

// 文件切换时关闭搜索
watch(() => appStore.currentFile?.path, () => {
  if (showSearch.value) {
    closeSearch()
  }
})

// ── 键盘快捷键 ────────────────────────────────────────────────────

function onGlobalKeydown(e: KeyboardEvent) {
  // Ctrl+F / Cmd+F → 打开搜索
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey && !e.altKey) {
    // 如果焦点已在搜索输入框中，不重复拦截
    if (document.activeElement === searchInputRef.value) {
      e.preventDefault()
      return
    }
    // 仅在 CodeViewer 可见时拦截
    if (appStore.currentFile) {
      e.preventDefault()
      e.stopPropagation()
      if (!showSearch.value) {
        showSearch.value = true
        nextTick(() => {
          searchInputRef.value?.focus()
          searchInputRef.value?.select()
        })
      } else {
        searchInputRef.value?.focus()
        searchInputRef.value?.select()
      }
    }
  }
  // F3 / Shift+F3 → 上一个/下一个
  if (e.key === 'F3' && showSearch.value) {
    e.preventDefault()
    if (e.shiftKey) prevMatch()
    else nextMatch()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown, true)
  if (searchDebounce) clearTimeout(searchDebounce)
})
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

  .search-toggle-btn {
    @include reset-button;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    background: transparent;
    transition: all 0.15s;

    &:hover {
      background: var(--surface-glass-hover);
      color: var(--accent-primary);
    }
  }
}

// ── 搜索栏样式 ────────────────────────────────────────────────────
.search-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;

  .search-input {
    flex: 1;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: var(--font-mono);
    outline: none;
    transition: border-color 0.15s ease;

    &::placeholder {
      color: var(--text-muted);
      opacity: 0.6;
    }

    &:focus {
      border-color: var(--accent-primary);
    }
  }

  .case-toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }

    &.active {
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.15);
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }
  }

  .search-nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover:not(:disabled) {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }

    &:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
  }

  .match-info {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    min-width: 60px;
    text-align: center;
    flex-shrink: 0;
  }

  .search-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: var(--error-bg, rgba(239, 68, 68, 0.1));
      color: var(--error, #ef4444);
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
    font-family: var(--font-mono);
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
/* highlight.js 主题（全局，非 scoped） */
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

/* ── 搜索高亮样式（全局，需作用于 v-html 注入的 mark 元素） ── */
mark.search-match {
  background: rgba(255, 213, 79, 0.35);
  color: inherit;
  border-radius: 2px;
  padding: 0;

  &.current {
    background: rgba(255, 165, 0, 0.6);
    outline: 1px solid rgba(255, 165, 0, 0.8);
  }
}
</style>
