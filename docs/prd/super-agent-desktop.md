# Spec: Super Agent 桌面端完整实现方案（供拆分 Tickets）

> 依据：`docs/design/super-agent-implementation-plan.md`（下称「方案」，含复审与收口定案）、`docs/prototypes/super-agent-ui-prototype.html`（原型）、`docs/prd` 既有 spec 惯例。
> 本 spec 覆盖**完整版**（Phase 0–3 全量能力），不限于 MVP；实现顺序仍按方案的阶段划分，作为 ticket 拆分的批次依据。
> 本 spec 修订方案 §11.2 的组件清单：输入框与时间线复用主聊天组件，不再新建独立实现。

## Problem Statement

用户要在 SpaceCode 中获得一个可托管多张并行工单的 Super Agent：与 Router 对话、显式派工、Worker 在后台异步执行、可随时以只读方式观察并可接管；随产品演进还要接入外部事件（IM/飞书/GitHub），让工单能被外部消息驱动、结果能回写到外部信道。当前桌面端已有成熟的聊天输入框（斜杠命令、@ 上下文、附件、草稿）与会话时间线（工具卡片、权限对话框、流式渲染），方案若另起一套输入与时间线实现，会造成双倍维护与机制漂移；而工单调度、状态机、持久化恢复、外部信道路由等领域机制则是全新能力，需要完整定义。

## Solution

- **UI 层最大化复用**：Super Agent 聊天区与 Worker 工作态面板复用主聊天的输入框与会话时间线组件，以受控参数简化；Super Agent 专属能力（状态条、工单卡片、Attention 气泡、接管横幅、系统问题面板、执行策略控件）作为薄层叠加。
- **领域层全新构建**：主进程内单写者 Domain 承载 Trigger / Thread / Ticket / Assignment / Input / Mandate / Report / Attention / Decision 的完整状态机，持久化到项目状态目录，支持崩溃恢复与退出收尾。
- **执行层**：Scheduler 管理槽位（默认串行、可显式开启并行并强制 per-ticket worktree），Worker 以稳定会话 + Assignment 代次执行，Report 严格校验。
- **Phase 2 扩展**：外部 Source 接入、两级 Eval + Policy 版本化授权、订阅 fast path、Outbox 外发、PR 评审闭环、健康可操作处置。

## User Stories

### Router 对话与派工（Phase 1）

1. 作为用户，我想在 Super Agent 聊天区使用与主聊天完全一致的输入框（斜杠命令、@ 文件/文件夹/图片上下文、附件、草稿），这样两个入口的输入习惯无需切换。
2. 作为用户，我想让 Super Agent 草稿与普通会话草稿互不干扰，切换入口不丢草稿。
3. 作为用户，我普通发送只与 Router 对话；Router 可建议建单，但建单必须走独立的「新建工单」动作（显式派工，生成 Decision 与 Mandate 审计链）。
4. 作为用户，我想在派工时指定标题、工作目录与初始上下文，并看到生成的 Mandate 范围。
5. 作为用户，Router 无正文输出时我想看到轻量 typing 与计时，并可中止本轮而不影响任何 Worker。
6. 作为用户，我想让 Router 会话固定出现在 Super Agent 聊天区、是唯一对话者，但不出现在侧边栏普通会话列表（按会话类型排除，非设置开关）。

### 工单生命周期（Phase 1）

