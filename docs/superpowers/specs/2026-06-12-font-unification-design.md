# 字体统一配置设计

## 问题

设置页面和主聊天页面的字体不统一，根本原因：

1. **CSS 变量名不匹配** — 设置页面写入 `--font-family-base`、`--font-family-mono`、`--font-size-base`，但全局样式读取的是 `--font-body`、`--font-mono`，且 `--font-size-base` 无消费者
2. **硬编码问题** — 聊天消息 `14px`、输入框 `15px`、Markdown 代码块字体族均为硬编码，不读 CSS 变量
3. **默认字体不同** — 设置页面"系统默认"映射到 Segoe UI 等，全局 CSS 默认是 IBM Plex Sans

## 方案：引入全局字体 Store

### 架构

```
用户修改设置 → AppearanceSettings 更新 settingsStore → fontStore 监听变化 →
fontStore.applyFontSettings() 写入 CSS 变量 → 所有组件通过 CSS 变量读取字体
```

### 新增文件

#### `src/stores/font.ts`

Pinia store，职责：
- 管理字体配置状态（fontSize、fontFamily、codeFontFamily）
- 提供 `applyFontSettings()` 方法，统一将字体配置写入 CSS 变量
- 在 store 初始化时自动从 settings store 读取配置并应用
- 监听 settingsStore.appearance 变化，自动更新 CSS 变量

写入的 CSS 变量名（与全局样式对齐）：
- `--font-body` — UI 正文字体
- `--font-mono` — 代码字体
- `--font-size-base` — 基础字号
- `--font-display` — 标题字体（跟随 UI 字体选择）

字体映射表（从 AppearanceSettings.vue 迁移）：

**UI 字体映射：**
| id | CSS font-family |
|----|----------------|
| system | -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif |
| inter | "Inter", -apple-system, BlinkMacSystemFont, sans-serif |
| sf-pro | "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif |
| segoe | "Segoe UI", Tahoma, Geneva, Verdana, sans-serif |

**代码字体映射：**
| id | CSS font-family |
|----|----------------|
| jetbrains | "JetBrains Mono", "Fira Code", monospace |
| fira | "Fira Code", "JetBrains Mono", monospace |
| cascadia | "Cascadia Code", "Fira Code", monospace |
| source-code | "Source Code Pro", monospace |
| consolas | Consolas, Monaco, monospace |

### 修改文件

#### 1. `src/styles/global.scss`

- `html, body` 的 `font-size: 14px` → `font-size: var(--font-size-base, 14px)`
- `pre` 的 `font-size: 13px` → `font-size: calc(var(--font-size-base, 14px) - 1px)`

#### 2. `src/components/common/MarkdownRenderer.vue`

- `.markdown-renderer` 的 `font-size: 14px` → `font-size: var(--font-size-base, 14px)`
- 代码块 `font-family` 硬编码 → `var(--font-mono)`
- 代码块 `font-size: 13px` → `calc(var(--font-size-base, 14px) - 1px)`
- 行内代码 `font-size: 13px` → `calc(var(--font-size-base, 14px) - 1px)`
- 文件链接 `font-family` 硬编码 → `var(--font-mono)`
- Mermaid 容器 `font-family` 硬编码 → `var(--font-mono)`

#### 3. `src/components/chat/ChatInput.vue`

- `.inline-editor` 的 `font-size: 15px` → `calc(var(--font-size-base, 14px) + 1px)`

#### 4. `src/components/chat/MessageItem.vue`

- `.message-content` 的 `font-size: 14px` → `var(--font-size-base, 14px)`

#### 5. `src/components/settings/AppearanceSettings.vue`

- 移除 `applyFontSettings()` 函数
- 移除 `fontFamilyMap` 和 `codeFontMap` 常量
- 改为调用 `fontStore.applyFontSettings()`
- watch 中不再直接操作 DOM，改为更新 fontStore 状态

#### 6. `src/App.vue`

- 在 `onMounted` 中初始化 `fontStore`，确保应用启动时字体配置即生效

### 不修改

- `_variables.scss` — 保留默认值作为 fallback
- 字体选项列表 — 保留现有 4 种 UI 字体 + 5 种代码字体
- 字体资源文件 — 不新增字体 woff2 文件
