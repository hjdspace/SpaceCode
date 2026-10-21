# Design Plan：pi Plan Mode 工具卡 UI 重构（方案 A · 卡片同构）

> 交接文档：面向执行 Agent，含现状盘点、目标架构、分片任务与验收标准。
> 视觉规范唯一来源：[plan-mode-redesign-a-v2.html](../../prototypes/plan-mode-redesign-a-v2.html)（单文件自包含，浏览器打开可交互）；过渡参考 [plan-mode-redesign-a.html](../../prototypes/plan-mode-redesign-a.html)，方案对比见 [plan-mode-redesign-index.html](../../prototypes/plan-mode-redesign-index.html)。

## 1. 背景与目标

**现状一句话**：pi 引擎的 `plan_mode_question` / `plan_mode_complete` 与其他扩展对话框共用一张通用的 `ExtensionDialogCard.vue`——多行纯文本标题、无层级裸按钮、与工具调用卡片互不关联，而 Claude 引擎侧的 `AskUserQuestionToolCard.vue` 已有成熟的卡片设计（图标头 / 进度点 / 带描述的选项 / 自定义输入 / 汇总折叠）。

**错位分析**：pi 的 RPC 层把结构化输入扁平化成 `select` 对话框帧（标题 = `"header: question"`、选项 = `"1. label — description"`），桌面端只拿到字符串，结构信息被丢弃；但 `tool_use` 事件里**其实带着完整结构化数据**（questions 数组、plan Markdown）。UI 简陋不是数据缺失，是渲染层没有消费它。

**选定方案 A 的要点**：

- 新建 `PlanModeQuestionToolCard.vue`：完全对齐 `AskUserQuestionToolCard.vue` 的信息架构（header icon + 标题 + 状态、分页进度点、radio 选项 + 描述、自定义输入、footer 跳过/翻页/提交、提交后汇总折叠卡）
- 新建 `PlanModeCompleteToolCard.vue`：计划文档卡（标题栏 + 状态徽标 + 目录锚点 + 可折叠 Markdown 正文 + 行动条）
- 重构 `ExtensionDialogCard.vue`：四种方法（select/confirm/input/editor）收敛到同一卡片基座（header/body/footer），不再是四种长相各异的裸卡
- **重构原则：增量替换，功能零丢失**。所有现有入口（见 3.3 zero-loss map）在新卡中有明确归宿；链接失败时回退到现状渲染。

## 2. 视觉与交互规范来源

| 规范项 | 来源 |
|---|---|
| 卡片基座（header 24px 图标座 / 8-12px 内距 / 6px 圆角选项 / footer 按钮层级 secondary·ghost·primary） | `AskUserQuestionToolCard.vue` 现有样式 + 原型 A-v2 `.card` 体系 |
| 状态色（等待=warning / 成功=success / 错误=error / 主色=accent） | 语义 token（见第 5 节映射表） |
| 进度点（6px 圆点，active scale(1.2) + glow，done 0.7 透明度） | 原型 A-v2 `.progress-dots` |
| 汇总折叠（header 行 + chevron 旋转 180° + item 分隔线） | `AskUserQuestionToolCard.vue` summary 模式 |
| 计划文档卡（28px 图标座 / 状态徽标 pill / 目录 chip / 底部行动条） | 原型 A-v2 `.plan-card` 体系 |
| 图标 | `lucide-vue-next`（现依赖）：`MessageCircleQuestion` / `ClipboardCheck` / `CheckCircle2` / `ChevronDown` / `TriangleAlert` / `FileText` / `ListChecks` |
| z-index / 布局 | 不新增浮层，无新 z-index 需求 |

**2.1 原型踩坑记录**（源自 PROTOTYPE-SPEC 坑位清单，本次实现必须规避）：

- **坑 6**：带 textarea 的卡片禁止在 `oninput` 里整卡重渲染（光标踢到末尾、打断中文输入法）。`PlanModeQuestionToolCard` 的自定义输入只更新数据与 footer 按钮的 disabled，不重渲染选项区。
- **坑 7**：键盘快捷键（数字选选项 / Enter 翻页）必须先判 `e.target.tagName === 'TEXTAREA' || 'INPUT'` 再处理。
- 坑 1-3（抽屉）本次无抽屉，不适用；坑 4（Markdown 围栏）仅文档写作，不适用。

## 3. 现状盘点

### 3.1 现有 Shell 结构（与本重构相关部分）

