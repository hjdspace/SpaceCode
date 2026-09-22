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
      <button
        v-if="isEditableFile"
        class="search-toggle-btn"
        :class="{ 'edit-active': isEditing }"
        @click="toggleEditing"
        :title="isEditing ? t('codeViewer.exitEdit') : t('codeViewer.editFile')"
      >
        <Pencil :size="14" />
      </button>
      <button
        v-if="isEditing"
        class="search-toggle-btn save-btn"
        :class="{ 'has-unsaved': hasUnsavedChanges }"
        :disabled="!hasUnsavedChanges"
        @click="saveFile"
        :title="t('codeViewer.saveFile') + ' (Ctrl+S)'"
      >
        <Save :size="14" />
      </button>
      <span v-if="isEditing && hasUnsavedChanges" class="unsaved-dot" :title="t('codeViewer.unsavedChanges')">●</span>
      <button
        class="search-toggle-btn"
        :disabled="!canCopy"
        @click="copyContent"
        :title="copyButtonTitle"
      >
        <Check v-if="copySucceeded" :size="14" class="copy-check" />
        <Copy v-else :size="14" />
      </button>
      <button
        class="search-toggle-btn"
        @click="toggleFullscreen"
        :title="isFullscreen ? t('codeViewer.exitFullscreen') : t('codeViewer.enterFullscreen')"
      >
        <Minimize2 v-if="isFullscreen" :size="14" />
        <Maximize2 v-else :size="14" />
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

    <!-- Virtual scroll container -->
    <div
      class="code-container"
      ref="codeContainer"
      v-if="appStore.currentFile && !isEditing"
      @scroll="onScroll"
    >
      <div class="code-with-lines" :style="{ height: totalHeight + 'px', position: 'relative' }">
        <!-- Line numbers column -->
        <div class="line-numbers" :style="{ position: 'absolute', top: 0, left: 0, bottom: 0, width: lineNumberWidth + 'px' }">
          <div :style="{ transform: `translateY(${offsetY}px)` }">
            <div
              v-for="lineNum in visibleLineNumbers"
              :key="lineNum"
              class="line-number"
              :class="{ 'current-line': isLineHighlighted(lineNum) }"
              :ref="el => registerLineRef(lineNum, el as HTMLElement | null)"
            >{{ lineNum }}</div>
          </div>
        </div>
        <!-- Code content area -->
        <pre class="code-content" :style="{ marginLeft: lineNumberWidth + 'px', position: 'absolute', top: 0, left: 0, right: 0 }"><code ref="codeElRef" :class="`language-${appStore.currentFile.language}`"><div :style="{ height: offsetY + 'px' }"></div><div v-for="item in visibleRenderItems" :key="item.key" class="code-line" v-html="item.html"></div><div :style="{ height: bottomSpacerHeight + 'px' }"></div></code></pre>
      </div>
    </div>
    <!-- Edit mode: transparent textarea layered over highlighted code -->
    <div class="edit-container" v-else-if="appStore.currentFile && isEditing">
      <pre class="edit-highlight" ref="editHighlightRef" aria-hidden="true"><code v-html="editHighlightedHtml"></code></pre>
      <textarea
        ref="editTextareaRef"
        v-model="editDraft"
        class="edit-textarea"
        :spellcheck="false"
        wrap="off"
        @scroll="syncEditScroll"
        @compositionstart="editComposing = true"
        @compositionend="editComposing = false"
        @input="onEditInput"
        @keydown="onEditKeydown"
      ></textarea>
    </div>
    <div class="empty-state" v-if="!appStore.currentFile">
      <FileCode :size="48" />
      <p>Select a file to view its content</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, markRaw, onMounted, onBeforeUnmount } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { FileCode, Eye, FileText, Search, ChevronUp, ChevronDown, X, Pencil, Save, Copy, Check, Minimize2, Maximize2 } from 'lucide-vue-next'
import hljs from 'highlight.js'
import { registerSelectionHost } from '@/composables/useSelectionActions'
import { useDialog } from '@/composables/useDialog'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'
import { api } from '@/services/electronAPI'
import { isBinaryFilePath } from '@/utils/binaryFile'

