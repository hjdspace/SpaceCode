# PRD: 会话编排（Session Orchestration Graph）

## Problem Statement

用户经常需要执行一系列有依赖关系的 AI 任务：任务 B 要等任务 A 完成才能开始，任务 C 依赖 B；有时又希望多个无依赖的任务并行跑。当前 SpaceCode 只能手动开多个会话，人工盯着哪个完成了再手动触发下一个，无法离开电脑，也无法一目了然地看到任务间的依赖结构和整体进度。并行场景下用户还要自己编排切换，心智负担大且容易漏。

## Solution

新增一个无限画布（编排图）。用户在画布上自由创建任务节点，每个节点是一个缩小版的真实聊天窗口，用户直接在节点的输入框里写任务草稿。节点之间用连线表达"完成后触发"的依赖关系，支持串行链和并行分叉。点击"运行"后：无依赖的根节点并行点火，每个节点用全新、上下文隔离的会话执行自己的任务；上游节点的 turn 结束后自动触发下游节点。节点可以放大成抽屉查看完整流式输出，也可以在执行中追加消息或手动停止。失败的节点会让下游跳过（旁支继续），用户可对失败节点一键重试并自动续跑下游。

## User Stories

1. As a 用户, I want 在中心区新建一个"编排"标签页打开无限画布, so that 我可以不离开主界面搭建任务流
2. As a 用户, I want 关闭编排标签页后再打开，画布上的节点和连线还在, so that 我不用担心搭好的图丢失
3. As a 用户, I want 在画布空白处双击或点"+"创建任务节点, so that 我可以按需添加任务
4. As a 用户, I want 从一个节点边缘拖出连线到另一个节点, so that 我可以表达"B 等 A 完成再开始"的依赖
5. As a 用户, I want 删除节点或连线, so that 我可以修改图结构
6. As a 用户, I want 从一个节点拉出多条连线到不同节点, so that 我可以表达并行分叉（A 完成后 B、C 同时开始）
7. As a 用户, I want 多个节点的连线汇聚到同一个节点, so that 我可以表达汇合（D 要等 B 和 C 都完成）
8. As a 用户, I want 画布支持平移和缩放, so that 我可以搭建和浏览大图
9. As a 用户, I want 节点窗口内嵌完整聊天界面（缩小版）, so that 我可以像用普通会话一样预览节点内容
10. As a 用户, I want 在节点的输入框里输入任务草稿而不发送, so that 我可以提前把 A、B、C 的任务都写好
11. As a 用户, I want 草稿在刷新/重启后保留, so that 我不必重写任务描述
12. As a 用户, I want 画布上有明确的"运行"按钮, so that 我输入和执行两个阶段分得清，不会误触发
13. As a 用户, I want 点"运行"时校验图里有环就提示我, so that 我不会建出永远跑不完的图
14. As a 用户, I want 点"运行"时校验每个节点都有草稿（空草稿节点被标红提示）, so that 我不会漏写任务
15. As a 用户, I want 运行开始时无入度节点全部并行开始, so that 没有依赖的任务自动并发跑
16. As a 用户, I want 上游节点完成后下游自动开始, so that 我不需要盯着手动接力
17. As a 用户, I want 节点上有状态标识（待运行/运行中/已完成/失败/跳过）, so that 我一眼看清整图进度
18. As a 用户, I want 正在运行的节点里能看到流式输出, so that 我可以实时了解任务进展
19. As a 用户, I want 双击节点弹出画布内抽屉放大查看完整会话, so that 我能看清细节并交互
20. As a 用户, I want 抽屉里可以继续发消息, so that 我可以追问或补充上下文
21. As a 用户, I want 运行中每个节点的会话是全新隔离的, so that 节点之间不串上下文
22. As a 用户, I want 每个节点的会话出现在侧边栏会话列表, so that 我事后可以回到任一节点的会话继续聊
23. As a 用户, I want 重跑整图时所有节点重新创建新会话, so that 每次运行都是干净的流水线
24. As a 用户, I want 某节点失败时它的下游自动标记为"跳过", so that 我明确知道哪些没跑
25. As a 用户, I want 某节点失败时与它无关的并行旁支继续跑, so that 一个失败不拖累整图
26. As a 用户, I want 对失败节点点"重试"后它用新会话重跑, so that 失败任务有干净的重试
27. As a 用户, I want 重试成功后之前被跳过的下游自动续跑, so that 我只需点一下不用逐个补
28. As a 用户, I want 运行中可以手动停止某个节点, so that 我能及时止损跑偏的任务
29. As a 用户, I want 手动停止的节点按失败处理（下游跳过）, so that 语义一致不产生歧义
30. As a 用户, I want 运行中可以整体停止整张图, so that 我可以中止计划外的执行
31. As a 用户, I want 运行中不能再增删节点和连线, so that 不会出现改图导致状态混乱
32. As a 用户, I want 运行中仍可编辑未开始节点的草稿, so that 我想起补充时还来得及
33. As a 用户, I want 同时就绪的节点超过并发上限时排队等待、有空位自动启动, so that 大分叉图也能稳定跑完
34. As a 用户, I want 节点会话遵守我的全局权限模式, so that 权限行为与我其他会话一致
35. As a 用户, I want 并行多节点时权限请求能定位到对应节点, so that 我知道该批准哪个任务的请求
36. As a 用户, I want 汇合节点等所有上游都完成（任一上游失败/跳过则它也跳过）, so that 依赖语义严格可靠
37. As a 用户, I want 画布上有小地图, so that 大图上不迷路
38. As a 用户, I want 删除节点不误删它的会话数据, so that 历史记录仍可追溯
39. As a 用户, I want 编排界面文案中英双语, so that 与产品其他部分体验一致
40. As a 用户, I want 在运行前看到图的整体结构预览（哪些并行、哪些串行）, so that 我可以确认依赖搭对了
41. As a 用户, I want 节点完成后可以在抽屉里查看完整输出, so that 我能核对任务结果
42. As a 用户, I want 打开编排 tab 时如果上次有未完成的运行，节点状态如实恢复展示, so that 重启后我能判断要不要重跑

