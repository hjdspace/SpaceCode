# 斜杠命令 Inline Chip 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将斜杠命令选中后的渲染方式从编辑区顶部 Badge 栏改为 contenteditable 内 inline chip，与 @mention chip 模式统一。

**架构：** 复用现有 mention-chip 的 DOM 操作模式，在 contenteditable 中插入 `<span class="command-chip" contenteditable="false">` 元素。移除 activeBadge 状态，命令信息存储在 chip DOM 的 data-* 属性中，通过 getEditorPlainText() 序列化为文本标记。

**技术栈：** Vue 3 + Composition API + SCSS + contenteditable DOM 操作

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/types/index.ts` | 类型定义 — CommandBadge 新增 source 字段 | 修改 |
| `src/lib/constants/commands.ts` | 内置命令定义 — 新增 source 字段 | 修改 |
| `src/lib/commands/commandRegistry.ts` | 命令注册中心 — 确保所有命令有 source | 修改 |
| `src/lib/commands/types.ts` | 命令类型 — 无变更（已有 CommandSource） | 不变 |
| `src/lib/message-input-logic.ts` | 纯逻辑 — 新增 dispatchCommandChip，修改 resolveKeyAction/resolveDirectSlash | 修改 |
| `src/utils/mention-chips.ts` | Chip 渲染工具 — 新增 command chip 序列化/反序列化 | 修改 |
| `src/i18n/locales/en-US.ts` | 英文翻译 — 新增 source 标签 | 修改 |
| `src/i18n/locales/zh-CN.ts` | 中文翻译 — 新增 source 标签 | 修改 |
| `src/components/chat/ChatInput.vue` | 主组件 — 移除 badge，新增 command chip | 修改 |

---

### 任务 1：类型与数据层 — 新增 source 字段

**文件：**
- 修改：`src/types/index.ts:230-235`
- 修改：`src/lib/constants/commands.ts:44-265`

- [ ] **步骤 1：修改 CommandBadge 接口，新增 source 字段**

在 `src/types/index.ts` 的 `CommandBadge` 接口中新增 `source` 字段：

```typescript
export interface CommandBadge {
  command: string
  label: string
  description: string
  kind: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command'
  source?: 'builtin' | 'bundled' | 'global' | 'project' | 'plugin' | 'mcp'
}
```

- [ ] **步骤 2：为 BUILT_IN_COMMANDS 每项新增 source: 'builtin'**

在 `src/lib/constants/commands.ts` 中，为 `BUILT_IN_COMMANDS` 数组的每个对象添加 `source: 'builtin' as const`。示例：

```typescript
{
  name: 'help',
  description: 'Show available commands and tips',
  icon: 'HelpCircle',
  kind: 'immediate',
  immediate: true,
  source: 'builtin' as const,
},
```

注意：`SlashCommand` 接口（在 `src/types/index.ts:221-228`）也需要新增 `source` 可选字段：

```typescript
export interface SlashCommand {
  name: string
  description: string
  icon: string
  kind?: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command'
  immediate?: boolean
  aliases?: string[]
  source?: 'builtin' | 'bundled' | 'global' | 'project' | 'plugin' | 'mcp'
}
```

- [ ] **步骤 3：确保 commandRegistry 传递 source 字段**

检查 `src/lib/commands/commandRegistry.ts`，确保 `getAllCommands()` 返回的 `UnifiedCommand` 对象包含 `source` 字段。`UnifiedCommand` 已有 `source: CommandSource` 字段（定义在 `src/lib/commands/types.ts:13`），无需修改类型。只需确认注册逻辑正确传递 source。

- [ ] **步骤 4：Commit**

```bash
git add src/types/index.ts src/lib/constants/commands.ts
git commit -m "feat: add source field to CommandBadge and SlashCommand types"
```

---

### 任务 2：i18n — 新增 source 标签翻译

**文件：**
- 修改：`src/i18n/locales/en-US.ts`
- 修改：`src/i18n/locales/zh-CN.ts`

- [ ] **步骤 1：在 en-US.ts 的 chatInput 命名空间中新增 source 标签**

在 `en-US.ts` 的 `chatInput` 对象中新增：

```typescript
sourceBuiltin: 'Built-in',
sourceBundled: 'Bundled',
sourceGlobal: 'Global',
sourceProject: 'Project',
sourcePlugin: 'Plugin',
sourceMcp: 'MCP',
```

- [ ] **步骤 2：在 zh-CN.ts 的 chatInput 命名空间中新增 source 标签**

在 `zh-CN.ts` 的 `chatInput` 对象中新增：

```typescript
sourceBuiltin: '内置',
sourceBundled: '打包',
sourceGlobal: '全局',
sourceProject: '项目',
sourcePlugin: '插件',
sourceMcp: 'MCP',
```

- [ ] **步骤 3：Commit**

```bash
git add src/i18n/locales/en-US.ts src/i18n/locales/zh-CN.ts
git commit -m "feat: add i18n labels for command source types"
```

---

### 任务 3：mention-chips.ts — 新增 command chip 序列化/反序列化

**文件：**
- 修改：`src/utils/mention-chips.ts`

- [ ] **步骤 1：新增 buildCommandChipHtml 函数**

在 `mention-chips.ts` 中新增：

```typescript
/** Source icon mapping */
const SOURCE_ICONS: Record<string, string> = {
  builtin: '⚡',
  bundled: '📦',
  global: '🌐',
  project: '📂',
  plugin: '🧩',
  mcp: '🔌',
}

