# 设计模式（Design Mode）重构：复刻 open-design 聊天界面

> 状态：已与用户确认设计，待评审 spec 后进入实现计划。
> 日期：2026-07-04

## 1. 背景与目标

SpaceCode 的设计页面（`mode === 'design'`）声称复刻自开源项目 `D:\AI\open-design`，但当前打开后呈现的是**三栏 Studio 工作台**（左 Brief 表单 + 中 iframe 预览 + 右工件列表），**不是聊天界面**。聊天被剥离到后台：`useDesignSession` 在后台创建 `mode='design'` 的 chat 会话驱动引擎，前端完全不显示 MessageList/ChatInput。

用户诉求：打开设计页面应看到**与 open-design 一致的聊天界面**，并复刻 open-design 的大部分能力。

**目标**：
1. 把 DesignPage 从三栏 Studio 重构为 open-design 形态的「左 ChatPane + 右 FileWorkspace」分屏
2. 复用 SpaceCode 已有的聊天组件群（MessageList/AgentTimeline/RetryIndicator/ToolCallCard 等）
3. 复刻 open-design 第 1+2 层能力（见第 5 节交付清单）
4. 保留 SpaceCode 独有的 design system prompt 栈与 skill 体系，作为 design 模式会话级注入

## 2. 现状分析

### 2.1 SpaceCode 现状

- **技术栈**：Vue 3.4 + Electron 29 + Pinia 2 + vue-i18n 9 + Vite 5（非 Tauri/React）
- **设计页面入口**：无 vue-router，`src/App.vue:34` 用 `appStore.mode === 'design'` 条件渲染 `DesignPage.vue`
- **当前 DesignPage**：524 行三栏 Studio，完全无聊天 UI；Brief 通过 `useDesignSession.startDesignGeneration()` 注入后台 chat 会话
- **聊天零件已就绪**（`src/components/chat/`）：MessageList、MessageItem、ChatInput、AgentTimeline、RetryIndicator、ReasoningCard、ToolCallCard、ToolCallList、SessionTabBar
- **聊天 store**：`chat.ts`（Proxy 组合）→ `chatSession.ts` + `chatStream.ts` + `chatControl.ts`；`chatStream.sendMessage` 已处理 createSession → initClaudeCodeSession → IPC sendMessage 全流程
- **沙箱协议已复刻**：`src/lib/artifacts/srcdoc.ts` 复刻 open-design 的 `od:` 前缀消息（`od:sandbox:ready` 等）
- **QuestionForm 已实现**：`src/utils/design/questionForm.ts` 解析 `<question-form>` 标签，`QuestionForm.vue` 渲染（当前作为浮层）
- **design system prompt**：`api.design.composePromptStack()` 拼装 23 层设计专用提示词栈，`initClaudeCodeSession({ systemPrompt, cwd, agent })` 注入

### 2.2 open-design 现状（参考目标）

- **技术栈**：Next.js 16 + React 18（与 SpaceCode 不同栈，故"复刻"指形态/架构复刻，非代码拷贝）
- **聊天界面**：`ProjectView` → 左 `<ChatPane>` + 右 `<FileWorkspace>` 分屏
- **核心抽象**：`ChatMessage.events: PersistedAgentEvent[]` 作为单一真相源；`AssistantMessage.buildBlocks` 把事件流交错切成 text/thinking/tool-group/live-tool/status/plugin-candidate 块
- **ToolCard**：family ladder + 注册表（TodoCard/FileWriteCard/FileEditCard/BashCard 等），第三方可 `registerToolRenderer` 覆盖
- **特色能力**：Live tool input（流式期间实时显示部分代码）、QuestionForm（`<question-form>` 标签）、OdCard（结构化嵌入卡）、NextStepActions（轮次后建议动作）、Side chat、TerminalViewer、CritiqueTheater
- **通信**：HTTP REST + SSE（fetch streaming，非 EventSource，断线重连 5 次）
- **样式**：plain CSS + CSS 变量（design tokens），无 Tailwind

### 2.3 根因

SpaceCode 复刻了 open-design 的**沙箱协议**，但**没有复刻 UI 编排**——DesignPage 自创了 Studio 三栏，把聊天藏到后台。所以"打开后不是聊天界面"。

## 3. 决策记录

### 决策 1：驱动方式 — 纯聊天驱动 + 设计卡片

