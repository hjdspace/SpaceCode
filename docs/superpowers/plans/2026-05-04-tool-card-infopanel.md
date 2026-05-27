# Tool Card InfoPanel Integration 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 Edit/Write/Read/WebFetch/Grep 工具卡片添加可点击图标，点击后在右侧 InfoPanel 展示 diff/文件内容/搜索结果，并支持 Edit/Write 的接受/撤回操作。

**架构：** 扩展现有 InfoPanel 新增 `tool-diff` 模式，创建 `ToolDiffViewer.vue` 组件渲染 AI IDE 风格的内联 diff（红/绿高亮），通过 appStore 的 `toolDiffData` 状态传递数据，新增 `writeFile` IPC 支持撤回修改。

**技术栈：** Vue 3 + Pinia + `diff` 库（已安装 v5.2.0）+ Electron IPC

---

## 文件结构

| 文件 | 职责 | 变更类型 |
|------|------|---------|
| `electron/main.ts` | 新增 `fs:writeFile` IPC handler | 修改 |
| `electron/preload.ts` | 暴露 `writeFile` 到渲染进程 | 修改 |
| `src/services/electronAPI.ts` | 新增 `api.writeFile` 方法 | 修改 |
| `src/stores/app.ts` | 新增 `ToolDiffData` 接口、`toolDiffData` 状态、`showToolDiff` 方法 | 修改 |
| `src/components/common/ToolDiffViewer.vue` | 核心 diff 渲染组件 | 新建 |
| `src/components/layout/InfoPanel.vue` | 新增 `tool-diff` 模式分支 | 修改 |
| `src/components/chat/tools/EditToolCard.vue` | 添加打开面板按钮 | 修改 |
| `src/components/chat/tools/WriteToolCard.vue` | 添加打开面板按钮 | 修改 |
| `src/components/chat/tools/ReadToolCard.vue` | 添加打开面板按钮 | 修改 |
| `src/components/chat/tools/WebFetchToolCard.vue` | 添加打开面板按钮 | 修改 |
| `src/components/chat/tools/GrepToolCard.vue` | 添加打开面板按钮 | 修改 |
| `src/i18n/locales/zh-CN.ts` | 新增翻译 key | 修改 |
| `src/i18n/locales/en-US.ts` | 新增翻译 key | 修改 |

---

### 任务 1：新增 writeFile IPC

**文件：**
- 修改：`electron/main.ts:447`（在 `fs:readFile` handler 之后）
- 修改：`electron/preload.ts:38`（在 `readFile` 之后）
- 修改：`src/services/electronAPI.ts:18`（在 `readFile` 之后）

- [ ] **步骤 1：在 main.ts 添加 IPC handler**

在 `ipcMain.handle('fs:readFile', ...)` 之后添加：

```ts
ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  debug('IPC', 'fs:writeFile', { filePath })
  try {
    writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (err: any) {
    error('IPC', 'fs:writeFile failed', { filePath, err })
    return { success: false, error: err.message }
  }
})
```

- [ ] **步骤 2：在 preload.ts 暴露 writeFile**

在 `readFile` 行之后添加：

```ts
writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
  ipcRenderer.invoke('fs:writeFile', filePath, content),
```

- [ ] **步骤 3：在 electronAPI.ts 添加 writeFile 方法**

在 `readFile` 行之后添加：

```ts
writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
  electronAPI?.writeFile(filePath, content) || Promise.resolve({ success: false, error: 'writeFile not available' }),
```

- [ ] **步骤 4：验证编译**

运行：`npx vue-tsc --noEmit`
预期：无新增错误

---

### 任务 2：扩展 appStore

**文件：**
- 修改：`src/stores/app.ts`

- [ ] **步骤 1：添加 ToolDiffData 接口**

在 `FileInfo` 接口之后添加：

```ts
export interface ToolDiffData {
  type: 'edit' | 'write' | 'read' | 'webfetch' | 'grep'
  filePath: string
  originalContent: string
  modifiedContent: string
  toolCallId: string
  language: string
  displayContent?: string
  searchQuery?: string
}
```

- [ ] **步骤 2：在 store 内添加状态和方法**

在 `infoPanelMode` ref 之后添加：