/**
 * Build the HTML for a single command chip.
 */
function buildCommandChipHtml(name: string, kind: string, source: string): string {
  const icon = SOURCE_ICONS[source] || '⚡'
  const chipClass = `command-chip kind-${kind} source-${source}`
  return (
    `<span class="${chipClass}" data-command="/${escapeHtml(name)}" data-kind="${escapeHtml(kind)}" data-source="${escapeHtml(source)}">` +
    `<span class="chip-source-icon">${icon}</span>` +
    `<span class="chip-label">/${escapeHtml(name)}</span>` +
    `<span class="chip-source-tag">${escapeHtml(source)}</span>` +
    `</span>`
  )
}
```

- [ ] **步骤 2：新增 replaceCommandChipMarkers 函数**

```typescript
/**
 * Replace /cmd:"name":kind:source markers with HTML command chip spans,
 * leaving all other text untouched.
 */
export function replaceCommandChipMarkers(text: string): string {
  if (!text) return ''
  return text.replace(/\/cmd:"([^"]+)":(\w+):(\w+)/g, (_match, name, kind, source) =>
    buildCommandChipHtml(name, kind, source)
  )
}
```

- [ ] **步骤 3：新增 renderCommandChipsToHtml 函数**

```typescript
/**
 * Replace command markers with chip HTML AND HTML-escape all surrounding text.
 * Returns a string safe to insert via v-html where the input is plain text.
 */
export function renderCommandChipsToHtml(text: string): string {
  if (!text) return ''

  const CMD_MARKER_RE = /\/cmd:"([^"]+)":(\w+):(\w+)/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = CMD_MARKER_RE.exec(text)) !== null) {
    const [full, name, kind, source] = match
    result += escapeHtml(text.slice(lastIndex, match.index))
    result += buildCommandChipHtml(name, kind, source)
    lastIndex = match.index + full.length
  }

  result += escapeHtml(text.slice(lastIndex))
  return result
}
```

- [ ] **步骤 4：更新 renderContentWithAttachments 以同时处理 command chip 标记**

修改 `renderContentWithAttachments` 函数，将正则扩展为同时匹配 `/cmd:` 标记：

```typescript
export function renderContentWithAttachments(text: string, images?: ImageAttachment[]): string {
  if (!text) return ''

  const imageMap = new Map(images?.map(img => [img.id, img]) || [])

  const MARKER_RE = /@(file|folder|image):"([^"]+)"|\/cmd:"([^"]+)":(\w+):(\w+)/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = MARKER_RE.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, match.index))

    if (match[3] !== undefined) {
      // Command chip marker: /cmd:"name":kind:source
      result += buildCommandChipHtml(match[3], match[4], match[5])
    } else if (match[1] === 'image') {
      const img = imageMap.get(match[2])
      if (img) {
        result += buildImageChipHtml(img)
      } else {
        result += escapeHtml(match[0])
      }
    } else {
      // file or folder
      result += buildChipHtml(match[2], match[1] === 'folder')
    }

    lastIndex = match.index + match[0].length
  }

  result += escapeHtml(text.slice(lastIndex))
  return result
}
```

- [ ] **步骤 5：Commit**

```bash
git add src/utils/mention-chips.ts
git commit -m "feat: add command chip serialization/deserialization to mention-chips"
```

---

### 任务 4：message-input-logic.ts — 新增 dispatchCommandChip，修改 resolveKeyAction/resolveDirectSlash

**文件：**
- 修改：`src/lib/message-input-logic.ts`

- [ ] **步骤 1：新增 CommandChipData 接口和 dispatchCommandChip 函数**

在 `message-input-logic.ts` 中新增：

```typescript
/** Parsed command chip data from editor serialization */
export interface CommandChipData {
  command: string
  label: string
  kind: CommandKind
  source: string
}