- **选择**：弃用现有 Brief/Design System/Skill Persona/5 大视觉方向这套启动表单，改为纯聊天驱动；参考 open-design 在对话流里嵌入结构化"设计卡片"（OdCard / QuestionForm）
- **理由**：用户明确选择 A + 增加设计卡片。open-design 本身是纯聊天驱动，无表单启动器
- **保留**：design system prompt 栈与 skill 体系作为会话级注入（SpaceCode 特色），不再由表单触发，改为会话创建时注入

### 决策 2：能力范围 — 第 1+2 层

- **选择**：第 1 层（核心：分屏布局/流式/buildBlocks/ToolCard family/沙箱预览/多会话/重试中断/QuestionForm）+ 第 2 层（增强：OdCard/Live tool input/NextStepActions/DesignToolboxPanel/工件导出/用量条）
- **排除**：第 3 层（Side chat/TerminalViewer/CritiqueTheater/Plugin candidate/Run 恢复）作为后续迭代

### 决策 3：实现路径 — 方案 2（拆分组件 + 重组 DesignPage）

- **选择**：新建 6 个 design 专属组件，DesignPage 退化为布局容器
- **理由**：design 模式有 4 项独特行为（system prompt 注入 / file watcher / QuestionForm 拦截 / design toolbox），独立组件比共用 + props 分支更可维护；后续加第 3 层容易；现有 chat 零件仍充分复用

## 4. 架构设计

### 4.1 组件树（重构后）

```
DesignPage.vue                      # 布局容器：header + DesignSplitView
├── <header>                        # 极简顶栏：标题 "Design" + 用量条 + 停止按钮
└── DesignSplitView.vue             # 左右分屏，可拖拽分隔条
    ├── DesignChatPane.vue          # 左：聊天面板
    │   ├── ConversationsMenu       #   会话列表（基于 SessionTabBar 改造，可折叠）
    │   ├── MessageList             #   复用现有
    │   │   └── MessageItem         #   改造：新增 events 渲染分支
    │   │       ├── TextBlock       → MarkdownRenderer
    │   │       ├── ThinkingBlock   → ReasoningCard（可折叠）
    │   │       ├── ToolGroupBlock  → ToolCallCard（family ladder）
    │   │       ├── OdCardBlock     → OdCard（新建）
    │   │       ├── QuestionFormBlock → QuestionForm（内联，不再浮层）
    │   │       └── StatusBlock     → 状态/用量条
    │   ├── NextStepActions         #   轮次后建议条（新建）
    │   ├── RetryIndicator          #   复用现有
    │   └── DesignComposer.vue      #   输入区
    │       ├── <textarea>          #     输入框（暂用 textarea，后续可换 Lexical）
    │       └── DesignToolboxPanel  #     + 菜单：skill/plugin/附件（新建）
    └── DesignFileWorkspace.vue     # 右：文件工作区
        ├── WorkspaceToolbar        #   视图切换（预览/源码）+ 刷新 + 外部打开
        ├── WorkspaceTabsBar        #   多工件 tab 切换（新建）
        ├── <main> 视图区
        │   ├── [预览模式] DesignPreview  # 复用现有 iframe 沙箱（od: 协议）
        │   └── [源码模式] CodeViewer     # 新建：Shiki 高亮只读查看
        ├── ArtifactList            #   工件列表（从 DesignPage 迁出，可折叠）
        └── ExportBar               #   导出 HTML/ZIP/PDF（从 DesignPage 迁出）
```

### 4.2 数据流路径

```
用户在 DesignComposer 输入 → chatStore.sendMessage(content)
   → chatStream.sendMessage (复用不改):
       1. addMessage(user) → chatSession 持久化
       2. 检测 session 已 running（design init 时已 init）→ 跳过重复 init
       3. claudeCode.sendMessage(sessionId, content) IPC
   → claudeCode.onStreamEvent（多订阅）:
       ├─ chatStream 订阅（复用）: text_delta/tool_use/tool_result/thinking/status → 消息持久化与渲染
       └─ useDesignSession 旁路订阅（design 专属）:
           - text_delta → 累积 → findFirstQuestionForm → setPendingQuestionForm（剔除 XML 后回写消息）
           - tool_result (file write) → file watcher 推送 → updateArtifactFiles + addTab
           - usage → setUsage
           - status=idle → 解析 NextStepActions
```

### 4.3 布局规格

