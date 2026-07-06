# SpaceCode 设计系统与聊天输入框优化设计文档

> 状态：已与用户确认
> 日期：2026-07-05
> 依赖：2026-07-05-open-design-pickers-replication-design.md

## 1. 背景与目标

在前期复刻 open-design 选择器的基础上，用户发现当前 `DesignComposer` 布局与 open-design 首页聊天输入区仍有差距，且设计系统预览弹窗的展示逻辑需要更清晰。本规格对以下两点进行优化：

1. **聊天输入框布局**：将模板选择器内置于输入框，设计系统与工作目录放在输入框下方，`+` 按钮作为更多功能入口，移除输入框上方的 skill 弹窗。
2. **设计系统预览弹窗**：明确 Showcase / Token / DESIGN.md 三个 Tab 的内容与布局。

## 2. 范围

**包含**：
- `DesignComposer.vue` 布局重构
- `TemplatePicker.vue` 触发形态调整（从底部工具栏按钮变为输入框内 chip）
- `DesignSystemPicker.vue` 与 `DesignSystemPreviewModal.vue` 细节保持并微调
- 新增 / 调整 i18n 翻译键
- 相关组件测试更新

**不包含**：
- 新增工作目录选择器功能（若当前无该组件，则保留占位或复用现有目录选择逻辑）
- 社区、插件市场等功能

## 3. 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| + 按钮位置 | textarea 内部最左侧 | 用户确认 open-design 中 + 在模板左侧 |
| 模板选择器形态 | 输入框内 chip | 与 open-design 输入框融合风格一致 |
| 设计系统/工作目录位置 | 输入框下方一行排列 | 用户确认 |
| Skill 弹窗 | 移除原有输入框上方弹窗 | 用户认为没有必要；Skill 入口合并到 + 菜单 |
| 预览弹窗 Tabs | Showcase / Token / DESIGN.md | 用户认可推荐方案 |

## 4. 组件架构

### 4.1 DesignComposer.vue

```
DesignComposer.vue
├── composer-input-wrap
│   ├── plus-btn（+ 按钮）
│   ├── template-chip（TemplatePicker 紧凑触发器）
│   ├── <textarea> composer-input
│   └── send-btn（发送 / 停止按钮）
└── composer-toolbar-bottom
    ├── DesignSystemPicker.vue
    └── WorkingDirectoryPicker.vue（或现有目录选择器占位）
```

### 4.2 + 菜单（新增/复用）

点击 `+` 展开浮层，包含：
- Skill 切换入口（原 toolboxSkills）
- 附件上传入口（预留）
- MCP 工具入口（预留）

### 4.3 设计系统下拉与预览弹窗

保持不变的核心结构：
- `DesignSystemPicker.vue`：左侧列表 + 右侧预览卡片
- `DesignSystemPreviewModal.vue`：全屏弹窗 + Tabs

## 5. UI 规格

### 5.1 输入框区域

```
┌────────────────────────────────────────────────────┐
│ [+][原型 ▼]  描述你要生成的设计...            [发送] │
└────────────────────────────────────────────────────┘
[设计系统: Agentic ▼][工作目录: /project ▼]
```

- 外框：圆角容器，使用 `--surface-border` 边框、`--bg-primary` 背景
- `+` 按钮：24×24，圆角，居左
- 模板 chip：显示模板场景图 + 模板名 + 下拉箭头；未选择时显示"模板 无"
- textarea：无边框，自动高度，占位文案使用 `design.emptyChatHint`
- 发送按钮：位于 textarea 内部右侧，禁用态透明 50%

### 5.2 底部工具栏

- 设计系统选择器：左侧，pill 形状，显示 palette 图标 + 系统名
- 工作目录选择器：右侧，pill 形状，显示 folder 图标 + 目录名
- 两者在窄屏时允许换行或省略

### 5.3 设计系统下拉

保持现有两栏布局：
- 左栏：搜索 + "不指定" 选项 + 系统列表
- 右栏：预览卡片
  - 系统名称、分类
  - 描述（最多 3 行）
  - 色板圆点（6-8 个）
  - 网页缩略图 iframe
  - "打开预览"按钮

### 5.4 设计系统预览弹窗

顶部 Tabs：**Showcase | Token | DESIGN.md**

- **Showcase**：
  - 左侧：网页预览 iframe，占主要空间
  - 右侧：DESIGN.md 渲染内容，宽度 360px，可收起
  - 顶部提供 "DESIGN.md" 切换按钮用于显示/隐藏右侧边栏

- **Token**：
  - 全屏展示设计令牌
  - 颜色 swatch 网格
  - 字体大小、字重、行高示例
  - 间距、圆角、阴影等变量表格

- **DESIGN.md**：
  - 全屏 markdown 渲染
  - 适合完整阅读设计规范

## 6. 数据流

### 6.1 模板选择

- 用户点击输入框内模板 chip → 展开模板面板
- 选择模板后：
  - 更新 `designStore.selectedTemplateId`
  - 若模板 `defaultSkillId` 与当前 skill 不同，自动切换 skill
  - 关闭面板

### 6.2 设计系统选择

- 用户点击底部设计系统选择器 → 展开两栏面板
- 选择系统后：
  - 更新 `designStore.selectedDesignSystemId`
  - 若已有活跃会话，调用 `switchDesignSystem` 重新注入 system prompt

### 6.3 + 菜单

- 点击 `+` 展开浮层
- Skill 子面板展示 `toolboxSkills`
- 选择 skill 后：
  - 调用 `switchToolboxSkill`
  - 关闭浮层

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| 无工作目录选择器 | 底部仅显示设计系统选择器，工作目录入口延后实现 |
| 模板无默认 skill | 回退到 `huashu-design` |
| 设计系统文件缺失 | 预览区显示占位文案，不影响选择 |

## 8. 测试计划

- `DesignComposer.test.ts`：验证 + 按钮、模板 chip、发送按钮、底部工具栏渲染
- `TemplatePicker.test.ts`：更新触发器形态相关断言
- `DesignSystemPicker.test.ts` / `DesignSystemPreviewModal.test.ts`：保持现有测试，视 UI 微调更新断言
- `useDesignSession.test.ts`：验证模板切换 skill 逻辑

## 9. 待实现计划

本规格通过用户审查后，调用 `writing-plans` 技能生成详细实现计划。