/**
 * Dispatch logic for inline command chips — generates the final prompt
 * from one or more command chips plus user content.
 * Reuses the same prompt generation logic as dispatchBadge.
 */
export function dispatchCommandChip(
  chips: CommandChipData[],
  userContent: string,
): BadgeDispatchResult {
  if (chips.length === 0) {
    return { prompt: userContent, displayLabel: userContent }
  }

  // Convert chips to badges for reuse of dispatchBadge logic
  const badges: CommandBadge[] = chips.map((chip) => ({
    command: chip.command,
    label: chip.label,
    description: '',
    kind: chip.kind,
    source: chip.source as any,
  }))

  return dispatchBadge(badges, userContent)
}
```

注意：需要导入 `CommandBadge`：

```typescript
import type { CommandBadge } from '@/types'
```

（已在文件中导入）

- [ ] **步骤 2：修改 resolveKeyAction — 移除 remove_badge action**

将 `resolveKeyAction` 中的 `remove_badge` 相关逻辑移除。Backspace 删除 chip 由 contenteditable DOM 自动处理（`contenteditable="false"` 的元素在 Backspace 时会被整体删除）。

```typescript
export function resolveKeyAction(
  key: string,
  state: {
    popoverMode: PopoverMode
    popoverHasItems: boolean
    inputValue: string
    hasBadge: boolean  // 保留参数但不再使用 remove_badge
  },
): KeyAction {
  // Popover navigation (skill/file mode)
  if (state.popoverMode && state.popoverHasItems) {
    if (key === 'ArrowDown') return { type: 'popover_navigate', direction: 'down' }
    if (key === 'ArrowUp') return { type: 'popover_navigate', direction: 'up' }
    if (key === 'Enter' || key === 'Tab') return { type: 'popover_select' }
    if (key === 'Escape') return { type: 'close_popover' }
  }

  // Escape closes popover only (badge removal handled by DOM backspace)
  if (key === 'Escape') {
    if (state.popoverMode) return { type: 'close_popover' }
  }

  return { type: 'passthrough' }
}
```

- [ ] **步骤 3：修改 resolveDirectSlash — 返回 chip 插入信息**

```typescript
export interface DirectSlashResult {
  action: 'immediate_command' | 'insert_chip' | 'not_slash'
  commandValue?: string
  chip?: CommandChipData
}