- 左 ChatPane 默认 `flex: 1`（约 55%），右 FileWorkspace 默认 `flex: 0 0 45%`，分隔条可拖拽，范围 30%~70%
- 移动端（< 1024px）：上下堆叠，ChatPane 上、FileWorkspace 下，可通过 tab 切换
- 顶栏高度 48px，复用 `--bg-secondary` / `--surface-border` token

## 5. 详细设计

### 5.1 design store 改造（`src/stores/design.ts`）

**删除 state**：`brief`、`selectedSystemId`、`selectedSkillId`、`selectedDirectionId`、`designSystems`、`currentSystem`

**保留 state**：`activeSessionId`、`designWorkspace`、`previewHtml`、`previewTitle`、`artifactFiles`、`selectedArtifactPath`、`pendingQuestionForm`

**新增 state**：
```ts
const openTabs = ref<ArtifactFile[]>([])           // FileWorkspace 多 tab 状态
const activeTabPath = ref<string | null>(null)     // 当前激活 tab
const lastUsage = ref<{ inputTokens: number; outputTokens: number; costUsd: number; durationMs: number } | null>(null)
const nextStepActions = ref<NextStepAction[]>([])
const toolboxSkills = ref<DesignSkill[]>([         // 从 designSkills 迁移，供 DesignToolboxPanel 使用
  { id: 'huashu-design', name: '华术设计 (Huashu Design)', description: '遵循大师级中文设计师章程，5维度精细打磨' },
  { id: 'canvas-design', name: 'Canvas 互动设计', description: '基于 Canvas/WebGL 的高动效游戏化 UI' },
  { id: 'ui-ux-pro-max', name: 'UI/UX Pro Max', description: '高品质多文件响应式 Web 原型，支持 Tailwind' },
  { id: 'html-ppt-skill', name: '演示文稿专家 (Morph PPT)', description: 'HTML 动态转场幻灯片设计' },
])
const selectedToolboxSkillId = ref<string>('huashu-design')  // 默认华术设计
```

**新增 actions**：`addTab(file)` / `removeTab(path)` / `setActiveTab(path)` / `setUsage(usage)` / `setNextStepActions(actions)`

**保留 actions**：`setPendingQuestionForm` / `clearPendingQuestionForm` / `updateArtifactFiles`

**废弃 actions**：`setBrief`（删除）

### 5.2 useDesignSession 改造（`src/composables/useDesignSession.ts`）

**删除**：`startDesignGeneration()`（表单触发，不再需要）

**新增 — 会话生命周期**：

```ts
async function createDesignSession(): Promise<string>
// 1. 创建 workspace 目录（userData/design-workspace/{timestamp}）
// 2. chatSessionStore.createSession(title, workspacePath)，session.mode = 'design'
// 3. api.design.composePromptStack({ skillName: designStore.selectedToolboxSkillId, locale }) → systemPrompt
// 4. chatSessionStore.initClaudeCodeSession(sessionId, { systemPrompt, cwd: workspacePath, agent: 'ui-ux-pro-max' })
//    ↑ 关键：在 chatStream.sendMessage 之前注入，sendMessage 检测 session running 不再重复 init
// 5. api.design.startFileWatcher(sessionId, workspacePath)
// 6. designStore.activeSessionId = sessionId
// 7. attachStreamListener(sessionId)

async function switchDesignSession(sessionId: string): Promise<void>
// 切换会话：detachStreamListener(旧) → activeSessionId = 新 → 若新会话未 running 则补 initClaudeCodeSession + startFileWatcher → attachStreamListener(新)

async function closeDesignSession(sessionId: string): Promise<void>
// api.design.stopFileWatcher() → detachStreamListener → 清理 designStore 状态（保留 artifactFiles 用于历史查看）

async function switchToolboxSkill(skillId: string): Promise<void>
// 切换 skill → 重新 composePromptStack → 重新 initClaudeCodeSession 注入新 system prompt（会话级生效）
```

**保留**：`submitQuestionForm(answers)`（复用现有逻辑：拼 `[form answers]` 字符串 → `chatStore.sendMessage`）、`stopDesignGeneration()`（只停 file watcher；chat 流停止由 chatStream.abortTurn 处理）

**改造**：`listenToStream()` → `attachStreamListener(sessionId)` / `detachStreamListener(sessionId)`
- text_delta：累积 → `findFirstQuestionForm` → `setPendingQuestionForm`（剔除 XML 后回写消息，复用现有逻辑）
- tool_result：file watcher 推送 → `updateArtifactFiles` + `addTab`（首次出现的工件）
- usage 事件：`setUsage`
- status=idle：触发 `<next-steps>` 解析 → `setNextStepActions`

