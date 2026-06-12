# 标题栏面板按钮设计

**日期**: 2026-06-12
**状态**: 已确认，待实现

## 背景

参考 Codex 的交互，将 TitleBar 右上角的「主题切换」按钮（Sun/Moon）替换为一个「面板」按钮。点击后弹出一个下拉菜单（截图同款列表样式），提供 4 个快捷工具入口：Review（代码审查）、终端、浏览器、文件。终端与浏览器在右侧面板（InfoPanel）中打开。

主题切换仍可在「设置」面板中完成，因此从标题栏移除主题按钮不影响功能。

## 决策汇总

- 按钮交互：点击弹出下拉菜单（4 项），复用标题栏现有 `.open-file-menu` 下拉样式。
- 工具落点：
  - **Review** → 复用现有 `chatStore.triggerDiffPanel()`（ChatPanel 里的变更弹窗）。
  - **终端** → 在右侧面板 InfoPanel 中打开。
  - **浏览器** → 在右侧面板 InfoPanel 中打开（空白新标签，用已有地址栏输入网址）。
  - **文件** → 弹出模糊搜索快速打开弹窗。
- 主题按钮：从标题栏移除（设置面板仍可切换主题）。
- 标题栏原有的独立「审查变更」按钮（`ReviewChangesIcon`）：移除，整合进新菜单的 Review 项，避免重复。
- 快捷键：菜单仅显示快捷键文字提示（对齐截图），不接入全局快捷键系统。

## 实现要点

### 1. TitleBar.vue
- 移除主题按钮（`Sun`/`Moon` 及相关 `themeTooltip`、`THEME_LABELS`、`THEME_CYCLE` 引用，若不再被使用则一并清理 import）。
- 移除独立「审查变更」按钮（`ReviewChangesIcon` 触发的那个 `titlebar-btn`）。
- 新增「面板」按钮 + 下拉菜单：
  - 图标用 lucide `PanelRight`。
  - 下拉结构复用现有 `open-file-dropdown` / `open-file-menu` 模式（含 ref、`toggle`、文档点击关闭逻辑）。
  - 菜单项（图标 + 文案 + 右侧快捷键提示）：
    | 项 | 动作 | 提示 |
    |---|---|---|
    | Review 代码审查 | `chatStore.triggerDiffPanel()` | Ctrl+Shift+G |
    | 终端 | `appStore.openTerminalInPanel()` | Ctrl+` |
    | 浏览器 | `appStore.openBlankWebview()` | Ctrl+T |
    | 文件 | 打开 `FileQuickOpen` 弹窗 | Ctrl+P |
  - 点击任一项后关闭菜单。

### 2. stores/app.ts
- `InfoPanelTabType` 增加 `'terminal'`。
- 新增 `openTerminalInPanel()`：
  - 用固定 id（如 `terminal-panel`）打开/激活一个 `terminal` 类型的 InfoPanel 标签；
  - 确保 terminalStore 至少有一个终端实例（`TerminalPanel` 挂载时已会自动创建，沿用即可）。
- 新增 `openBlankWebview()`：
  - 打开一个空 URL 的 webview 标签（tabId 固定如 `webview::new`），让用户在 InfoPanel 已有地址栏输入网址。
  - `webviewUrl` 为空时 InfoPanel 已有空状态展示，需顺带把空状态文案调整为「输入网址开始浏览」之类（可选，最小改动）。

### 3. InfoPanel.vue
- 在内容区增加 `<TerminalPanel v-else-if="mode === 'terminal'" />`，import `TerminalPanel`。
- terminal 模式下不显示文件/代码相关 UI。

### 4. FileQuickOpen.vue（新增）
- 居中模态：搜索输入框 + 结果列表。
- 防抖（~150ms）调用 `api.searchFiles(appStore.projectRoot, query, { maxResults })`。
- 键盘：Up/Down 选择，Enter `appStore.openFile(path)` 并关闭，Esc 关闭。
- 未打开项目时给出提示。
- 显隐用 app store 标志位 `showFileQuickOpen`（与现有 `showSettings`/`showSkillsManager` 等同风格）；组件挂在 `App.vue`，TitleBar 菜单项设置 `appStore.showFileQuickOpen = true` 触发。

## 边界与非目标

- 不接入新的全局快捷键（仅显示提示文字）。
- 不改动中间区原有的终端标签页机制（`openTerminalTab` 等保持不变）。
- 不做浏览器多主页/书签等扩展，浏览器空白标签仅复用现有 webview 能力。

## 涉及文件

- `src/components/layout/TitleBar.vue`（改）
- `src/stores/app.ts`（改）
- `src/components/layout/InfoPanel.vue`（改）
- `src/components/layout/FileQuickOpen.vue`（新增）
- `src/App.vue`（挂载 FileQuickOpen，改）
- i18n 文案（`titleBar.*` 新增菜单项文案，改）