export function resolveDirectSlash(content: string): DirectSlashResult {
  if (!content.startsWith('/')) return { action: 'not_slash' }

  const cmd = findCommand(content.slice(1).split(/\s+/)[0])
  if (cmd) {
    if (cmd.immediate) {
      return { action: 'immediate_command', commandValue: content }
    }
    return {
      action: 'insert_chip',
      chip: {
        command: `/${cmd.name}`,
        label: cmd.name,
        kind: cmd.kind || 'slash_command',
        source: (cmd as any).source || 'builtin',
      },
    }
  }

  const skillName = content.slice(1).split(/\s+/)[0]
  if (skillName) {
    return {
      action: 'insert_chip',
      chip: {
        command: `/${skillName}`,
        label: skillName,
        kind: 'slash_command',
        source: 'builtin',
      },
    }
  }

  return { action: 'not_slash' }
}
```

- [ ] **步骤 4：Commit**

```bash
git add src/lib/message-input-logic.ts
git commit -m "feat: add dispatchCommandChip, update resolveKeyAction and resolveDirectSlash"
```

---

### 任务 5：ChatInput.vue — 移除 Badge 栏，新增 insertCommandChip

**文件：**
- 修改：`src/components/chat/ChatInput.vue`

这是最大的改动任务，分为多个步骤。

- [ ] **步骤 1：移除 command-badge-bar 模板**

删除 ChatInput.vue 模板中第 123-134 行的 badge 栏：

```html
<!-- 删除这段 -->
<Transition name="badge">
  <div v-if="activeBadge" class="command-badge-bar">
    <div class="command-badge" :class="`badge-kind-${activeBadge.kind}`">
      <span class="badge-label">/{{ activeBadge.label }}</span>
      <span class="badge-description">{{ activeBadge.description }}</span>
      <button class="badge-remove" @click="clearBadge">
        <X :size="12" />
      </button>
    </div>
  </div>