```ts
const toolDiffData = ref<ToolDiffData | null>(null)
```

在 `showInfoPanel` 方法之后添加：

```ts
function showToolDiff(data: ToolDiffData) {
  toolDiffData.value = data
  infoPanelMode.value = 'tool-diff'
  infoPanelVisible.value = true
}
```

在 `hideInfoPanel` 方法内添加清理：

```ts
function hideInfoPanel() {
  infoPanelVisible.value = false
  toolDiffData.value = null
}
```

在 return 对象中添加 `toolDiffData` 和 `showToolDiff`。

- [ ] **步骤 3：扩展 infoPanelMode 类型**

将 `infoPanelMode` 的类型从 `'diff' | 'file' | 'markdown'` 改为 `'diff' | 'file' | 'markdown' | 'tool-diff'`。

- [ ] **步骤 4：验证编译**

运行：`npx vue-tsc --noEmit`
预期：InfoPanel.vue 可能报类型错误（因为 mode prop 类型不匹配），后续任务修复

---

### 任务 3：添加 i18n 翻译

**文件：**
- 修改：`src/i18n/locales/zh-CN.ts`
- 修改：`src/i18n/locales/en-US.ts`

- [ ] **步骤 1：在 zh-CN.ts 的 infoPanel 部分添加**

```ts
infoPanel: {
  changes: '更改',
  fileViewer: '文件查看器',
  preview: '预览',
  info: '信息',
  toolDiff: '代码变更',
  accept: '接受',
  revert: '撤回',
  acceptSuccess: '已接受更改',
  revertSuccess: '已撤回更改',
  revertFailed: '撤回失败',
  openInPanel: '在面板中查看',
  additions: '新增',
  deletions: '删除',
},
```

- [ ] **步骤 2：在 en-US.ts 的 infoPanel 部分添加**

```ts
infoPanel: {
  changes: 'Changes',
  fileViewer: 'File Viewer',
  preview: 'Preview',
  info: 'Info',
  toolDiff: 'Code Changes',
  accept: 'Accept',
  revert: 'Revert',
  acceptSuccess: 'Changes accepted',
  revertSuccess: 'Changes reverted',
  revertFailed: 'Revert failed',
  openInPanel: 'View in panel',
  additions: 'Additions',
  deletions: 'Deletions',
},
```

---

### 任务 4：创建 ToolDiffViewer 组件

**文件：**
- 创建：`src/components/common/ToolDiffViewer.vue`

- [ ] **步骤 1：创建 ToolDiffViewer.vue**