7. 作为用户，我想看到每张工单在消息流中的单行卡片：图标、标题、状态点 + 短状态词，Report 只更新卡片不重复发气泡。
8. 作为用户，我想让卡片状态覆盖 queued/preparing/working/idle/delivery/review/answer/blocked/failed/completed/stopped/dropped，且不只靠颜色区分。
9. 作为用户，我想点击卡片在右侧打开该 Worker 的实时工作态，默认只读、不自动接管、不自动切换其他 Worker。
10. 作为用户，Worker 提问（Attention）时我想以非模态气泡看到问题并就地回答；相同问题只提醒一次，回答后折叠并保留审计；被替换的问题撤回旧气泡。
11. 作为用户，工单进入待验收（ready）时，我想在卡片上直接操作「接受验收 / 继续追问 / 停止」；超时只有提醒（气泡 + 徽章 + 状态条），不弹窗、不自动完成，状态保持待验收。
12. 作为用户，blocked/failed 后我的人工消息要复用原执行（不换代次、不换分段），自动输入（bot/CI/Router note）在此期间只落库不投递。
13. 作为用户，只有 open 且处于投递失败/受阻/失败三个阶段时才出现「重试」；重试与崩溃恢复才产生新一代执行。Router 侧同样有 `retry` 这个路由动词，我说"重新执行"时它走的是这条出口，与卡片上的「重试」同一条路径；`attach` 只投人消息、不换代次，不能拿来假装重跑。
14. 作为用户，我想显式停止工单：Mandate 被撤回、后续事件不得自动重开；结束瞬间到达的人消息不被吞掉。
15. 作为用户，我想在顶部状态条看到运行中/排队/待处理计数、执行策略与新建工单入口，计数与后端状态查询一致。

### Worker 工作态与接管（Phase 1）

16. 作为用户，我想在右侧只读时间线中看到与主聊天一致的渲染：工具卡片、流式输出、Report、产物、权限审计与 Assignment 代次分段。
17. 作为用户，我想显式接管某个 Worker：接管后时间线可交互（含权限对话框）、出现「自动推进已暂停」横幅并可输入；消息仍先落领域 Input 再投递，不直连引擎。
18. 作为用户，我想交还后恢复自动推进、回到只读；多 Worker 面板同时打开时接管不互抢、点击卡片不自动接管。
19. 作为用户，关闭 Super Agent 标签不影响后台推进；重开后从快照恢复并续上事件流；应用退出时 Worker 有界收尾、重启后不出现「已退出但仍 running」。

### 可靠性与健康（Phase 1 上报 / Phase 2 处置）

20. 作为用户，我想让项目状态（state/events/effects/outbox）原子持久化并按 seq 追加；schema 升级单事务迁移、过旧版本拒绝启动、未知字段前向兼容。
21. 作为用户，我想让投递失败的输入走 requestId 对账：可证明未接受才重投、无法确定转 uncertain 并产生 Attention。
22. 作为用户，我想看到系统问题只读面板（Effect/Source/Eval/引擎/锁/迁移），同类连续 3 次失败才升级 error、单次抖动不打扰我（Phase 1 只读；Phase 2 提供重试/忽略操作）。
23. 作为用户，错误提示要返回稳定错误码并本地化，不把英文异常直接弹给我。

### 执行策略与工作区（Phase 1–2）

24. 作为用户，我想在执行策略控件里配置串行（默认，1 worker）/并行（显式开启并强制 per-ticket worktree）、上限与确认行为。
25. 作为用户，串行模式下我的人工续接要等当前轮结束；并行 + worktree 模式下工单互不污染，检查点支持按文件显式回退。
26. 作为用户，Worker 发起的权限请求要走与主聊天一致的确认流程，确认结果作为领域输入投递。

### 外部事件驱动（Phase 2）

27. 作为团队成员，我想让 IM（飞书）/GitHub 消息成为 Trigger：@SuperAgent 或显式引用可建单候选，群消息可作上下文订阅。
28. 作为团队成员，我想让 Policy 版本化：acceptMode（off/observe/auto）、每 Source 准入表、bot 名单与规则清单；规则命中写入 Mandate 下发给 Worker。
29. 作为团队成员，Eval 评估按 Thread 串行、时限从送达起算、超时重排 2 次后记 unavailable、暂停期间顺延；模型不能自行授权，续接前按当前 Policy 重新校验。
30. 作为团队成员，已建单工单订阅其来源 Thread，后续消息 fast path 直达 Worker；工单结束后未裁决的人消息回流 Eval，订阅最迟两周停止轮询。
31. 作为团队成员，Worker 的回答/结果/进度可通过受控 reply 回写外部信道：回答必须可追溯到 Worker 认领过的人问题，progress 不外发为结果，同一问题只提醒一次。
32. 作为团队成员，PR 评审闭环：审批/评论唤醒 Worker、修好的评论静默 resolve、自动评审器每 PR 最多三轮、外部自动化账号靠 prompt 文本识别且不产生额外授权。
33. 作为团队成员，工单可按 PR 合并/关闭结束（merged/closed 结束结果，不压成 completed），follows 关系保留审计。

