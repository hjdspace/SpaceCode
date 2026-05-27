# Tool Cards 增强实现计划：Unified Diff + 语法高亮

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 重构 EditToolCard 为 unified-diff 视图，并为 WriteToolCard 和 ReadToolCard 添加语法高亮支持

**架构：** 复用项目已有的 highlight.js 和 diff 库，参考 ToolDiffViewer.vue 的实现模式，在三个工具卡片组件内完成改造，不新增文件或依赖

**技术栈：** Vue 3 (Composition API) + TypeScript + highlight.js 11.9 + diff 5.2 + SCSS

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/components/chat/tools/EditToolCard.vue` | **重构** | 替换双代码块为 unified-diff 视图，添加 diff 算法 + 语法高亮 |
| `src/components/chat/tools/WriteToolCard.vue` | **增强** | 将纯文本预览替换为 highlight.js 高亮的 HTML |
| `src/components/chat/tools/ReadToolCard.vue` | **增强** | 将纯文本输出替换为 highlight.js 高亮的 HTML |

**参考文件**（只读，不修改）：
- `src/components/common/ToolDiffViewer.vue` - diff 行生成和高亮逻辑的参考实现
- `src/components/common/CodeViewer.vue` - highlight.js 基础用法参考

---

## 任务 1：重构 EditToolCard 为 Unified Diff 视图

**文件：**
- 修改：`src/components/chat/tools/EditToolCard.vue`

### 步骤 1.1：更新 script 部分 - 添加 diff 和高亮逻辑

替换 `<script setup>` 块中的内容：

```typescript
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
```

**验证点：**
- ✅ 导入了 `diff` 和 `hljs`
- ✅ 定义了 `DiffLine` 接口
- ✅ 实现了 `diffLines` computed 属性（生成结构化 diff 行）
- ✅ 实现了 `highlightedLines` computed 属性（缓存高亮结果）
- ✅ 实现了辅助函数：`highlightAndSplit`、`splitHtmlByNewlines`、`escapeHtml`
- ✅ 保留了原有的 `openInPanel` 功能

---

### 步骤 1.2：更新 template 部分 - 替换为 unified-diff 视图

替换 `<template>` 块中的 `.edit-body` 部分：

```vue
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
```

**关键变化：**
- ❌ 移除了两个独立的代码块（old/new）
- ✅ 新增 unified-diff 容器，遍历 `diffLines` 数组
- ✅ 每行显示：前缀 + 行号 + 高亮内容（v-html）
- ✅ 根据 `line.type` 动态添加 CSS 类（add/remove/context）
- ✅ 保留了 Result 输出区域

---

### 步骤 1.3：更新 style 部分 - 添加 unified-diff 样式

替换 `<style>` 块：

```scss
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
  &:hover { background: rgba(255,255,255,0.03); } 
}

.edit-icon-wrapper { 
  width: 22px; height: 22px; border-radius: 4px; 
  background: rgba(249, 115, 22, 0.12); color: #fb923c; 
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; 
}
.status-running .edit-icon-wrapper { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
.status-error .edit-icon-wrapper { background: rgba(239, 68, 68, 0.12); color: #f87171; }

.edit-label { 
  font-weight: 600; font-size: 11px; text-transform: uppercase; 
  letter-spacing: 0.5px; color: #fb923c; flex-shrink: 0; 
}

.edit-path { 
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; 
  font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary); 
}

.panel-btn { 
  display: flex; align-items: center; justify-content: center; 
  width: 22px; height: 22px; border-radius: 4px; border: none; 
  background: transparent; color: var(--text-tertiary); cursor: pointer; 
  flex-shrink: 0; transition: all 0.15s; 
  &:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); } 
}

