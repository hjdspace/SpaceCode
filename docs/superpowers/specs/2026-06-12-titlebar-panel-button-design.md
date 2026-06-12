# 标题栏面板按钮设计

**日期**: 2026-06-12
**状态**: 已确认，待实现

## 背景

参考 Codex 的交互，将 TitleBar 右上角的「主题切换」按钮（Sun/Moon）替换为一个「面板」按钮。

**核心交互**：点击该按钮 → **展开右侧面板（InfoPanel）** → 面板内显示一个「启动器」，即截图中那 4 个大按钮（Review 代码审查、终端、浏览器、文件）。点击其中任意一个启动对应工具。再次点击标题栏按钮收起面板。

主题切换仍可在「设置」面板中完成，从标题栏移除主题按钮不影响功能。

## 决策汇总

- 按钮交互：点击**切换右侧面板显隐**；面板打开且无内容时显示启动器（4 个按钮），样式对齐截图的卡片列表。
- 4 个按钮的动作：
  - **Review** → 复用现有 `chatStore.triggerDiffPanel()`（ChatPanel 的变更弹窗）。
  - **终端** → 在右侧面板 InfoPanel 中打开终端。
  - **浏览器** → 在右侧面板 InfoPanel 中打开浏览器（空白新标签，用已有地址栏输入网址）。
  - **文件** → 弹出模糊搜索快速打开弹窗。
- 主题按钮：从标题栏移除（设置面板仍可切换主题）。
- 标题栏原有独立「审查变更」按钮（`ReviewChangesIcon`）：移除，整合进启动器的 Review。
- 快捷键：启动器每项显示快捷键文字提示（Ctrl+Shift+G / Ctrl+` / Ctrl+T / Ctrl+P），**不接入全局快捷键系统**。

## 交互状态模型

右侧面板有两种内容状态：

1. **启动器（home）**：显示 4 个大按钮。出现条件：`infoPanelVisible && (panelHome || infoPanelTabs.length === 0)`。
2. **工具内容**：终端 / 浏览器 / 文件 / diff 等标签页内容（现有逻辑）。

- 点击标题栏按钮 = `toggleInfoPanel()`：已显示则隐藏；未显示则显示并进入启动器。
- 从启动器打开终端/浏览器/文件 → `panelHome=false`，展示对应内容。
- 已有标签页时，可通过 InfoPanel 标签栏新增的「主页」按钮回到启动器（`panelHome=true`）；点击任一标签页则 `panelHome=false`。

## 实现要点

### 1. stores/app.ts
- `InfoPanelTabType` 增加 `'terminal'`。
- 新增 `panelHome = ref(false)`。
- 新增 `toggleInfoPanel()`：`infoPanelVisible` 为真则置假；否则 `infoPanelVisible=true; panelHome=true`。
- `openInfoTab()` 内设置 `panelHome=false`（打开任何标签即离开启动器）。
- 新增 `goPanelHome()`：`infoPanelVisible=true; panelHome=true`。
- 新增 `openTerminalInPanel()`：用固定 id（`terminal-panel`）打开/激活一个 `terminal` 类型 InfoPanel 标签（`TerminalPanel` 挂载时自动创建终端实例，沿用即可）。
- 新增 `openBlankWebview()`：打开一个空 URL 的 webview 标签（固定 tabId 如 `webview::new`），让用户在已有地址栏输入网址。
- 新增 `showFileQuickOpen = ref(false)`（控制文件快速打开弹窗）。
- 导出以上新增项。

### 2. 新增 PanelLauncher.vue（启动器）
- 渲染 4 个大按钮（图标 + 文案 + 右侧快捷键提示），垂直排列，样式对齐截图（圆角灰底行卡片）。
- 点击动作：
  | 按钮 | 动作 | 提示 |
  |---|---|---|
  | Review 代码审查 | `chatStore.triggerDiffPanel()` | Ctrl+Shift+G |
  | 终端 | `appStore.openTerminalInPanel()` | Ctrl+` |
  | 浏览器 | `appStore.openBlankWebview()` | Ctrl+T |
  | 文件 | `appStore.showFileQuickOpen = true` | Ctrl+P |

### 3. InfoPanel.vue
- 在内容区：当 `panelHome || infoPanelTabs.length === 0` 时渲染 `<PanelLauncher />`，否则按现有 `mode` 渲染各 viewer。
- 增加 `<TerminalPanel v-else-if="mode === 'terminal'" />`，import `TerminalPanel`。

### 4. InfoPanelTabBar.vue
- 新增一个「主页」按钮（lucide `LayoutGrid` 或 `Home`），点击 `appStore.goPanelHome()` 回到启动器。
- `handleTabClick` 内补充 `appStore.panelHome = false`。

### 5. 新增 FileQuickOpen.vue
- 居中模态：搜索输入框 + 结果列表。
- 防抖（~150ms）调用 `api.searchFiles(appStore.projectRoot, query, { maxResults })`。
- 键盘：Up/Down 选择，Enter `appStore.openFile(path)` 并关闭，Esc 关闭。
- 未打开项目时给出提示。
- 显隐用 `appStore.showFileQuickOpen`；组件挂在 `App.vue`。

### 6. TitleBar.vue
- 移除主题按钮（`Sun`/`Moon` 及 `themeTooltip`、`THEME_LABELS`、`THEME_CYCLE`，清理不再使用的 import）。
- 移除独立「审查变更」按钮（`ReviewChangesIcon` 的 `titlebar-btn`，若 `ReviewChangesIcon` 不再使用则一并移除定义）。
- 新增「面板」按钮：lucide `PanelRight` 图标，`@click="appStore.toggleInfoPanel()"`，`is-active` 跟随 `infoPanelVisible`。

### 7. App.vue
- 挂载 `<FileQuickOpen />`（受 `appStore.showFileQuickOpen` 控制）。

### 8. i18n
- `titleBar.togglePanel`（按钮 title）、启动器 4 项文案（可复用现有 `titleBar.*` / 新增 `panel.*`）。

## 边界与非目标

- 不接入新的全局快捷键（仅显示提示文字）。
- 不改动中间区原有终端标签页机制（`openTerminalTab` 等保持不变）。
- 浏览器空白标签仅复用现有 webview 能力，不做书签/多主页扩展。

## 涉及文件

- `src/stores/app.ts`（改）
- `src/components/layout/PanelLauncher.vue`（新增）
- `src/components/layout/InfoPanel.vue`（改）
- `src/components/layout/InfoPanelTabBar.vue`（改）
- `src/components/layout/FileQuickOpen.vue`（新增）
- `src/components/layout/TitleBar.vue`（改）
- `src/App.vue`（改）
- i18n 文案（改）
