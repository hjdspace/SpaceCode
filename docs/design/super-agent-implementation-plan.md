# SpaceCode 桌面 Super Agent 实施规格

> 状态：可实施规格；本轮只修改设计文档，不修改源码。
>
> 目标：在当前 Electron 桌面端实现“一个常驻 Router + N 个隔离上下文的 Worker + 持久化工单”的 Super Agent 机制，再逐步接入 IM、GitHub、CI 等多信道事件。
>
> 依据：[Super-agent 设计探索：迈向更自主的 Agent 系统](https://zhuanlan.zhihu.com/p/2099987320443237060)、用户提供的七张架构图，以及 `deepseek-ai/dsh-superagent-prototype` 本地源码（commit `8c32a9d`）。原型 README 明确说明它是研究原型，文章中的 daemon、Watchdog、投机执行等方向不等于已有实现。

---

## 1. 结论与已拍板边界

### 1.1 核心结论

Super Agent 不是新的 `EngineType`，也不是渲染层的多会话 DAG。它应是 **Electron 主进程内、位于 `engineGateway` 之上的持久化编排服务**：

- Router 是唯一面向人的协调者，负责全局路由、跨工单上下文和统一回复，不直接完成代码任务。
- Worker 按 Ticket 隔离上下文，使用完整执行工具，只向 Router/宿主报告，不直接向人发言。
- Ticket 是授权工作单元，生命周期独立于任何引擎进程；Assignment 才是一次具体执行。
- Source / Trigger / Thread / Subscription 是事件与上下文模型；Scheduler、durable Effects、Outbox 负责可靠推进。
- Renderer 只展示投影和发送人工命令，不拥有路由、队列、工单状态或 Worker 生命周期。
- 默认单机、单项目、显式派工、共享工作目录串行执行；隔离与并行必须由用户显式开启。

实现骨架复用 Factory 的“主进程编排 + Port 注入 + 自持调度 + 原子持久化 + IPC”方式，但不能直接复用其有界流水线语义；现有渲染层 Orchestration 继续保留为一次性手动 DAG。

### 1.2 桌面端决策记录

| 决策 | 定案 |
| --- | --- |
| 运行粒度 | 每个项目一个 `SuperAgentService`，一个 Router；全局注册表只管理服务与连接 |
| MVP 事件源 | 仅 Desktop UI；不接 IM / GitHub 自动监听 |
| 派工方式 | MVP 由输入框旁“派工”动作显式创建；不得解析模型文本中的 JSON 指令建单 |
| Router 可见性 | 在 Super Agent 中置聊天区可见、是唯一对话者；不进入侧边栏普通会话列表。过滤在 `chatSession` 列表层按会话类型排除（Super Agent 会话类型），不是用户设置开关（Q1 已定） |
| 默认工作区 | `worktree='none'`，Worker 在项目根目录执行；共享目录的后续工单继承前序改动 |
| 默认调度 | `serial`、`maxWorkers=1`；人工续接优先拿下一个槽，不抢占正在运行的 turn |
| 显式并行 | 仅允许 2–6 个 Worker，且所有并行 Ticket 必须使用 per-ticket worktree；运行中不热切换 |
| Worker 权限 | 共享目录默认 `acceptEdits` + Attention；显式隔离后才允许 `bypassPermissions`，且全程审计 |
| Report | MVP 使用严格 JSON 块；后续用宿主结构化工具替代 |
| 状态位置 | `<userData>/super-agent/projects/<projectKey>/`，不写仓库、不写 localStorage |
| 停止与重试 | 停止保留现场；重试新建 Assignment，默认续用同一 Worker Session 与工作区 |
| UI | 侧边栏入口 + 固定中置 IM 视图 + 单行工单卡片 + 右侧只读 Worker 工作态 |
| 自动化边界 | 不自动合并 PR、不自动创建修复工单、不让 Worker 之间点对点通信 |

### 1.3 阶段范围

- **Phase 0**：验证主进程会话、工具裁剪、观察镜像、权限转接和恢复等接缝。
- **Phase 1**：Desktop 手动 Super Agent MVP；完整 Ticket / Assignment / Report / Attention、串行队列、持久化、基础 Inline & Spill、异步 Router、停止/重试/恢复和最小 UI。显式 worktree 与并行也在此阶段作为受控策略交付。
- **Phase 2**：接入外部 Source，完成两级 Eval、Thread 订阅直通、Channel Outbox、结构化路由/报告工具与可追踪后台任务。
- **Phase 3**：Watchdog、跨项目、sidecar/daemon、投机执行等自治增强；均非 MVP 前置条件。

### 1.4 与原型实践的有意偏离及代价（复审新增）

以下偏离来自已拍板决策，本轮不推翻，只把代价写明，避免实施时误以为“原型就是这么做的”。

| 偏离 | 原型做法 | 代价与需要补的防线 |
| --- | --- | --- |
| 默认共享目录 `worktree='none'` | 每个 Ticket 一个独立目录，`prepare` 命令按需建 worktree（`docs/003-execution.md` 第 25、49–53 行；`src/executor/dsh.ts` 的 `prepare`） | 失去目录级隔离，Worker 可能改到工单外文件；检查点只能人工按文件回退。必须保留建单前脏区检查与停止/失败保留现场（§7.3），并把“共享根目录、前序工单已改动”写进 Worker 首条消息。 |
| `maxWorkers=1` 且没有“人的消息”额外槽 | 并发上限之外给“人的消息/状态请求”留一个额外槽，保证插话不排队（`docs/003-execution.md` 第 57–61 行；`src/executor/dsh.ts` 的 `WorkerSlots.reserve`） | 串行模式下人工续接必须等当前 turn 结束，原型那种“随时插话”的体验不存在；只有显式 `parallel + per-ticket worktree` 才能部分补回。UI 与文案不得把“可插话”写成已实现能力。 |
| `ready` 进入待验收，人工确认后才 `completed` | 无 PR 时 `ready` 直接结束工单；有 PR 时按 PR 关闭/合并结束（`docs/003-execution.md` 第 92–106 行；`src/core/assignments.ts` 的 `report`） | 新增一个原型没有的“待验收”停留态，必须有明确 UI 入口，否则工单会长期停在 `person/review`；原型的 `merged/closed` 结束结果还要在 Phase 2 GitHub 接入时补回，不能压成 `completed`。 |

复审期间曾把 `blocked/failed` 后的人工消息设计为新建 Assignment；最终决定改为复用原 Assignment（与原型一致），详见 §5.3，不再作为偏离项。

---

## 2. 七张架构图补齐的设计语义

| 图 | 必须保留的语义 | 在本规格中的落地 |
| --- | --- | --- |
| 总体架构 | Trigger 经两级过滤进入 Router；订阅事件可绕过 Router 直达 Worker；Router/Worker/Watchdog 状态均持久化；执行环境与多信道是独立边界 | 第 4、6、9 节 |
| Router 双向连接 | IM、GitHub、邮件/日程与 Router 双向交互；Router 与多个 Worker 也是双向消息关系，不是单向任务下发 | 第 6.4、7.1 节 |
| 两级过滤 | 程序层确定性准入不调用 LLM；语义层只判断是否需要工作，不能直接获得执行授权 | 第 6.1 节 |
| Thread 示例 | 同一 IM 话题或 PR 下的消息、CI、Review 都是有序 Trigger；一个 Thread 可关联多个 Ticket | 第 5 节 |
| 订阅直通 | 首个事件经 Slow Path 建 Worker 并订阅；同 Thread 后续事件走投递 Fast Path，避免重复路由 | 第 6.2 节 |
| Inline & Spill | Trigger 内联摘要与下一跳 ID；完整 Trigger、Thread、Worker、Ticket 通过只读引用按需展开 | 第 8.1 节 |
| 异步 ReAct | `start()` 立即返回 Started；耗时工作后台推进；新消息和完成结果作为后续输入驱动新的 LLM 轮次，Router 不阻塞等待 | 第 7.1 节 |

特别需要区分两个“Fast Path”：

1. **准入 Fast Path**：Source/Gate 的确定性过滤，回答“这个事件有没有资格进入语义评估”。
2. **投递 Fast Path**：Subscription fan-out，回答“这个已接收事件应直接追加到哪些既有 Ticket”。

二者都不能单独扩大 Mandate；语义评估、显式人工命令或既有授权才决定能做什么。

---

## 3. 当前代码的可复用能力与真实缺口

### 3.1 可直接复用

| 能力 | 当前实现 | Super Agent 用法 |
| --- | --- | --- |
| 主进程 Agent Port 先例 | `electron/factory/agentEngineGateway.ts` | 复用配置解析与 route event 收敛经验，改造成事件式 `SessionPort`，不照搬阻塞 `run()` |
| 调度与恢复先例 | `electron/factory/scheduler.ts`、`recovery.ts`、`atomic.ts` | 自持 Worker 闸门、损坏文件隔离、原子写；不依赖引擎池 evict |
| worktree 与事件日志 | `electron/factory/worktree.ts`、`events.ts` | 显式隔离和 JSONL 审计 |
| 引擎统一入口 | `electron/engine/engineGateway.ts`、`EngineFactory.ts` | 启动、发送、abort/stop、状态与 `onRouteEvent` |
| 会话配置 | `EngineSessionConfig`、`loadEngineSessionConfig` | cwd、模型、权限、system/append prompt、resume |
| Worker 观察镜像 | `src/stores/chatSession.ts` 的 `attachObservedSession` | Router/Worker 的只读实时镜像；detach 不停引擎 |
| 三栏挂载点 | `CenterTab`、`ChatPanel.vue`、`InfoPanel.vue`、`splitLayout` | 固定 Super Agent tab 和 Worker 面板，不引入 vue-router |
| 平台连接 | `electron/im/`、`electron/imServer/`、Factory GitHub 代码 | Phase 2 只复用传输与平台协议，不复用其“直接调用单会话引擎”的路由 |

### 3.2 必须先补的接缝

1. **主进程不能订阅渲染层 `turn.onTurnOutcome` 来推进领域状态。** Executor 必须直接消费 `EngineFactory.onRouteEvent` 的 `result/error/exit`；turn store 只用于 UI 镜像。
2. `EngineSessionConfig` 当前没有 `allowedTools` / `disallowedTools`；底层 `SessionConfig` 也只有 `allowedTools` 和对应 CLI 参数。需增加可选字段并透传。`--allowedTools` 是免审批清单，不是工具白名单。
3. `sessionProcess` 会无条件追加 AskUserQuestion 指引。Worker 的工具面若禁止向人提问，就必须能关闭这段角色冲突的提示，而不是只隐藏工具。
4. `buildEnabledMcpConfig()` 当前把所有全局启用的 MCP 注入会话，不是 Super Agent 的按角色工具边界。需要 per-session MCP 投影；不得为了 Super Agent 改写用户的全局 MCP 配置。
5. Factory 的 `AgentPort.run()` 等待 turn 结局，不足以表达 Started、deliver、report、background completion 等异步事件。Super Agent 需要事件式 Port 和每会话输入队列。
6. 引擎 `result` 不代表后台 shell job / subagent 已结束；当前没有统一的会话级作业枚举。MVP 不得宣称已实现原型的完整后台占槽语义。
7. 当前没有编排级 `SessionStatusQuery`、Ticket 资源读取和结构化 `report` 宿主工具。
8. 普通 IM Server 目前直接 `startSession/sendMessage`。Phase 2 的 Super Agent Source 必须先转成 Trigger 进入领域服务，不能绕过 Router/Subscription 直接唤醒任意 Worker。
9. 当前 `sendMessage` 只写引擎 stdin，没有跨重启幂等键、接受回执持久化或 inbox/read 对账。崩溃发生在“引擎已接受、宿主尚未记录”时无法安全判断能否重投；该窗口必须先进入 Phase 0 验证，不能承诺天然 exactly-once。

---

## 4. 目标架构与所有权

```text
┌──────────────────────────── Electron main ────────────────────────────┐
│ SourceRegistry                                                        │
│   desktop (P1) | IM / GitHub / CI (P2)                                │
│        │ Trigger                                                      │
│        ▼                                                              │
│ Intake ──► Gate(Fast) ──► Eval(Slow) ──► Decision                     │
│   │                                      │                            │
│   └──────── Subscription fan-out ────────┼──────────────┐             │
│                                          ▼              ▼             │
│ SuperAgentService                  RouterRunner      Ticket/Input      │
│   ├─ Domain / Policy                   │                │             │
│   ├─ Scheduler / Executor              ▼                ▼             │
│   ├─ ContextReader / StatusQuery   SessionPort ◄── Worker Sessions    │
│   ├─ ProgressProjector                   │                │             │
│   ├─ TicketStore / Effects / Outbox      └──── Report ────┘             │
│   └─ Channel adapters ──► Desktop / IM / GitHub                         │
│                                                                         │
│ engineGateway / sessionProcess / local execution environment            │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ typed IPC + read-only projections
┌──────────────────────────────────▼──────────────────────────────────────┐
│ Renderer                                                                │
│ SuperAgentView: Router IM + ticket cards + Attention                    │
│ InfoPanel: Worker transcript / Report / artifacts / explicit takeover   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.1 单一写者

| 状态 | 唯一写者 | 其他组件能做什么 |
| --- | --- | --- |
| Trigger、Thread、Decision、Ticket、Assignment、Subscription | Domain Service | 通过命令请求变更，读取投影 |
| Router/Worker 引擎进程 | SessionPort + RouterRunner/Executor | Renderer 只观察；停止/接管必须走主进程命令 |
| Scheduler 槽位与队列 | Scheduler | Router 只能查看或建议，不能改并发 |
| Effect、Outbox | Store | Adapter 在提交后执行并回报事实 |
| Session/Report/Attention 的 UI 投影 | ProgressProjector / IPC projector | Renderer 不根据 token 流另算工单状态 |
| Source 游标与平台元数据 | 对应 Source | 不写入 Ticket 私有字段 |

### 4.2 Router 与 Worker 的会话归属

Router 和 Worker 都由主进程创建、恢复和销毁。Renderer 通过 `attachObservedSession` 获取只读镜像：

- Router composer 发送 `superAgent:routerMessage`，不能走普通 `chatSession` 的引擎发送路径。
- Worker 默认没有输入框；只有显式“接管”才允许输入，并暂停该 Ticket 的自动输入。
- 关闭 Super Agent tab 或整个 Renderer 不停止主进程编排；应用主进程退出后的恢复见第 9 节。
- Worker 不进入普通会话列表，Router 也不在侧边栏生成一条普通聊天。

---

## 5. 领域模型与状态机

### 5.1 核心对象

| 对象 | 定义与关键约束 |
| --- | --- |
| Source | 事件流及读取游标；负责丢弃自身 bot 消息、监听范围外事件和平台去重 |
| Trigger | 不可变事件，携带 Source、actor、原文、时间、来源元数据和稳定幂等键；同一 Trigger 重复接收不得重复建单 |
| Thread | 同一 IM 话题、Issue/PR、邮件串或 Desktop 工单对话中的有序 Trigger；同一 Thread 同时最多一个 Eval |
| Correlation | Trigger 同时属于多个 Thread 的关联，只补上下文，绝不参与路由 |
| Channel | Thread 的写入侧，如 Desktop 气泡、IM 回复、GitHub 评论；Worker 不可直接写入 |
| Policy / Eval / Decision | 版本化授权策略；Gate + Assessment 产生 `accept/stop/ignore/unavailable`，代码在提交 Decision 前再次校验 Policy |
| Mandate | 不可变授权：Policy 版本、scope、strength、匹配规则、来源 actor；扩大 scope 必须新建 Ticket |
| Ticket | 一次授权工作；持有 Mandate、Channels、Inputs、Assignments 和结束信息，不跟随 CLI 进程生死 |
| Assignment | Ticket 与一次 Worker 执行的绑定；`pending/running/ended/interrupted` 独立于 Ticket |
| Subscription | Ticket 与 Thread 的多对多关系，由 Thread 持有；负责上下文投递，不新增权限 |
| Input | 投给 Ticket 的 Trigger、人工文本、Policy 变化、恢复说明或 Router note；必须记录 `pending/delivered/read/failed/uncertain` 状态；瞬时退避保持 pending，永久投递失败才是 failed |
| Report | `progress/waiting/ready/blocked/failed/dropped`；必须含 `assignmentId/reportId/kind/summary`，结构化事实驱动 Ticket 阶段，不能从自由文本猜“正在等人” |
| Attention | 一个具体的人工问题或权限请求；未回答时持久存在，回答后可审计 |
| Effect / Outbox | 先持久化、后执行的启动/投递/中继/回复工作；保证重启后续做且不会无限重复外部动作 |

### 5.1.1 关键字段补齐（复审新增）

原型的领域对象字段比本表的概念名更细，以下字段不是可选装饰，缺了就无法实现 Gate、订阅、唤醒和恢复。至少要落到 `model.ts` / DTO 里：

| 对象 | 必须补的字段 | 缺了会怎样 |
| --- | --- | --- |
| Trigger | `threads[]`（`threads[0]` 为主 Thread）、`human`、`addressed`（`mention/direct`）、`channel`、`url`、`meta`、`disposition`（`filtered/evalId/decisionId/fanout/context/requeued/handbacks/acked`） | 没有 `human`/`context` 就无法区分“人消息可唤醒”与“仅上下文”；没有 `channel` 无法回写；没有 disposition 就无法做幂等、去重、handback 与审计。 |
| Thread | `subscriptions[]`、`context[]`、`pending[]`、`evaluating`、`expired`、`correlated[]`、`meta` | 没有 `context` 会把只读订阅当成可写授权；没有 `expired` 无法实现 Eval 连续超时。 |
| Ticket | `title`、`origin{triggerId,triggerIds}`、`ended{at,by,outcome,reason}`、`attention`、`answers[]`、`execution{name,directory,assignment}`、`follows[]`、`delivery{error,at}`、`undelivered[]`、`reviewRemindedAt` | 无法区分“由人停止”与“执行器完成”，无法保留 PR/Issue 跟随关系，也无法在结束瞬间释放未投递 Input；`reviewRemindedAt` 是 review 超时提醒的持久水位（`null` 表示尚未提醒）。 |
| Assignment | `assignmentId`、`generation`、`state`、`createdAt/startedAt/endedAt/endedReason`、`report{state,summary,at}`、`deliveredAt`、`idleAt` | 只有 `pending/running/ended` 不足以判断“Report 之后是否又有 Input”“这一轮何时真正空闲”，阶段派生会误判；没有 `generation` 则无法区分“同一执行继续”和“重试/恢复的新一代”。 |
| Input | `kind` 覆盖 `trigger/text/note/policy-changed/resumed/reopen`；trigger 输入另有 `human/context/note/readAt(null 表示已到 Session 但未被 step 取走)/deliveredTo` | 只用 `pending/delivered/read/failed/uncertain` 无法表达“投递成功但未读”“被哪一代 Assignment 读过”，恢复时一定重投或漏投。 |
| Mandate | `strength`、`policyVersion`、`basis`（`addressed/followup/admission/bot` 至少四类）、`actor`、`scope` | Phase 2 的续接前 revalidate 需要按 `basis` 重算，只有一句“有授权”无法判断是否已失效。 |
| Report | `state`、`summary`、`at`、`askedBy`、`answers` | 缺 `askedBy/answers` 时 Router 无法知道 Worker 已回答哪条人问题，只能冒充回答或永远不答（见 §5.4）。 |

Ticket 的 `ended.outcome` 在本阶段只产生 `completed/dropped/stopped`，但字段与枚举预先保留 `merged/closed`，供 Phase 2 的 Thread 关闭使用（原型 `src/core/model.ts` 的 `TicketOutcome`）。

Desktop MVP 也使用 Trigger / Thread / Input，而不是等 Phase 2 再迁移数据模型：显式“派工”生成 `source='desktop'`、`strength='explicit'` 的 Trigger，并原子创建 Ticket、Mandate、初始 Thread 与 Subscription。Desktop 每个 Ticket 使用独立 Thread，避免把 Router 主会话里的所有后续消息广播给所有工单。

### 5.2 Ticket 阶段是派生值

Ticket 只持久化 `open/ended` 及领域事实，展示阶段按以下优先级派生，避免 `stage` 与 Report/Assignment 双写漂移：

| 优先级 | 条件 | 阶段 |
| --- | --- | --- |
| 1 | 已人工停止、完成或丢弃 | `stopped/completed/dropped` |
| 2 | Input 投递失败 | `person/delivery` |
| 3 | 有未回答 Attention | `person/answer` |
| 4 | 最新 Assignment 的 Report=`ready` | `person/review` |
| 5 | 最新 Assignment 的 Report=`blocked/failed` 且之后没有人工消息 | `person/blocked` 或 `person/failed` |
| 6 | 没有 Assignment 或最新 Assignment=`pending` | `working/queued` |
| 7 | 最新 Assignment 的 Report=`waiting`，或最新 Assignment 已 `ended` 且之后没有新 Input | `idle` |
| 8 | 其余 | `working` |

（复审新增：原型 `src/core/stage.ts` 把 `assignment.state === 'ended'` 也归入 `idle`。方案原表遗漏这一分支，Worker 正常退出但没有最终 Report 时会被永久显示为 `working`，卡片永远转圈。）

规则：

- `ready` 表示“待验收”，永不直接结束 Ticket；用户验收后 Ticket 才 `completed`，用户续问则在原 Mandate 范围内重开。
- 人的新消息可解除 `blocked/failed/idle/review`，但必须先通过 Scheduler 获得槽位再唤醒 Worker。
- 人工 `stop` 撤回 Mandate，后续事件不得自动重开；普通结束不销毁 Mandate，人工续接前重新校验 Policy。
- 只有 `dropped` Report 能自动结束 Ticket；其余结束迁移只有 `ticketAccept → completed` 和 `ticketStop → stopped`。Worker 进程退出本身不能推断任务完成。
- 新 Assignment 一旦 pending/running，其上一代 Report 不再决定当前阶段；旧转录与 Report 仅保留作历史。
- **（收口新增）人工消息解除 `blocked/failed` 时复用原 Assignment。** 阶段从 `blocked/failed` 回到 `working` 只由“之后已有新 Input”这一事实驱动，不新建 Assignment、不递增 `generation`、不换右侧执行分段；卡片仍以 `ticketId` 为身份。（定案，与原型 `src/core/tickets.ts` 的 `addInput` 一致）
- **（收口新增）`review` 超时只提醒，不改变状态、不自动验收。** 进入 `review` 后按可配置的 `reviewReminderHours` 计时（**默认提案 24 小时；此默认值为提案、待用户确认**）；首次到点外发一次，之后每 24 小时最多一次，直到 `ticketAccept`、`ticketStop`、人工追问重新进入 `working` 或离开 `review`。超时后仍保持 `person/review`，不降级、不自动 accept；每次外发把 `reviewRemindedAt` 落盘，重启不重复补发。
- **复审新增：`blocked/failed` 是输入闸门，不只是展示阶段。** 在“最新 Report 为 blocked/failed 且之后没有人工消息”期间，bot、CI、Router note 等自动 Input 只落库、不投递、不唤醒；只有人的消息、人工重试或一条非 blocked/failed 的新 Report 才能解除。原型把这条判定抽成 `waitsForPerson` 并被阶段、投递、重试复用（`docs/003-execution.md` 第 123–141 行；`src/core/model.ts` 的 `waitsForPerson`；`src/core/tickets.ts` 的 `addInput` 会 hold 自动输入）。
- **复审新增：结束必须清理派生状态并交还未裁决的人消息。** stop/completed/dropped 时清空 `attention` 与 `delivery`，并把人消息中“未读、未确认、未回答、未交回”的 Trigger 从该 Ticket 的 fan-out 释放；若没有其他 owner 且未被 Decision 裁决，就回流 Eval。否则一条在工单结束瞬间到达的追问会被静默吞掉（原型 `src/core/tickets.ts` 的 `end` / `letGo` / `refuse`）。
- **复审新增：结束迁移要为 Phase 2 预留形态。** Phase 1 只有 `dropped` 自动结束与 `ticketAccept/ticketStop`，但 `merged/closed` 通过 Thread 关闭结束（PR/Issue）必须在 Phase 2 接入，且不得改动本表的优先级；届时是“按 `followsDone` 结束”，不是新增一条更低的 `stage`（原型 `docs/003-execution.md` 第 96–106 行；`src/core/tickets.ts` 的 `followsDone`）。

### 5.3 身份与幂等

- `ticketId`、`assignmentId`、`triggerId`、`inputId`、`reportId`、`effectId` 都是稳定领域 ID。
- Router session：`superagent-router-<projectHash>` 派生 UUID。
- Worker session：`superagent-worker-<ticketId>` 派生 UUID，跨 Assignment、重试和重启保持稳定。
- Assignment 只在首次启动、人工重试、busy 崩溃恢复时新建。`blocked/failed` 之后收到人工消息、`waiting/ready` 后续追问、权限应答和瞬时错误退避都复用当前 Assignment；不新增一代、不切换右侧执行分段。
- `assignmentId` 在 Ticket 内稳定标识一次执行；`generation` 从 1 开始，只在新建 Assignment 时递增，复用不递增。Report 的 `assignmentId+reportId` 幂等、Attention 的 `askedBy/answers` 归属和 Worker 转录分段都绑定同一个 `assignmentId`，不会因人工唤醒而漂移。
- 复用后的 Report 规则：同一 Assignment 内以“最新 Report 覆盖阶段、历史 Report 只追加审计”为准；带 `question` 的 Report 创建/替换 Attention，带 `answers` 的 Report 在同一 Assignment 上追加认领记录，`askedBy` 仍指向原人消息；不得把复用后的 Report 当作新执行分段。
- 重试和重启恢复新建 Assignment 时 `generation+1`；因此“执行代次”只由失败、重试、重启产生，不由普通对话或人工续问产生。
- UI 只按 `ticketId` 定卡片，按 `assignmentId/generation` 定右侧执行分段；`sessionId` 跨 Assignment 稳定，不能拿来当 `assignmentId` 或 Ticket 身份。
- 所有外部命令携带幂等键：Source 事件键、UI `requestId`、Report 的 `assignmentId+reportId`、Outbox 的 `messageId`。重复事实返回原结果，不重复执行副作用。

### 5.4 Report / Attention 生命周期（复审新增）

Report 与 Attention 不只是展示对象。原型在这里有一组硬校验，方案此前只覆盖了“创建 Attention”，缺少关闭、替换与回答授权链：

- **问题与结果互斥**：`ready` 或携带 `answers` 的 Report 不得同时带 `question`；`question` 必须指向一条到达本 Ticket 的人消息，否则拒绝。
- **回答必须可追溯**：Report 的 `askedBy` 记录提出该问题的人消息，`answers` 记录本条 Report 回答的人消息。只有 Worker 用 `answers` 认领过的人问题，Router 才被允许发送 `answer`；否则 Router 只能回泛化说明，不能冒充“Worker 已回答”。（原型 `src/core/assignments.ts` 的 `report` 校验；`src/core/replies.ts` 的 `answer`；`src/core/errors.ts` 的 `questionWithResult/askerWithoutQuestion/notAsker/notAnswerable/noAnswer`）
- **Attention 替换即撤回**：`question: null` 显式清除；新问题替换旧问题时，旧的未发出 attention 回复必须从 Outbox 撤回，不能出现两条相互矛盾的问题气泡。工单进入 `ready` 或任何结束都必须清空 Attention。（原型 `src/core/assignments.ts` 的 `withdrawAttention`；`src/core/tickets.ts` 的 `end`）
- **同一问题只提醒一次**：Attention ID 由 `ticketId + question + at` 派生，重复 Report 不新建；`answered` 后折叠但保留审计。
- **权限请求与业务问题共用 Attention，但来源字段不同**：权限请求额外记录 `sessionId/requestId`，回答时不需要 Worker 的 `answers` 认领，但仍遵守“先拿槽位再应答”。

`waitingForHuman` 只能由结构化 `question` 或权限请求置位，不得从 `summary` 自由文本推断。

---

## 6. 路由、过滤、订阅与多信道

### 6.1 两级 Eval（Phase 2）

**程序层 Gate / 准入 Fast Path**

- 在调用 LLM 前检查 Source 是否启用、群组/仓库范围、来源白名单、actor 是否允许、bot 是否可成为候选、显式 @Agent 等。
- 无关来源直接记录 `filtered` 和原因码；不消耗模型，不把正文送入 Router。
- Gate 只给出候选资格和 `explicit/inferred` 强度，不创建 shell、不执行代码。

**语义层 Assessment / Slow Path**

- 输入为 Trigger batch、Thread 有界快照、该 Thread 上既有 Ticket（含已结束）和当前 Policy。
- 输出 `accept/stop/ignore/unavailable`；例如普通“界面挺清爽”应 `ignore`，明确缺陷反馈才可成为候选。
- 每个 Thread 的 Eval 串行；评估期间新到 Trigger 合并进下一批，不并发修改同一 Thread。
- Domain 在提交 Decision 时重新检查 Policy 版本、scope 与去重。模型不能自行授予权限。

**Eval 时限、重排与 `unavailable`（Phase 2，复审新增）**

方案此前只写“每个 Thread 的 Eval 串行”，缺少原型里最容易在长期运行中出问题的时限规则：

- 时限从 `candidate` 真正送达 Router 的那一刻起算；未送达的 Eval 不计时、不超时。
- 超时把本批 Trigger 重新排队（仍按 Thread 串行），连续 2 次超时后的第 3 次记 `unavailable`；`unavailable` 不是 `ignore`，需要 Phase 2 面板处置：重新评估或显式忽略。
- Policy 版本变化会丢弃运行中的 Eval 并按新版本重排；旧版本的评估结果不得直接落地。
- 暂停期间 Eval 不超时；恢复时 deadline 顺延一个暂停时长，否则一次长时间暂停会把所有候选判成超时。
- `unavailable` 仅在 24 小时内、仍是该 Thread 最新 Decision、未被忽略、Thread 未排队时升级为人工问题，避免超时风暴变成 Attention 洪水。

（证据：原型 `src/core/evals.ts` 的 `expire` / `candidateDelivered` / `REQUEUES`；`docs/002-authorization.md` 第 147–155 行）

**Policy 结构（Phase 2，复审新增）**

方案此前只写“版本化授权策略”。至少要把原型已有的四块结构落成数据模型，否则 Gate/Assessment 无法实现：

| 结构 | 作用 |
| --- | --- |
| `acceptMode: off / observe / auto` | `observe` 只记录“本会接受”，不建单，适合先观察模型路由质量；MVP 的桌面显式派工不依赖它。 |
| 规则列表（name / instruction / 流程与沟通要求） | 每条被命中的规则写入 Mandate 并下发给该 Worker；`observe` 下也要逐条评估。 |
| 每个 Source 的准入表（scope × 是否名单内 × 是否 @Agent） | 决定 `explicit / inferred / 不进入`，属于程序层 Gate，不消耗模型。 |
| bot 名单与身份 | bot 最多产生 `inferred` 候选，不能显式请求、不能 stop；跨 Source 不做身份映射。 |

（证据：原型 `docs/002-authorization.md` 第 47–105 行；`src/policy.ts` 的 `gate` / `revalidate` / `admitsInferred`）

Desktop 显式派工不经过语义 Assessment，但仍生成 Decision 与 Mandate，保证审计链一致。

### 6.2 Subscription 投递 Fast Path

Intake 的顺序必须是：**存 Trigger → 更新 Thread → fan-out 给既有订阅 → 决定是否需要 Eval**。

- 新 Thread 的首个有效事件可经 Slow Path 建 Ticket，并建立 Subscription。
- 同 Thread 后续事件直接追加为所有存活订阅 Ticket 的 Input，不要求再次 @Agent，也不重复经过 Router 路由。
- 到达 Ticket 的人工消息由该 Worker 优先判断是否在 scope 内；所有 owner 都 hand back 后，才重新进入 Eval。
- Bot/CI 事件可以唤醒存活 Ticket，也可按 Policy 独立成为候选；不能伪造人工授权。
- 已结束但未停止的 Ticket 保留 Subscription：人工消息可按原 Mandate 重开；bot/CI 只记录，不直接重开。
- context-only Subscription 只提供上下文，不赋予 follow-up 所有权，也不能重开已结束 Ticket。
- 人工停止的 Ticket 不再接收自动输入。
- 一个 Thread 可有多个 Ticket；不得用“话题相似”自动挂接。Router 只有在消息显式引用 Ticket、PR、Issue 或来源消息时才能 attach。
- Worker 认为事件越权或属于其他 Ticket 时执行 handback，不能自行把事件转发给另一个 Worker。
- **复审新增：owner 判定与拒绝语义要写死在 Domain。** 一条人消息先归属所有已订阅且仍能裁决它的 Ticket；此时 Router 只能对这张工单执行 `stop`，`accept/attach/ignore/requeue` 都必须被代码拒绝，直到所有 owner 交回或结束。交回一条消息只允许一次，交回后仍保留 Subscription。（原型 `docs/002-authorization.md` 第 22–34 行；`src/core/model.ts` 的 `followupOwners`；`src/core/errors.ts` 的 `workerDecides/handedBack`）
- **复审新增：attach 的代价是整条 Thread 订阅。** 显式引用可以 attach，但 attach 会订阅该 Trigger 的全部 Thread；Worker 发现 Thread 无关时只能 `mark_unrelated` 丢掉自己的订阅并交回消息，不能悄悄忽略。来源 Thread 与工单自己 follow 的 Thread（如 PR）不允许退订。（原型 `docs/004-prompts.md` 第 82 行；`src/core/tickets.ts` 的 `attach` / `markUnrelated` / `dropSubscriptions`）
- **复审新增：结束后的订阅寿命。** 已结束未停止的工单保留订阅，但 Source 只为“仍有存活订阅”的 Thread 轮询，且最多到最后一个 Trigger 或订阅工单结束后两周；之后只走普通 intake，避免永久轮询。（原型 `docs/003-execution.md` 第 116 行）

### 6.3 Router 批处理与非阻塞中继

- 同一时刻每个项目最多一个 Router turn；Router 正在推理时，新 candidate、Report、follow-up 进入有序队列，在下一批合并。
- `progress` 可折叠为最新一条；`ready/blocked/failed/dropped`、Attention、人工消息和停止请求不得被折叠丢失。
- Report/Attention 到达即持久化，再由 durable `relay` 投给 Router；Router 失败不回滚 Ticket 事实。
- Router 无工作可做时结束当前 turn，禁止 `sleep` 或等待 Worker 返回。
- 每轮给 Router 的变长信息（Policy 版本、队列摘要、新事件）追加在会话尾部；稳定角色提示保持前缀不变，避免每轮重写 system prompt 破坏缓存。

### 6.4 Channel 与 Outbox（Phase 2 外部信道）

- Router 统一产生 `acknowledgement/answer/result/attention`，由 Channel adapter 写回 Desktop、IM 或 GitHub。
- 每条外发消息先写 Outbox，再由 effect 执行；同一 Ticket + Channel 严格有序，不同 Ticket 可并行。
- Channel 返回 `sent/waiting/gone`；暂时失败指数退避，永久消失记录 dropped，不能无限重发。
- Worker 只返回 Report 和 artifacts，不持有平台凭据，不直接发群消息、评论、邮件或 PR 合并命令。
- **复审新增：四种回复各有一条授权规则。** `acknowledgement` 只能指向一条到达该 Ticket、且有回复地址的人消息，工单已结束则拒绝；`answer` 只能指向 Worker 已用 `answers` 认领的人问题，不能把普通 progress 改标签成回答；`result` 只在 `ready/completed/merged/dropped` 时允许，`progress` 不得作为结果外发；`attention` 必须匹配当前未清除的 Attention 文本，旧问题的外发在问题被替换时撤回。同一目的 + 同一来源使用稳定 ID，重复请求返回原回执。（原型 `src/core/replies.ts`；`src/core/errors.ts` 的 `notReady/notAttention/notQuestion/noAnswer/ackEnded`）

---

## 7. 执行模型：异步 ReAct、调度与恢复

### 7.1 事件式 SessionPort

不要把 Factory 的阻塞 `run(): Promise<AgentTurn>` 当作 Super Agent 的核心协议。最小端口应表达生命周期与事实事件：

```ts
export interface SessionPort {
  start(sessionId: string, config: EngineSessionConfig): Promise<void>
  deliver(sessionId: string, content: string, requestId: string): Promise<void>
  abort(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  onEvent(listener: (event: UnifiedEngineEvent) => void): () => void
  getActiveSessions(): EngineSessionStatus[]
}
```

- `start/deliver` 的 Promise 只表示引擎已接受请求，不表示任务完成；`assignmentStarted` 在启动被接受后记录。
- `requestId` 同时写入持久化 Input 和发送给引擎的消息信封。只有接受事实落盘后才标 delivered，只有 transcript/inbox 证明模型已接收后才标 read。
- **复审新增：`read` 的边界要按“被 step 取走且随后有 Report / turn 结束”判定。** step 取走消息后又被取消或报错，仍算未读；被替换的 Assignment 要把“已投递未读”的 Input 放回队首，并清掉 Session 中仍在等待的那一份副本，保证只投一次。方案现有的 `requestId` 对账只覆盖“宿主未记录接受”的窗口，不覆盖这一层。（原型 `docs/003-execution.md` 第 150–152 行；`src/core/tickets.ts` 的 `requeueUntaken`；`src/core/assignments.ts` 的 `read` / `interrupted`）
- 若崩溃留下“已调用 deliver、接受结果未知”的窗口，恢复时先按 requestId 对账；无法证明已读或未读时标 `uncertain + Attention`，禁止自动重投，避免重复执行已产生的副作用。
- 同一 Session 的输入按 Input 顺序串行投递；引擎忙时留在 durable delivery effect，不并发写入同一 stdin。
- Executor 为每次 turn 关联 Assignment；`result/error/exit` 和 Report 只归入当前 Assignment，上一代迟到事件必须记录并丢弃，不能污染新执行。
- RouterRunner 与 Executor 都使用该 Port，但拥有不同角色配置和输入队列。

**异步 ReAct 的两层含义：**

1. **编排层（MVP 必须实现）**：派工立即返回“已受理/已启动”，Router 可以继续回答其他消息；Report、Attention、后续人工消息和恢复事件会驱动新轮次。任何 Router 工具调用都不得等待整张 Ticket 完成。
2. **Worker 工具层（受当前引擎能力限制）**：长命令应使用引擎原生后台任务并返回 task id；完成通知若能被引擎事件观测，就转成新 Input 唤醒 Worker。当前缺少统一作业枚举时，MVP 只保证跨 Session 非阻塞，不宣称同一 Worker 在任意长工具期间都能立即处理新消息。

MVP Worker 不得在最终 Report 前遗留不可见的写入型后台任务；仅供验收的 dev server 等长进程必须明确标记为“可能仍在运行”。Phase 2 增加作业注册、完成通知、停止与占槽规则后，才完整对齐原型的后台 ReAct。

### 7.2 Scheduler

- 默认 `serial/maxWorkers=1`。槽位在任何 `await` 之前同步预留，覆盖 prepare、启动、唤醒和活动 turn。
- 新 Ticket 按 `queueOrder` FIFO；人工续接和人工重试排在下一次调度的队首，但不打断正在运行的 turn。
- handoff Report 仅指 `waiting/ready/blocked/failed/dropped`，它先标记 handoff 意图；对应 turn 已结束、没有后续 Input 且没有占槽后台工作后，才释放逻辑槽位。不能在活动 turn 中因提前看到 `ready/blocked` 就启动下一个共享目录 Worker。
- **复审新增：handoff 与 Assignment 结束时后台工作的处置不同。** 原型在 handoff 时停止 subagents，shell 作业（如验收用 dev server）可继续且不占槽；Assignment 真正结束时才 kill shell 作业、释放 subagents。MVP 无法枚举 subagent/作业时，至少要求 Worker 在最终 Report 前确认子 agent 已结束；否则不能把工单当作已 handoff 释放槽位，Phase 2 再补 30 分钟后台上限与完成唤醒。（原型 `docs/003-execution.md` 第 33–47 行；`docs/007-architecture.md` 的后台作业部分）
- 权限等待属于人工 handoff：创建 Attention 时释放逻辑槽位但保留进程现场；回答时先重新预留槽位，再应答原 permission request。
- 默认共享目录没有人工额外槽。只有显式 `parallel + per-ticket worktree` 才允许原型式一个人工额外槽。
- 并行上限 2–6，且仅在没有共享目录 Worker 活动时开启；不是 git 仓库或 worktree 创建失败时拒绝并行。
- 项目暂停只阻止新 Eval、launch、delivery 和 reply；Source 继续记录，活动 turn 不被静默打断。
- **复审新增：暂停是持久设置，不是 Renderer 开关。** 暂停要跨重启、跨后续工单保持；暂停期间 Eval 不超时，恢复时 deadline 顺延；暂停期间到达的人消息不丢，恢复后的第一轮按当前 Policy 重新校验并恢复工单，而不是直接投给旧执行。（原型 `docs/003-execution.md` 第 192–199 行；`src/core/evals.ts` 的暂停顺延；`src/core/tickets.ts` 的 `wake`）
- 引擎进程池与普通聊天共享，Scheduler 还需保留池余量；池压力只能限制新启动，不能替代领域队列。

### 7.3 工作区与权限

- `worktree='none'`：串行 Ticket 在同一 repoRoot 上累积执行。建单前检查脏工作区，默认阻断；用户可显式选择先整理、改用 worktree 或记录风险后继续。
- 每轮启动前保存 HEAD、status、untracked 清单和 diff/patch 检查点。检查点用于按文件人工回退，不是隔离边界。
- 禁止自动 `git reset --hard`、自动 stash 或覆盖用户改动；停止/失败后默认保留现场。
- `worktree='per-ticket'`：复用 Factory worktree；重试复用同一目录，停止后保留并标记 abandoned，只有人工显式清理才删除。
- 权限请求转成持久 Attention，记录 session/request/ticket/assignment ID。允许操作必须先重新获得 Scheduler 槽位，再向原请求应答；不能由一张无人查看的普通权限卡长期挂起。
- Router 使用 `default/plan` 且禁用执行工具；Worker 在共享目录使用 `acceptEdits`，只有显式隔离时才允许 bypass。

### 7.4 Report、停止、重试与重启

- MVP Report 使用唯一 JSON 块，必填 `assignmentId/reportId/kind/summary`，可选 `details/artifacts/question`。`assignmentId` 必须等于当前执行，重复 `assignmentId+reportId` 只确认原结果。
- 多个冲突块、缺字段、非法 kind 或无法解析都按协议失败处理，保留原文并生成 `failed + Attention`；不能猜成 `ready`。当前 turn 内 Report 的 `assignmentId` 与当前执行不符也属于协议失败；Executor 已识别为上一代迟到的 Report 则只审计、幂等确认或丢弃，不污染新 Assignment。
- 成功 turn 结束时必须有一个 `waiting/ready/blocked/failed/dropped` 最终 Report；没有 Report 或只有 `progress` 都属于协议失败。普通正文可以展示，但不能替代结构化事实。
- `progress` 只更新进展；`waiting` 进入 idle；`ready` 等待验收；`blocked/failed` 进入各自人工阶段；`dropped` 安静结束。只有 Report 携带 `question` 或发生协议失败时才创建 Attention，同一问题只创建一次。Attention 的清除、替换与回答授权见 §5.4。
- **复审新增：Report 交叉校验要成为协议的一部分。** `ready` 或 `answers` 与 `question` 互斥；`askedBy/answers` 必须指向到达本 Ticket 的人消息；`assignmentId` 不在当前执行即拒绝。失败一律返回稳定错误码（§11.3），不能只给一句失败文案。原型对应 `questionWithResult/askerWithoutQuestion/notAsker/notAnswerable`（`src/core/errors.ts`；`src/core/assignments.ts` 的 `report`）。
- **复审新增：人工重试只对三种阶段开放。** 只有 open 且阶段为 `person/delivery`、`person/blocked`、`person/failed` 时才提供重试；人工消息已到达 blocked/failed 后不再提供，因为消息已交给执行方；`person/review`、`working`、`idle` 不允许重试。原型用 `canRetry` 单独约束，方案此前写成“人工重试”没有限定（`src/core/stage.ts`）。
- 停止：先持久化停止意图，再 `abort`，5 秒宽限后 `stop`；Ticket 记 stopped，保留检查点/worktree，队列继续下一张。
- 瞬时网络/模型错误在当前 Assignment 内最多续跑 3 次（15/30/60 秒）；launch 失败采用独立退避且不更换 Assignment；prepare/权限/协议失败不自动重试。
- 人工重试新建 Assignment，续用同一 Worker Session 与目录，并注入“先检查工作区、历史与外部状态，避免重复副作用”的恢复说明。需要全新上下文时创建新 Ticket，不为同一 Ticket 偷换 Session。
- 主进程重启后，活动 Assignment 标 interrupted。busy 只指“仍在执行且未进入权限等待或其他人工 handoff”的 Assignment，或 handoff Report 后又有新 Input 的执行；只有主进程重启这一恢复路径才创建新的恢复 Assignment（`generation+1`）。运行期 `blocked/failed` 后的人工消息复用原 Assignment，不新建。无后续输入的 `waiting/ready/blocked/failed` 和权限等待保持原 Assignment、Attention 与阶段，不自动 launch。
- 恢复按原 `queueOrder`、oldest first。已 read Input 不得重复执行；delivered 但未 read 的先按 requestId 对账，能证明未接受才重投，无法确定则转 `uncertain + Attention`。

### 7.5 关闭与退出（复审新增）

§9.3 只写了重启后如何恢复，没有写正常退出时如何保证“恢复前提”成立：

- 应用退出走显式 shutdown 顺序：停止接受新命令 → 取消在跑 turn → 等待在途 Effect/Outbox 落定（有上限）→ 关闭 Store、释放项目锁。不能只依赖 `before-quit` 默认行为，否则会出现“进程已退出、Assignment 仍标 running”的假象。
- 每个 Worker 的后台工作给有限时间收尾（原型为 10 秒），超时直接结束，并在下次启动生成恢复说明。
- 关闭 Super Agent tab 只停 Renderer 镜像，不触发上述 shutdown；项目切换才需要释放项目锁。
- 退出过程中不得启动新的 launch/delivery；已排队的 Effect 保持 pending，留给下次启动按原顺序续做。

（证据：原型 `docs/003-execution.md` 第 45–46 行；`docs/007-architecture.md` 的 Runtime shutdown）

---

## 8. 上下文、工具与安全边界

### 8.1 Inline & Spill 是 MVP 基础能力

不要把所有 Trigger、转录和 Report 全量塞入常驻 Router。所有模型输入采用“有界内联 + 可读引用”：

```text
Trigger #42 inline
  preview / actor / at / thread_id / ticket_id / total_chars / read
       ├─ read_trigger(#42, offset) ─► 原文后续页与相邻消息
       └─ read_thread(#08, offset)  ─► 近期 Trigger、ticket_ids、worker_ids
                                      ├─ read_trigger(#40)
                                      ├─ read_ticket(...)
                                      └─ read_worker(#03) ─► thread_id / assignment / status
```

要求：

- 内联包含高概率立即使用的摘要和下一跳 ID；完整原文、旧历史、长日志、完整转录留在 Store。
- 截断必须带 `total_chars` 与 `read`，分页返回 `offset/next_offset`；不得把截断文本伪装成完整事实。
- 可从原型预算起步：卡片 preview 160、Worker Trigger 600、assignment 1500、文本页默认 4000/最大 8000 UTF-16 code units、列表默认 20/最大 50。预算集中在 `contextBudget.ts`，图中的“前 50 字”只是示意，不是硬编码协议。
- Router 每轮只自动注入活跃工单索引、未回答 Attention、队列和最近非 progress Report；完整内容按需读取。
- Worker 首条消息只带 Mandate、原始 Trigger 卡片、相关 Thread 窗口和恢复说明；长上下文通过资源续读。
- `read_trigger/read_thread/read_ticket/read_worker` 可统一实现为一个受角色限制的 `superagent_read(resource, offset, limit)`，但资源语义与引用 ID 必须保留。
- Worker 只能读取自己的 Ticket、已到达的 Trigger、订阅 Thread 和自身 Assignment；共享 Thread 上其他 Ticket 的授权、Decision 和转录默认不可见。

### 8.2 角色工具面

| 角色 | 应有能力 | 明确禁止 |
| --- | --- | --- |
| Router | `superagent_read`、会话/队列状态查询；Phase 2 的 `route`（批量 accept/attach/stop/ignore）、`reply`、`note`、`request_status` | Bash、直接改代码、任意 MCP、未经确认的建单/停止/改 Policy |
| Worker | 文件、搜索、shell、web、skill、todo、引擎 subagent、读取自身上下文、`report`、`handback`、`mark_unrelated`、`follow_for_context` | 直接向人提问/发言、启动或消息其他 Super Agent Session、改全局配置、绕槽调度 |
| Source/Channel adapter | 平台读写、事件规范化、receipts | 把外部文本当授权、自行修改 Mandate、绕过 Outbox |

实现约束：

1. 增加 `allowedTools/disallowedTools` 的 per-session 透传；需要的硬禁用能力无法生效时，Router 必须 fail closed。MVP Router 可固定 Claude Code，不能静默换引擎。
2. 增加角色化 prompt 组装，Worker/Router 不继承无条件的 AskUserQuestion 指引。
3. 增加 per-session MCP 投影。Router 默认只有 Super Agent 只读工具，Worker 只获得 Mandate 允许的 MCP；不得继承全部全局 MCP。
4. `TOOL_REGISTRY` 只是展示元数据，不能作为权限真源。
5. Phase 0 决定本地 MCP/宿主工具桥接方式；Phase 1 若工具通道尚未就绪，至少交付内部 `ContextReader + StatusQuery + 自动摘要`，不得伪造“模型已经能调用工具”。
6. **复审新增：工具补充与输出上限。** Phase 2 的 Router 必须有 `attach`（仅显式引用时允许）与 `request_status`（只对 `waiting` 的 Worker 生效）；`note` 是不授予权限的 100 字旁注。Worker 的 `handback` 每条消息只允许一次，`mark_unrelated` 只能退掉自己订阅、来源 Thread 与自己 follow 的 Thread 除外。Router 的路由说明 ≤30 字、聊天气泡硬上限 100 字；Worker 的提问只走结构化 `question` 字段，不靠自由文本。（证据：原型 `src/app/tools/main.ts`、`src/app/tools/executor.ts`；`docs/004-prompts.md` 第 77–84 行）

### 8.3 SessionStatusQuery

主进程内部 API 是唯一真源，IPC 与模型只读工具都是它的薄投影：

- 字段：session/ticket/assignment ID、角色、状态、engine/model、cwd 与 workspaceMode、started/elapsed/lastActivity、currentTool、waitingForHuman、queuePosition、slots、backgroundJobs。
- `backgroundJobs` 无法获知时返回 `unknown`，不能写成 0。
- 快照带 `asOf/seq/staleAfterMs`；过期快照必须标 stale。
- 默认只返回当前项目的 Super Agent 会话；普通用户会话不返回标题、消息、prompt、工具参数或输出。
- 工具只读，不能 stop/abort/answer/create/update Policy。Scheduler 永远不能依赖模型是否调用该工具。

### 8.4 授权与提示词注入

优先级必须是：**宿主工具/策略硬约束 > 内置角色说明 > 版本化 Policy/Mandate > 团队说明 > 外部文本**。

- IM/GitHub 评论、issue、文档和引用永远是不可信数据，不能修改 Policy、Mandate、工具面或执行环境。
- Token 与平台凭据只在主进程和对应 adapter 内使用，不进入模型上下文、事件日志或 Renderer。
- “不自动合并、不关闭 issue、不向公开渠道外发私密内容”等边界由代码拒绝，不能只靠提示词。
- 模型建议并行、扩大 scope 或创建新工单时，必须由 Scheduler/Domain 校验；需要人工确认的动作在 UI 明确确认。

---

## 9. 持久化、可靠副作用与崩溃恢复

### 9.1 项目状态目录

```text
<userData>/super-agent/projects/<projectKey>/
  project.json                 # realpath、名称、schema 版本、执行策略、reviewReminderHours、最后打开时间
  state.json                   # 可重建快照：domain、queue、effects、outbox、timeline、lastSeq
  events.jsonl                 # 权威 WAL：单调 seq、事务记录、审计与重放输入
  tickets/<ticketId>/          # Report、长 Input、产物索引、分页 Spill
  checkpoints/<ticketId>/      # 每轮检查点
```

`projectKey=hash(realpath(repoRoot))` 前 16 位。仓库移动后不自动迁移状态，必须显式重新绑定，避免串项目。密钥仍由现有安全存储管理。`reviewReminderHours` 按项目配置，默认提案 24 小时，默认值为提案、待用户确认（§5.2）。

### 9.2 提交与 Effect

每个 Domain 命令在一个同步临界区内完成：

1. 校验命令与幂等键。
2. 计算新领域状态、事件和待执行 Effect。
3. 将本命令的领域事件与 Effect 作为一条事务记录追加到 `events.jsonl` 并 flush；该 WAL 记录是提交点。随后原子写包含 `lastSeq` 的 `state.json` 快照（临时文件 + rename）。
4. WAL 提交后才执行 `launch/deliver/relay/reply`；不得先调用外部世界再补写状态。快照失败只触发恢复重放，不能撤销已提交事实。
5. Adapter 用过去式事实回报 `assignmentStarted/inputDelivered/reportReceived/replySent`，再次提交 Domain。坏 WAL 记录必须隔离并报告，不能静默跳过。

Effect 规则：

- 每类 effect 有稳定 kind+key；相同等待键可合并 payload，但人工消息、最终 Report 和外部回复不能合并丢失。
- `launch/delivery/relay/reply/reviewReminder` 各自限流；relay 与 reply 保持要求的顺序。
- **（收口新增）`reviewReminder` 是持久化 scheduled effect：** 进入 `review` 时按 `reviewReminderHours` 排期，外发后写入 `reviewRemindedAt` 并以 24 小时为间隔续排；`ticketAccept/ticketStop`、人工追问进入 `working` 或其他离开 `review` 的迁移都取消排期。重启后按 `report.at` 与 `reviewRemindedAt` 重建，不重复补发，不因重启重置为“从未提醒”。
- 失败使用分类退避；瞬时退避期间 Input 保持 pending，永久 delivery 失败将 Input 标为 `failed` 并进入 `person/delivery`，其他连续失败进入健康状态或 Ticket Attention。
- Outbox 的外发 ID 永久去重；崩溃发生在“平台已发送、receipt 未写回”时，以平台 message id/幂等键对账，不能盲目重复发送。

### 9.3 启动恢复顺序

1. 获取项目状态锁，阻止两个主进程同时写同一目录。
2. 读取 schema 与快照，只重放 `seq > state.lastSeq` 的 WAL 事务；损坏文件隔离，不静默清空。快照缺失时从空投影完整重放。
3. 恢复 Source 游标、Ticket/Thread/Subscription、队列、Effect 和 Outbox。
4. 将活动 Assignment 标 interrupted；根据 delivered/read 游标和 requestId 对账 Input，无法确定的标 `uncertain + Attention`，不得盲目重投。
5. 只有未进入权限等待/人工 handoff 的 busy Assignment，或 Report 后有新 Input 的 Ticket 按 queueOrder 创建恢复 Assignment，oldest first；无后续输入的 `waiting/ready/blocked/failed` 和权限等待保持原 Assignment、Attention 与阶段。
6. Router/Worker 按持久化的引擎会话映射 resume；无法恢复时标明确错误并等待人工重试，不能换成全新上下文假装已恢复。原 permission request 无法恢复时保留 Attention 并明确标记需要人工重试，不得自动 launch。
7. 对账后继续未完成的 Router relay 与其他 Effect；渲染层是否打开不影响恢复。

### 9.4 Schema 迁移与兼容（复审新增）

方案此前只在 `project.json` 写了 `schema 版本`，没有升级策略。启动路径必须定义：

- 先比对 `schemaVersion`：同版本直接加载；低版本在进入 Domain 前一次性迁移（单事务或单文件原子替换，失败整体回滚并保留旧副本）；低于最低支持版本拒绝启动，提示重新绑定或新建状态目录，不得静默清空。
- 迁移只转换记录形状，不重写已落盘的领域事实；迁移后继续使用同一 `events.jsonl`，不重置 `seq`。
- 未见过的字段必须可被忽略（前向兼容），不能因为多出一个字段就把 WAL 判成损坏；坏记录仍按 §9.2 隔离并报告。
- 迁移失败要成为可见 health 问题，不能只在控制台打印。

（依据：原型 `src/app/migration.ts` 的 `migrateTo11` / `tooOld` 采用“单事务 + 最低版本拒绝”。SpaceCode 用 JSON/JSONL，机制要改写，原则不变）

---

## 10. IPC 与桌面 UI

### 10.1 IPC 边界

新增 `src/shared/channels/superAgent.ts` 作为通道与 DTO 真源，主进程、preload、Renderer API 均从这里派生。最小命令：

```text
state / routerBind / routerMessage / routerAbort
ticketCreate / ticketMessage / ticketAccept / ticketStop / ticketRetry
attentionAnswer / pause / resume
policyGet / policySet
workerBind / workerMessage / workerTakeover / workerRelease
sessionStatus / contextRead
```

主进程事件：

```text
ticket.updated / ticket.progress / attention.asked / attention.answered
queue.changed / router.status / timeline.append / health.changed
```

约束：

- 所有命令校验 repoRoot、ID、请求大小和当前状态；IPC `success:false` 必须由调用方检查。
- `ticket.progress` 由主进程归一化并做 1 秒节流，只含阶段、assignment、currentTool、elapsed、lastActivity、toolCalls；不包含正文、推理或 diff。
- `workerBind/routerBind` 返回 sessionId、初始转录快照和 running 状态，再挂只读观察镜像并复用既有 route event；Renderer 不解析 CLI stdout。
- `workerMessage` 仅在 takeover 状态可用，也必须先写 Domain Input 并遵守 delivered/read 与调度规则，不能直接调用引擎发送。
- Ticket 卡片以 `ticketId` 为稳定身份；Assignment 变化只更新面板执行分段，不换卡片。
- 领域事件 seq 与可节流的 UI 投影 seq 分开编号。Renderer 对领域事实断档重拉 `state`；`ticket.progress` 使用节流后独立的投影水位，丢弃中间进度不触发重拉。
- **复审新增：错误码是一等 DTO。** `superAgentError` 至少区分 `missing / refused / conflict / unavailable` 四类，并携带稳定 `code` 与参数（如 `ticketEnded`、`assignmentEnded`、`notRetryable`、`questionWithResult`、`notAnswerable`、`mandateRevoked`、`workerDecides`、`slotUnavailable`）。Renderer 按 `superAgent.errors.<code>` 本地化，不能把英文异常直接弹给用户。SpaceCode 的 Factory 已有“稳定错误码 + i18n”的做法（`src/shared/factory.ts` 第 415 行附近），直接沿用。
- **复审新增：Phase 2 需追加处置类命令。** `unavailable` Eval 的“重新评估/忽略”、健康项的“重试/忽略”都要有对应 IPC（如 `evalReevaluate / problemDismiss / healthRetry`）；否则 §10.4 的按钮没有通道，只能做成只读展示。MVP 不提供这些命令，UI 也不展示对应动作。

### 10.2 中置 IM 视图

- 侧边栏 New Chat 下方放置 Super Agent 入口与 Attention 徽章；中置 tab 固定为单例 `super-agent`，重复点击只激活。
- **（收口新增）** 侧边栏普通会话列表按会话类型过滤：`chatSession` 中保留 Super Agent/Router 会话对象，但普通列表只显示普通聊天类型。Router 不作为普通会话出现，也不提供“在设置里隐藏”的开关。
- 顶部只显示“运行中 N · 排队 N · 待处理 N”、当前执行策略和“新建工单”；计数与 StatusQuery 一致。
- 消息区为单列气泡流：用户淡色强调底、Router 中性背景；不显示 reasoning、工具 chip、token 或内部路由提示。
- Router 没有正文 delta 时显示轻量 typing 与计时；长轮次可 abort 当前 Router turn，不影响 Worker。
- 派工是独立动作。普通发送只与 Router 对话；Router 可建议建单，但 MVP 不能直接建单。
- Ticket 卡片与 Attention 是主进程持久化的 timeline projection，按发生顺序插入消息流；不得伪造一条 assistant 消息来承载卡片。
- **（收口新增）`review` 超时提醒走 IM 气泡 + Super Agent 入口徽章 + 顶部状态条计数，不弹 modal。** 同一工单复用原气泡，不新增一条消息；徽章与“待处理 N”按去重后的工单数计，不按提醒次数计。

### 10.3 工单卡片与右侧工作态

- 一个 Ticket 始终只有一张单行卡片：图标、标题、状态点/短状态词；Report 只更新卡片，不重复发气泡。
- 卡片状态覆盖 queued/preparing/working/idle/delivery/review/answer/blocked/failed/completed/stopped/dropped；不能只用颜色表达状态。**（复审新增）** `preparing` 不在 §5.2 的派生阶段表里，它是“pending Assignment 已占槽、prepare/launch 尚未回报 assignmentStarted”的子态，由 `progressProjector` 维护，不能反过来新增一条 Ticket 阶段；`delivery` 同理只在存在永久投递失败时出现，否则用 idle 表示。
- 点击卡片只打开 `worker:<ticketId>` 右侧标签，不自动接管、不自动切换其他 Worker。
- **（复审新增）** `review` 卡片必须有明确的“接受验收 / 继续追问 / 停止”入口；验收走 `ticketAccept → completed`，不能靠打开只读面板或接管输入隐式完成，否则 §5.2 的待验收状态没有出口。**（收口新增）** 超时提醒后卡片保持 `person/review` 并显示“待验收”标记，不降级为 blocked/failed、不自动 accept；提醒不弹 modal。
- 右侧依次展示过程、最新/历史 Report、artifacts 与权限审计；推理默认折叠，工具时间线可展开。
- Worker 转录按 Assignment 分段；sessionId 跨重试保持稳定，不再设计“每代换 session”的 rebind 逻辑。**（收口新增）** 人工消息解除 blocked/failed、waiting/ready 后追问都复用原 Assignment，不新开分段；只有 `generation+1` 的 retry/重启恢复才显示为新一代。
- 面板默认只读。显式接管后出现输入框与“自动推进已暂停”横幅；交还后才恢复自动输入。
- Attention 以非模态气泡出现，不抢焦点；相同问题只提醒一次，回答后折叠并保留审计。
- 所有文案进入 `zh-CN/en-US` 的 `superAgent` 域；新增 select 遵循全局主题与暗色弹层规则。

### 10.4 系统健康与审计视图（复审新增）

Attention 只覆盖“某张工单需要人”，覆盖不了“系统本身坏了”。方案有 `health.changed` 事件却没有健康模型，会出现 Outbox 连续失败、Eval 全部超时、Source 读取失败都无处可见的情况。

- 健康项至少覆盖：Effect 队列（launch/delivery/relay/reply/reviewReminder 各一类）、Source 游标与读取、Eval 的 `unavailable`（统计最近 1 小时未处置项）、引擎/模型可用性、项目锁与迁移。
- 判定阈值沿用原型：同一类连续失败 3 次才升级为 error；单次网络抖动不打扰人；delivery 永久失败显示在工单卡片上，不重复计入系统问题。
- 顶部只显示汇总计数，点击进入只读“系统问题”列表。**（收口新增）** MVP 只上报不可操作：不显示重试/忽略按钮，只保留“查看关联工单”；`healthRetry/problemDismiss/evalReevaluate` 等处置动作留到 Phase 2。
- 审计面要能回答“这张工单为什么被建、被停、被拒”：展示 Decision 的 reason 码与命中的规则。MVP 至少保留数据与 IPC，UI 可折叠。
- **（收口新增）** `unavailable` 的 Eval 处置属于 Phase 2：24 小时内可重新评估或显式忽略，忽略后不再提示、不阻塞 Thread。MVP 只上报，不提供操作入口。

（证据：原型 `src/app/effects.ts` 的 `FAILURES_BEFORE_ERROR` 与 health 更新；`docs/002-authorization.md` 第 147–155 行；`docs/005-panel.md` 第 18–24 行）

---

## 11. 模块划分

### 11.1 主进程与共享层

| 模块 | 职责 |
| --- | --- |
| `electron/superAgent/service.ts` | 每项目 composition root、启动/关闭、命令入口 |
| `domain.ts` / `model.ts` | 第 5 节对象、派生阶段、授权与幂等规则；不做 I/O |
| `store.ts` / `effects.ts` | 原子投影、事件重放、项目锁、durable Effects/Outbox |
| `routerRunner.ts` | Router 会话、候选/Report 批处理、非阻塞 relay |
| `executor.ts` / `sessionPort.ts` | Worker 生命周期、输入投递、引擎事实转换 |
| `scheduler.ts` / `policyStore.ts` | 槽位、队列、串并行与 worktree 策略 |
| `contextReader.ts` / `contextBudget.ts` | Inline & Spill、分页、角色可读性 |
| `sessionStatusQuery.ts` | Scheduler/UI/Router 共用只读状态 |
| `reportParser.ts` / `progressProjector.ts` | 严格 Report、轻量卡片投影 |
| `errors.ts`（复审新增） | 稳定错误码、参数与 i18n key 映射；Domain/IPC 共用 |
| `health.ts`（复审新增） | Effect/Source/Eval/引擎健康项、3 次阈值与聚合 |
| `migration.ts`（复审新增） | schema 版本比对、单事务迁移与最低版本拒绝 |
| `checkpointService.ts` | 检查点与显式按文件回退 |
| `sources/desktop.ts` | Desktop Trigger/Thread/Channel；Phase 2 再增加其他 Source |
| `superAgentIpc.ts` | 参数校验、命令与投影广播 |
| `src/shared/channels/superAgent.ts` | IPC/DTO 单一真相源 |

### 11.2 Renderer

优先保持少量深组件，不为每个小区域预设独立文件：

- `SuperAgentView.vue`：状态条、时间线、composer、派工入口。
- `SuperAgentMessage.vue` / `WorkerTaskCard.vue`：正文气泡与单行活卡片。
- `AttentionBubble.vue`：问题与回答。
- `SuperAgentHealth.vue`（复审新增）：系统问题汇总与只读列表，不进入主消息流。
- `WorkerLivePanel.vue`：只读过程、Report、产物、Assignment 分段和显式接管。
- `ExecutionPolicyControl.vue`：串并行、上限、worktree 与确认。
- `src/stores/superAgent/`：快照、事件 seq、Router/Worker bind、面板状态。
- `src/services/api/superAgent.ts`：typed IPC。

修改 `Sidebar.vue`、`ChatPanel.vue`、`InfoPanel.vue`、`src/stores/app.ts` 接入现有三栏；不修改 `splitLayout`，不新增 AppMode，不修改只读 `engine/`。

### 11.3 错误码与 i18n（复审新增）

- `errors.ts` 导出 `SuperAgentErrorCode` 联合类型与 `superAgentError(code, params)`；Domain 抛领域错误，IPC 只做序列化，不重新发明 code。
- 至少四类：`missing`（找不到 ticket/assignment/input）、`refused`（越权或状态不允许）、`conflict`（重复或并发冲突）、`unavailable`（引擎或资源不可用）。
- 具体 code 覆盖 §5.4/§6.2/§7.4 的校验：`ticketEnded`、`assignmentEnded`、`notRetryable`、`questionWithResult`、`askerWithoutQuestion`、`notAsker`、`notAnswerable`、`workerDecides`、`handedBack`、`notReady`、`notAttention`、`notQuestion`、`ackEnded`、`mandateRevoked`、`slotUnavailable`。
- i18n 以 `superAgent.errors.<code>` 为键，`zh-CN/en-US` 同名；参数只放安全值（ID 可以放，原文不放）。
- 未知 code 回退到通用文案并记录一次 health 事件，不能把 stack 或英文异常直接显示给用户。

---

## 12. 分阶段交付与验收

### Phase 0：接缝验证

必须先给出可运行的小验证和测试，而不是直接在文档假设上铺全量 UI：

1. 主进程拥有的 Router/Worker session 能实时 `attachObservedSession`，关闭/重开 Renderer 后历史与流式增量正确，detach 不停进程。
2. `SessionPort.start/deliver` 只等待接受；`result/error/exit` 在主进程可区分并关联当前 Assignment；同 Session 忙时 Input 不并发写 stdin。必须实测 requestId 的 transcript/inbox 对账与“接受结果未知”恢复路径；无法对账时只能转人工，不能自动重投。
3. allowed/disallowedTools、角色化 append prompt、per-session MCP 投影能真实反映到启动参数与运行时工具面；AskUserQuestion 冲突提示可关闭。
4. 权限请求能映射为 Attention；等待时释放逻辑槽，回答先重新获得槽再回到原 request，串行模式下不会自锁。
5. 同一 Worker Session 跨 Assignment 与主进程重启可 resume；不能恢复时明确失败。
6. 本地工具桥接方案已验证；若未完成，Phase 1 的降级仅限“内部 API + 自动摘要”，并在 UI 能力上如实呈现。
7. **（复审新增）** read 语义闭环实测：step 取走后取消仍算未读；替换 Assignment 时未读 Input 回到队首且 Session 内副本被清除；不出现重复投递。
8. **（复审新增）** 退出/重启实测：显式 shutdown 有界收尾；重启后 running→interrupted，不出现双 launch、不出现“进程已退出但 Assignment 仍 running”。

### Phase 1：Desktop MVP

交付：

- Desktop Source/Trigger/Thread、显式派工、Domain、Ticket/Assignment/Report/Attention。
- 主进程 RouterRunner、事件式 Executor、默认串行 Scheduler、暂停/停止/重试。
- 共享目录检查点；显式 per-ticket worktree 与 2–6 并行策略。
- state/events/effects/outbox 持久化与恢复；schema 迁移、稳定错误码与 health 汇总（复审新增）。
- 基础 Inline & Spill、SessionStatusQuery、轻量进度投影。
- 中置 IM、工单卡片、Attention、右侧只读 Worker 面板、i18n。

核心验收：

1. 连续派工两张 Ticket，任意时刻最多一个活动 Worker；第二张能看到第一张结束后的共享工作区状态。
2. 派工受理后 Router 立即可回答另一条消息；Worker 未完成时 Router 没有阻塞等待或 sleep。
3. 人工续接优先于新 launch 但不抢占当前 turn；人工 stop 后任何自动事件都不能重开 Ticket。
4. `ready` 先进入待验收，验收才 completed；无未回答 Attention 时 blocked/failed 分别进入对应人工阶段，携带 question 时进入 answer 并保留 blocked/failed 原因，协议失败只创建一个有效 Attention。
5. 非法/缺失 Report 或 progress-only turn 不会被当作完成；progress 不刷屏，最终 Report 不丢失，旧 Assignment 的迟到事件只审计不污染新执行。
6. 人工重试新建 Assignment、续用 Worker Session 与目录；自动退避不换 Assignment；已读 Input 不重复执行，不确定 Input 不盲目重投。
7. 模拟主进程崩溃后按 queueOrder 恢复 busy 工作，ready/waiting/blocked/failed 不被自动唤醒；无重复 Ticket、Report 或 Outbox 外发。
8. 并行只能与 per-ticket worktree 同开；共享目录并行写被代码拒绝。
9. Router 无 Bash 与任意 MCP，Worker 无直接对外发言工具；外部文本不能改 Mandate/Policy。
10. UI 点击卡片始终只读，只有显式接管才可输入；关闭 tab 不影响后台推进。
11. **（复审新增）** blocked/failed 后 bot、CI、Router note 只落库不投递，人的消息才解除；结束时 Attention 清空、未裁决人消息回流 Eval，不出现静默吞消息。
12. **（复审新增）** Report 交叉校验生效：`ready+question` 被拒、`answers` 未被 Worker 认领时 `answer` 被拒；Attention 被替换时旧气泡撤回；重试只出现在 `person/delivery/blocked/failed`。
13. **（复审新增）** 应用退出有界收尾，重启后不出现“进程已退出但 Assignment 仍 running”；暂停跨重启保持，恢复后的人消息按当前 Policy 重新校验。
14. **（收口新增）** `blocked/failed` 后人工消息复用原 Assignment：不新建、`generation` 不递增、右侧不新开分段；复用后的 Report 覆盖阶段，Attention 的 `askedBy/answers` 仍归属同一 `assignmentId`。
15. **（收口新增）** `review` 超时只提醒、不自动完成：首次到时长提醒一次、之后每日最多一次；状态保持 `person/review`，不降级、不自动 accept；徽章/状态条按工单去重，重启不重复补发。
16. `npm run test:changed` 与 `npm run build` 通过；真实桌面端完成上述黄金路径和暗色主题检查。

### Phase 2：外部事件驱动与完整异步工作

交付：

- 先接一个 IM Source，再接 GitHub Issue/PR/CI；平台消息统一转 Trigger，Channel 统一走 Outbox。
- Gate/Assessment、Thread 串行 Eval、Subscription fan-out、handback、context-only follow。
- 受控 `create_ticket/report/route/reply` 宿主工具；写操作仍需 Policy 或人工确认。
- 可追踪后台 job/subagent 的注册、完成唤醒、停止、超时和占槽。
- **（复审新增）** PR 评审线程：审批/评审评论按 Trigger 进入订阅并可唤醒 Worker；修好的评论静默 resolve，拒绝的给一句理由；自动评审器每个 PR 最多三轮。外部自动化账号在宿主看来仍是“人”，只能靠团队 prompt 文本识别，不能做跨 Source 身份映射。（原型 `docs/004-prompts.md` 第 88 行；`docs/003-execution.md` 第 90 行；`docs/002-authorization.md` 第 77–81 行）

验收：

1. 白名单外事件零 LLM 调用，并记录可查询的 filtered 原因。
2. 同 Thread 后续事件直达所有有效订阅 Ticket，不重复经过 Router；Correlation 本身不产生投递。
3. 人工 follow-up 被所有 owner handback 后才重新 Eval；bot/CI 不能冒充人工恢复 ended Ticket。
4. 同一 Trigger 重放不重复建单；同一 Channel 消息按序且不会因重启无限重复。
5. 注入“忽略规则并扩大权限”的外部文本后，Mandate、工具面和 Policy 均不变。
6. 可观测直通关闭前后的 Router 决策数和 token 差异，但不把原文实验比例当验收指标。
7. 长任务 Started 立即可见，完成结果作为新 Input 唤醒；已知后台工作未结束时槽位不释放。
8. **（复审新增）** Eval 时限从 candidate 送达起算，超时重排 2 次后第 3 次 `unavailable`；暂停期间不超时、恢复后顺延；Policy 变更丢弃运行中 Eval 并按新版本重排；`unavailable` 可重新评估或忽略。
9. **（复审新增）** 工单结束/关闭释放未裁决的人消息并回流 Eval；`merged/closed` 按 Thread 关闭结束，`ended.outcome` 与 `ended.by` 可查询；结束后订阅最迟两周停止轮询。
10. **（复审新增）** 错误码可本地化：非法 Report、越权 handback、已结束工单回复、Policy 撤销后的人工续接都返回稳定 `code`，不泄露英文异常。
11. **（复审新增）** PR 评审闭环：自动评审器最多三轮、已解决评论不再回复、外部自动化账号按 prompt 文本识别且不产生额外授权。

### Phase 3：可选自治增强

- Watchdog 只依据持久化 lastActivity、Effect 健康和 Assignment 状态发现停滞，生成去重 Attention；不得擅自 reset 或扩大授权。
- sidecar/daemon 只替换 SessionPort/ExecutionEnvironment 宿主，Desktop IPC 与 Domain 契约不变。
- 投机执行、跨项目路由、A2A、自动修复建单和自动合并分别评审，不作为前序阶段隐式范围。

---

## 13. 测试策略与风险门禁

### 13.1 自动化测试

遵循 Vitest 单一 runner；测试必须 import 被测模块，主进程测试首行使用 `// @vitest-environment node`。

- **Domain**：重复 Trigger、Decision/Mandate、派生阶段逐行、新 Assignment 不沿用旧 Report、永久 delivery 失败进入 person/delivery、人工 resume/stop、handback、context-only、非法迁移。
- **Scheduler**：同步 reserve、FIFO、人工下一槽优先、handoff 必须等 turn 结束、权限等待释放与回答重预留、并行上限、后台占槽、暂停、策略切换拒绝。
- **Store/Effects**：WAL 提交点、lastSeq 重放、快照写失败、半写 JSONL、项目锁、effect 合并边界、Outbox 去重与恢复。
- **Executor**：fake SessionPort 覆盖 start/deliver/result/error/exit、requestId 对账、uncertain 不重投、旧 Assignment 迟到事件、忙时队列、abort→stop、自动退避不换 Assignment、权限 Attention。
- **Context**：截断与分页可重组原文、角色资源隔离、无完整转录内联、stale 状态与 `backgroundJobs='unknown'`。
- **Report/Progress**：唯一 JSON 块、assignmentId/reportId 幂等、当前 turn 跨 Assignment 拒绝、旧代迟到只审计、progress-only 协议失败、冲突/缺字段/恶意嵌套、原文保留、1 秒节流、正文与推理不进入卡片。
- **IPC/Renderer**：参数校验、领域 seq 断档重拉、progress 投影断档不重拉、卡片唯一、计数一致、只读/接管分界、Assignment 分段、中英文与主题；**（复审新增）** 错误码本地化、`preparing/delivery` 子态投影、系统问题列表只读。
- **生命周期收尾（复审新增）**：blocked/failed 时自动 Input 闸门、结束清 Attention/delivery、`letGo` 回流 Eval、Attention 替换撤回、`ready+question` 拒绝、`answers` 未认领拒绝、`canRetry` 可用集合、旧 Assignment 结束后的 idle 派生。
- **Assignment 复用（收口新增）**：blocked/failed 后人工输入不新建 Assignment、`generation` 不递增、同一 `assignmentId` 下最新 Report 覆盖阶段、`askedBy/answers` 归属不漂移、右侧执行分段不新增。
- **Review 提醒（收口新增）**：`reviewRemindedAt=null` 到点首次提醒、之后每日最多一次、离开 review/结束/人工追问取消排期、重启不补发、徽章与“待处理”按工单去重、超时不改变阶段且不自动 accept。
- **迁移与健康（复审新增）**：低版本迁移单事务回滚、过旧版本拒绝、未知字段前向兼容、Effect 连续 3 次失败才升级 error、delivery 不在系统问题里重复计数。
- **Eval/Policy（Phase 2，复审新增）**：deadline 从送达起算、2 次重排后 `unavailable`、暂停顺延、Policy 变更丢弃并重排、`revalidate` 撤销后续接被拒、24 小时提示窗口。
- **集成**：真实 Store + fake Port 的串行、busy 恢复、settled 与权限等待不自动唤醒、权限、worktree；Phase 2 增加真实 Intake→fan-out→Eval→Outbox 图，不能只测孤立函数。

不得用真实 Claude/Pi CLI 作为常规门禁；真实 CLI 与桌面 UI 冒烟单独执行。每次代码改动按 AGENTS.md 运行 `npm run test:changed` 和 `npm run build`。

### 13.2 最高风险与对应门禁

| 风险 | 不能接受的做法 | 门禁 |
| --- | --- | --- |
| 双写/双真相 | Renderer 根据 token 猜 Ticket 状态，或用 turn store 推进主进程 Domain | Domain 单写者 + seq 投影 + 主进程 route event 测试 |
| 重复副作用 | 先 spawn/发外部消息再持久化，或对接受结果未知的 Input 盲目重投 | WAL/durable Effect + requestId 对账 + uncertain 转人工 + 崩溃窗口测试 |
| 共享目录破坏 | 默认并行、自动 reset/stash、把检查点当隔离 | 默认串行 + 显式隔离 + 按文件人工回退 |
| 工具边界失效 | 只靠提示词禁用 Bash，或继承全部全局 MCP | 启动参数断言 + 运行时工具面验证 + fail closed |
| 假异步 | Router await Ticket 完成，或把 sendMessage 接受当任务完成 | Started/Report 分离 + Router 并发消息验收 |
| 后台任务失控 | 把 turn result 当成所有进程已结束 | `unknown` 如实展示 + 已知后台占槽 + Phase 2 作业注册 |
| 上下文膨胀 | 全量 Trigger/Report/转录常驻 Router | Inline & Spill 预算、分页和模型输入大小测试 |
| 权限挂死 | Worker 权限卡无人回答，回答后又绕过队列并发恢复 | 持久 Attention + Scheduler 后应答测试 |
| 恢复污染上下文 | 每次重试换 Session，或恢复失败就静默开新 Session | 稳定 Worker Session + Assignment + 明确恢复错误 |
| 健康不可见（复审新增） | 只有 `health.changed` 事件，没有健康模型与视图；Outbox/Source 长期失败无人发现 | Effect/Source/Eval 健康项 + 3 次阈值 + 系统问题视图 |
| Eval 永久卡住（复审新增） | 没有 deadline/`unavailable`，Thread 一忙就永久 `evaluating`，后续事件再也不能评估 | deadline 从送达起算 + 重排上限 + `unavailable` + 暂停顺延 |
| 结束吞消息（复审新增） | 结束不清 Attention、不释放未读人消息，追问静默消失 | `end/letGo` 生命周期测试 + 未裁决消息回流 Eval |
| review 永久停留/提醒刷屏（收口新增） | 超时自动 accept，或按小时重复提醒、弹 modal、重启后重置提醒水位 | 持久 `reviewRemindedAt` + scheduled effect 测试 + 阶段不迁移 + 状态条去重计数 |
| Assignment 身份漂移（收口新增） | 人工唤醒新建 Assignment、`generation` 递增，导致旧 Report 被误判为新执行 | 复用路径测试 + `assignmentId/generation` 唯一性断言 + 卡片身份仍为 `ticketId` |

### 13.3 明确不做

- 不新增 `EngineType`，不把 Super Agent 塞进现有 DAG Orchestration，不合并 Factory 产品语义。
- 不在 Renderer/localStorage 持有编排真相，不让 Worker 直接对外发言或互相点对点调度。
- 不在 MVP 接外部自动监听、实现 daemon/Watchdog/投机执行、自动合并 PR 或自动创建修复工单。
- 不修改只读 `engine/`，不引入为原型对齐而新增的大依赖，不用“原型有”描述文章中尚未实现的方向。
- **（复审新增）** MVP 不做提示词版本编辑、团队覆盖与 Default updated 审计（原型 `docs/004-prompts.md` 的版本机制）；只保留角色化组装。需要团队自定义 prompt 时另立提案，不把它当成“遗漏补做”。该提案至少先回答三个前提：**谁有权限发布团队 prompt 版本；覆盖如何审计（版本号、生效范围、每轮实际读取记录）；回滚怎么做（回到哪一版、是否影响在跑工单）。**

### 13.4 待确认清单（最终状态）

| 项 | 状态 | 结论 / 待定内容 |
| --- | --- | --- |
| Router 是否进入普通会话列表（原 Q1） | 已定 | 不进入；按会话类型排除，不是用户设置开关（§1.2、§10.2） |
| `blocked/failed` 后人工消息 | 已定 | 复用原 Assignment，不新建、不递增 `generation`（§5.2、§5.3） |
| `review` 出口 | 已定 | 超时提醒，不自动完成；保持 `person/review`（§5.2、§10.2、§10.3） |
| 健康与 `unavailable` 处置 | 已定 | 不进 MVP；Phase 2 才提供可操作命令（§10.4） |
| 团队 Prompt 版本/覆盖 | 已定 | 不做，另立提案；先回答发布权限、审计、回滚（§13.3） |
| `review` 首次提醒默认时长 | 待定 | 提案 24 小时，可配置；默认值为提案、待用户确认（§5.2） |
