# 字体统一配置实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 引入全局字体 Store，统一设置页面和聊天页面的字体配置，消除硬编码和变量名不匹配问题。

**架构：** 新建 `useFontStore` Pinia store 管理字体状态，在 App.vue 初始化时应用字体 CSS 变量，所有组件通过 CSS 变量消费字体设置。AppearanceSettings.vue 不再直接操作 DOM，改为更新 fontStore。

**技术栈：** Vue 3 + Pinia + SCSS + CSS Custom Properties

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/stores/font.ts` | 创建 | 字体状态管理 + CSS 变量写入 |
| `src/styles/global.scss` | 修改 | font-size 硬编码改 CSS 变量 |
| `src/styles/_variables.scss` | 修改 | 添加 `--font-size-base` 默认值 |
| `src/components/common/MarkdownRenderer.vue` | 修改 | 字体硬编码改 CSS 变量 |
| `src/components/chat/ChatInput.vue` | 修改 | 字体硬编码改 CSS 变量 |
| `src/components/chat/MessageItem.vue` | 修改 | 字体硬编码改 CSS 变量 |
| `src/components/settings/AppearanceSettings.vue` | 修改 | 移除直接 DOM 操作，改用 fontStore |
| `src/App.vue` | 修改 | 初始化 fontStore |

---

### 任务 1：创建 font store

**文件：**
- 创建：`src/stores/font.ts`

- [ ] **步骤 1：创建 `src/stores/font.ts`**

```typescript
import { defineStore } from 'pinia'
import { watch } from 'vue'
import { useSettingsStore } from './settings'

const fontFamilyMap: Record<string, string> = {
  'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  'inter': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  'sf-pro': '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
  'segoe': '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif'
}

const codeFontMap: Record<string, string> = {
  'jetbrains': '"JetBrains Mono", "Fira Code", monospace',
  'fira': '"Fira Code", "JetBrains Mono", monospace',
  'cascadia': '"Cascadia Code", "Fira Code", monospace',
  'source-code': '"Source Code Pro", monospace',
  'consolas': 'Consolas, Monaco, monospace'
}