### 可选自治增强（Phase 3，默认不做）

34. 作为用户，我未来可选开启：Watchdog 超时看护、跨项目视图、sidecar/daemon 常驻、投机执行。默认关闭，不作为交付前置。

## Implementation Decisions

### A. 领域模型与状态机（主进程 Domain，无 I/O）

1. 核心对象与关键字段按方案 §5.1/§5.1.1：Trigger（threads/human/context/channel/disposition）、Thread（subscriptions/context/pending/expired）、Ticket（ended{at,by,outcome,reason}/attention/answers/follows/delivery/undelivered/reviewRemindedAt/execution）、Assignment（assignmentId/generation/state/report{id}/deliveredAt/idleAt）、Input（kind/readAt(null=已到未取)/deliveredTo）、Mandate（strength/policyVersion/basis）、Report（state/summary/askedBy/answers）。
2. Ticket 阶段是派生值（优先级表，方案 §5.2）：最新 Assignment ended 且无新 Input → idle；`ready+question`、`answers` 未认领、Attention 替换等校验按 §5.4 稳定错误码拒绝。
3. blocked/failed 是输入闸门（waitsForPerson）：期间自动输入只落库；人工消息、重试或新 Report 才解除。解除时**复用原 Assignment**（不新建、generation 不递增、不新开分段）。**没送到执行方的人消息（status 仍为 pending/failed）不算解除** —— 代次已 interrupted/ended 时它只是一条死信，把它算成"人已经说过了"会刷出一个没有进程在跑的 working，并把重试入口一起抹掉。
4. 结束迁移清理 Attention/delivery 并释放未裁决人消息（回流 Eval）；`dropped` 可自动结束，其余只有 ticketAccept→completed、ticketStop→stopped；Phase 2 增加 merged/closed（按 Thread 关闭结束，不改优先级表）。
5. 幂等：Source 事件键、UI requestId、Report 的 assignmentId+reportId、Outbox messageId；重复事实返回原结果。
6. review 超时提醒：scheduled effect，`reviewReminderHours` 项目级配置（默认提案 24h，待确认）、首次到点一次、之后每日一次、`reviewRemindedAt` 落盘、重启不补发、不改变阶段不自动 accept。

### B. 调度与执行

7. Scheduler 槽位模型：默认串行 maxWorkers=1、共享根目录 worktree='none'（保留脏区检查与停止/失败保留现场，共享根目录现状写入 Worker 首条消息）；并行显式开启且强制 per-ticket worktree。Phase 2 给「人的消息」额外槽。
8. Assignment 只在首次启动、人工重试、busy 崩溃恢复时新建（generation+1）；权限应答与瞬时退避复用当前 Assignment。sessionId 跨代次稳定，不得充当 assignmentId/ticketId。
9. handoff Report（waiting/ready/blocked/failed/dropped）先标记意图；对应 turn 结束、无后续 Input、无占槽后台工作后才释放槽位；handoff 停 subagents、shell 作业可继续不占槽，Assignment 结束才 kill（MVP 以最终 Report 前确认子 agent 结束替代枚举；Phase 2 补 30 分钟后台上限与完成唤醒）。
10. read 语义：被 step 取走且随后有 Report/turn 结束才算已读；替换 Assignment 时未读 Input 回队首并清 Session 副本，保证只投一次。
11. Worker 角色工具面（方案 §8.2）：文件/搜索/shell/web/skill/todo/引擎 subagent/report/handback/mark_unrelated/follow_for_context；禁止直接向人发言、消息其他 Session、改全局配置。Router 工具面只读 + Phase 2 的 route/reply/note/request_status（note 为 100 字旁注不授权）。输出上限：路由说明 ≤30 字、聊天气泡 ≤100 字、Worker 提问只走结构化 question。

### C. 持久化、恢复与关闭