// ── 常量 ──────────────────────────────────────────────────────────
const LINE_HEIGHT = 21.6 // px, matches CSS line-height: 1.6 * 13px font
const LINE_PADDING = 16 // px, top padding of code/line-number area
const OVERSCAN = 5 // extra lines rendered above/below viewport
const BASE_LINE_NUMBER_WIDTH = 60 // px, minimum width of line numbers column

/** 超过此字符数的行被视为"超长行"，需要水平虚拟滚动 */
const MAX_LINE_RENDER_CHARS = 2000

/** 文件内容总字符数超过此值时跳过语法高亮，纯文本渲染（防主线程阻塞） */
const MAX_HIGHLIGHT_CHARS = 200_000

const appStore = useAppStore()
const { t } = useI18n()
const { showConfirm } = useDialog()
const codeContainer = ref<HTMLElement | null>(null)
const codeElRef = ref<HTMLElement | null>(null)
const lineRefs = new Map<number, HTMLElement>()

// ── 全屏 / 复制 / 编辑状态 ──────────────────────────────────────────
const isFullscreen = computed(() => appStore.infoPanelFullscreen)

function toggleFullscreen() {
  appStore.toggleInfoPanelFullscreen()
}

const isBinaryFile = computed(() => {
  const path = appStore.currentFile?.path
  return path ? isBinaryFilePath(path) : false
})

const canCopy = computed(() => !!appStore.currentFile && !isBinaryFile.value)

const copyButtonTitle = computed(() => {
  if (isBinaryFile.value) return t('codeViewer.copyDisabledBinary')
  return t('codeViewer.copyContent')
})

const copySucceeded = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null

async function copyContent() {
  const content = appStore.currentFile?.content
  if (!content || isBinaryFile.value) return
  try {
    await navigator.clipboard.writeText(content)
    copySucceeded.value = true
    if (copyResetTimer) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
      copySucceeded.value = false
      copyResetTimer = null
    }, 1500)
  } catch (err) {
    errorHandler.pushToast({
      id: crypto.randomUUID(),
      category: ErrorCategory.UNKNOWN,
      title: t('codeViewer.copyFailedTitle'),
      message: err instanceof Error ? err.message : String(err),
      autoDismiss: true,
      dismissAfter: 4000,
      createdAt: Date.now(),
    })
  }
}

// ── 编辑模式 ────────────────────────────────────────────────────────
const isEditing = ref(false)
const editDraft = ref('')
const editTextareaRef = ref<HTMLTextAreaElement | null>(null)
const editHighlightRef = ref<HTMLElement | null>(null)
const savedContent = ref('')

/** 编辑态高亮：与查看态共用逐行高亮缓存（editDraft 为空时返回空串） */
const editHighlightedHtml = computed<string>(() => {
  if (!editDraft.value) return ''
  const lang = appStore.currentFile?.language || ''
  const lines = editDraft.value.split('\n')
  return lines.map((line, i) => highlightLine(line, lang, i, 0, line.length)).join('\n')
})

function syncEditScroll() {
  const ta = editTextareaRef.value
  const pre = editHighlightRef.value
  if (!ta || !pre) return
  pre.scrollTop = ta.scrollTop
  pre.scrollLeft = ta.scrollLeft
}

// IME 组合期间 v-model 不更新，直接把 textarea 当前值（含组合文本）渲染进高亮层，避免"隐形输入"
const editComposing = ref(false)

function onEditInput() {
  if (!editComposing.value) return
  const ta = editTextareaRef.value
  const pre = editHighlightRef.value
  if (!ta || !pre) return
  const codeEl = pre.querySelector('code')
  if (codeEl) codeEl.textContent = ta.value
}

const isEditableFile = computed(() => !!appStore.currentFile && !isBinaryFile.value)

const hasUnsavedChanges = computed(() => isEditing.value && editDraft.value !== savedContent.value)