### 5.3 MessageItem 改造（`src/components/chat/MessageItem.vue`）

**改造策略**：新增 `events` prop，不破坏 code/work 模式

```ts
interface Props {
  message: Message
  events?: AgentEvent[]   // 新增：design 模式传入事件流
}
// 渲染分支：
// - events 存在 → buildBlocks(events) 分块渲染
// - events 不存在 → 现有扁平渲染（reasoning + toolCalls + content）
```

### 5.4 buildBlocks 工具（`src/utils/chat/buildBlocks.ts`，新建）

```ts
type Block =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string; collapsed: boolean }
  | { kind: 'tool-group'; toolName: string; calls: ToolCall[]; liveInput?: string }
  | { kind: 'od-card'; payload: OdCardPayload }
  | { kind: 'question-form'; payload: QuestionFormBlock }
  | { kind: 'status'; usage?: Usage; status: TurnStatus }

function buildBlocks(events: AgentEvent[]): Block[]
// 规则：
// - 连续 text_delta 合并为 text block
// - thinking 事件 → thinking block（自动剥离空思考块）
// - 同名 tool_use 连续出现合并为 tool-group（"Editing ×3, Done" 药丸）
// - tool_input_delta 事件（若 IPC 推送）→ 写入当前 tool-group 的 liveInput，ToolCallCard 流式期间实时显示部分代码（Live tool input）
//   若 IPC 不推送 tool_input_delta，liveInput 恒为 undefined，tool-group 仅在 tool_result 后显示完整内容（降级为普通 tool-group）
// - text 中嵌入的 <od-card>/<question-form> 标签解析为独立 block，从 text 中剔除
// - status/usage 事件 → status block
```

### 5.5 ToolCallCard family ladder 改造（`src/components/chat/ToolCallCard.vue`）

改造为分发器，按 `toolCall.name` 分发：

```ts
const familyRenderers: Record<string, Component> = {
  Bash: BashToolCard,        // 新建：带 stdout/stderr 分色渲染
  Write: FileWriteToolCard,  // 新建：带"在预览中打开"按钮（关联 DesignFileWorkspace）
  Edit: FileEditToolCard,    // 新建：复用现有 diff 渲染
  Read: FileReadToolCard,    // 新建：带代码高亮折叠
  // 其余 tool name → 现有通用 ToolCallCard（作为 GenericCard）
}
```

第 1+2 层范围：建立分发机制 + 现有通用卡作 fallback + 新建 Bash/Write/Edit/Read 四个常用 family 卡。其余 family（Glob/Grep/WebFetch/WebSearch/TodoWrite）后续迭代。

### 5.6 OdCard 设计卡片（`src/components/design/OdCard.vue`，新建）

触发：agent 在 assistant 文本中输出 `<od-card type="...">...</od-card>` 标签，由 `buildBlocks` 解析为 od-card block，剔除 XML 后渲染。

```ts
interface OdCardPayload {
  type: 'brand-preview' | 'direction-swatches' | 'artifact-thumbnail' | 'generic'
  title?: string
  data: Record<string, any>
}
// type 分发：
// - brand-preview: 品牌色板 + 字体预览
// - direction-swatches: 5 大视觉方向色块（复用 DESIGN_DIRECTIONS 数据，作为卡片而非选择器）
// - artifact-thumbnail: 工件缩略图 + "在预览中打开"按钮（关联 DesignFileWorkspace）
// - generic: 通用键值对展示
```

### 5.7 NextStepActions（`src/components/design/NextStepActions.vue`，新建）

触发：turn 结束（status=idle）后，解析最后一条 assistant 文本中的 `<next-steps>` 标签。

```ts
interface NextStepAction { label: string; prompt: string }
// 示例标签：<next-steps><action label="调整配色" prompt="把主色改成..."/><action .../></next-steps>
// 渲染：挂在最后一条 assistant 消息下方的动作条，点击动作 → DesignComposer 预填 prompt
```

### 5.8 DesignFileWorkspace（`src/components/design/DesignFileWorkspace.vue`，新建）