## Implementation Decisions

以下决策来自 2026-09-14 的 grilling 会话，术语遵循 CONTEXT.md 的 Session Orchestration 词汇表，详见 ADR-0010。

**产品语义**

- 一次性流水线：每次 Run 为每个 Task Node 创建全新 session；重跑换新 session。节点不是常驻工作区。
- Edge 仅触发不传数据：不注入上游输出、不做占位符引用（推迟）。
- 节点完成定义：turn 正常结束（引擎 onResult 报告本轮结算）即视为 settled，不检测输出内容成败。
- 失败传播：节点 failed → 下游（含传递闭包）skipped；无关旁支继续。用户停止节点 = failed 语义。
- 重试：failed 节点用新 session 重跑，成功后自动把此前因它 skipped 的下游重新拉起（依序）。
- 汇合节点：所有入边上游均 settled 才启动；任一上游 failed/skipped 则它 skipped。
- 手动 Run：点"运行"启动，无入度节点并行点火。运行前做两个校验：环检测（有环拒绝运行并高亮环路）、空草稿节点提示（标红，可忽略强制运行或补齐——实现时二选一，倾向标红阻断）。
- 运行中锁结构：禁止增删节点和连线；未开始节点的草稿仍可编辑。
- 运行中节点可交互：可追加消息（进现有 pendingMessages 队列，当前 turn 结束后发出）；可停止（failed 语义）。
- 权限：跟随全局权限模式。多节点并行时权限请求按 sessionId 路由到对应节点，节点上出现权限提示徽标，点开抽屉处理。
- 环检测同样约束编辑阶段：构建连线时就拒绝产生环的操作（即时反馈）。

**架构**

- 新增编排引擎（Orchestration Engine）：一个纯状态机模块（工厂函数模式，参照 turn/ 目录的 createTurnStateMachine 深模块先例），拥有 DAG 结构、节点状态（pending/running/settled/failed/skipped/queued）、并发闸门。所有 DAG 语义在这层实现和测试。
- 编排引擎的外部依赖通过工厂参数注入：会话启动器（为节点创建 session 并发出首条消息）、turn 结局信号源、会话中止器。生产环境接线到现有 turn store / chatSession store / permissionPolicy。
- turn store 需扩展一个 turn 结局订阅点：现有 goal store 的 onTurnCompleted 回调是先例，但需区分三种结局（settled / failed / aborted）。编排引擎订阅它获取节点完成信号。此订阅点即 turn store 的最小改动。
- 进程池上限：Claude Code 与 Pi 两个进程池的 MAX_PROCESSES 从 3 提升到 20。编排并发闸门默认 20，与池对齐。闸门负责就绪节点排队，不依赖进程池驱逐。
- Task Node 的会话走现有 chatSession store 全链路（创建/侧边栏/localStorage 持久化/JSONL 恢复）。编排引擎只引用 sessionId，不复制会话数据。
- 编排图结构（节点 + 连线 + 草稿 + 画布坐标 + 每次运行的节点状态快照）持久化到 localStorage（与 goal store 同款模式）。