export const useFontStore = defineStore('font', () => {
  const settingsStore = useSettingsStore()

  function applyFontSettings() {
    const { fontSize, fontFamily, codeFontFamily } = settingsStore.appearance

    document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`)
    document.documentElement.style.setProperty(
      '--font-body',
      fontFamilyMap[fontFamily] || fontFamilyMap['system']
    )
    document.documentElement.style.setProperty(
      '--font-mono',
      codeFontMap[codeFontFamily] || codeFontMap['jetbrains']
    )
    // 标题字体跟随 UI 字体选择
    document.documentElement.style.setProperty(
      '--font-display',
      fontFamilyMap[fontFamily] || fontFamilyMap['system']
    )
  }

  // 监听 settingsStore.appearance 中字体相关字段变化
  watch(
    () => ({
      fontSize: settingsStore.appearance.fontSize,
      fontFamily: settingsStore.appearance.fontFamily,
      codeFontFamily: settingsStore.appearance.codeFontFamily
    }),
    () => {
      applyFontSettings()
    },
    { immediate: true }
  )

  return {
    applyFontSettings
  }
})
```

- [ ] **步骤 2：Commit**

```bash
git add src/stores/font.ts
git commit -m "feat: add font store for unified font configuration"
```

---

### 任务 2：在 _variables.scss 中添加 --font-size-base 默认值

**文件：**
- 修改：`src/styles/_variables.scss:54-58`

- [ ] **步骤 1：在 `:root` 中添加 `--font-size-base` 默认值**

在 `:root` 块中，`--font-serif` 行之后添加：

```scss
  --font-size-base: 14px;
```

修改后的 `:root` 字体部分：
```scss
:root {
  --font-display: #{$font-display};
  --font-body: #{$font-body};
  --font-mono: #{$font-mono};
  --font-serif: 'Source Serif 4', Georgia, 'Times New Roman', serif;
  --font-size-base: 14px;
```

- [ ] **步骤 2：Commit**

```bash
git add src/styles/_variables.scss
git commit -m "feat: add --font-size-base CSS variable default"
```

---

### 任务 3：修改 global.scss 消除硬编码字号

**文件：**
- 修改：`src/styles/global.scss:19`
- 修改：`src/styles/global.scss:85`

- [ ] **步骤 1：修改 `html, body` 的 font-size**

将第 19 行：
```scss
  font-size: 14px;
```
改为：
```scss
  font-size: var(--font-size-base);
```

- [ ] **步骤 2：修改 `pre` 的 font-size**

将第 85 行：
```scss
  font-size: 13px;
```
改为：
```scss
  font-size: calc(var(--font-size-base) - 1px);
```

- [ ] **步骤 3：Commit**

```bash
git add src/styles/global.scss
git commit -m "fix: use CSS variable for font-size in global styles"
```

---

### 任务 4：修改 MarkdownRenderer.vue 消除硬编码字体

**文件：**
- 修改：`src/components/common/MarkdownRenderer.vue:446`
- 修改：`src/components/common/MarkdownRenderer.vue:493-494`
- 修改：`src/components/common/MarkdownRenderer.vue:505`
- 修改：`src/components/common/MarkdownRenderer.vue:615`
- 修改：`src/components/common/MarkdownRenderer.vue:650-651`

- [ ] **步骤 1：修改 `.markdown-renderer` 的 font-size**

将：
```scss
  font-size: 14px;
```
改为：
```scss
  font-size: var(--font-size-base);
```

- [ ] **步骤 2：修改代码块 `:deep(.code-block) code` 的 font-family 和 font-size**

将：
```scss
      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
      font-size: 13px;
```
改为：
```scss
      font-family: var(--font-mono);
      font-size: calc(var(--font-size-base) - 1px);
```

- [ ] **步骤 3：修改行内代码 `:deep(p code), :deep(li code)` 的 font-size**

将：
```scss
    font-size: 13px;
```
改为：
```scss
    font-size: calc(var(--font-size-base) - 1px);
```

- [ ] **步骤 4：修改文件链接 `:deep(.file-link)` 的 font-family**

将：
```scss
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
```
改为：
```scss
    font-family: var(--font-mono);
```

- [ ] **步骤 5：修改 Mermaid 容器 `:deep(.mermaid-container)` 的 font-family 和 font-size**

将：
```scss
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
    font-size: 13px;
```
改为：
```scss
    font-family: var(--font-mono);
    font-size: calc(var(--font-size-base) - 1px);
```

- [ ] **步骤 6：Commit**

```bash
git add src/components/common/MarkdownRenderer.vue
git commit -m "fix: use CSS variables for font in MarkdownRenderer"
```

---

### 任务 5：修改 ChatInput.vue 消除硬编码字号

**文件：**
- 修改：`src/components/chat/ChatInput.vue:3142`

- [ ] **步骤 1：修改 `.inline-editor` 的 font-size**

将：
```scss
    font-size: 15px;
```
改为：
```scss
    font-size: calc(var(--font-size-base) + 1px);
```

- [ ] **步骤 2：Commit**

```bash
git add src/components/chat/ChatInput.vue
git commit -m "fix: use CSS variable for font-size in ChatInput"
```

---

### 任务 6：修改 MessageItem.vue 消除硬编码字号

**文件：**
- 修改：`src/components/chat/MessageItem.vue:513`

- [ ] **步骤 1：修改 `.message-content` 的 font-size**

将：
```scss
  font-size: 14px;
```
改为：
```scss
  font-size: var(--font-size-base);
```

- [ ] **步骤 2：Commit**

```bash
git add src/components/chat/MessageItem.vue
git commit -m "fix: use CSS variable for font-size in MessageItem"
```

---

### 任务 7：修改 AppearanceSettings.vue 使用 fontStore

**文件：**
- 修改：`src/components/settings/AppearanceSettings.vue:319-338`
- 修改：`src/components/settings/AppearanceSettings.vue:382-392`

- [ ] **步骤 1：添加 fontStore 导入**

在 script 部分的 import 区域添加：
```typescript
import { useFontStore } from '@/stores/font'
```

在 setup 中添加：
```typescript
const fontStore = useFontStore()
```

- [ ] **步骤 2：移除 `applyFontSettings` 函数**

删除第 319-338 行的 `applyFontSettings` 函数（包括 `fontFamilyMap` 和 `codeFontMap` 常量）。

- [ ] **步骤 3：修改字体相关 watch**

将三个字体 watch（第 382-392 行）：
```typescript
watch(() => config.value.fontSize, () => {
  scheduleUpdate('fontSettings', () => applyFontSettings(config.value))
}, { immediate: true })

watch(() => config.value.fontFamily, () => {
  scheduleUpdate('fontSettings', () => applyFontSettings(config.value))
}, { immediate: true })

watch(() => config.value.codeFontFamily, () => {
  scheduleUpdate('fontSettings', () => applyFontSettings(config.value))
}, { immediate: true })
```

替换为：
```typescript
watch(() => config.value.fontSize, () => {
  fontStore.applyFontSettings()
}, { immediate: true })

watch(() => config.value.fontFamily, () => {
  fontStore.applyFontSettings()
}, { immediate: true })

watch(() => config.value.codeFontFamily, () => {
  fontStore.applyFontSettings()
}, { immediate: true })
```

- [ ] **步骤 4：Commit**

```bash
git add src/components/settings/AppearanceSettings.vue
git commit -m "refactor: use fontStore instead of direct DOM manipulation"
```

---

### 任务 8：在 App.vue 中初始化 fontStore

**文件：**
- 修改：`src/App.vue`

- [ ] **步骤 1：添加 fontStore 导入和初始化**

在 import 区域添加：
```typescript
import { useFontStore } from '@/stores/font'
```

在 `onMounted` 回调的开头添加：
```typescript
  // 初始化字体配置
  const fontStore = useFontStore()
  fontStore.applyFontSettings()
```

- [ ] **步骤 2：Commit**

```bash
git add src/App.vue
git commit -m "feat: initialize fontStore in App.vue onMounted"
```

---

### 任务 9：验证

- [ ] **步骤 1：运行 TypeScript 类型检查**

```bash
npx vue-tsc --noEmit
```

预期：无类型错误

- [ ] **步骤 2：启动开发服务器验证**

```bash
npm run dev
```

验证项：
1. 打开设置 → 外观，切换 UI 字体（system/Inter/SF Pro/Segoe UI），聊天页面字体应同步变化
2. 切换代码字体（JetBrains Mono/Fira Code 等），Markdown 代码块字体应同步变化
3. 调整字体大小（12-20），聊天消息、输入框、Markdown 渲染区字号应同步变化
4. 刷新页面后字体设置应保持（从 gui-settings.json 恢复）