**多 tab 与预览联动**：
- file watcher 推送新工件 → 自动 `addTab`（首次出现）+ 激活
- ArtifactList 点击 → 若已开 tab 则激活，否则 `addTab` + 激活
- tab 关闭 → `removeTab`；若关的是激活 tab，激活相邻 tab
- 激活 tab 变化 → 读取文件内容 → `designStore.previewHtml` 更新 → DesignPreview 响应式刷新
- 流式期间（isGenerating）→ 当前激活 tab 自动跟随最新生成的工件

**视图模式切换**：
- `ViewMode = 'preview' | 'source'`
- 预览模式：iframe 沙箱渲染（HTML 工件直接渲染，CSS/JS 工件嵌入骨架 HTML 后渲染）
- 源码模式：CodeViewer 用 Shiki 高亮显示原始代码（只读，编辑由 agent 在工作区完成）
- 默认：HTML 工件 → 预览；CSS/JS/JSON 工件 → 源码；可在工具条手动切换

**导出**：从 DesignPage.vue 的 `exportFile` 迁移到 ExportBar，导出目标改为当前激活 tab 对应的工件（`activeTabPath` 取代旧 `selectedArtifactPath`）

### 5.9 DesignComposer（`src/components/design/DesignComposer.vue`，新建）

**结构**：
- ComposerToolbar：+ 按钮（弹出 DesignToolboxPanel）+ skill 标签 + 发送/中断按钮
- textarea 输入框：Enter 发送，Shift+Enter 换行
- DesignToolboxPanel：+ 菜单弹出，含 SkillPicker（从 `designStore.toolboxSkills`）+ PluginPicker（第 1+2 层只建骨架）+ AttachFile（复用现有 imageAttachments）

**skill 选择行为**：
- 选择后显示为 ComposerToolbar 上的标签（如 "🎨 华术设计 ×"）
- 切换 skill → `useDesignSession.switchToolboxSkill(skillId)` → 重新 `initClaudeCodeSession` 注入新 system prompt
- 默认 skill：`huashu-design`（保留现有默认值）

**发送流程**：
1. 用户输入 → 点击发送 → `chatStore.sendMessage(content)`
2. 若会话未创建（首次发送）→ 先 `createDesignSession()` 再 `sendMessage`
3. 流式响应 → MessageItem(events) buildBlocks 渲染 + 旁路监听更新 FileWorkspace
4. 中断 → StopButton → `chatStore.abortTurn()`

### 5.10 首次进入 design 模式的空态

**DesignChatPane 空态**（无会话）：
- 标题："开始你的设计对话"
- 提示："在下方输入你的设计需求，或从 + 菜单选择设计技能。"
- 示例："生成一个 Stripe 风格的支付落地页"
- 底部 DesignComposer 可用

**DesignFileWorkspace 空态**（无工件）：
- 标题："暂无设计产物"
- 提示："开始对话后，生成的 HTML 将在此处实时预览。"

## 6. 错误处理与重试

| 场景 | 处理 | 复用 |
|---|---|---|
| API 错误（流式中） | `chatStream.initiateAutoRetry` → RetryIndicator 显示"API Error: {code} 正在重连（{n}/{max}）"，成功后消失 | useAutoRetry / RetryIndicator（已有） |
| 重试耗尽 | RetryIndicator 显示"重连失败"+ 手动重试按钮，DesignComposer 恢复可用 | 现有逻辑 |
| 用户主动中断 | DesignComposer StopButton → `chatStream.abortTurn()` | 现有 abortTurn |
| file watcher 异常 | try/catch + 日志，不影响聊天流；DesignFileWorkspace 显示"工件监听断开"提示 | 新增最小错误态 |
| 会话切换竞态 | `detachStreamListener` 在 `switchDesignSession` 前调用，避免旧会话事件污染 | 新增 |
| QuestionForm 解析失败 | `findFirstQuestionForm` 返回 null → 当作普通文本渲染，不阻断流 | 现有 |

## 7. i18n

复用现有命名空间，新增 `design` 命名空间：