12. 项目状态目录 `<userData>/super-agent/projects/<projectKey>/`：state.json/events.jsonl/effects.jsonl/outbox.jsonl/project.json（schema 版本、执行策略、reviewReminderHours）。
13. 原子提交：先持久化事实（含 Effect）再广播；事件按 seq 追加；重启按 seq 重放；坏记录隔离报告不静默丢弃。
14. 恢复顺序（方案 §9.3）：版本迁移 → 锁 → 重放 → running→interrupted → busy 判定建恢复 Assignment → 对账 delivered 未 read → 续做 Effect/Outbox。
15. 显式 shutdown：停止接受命令 → 取消在跑 turn → 等在途 Effect 落定（有界，参考 10s）→ 关 Store 释放锁；关闭 tab 只停镜像不触发 shutdown。
16. 暂停是持久设置：跨重启、暂停期 Eval 不超时、恢复后 deadline 顺延、人消息恢复后按当前 Policy 重新校验。

### D. UI 复用（本 spec 对方案 §11.2 的修订）

17. **输入框复用主聊天 Composer**：Router 输入与 Worker 接管输入都实例化主聊天输入组件。受控参数：`sessionId`（Router/Worker 会话）、`draftScope`（Router 用会话草稿；Worker 接管用临时草稿域不冲普通会话）、`compact`（接管输入）、`showActions`/`enterSubmits`（按宿主裁剪）、`placeholder`（场景化文案）。斜杠命令、@file/@folder/@image、附件、草稿机制全量继承零副本；简化 = 只隐藏动作不裁剪能力。提交语义分层：Router send → Router 会话消息；「新建工单」独立按钮 → 显式派工；Worker 接管 send → workerMessage（先落领域 Input 再投递）。
18. **右侧任务页复用主聊天 AgentTimeline**：`sessionId` 绑定 Worker 稳定会话，`readonly=true` 走组件既有 inert 契约为只读镜像；接管为本地状态切换（readonly=false + 横幅 + 接管输入框），交还恢复只读；同一时刻至多一个面板接管、切换面板不自动接管；只读态权限对话框不可操作，接管态走与主聊天一致的确认流程、结果作为领域输入投递。
19. Report/产物/审计/Assignment 分段作为时间线上方薄层区块叠加，不侵入时间线组件内部。
20. 薄层新增组件仅限：中置状态条、单行工单卡片、Attention 气泡、接管横幅、系统问题面板、执行策略控件、健康汇总。

### E. IPC 与投影

21. 命令集（方案 §10.1）：bind/state/ticketAccept/ticketStop/attentionAnswer/takeover/giveback/workerMessage/executionPolicy/newTicket/abortRouter…；Phase 2 追加 evalReevaluate/problemDismiss/healthRetry 处置命令。
22. 事件集：ticket.updated/ticket.progress/attention.asked/attention.answered/queue.changed/router.status/timeline.append/health.changed。
23. `ticket.progress` 主进程归一化 + 1s 节流（只含阶段/assignment/currentTool/elapsed/lastActivity/toolCalls）；领域 seq 与节流投影 seq 分开，断档策略：领域事实重拉 state、进度丢弃不重拉。
24. 错误码一等 DTO：missing/refused/conflict/unavailable 四类 + 具体 code（ticketEnded/assignmentEnded/notRetryable/questionWithResult/notAnswerable/mandateRevoked/workerDecides/handedBack/slotUnavailable…）；i18n 键 `superAgent.errors.<code>`，zh-CN/en-US 同名，未知 code 回退通用文案并记 health。

### F. 路由、Eval 与 Policy（Phase 2）

25. Intake fan-out → 程序层 Gate（每 Source 准入表：scope × 名单 × @Agent，决定 explicit/inferred/不进入，不耗模型）→ 语义 Eval（按 Thread 串行、candidate 送达起算 deadline、重排 2 次后第 3 次 unavailable、Policy 版本变化丢弃重排）→ Decision（重复检查版本与去重）。
26. Policy 结构：acceptMode(off/observe/auto)、规则列表（命中写入 Mandate）、bot 名单（最多 inferred、不能显式请求/停止、跨 Source 不做身份映射）、版本化 + 续接前 revalidate。
27. owner/订阅语义：人消息先归所有可裁决的订阅工单，Router 只能 stop 不能 accept/attach/ignore/requeue；交回一次；attach 订阅整条 Thread，mark_unrelated 只退自己订阅（来源 Thread 与 follows 除外）；结束后订阅寿命最多两周。
28. Outbox/Channel：launch/delivery/relay/reply/reviewReminder 各自限流、保序；durable Effect 先持久化后执行，重启续做不无限重复。