// 脏状态同步到 store，供 InfoPanelTabBar 关闭 tab/面板时守卫
watch(hasUnsavedChanges, (dirty) => {
  if (dirty && appStore.currentFile) {
    appStore.setFileEditDirtyPath(appStore.currentFile.path)
  } else if (!dirty && appStore.fileEditDirtyPath) {
    const currentPath = appStore.currentFile?.path
    if (!currentPath || currentPath === appStore.fileEditDirtyPath) {
      appStore.setFileEditDirtyPath(null)
    }
  }
})

function toggleEditing() {
  if (isEditing.value) {
    void exitEditing()
  } else {
    if (!appStore.currentFile) return
    editDraft.value = appStore.currentFile.content
    savedContent.value = appStore.currentFile.content
    isEditing.value = true
    if (showSearch.value) closeSearch()
  }
}

async function exitEditing(): Promise<boolean> {
  if (hasUnsavedChanges.value) {
    const confirmed = await showConfirm(t('codeViewer.discardChangesConfirm'), {
      title: t('codeViewer.unsavedChanges'),
      confirmText: t('codeViewer.discardChanges'),
      cancelText: t('common.cancel'),
      variant: 'warning',
    })
    if (!confirmed) return false
  }
  isEditing.value = false
  editDraft.value = ''
  savedContent.value = ''
  return true
}

async function saveFile(): Promise<boolean> {
  const file = appStore.currentFile
  if (!file || !isEditing.value) return false
  if (!api.writeFile) {
    errorHandler.pushToast({
      id: crypto.randomUUID(),
      category: ErrorCategory.UNKNOWN,
      title: t('codeViewer.saveFailedTitle'),
      message: t('codeViewer.saveNotAvailable'),
      autoDismiss: true,
      dismissAfter: 4000,
      createdAt: Date.now(),
    })
    return false
  }
  try {
    const result = await api.writeFile(file.path, editDraft.value)
    if (!result.success) {
      errorHandler.pushToast({
        id: crypto.randomUUID(),
        category: ErrorCategory.UNKNOWN,
        title: t('codeViewer.saveFailedTitle'),
        message: result.error || t('codeViewer.saveFailedMessage'),
        autoDismiss: true,
        dismissAfter: 5000,
        createdAt: Date.now(),
      })
      return false
    }
    savedContent.value = editDraft.value
    appStore.updateOpenFileContent(file.path, editDraft.value)
    return true
  } catch (err) {
    errorHandler.pushToast({
      id: crypto.randomUUID(),
      category: ErrorCategory.UNKNOWN,
      title: t('codeViewer.saveFailedTitle'),
      message: err instanceof Error ? err.message : String(err),
      autoDismiss: true,
      dismissAfter: 5000,
      createdAt: Date.now(),
    })
    return false
  }
}

function onEditKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    e.stopPropagation()
    void saveFile()
  }
}

// 切换文件时退出编辑（有未保存修改则确认），重置编辑状态
watch(() => appStore.currentFile?.path, async (newPath, oldPath) => {
  if (newPath === oldPath) return
  if (isEditing.value) {
    if (hasUnsavedChanges.value) {
      const confirmed = await showConfirm(t('codeViewer.discardChangesConfirm'), {
        title: t('codeViewer.unsavedChanges'),
        confirmText: t('codeViewer.discardChanges'),
        cancelText: t('common.cancel'),
        variant: 'warning',
      })
      if (!confirmed) {
        // 恢复激活的 tab，避免静默丢弃修改
        if (oldPath && appStore.currentFile?.path !== oldPath) {
          const prevTab = appStore.infoPanelTabs.find(t =>
            (t.type === 'file' || t.type === 'markdown') && (t.data as { path?: string })?.path === oldPath)
          if (prevTab) appStore.activeInfoTabId = prevTab.id
        }
        return
      }
      // 修改已放弃，清除脏标记
      appStore.setFileEditDirtyPath(null)
    }
    isEditing.value = false
    editDraft.value = ''
    savedContent.value = ''
  }
})

// ── 虚拟滚动状态 ────────────────────────────────────────────────────
const scrollTop = ref(0)
const scrollLeft = ref(0)
const viewportHeight = ref(600)
const viewportWidth = ref(800)