```vue
<template>
  <div class="tool-diff-viewer">
    <div class="diff-header">
      <FileDiff :size="14" />
      <span class="diff-path">{{ appStore.toolDiffData?.filePath }}</span>
      <span class="language-badge" v-if="appStore.toolDiffData?.language">
        {{ appStore.toolDiffData.language }}
      </span>
      <div class="diff-stats" v-if="stats.additions || stats.deletions">
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

    <div class="diff-content" v-if="diffData?.type === 'read'">
      <pre><code :class="`language-${diffData.language}`" v-html="highlightedCode"></code></pre>
    </div>

    <div class="diff-content" v-else-if="diffData?.type === 'webfetch'">
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
        v-for="(line, index) in diffLines"
        :key="index"
        class="diff-line"
        :class="line.type"
      >
        <span class="line-number old">{{ line.oldNumber || '' }}</span>
        <span class="line-number new">{{ line.newNumber || '' }}</span>
        <span class="line-prefix">{{ line.prefix }}</span>
        <span class="line-content">{{ line.content }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore, type ToolDiffData } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { FileDiff, Check, Undo2 } from 'lucide-vue-next'
import { diffLines } from 'diff'
import MarkdownRenderer from './MarkdownRenderer.vue'
import hljs from 'highlight.js'
import { api } from '@/services/electronAPI'

const appStore = useAppStore()
const { t } = useI18n()

const diffData = computed(() => appStore.toolDiffData)

const hasActions = computed(() => {
  const type = diffData.value?.type
  return type === 'edit' || type === 'write'
})

interface DiffLineView {
  type: 'add' | 'remove' | 'context'
  content: string
  oldNumber?: number
  newNumber?: number
  prefix: string
}

const diffLines = computed<DiffLineView[]>(() => {
  const data = diffData.value
  if (!data || data.type === 'read' || data.type === 'webfetch' || data.type === 'grep') return []

  const changes = diffLines(data.originalContent, data.modifiedContent)
  const lines: DiffLineView[] = []
  let oldNum = 0
  let newNum = 0

  for (const change of changes) {
    const count = change.count || 0
    if (change.added) {
      for (const line of change.value.split('\n')) {
        if (line === '' && change.value.endsWith('\n')) continue
        newNum++
        lines.push({ type: 'add', content: line, newNumber: newNum, prefix: '+' })
      }
    } else if (change.removed) {
      for (const line of change.value.split('\n')) {
        if (line === '' && change.value.endsWith('\n')) continue
        oldNum++
        lines.push({ type: 'remove', content: line, oldNumber: oldNum, prefix: '-' })
      }
    } else {
      for (const line of change.value.split('\n')) {
        if (line === '' && change.value.endsWith('\n')) continue
        oldNum++
        newNum++
        lines.push({ type: 'context', content: line, oldNumber: oldNum, newNumber: newNum, prefix: ' ' })
      }
    }
  }

  return lines
})

const stats = computed(() => {
  let additions = 0
  let deletions = 0
  for (const line of diffLines.value) {
    if (line.type === 'add') additions++
    if (line.type === 'remove') deletions++
  }
  return { additions, deletions }
})

const highlightedCode = computed(() => {
  const data = diffData.value
  if (!data || data.type !== 'read') return ''
  try {
    const language = data.language
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(data.modifiedContent, { language }).value
    }
    return hljs.highlightAuto(data.modifiedContent).value
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
      const isMatch = query && rest.toLowerCase().includes(query.toLowerCase())
      return {
        path: pathPart,
        lineNum: '',
        html: isMatch ? highlightMatch(rest, query) : escapeHtml(rest),
        isMatch
      }
    }
    const lineNum = rest.slice(0, numSepIdx)
    const text = rest.slice(numSepIdx + 1)
    const isMatch = query && text.toLowerCase().includes(query.toLowerCase())
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
  appStore.hideInfoPanel()
}

async function handleRevert() {
  const data = diffData.value
  if (!data) return

  try {
    const result = await api.writeFile(data.filePath, data.originalContent)
    if (result.success) {
      appStore.hideInfoPanel()
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
  border-bottom: 1px solid var(--surface-border);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  flex-wrap: wrap;

  .diff-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
    min-width: 0;
  }

  .language-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
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
  font-family: var(--font-mono);
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
  border-radius: 4px;
  border: 1px solid var(--surface-border);
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
  font-family: var(--font-mono);
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
    background: var(--bg-secondary, var(--surface-glass));
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
    .line-content { color: var(--success); }
  }

  &.remove {
    background: rgba(220, 53, 69, 0.08);
    .line-number { background: rgba(220, 53, 69, 0.12); }
    .line-prefix { color: var(--error); }
    .line-content { color: var(--error); }
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
    color: var(--accent-primary);
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
```

- [ ] **步骤 2：验证编译**

运行：`npx vue-tsc --noEmit`
预期：可能有 import 路径相关的小问题，修复后通过

---

### 任务 5：更新 InfoPanel 支持 tool-diff 模式

**文件：**
- 修改：`src/components/layout/InfoPanel.vue`

- [ ] **步骤 1：修改 mode prop 类型**

将 props 定义中的 mode 类型扩展：

```ts
const props = defineProps<{
  mode: 'diff' | 'file' | 'markdown' | 'tool-diff'
}>()
```

- [ ] **步骤 2：在 template 中添加 tool-diff 分支**

在 `<MarkdownRenderer>` 之后添加：

```html
<ToolDiffViewer v-else-if="mode === 'tool-diff'" />
```

- [ ] **步骤 3：添加 import**

在 script 中添加：

```ts
import ToolDiffViewer from '../common/ToolDiffViewer.vue'
```

- [ ] **步骤 4：更新 panelTitle computed**

在 switch 中添加 case：

```ts
case 'tool-diff': return t('infoPanel.toolDiff')
```

