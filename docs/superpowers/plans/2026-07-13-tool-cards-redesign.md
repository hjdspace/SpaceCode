# 工具卡片 UI 重设计实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 `src/components/chat/tools/` 下除 `AgentToolCard.vue` 和 `AskUserQuestionToolCard.vue` 之外的 10 个工具卡片，统一改为 V2 混合样式（折叠态行内文本行 + 展开态卡片容器），并增强 Read 工具对 README/Markdown 的渲染。

**架构：** 所有工具卡片复用同一套 `.tool-header` / `.tool-body` / `.tool-section` CSS 类名与展开状态逻辑；通过 `isExpanded` 本地状态控制折叠/展开；`ReadToolCard` 根据文件后缀/名称决定是否使用 `MarkdownRenderer`。所有改动仅影响模板与样式，不改动 props、事件、IPC 调用与数据处理逻辑。

**技术栈：** Vue 3 + TypeScript + scoped SCSS + vue-i18n + highlight.js + MarkdownRenderer

---

## 文件清单

| 文件 | 职责 |
|---|---|
| `src/components/chat/tools/AgentToolCard.vue` | 参考样式（已完成，不修改） |
| `src/components/chat/tools/BashToolCard.vue` | Bash 命令卡片，需重写头部与终端输出容器 |
| `src/components/chat/tools/ReadToolCard.vue` | 读取文件卡片，需重写头部、Markdown/README 渲染分支 |
| `src/components/chat/tools/WriteToolCard.vue` | 写入文件卡片，需重写头部与写入内容预览 |
| `src/components/chat/tools/EditToolCard.vue` | 编辑文件卡片，需重写头部与 diff 展示 |
| `src/components/chat/tools/GlobToolCard.vue` | Glob 匹配卡片，需重写头部与结果列表 |
| `src/components/chat/tools/GrepToolCard.vue` | Grep 匹配卡片，需重写头部与结果列表 |
| `src/components/chat/tools/SkillToolCard.vue` | Skill 技能卡片，需重写头部与技能输出 |
| `src/components/chat/tools/WebSearchToolCard.vue` | WebSearch 卡片，需重写头部与搜索结果 |
| `src/components/chat/tools/WebFetchToolCard.vue` | WebFetch 卡片，需重写头部与页面内容 |
| `src/components/chat/tools/BrowserUseToolCard.vue` | BrowserUse 卡片，需重写头部与截图/结果 |
| `src/i18n/locales/zh-CN.ts` | 新增/调整 toolCards 命名空间键 |
| `src/i18n/locales/en-US.ts` | 新增/调整 toolCards 命名空间键 |
| `src/components/chat/tools/common.scss` | （可选）提取通用工具卡片样式 mixin |

---

## 前置任务：创建共享样式（可选但推荐）

**文件：**
- 创建：`src/components/chat/tools/tool-card.scss`
- 修改：无

**说明：** 由于 10 个组件都需要相同的 `.tool-header` / `.tool-body` / `.tool-section` 结构，先提取为可复用的 SCSS 文件，避免 10 份重复样式。若项目已有共享样式偏好，可将这些类写入 `src/styles/components/_tool-card.scss` 并导入。

```scss
// src/components/chat/tools/tool-card.scss
.tool-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  max-width: 100%;
  font-size: 13px;

  &:hover,
  &.is-expanded {
    background: var(--surface-glass-hover);
  }
}

.tool-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);

  &.status-running { color: var(--accent-tertiary); animation: tool-spin 1s linear infinite; }
  &.status-completed { color: var(--success); }
  &.status-error { color: var(--error); }
}

@keyframes tool-spin { to { transform: rotate(360deg); } }

.tool-label { font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
.tool-separator { font-size: 13px; color: var(--text-disabled); flex-shrink: 0; }
.tool-target {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
  font-family: var(--font-mono);
}
.tool-meta { font-size: 11px; color: var(--text-disabled); flex-shrink: 0; }

.tool-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.5;
  transition: transform 150ms ease, opacity 150ms ease;

  .tool-header:hover & { opacity: 0.8; }
  &.is-expanded { transform: rotate(180deg); }
}

.tool-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 150ms ease;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.tool-body {
  margin-top: 6px;
  margin-left: 8px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--bg-secondary);
  overflow: hidden;
  max-width: calc(100% - 8px);
}

.tool-section {
  border-bottom: 1px solid var(--surface-border);
  &:last-child { border-bottom: none; }
}

.tool-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tool-section-body {
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}
```