// ── 文件行数据 ──────────────────────────────────────────────────────
/** 文件所有行的原始文本（不含换行符） */
const allLines = computed<string[]>(() => {
  if (!appStore.currentFile) return []
  return appStore.currentFile.content.split('\n')
})

const totalLines = computed(() => allLines.value.length)
const totalHeight = computed(() => totalLines.value * LINE_HEIGHT + LINE_PADDING * 2)

const lineNumberWidth = computed(() => {
  const maxDigits = String(totalLines.value).length
  return Math.max(BASE_LINE_NUMBER_WIDTH, maxDigits * 8 + 24)
})

/** 是否跳过语法高亮（大文件降级） */
const skipHighlight = computed(() => {
  if (!appStore.currentFile) return true
  return appStore.currentFile.content.length > MAX_HIGHLIGHT_CHARS
})

/** 可见区域的起始行索引（0-based） */
const startIndex = computed(() => {
  const top = Math.max(0, scrollTop.value - LINE_PADDING - OVERSCAN * LINE_HEIGHT)
  return Math.floor(top / LINE_HEIGHT)
})

/** 可见区域的结束行索引（0-based, exclusive） */
const endIndex = computed(() => {
  const visibleCount = Math.ceil(viewportHeight.value / LINE_HEIGHT) + OVERSCAN * 2
  return Math.min(totalLines.value, startIndex.value + visibleCount)
})

/** 可见的行号列表（1-based） */
const visibleLineNumbers = computed(() => {
  const lines: number[] = []
  for (let i = startIndex.value; i < endIndex.value; i++) {
    lines.push(i + 1)
  }
  return lines
})

/** 上方占位高度 */
const offsetY = computed(() => startIndex.value * LINE_HEIGHT)
/** 下方占位高度 */
const bottomSpacerHeight = computed(() => {
  const rendered = endIndex.value - startIndex.value
  return Math.max(0, (totalLines.value - startIndex.value - rendered) * LINE_HEIGHT)
})

// ── 行渲染项 ──────────────────────────────────────────────────────
interface RenderItem {
  key: string
  html: string
}

/**
 * 可见行的渲染数据。对超长行做水平截断——只渲染从 scrollLeft 开始的
 * MAX_LINE_RENDER_CHARS 个字符，避免一次性把 772KB 内容塞入 DOM。
 */
const visibleRenderItems = computed<RenderItem[]>((): RenderItem[] => {
  if (!appStore.currentFile) return []
  const lang = appStore.currentFile.language
  const lines = allLines.value
  const result: RenderItem[] = []
  // 水平偏移（字符级），按字符等宽估算
  const charWidth = 7.8 // px per char for 13px monospace
  const charOffset = Math.max(0, Math.floor(scrollLeft.value / charWidth))
  const maxChars = Math.ceil(viewportWidth.value / charWidth) + MAX_LINE_RENDER_CHARS

  for (let i = startIndex.value; i < endIndex.value && i < lines.length; i++) {
    const raw = lines[i]
    // 超长行截断：只取可见区域附近的字符
    const truncated = raw.length > maxChars
      ? raw.slice(charOffset, charOffset + maxChars)
      : raw
    result.push({
      key: `${i}-${charOffset}`,
      html: highlightLine(truncated, lang, i, charOffset, raw.length)
    })
  }
  return result
})

// ── 逐行高亮缓存 ────────────────────────────────────────────────────
const lineHighlightCache = new Map<string, string>()