```text
src/
├─ components/chat/
│  ├─ MessageList.vue            # 消息列表；dialogsForGroup() 把扩展对话框插进消息组
│  ├─ AgentTimeline.vue          # 流式时间线；extension_dialog 事件渲染 ExtensionDialogCard
│  └─ tools/
│     ├─ index.ts                # TOOL_COMPONENT_MAP：toolName → 异步组件
│     ├─ AskUserQuestionToolCard.vue   # ★ 参考卡（结构基准，不改）
│     ├─ ExtensionDialogCard.vue       # ★ 重构对象（pi 对话框通用卡）
│     └─ ExitPlanModeToolCard.vue      # 计划渲染参考（MarkdownRenderer 用法）
├─ lib/tool-registry.ts          # TOOL_REGISTRY：工具元数据表（plan_mode_* 未登记）
├─ services/extensionDialogService.ts  # 扩展对话框账本：open/get/list/close/resolve
├─ stores/turn/                  # answerExtensionDialog() 发 IPC 应答
├─ shared/channels/claudeCode.ts # ExtensionDialogRequest / ExtensionDialogAnswer 类型
└─ i18n/locales/{zh-CN,en-US}/piExtensionDialog.ts  # 现有文案模块
electron/engine/engines/
├─ PiEventMapper.ts              # extension_ui_request → extension_dialog_request（select/confirm/input/editor）
└─ PiSessionProcess.ts           # RPC 往返、超时看门狗、plan-mode 扩展装载
```

数据流：pi 扩展发 `extension_ui_request` → PiEventMapper 收成 `{dialogId, method, title, options?, placeholder?, prefill?}` → `extensionDialogService.open()` → MessageList/AgentTimeline 渲染 `ExtensionDialogCard` → 用户应答 → `turnStore.answerExtensionDialog()` → IPC `respondExtensionDialog`。**对话框帧不携带 toolUseId**，与 tool_use 卡片没有现成关联。

### 3.2 关键 Store

| Store / Service | 职责 | 本次改动 |
|---|---|---|
| `extensionDialogService` | 按会话管理对话框 Map（state: pending/resolved、outcomeText、closedReason） | **不改**（新卡片读同一账本） |
| `turn` store | `answerExtensionDialog(sessionId, dialogId, answer, outcome)`、`hasPendingPermissionForToolUse` | **不改** |
| `extensionDialogService` 新增辅助 | — | 允许加纯查询方法（如 `listPending(sessionId, method)`），不加状态字段 |

### 3.3 功能保全清单（zero-loss map）

左列 = `ExtensionDialogCard.vue` 现有全部入口/行为，逐项映射：

| 现有入口 / 行为 | 新归宿 |
|---|---|
| `select` 方法：options 逐条按钮、点击回传 `{kind:'value', value: option}` | `ExtensionDialogCard`（家族化重构后保留）；question 场景由 `PlanModeQuestionToolCard` 接管应答（见 4.2） |
| `confirm` 方法：确认/拒绝 → `{kind:'confirmed', confirmed: true/false}` | `ExtensionDialogCard` 保留，按钮样式换 footer-btn.danger/primary |
| `input` 方法：文本框 + 提交，空文本拦截 | `ExtensionDialogCard` 保留 |
| `editor` 方法：textarea、prefill、`editorRows`（4-12 行自适应）、Ctrl/Cmd+Enter 提交、空文本放行（清空是合法编辑） | `ExtensionDialogCard` 保留，全部行为不变 |
| 关闭按钮 → `{kind:'cancel'}`（select 场景扩展收到 undefined = 返回菜单） | `ExtensionDialogCard` footer ghost「关闭」保留 |
| resolved 态单行回执（outcomeText / closedReason 文案表 8 种） | 保留并家族化：summary-header 单行 + 方法图标 + 状态着色（超时=warn / 已答=ok） |
| `waiting` 状态指示（「等待你的回答」） | 家族化 header 的 status 槽位 |
| 多行 title 保换行（`white-space: pre-wrap`） | 保留——pi 把整段提问塞进 title，此行为是契约 |
| 空选项提示（「这条提问没有给出可选项」）+ 文本框兜底 | 保留 |
| `submitting` 防重复提交、IPC 失败退回 pending 原地重试 | 保留（照搬现有 answer() 逻辑） |
| MessageList.dialogs / AgentTimeline.events 两处挂载点 | 不动挂载方式，仅组件内部重构 |
| i18n `piExtensionDialog.*` 全部 key | 保留；新增 key 见第 7 节 |
| `piSessionProcess.extensionDialog.test.ts` / `ExtensionDialogCard.roundTrip.test.ts` 全部断言 | 必须继续通过 |

## 4. 目标架构