</Transition>
```

- [ ] **步骤 2：移除 activeBadge ref 和 clearBadge 函数**

删除以下代码：

```typescript
const activeBadge = ref<CommandBadge | null>(null)
const hasActiveBadge = computed(() => activeBadge.value !== null)
```

删除 `clearBadge` 函数。

删除所有对 `activeBadge` 的赋值和读取。搜索所有 `activeBadge` 引用并逐一处理。

- [ ] **步骤 3：新增 insertCommandChip 函数**

在 `insertMentionChip` 函数附近新增：

```typescript
/** Insert an inline command chip at current cursor position */
function insertCommandChip(cmd: { name: string; kind?: string; source?: string }) {
  const editor = editorRef.value
  if (!editor) return

  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return

  const range = sel.getRangeAt(0)

  const kind = cmd.kind || 'slash_command'
  const source = cmd.source || 'builtin'

  // Source icon mapping
  const sourceIcons: Record<string, string> = {
    builtin: '⚡',
    bundled: '📦',
    global: '🌐',
    project: '📂',
    plugin: '🧩',
    mcp: '🔌',
  }

  // Create the chip span
  const chip = document.createElement('span')
  chip.className = `command-chip kind-${kind} source-${source}`
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute('data-command', `/${cmd.name}`)
  chip.setAttribute('data-kind', kind)
  chip.setAttribute('data-source', source)

  // Inner structure: source-icon + label + source-tag
  const iconSpan = document.createElement('span')
  iconSpan.className = 'chip-source-icon'
  iconSpan.textContent = sourceIcons[source] || '⚡'

  const labelSpan = document.createElement('span')
  labelSpan.className = 'chip-label'
  labelSpan.textContent = `/${cmd.name}`

  const tagSpan = document.createElement('span')
  tagSpan.className = 'chip-source-tag'
  tagSpan.textContent = source

  chip.appendChild(iconSpan)
  chip.appendChild(labelSpan)
  chip.appendChild(tagSpan)

  // Insert chip and a trailing space
  range.deleteContents()
  range.insertNode(chip)

  // Move cursor after chip
  const afterRange = document.createRange()
  afterRange.setStartAfter(chip)
  afterRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(afterRange)

  // Insert trailing space
  const spaceNode = document.createTextNode('\u00A0')
  afterRange.insertNode(spaceNode)

  // Move cursor after space
  const finalRange = document.createRange()
  finalRange.setStartAfter(spaceNode)
  finalRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(finalRange)

  // Sync plain text
  inputText.value = getEditorPlainText()
}
```

- [ ] **步骤 4：修改 selectSlashCommand 函数**

将 `selectSlashCommand` 从设置 `activeBadge` 改为调用 `insertCommandChip`：

```typescript
function selectSlashCommand(cmd: SlashCommand) {
  if (cmd.immediate || cmd.kind === 'immediate') {
    commandPalette.closeMenu()
    clearEditor()
    const attachments = collectAllAttachments()
    emit('slash-command', cmd.name, '', attachments)
    return
  }

  commandPalette.closeMenu()

  // Remove the /trigger text from editor
  // The slash trigger is at the beginning of input or after whitespace
  const editor = editorRef.value
  if (editor) {
    // Find and remove the "/query" text that triggered the menu
    const text = getEditorPlainText()
    const slashMatch = text.match(/(^|\s)\/([^\s]*)$/)
    if (slashMatch) {
      const triggerOffset = slashMatch.index! + (slashMatch[1] ? 1 : 0)
      removeTriggerText(triggerOffset, slashMatch[0].length - (slashMatch[1] ? 1 : 0))
    }
  }

  // Insert inline command chip
  insertCommandChip({
    name: cmd.name,
    kind: cmd.kind || 'slash_command',
    source: (cmd as any).source || 'builtin',
  })

  nextTick(() => {
    editorRef.value?.focus()
    setCursorToEnd()
    autoResize()
  })
}
```

- [ ] **步骤 5：修改 getEditorPlainText — 序列化 command-chip**

在 `getEditorPlainText` 函数的 `walkNodes` 内部，在处理 `mention-chip` 的分支后新增 `command-chip` 分支：

```typescript
function getEditorPlainText(): string {
  const editor = editorRef.value
  if (!editor) return ''

  function walkNodes(parent: Node): string {
    let text = ''
    for (const node of Array.from(parent.childNodes)) {
      if (node instanceof Element && node.classList.contains('mention-chip')) {
        const path = node.getAttribute('data-path')
        const imageId = node.getAttribute('data-image-id')

        if (imageId) {
          text += `@image:"${imageId}" `
        } else if (path) {
          const isFolder = node.getAttribute('data-is-folder') === 'true'
          text += isFolder ? `@folder:"${path}" ` : `@file:"${path}" `
        }
      } else if (node instanceof Element && node.classList.contains('command-chip')) {
        // Serialize command chip as /cmd:"name":kind:source
        const command = node.getAttribute('data-command') || ''
        const kind = node.getAttribute('data-kind') || 'slash_command'
        const source = node.getAttribute('data-source') || 'builtin'
        const name = command.startsWith('/') ? command.slice(1) : command
        text += `/cmd:"${name}":${kind}:${source} `
      } else if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || ''
      } else if (node instanceof Element && node.tagName === 'BR') {
        text += '\n'
      } else if (node instanceof Element) {
        text += walkNodes(node)
        if (node.tagName === 'DIV' && node.nextSibling) {
          text += '\n'
        }
      }
    }
    return text
  }

  return walkNodes(editor)
}
```

- [ ] **步骤 6：修改 handleSend — 从 chip 解析命令**

将 `handleSend` 中基于 `activeBadge` 的逻辑改为从编辑器中解析 command-chip：

```typescript
// 在 handleSend 函数中，替换 activeBadge 相关逻辑：