function highlightLine(
  line: string,
  language: string,
  lineIndex: number,
  charOffset: number,
  fullLength: number
): string {
  const cacheKey = `${lineIndex}:${charOffset}:${line.length}:${line}`
  const cached = lineHighlightCache.get(cacheKey)
  if (cached !== undefined) return cached

  let html: string
  // 大文件降级：跳过 hljs，直接转义
  if (skipHighlight.value) {
    html = escapeHtml(line)
  } else {
    try {
      if (line.length > MAX_LINE_RENDER_CHARS) {
        // 单行也超长就跳过高亮
        html = escapeHtml(line)
      } else if (language && hljs.getLanguage(language)) {
        html = hljs.highlight(line, { language }).value
      } else {
        html = escapeHtml(line)
      }
    } catch {
      html = escapeHtml(line)
    }
  }

  // 如果行被截断，加上省略标记
  if (fullLength > line.length) {
    const prefix = charOffset > 0 ? '…' : ''
    const suffix = (charOffset + line.length) < fullLength ? ' …' : ''
    html = prefix + html + suffix
  }

  // Cache with a size limit
  if (lineHighlightCache.size > 5000) {
    const firstKey = lineHighlightCache.keys().next().value
    if (firstKey !== undefined) lineHighlightCache.delete(firstKey)
  }
  lineHighlightCache.set(cacheKey, html)
  return html
}

function clearLineCache() {
  lineHighlightCache.clear()
}

// ── 滚动处理 ────────────────────────────────────────────────────────
let scrollRaf = 0
function onScroll() {
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(() => {
    const container = codeContainer.value
    if (!container) return
    scrollTop.value = container.scrollTop
    scrollLeft.value = container.scrollLeft
    viewportHeight.value = container.clientHeight
    viewportWidth.value = container.clientWidth - lineNumberWidth.value
  })
}

function updateViewport() {
  const container = codeContainer.value
  if (!container) return
  viewportHeight.value = container.clientHeight
  viewportWidth.value = Math.max(200, container.clientWidth - lineNumberWidth.value)
  scrollTop.value = container.scrollTop
  scrollLeft.value = container.scrollLeft
}

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

// ── 文件属性 ──────────────────────────────────────────────────────
const isMarkdownFile = computed(() => appStore.currentFile?.language === 'markdown')
const isHtmlFile = computed(() => appStore.currentFile?.language === 'html')

function previewHtml() {
  const filePath = appStore.currentFile?.path
  if (filePath) appStore.openFileInWebview(filePath)
}

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ── 行滚动与闪烁 ──────────────────────────────────────────────────
function scrollToLine(lineNumber: number) {
  nextTick(() => {
    const container = codeContainer.value
    if (!container) return
    const targetTop = (lineNumber - 1) * LINE_HEIGHT - container.clientHeight / 3
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
    setTimeout(() => onScroll(), 100)
  })
}

const LINE_FLASH_MS = 1600
let flashTimer: ReturnType<typeof setTimeout> | null = null

function flashLines(start: number, end: number) {
  nextTick(() => {
    if (flashTimer) clearTimeout(flashTimer)
    lineRefs.forEach(el => el.classList.remove('line-flash'))
    const flashed: HTMLElement[] = []
    for (let n = start; n <= end; n++) {
      const el = lineRefs.get(n)
      if (el) {
        el.classList.add('line-flash')
        flashed.push(el)
      }
    }
    if (flashed.length === 0) return
    flashTimer = setTimeout(() => {
      flashed.forEach(el => el.classList.remove('line-flash'))
      flashTimer = null
    }, LINE_FLASH_MS)
  })
}

watch(
  () => [appStore.currentFile?.path, appStore.currentLine, appStore.currentEndLine],
  ([, line, endLine]) => {
    const start = line as number
    if (start > 0) {
      scrollToLine(start)
      const end = (endLine as number) >= start ? (endLine as number) : start
      flashLines(start, end)
    }
  },
  { immediate: true }
)

// ── 选中文字浮动操作条 ────────────────────────────────────────────
/** 行内字符偏移: TreeWalker 累加文本节点长度(同 performSearch 技术) */
function charOffsetInLine(lineEl: HTMLElement, node: Node, offset: number): number {
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
  let count = 0
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (n === node) return count + offset
    count += (n.textContent || '').length
  }
  return count
}