### 4.1 新组件结构

```text
src/components/chat/tools/
├─ index.ts                          # 【修改】TOOL_COMPONENT_MAP 增加 plan_mode_* 两项
├─ PlanModeQuestionToolCard.vue      # 【新增】问卷卡（结构对齐 AskUserQuestionToolCard）
├─ PlanModeCompleteToolCard.vue      # 【新增】计划文档卡
├─ ExtensionDialogCard.vue           # 【重构】家族化基座，行为零丢失
└─ tool-card.scss                    # 保留（tool 卡通用样式）
src/lib/
└─ planModeDialogMatcher.ts          # 【新增】纯函数：对话框帧 ↔ 问卷题目的匹配
src/i18n/locales/{zh-CN,en-US}/
└─ planMode.ts                       # 【新增】两张新卡的文案模块（index.ts 挂载）
```

- `TOOL_COMPONENT_MAP`：`'plan_mode_question': () => import('./PlanModeQuestionToolCard.vue')`、`'plan_mode_complete': () => import('./PlanModeCompleteToolCard.vue')`。tool_use 卡与对话框卡并存时（见 4.2 降级），两者天然都在时间线里。
- `tool-registry.ts` 追加两条 `plan` 分类记录（`hasSpecialUI: true`）。

### 4.2 视图与数据联动决策（核心机制）

**问卷卡与对话框的链接**：`plan_mode_question` 的 tool_use（结构化 questions）先到，随后每个问题产生一帧 `select` 对话框，标题格式 = `"{header}: {question}"`（来自 pi-tui-kit `runRpcQuestionnaire`），选项 = `"1. {label} — {description}"`，末尾追加 `"N. Other (free-form)"`；若用户选 Other，扩展再发一帧 `editor`（标题 = question）。

- `planModeDialogMatcher.ts` 导出 `matchDialogToQuestion(dialog, questions)`：title 以 `"{header}: {question}"` 开头即配对（header/question 都来自同一个 questions 数组，重复概率趋零）；再提供 `optionRowLabel(question, index)` 生成 `"1. label — description"` 字符串用于应答。
- `PlanModeQuestionToolCard` 渲染结构化 questions；用户点选项时：
  1. 若存在已配对的 pending 对话框 → 直接 `turnStore.answerExtensionDialog(dialogId, {kind:'value', value: optionRowLabel})`，该题标记已答；
  2. 若没有 pending 对话框（历史会话回放 / 已答完）→ 只更新本地选择，不发作答 IPC。
- Other 选项：卡片内联自定义输入框，提交时先应答 select 帧为 `"N. Other (free-form)"`，再应答后续 editor 帧（配对同上）为用户输入文本。
- **降级**：若扩展版本改了标题格式导致配对失败（matcher 返回 null），卡片仍渲染 questions 并正常提交本地答案到汇总 UI，但 per-question 对话框照旧由重构后的 `ExtensionDialogCard` 独立渲染应答——即回退到现状行为，不阻塞。

**计划卡与行动菜单的链接**：`plan_mode_complete` 的 tool_use 带 `{plan}` Markdown。卡片渲染文档（MarkdownRenderer 复用 ExitPlanModeToolCard 的用法），行动条按数据源分两级（见第 7 节降级）：存在 pending 的 plan-action `select` 对话框（标题含 "Plan mode"、选项为菜单项）时，主按钮（批准实施等）映射应答对应选项；不存在时行动条只保留宿主侧能力（展开/收起、复制 Markdown），不显示假按钮。

**汇总态**：两条新卡都实现「pending 交互 / resolved 汇总折叠」双态，复用 AskUserQuestionToolCard 的 summary 结构与 `toolCall.output` 回溯思路（plan_mode_question 的 tool_result 是 JSON 文本，含 `answers[]`，用 `JSON.parse` 宽松解析，失败则显示「已结束」）。

### 4.3 组件状态模型

```ts
// PlanModeQuestionToolCard 内部（无新增全局 store）
const selections = ref<Map<number, number | null>>(new Map()) // qIndex → optionIndex；null = Other
const customInputs = ref<Record<number, string>>({})
const currentPage = ref(0)
// 对话框配对（computed，不自存状态）：
const matchedDialogs = computed(() =>
  questions.value.map(q => planModeDialogMatcher.matchDialogToQuestion(
    extensionDialogService.list(sessionId).find(d => d.state === 'pending' && d.method === 'select'),
    q)))
```

无路由变化、无视图枚举——方案 A 全部发生在时间线内联卡片层。

## 5. 样式与主题约束