function handleSend() {
  if (isSending.value || isOptimizing.value) return

  const content = getEditorPlainText().trim()
  const allAttachments = collectAllAttachments()

  // 检查编辑器中是否有 command-chip
  const editor = editorRef.value
  const commandChips = editor ? Array.from(editor.querySelectorAll('.command-chip')) : []

  if (commandChips.length > 0) {
    // 从 chip DOM 提取命令信息
    const chips: CommandChipData[] = commandChips.map((el) => ({
      command: el.getAttribute('data-command') || '',
      label: (el.getAttribute('data-command') || '').replace(/^\//, ''),
      kind: (el.getAttribute('data-kind') || 'slash_command') as CommandKind,
      source: el.getAttribute('data-source') || 'builtin',
    }))

    // 检查是否全部是 sdk_command — 直接 emit slash-command
    if (chips.length === 1 && chips[0].kind === 'sdk_command') {
      const commandName = chips[0].label
      cleanupAfterCommand()
      emit('slash-command', commandName, content.replace(/\/cmd:"[^"]+":\w+:\w+\s*/g, '').trim(), allAttachments)
      return
    }

    // 其他命令 — 使用 dispatchCommandChip 生成 prompt
    const userContent = content.replace(/\/cmd:"[^"]+":\w+:\w+\s*/g, '').trim()
    const result = dispatchCommandChip(chips, userContent)

    emit('send', result.prompt, allAttachments, {
      displayLabel: result.displayLabel
    })

    cleanupAfterCommand()
    return
  }

  // 检测是否是斜杠命令（用户直接输入 /command）
  const slashResult = resolveDirectSlash(content)

  if (slashResult.action === 'immediate_command') {
    const commandName = content.slice(1).split(/\s+/)[0]
    const commandArgs = content.slice(1 + commandName.length).trim()
    clearEditor()
    emit('slash-command', commandName, commandArgs, allAttachments)
  } else if (slashResult.action === 'insert_chip' && slashResult.chip) {
    // 直接输入的命令 — 插入 chip 并自动发送
    const result = dispatchCommandChip([slashResult.chip], '')
    emit('send', result.prompt, allAttachments, {
      displayLabel: result.displayLabel
    })
    clearEditor()
  } else {
    // 普通消息
    emit('send', content, allAttachments)
  }

  clearEditor()
  attachedFiles.value = []
  attachedImages.value = []
}

function cleanupAfterCommand() {
  clearEditor()
  attachedFiles.value = []
  attachedImages.value = []
}
```

需要导入 `CommandChipData` 和 `dispatchCommandChip`：

```typescript
import { resolveDirectSlash, dispatchCommandChip, type CommandChipData } from '@/lib/message-input-logic'
```

同时导入 `CommandKind`：

```typescript
import { type CommandKind } from '@/lib/constants/commands'
```

- [ ] **步骤 7：修改 handleEditorKeydown — 移除 badge 相关键盘处理**

搜索 `handleEditorKeydown` 中对 `activeBadge` 的引用，移除以下逻辑：
- Backspace 在空输入时删除 badge 的逻辑（现在由 DOM 自动处理 command-chip 的删除）
- Escape 清除 badge 的逻辑

具体地，移除 `resolveKeyAction` 返回 `remove_badge` 时的处理分支，因为 `resolveKeyAction` 已不再返回此 action。

- [ ] **步骤 8：移除 command-badge 样式，新增 command-chip 样式**

删除 `.command-badge-bar`、`.command-badge`、`.badge-label`、`.badge-description`、`.badge-remove`、`.badge-kind-*` 等样式。

在 `.inline-editor` 的 `.mention-chip` 样式后新增：

```scss
// Inline command chip styles
.command-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin: 0 2px;
  border: 1px solid var(--surface-border);
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.4;
  vertical-align: baseline;
  cursor: default;
  user-select: none;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);

  .chip-source-icon {
    font-size: 12px;
    line-height: 1;
    flex-shrink: 0;
  }

  .chip-label {
    font-weight: 600;
  }

  .chip-source-tag {
    font-size: 10px;
    opacity: 0.7;
    text-transform: capitalize;
  }

  // Kind-based colors
  &.kind-sdk_command {
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
    border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.5);
    color: var(--accent-primary);
  }

  &.kind-codepilot_command {
    background: rgba(245, 158, 11, 0.08);
    border-color: rgba(245, 158, 11, 0.5);
    color: #f59e0b;
  }

  &.kind-agent_skill {
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.5);
    color: #10b981;
  }

  &.kind-slash_command {
    background: rgba(99, 102, 241, 0.08);
    border-color: rgba(99, 102, 241, 0.5);
    color: #6366f1;
  }
}
```

- [ ] **步骤 9：移除 badge 过渡动画样式**

删除 `.badge-enter-active`、`.badge-leave-active`、`.badge-enter-from`、`.badge-leave-to` 样式。

- [ ] **步骤 10：修改 hasContent computed — 移除 hasActiveBadge 引用**

搜索 `hasContent` computed，移除对 `hasActiveBadge` 的引用。现在 hasContent 应基于编辑器内容（包括 chip）判断：

```typescript
const hasContent = computed(() => {
  const editor = editorRef.value
  if (!editor) return false
  return editor.textContent?.trim().length > 0 || editor.querySelectorAll('.mention-chip, .command-chip').length > 0
})
```

- [ ] **步骤 11：修改 isSubmitEnabled 调用 — 移除 hasBadge 参数**

搜索 `isSubmitEnabled` 的调用处，将 `hasBadge: hasActiveBadge.value` 改为检查编辑器中是否有 command-chip：

```typescript
isSubmitEnabled({
  inputValue: inputText.value,
  hasBadge: editorRef.value?.querySelectorAll('.command-chip').length > 0,
  hasFiles: attachedFiles.value.length > 0 || attachedImages.value.length > 0,
  isStreaming: isSending.value,
  disabled: props.disabled,
})
```

- [ ] **步骤 12：Commit**

```bash
git add src/components/chat/ChatInput.vue
git commit -m "feat: replace command badge bar with inline command chips in chat input"
```

---

### 任务 6：MessageItem.vue — 消息展示中渲染 command chip

**文件：**
- 修改：`src/components/chat/MessageItem.vue`

- [ ] **步骤 1：导入并使用 renderCommandChipsToHtml**

在 `MessageItem.vue` 中，找到渲染用户消息内容的地方，确保使用 `renderContentWithAttachments`（已包含 command chip 渲染）。

检查 `MessageItem.vue` 中是否使用了 `renderMentionChipsToHtml` 或 `renderContentWithAttachments`。如果使用了前者，需要改为后者（任务 3 已扩展 `renderContentWithAttachments` 支持 command chip）。

如果使用了 `replaceMentionChipMarkers`，同样需要改为同时处理 command chip 的版本。

- [ ] **步骤 2：新增 command-chip 消息展示样式**

在 `MessageItem.vue` 的 `:deep()` 样式中，新增 command-chip 的展示样式（与编辑器中的样式类似，但可能需要微调以适配消息气泡）：

```scss
:deep(.command-chip) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--surface-border);
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.4;
  vertical-align: baseline;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);

  .chip-source-icon {
    font-size: 12px;
    line-height: 1;
  }

  .chip-label {
    font-weight: 600;
  }

  .chip-source-tag {
    font-size: 10px;
    opacity: 0.7;
  }

  &.kind-sdk_command {
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
    border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.5);
    color: var(--accent-primary);
  }

  &.kind-codepilot_command {
    background: rgba(245, 158, 11, 0.08);
    border-color: rgba(245, 158, 11, 0.5);
    color: #f59e0b;
  }

  &.kind-agent_skill {
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.5);
    color: #10b981;
  }

  &.kind-slash_command {
    background: rgba(99, 102, 241, 0.08);
    border-color: rgba(99, 102, 241, 0.5);
    color: #6366f1;
  }
}
```

- [ ] **步骤 3：Commit**

```bash
git add src/components/chat/MessageItem.vue
git commit -m "feat: render command chips in message display"
```

---

### 任务 7：集成测试与验证

**文件：** 无新文件

- [ ] **步骤 1：启动开发服务器验证**

运行：`npm run dev`

验证以下场景：
1. 输入 `/` → 弹窗正常显示
2. 选择即时命令（如 `/help`）→ 直接执行，不插入 chip
3. 选择 SDK 命令（如 `/compact`）→ 插入蓝色 chip，chip 后可输入文本
4. 选择技能命令（如 `/commit`）→ 插入绿色 chip
5. Backspace 删除 chip → 整体删除
6. chip + @mention 混合 → 正常工作
7. 发送带 chip 的消息 → prompt 正确生成
8. 消息展示中 chip 正确渲染

- [ ] **步骤 2：运行 TypeScript 类型检查**

运行：`npx vue-tsc --noEmit`

预期：无类型错误

- [ ] **步骤 3：修复发现的问题**

根据测试结果修复任何问题。

- [ ] **步骤 4：Final commit**

```bash
git add -A
git commit -m "fix: polish command inline chip implementation"
```