/** 将 DOM 选区映射为源文件中的绝对偏移; 超长截断行返回 null(交由字符串回退定位) */
function getSelectionInfo(): { absStart: number; absEnd: number; text: string; startLine: number; endLine: number } | null {
  const sel = window.getSelection()
  const codeEl = codeElRef.value
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !codeEl || !appStore.currentFile) return null
  const range = sel.getRangeAt(0)
  if (!codeEl.contains(range.commonAncestorContainer)) return null

  const lineEls = Array.from(codeEl.querySelectorAll('.code-line'))
  const startLineEl = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest('.code-line')
  const endLineEl = (range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement)?.closest('.code-line')
  if (!startLineEl || !endLineEl) return null
  const startIdx = lineEls.indexOf(startLineEl as HTMLElement)
  const endIdx = lineEls.indexOf(endLineEl as HTMLElement)
  if (startIdx < 0 || endIdx < 0) return null

  const startLine = startIndex.value + startIdx + 1 // 1-based
  const endLine = startIndex.value + endIdx + 1
  const lines = allLines.value
  if (startLine > lines.length || endLine > lines.length) return null
  // 超长截断行: DOM 文本 ≠ 原始行文本, 无法精确映射
  if (lines[startLine - 1].length > MAX_LINE_RENDER_CHARS || lines[endLine - 1].length > MAX_LINE_RENDER_CHARS) return null

  const startChar = charOffsetInLine(startLineEl as HTMLElement, range.startContainer, range.startOffset)
  const endChar = charOffsetInLine(endLineEl as HTMLElement, range.endContainer, range.endOffset)
  const absStart = lines.slice(0, startLine - 1).reduce((sum, l) => sum + l.length + 1, 0) + startChar
  const absEnd = lines.slice(0, endLine - 1).reduce((sum, l) => sum + l.length + 1, 0) + endChar
  if (absEnd <= absStart) return null
  return { absStart, absEnd, text: appStore.currentFile.content.slice(absStart, absEnd), startLine, endLine }
}

function flashRange(startLine: number, endLine: number) {
  flashLines(startLine, endLine)
}

let unregisterSelectionHost: (() => void) | undefined
onMounted(() => {
  if (codeContainer.value) {
    unregisterSelectionHost = registerSelectionHost(codeContainer.value, {
      context: 'file',
      getSelectionInfo,
      flashRange,
    })
  }
})

// ── 代码搜索逻辑 ──────────────────────────────────────────────────
const showSearch = ref(false)
const searchQuery = ref('')
const searchCaseSensitive = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
let matchElements: HTMLElement[] = []
const currentMatchIndex = ref(0)
const matchCount = ref(0)

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function clearHighlights() {
  const codeEl = codeElRef.value
  if (!codeEl) return
  const marks = codeEl.querySelectorAll('mark.search-match')
  marks.forEach(mark => {
    const parent = mark.parentElement
    if (!parent) return
    const text = document.createTextNode(mark.textContent || '')
    parent.replaceChild(text, mark)
    parent.normalize()
  })
  matchElements = []
  matchCount.value = 0
  currentMatchIndex.value = 0
}

function performSearch() {
  clearHighlights()
  const query = searchQuery.value.trim()
  if (!query || !codeElRef.value) return

  const escaped = escapeRegExp(query)
  const flags = searchCaseSensitive.value ? 'g' : 'gi'
  const regex = new RegExp(escaped, flags)

  const walker = document.createTreeWalker(codeElRef.value, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.tagName === 'MARK' && parent.classList.contains('search-match')) {
        return NodeFilter.FILTER_REJECT
      }
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
      if (match.index > lastIndex) {
        fragments.push(document.createTextNode(text.slice(lastIndex, match.index)))
      }
      const mark = document.createElement('mark')
      mark.className = 'search-match'
      mark.textContent = match[0]
      fragments.push(mark)
      matchElements.push(mark)
      lastIndex = match.index + match[0].length
      if (match[0].length === 0) regex.lastIndex++
    }

    if (hasMatch) {
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.slice(lastIndex)))
      }
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

function highlightCurrentMatch() {
  matchElements.forEach((el, i) => {
    el.classList.toggle('current', i === currentMatchIndex.value)
  })
  const current = matchElements[currentMatchIndex.value]
  if (current && codeContainer.value) {
    current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setTimeout(() => onScroll(), 100)
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
  if (e.shiftKey) prevMatch()
  else nextMatch()
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
  nextTick(() => performSearch())
}

let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    if (showSearch.value) performSearch()
  }, 200)
})