- 样式栈：Vue SFC `<style lang="scss" scoped>`；间距/字号只引用 `--text-*`、`--radius-*`、`--surface-*`、`--accent-*` 等 CSS 变量（见 `_variables.scss`），聊天区禁止裸 px 字号。
- **原型色 → 语义 token 映射表**（原型字面量仅作视觉参考）：

| 原型字面量 | 语义 token |
|---|---|
| `--accent (#0d9488 / #3b82f6)` | `var(--accent-primary)` |
| `--accent-glow` | `var(--accent-primary-glow)`（配 `color-mix(in srgb, var(--accent-primary) 12%, transparent)` 写法，参照 AskUserQuestionToolCard） |
| `--glass / --glass-hover` | `var(--surface-glass) / var(--surface-glass-hover)` |
| `--border / --border-strong` | `var(--surface-border) / var(--surface-border-strong)`（按钮描边用 `var(--border-strong)`，参照现卡） |
| `--text / --text2 / --muted / --disabled` | `var(--text-primary) / var(--text-secondary) / var(--text-muted) / var(--text-disabled)` |
| `--warning / --success / --error` | 同名 token |
| `.skel` shimmer 底色 | `var(--surface-soft)` / `var(--surface-glass-hover)` |

- 主题适配：四套主题（light / anthropic / anthropic-dark / dark）全部走 token，实现后逐主题目检一轮。
- 代码规范：组件 PascalCase、composables `use` 前缀、精确类型禁 `any`、i18n 双语同名模块。

## 6. 分片实施计划

**切片 1：家族化 ExtensionDialogCard（纯视觉重构，行为零变化）**

- 修改：`ExtensionDialogCard.vue`（header 图标座 + 方法徽标 + 状态槽位 / footer 统一按钮层级；resolved 态换 summary-header 单行 + 状态着色）
- 测试：现有 `src/components/chat/tools/__tests__/ExtensionDialogCard.roundTrip.test.ts` 全绿（含 4 方法应答、防重复、失败退回 pending、closedReason 文案）；补 1 条「resolved 单行显示 closedReason 着色类」断言
- 验证：`npm run test:changed`

**切片 2：planModeDialogMatcher + tool-registry 登记**

- 新增：`src/lib/planModeDialogMatcher.ts`（`matchDialogToQuestion` / `optionRowLabel` / `parseQuestionnaireOutput`，全部纯函数）
- 修改：`src/lib/tool-registry.ts`（+2 条 plan 记录）
- 测试：`src/lib/__tests__/planModeDialogMatcher.test.ts`——标题配对命中/不命中、Other 行标号与 pi-tui-kit `formatRpcOption` 逐字符一致（`"1. label — description"`，em dash U+2014）、tool_result JSON 宽松解析（合法/截断/非 JSON）

**切片 3：PlanModeQuestionToolCard（交互态 + 汇总态）**

- 新增：`PlanModeQuestionToolCard.vue`；修改 `tools/index.ts`、`i18n/locales/{zh-CN,en-US}/planMode.ts` + `index.ts` 挂载
- 行为：分页（1-3 题、进度点）、选项点击→配对应答或本地选择、Other→editor 帧应答、跳过→cancel 帧、汇总折叠 + output 回溯、坑 6/7 规避
- 测试：`src/components/chat/tools/__tests__/PlanModeQuestionToolCard.test.ts`——结构化渲染、配对应答调用了 `answerExtensionDialog` 正确参数、无配对时不发 IPC、多题翻页、textarea 输入不触发选项区重渲染（坑 6 断言：input 事件后 option DOM 引用不变）

**切片 4：PlanModeCompleteToolCard（文档卡 + 行动条降级）**

- 新增：`PlanModeCompleteToolCard.vue`；修改 `tools/index.ts`
- 行为：MarkdownRenderer 渲染 plan、目录锚点、展开/收起（默认折叠 120px + 渐隐）、复制 Markdown（宿主侧）、pending plan-action select 存在时行动条映射应答，否则隐藏决策按钮
- 测试：`src/components/chat/tools/__tests__/PlanModeCompleteToolCard.test.ts`——plan 为空不渲染正文、折叠态 class 切换、有/无配对对话框时行动条按钮集合

**切片 5：收尾**

- 全量目检四主题下三张卡；`npm run test:changed` + `npm run build` 全绿；更新 `docs/superpowers/specs/` 设计说明（如需要）

每片结束应用处于可运行状态，可独立提交。

## 7. 数据绑定总表