```ts
// src/i18n/locales/en-US.ts（新增 design 命名空间）
design: {
  title: 'Design',
  emptyChatTitle: 'Start your design conversation',
  emptyChatHint: 'Type your design request below, or pick a skill from the + menu.',
  emptyPreviewTitle: 'No design artifacts yet',
  emptyPreviewHint: 'Generated HTML will appear here in real time once you start chatting.',
  toolbox: { skills: 'Skills', plugins: 'Plugins', attach: 'Attach File', skillLabel: 'Skill' },
  workspace: { preview: 'Preview', source: 'Source', refresh: 'Refresh', openExternal: 'Open Externally', closeTab: 'Close Tab' },
  export: { html: 'Export HTML', zip: 'Export ZIP', pdf: 'Export PDF' },
  odCard: { brandPreview: 'Brand Preview', directionSwatches: 'Direction Swatches', artifactThumbnail: 'Artifact', openInPreview: 'Open in Preview' },
  nextSteps: { title: 'Next Steps' },
  usage: { tokens: '{input} in · {output} out', cost: '${cost}', duration: '{s}s' },
}
// 现有 errors.apiErrorPrefix / reconnecting / cancelRetry 保持不变（RetryIndicator 已用）
// zh-CN.ts 同步对应中文
```

## 8. 样式

复用现有 token（不新增基础变量）：`--bg-primary` / `--bg-secondary` / `--surface-border` / `--surface-hover` / `--text-primary` / `--text-secondary` / `--text-muted` / `--accent-primary` / `--accent-primary-glow` / `--radius-*` / `--shadow-*`

新增 design 专属变量（`src/styles/design.scss`）：

```scss
:root {
  --design-split-min: 30%;
  --design-split-max: 70%;
  --design-split-default: 55%;
  --design-tab-height: 36px;
  --design-composer-min-height: 80px;
  --design-composer-max-height: 240px;
  --design-odcard-radius: var(--radius-md);
}
```

组件样式用 scoped scss + `var()`，不引入 Tailwind。暗色主题通过 `data-theme="dark"` 自动切换（现有机制）。

## 9. 测试策略（TDD）

| 层级 | 测试内容 | 工具 |
|---|---|---|
| 单元 · buildBlocks | 事件流分块正确性（text/thinking/tool-group/od-card/question-form/status 合并、剔除、折叠） | vitest + 手构造事件序列 |
| 单元 · OdCard 解析 | `<od-card>` 标签解析 + type 分发 + 错误容错 | vitest |
| 单元 · NextStepActions 解析 | `<next-steps>` 标签解析 + 空标签容错 | vitest |
| 单元 · design store | tab 增删切换、artifact 更新、pendingQuestionForm 状态机 | vitest + pinia testing |
| 单元 · useDesignSession | createDesignSession 流程 mock、stream listener attach/detach、竞态防护 | vitest + mock api |
| 组件 · DesignChatPane | 空态渲染、events 模式渲染、原模式不破坏 | @vue/test-utils |
| 组件 · DesignFileWorkspace | tab 切换、预览/源码切换、空态 | @vue/test-utils |
| 组件 · MessageItem | events 存在走 buildBlocks、不存在走原逻辑（回归保护） | @vue/test-utils |
| 集成 · design 会话 | 首次发送 → createDesignSession → 流式 → 工件推送 → tab 自动跟随 | vitest + mock claudeCode |

**TDD 顺序**：buildBlocks（纯函数，最易测）→ design store → useDesignSession → 各组件 → 集成。每个新组件先写测试再写实现。

## 10. 迁移与兼容

| 旧代码 | 处理 |
|---|---|
| `DesignPage.vue`（524 行三栏 Studio） | **重写**为布局容器（约 80 行），旧三栏逻辑删除 |
| `design.ts` 的 brief/selectedSystemId/selectedSkillId/selectedDirectionId/designSystems/currentSystem | **删除**；selectedSkillId 迁移为 `selectedToolboxSkillId` |
| `design.ts` 的 designSkills | **迁移**为 `toolboxSkills`（保留数据，换字段名） |
| `useDesignSession.startDesignGeneration()` | **删除**，拆分为 `createDesignSession` + 旁路监听 |
| `useDesignSession.listenToStream()` | **改造**为 `attachStreamListener`，QuestionForm 拦截逻辑保留 |
| `lib/design/directions.ts`（5 大视觉方向数据） | **保留**，作为 OdCard(direction-swatches) 的数据源（不再作为选择器） |
| `utils/design/questionForm.ts` | **保留**，复用 |
| `QuestionForm.vue` | **复用**，从浮层改为 MessageItem 内联渲染 |
| `DesignPreview.vue` | **复用**，迁入 DesignFileWorkspace |
| `lib/artifacts/srcdoc.ts`（od: 协议） | **保留**，复用 |
| 旧 DesignPage 的 SCSS | **删除**，新组件各自 scoped scss |

## 11. 交付清单