---

## 任务 1：BashToolCard

**文件：**
- 修改：`src/components/chat/tools/BashToolCard.vue`
- 测试：`src/components/chat/tools/__tests__/BashToolCard.spec.ts`（如存在则更新；否则跳过）

**要求：**
- 折叠态：`Bash · <command> · <duration>`，右侧保留终端打开按钮（仅 interactive 命令）。
- 展开态：终端窗口放入 `.tool-body > .tool-section`，section 标题为 `t('toolCards.commandOutput')`。
- 保持现有的命令截断、退出码、错误态逻辑不变。

- [ ] **步骤 1：修改模板头部为 `.tool-header` 行内结构**
- [ ] **步骤 2：将终端输出移入 `.tool-body > .tool-section`**
- [ ] **步骤 3：调整 scoped SCSS，导入共享样式或复写类名**
- [ ] **步骤 4：运行类型检查 `npx vue-tsc --noEmit`**
- [ ] **步骤 5：提交 commit**

---

## 任务 2：ReadToolCard（含 Markdown 渲染）

**文件：**
- 修改：`src/components/chat/tools/ReadToolCard.vue`
- 修改：`src/i18n/locales/zh-CN.ts`
- 修改：`src/i18n/locales/en-US.ts`

**要求：**
- 折叠态：`Read · <file_path>`，右侧保留「在面板中打开」按钮。
- 展开态：
  - 元信息行：起始行 / 读取行数 / 输出行数。
  - 内容区：若文件为 Markdown（`.md`、`.markdown`、`README*`、`CHANGELOG*`），使用 `MarkdownRenderer` 渲染；否则保留代码高亮。
- 新增 `isMarkdownFile(path: string): boolean` 辅助函数。

- [ ] **步骤 1：在 script setup 中添加 `isMarkdownFile` 与 `isExpanded` 状态**
- [ ] **步骤 2：重写模板头部为 `.tool-header` 行内结构**
- [ ] **步骤 3：将文件内容区移入 `.tool-body > .tool-section`，添加 Markdown 渲染分支**
- [ ] **步骤 4：更新 i18n 键 `toolCards.fileContent`**
- [ ] **步骤 5：调整 scoped SCSS**
- [ ] **步骤 6：运行类型检查**
- [ ] **步骤 7：提交 commit**

---

## 任务 3：WriteToolCard

**文件：**
- 修改：`src/components/chat/tools/WriteToolCard.vue`
- 修改：`src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`

**要求：**
- 折叠态：`Write · <file_path> · <success/failure>`。
- 展开态：写入内容预览 + 工具结果输出，分别放入两个 `.tool-section`。

- [ ] **步骤 1：添加 `isExpanded` 状态**
- [ ] **步骤 2：重写头部与展开体模板**
- [ ] **步骤 3：更新 i18n 键 `toolCards.writeContentPreview`、`toolCards.writeResult`**
- [ ] **步骤 4：调整 scoped SCSS**
- [ ] **步骤 5：运行类型检查**
- [ ] **步骤 6：提交 commit**

---

## 任务 4：EditToolCard

**文件：**
- 修改：`src/components/chat/tools/EditToolCard.vue`
- 修改：`src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`

**要求：**
- 折叠态：`Edit · <file_path>`，右侧保留「在面板中打开」按钮。
- 展开态：优先使用 `DiffView` 展示 old/new diff；无 diff 数据时显示空状态；保留 result section。

- [ ] **步骤 1：添加 `isExpanded` 状态**
- [ ] **步骤 2：重写头部与展开体模板**
- [ ] **步骤 3：更新 i18n 键 `toolCards.editResult`**
- [ ] **步骤 4：调整 scoped SCSS**
- [ ] **步骤 5：运行类型检查**
- [ ] **步骤 6：提交 commit**

---

## 任务 5：GlobToolCard

**文件：**
- 修改：`src/components/chat/tools/GlobToolCard.vue`
- 修改：`src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`

**要求：**
- 折叠态：`Glob · <pattern>`。
- 展开态：匹配文件列表，使用 `pre/code` 或 ul/li 结构。

- [ ] **步骤 1：添加 `isExpanded` 状态**
- [ ] **步骤 2：重写头部与展开体模板**
- [ ] **步骤 3：更新 i18n 键 `toolCards.globResults`**
- [ ] **步骤 4：调整 scoped SCSS**
- [ ] **步骤 5：运行类型检查**
- [ ] **步骤 6：提交 commit**