**UI**

- 画布引入 Vue Flow（@vue-flow/core），以可关闭的 center tab 形式打开（openTerminalTab 同款机制，tab id 如 `orchestration-<id>`）。
- 节点卡片：自定义 Vue Flow 节点组件，内嵌真实 ChatPanel（传 sessionId prop，CSS transform 缩小）。节点头部显示状态标识 + 权限提示徽标。
- 放大交互：双击节点在画布内弹出抽屉（Drawer），抽屉内渲染完整尺寸 ChatPanel，可继续输入交互；关闭抽屉回到画布。
- 运行控制条：运行/停止按钮、整体进度（已完成/总数）、并发状态。
- i18n：全部文案进 zh-CN.ts / en-US.ts。

## Testing Decisions

**好的测试标准**：只测外部行为（公共接口的表现），不测内部实现细节（状态字段叫什么、内部方法怎么拆）。DAG 语义测试全部通过编排引擎工厂的注入接口驱动，不 mock 内部。

**缝隙（seams）**——1 新 + 2 复用（已与用户确认）：

1. **编排引擎工厂（新缝隙）**：`createOrchestrationEngine(opts)`，注入会话启动器、turn 结局信号源、中止器。全部 DAG 语义在这层用注入的 fake 测试：串行触发、并行分叉、汇合、失败传播（下游 skip、旁支继续）、重试续跑、并发闸门排队、运行中锁结构、环检测。纯状态机测试，不需要 Pinia/IPC。参照 `turnStateMachine.ts` 的工厂模式先例。
2. **turn store fake-api 挂具（复用现有缝隙）**：沿用 `src/stores/__tests__/turn.test.ts` 的 `makeFakeApi` + `_handlers` 模式，通过 `queueMicrotask` 触发 onResult 驱动 turn 结算。集成测试验证：编排引擎订阅的 turn 结局订阅点真的被 fake 事件驱动、节点完成后下游真的通过 sendMessage 发出草稿。
3. **electron/__tests__ 进程池测试（复用现有缝隙）**：MAX_PROCESSES 20 的配置改动沿用现有进程池测试模式验证（启动/复用/驱逐边界）。

UI 组件测试（画布 tab、节点卡片、抽屉）走 tests/components/ 现有 Vue Test Utilities 模式，做轻量行为测试（渲染状态标识、双击打开抽屉、运行按钮禁用态），不测 Vue Flow 内部。

**Prior art**：
- `src/stores/__tests__/turn.test.ts` — fake api 注入驱动完整 turn 生命周期（最接近的先例）
- `src/stores/turn/turnStateMachine.ts` — 工厂 + 依赖注入的深模块先例
- `src/stores/__tests__/turnSink.test.ts` — sink 缝隙测试先例
- `electron/__tests__/sessionProcess.running.test.ts` — 进程池层测试先例

## Out of Scope

- 节点间数据传递（上游输出注入/占位符引用）——推迟，Edge 保持纯触发
- 节点输出的成功/失败内容判定（LLM 输出语义分析）
- 编排图模板/分享/导入导出
- 定时/触发器启动（cron 式自动运行编排）
- 画布多标签页同时开多张图（第一版一张）
- 恢复"运行中"的图继续跑（重启后运行状态如实展示但不续跑，用户需手动重试/重跑）
- 节点级引擎/模型差异化配置（跟随全局设置）
- 图结构版本迁移（localStorage schema 变更直接失效重建）
- Vue Flow 之外的画布高级功能（节点分组、注释、颜色标记等）

## Further Notes

- ADR-0010（docs/adr/0010-session-orchestration-one-shot-dag.md）记录了全部决策与备选方案。
- CONTEXT.md 的 Session Orchestration 术语表是本功能的权威词汇（Orchestration Graph / Task Node / Edge / Draft / Run / Node Status / Failure Propagation / Concurrency Gate / Drawer）。
- 风险提示：20 个并发 CLI 进程对低配机器内存压力大；编排闸门与进程池上限需保持同值，否则行为不可预测。进程池上限提升后，原有的"3 进程驱逐轮转"行为在普通多会话场景（非编排）下也会变化——分屏 + 后台会话 + 编排并存时最多 20 个进程，需注意整体内存水位。