### 新建文件（13 个）

- `src/components/design/DesignSplitView.vue`
- `src/components/design/DesignChatPane.vue`
- `src/components/design/DesignComposer.vue`
- `src/components/design/DesignFileWorkspace.vue`
- `src/components/design/WorkspaceTabsBar.vue`
- `src/components/design/OdCard.vue`
- `src/components/design/NextStepActions.vue`
- `src/components/chat/BashToolCard.vue`
- `src/components/chat/FileWriteToolCard.vue`
- `src/components/chat/FileEditToolCard.vue`
- `src/components/chat/FileReadToolCard.vue`
- `src/utils/chat/buildBlocks.ts`
- `src/styles/design.scss`

> **内联子组件说明**：`DesignToolboxPanel`（skill/plugin/附件菜单）作为 `DesignComposer.vue` 的内联子组件实现，不单独建文件；`CodeViewer`（源码模式查看器）作为 `DesignFileWorkspace.vue` 的内联子组件实现，不单独建文件。

### 改造文件（6 个）

- `src/components/design/DesignPage.vue`（重写）
- `src/stores/design.ts`（删/留/新增 state）
- `src/composables/useDesignSession.ts`（生命周期重构）
- `src/components/chat/MessageItem.vue`（新增 events 分支）
- `src/components/chat/ToolCallCard.vue`（改造为 family 分发器）
- `src/i18n/locales/en-US.ts` / `zh-CN.ts`（新增 design 命名空间）

### 测试文件（按 TDD 配套）

- `src/utils/chat/__tests__/buildBlocks.test.ts`
- `src/components/design/__tests__/OdCard.test.ts`
- `src/components/design/__tests__/NextStepActions.test.ts`
- `src/stores/__tests__/design.test.ts`
- `src/composables/__tests__/useDesignSession.test.ts`
- 各组件的 `__tests__/*.test.ts`

## 12. 风险与未决

1. **onStreamEvent 多订阅兼容性**：`useDesignSession.attachStreamListener` 与 `chatStream` 的 onStreamEvent 监听并存，需确认 `api.claudeCode.onStreamEvent` 支持多订阅（若不支持需改造为单订阅 + 内部分发）。实现阶段第一步需验证。
2. **MessageItem 双模式渲染回归**：新增 events 分支后，需确保 code/work 模式（events 不传入）行为完全不变，需回归测试。
3. **agent 输出 `<od-card>` / `<next-steps>` 标签的前提**：依赖 design system prompt 栈中明确指示 agent 输出这些标签。`composePromptStack` 的 23 层提示词需补充 OdCard/NextStepActions 的输出规范。实现阶段需同步更新 prompt 栈（若 `composePromptStack` 在主进程，需主进程配合）。
4. **Live tool input（第 2 层）**：需要 `tool_input_delta` 事件支持。若当前 IPC 不推送该事件类型，Live tool input 降级为普通 tool-group（流式结束后才显示）。实现阶段需确认 IPC 事件类型。
5. **Shiki 引入**：CodeViewer 用 Shiki 高亮，需确认 SpaceCode 是否已装 Shiki（open-design 用，SpaceCode 未确认）。若未装需 `pnpm add shiki`。

## 13. 验收标准

- [ ] 打开 design 模式看到聊天界面（左 ChatPane + 右 FileWorkspace 分屏）
- [ ] 首次输入设计需求 → 触发 design 会话 → 流式渲染 assistant 消息（buildBlocks 分块）
- [ ] 工具调用以 family 卡片渲染（Bash/Write/Edit/Read 专用卡，其余通用卡）
- [ ] assistant 文本中的 `<od-card>` 标签渲染为设计卡片
- [ ] assistant 文本中的 `<question-form>` 标签内联渲染为表单（不再浮层）
- [ ] 轮次结束后 `<next-steps>` 渲染为建议动作条，点击预填 prompt
- [ ] file watcher 推送工件 → 右侧 FileWorkspace 自动开 tab + 预览
- [ ] 多 tab 切换、预览/源码双视图、导出 HTML/ZIP/PDF 可用
- [ ] DesignToolboxPanel 可切换 skill，切换后新 system prompt 生效
- [ ] API 错误时 RetryIndicator 显示，成功后消失；中断按钮可用
- [ ] code/work 模式不受影响（MessageItem 原模式回归通过）
- [ ] 所有新增纯函数与 store 单测通过；关键组件测试通过
