# SpaceCode 复刻 open-design 首页选择器设计文档

> 状态：已与用户确认设计，待实现计划。
> 日期：2026-07-05
> 依赖：2026-07-04-design-mode-refactor-design.md

## 1. 背景与目标

SpaceCode 的设计模式（Design Mode）正在按 2026-07-04 规格重构为 open-design 形态的「左 ChatPane + 右 FileWorkspace」。当前 `DesignComposer` 底部缺少 open-design 首页的两个核心选择器：

1. **模板选择器**：左侧「模板 无」按钮，展开为带缩略图网格的模板面板
2. **设计系统选择器**：右侧「不指定设计系统」按钮，展开为搜索 + 右侧预览卡片的两栏浮层

本规格在 7 月 4 日重构基础上，完整复刻这两个选择器的 UI、交互和数据流。

## 2. 范围

**包含**：
- `DesignComposer` 底部工具栏重构
- 新建 `TemplatePicker.vue` 和 `DesignSystemPicker.vue`
- 模板数据定义与 skill 映射
- 设计系统列表接口扩展（description + preview）
- 模板/设计系统选择对 `composePromptStack` 和发送流程的影响
- 相关 i18n、单元测试、组件测试

**不包含**（按用户决策）：
- 社区功能（PluginsHomeSection / gallery）

## 3. 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 社区功能 | 暂不实现 | 用户明确选择 C |
| 实现深度 | 完整映射 + 扩展后端 | 用户选择 A |
| 组件集成方案 | 方案 2：完全复刻式 | 用户选择方案 2，底部工具栏完全对齐 open-design |
| 模板切换策略 | X：仅在下一条消息生效 | 不重新 init session，保留当前对话上下文 |
| 设计系统切换 | 立即重新注入 system prompt | 通过 `switchDesignSystem` 重新 `composePromptStack` + `initClaudeCodeSession` |

## 4. 组件架构

```
DesignComposer.vue
├── composer-toolbar-top
│   ├── + 按钮 → DesignToolboxPanel（skill/MCP/附件入口）
│   ├── skill 标签（可选，显示当前 skill）
│   └── 发送 / 停止按钮
├── <textarea> composer-input
└── composer-toolbar-bottom
    ├── TemplatePicker.vue      # 左侧：模板选择器
    └── DesignSystemPicker.vue  # 右侧：设计系统选择器
```

### 4.1 新建组件

- `src/components/design/TemplatePicker.vue`
- `src/components/design/DesignSystemPicker.vue`
- `src/lib/design/templates.ts`
- `src/utils/design/__tests__/templateMap.test.ts`

### 4.2 改造组件

- `src/components/design/DesignComposer.vue`：重写底部工具栏，保留顶部 + 按钮和发送区
- `src/stores/design.ts`：新增 `selectedTemplateId`、`selectedDesignSystemId`
- `src/composables/useDesignSession.ts`：`createDesignSession` 传入 `designSystemId`；新增 `switchDesignSystem`
- `electron/design/promptStack.ts`：扩展 `design:list-systems` 返回值
- `src/services/electronAPI.ts`：同步返回类型
- `src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`：新增翻译键

## 5. 数据流

### 5.1 首次发送

```
用户输入 → 点击发送
  → DesignComposer 检查 activeSessionId
  → 无会话 → useDesignSession.createDesignSession()
       1. workspace = userData/design-workspace/{timestamp}
       2. session = chatSessionStore.createSession('Design Session', workspace)
       3. session.mode = 'design'
       4. systemPrompt = api.design.composePromptStack({
            skillName: selectedToolboxSkillId,
            designSystemId: selectedDesignSystemId,
            locale: 'zh-CN'
          })
       5. chatSessionStore.initClaudeCodeSession(session.id, { systemPrompt, cwd: workspace, agent: 'ui-ux-pro-max' })
       6. api.design.startFileWatcher(session.id, workspace)
       7. designStore.activeSessionId = session.id
  → chatStore.sendMessage(content)
       - 若 selectedTemplateId 存在，在 content 前拼接模板前置提示词
```

### 5.2 模板选择（已存在会话）

- 更新 `designStore.selectedTemplateId`
- **不重新 init session**
- 下一条用户消息自动拼接模板前置提示词

### 5.3 设计系统选择（已存在会话）

- 更新 `designStore.selectedDesignSystemId`
- 调用 `useDesignSession.switchDesignSystem(systemId)`
- 重新 `composePromptStack` + `initClaudeCodeSession`
- 给用户一个轻提示："设计系统已切换，将在后续回复中生效"

## 6. 模板定义与映射

`src/lib/design/templates.ts`：