- [ ] **步骤 5：验证编译**

运行：`npx vue-tsc --noEmit`
预期：通过

---

### 任务 6：更新 EditToolCard

**文件：**
- 修改：`src/components/chat/tools/EditToolCard.vue`

- [ ] **步骤 1：添加 import**

在 script 中添加：

```ts
import { ExternalLink } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'

const appStore = useAppStore()
```

- [ ] **步骤 2：在 header 中添加按钮**

在 `<ChevronDown>` 之前、`<span class="edit-path">` 之后添加：

```html
<button
  class="panel-btn"
  @click.stop="openInPanel"
  :title="t('infoPanel.openInPanel')"
>
  <ExternalLink :size="13" />
</button>
```

添加 `useI18n`：

```ts
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
```

- [ ] **步骤 3：添加 openInPanel 方法**

```ts
async function openInPanel() {
  const filePath = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!filePath) return

  const modifiedContent = await api.readFile(filePath)
  if (modifiedContent === null) return

  let originalContent = modifiedContent
  const oldStr = props.toolCall.input?.old_string || ''
  const newStr = props.toolCall.input?.new_string || ''
  if (newStr && modifiedContent.includes(newStr)) {
    originalContent = modifiedContent.replace(newStr, oldStr)
  }

  const language = appStore.getLanguageFromPath(filePath)
  appStore.showToolDiff({
    type: 'edit',
    filePath,
    originalContent,
    modifiedContent,
    toolCallId: props.toolCall.id,
    language,
  })
}
```

- [ ] **步骤 4：添加按钮样式**

```scss
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
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }
}
```

---

### 任务 7：更新 WriteToolCard

**文件：**
- 修改：`src/components/chat/tools/WriteToolCard.vue`

- [ ] **步骤 1：添加 import**

```ts
import { ExternalLink } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'

const appStore = useAppStore()
const { t } = useI18n()
```

- [ ] **步骤 2：在 header 中添加按钮**

在 `<ChevronDown>` 之前添加：

```html
<button
  class="panel-btn"
  @click.stop="openInPanel"
  :title="t('infoPanel.openInPanel')"
>
  <ExternalLink :size="13" />
</button>
```

- [ ] **步骤 3：添加 openInPanel 方法**

```ts
async function openInPanel() {
  const filePath = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!filePath) return

  const modifiedContent = await api.readFile(filePath)
  if (modifiedContent === null) return

  let originalContent = ''
  try {
    const projectRoot = appStore.projectRoot
    if (projectRoot) {
      const relativePath = filePath.replace(projectRoot, '').replace(/^[/\\]/, '')
      const diffResult = await api.git.getDiff(projectRoot, relativePath)
      if (diffResult?.hunks?.length) {
        originalContent = reconstructOriginal(diffResult, modifiedContent)
      }
    }
  } catch { /* not in git repo, originalContent stays empty */ }

  const language = appStore.getLanguageFromPath(filePath)
  appStore.showToolDiff({
    type: 'write',
    filePath,
    originalContent,
    modifiedContent,
    toolCallId: props.toolCall.id,
    language,
  })
}

function reconstructOriginal(diffResult: any, modifiedContent: string): string {
  let original = modifiedContent
  if (diffResult.hunks) {
    for (const hunk of [...diffResult.hunks].reverse()) {
      if (hunk.content) {
        const lines = hunk.content.split('\n')
        const addLines: string[] = []
        const removeLines: string[] = []
        for (const line of lines) {
          if (line.startsWith('+')) addLines.push(line.substring(1))
          else if (line.startsWith('-')) removeLines.push(line.substring(1))
        }
        const addBlock = addLines.join('\n')
        const removeBlock = removeLines.join('\n')
        if (addBlock && original.includes(addBlock)) {
          original = original.replace(addBlock, removeBlock)
        }
      }
    }
  }
  return original
}
```

- [ ] **步骤 4：添加按钮样式**（同 EditToolCard 的 `.panel-btn`）

---

### 任务 8：更新 ReadToolCard

**文件：**
- 修改：`src/components/chat/tools/ReadToolCard.vue`

- [ ] **步骤 1：添加 import**

```ts
import { ExternalLink } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'

const appStore = useAppStore()
const { t } = useI18n()
```

