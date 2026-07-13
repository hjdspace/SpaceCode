# 工具卡片 UI 重设计规格

> 状态：待实现确认  
> 关联原型：
> - [tool-cards-redesign-v1-inline.html](../../../../docs/prototypes/tool-cards-redesign-v1-inline.html)
> - [tool-cards-redesign-v2-hybrid.html](../../../../docs/prototypes/tool-cards-redesign-v2-hybrid.html)
> - [tool-cards-redesign-v3-pills.html](../../../../docs/prototypes/tool-cards-redesign-v3-pills.html)

## 1. 目标与背景

Subagent 工具卡片（[`AgentToolCard.vue`](file:///D:/AI/SpaceCode/src/components/chat/tools/AgentToolCard.vue)）已改为时间线内可展开的行内文本行，视觉更轻量、与聊天时间线融为一体。本次任务将其他工具卡片统一对齐到该风格，同时保留各工具专业内容的可读性。

## 2. 范围

本次重设计覆盖以下组件：

| 组件 | 工具名 |
|---|---|
| `BashToolCard.vue` | Bash |
| `ReadToolCard.vue` | Read / FileRead |
| `WriteToolCard.vue` | Write / FileWrite |
| `EditToolCard.vue` | Edit / FileEdit |
| `GlobToolCard.vue` | Glob |
| `GrepToolCard.vue` | Grep |
| `SkillToolCard.vue` | Skill |
| `WebSearchToolCard.vue` | WebSearch |
| `WebFetchToolCard.vue` | WebFetch |
| `BrowserUseToolCard.vue` | browser_use / browse / scrape / screenshot / navigate / BrowserUse / browser-use |

**不在本次范围内：** `AskUserQuestionToolCard.vue` 保持现有交互卡片形态（它本质是权限/提问弹窗，不是信息展示卡片）；`AgentToolCard.vue` 已完成。

## 3. 设计方向

采用 **V2 混合样式**：

- **折叠态**：改为行内文本行，与 Subagent 卡片一致。
  - 元素顺序：工具图标 + 工具名 + 中点分隔符 `·` + 目标内容（命令/路径/查询/URL）+ 可选元信息（时长/行数/steps）+ 操作按钮 + 展开 chevron。
  - 无卡片背景、无大色块图标方块，hover 时仅显示轻微背景反馈。
  - 运行/完成/错误状态通过图标颜色表达（running 紫色 spinner、completed 绿色、error 红色）。
- **展开态**：使用圆角卡片容器承载富内容，保证终端、代码块、diff、搜索结果、浏览器截图等有清晰边界。
  - 容器使用 `--bg-secondary` 背景 + `--surface-border` 边框。
  - 内部可包含多个 section，每个 section 有 uppercase 小标题头栏。
- **过渡动画**：展开/折叠使用 150ms 的淡入 + 轻微下移动画。

## 4. 组件级规格

### 4.1 通用头部行

所有工具卡片共享以下头部结构：

```vue
<div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
  <ToolIcon :size="14" class="tool-icon" :class="statusClass" />
  <span class="tool-label">{{ t('toolCards.xxx') }}</span>
  <span class="tool-separator">·</span>
  <span class="tool-target">{{ targetDisplay }}</span>
  <span v-if="meta" class="tool-meta">{{ meta }}</span>
  <div class="tool-actions">
    <!-- 可选操作按钮 -->
    <button v-if="hasAction" class="action-btn" @click.stop="doAction">...</button>
    <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
  </div>
</div>
```

样式要求：
- `.tool-header`：`inline-flex`，`gap: 6px`，`padding: 4px 8px`，`border-radius: 6px`。
- hover / expanded：`background: var(--surface-glass-hover)`。
- `.tool-icon`：`14px × 14px`，默认 `--text-muted`；状态色通过 `.status-running`/`.status-completed`/`.status-error` 覆盖；running 带旋转动画。
- `.tool-label`：`13px`，`--text-secondary`，不全部大写，不加重。
- `.tool-target`：`13px`，`--text-muted`，单行截断，等宽字体。
- `.tool-meta`：`11px`，`--text-disabled`。
- `.tool-chevron`：`14px`，默认 `opacity: 0.5`，hover 0.8，展开旋转 180°。
- `.action-btn`：`20px × 20px`，透明背景，hover 显示轻微背景。

### 4.2 BashToolCard

- **折叠态**：`Bash · npm run build · 2.3s`，右侧保留「在终端中打开」按钮（仅对交互式命令显示）。
- **展开态**：保留终端窗口样式（traffic lights + title bar + command/output/exit code），放入 `.tool-section` 容器，section 标题为「命令输出」。
- 状态色：
  - running：图标紫色旋转。
  - completed：图标绿色。
  - error：图标红色，输出文字变红。
- 长输出仍走截断逻辑，截断提示放在退出码行右侧。

### 4.3 ReadToolCard

- **折叠态**：`Read · src/.../AgentToolCard.vue`，右侧保留「在面板中打开」按钮。
- **展开态**：
  - 头部显示元信息：起始行、读取行数、输出行数。
  - 内容区：根据文件类型决定渲染方式。
    - **Markdown / README**：使用 `MarkdownRenderer` 渲染，保留样式可配置能力。
    - **代码文件**：保留 `highlight.js` 代码高亮，背景为 `#0d1117`。
  - 默认 fallback：纯文本 pre/code。
- 新增 `isMarkdownFile(path)` 判断逻辑，可匹配 `.md`、`.markdown`、`README*`、`CHANGELOG*` 等常见 Markdown 文件名。
- 样式修改支持：Markdown 渲染容器应使用主题变量，避免硬编码颜色；必要时为工具卡片内的 Markdown 增加 scoped 样式覆盖。

### 4.4 WriteToolCard

- **折叠态**：`Write · src/.../foo.vue · 成功/失败`。
- **展开态**：
  - section 1：写入内容预览（代码高亮）。
  - section 2：工具结果输出（如有）。
- 保留「在面板中打开」按钮，支持 diff 预览。

### 4.5 EditToolCard

- **折叠态**：`Edit · src/.../path.ts`，右侧保留「在面板中打开」按钮。
- **展开态**：
  - 优先使用 `DiffView` 展示 old_string / new_string 的差异。
  - 无 diff 数据时显示空状态。
  - 保留 result 输出 section。

### 4.6 GlobToolCard / GrepToolCard

- **折叠态**：`Glob · **/*.ts` / `Grep · function use`。
- **展开态**：以列表形式展示匹配结果，使用 `pre/code` 或结构化列表。

### 4.7 SkillToolCard

- **折叠态**：`Skill · /skill-name`。
- **展开态**：
  - section 1：prompt 参数（如有）。
  - section 2：技能结果输出。

### 4.8 WebSearchToolCard / WebFetchToolCard

- **折叠态**：`WebSearch · query` / `WebFetch · https://...`。
- **展开态**：使用 MarkdownRenderer 渲染输出结果（通常为结构化文本或 markdown）。

### 4.9 BrowserUseToolCard

- **折叠态**：`Browser Use · github.com/... · 3 steps`。
- **展开态**：
  - section 1：截图预览（如有 base64 图片）。
  - section 2：URL / Title 信息。
  - section 3：工具结果文本。
  - section 4：错误信息（error 状态）。

## 5. i18n

所有可见文本继续使用 `vue-i18n` 的 `t()` 函数。需要新增/调整的键：

```typescript
// zh-CN.ts / en-US.ts 的 toolCards 命名空间
toolCards: {
  // 现有 label 保持，但文案可统一为首字母大写即可，不再全部大写
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  skill: 'Skill',
  webSearch: 'WebSearch',
  webFetch: 'WebFetch',
  browserUse: 'Browser Use',
  // section 标题
  commandOutput: '命令输出',
  fileContent: '文件内容',
  writeContentPreview: '写入内容',
  writeResult: '写入结果',
  editResult: '编辑结果',
  skillPromptArg: '参数',
  skillResult: '技能输出',
  webSearchResults: '搜索结果',
  webFetchResult: '页面内容',
  browserScreenshot: '页面截图',
  browserUrl: 'URL',
  browserTitle: '标题',
  browserResult: '页面结果',
  globResults: '匹配文件',
  grepResults: '匹配结果',
}
```

## 6. 样式规范

- 所有颜色使用项目 CSS 变量（`--bg-primary`、`--bg-secondary`、`--surface-border`、`--text-secondary`、`--text-muted` 等）。
- 代码/终端区域可继续保留深色背景（`#0d1117`），但外层容器必须跟随主题。
- 避免使用 `any` 类型；新增类型定义如需放在 `src/types/`。
- scoped SCSS，不引入新的全局样式。

## 7. 测试与验证

- 类型检查：`npx vue-tsc --noEmit` 通过。
- 构建：`npm run build` 通过。
- 单元测试：更新/补充现有组件测试（如有），确保折叠/展开状态、渲染逻辑正常。
- 手动验证：
  - 各工具卡片折叠态是否为行内文本行。
  - 展开后内容是否正确渲染。
  - README / Markdown 文件是否渲染为 HTML 而非纯代码。
  - 运行中、完成、错误三种状态图标颜色是否正确。
  - 操作按钮（在终端打开、在面板打开）是否可正常点击。

## 8. 实现计划概要

1. 创建共享样式/基础组件（可选：提取 `ToolCardBase` 或共享 SCSS mixin）。
2. 逐个重写上述 10 个工具卡片组件的模板与样式。
3. 增强 `ReadToolCard.vue` 的 Markdown 渲染逻辑。
4. 更新 i18n 文案。
5. 运行类型检查、构建、测试。
6. 手动验证并截图记录。

---

**自检结果：**
- 无占位符或 TODO。
- 范围明确：10 个工具卡片 + Read Markdown 渲染增强。
- i18n、样式、测试均已覆盖。