### G. 健康模型

29. 健康项：Effect 各类、Source 游标、Eval unavailable（近 1 小时）、引擎/模型可用性、项目锁、迁移；同类连续 3 次失败才升级 error；delivery 永久失败显示在工单卡片不重复计入；MVP 只上报不可操作，Phase 2 提供重试/忽略。

### H. 模块划分（拆 tickets 的域边界）

30. 主进程：service（composition root）/domain+model/store+effects/routerRunner/executor+sessionPort/scheduler+policyStore/contextReader+contextBudget/sessionStatusQuery/reportParser+progressProjector/errors/health/migration/checkpointService/sources.desktop/superAgentIpc + shared channels。
31. Renderer：SuperAgentView（状态条/时间线/composer/派工入口）、薄层组件（§D.20）、stores/superAgent/、services/api/superAgent；修改 Sidebar/ChatPanel/InfoPanel/app store 接入三栏，不改 splitLayout、不新增 AppMode、不改只读 engine/。

## Testing Decisions

- 只测外部行为（props 契约、IPC DTO、可见状态迁移），不测内部实现细节；测试文件必须 import 被测模块。
- **UI 复用契约**（先例：ChatInput 提交测试、composer 提交逻辑测试）：sessionId 绑定正确；draftScope 隔离不写普通会话草稿；@ chip 序列化 marker 与主聊天一致；AgentTimeline readonly 时 inert、接管后可交互、交还恢复。
- **领域状态机**：阶段派生全分支（含 ended→idle）、blocked/failed 自动输入闸门、复用不换代次、Report 交叉校验拒绝、Attention 替换撤回、canRetry 可用集合、结束清理与消息回流。
- **持久化与恢复**：原子提交、seq 重放、busy 恢复建代次、read 对账、shutdown 有界收尾、schema 迁移单事务回滚/过旧拒绝/未知字段兼容。
- **调度**：串行默认、并行强制 worktree、handoff 槽位释放条件、后台工作占槽。
- **Phase 2 增量**：Eval deadline/重排/unavailable/暂停顺延、Policy revalidate、订阅 fast path、reply 授权链、PR 评审三轮上限。
- **集成**：真实 Store + fake Port 全链路（派工→执行→Report→验收）、断档重拉、错误码 i18n、明暗主题与双语。

## Out of Scope

- 团队 Prompt 版本/覆盖/审计（已定不做，另立提案，需先回答发布权限/覆盖审计/回滚三前提）。
- Phase 3 全部（Watchdog/跨项目/sidecar/投机执行）：默认不做，仅保留阶段位。
- 不为 Super Agent 引入第二套输入或时间线实现；不借机重构主聊天组件。
- 不修改 `splitLayout`、不新增 AppMode、不修改只读 `engine/`。

## Phase 划分（ticket 批次依据）

- **Phase 0 接缝验证**：会话归属、引擎 bind、上下文读写、错误码骨架。
- **Phase 1 Desktop MVP**：领域模型 + 状态机 + 调度 + 持久化恢复 + Router 对话 + 显式派工 + 工单卡片 + 只读时间线 + 接管 + Attention + 验收 + 健康（只读上报）+ 迁移 + 错误码/i18n。
- **Phase 2 外部驱动**：Source 接入 + Gate/Eval/Policy + 订阅 fast path + Outbox 回写 + PR 评审闭环 + 健康处置命令 + merged/closed 结束。
- **Phase 3 可选自治**：见 Out of Scope。

## Further Notes

- 两条 UI 复用决策已被现有组件契约验证：主聊天输入组件具备 sessionId/draftScope/compact/showActions/enterSubmits；会话时间线组件具备 sessionId 与 readonly（含 inert）。
- 原型已按目标形态通过浏览器验证（三栏、卡片、验收入口、接管/交还、明暗主题）。
- 状态机、错误码、字段以方案文档为单一真相源；本 spec 与方案冲突处以本 spec §D（UI 复用修订）为准。
- 待确认项沿用方案 §13.4：仅「review 首次提醒默认时长（提案 24h）」未闭合。
