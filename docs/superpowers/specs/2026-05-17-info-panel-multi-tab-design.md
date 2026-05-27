# 右侧面板多 Tab 设计

## 背景

当前右侧 InfoPanel 只支持打开一个文件/diff/webview，每次打开新内容会覆盖当前内容。用户期望支持多 tab 页风格，允许同时打开多个文件页面并在其间切换。

## 需求

- 所有内容类型（file、markdown、diff、tool-diff、webview）都支持多 Tab
- 同一文件/diff 不重复打开，切换到已有 tab
- Tab 数量无上限，超出宽度时滚动显示
- 关闭最后一个 tab 时隐藏面板

## 方案：统一 Tab 模型

### 数据模型

```ts
interface InfoPanelTab {
  id: string
  type: 'file' | 'markdown' | 'diff' | 'tool-diff' | 'webview'
  title: string
  icon: any
  data: FileInfo | ToolDiffData | WebviewTabData | null
  closeable: boolean
}

interface WebviewTabData {
  url: string
  history: string[]
  historyIndex: number
  title: string
}
```

### 去重 Key 策略

| 类型 | 去重 Key | 示例 |
|------|----------|------|
| file | 文件路径 | `file::src/stores/app.ts` |
| markdown | 文件路径 | `markdown::README.md` |
| tool-diff | toolCallId | `tool-diff::call_abc123` |
| diff | SCM 文件路径 | `diff::src/main.ts` |
| webview | URL | `webview::https://example.com` |

### Store 变更

**新增状态**：
- `infoPanelTabs: InfoPanelTab[]`
- `activeInfoTabId: string | null`

**新增方法**：
- `openInfoTab(tab)` — 打开/切换到 tab
- `closeInfoTab(tabId)` — 关闭 tab
- `closeAllInfoTabs()` — 关闭所有 tab 并隐藏面板

**兼容计算属性**（子组件零改动）：
- `currentFile` → 从 active tab data 派生
- `toolDiffData` → 从 active tab data 派生
- `infoPanelMode` → 从 active tab type 派生
- `webviewUrl` / `webviewHistory` / `currentHistoryIndex` / `webviewTitle` → 从 active webview tab data 派生

### 组件架构

- 新增 `InfoPanelTabBar.vue` — Tab 栏，风格与 `SessionTabBar` 一致
- 重构 `InfoPanel.vue` — 移除旧 `panel-header`，集成 TabBar
- Webview 导航栏移入 webview 内容区内部

### 关闭 Tab 行为

1. 关闭当前活跃 tab → 激活相邻 tab（优先右侧，其次左侧）
2. 关闭非活跃 tab → 不影响当前活跃 tab
3. 关闭最后一个 tab → 隐藏整个面板
4. 点击面板 × 按钮 → 清空所有 tab，隐藏面板

### 改动文件清单

| 文件 | 改动类型 |
|------|---------|
| `src/stores/app.ts` | 重构 |
| `src/components/layout/InfoPanel.vue` | 重构 |
| `src/components/layout/InfoPanelTabBar.vue` | 新增 |
| `src/components/scm/ScmPanel.vue` | 微调 |
| `src/i18n/locales/zh-CN.ts` | 微调 |
| `src/i18n/locales/en-US.ts` | 微调 |
| `src/App.vue` | 微调（移除 InfoPanel mode prop） |

子组件（CodeViewer、DiffViewer、MarkdownViewer、ToolDiffViewer）和 ToolCard 组件无需改动。