let searchOnScrollDebounce: ReturnType<typeof setTimeout> | null = null
watch(scrollTop, () => {
  if (!showSearch.value || !searchQuery.value) return
  if (searchOnScrollDebounce) clearTimeout(searchOnScrollDebounce)
  searchOnScrollDebounce = setTimeout(() => {
    if (showSearch.value && searchQuery.value) performSearch()
  }, 300)
})

// 文件切换时关闭搜索 + 清理缓存 + 重置滚动; 内容被改写(选中内容原地替换)时也需清缓存
watch(() => [appStore.currentFile?.path, appStore.currentFile?.content], ([newPath], [oldPath]) => {
  if (newPath !== oldPath) {
    if (showSearch.value) closeSearch()
    scrollTop.value = 0
    scrollLeft.value = 0
    nextTick(() => {
      updateViewport()
      onScroll()
    })
  }
  clearLineCache()
})

// ── ResizeObserver ─────────────────────────────────────────────────
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown, true)
  if (codeContainer.value) {
    viewportHeight.value = codeContainer.value.clientHeight
    viewportWidth.value = Math.max(200, codeContainer.value.clientWidth - lineNumberWidth.value)
    // ResizeObserver may not exist in test (jsdom) environments
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateViewport())
      resizeObserver.observe(codeContainer.value)
    }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown, true)
  unregisterSelectionHost?.()
  if (searchDebounce) clearTimeout(searchDebounce)
  if (flashTimer) clearTimeout(flashTimer)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  if (searchOnScrollDebounce) clearTimeout(searchOnScrollDebounce)
  resizeObserver?.disconnect()
})

// ── 键盘快捷键 ────────────────────────────────────────────────────
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey && !e.altKey) {
    if (document.activeElement === searchInputRef.value) {
      e.preventDefault()
      return
    }
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
  if (e.key === 'F3' && showSearch.value) {
    e.preventDefault()
    if (e.shiftKey) prevMatch()
    else nextMatch()
  }
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

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;

      &:hover {
        background: transparent;
        color: var(--text-muted);
      }
    }

    &.edit-active {
      color: var(--accent-primary);
      background: var(--surface-glass-hover);
    }

    &.save-btn.has-unsaved {
      color: var(--accent-primary);
    }

    .copy-check {
      color: var(--success, #22c55e);
    }
  }

  .unsaved-dot {
    color: var(--accent-primary);
    font-size: 10px;
    line-height: 1;
    margin-left: -4px;
  }
}

.edit-container {
  flex: 1;
  position: relative;
  min-height: 0;
  background: var(--bg-primary);
}

.edit-highlight,
.edit-textarea {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 12px 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
  white-space: pre;
  @include scrollbar;
}

.edit-highlight {
  pointer-events: none;
  z-index: 0;
  /* 覆盖全局 pre 默认样式，保证与 textarea 像素对齐 */
  background: transparent;
  border: none;
  border-radius: 0;
  /* 滚动由 JS 同步自 textarea，自身不显示滚动条 */
  overflow: hidden;

  code {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    display: block;
    color: var(--text-primary);
  }
}

.edit-textarea {
  z-index: 1;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: var(--text-primary);
  overflow: auto;

  &::selection {
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.3);
  }
}

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
  position: relative;
}

.code-with-lines {
  display: block;
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
  overflow: hidden;

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

    &.line-flash {
      animation: line-flash-kf 1.5s ease-out;
      margin: 0 -12px;
      padding: 0 12px;
    }
  }
}

@keyframes line-flash-kf {
  0% {
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.38);
  }
  60% {
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.16);
  }
  100% {
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
  }
}

.code-content {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
  bottom: 0;

  code {
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre;
    color: var(--text-primary);
    display: block;
  }

  .code-line {
    height: 21.6px;
    white-space: pre;
    overflow: visible;
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
    font-size: var(--text-base);
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

/* ── 搜索高亮样式 ── */
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