- [ ] **步骤 2：在 header 中添加按钮**

在 `<ChevronDown>` 之前添加：

```html
<button
  class="panel-btn"
  @click.stop="openInPanel"
  :title="t('infoPanel.openInPanel')"
>
  <ExternalLink :size="13" />
</button>
```

- [ ] **步骤 3：添加 openInPanel 方法**

```ts
async function openInPanel() {
  const filePath = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!filePath) return

  const content = await api.readFile(filePath)
  if (content === null) return

  const language = appStore.getLanguageFromPath(filePath)
  appStore.showToolDiff({
    type: 'read',
    filePath,
    originalContent: content,
    modifiedContent: content,
    toolCallId: props.toolCall.id,
    language,
  })
}
```

- [ ] **步骤 4：添加按钮样式**（同 EditToolCard 的 `.panel-btn`）

---

### 任务 9：更新 WebFetchToolCard

**文件：**
- 修改：`src/components/chat/tools/WebFetchToolCard.vue`

- [ ] **步骤 1：添加 import**

```ts
import { ExternalLink } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'

const appStore = useAppStore()
const { t } = useI18n()
```

- [ ] **步骤 2：在 header 中添加按钮**

在 `<ChevronDown>` 之前添加：

```html
<button
  class="panel-btn"
  @click.stop="openInPanel"
  :title="t('infoPanel.openInPanel')"
>
  <ExternalLink :size="13" />
</button>
```

- [ ] **步骤 3：添加 openInPanel 方法**

```ts
function openInPanel() {
  const url = props.toolCall.input?.url || 'WebFetch Result'
  appStore.showToolDiff({
    type: 'webfetch',
    filePath: url,
    originalContent: '',
    modifiedContent: '',
    toolCallId: props.toolCall.id,
    language: 'markdown',
    displayContent: props.toolCall.output || '',
  })
}
```

- [ ] **步骤 4：添加按钮样式**（同 EditToolCard 的 `.panel-btn`）

---

### 任务 10：更新 GrepToolCard

**文件：**
- 修改：`src/components/chat/tools/GrepToolCard.vue`

- [ ] **步骤 1：添加 import**

```ts
import { ExternalLink } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'

const appStore = useAppStore()
const { t } = useI18n()
```

- [ ] **步骤 2：在 header 中添加按钮**

在 `<ChevronDown>` 之前添加：

```html
<button
  class="panel-btn"
  @click.stop="openInPanel"
  :title="t('infoPanel.openInPanel')"
>
  <ExternalLink :size="13" />
</button>
```

- [ ] **步骤 3：添加 openInPanel 方法**

```ts
function openInPanel() {
  const query = props.toolCall.input?.query || props.toolCall.input?.pattern || ''
  appStore.showToolDiff({
    type: 'grep',
    filePath: `Grep: ${query}`,
    originalContent: '',
    modifiedContent: '',
    toolCallId: props.toolCall.id,
    language: 'text',
    displayContent: props.toolCall.output || '',
    searchQuery: query,
  })
}
```

- [ ] **步骤 4：添加按钮样式**（同 EditToolCard 的 `.panel-btn`）

---

### 任务 11：最终验证

- [ ] **步骤 1：运行 TypeScript 类型检查**

运行：`npx vue-tsc --noEmit`
预期：0 errors

- [ ] **步骤 2：运行开发服务器验证**

运行：`npm run dev`
预期：应用正常启动，工具卡片显示 ExternalLink 图标

- [ ] **步骤 3：手动功能验证**

1. 在聊天中触发 Edit 工具 → 点击图标 → 右侧面板显示 diff → 测试接受/撤回
2. 在聊天中触发 Write 工具 → 点击图标 → 右侧面板显示全绿高亮 → 测试撤回
3. 在聊天中触发 Read 工具 → 点击图标 → 右侧面板显示代码
4. 在聊天中触发 WebFetch 工具 → 点击图标 → 右侧面板显示 Markdown
5. 在聊天中触发 Grep 工具 → 点击图标 → 右侧面板显示搜索结果

- [ ] **步骤 4：Commit**

```bash
git add -A
git commit -m "feat: add tool card to info panel integration with diff view and accept/revert"
```