| 原型组件 | 数据源 | 备注 |
|---|---|---|
| 问卷卡 questions | `toolCall.input.questions`（引擎 tool_use 事件，结构化） | 1-3 题、每题 2-4 选项、description 必有（扩展 schema 保证），仍做存在性守卫 |
| 问卷卡 ↔ 对话框配对 | `extensionDialogService.list(sessionId)` + matcher | 降级：配对失败回退 ExtensionDialogCard 独立渲染 |
| Other/editor 帧 | `extensionDialogService` pending editor 帧 | 降级：无 editor 帧（用户先点了原生卡）时 Other 提交只写本地 |
| 问卷汇总 answers | `toolCall.output`（`{cancelled, answers[]}` JSON） | 解析失败显示「已结束」，不造数据 |
| 计划卡正文 | `toolCall.input.plan` | 空则整卡不渲染（同 AskUserQuestion shouldRender 思路） |
| 计划卡状态徽标 | `toolCall.status` + tool_result | completed→「已提交」，error→「已失败」 |
| 行动条（批准/放弃） | pending 的 plan-action `select` 对话框 | 降级：无对话框→隐藏决策按钮，仅保留展开/复制（宿主侧，无数据缺口） |
| 导出/存草稿按钮 | **无宿主 API** | 隐藏 + TODO 注释，禁止假按钮 |
| 活动时间线 / 面板 | 方案 A 不含（B/C 产物） | 不实现 |

## 8. 验收标准（DoD）

1. `plan_mode_question` 的 tool_use 在时间线渲染为与 AskUserQuestionToolCard 同家族的问卷卡：图标头 / 进度点 / 带描述选项 / 自定义输入 / 跳过 / 翻页 / 提交 / 汇总折叠，四主题目检通过。
2. 点选项后引擎侧问卷真实推进（extension_dialog 往返成功，pi 收到 `"1. label — description"` 原文）；Other 流程能走完 select→editor 两帧。
3. `plan_mode_complete` 渲染计划文档卡，默认折叠可展开，Markdown 渲染正确；行动条在无对话框数据时不含假按钮。
4. 3.3 zero-loss map 逐项点通：重构后的 ExtensionDialogCard 四方法、关闭、回执、防重复、失败重试、i18n、两处挂载点全部保留，`ExtensionDialogCard.roundTrip.test.ts` 无删除断言地通过。
5. 坑 6 / 坑 7 各有一条自动化断言（切片 3）。
6. `npm run test:changed` 与 `npm run build` 全绿；不引入新依赖。
7. 硬约束：不改 `engine/`（只读）、不改 `electron/` 事件协议、不动 `extensionDialogService` 的状态字段语义。

## 9. 非目标（Out of Scope）

- 不实现方案 B/C 的浮层答题、右侧 Plan 面板、活动时间线（已否决的变体，代码不留占位）。
- 不改 pi 扩展包、不改 RPC 协议与 `PiEventMapper` 的帧结构。
- 不给 AskUserQuestionToolCard / ExitPlanModeToolCard 做任何改动（它们是基准与参考）。
- 不做问卷多选（pi 问卷是单选，schema 无 multiSelect）。
- 不实现计划导出/存草稿的宿主功能（无数据源，见第 7 节降级）。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 扩展升级改变 select 标题格式，配对失效 | matcher 以 `header: question` 前缀匹配 + 单测锁格式；失效时自动回退 ExtensionDialogCard 独立渲染（4.2 降级路径），功能不阻塞 |
| 同一会话并发多份问卷（多 pane） | 配对按 `sessionId` + pending 集合过滤，matcher 消费时按 title 唯一命中；命中多个时取最新 opened 的对话框，其余留给 ExtensionDialogCard |
| tool_use 与对话框时序：对话框可能在卡片 mount 前后到达 | 卡片配对用 computed 从 service 现取（照搬 ExtensionDialogCard「状态按 id 现取，不认 props 快照」的既有经验），service 响应式更新自然驱动 |
| 卡片与 ExtensionDialogCard 同屏重复渲染同一提问 | question 场景的 select 帧被配对后，ExtensionDialogCard 对该 dialog 渲染已答回执行（resolved 态），不构成重复交互面；测试覆盖「应答后原对话框显示已答」 |
| textarea 中文输入法 / 光标问题 | 坑 6 规避 + 专项断言（切片 3） |
| 键盘快捷键劫持输入框 | 坑 7 规避 + 焦点判断先行返回 |
| 计划正文超长（上限 50k 字符） | 默认折叠 + `max-height` 滚动容器（复用 ExitPlanModeToolCard 的 `scrollbar-overlay` mixin），不撑破时间线 |
