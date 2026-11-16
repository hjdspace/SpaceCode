# 办公助手路由：通用会话首消息决策 + 统一 Router 接口（LLM 先行，Jev 后续）

## Status

Accepted（2026-11-16）。术语见根目录 `CONTEXT.md` 的 Work Assistant Routing 一节。产品口径见 `docs/prd/work-assistant-routing.md`。

## Context

办公模式内置 24 个 Work Assistant，用户进入办公模式后必须先在画廊里手动选一个助手才能开始对话。用户并不总知道该选谁：7 个 PPT 类助手语义高度重叠，「做个 PPT」这类高频输入没有显然答案；选错助手的代价是整段会话跑偏（错误的提示词 + 错误的技能集）。

架构上有三个既有事实约束方案：

- **人格注入是 spawn 期的**。助手的 system prompt、技能、权限在引擎进程启动时注入，会话中途热切换不存在。
- **但 spawn 本来就是延迟的**。`startWorkAssistantSession` 刻意不在创建时启动 CLI（控制请求会抢进串行 stdin 循环，把用户消息堵在后面），引擎留到首次发送才起。
- **「空 work 会话 + 就地绑定」的缝已经存在**。`switchWorkAssistant` 在当前空 work 会话上绑定助手：装技能（含 officecli→Node 降级）、设会话级权限、必要时停旧进程。输入框上方的快捷助手卡片走的就是它。

决策模型侧有两条路线：

- **生成式 LLM 做分类**：复用既有轻量直连通道（`llm.ts`，会话标题/提交信息同款缝），输出约束 JSON。零新增依赖，但自报置信度不可靠，延迟 1–3s。
- **Jev（TypeSafe System One）**：类型化 Choice 问题直接返回所选项 + 概率分布 + 置信度，70–500ms、输出 token 免费，官方 intent-routing 模式与本需求同构。但它是专用协议（state + questions），不兼容 OpenAI 格式，处于早期访问、需要独立 API key。其官方纪律同时构成设计约束：封闭选项必须留「其他」出口、按阈值降级、硬规则留在代码里、保留确定性回退。

## Decision

1. **General Session 不是新实体，是既有的空 work 会话**（`mode='work'` 且无 `assistantId`）。办公模式默认入口改为它；画廊降为手动入口（既有三处触发点保留）。路由拦截发生在**首次发送、引擎初始化之前**，每会话一次。
2. **绑定复用 `switchWorkAssistant`，不新建注入路径**。路由决策产出助手后，在当前会话上就地绑定，随后正常发送首消息、启动引擎。不做热切换、不做 --resume 重启。
3. **统一 Router adapter 接口**：输入 = 用户首消息 + 候选助手清单；输出 = 排序候选（name/score/reason）+ 显式 none 出口。v1 落 LLM adapter（走 `llm.ts` 既有缝）；Jev adapter 后续实现，Choice 选项映射候选集、概率分布映射 score。接口一次定好，两个 adapter 不共享协议假设。
4. **结果处置是确定性代码，不是模型自由发挥**。自动绑定仅当 top1 score ≥ 阈值（初值 0.6）且领先 top2 ≥ 边际（初值 0.1）；否则出路由候选卡。none / 低置信 / 超时（8s）/ 取消 / 路由不可用一律**扣住消息**，内联选择（含「通用对话」出口），绝不静默丢技能、绝不卡死。阈值为可校准常量，不做用户配置项。
5. **routerConfig 独立于 Profile**（imageGenConfig 先例：两套账号跟着 Profile 切换会迫使重复填写）。默认开启、默认跟随当前配置的快速（haiku）槽位；可自定义 provider/baseUrl/apiKey/model。OAuth 登录无 key 且未自定义时，路由视为不可用，走扣消息路径。
6. **候选集 = 全部 work 助手（含自定义），喂轻量描述**：name + 本地化 description + skillDescriptions + 可选 routingHints（新增 frontmatter 字段，首批填 PPT 七兄弟消歧）。不喂 system prompt 全文。运行时可用性不做排除——既有绑定路径已含 officecli→Node 降级。
7. **路由在 renderer 侧执行**，复用轻量直连缝；8s 超时、**不重试**（延迟敏感，失败有出口）、可取消（AbortSignal）。
8. **可观测性先于调优**：每次决策与用户改选/候选点选记入既有 trace 通道；30–50 条标注样例作评测 fixture，单测覆盖 prompt 构造与解析，CI 不依赖真实模型调用。
9. **会话记录路由结果**（新增 `workRouting` 字段：outcome/assistant/ranked 快照/时间）。字段存在 = 已决策，后续消息不再路由；旧会话无此字段 = 遗留会话，不触发路由，行为不变。

## Alternatives considered

- **画廊顶部加路由输入区（A 入口）**：需要新入口 UI，且绕开了「空 work 会话 + 就地绑定」这条现成的缝；用户已选 B 入口。
- **先起通用引擎、路由后 --resume 重启注入助手**：项目虽有权限模式自动重启先例，但这里 spawn 本就延迟，重启纯属多余，还要处理重启窗口期的消息排队。
- **每轮重路由**：上下文碎片化 + 每轮延迟；话题漂移留给「建议切换」类后续特性。
- **只复用 haiku 槽位、不加配置**：会把路由模型与会话标题等轻量任务耦合死，且 Jev 的 endpoint/key 必然是另一套。
- **低置信也静默选 top1**：整段会话跑偏的代价远大于一次点击；违背 Jev 官方「低置信升级给人」纪律。
- **把路由挂到引擎侧（system prompt 里让主模型自选助手）**：只有认得该机制的引擎能用，且主模型每轮都付 token；判别式决策不该由生成式主模型顺手做。

## Consequences

- 办公模式首消息新增一段可见、可取消的匹配等待（LLM 约 1–3s）；超时与失败都有内联出口，不阻塞。
- LLM 自报 score 不可靠，靠阈值 + 边际 + 候选卡兜底；Jev adapter 落地后概率分布天然改善校准，接口不变。
- `workRouting` 是新会话元数据：持久化与 hydrate 必须容忍缺失（缺失 = 遗留会话）；路由进行中的状态是易失的，重启后未决会话在下次发送时重新路由。
- 首消息被扣住期间，附件随消息一起扣住；切换会话中止在途路由，候选卡留在时间线原位等待点选。
- 用户输入对路由模型是数据不是指令（prompt 注入面）；候选清单与处置规则是宿主自持的可信侧。
