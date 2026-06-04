# 斜杠命令 Inline Chip 设计规格

## 概述

将斜杠命令选中后的渲染方式从"编辑区顶部 Badge 栏"改为"contenteditable 内 inline chip"，与 @mention chip 模式统一。用户从弹窗选择命令后，命令以 chip 形式渲染在输入框内，支持在 chip 后继续输入上下文文本。

## 动机

- 当今主流 AI IDE（Cursor、Windsurf、Claude Code）均采用 inline chip 渲染命令
- 当前 Badge 栏与编辑区分离，视觉上割裂
- 与 @mention chip 模式不一致，增加认知负担
- Badge 模式不支持多命令叠加

## 方案选择

**方案 A（已选定）：复用 Mention Chip 模式**

在 contenteditable 中插入 `<span class="command-chip" contenteditable="false">` 元素，与 @mention chip 模式一致。

优势：与现有模式统一、改动可控、支持多命令叠加。

## 设计细节

### 1. Chip DOM 结构

```html
<span class="command-chip kind-{kind} source-{source}"
      contenteditable="false"
      data-command="/{name}"
      data-kind="{kind}"
      data-source="{source}">
  <span class="chip-source-icon">{source图标}</span>
  <span class="chip-label">/{name}</span>
  <span class="chip-source-tag">{source标签}</span>
</span>
```

### 2. 视觉区分

#### Kind → 颜色

| Kind | 背景色 | 边框色 | 标签色 |
|------|--------|--------|--------|
| `sdk_command` | rgba(accent-primary, 0.08) | rgba(accent-primary, 0.5) | accent-primary |
| `codepilot_command` | rgba(245, 158, 11, 0.08) | rgba(245, 158, 11, 0.5) | #f59e0b |
| `agent_skill` | rgba(16, 185, 129, 0.08) | rgba(16, 185, 129, 0.5) | #10b981 |
| `slash_command` | rgba(99, 102, 241, 0.08) | rgba(99, 102, 241, 0.5) | #6366f1 |

#### Source → 图标 + 标签

| Source | 图标 | 标签文字 (en) | 标签文字 (zh) |
|--------|------|--------------|--------------|
| `builtin` | ⚡ | Built-in | 内置 |
| `bundled` | 📦 | Bundled | 打包 |
| `global` | 🌐 | Global | 全局 |
| `project` | 📂 | Project | 项目 |
| `plugin` | 🧩 | Plugin | 插件 |
| `mcp` | 🔌 | MCP | MCP |

### 3. 数据流

#### 当前（Badge 模式）

```
selectSlashCommand(cmd)
  → activeBadge = { command, label, description, kind }
  → 清空编辑器
  → handleSend() 检测 activeBadge
  → dispatchBadge(badge, content) 生成 prompt
```

#### 改为（Inline Chip 模式）

```
selectSlashCommand(cmd)
  → 移除 /触发文本
  → insertCommandChip(cmd) — 在 contenteditable 内插入 chip
  → 用户在 chip 后继续输入

handleSend()
  → getEditorPlainText() 序列化
  → command-chip 序列化为 /cmd:"{name}":{kind}:{source}
  → 解析标记，提取命令信息 + 用户文本
  → dispatchCommandChip() 生成 prompt（复用 dispatchBadge 逻辑）
```

### 4. 序列化格式

在 `getEditorPlainText()` 中，command-chip 序列化为：

```
/cmd:"compact":sdk_command:builtin
```

在消息展示时，通过 `replaceCommandChipMarkers()` 还原为 HTML chip。

### 5. 关键函数变更

#### 新增函数

| 函数 | 位置 | 职责 |
|------|------|------|
| `insertCommandChip(cmd)` | ChatInput.vue | 在光标位置插入 command-chip DOM 元素 |
| `dispatchCommandChip(chips, content)` | message-input-logic.ts | 从 chip 数据生成最终 prompt |
| `replaceCommandChipMarkers(text)` | mention-chips.ts | 将 `/cmd:"...":...` 标记还原为 HTML |
| `renderCommandChipsToHtml(text)` | mention-chips.ts | 同上，但 HTML-escape 周围文本 |

#### 修改函数

| 函数 | 变更 |
|------|------|
| `selectSlashCommand()` | 改为调用 `insertCommandChip()` 而非设置 `activeBadge` |
| `handleSend()` | 从编辑器 chip 解析命令，而非读取 `activeBadge` |
| `getEditorPlainText()` | 识别 `.command-chip` 元素，序列化为标记 |
| `resolveKeyAction()` | 移除 `remove_badge` action，Backspace 删除 chip 由编辑器 DOM 处理 |
| `resolveDirectSlash()` | 返回 chip 插入信息而非 badge |

#### 移除

| 内容 | 原因 |
|------|------|
| `activeBadge` ref | 命令信息存储在 chip DOM 中 |
| `command-badge-bar` 模板 | 不再需要独立 Badge 栏 |
| `command-badge` 样式 | 替换为 command-chip 样式 |
| `clearBadge()` 函数 | 不再需要 |

### 6. 边界情况

1. **多命令 chip** — 允许插入多个 command chip，发送时合并处理
2. **chip + mention 混合** — command chip 和 mention chip 可共存
3. **chip 不可编辑** — `contenteditable="false"` 确保 chip 只能整体删除
4. **即时命令** — 仍然直接执行，不插入 chip
5. **直接输入 `/command` 发送** — 保持现有行为，解析后插入 chip 或直接执行
6. **Backspace 删除** — 光标在 chip 后按 Backspace 删除整个 chip
7. **复制粘贴** — command-chip 的 `data-*` 属性确保复制粘贴时标记可还原

### 7. 需修改的文件

| 文件 | 改动 |
|------|------|
| `src/components/chat/ChatInput.vue` | 移除 badge 模板/样式，新增 insertCommandChip，修改 selectSlashCommand/handleSend/getEditorPlainText，新增 command-chip 样式 |
| `src/utils/mention-chips.ts` | 新增 replaceCommandChipMarkers / renderCommandChipsToHtml |
| `src/lib/message-input-logic.ts` | 新增 dispatchCommandChip，修改 resolveKeyAction/resolveDirectSlash |
| `src/types/index.ts` | CommandBadge 新增 source 字段 |
| `src/lib/constants/commands.ts` | BUILT_IN_COMMANDS 新增 source: 'builtin' |
| `src/lib/commands/commandRegistry.ts` | 确保所有命令有 source 字段 |
| `src/i18n/locales/en-US.ts` | 新增 source 标签 i18n key |
| `src/i18n/locales/zh-CN.ts` | 新增 source 标签 i18n key |

### 8. 不改动的部分

- 斜杠命令弹窗（保持弹出式菜单）
- @mention chip
- useCommandPalette
- commandSearch