---

## 任务 6：GrepToolCard

**文件：**
- 修改：`src/components/chat/tools/GrepToolCard.vue`
- 修改：`src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`

**要求：**
- 折叠态：`Grep · <pattern>`。
- 展开态：匹配结果列表。

- [ ] **步骤 1：添加 `isExpanded` 状态**
- [ ] **步骤 2：重写头部与展开体模板**
- [ ] **步骤 3：更新 i18n 键 `toolCards.grepResults`**
- [ ] **步骤 4：调整 scoped SCSS**
- [ ] **步骤 5：运行类型检查**
- [ ] **步骤 6：提交 commit**

---

## 任务 7：SkillToolCard

**文件：**
- 修改：`src/components/chat/tools/SkillToolCard.vue`
- 修改：`src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`

**要求：**
- 折叠态：`Skill · /<skill-name>`，运行中显示 spinner。
- 展开态：参数 section + 技能结果 section。

- [ ] **步骤 1：添加 `isExpanded` 状态**
- [ ] **步骤 2：重写头部与展开体模板**
- [ ] **步骤 3：更新 i18n 键 `toolCards.skillPromptArg`、`toolCards.skillResult`**
- [ ] **步骤 4：调整 scoped SCSS**
- [ ] **步骤 5：运行类型检查**
- [ ] **步骤 6：提交 commit**

---

## 任务 8：WebSearchToolCard

**文件：**
- 修改：`src/components/chat/tools/WebSearchToolCard.vue`
- 修改：`src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`

**要求：**
- 折叠态：`WebSearch · <query>`。
- 展开态：使用 `MarkdownRenderer` 渲染搜索结果。

- [ ] **步骤 1：添加 `isExpanded` 状态**
- [ ] **步骤 2：重写头部与展开体模板**
- [ ] **步骤 3：更新 i18n 键 `toolCards.webSearchResults`**
- [ ] **步骤 4：调整 scoped SCSS**
- [ ] **步骤 5：运行类型检查**
- [ ] **步骤 6：提交 commit**

---

## 任务 9：WebFetchToolCard

**文件：**
- 修改：`src/components/chat/tools/WebFetchToolCard.vue`
- 修改：`src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`

**要求：**
- 折叠态：`WebFetch · <url>`。
- 展开态：使用 `MarkdownRenderer` 渲染页面内容。

- [ ] **步骤 1：添加 `isExpanded` 状态**
- [ ] **步骤 2：重写头部与展开体模板**
- [ ] **步骤 3：更新 i18n 键 `toolCards.webFetchResult`**
- [ ] **步骤 4：调整 scoped SCSS**
- [ ] **步骤 5：运行类型检查**
- [ ] **步骤 6：提交 commit**

---

## 任务 10：BrowserUseToolCard

**文件：**
- 修改：`src/components/chat/tools/BrowserUseToolCard.vue`
- 修改：`src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`

**要求：**
- 折叠态：`Browser Use · <url/host> · <steps>`。
- 展开态：截图 section + URL/Title section + 结果 section + 错误 section（如适用）。

- [ ] **步骤 1：添加 `isExpanded` 状态**
- [ ] **步骤 2：重写头部与展开体模板**
- [ ] **步骤 3：更新 i18n 键 `toolCards.browserScreenshot`、`toolCards.browserUrl`、`toolCards.browserTitle`、`toolCards.browserResult`**
- [ ] **步骤 4：调整 scoped SCSS**
- [ ] **步骤 5：运行类型检查**
- [ ] **步骤 6：提交 commit**

---

## 集成与验证

**文件：** 所有已修改文件

- [ ] **步骤 1：运行完整类型检查 `npm run typecheck`**
- [ ] **步骤 2：运行构建 `npm run build`**
- [ ] **步骤 3：运行单元测试 `npx vitest run`**
- [ ] **步骤 4：手动验证各工具卡片折叠/展开态**
- [ ] **步骤 5：提交最终集成 commit**

---

## 自检结果

- **规格覆盖度：** V2 混合样式、10 个组件、Read Markdown 渲染、i18n、样式规范、验证清单均已对应任务。
- **占位符扫描：** 无 TODO / 待定 / 模糊描述；每个任务含具体文件与步骤。
- **类型一致性：** 统一使用 `isExpanded: boolean`、`.tool-header`、`.tool-body`、`.tool-section` 命名。