```ts
export interface DesignTemplate {
  id: string
  labelKey: string
  descriptionKey: string
  icon: string
  defaultSkillId: string
  defaultDesignSystemId?: string
  preambleTemplate: string
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'prototype',
    labelKey: 'design.template.prototype',
    descriptionKey: 'design.template.prototypeDesc',
    icon: 'palette',
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成交互式 Web 应用原型，包含可点击的页面流程。'
  },
  {
    id: 'wireframe',
    labelKey: 'design.template.wireframe',
    descriptionKey: 'design.template.wireframeDesc',
    icon: 'layout',
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成低保真线框图，只关注信息结构与页面流程，不要高保真视觉。'
  },
  {
    id: 'mobile',
    labelKey: 'design.template.mobile',
    descriptionKey: 'design.template.mobileDesc',
    icon: 'smartphone',
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成 iOS 与 Android 移动应用界面设计。'
  },
  {
    id: 'deck',
    labelKey: 'design.template.deck',
    descriptionKey: 'design.template.deckDesc',
    icon: 'presentation',
    defaultSkillId: 'html-ppt-skill',
    preambleTemplate: '请生成一套幻灯片演示文稿。'
  },
  {
    id: 'document',
    labelKey: 'design.template.document',
    descriptionKey: 'design.template.documentDesc',
    icon: 'file-text',
    defaultSkillId: 'huashu-design',
    preambleTemplate: '请生成一份文档（简历、报告或 PDF）。'
  },
  {
    id: 'hyperframes',
    labelKey: 'design.template.hyperframes',
    descriptionKey: 'design.template.hyperframesDesc',
    icon: 'orbit',
    defaultSkillId: 'canvas-design',
    preambleTemplate: '请生成基于 HTML 的动态图形或循环动画。'
  },
  {
    id: 'live-artifact',
    labelKey: 'design.template.liveArtifact',
    descriptionKey: 'design.template.liveArtifactDesc',
    icon: 'activity',
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成一个数据驱动的实时看板。'
  },
  {
    id: 'image',
    labelKey: 'design.template.image',
    descriptionKey: 'design.template.imageDesc',
    icon: 'image',
    defaultSkillId: 'huashu-design',
    preambleTemplate: '请生成一张海报、图形或插画。'
  },
  {
    id: 'video',
    labelKey: 'design.template.video',
    descriptionKey: 'design.template.videoDesc',
    icon: 'video',
    defaultSkillId: 'canvas-design',
    preambleTemplate: '请生成一个短视频、Reels 或宣传片。'
  },
  {
    id: 'audio',
    labelKey: 'design.template.audio',
    descriptionKey: 'design.template.audioDesc',
    icon: 'audio-waveform',
    defaultSkillId: 'huashu-design',
    preambleTemplate: '请生成音频相关设计或配音脚本。'
  }
]
```

模板切换时，若 `defaultSkillId` 与当前 `selectedToolboxSkillId` 不同，同步更新 skill。

## 7. 设计系统列表扩展

当前 `electron/design/promptStack.ts` 中 `design:list-systems` 返回：

```ts
{ id: string; name: string; category: string }
```

扩展为：

```ts
export interface DesignSystemSummary {
  id: string
  name: string
  category: string
  description?: string
  previewPages?: Array<{ role: string; title: string; path: string }>
}
```

实现逻辑：

1. 扫描 `design-systems-lib/<id>/manifest.json`
2. 读取 `description`、`preview.pages`
3. 无 manifest 时 fallback 到解析 `DESIGN.md` 第一行作为 name，`> Category:` 行作为 category
4. 读取失败返回内置 fallback（4 个默认系统）

## 8. UI 规格

### 8.1 TemplatePicker

- 触发按钮：左侧显示模板图标 + "模板" + 当前模板名（默认"无"）
- 浮层：搜索框 + "清除"按钮 + 网格卡片
- 每个卡片：图标 + 标题 + 描述
- 选中态：边框高亮
- 键盘：Esc 关闭，Enter 选择

### 8.2 DesignSystemPicker

- 触发按钮：右侧显示 palette 图标 + "不指定设计系统" 或当前系统名
- 浮层：两栏布局
  - 左栏：搜索框 + "清除" + "创建"（禁用，hover 提示"暂不支持创建设计系统"）+ "不指定"选项 + 按 category 分组列表
  - 右栏：预览卡片，显示系统名、分类、描述；若 `previewPages` 存在，显示文件路径列表（不加载 iframe，避免沙箱性能问题）；否则显示文字简介
- 悬停/选中系统时右栏实时切换预览
- 键盘：Esc 关闭，Enter 选择

## 9. 与 7 月 4 日重构的兼容

- `toolboxSkills` 与 `selectedToolboxSkillId` 保留
- `+` 按钮菜单中增加 Skill 子面板，显示 `toolboxSkills`
- 选择模板时，若 `defaultSkillId` 与当前不同，自动切换 skill
- 设计系统选择作为 `composePromptStack` 的 `designSystemId` 参数传入
- `DesignChatPane` 空态文案更新，提示用户可以选择模板和设计系统

## 10. 错误处理

| 场景 | 行为 |
|---|---|
| `listSystems` 失败 | 显示内置 fallback 列表（4 个默认系统） |
| 模板 `defaultSkillId` 不存在 | 回退到 `huashu-design` |
| 设计系统文件缺失 | 允许选择，`composePromptStack` 使用默认 DESIGN.md |
| 用户清空模板 | `selectedTemplateId = null`，后续消息不再拼接前置提示词 |
| 用户清空设计系统 | `selectedDesignSystemId = null`，`composePromptStack` 不传 designSystemId |

## 11. 测试计划

### 11.1 单元测试

- `src/utils/design/__tests__/templateMap.test.ts`
  - 每个 `DESIGN_TEMPLATES` 的 `defaultSkillId` 都存在于 `toolboxSkills`
  - `buildPreamble(templateId, designSystemId)` 输出包含模板前缀和设计系统名称
  - 未知 templateId 返回空字符串

### 11.2 组件测试

- `src/components/design/__tests__/TemplatePicker.test.ts`
  - 打开后渲染 10 个模板卡片
  - 搜索过滤按标题/描述匹配
  - 点击卡片触发 `onPick` 并关闭浮层

- `src/components/design/__tests__/DesignSystemPicker.test.ts`
  - 打开后渲染分组列表
  - 搜索过滤按名称/分类/描述匹配
  - 悬停系统更新右栏预览
  - 选择后触发 `onChange`

### 11.3 集成测试

- `src/composables/__tests__/useDesignSession.test.ts`
  - `createDesignSession` 在 `selectedDesignSystemId` 非空时调用 `composePromptStack` 传入 `designSystemId`
  - `switchDesignSystem` 重新 init session

## 12. 待实现计划

本规格通过用户审查后，调用 `writing-plans` 技能生成详细实现计划。