.expand-icon { 
  color: var(--text-tertiary); transition: transform 0.15s; 
  &.is-expanded { transform: rotate(180deg); } 
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
    
    .line-prefix { color: #3fb950; }
  }
  
  &.remove {
    background: rgba(248, 81, 73, 0.15);
    border-left-color: #f85149;
    
    .line-prefix { color: #f85149; }
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
}

/* 继承 highlight.js 的语法高亮颜色 */
.line-content {
  :deep(.hljs) { color: inherit; background: transparent; }
  :deep(.hljs-comment), :deep(.hljs-quote) { color: #6a737d; font-style: italic; }
  :deep(.hljs-keyword), :deep(.hljs-selector-tag), :deep(.hljs-addition) { color: #ff7b72; }
  :deep(.hljs-number), :deep(.hljs-string), :deep(.hljs-meta .hljs-meta-string), :deep(.hljs-literal), :deep(.hljs-doctag), :deep(.hljs-regexp) { color: #a5d6ff; }
  :deep(.hljs-title), :deep(.hljs-section), :deep(.hljs-name), :deep(.hljs-selector-id), :deep(.hljs-selector-class) { color: #d2a8ff; }
  :deep(.hljs-attribute), :deep(.hljs-attr), :deep(.hljs-variable), :deep(.hljs-template-variable), :deep(.hljs-class .hljs-title), :deep(.hljs-type) { color: #79c0ff; }
  :deep(.hljs-symbol), :deep(.hljs-bullet), :deep(.hljs-subst), :deep(.hljs-meta), :deep(.hljs-selector-attr), :deep(.hljs-selector-pseudo), :deep(.hljs-link) { color: #79c0ff; }
  :deep(.hljs-built_in), :deep(.hljs-deletion) { color: #ffa657; }
  :deep(.hljs-formula) { background: #083254; color: #f8e71c; }
  :deep(.hljs-emphasis) { font-style: italic; }
  :deep(.hljs-strong) { font-weight: bold; }
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

.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
```

**验证点：**
- ✅ 添加了 `.unified-diff` 容器样式（暗色背景、可滚动）
- ✅ 添加了三种行类型样式（add 绿色 / remove 红色 / context 灰色）
- ✅ 左边框指示器（3px 宽）
- ✅ 行号和前缀固定宽度，user-select: none
- ✅ 使用 `:deep()` 穿透 scoped 样式应用 hljs 颜色主题
- ✅ 自定义滚动条样式（暗色主题风格）

---

## 任务 2：为 WriteToolCard 添加语法高亮

**文件：**
- 修改：`src/components/chat/tools/WriteToolCard.vue`

### 步骤 2.1：更新 script 部分 - 添加高亮逻辑

在 `<script setup>` 中添加 import 和 computed：

```typescript
// 在现有 import 后添加：
import hljs from 'highlight.js'

// 替换现有的 contentPreview computed：
const PREVIEW_MAX = 800
const rawPreview = computed(() => {
  const c = props.toolCall.input?.content || ''
  return c.length > PREVIEW_MAX ? c.slice(0, PREVIEW_MAX) : c
})

const highlightedPreview = computed(() => {
  const content = rawPreview.value
  if (!content) return ''
  
  const language = appStore.getLanguageFromPath(filePath.value)
  
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value
    }
    return hljs.highlightAuto(content).value
  } catch (error) {
    console.error('Highlight error:', error)
    return escapeHtml(content)
  }
})

const previewTruncated = computed(() => {
  const c = props.toolCall.input?.content || ''
  return c.length > PREVIEW_MAX
})

// 添加转义函数：
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
```

**关键变化：**
- 导入 `hljs`
- 新增 `rawPreview`（原始截断内容）
- 新增 `highlightedPreview`（高亮后的 HTML 字符串）
- 新增 `previewTruncated`（是否被截断）
- 添加 `escapeHtml` 函数（错误回退时使用）

---

### 步骤 2.2：更新 template 部分 - 使用 v-html 渲染高亮内容

替换 `.content-preview` 区域：

```vue
<div v-show="isExpanded" class="write-body">
  <div v-if="toolCall.input.content" class="content-preview">
    <div class="block-label">Content Preview</div>
    <pre class="code-block"><code v-html="highlightedPreview"></code></pre>
    <div v-if="previewTruncated" class="truncated-notice">
      ... (truncated, {{ (toolCall.input.content || '').length }} total chars)
    </div>
  </div>
  <div v-if="toolCall.output" class="result-block">
    <div class="block-label">Result</div>
    <pre class="code-block"><code>{{ toolCall.output }}</code></pre>
  </div>
</div>
```

**关键变化：**
- ❌ 移除 `<code>{{ contentPreview }}</code>`
- ✅ 使用 `<code v-html="highlightedPreview"></code>`
- ✅ 新增截断提示信息

---

### 步骤 2.3：更新 style 部分 - 添加高亮样式

在 `<style>` 中添加 hljs 主题样式（在 `.code-block` 规则后添加）：

```scss
/* 在 .code-block 规则后添加 */
.code-block {
  /* 保持现有样式 */
  
  /* 添加 highlight.js 主题 */
  :deep(.hljs) { color: #c9d1d9; background: transparent; }
  :deep(.hljs-comment), :deep(.hljs-quote) { color: #6a737d; font-style: italic; }
  :deep(.hljs-keyword), :deep(.hljs-selector-tag) { color: #ff7b72; }
  :deep(.hljs-string), :deep(.hljs-regexp) { color: #a5d6ff; }
  :deep(.hljs-title), :deep(.hljs-section), :deep(.hljs-name), :deep(.hljs-selector-id), :deep(.hljs-selector-class) { color: #d2a8ff; }
  :deep(.hljs-attribute), :deep(.hljs-attr), :deep(.hljs-variable), :deep(.hljs-template-variable), :deep(.hljs-class .hljs-title), :deep(.hljs-type) { color: #79c0ff; }
  :deep(.hljs-built_in) { color: #ffa657; }
  :deep(.hljs-literal) { color: #79c0ff; }
  :deep(.hljs-addition) { color: #aff5b4; }
  :deep(.hljs-deletion) { color: #ffd8d3; }
}

/* 截断提示样式 */
.truncated-notice {
  padding: 6px 12px;
  font-size: 11px;
  color: #6e7681;
  font-style: italic;
  text-align: center;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
```

---

## 任务 3：为 ReadToolCard 添加语法高亮

**文件：**
- 修改：`src/components/chat/tools/ReadToolCard.vue`

### 步骤 3.1：更新 script 部分 - 添加高亮逻辑

在 `<script setup>` 中添加：

```typescript
// 在现有 import 后添加：
import hljs from 'highlight.js'

// 添加新的 computed：
const highlightedOutput = computed(() => {
  const content = props.toolCall.output || ''
  if (!content) return '(empty file)'
  
  const language = appStore.getLanguageFromPath(filePath.value)
  
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value
    }
    return hljs.highlightAuto(content).value
  } catch (error) {
    console.error('Highlight error:', error)
    return escapeHtml(content)
  }
})

// 添加转义函数：
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
```

---

### 步骤 3.2：更新 template 部分 - 使用 v-html 渲染高亮内容

替换 `.read-body` 中的 `<pre>` 元素：

```vue
<div v-show="isExpanded" class="read-body">
  <div class="read-meta-row">
    <span class="meta-item" v-if="offset"><ArrowUp :size="11" /> Line {{ offset }}</span>
    <span class="meta-item" v-if="limit"><ArrowDown :size="11" /> {{ limit }} lines</span>
    <span class="meta-item"><FileOutput :size="11" /> {{ outputLines }} lines</span>
  </div>
  <pre class="code-content"><code v-html="highlightedOutput"></code></pre>
</div>
```

**关键变化：**
- ❌ 移除 `<code>{{ toolCall.output || '(empty file)' }}</code>`
- ✅ 使用 `<code v-html="highlightedOutput"></code>`

---

### 步骤 3.3：更新 style 部分 - 添加高亮样式

在 `.code-content` 规则后添加：

```scss
.code-content {
  /* 保持现有样式 */
  
  /* 添加 highlight.js 主题 */
  code {
    :deep(.hljs) { color: #f0f6fc; background: transparent; }
    :deep(.hljs-comment), :deep(.hljs-quote) { color: #6a737d; font-style: italic; }
    :deep(.hljs-keyword), :deep(.hljs-selector-tag) { color: #ff7b72; }
    :deep(.hljs-string), :deep(.hljs-regexp) { color: #a5d6ff; }
    :deep(.hljs-title), :deep(.hljs-section), :deep(.hljs-name), :deep(.hljs-selector-id), :deep(.hljs-selector-class) { color: #d2a8ff; }
    :deep(.hljs-attribute), :deep(.hljs-attr), :deep(.hljs-variable), :deep(.hljs-template-variable), :deep(.hljs-class .hljs-title), :deep(.hljs-type) { color: #79c0ff; }
    :deep(.hljs-built_in) { color: #ffa657; }
    :deep(.hljs-literal) { color: #79c0ff; }
    :deep(.hljs-number) { color: #79c0ff; }
    :deep(.hljs-function .hljs-title) { color: #d2a8ff; }
    :deep(.hljs-params) { color: #ffa657; }
  }
}
```

注意：ReadToolCard 的背景色是 `#0d1117`，文字色是 `#f0f6fc`（比 Edit/Write 更亮），所以 hljs 基础颜色需要调整以匹配。

---

## 任务 4：清理临时文件

**文件：**
- 删除：`diff-view-comparison.html`（头脑风暴阶段的视觉原型）

```bash
rm d:\AI\claude-code-gui\diff-view-comparison.html
```

---

## 任务 5：验证与测试

### 步骤 5.1：运行类型检查

```bash
npm run typecheck
```

预期：无类型错误

### 步骤 5.2：手动测试清单

#### EditToolCard 测试场景
- [ ] 场景 1：编辑一个 Vue 组件文件（应显示 diff + Vue 语法高亮）
  - 输入：old_string 包含 5 行 Vue 代码，new_string 包含修改后的 7 行
  - 预期：
    - 删除行显示红色背景 + `-` 前缀
    - 新增行显示绿色背景 + `+` 前缀
    - 上下文行显示灰色背景
    - 所有行都有正确的语法高亮（关键字、字符串、标签等）
    - 行号连续且正确
    
- [ ] 场景 2：单行修改（old 和 new 都只有一行）
  - 预期：显示 2 行（1 删除 + 1 新增），无上下文行
  
- [ ] 场景 3：新增内容（old_string 为空）
  - 预期：只显示绿色新增行，无红色删除行
  
- [ ] 场景 4：删除内容（new_string 为空）
  - 预期：只显示红色删除行，无绿色新增行
  
- [ ] 场景 5：大改动（>100 行）
  - 预期：容器最大高度 400px，可滚动，性能流畅
  
- [ ] 场景 6：未知语言类型的文件（如 .xyz）
  - 预期：使用 highlightAuto 自动检测，不报错

#### WriteToolCard 测试场景
- [ ] 场景 1：写入一个 TypeScript 文件
  - 预期：预览区显示 TS 语法高亮（interface、type、string 等）
  
- [ ] 场景 2：写入内容超过 800 字符
  - 预期：显示前 800 字符的高亮内容 + "... (truncated)" 提示
  
- [ ] 场景 3：写入空内容
  - 预期：不显示预览区或显示空状态
  
- [ ] 场景 4：写入 JSON 文件
  - 预期：JSON 键名和值有不同颜色

#### ReadToolCard 测试场景
- [ ] 场景 1：读取一个 Python 脚本
  - 预期：输出区显示 Python 语法高亮（def、class、import 等）
  
- [ ] 场景 2：读取空文件
  - 预期：显示 "(empty file)"
  
- [ ] 场景 3：读取带 offset 和 limit 参数
  - 预期：元信息正确显示（Line X, Y lines, Z lines output）

### 步骤 5.3：浏览器开发者工具检查

打开 DevTools Console，确认：
- [ ] 无 JavaScript 错误
- [ ] 无 XSS 警告（v-html 内容已正确转义）
- [ ] 控制台无 "Highlight error" 日志（正常情况下）

---

## 自检清单

### ✅ 规格覆盖度
- [x] EditToolCard 改造为 unified-diff → 任务 1
- [x] WriteToolCard 添加语法高亮 → 任务 2
- [x] ReadToolCard 添加语法高亮 → 任务 3
- [x] 性能优化（computed 缓存）→ 已在各任务的 script 中体现
- [x] 样式规范（暗色主题、颜色方案）→ 已在各任务的 style 中定义
- [x] 错误处理（语言检测失败回退）→ 已在 catch 块中处理
- [x] XSS 防护（escapeHtml 函数）→ 已在三个组件中分别实现

### ✅ 占位符扫描
- [x] 无 "待定"、"TODO"、"后续实现"
- [x] 无 "添加适当的错误处理"（已提供具体实现）
- [x] 无 "类似任务 X"（每个任务独立完整）
- [x] 所有步骤都包含具体代码

### ✅ 类型一致性
- [x] `DiffLine` 接口只在任务 1 中定义和使用
- [x] `escapeHtml` 函数签名在三个任务中一致
- [x] `highlightedPreview` / `highlightedOutput` / `highlightedLines` 命名清晰区分
- [x] CSS 类名（`.add` / `.remove` / `.context`）统一使用

---

## 执行顺序建议

**推荐执行顺序：** 任务 1 → 任务 2 → 任务 3 → 任务 4 → 任务 5

**理由：**
1. 任务 1 是最复杂的（核心改造），完成后可直接看到最大效果
2. 任务 2 和 3 结构相似，可以快速完成
3. 任务 4 清理工作最后做
4. 任务 5 验证所有改动

**预计总时间：** 30-45 分钟（含测试）
