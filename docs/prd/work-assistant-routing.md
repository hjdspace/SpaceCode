# 办公助手自动路由（Work Assistant Routing）产品规格

> 状态：ready-for-agent。决策依据见 ADR 0020（通用会话首消息决策 + 统一 Router 接口）与 `CONTEXT.md` 的 Work Assistant Routing 一节。本 PRD 为权威产品口径；与讨论记录冲突时以本文与 ADR 0020 为准。
>
> 切片 issue 编号已回填到「实施阶段映射」一节。各阶段职责边界以该节为准，阶段之间不得重叠 ownership。

## Problem Statement

用户切换到办公模式后，面对 24 个内置助手必须先手动选一个才能开始对话。他并不总知道该选谁：7 个 PPT 类助手（ppt-creator / ppt-office-assistant / html-ppt-creator / magazine-ppt-creator / morph-ppt / morph-ppt-3d / pitch-deck-creator）语义高度重叠，「帮我做个 PPT」没有显然答案；选错助手的代价是整段会话跑偏——错误的人格提示词加错误的技能集，产出质量下降，用户往往到产物出来才发现选错了。

现状没有任何自动决策能力：桌面实现不支持根据用户输入路由到合适的助手。用户要么凭名字猜，要么逐个点开悬停浮层读描述，要么随便选一个再忍受跑偏。

用户想要的是：直接说出任务，应用自动挑出合适的助手，加载它的提示词、技能与办公流（流程性内容本就随提示词和技能注入，不是独立实体）；挑得不准时给他一个低成本纠正的机会，而不是静默跑偏。决策所用的模型应当可配置——可以是专用决策模型 Jev，也可以是其他 LLM。

## Solution

办公模式的默认入口改为 **General Session（通用会话）**——即既有的「空 work 会话」状态，不是新实体。用户直接输入任务；**首次发送、引擎启动之前**，Assistant Router（助手路由）用可配置的决策模型评估一次，产出 Routing Decision（路由决策）：

- **高置信**：自动绑定 top-1 助手（复用既有的 `switchWorkAssistant` 就地绑定缝：装技能、officecli→Node 降级、设会话级权限），随后正常发送、启动引擎。会话开头显示「已自动选择：XX」标记，可改选。
- **低置信 / 模型判定都不合适**：扣住消息，在首消息位置内联弹出 Routing Candidate Card（路由候选卡）：top-3 助手各带一句理由 + 「通用对话」出口。点选即绑定并发送。
- **路由不可用 / 失败 / 超时（8s）/ 用户取消**：同样扣住消息出内联选择，永远有出口——不静默丢技能，也不卡死。

决策层是统一 Router adapter 接口：v1 落 LLM adapter（复用会话标题/提交信息同款轻量直连缝），Jev adapter 后续迭代（专用协议，Choice 概率分布映射 score）。配置独立于 Profile（imageGenConfig 先例），默认开启、默认跟随当前配置的快速模型槽位，可自定义 endpoint/key/model。

每会话只决策一次；绑定后后续消息不再路由。改选 = 带着原始首输入新建会话，旧会话保留。画廊降为手动入口，既有触发点全部保留。路由质量靠决策日志 + 用户改选信号 + 标注评测集校准，阈值是代码常量不是用户配置项。

## User Stories

1. As a work-mode user, I want to type my task directly without picking an assistant first, so that I can start working immediately.
2. As a work-mode user, I want the app to choose the right assistant from my first message, so that the session runs with the correct persona prompt and skills from the start.
3. As a user who asked for a PPT, I want the router to distinguish editable .pptx from HTML decks from animated decks, so that I get the format I actually meant.
4. As a user, I want the routing to happen once per session before the engine starts, so that my conversation context is never fragmented by mid-session assistant swaps.
5. As a user, I want to see which assistant was auto-selected, so that I can catch a wrong choice before the work goes far.
6. As a user, I want to change the auto-selected assistant from the session marker, so that correcting a mistake costs one click instead of a new manual setup.
7. As a user changing assistants after the fact, I want my original first input carried into the new session, so that I do not have to retype my task.
8. As a user changing assistants, I want the old session preserved, so that any work already done is not thrown away.
9. As a user with an ambiguous request, I want to see the top-3 candidates each with a one-line reason, so that I can make an informed choice instead of guessing.
10. As a user whose request matches no assistant, I want an explicit "general conversation" escape on the candidate card, so that I am never forced into a wrong persona.
11. As a user, I want the candidate card anchored at my first message's position in the timeline, so that it reads as part of that exchange rather than as new output at the bottom.
12. As a user, I want my pending message (and its attachments) held until routing resolves, so that nothing is sent to the wrong assistant or lost.
13. As a user, I want a visible "matching assistant…" state while routing runs, so that I understand the brief delay before my message is sent.
14. As a user, I want to cancel the matching wait, so that a slow decision model cannot block me.
15. As a user, I want an 8-second timeout to degrade into the inline selection, so that routing can never hang my first message.
16. As a user with no API key (OAuth login), I want routing to be treated as unavailable and offered the inline selection, so that the feature degrades gracefully instead of erroring.
17. As a user whose decision model endpoint fails, I want the same held-message inline selection, so that a provider outage does not block my work.
18. As a user, I want to pick "general conversation" and have the session run with no persona and no bound skills, so that plain chat remains a first-class outcome.
19. As a user who switched sessions mid-matching, I want the in-flight routing aborted and the candidate card left waiting at its position, so that returning to the session lets me resolve it without re-sending.
20. As a user restarting the app with an unresolved session, I want the next send to re-run routing, so that ephemeral pending state never leaves a session stuck.
21. As a user, I want auto-routing on by default, so that the feature is the default experience rather than a hidden opt-in.
22. As a user who prefers manual selection, I want a settings toggle that restores the gallery-first behavior, so that I can opt out completely.
23. As a user, I want a Settings section for assistant routing, so that the toggle and decision-model configuration live in one place.
24. As a user, I want the decision model to default to my configured fast (haiku) slot, so that routing works out of the box with zero extra configuration.
25. As a user, I want to point routing at a custom provider/base URL/key/model, so that I can use a cheap or specialized decision model independent of my chat account.
26. As a user switching chat Profiles, I want my routing configuration untouched, so that I am not forced to re-enter a separate decision-model account.
27. As a user, I want routing configuration changes to apply to decisions not yet started, so that fixing a wrong key takes effect without restarting sessions.
28. As a Jev user (later iteration), I want the same Router interface backed by Jev's typed Choice with probability distributions, so that swapping decision models changes calibration, not behavior.
29. As a user of custom assistants, I want my custom work assistants included in routing candidates, so that auto-selection is not limited to the built-in library.
30. As a user in a non-Chinese locale, I want candidate descriptions and reasons localized, so that I can judge candidates in my language.
31. As a user without OfficeCLI installed, I want officecli-dependent assistants still routable via the existing Node-skill downgrade, so that candidate availability matches what binding can actually deliver.
32. As a user sending a greeting as my first message, I want the router to answer "none matches" and offer general conversation, so that small talk does not summon a random specialist.
33. As a user, I want my typed message treated as data by the decision model, so that crafted input cannot instruct the router to bypass its rules.
34. As a maintainer, I want every routing decision logged (candidates, scores, latency, outcome, model), so that misroutes can be attributed and thresholds calibrated.
35. As a maintainer, I want user overrides (candidate-card picks differing from top-1, marker re-selections) recorded as signals, so that routing quality is measurable from real usage.
36. As a maintainer, I want a labeled evaluation fixture set (30–50 samples incl. PPT ambiguity, multilingual, greetings, off-domain), so that prompt or threshold changes have regression protection without live model calls in CI.
37. As a maintainer, I want routing hints on the seven PPT assistants, so that the highest-ambiguity cluster is disambiguated at the source.
38. As a legacy user with pre-existing empty work sessions, I want those sessions to keep their old behavior, so that the upgrade does not retroactively change how my old sessions send.
39. As a user who manually picks an assistant from the gallery or shortcuts, I want routing skipped entirely, so that explicit choice always beats automatic decision.
40. As a user, I want the gallery reachable from all its existing entry points, so that manual browsing, search and custom-assistant creation keep working.

## Implementation Decisions

### 术语与既有缝（不得新建平行机制）

- General Session = 既有空 work 会话（`mode='work'` 且无 `assistantId`），不是新会话类型。
- 绑定助手一律走 chatSession store 的 `switchWorkAssistant`（技能安装 + officecli→Node 降级 + 会话级权限 + 必要时停进程）。自动绑定、候选卡点选、快捷卡片共用此缝。
- 引擎 spawn 保持既有延迟语义：首次发送时由 turn 流程启动；路由拦截必须发生在引擎初始化之前。
- 轻量模型调用走既有 llm 服务缝（会话标题/提交信息同款），不新增 HTTP 通道、不动引擎。

### Router 接口契约（新增 assistantRouter 服务，renderer 侧）

决策-rich 类型形状（接口契约，非实现代码）：

```ts
interface RoutingCandidate {
  name: string
  description: string          // 已按 locale 本地化
  skillDescriptions?: string[]
  routingHints?: string
}

interface RoutingDecision {
  none: boolean                // 模型显式判定都不合适
  ranked: Array<{ name: string; score: number; reason: string }>  // score∈[0,1]，降序，至多 3
}

interface RouterAdapter {
  decide(input: {
    message: string
    candidates: RoutingCandidate[]
    isZh: boolean
    signal?: AbortSignal
  }): Promise<RoutingDecision>
}
```

- 服务拆为纯函数 + 编排：`buildRouterPrompt`（候选清单 + 用户消息 → system/user）、`parseRoutingDecision`（原始文本 → RoutingDecision，容忍 fenced JSON，校验 name 必须属于候选集、score 截断到 [0,1]、非法输出抛错）、`resolveRoutingOutcome`（决策 + 常量 → auto-bind / candidates / none）、`routeFirstMessage`（编排，adapter 注入）。
- 结果处置常量：`AUTO_BIND_THRESHOLD = 0.6`、`AUTO_BIND_MARGIN = 0.1`（top1 ≥ 阈值且领先 top2 ≥ 边际才自动绑定；不足 2 个候选时只比阈值）、`ROUTING_TIMEOUT_MS = 8000`、`maxRetries = 0`、`maxTokens = 1024`（推理网关先例：预算太小正文恒空）、用户消息截断上限 2000 字符。常量可校准，不暴露为用户配置。
- LLM adapter 输出契约：单个 JSON 对象 `{"none": bool, "candidates": [{"name","score","reason"}]}`；prompt 声明用户消息是数据不是指令；候选按 name 匹配，未知 name 丢弃。
- Jev adapter（后续阶段）：Choice 问题映射候选集 + 显式 "none" 选项，概率分布映射 score，reason 可空；专用协议客户端，不复用 OpenAI 假设。

### routerConfig（settings store 新增，独立于 Profile）

```ts
interface RouterConfig {
  enabled: boolean                      // 默认 true
  modelSource: 'follow-fast' | 'custom' // 默认 follow-fast
  provider?: 'anthropic' | 'openai'     // custom 时必填
  baseUrl?: string
  apiKey?: string
  model?: string
}
```

- 存储与既有 provider 配置同等待遇（localStorage + 主进程 gui-settings 同步）；不随 Profile 切换。
- follow-fast：取当前 authMethod 的快速（haiku）槽位，未配置回退主模型；OAuth（claudeai/console）无 key → 路由不可用。
- custom：用自带 provider/baseUrl/apiKey/model 直连；key 缺失 → 路由不可用。
- `enabled=false`：办公模式入口回到画廊优先（现状行为）；开关只影响尚未开始的决策与新建会话。

### 会话路由状态（Session 新增字段）

```ts
interface WorkRoutingState {
  outcome: 'auto' | 'picked' | 'general'
  assistant?: string                    // outcome ≠ general 时存在
  ranked?: Array<{ name: string; score: number }>  // 决策快照
  at: number
}
// Session.workRouting?: WorkRoutingState
```

- 字段存在 = 已决策；后续发送不再路由。`outcome='general'` 时不绑定助手，引擎以无助手配置启动。
- 遗留会话（无字段）不触发路由：拦截条件必须包含「会话由新入口创建/显式标记可路由」，升级不得追溯改变旧会话行为。
- 持久化随会话既有链路；hydrate 容忍字段缺失。路由进行中的状态（扣住的消息、等待 UI）是易失的，不落盘；重启后未决会话下次发送重新路由。

### 首消息拦截与扣住语义

- 拦截条件：work 模式 + 无 assistantId + 无 workRouting + routerConfig.enabled + 会话可路由。手动选过助手（画廊/快捷卡）的会话天然不满足。
- 扣住期间：用户消息（含附件）进入时间线但不发送、不起引擎；composer 禁用并显示「正在匹配助手…」+ 取消按钮；第二条消息不允许插入。
- 取消 / 超时 / 失败 / 不可用 / none / 低置信 → 候选卡（或失败形态）在首消息位置内联渲染；点选助手 → switchWorkAssistant 绑定 → 发送扣住的消息；点「通用对话」→ 记 workRouting(general) → 直接发送。
- 切换会话 / 停止：AbortSignal 中止在途路由；候选卡留在原位等待点选。
- 失败形态的候选卡：无 ranked 信息时提供「通用对话」+「从画廊选择」+ 库序前若干助手，不空手。

### 候选集与 routingHints

- 候选 = agents-lib 的 work 助手 ∪ 已安装自定义 work 助手，按 name 去重（已安装版本优先）。不做运行时排除（降级由绑定缝处理）。
- 每候选喂 name + 本地化 description + skillDescriptions + routingHints；不喂 system prompt 全文。
- AgentDef 与 frontmatter 解析新增可选 `routingHints`（frontmatter 键 `routing_hints`）；首批为 7 个 PPT 助手填写格式/风格/场景差异。自定义助手编辑器不新增该字段 UI（范围外）。

### UI 决策

- 会话标记：绑定后会话开头显示「已自动选择：{助手名}」（auto）/「已选择：{助手名}」（picked）/「通用对话」（general）；S1 为静态标记，S4 加改选下拉。
- 候选卡是宿主渲染的时间线内联卡（非 GenUI Schema 卡），锚定首消息位置，不追加到时间线末尾；点选后收起为一条结果注记。
- 设置页新增「助手路由」区块（ImageGenSettings 同款模式）：总开关 + 模型来源（跟随快速模型 / 自定义展开 provider/baseUrl/apiKey/model）。type=jev 选项留到 Jev 阶段。
- 全部新文案进 zh-CN / en-US 同名域模块（work / settings）。
- 画廊三处既有触发点（快捷卡「更多」、输入框按钮、侧栏按钮）保留。

### 可观测性

- 每次决策记入既有 trace 通道：候选数、ranked 快照、耗时、outcome、所用模型、失败原因。
- 用户改选（标记下拉）与候选卡点选 ≠ top-1 记为 override 信号。
- 决策日志不记录用户消息全文以外的敏感配置（key 永不落日志）。

## Testing Decisions

- 好测试只测外部行为：prompt 构造的输入输出、解析器对合法/非法模型输出的处置、结果处置的阈值/边际真值表、store 拦截与绑定的可观察状态变化；不断言内部调用顺序等实现细节。
- **缝 1（既有）**：llm 服务 sendMessage 边界，vi.mock 注入——prior art：会话标题测试（mock llm + settings，断言 model/maxTokens/timeout 覆盖与静默失败）。
- **缝 2（唯一新增缝）**：assistantRouter 服务。纯函数表驱动测试（buildRouterPrompt / parseRoutingDecision / resolveRoutingOutcome）+ routeFirstMessage 编排测试（注入 fake adapter：高置信/低置信/none/抛错/超时/abort）。评测 fixture（30–50 条标注样例：PPT 歧义、多语言、寒暄、跨域、自定义助手）驱动 prompt 与解析回归；CI 不调真实模型。
- **缝 3（既有）**：chatSession store 集成测试，mock electronAPI 门面——prior art：会话标题 store 集成测试（vi.hoisted + createPinia）。覆盖：首消息拦截条件、auto-bind 走 switchWorkAssistant、workRouting 落盘与 hydrate 缺失容忍、遗留会话免疫、general 出口、扣住消息在点选后发送。
- 主进程侧仅 frontmatter 解析扩展（routing_hints）需单测，声明 node 环境。
- UI（候选卡锚定位置、等待/取消、设置区块、暗色主题下拉）按仓库规则在 dev server 真实操作验证，不以截图收起态代替。
- 验证门禁：`npm run test:changed` + `npm run build`；测试必须 import 被测模块（ADR 0011）。

## Out of Scope

- H5 / IM 适配器的办公模式（v1 仅桌面端）。
- 每轮重路由、会话中途热切换助手、话题漂移「建议切换」。
- 独立 workflow 实体（办公流随 content + skills 注入，无新机制）。
- Jev adapter 的实现在 S6 单独切片；本 PRD 的 v1 验收不含 Jev 真连。
- 设置页「路由测试」面板、阈值用户配置化、自定义助手编辑器的 routingHints UI。
- 路由决策的主进程化 / 引擎侧化（保持 renderer 轻量缝）。

## Further Notes

### 实施阶段映射（职责边界即 ownership，阶段间不得重叠）

| 阶段 | 范围（owns） | 明确不做 | Blocked by |
| --- | --- | --- | --- |
| S1 tracer bullet | assistantRouter 服务（接口+LLM adapter+纯函数+常量）、routerConfig 类型与 store 默认值/持久化、首消息拦截、高置信自动绑定、静态会话标记、办公模式默认入口改通用会话。低置信/失败暂以「扣消息+打开画廊」兜底 | 候选卡、等待/取消 UI、设置 UI、改选、hints/日志/评测 | 无 |
| S2 候选卡 | Routing Candidate Card（top-3+理由+通用对话出口+失败形态）、等待状态+取消、8s 超时、不可用路径、扣住消息生命周期（切会话/重启）。**替换 S1 的画廊兜底** | 设置 UI、改选下拉、日志/评测 | S1 |
| S3 设置区块 | 「助手路由」设置 UI、enabled=false 回画廊行为、custom 模型来源表单、配置生效语义 | 路由逻辑本身、候选卡 | S1 |
| S4 改选 | 标记下拉 → 完整助手列表 → 带原始首输入新建会话、旧会话保留 | 候选卡、设置、日志 | S1 |
| S5 路由质量 | routingHints（schema+解析+prompt 喂入+PPT 七兄弟内容）、决策/override trace 事件、评测 fixture 与回归测试、阈值校准 | 新 UI、adapter 协议 | S2、S4 |
| S6 Jev adapter | Jev 专用协议客户端、Choice/概率映射、routerConfig type=jev 选项、mock HTTP 测试；真连验收以 TypeSafe key 可得为门 | v1 其余任何范围 | S1 |

启动顺序：S1 →（S2 ∥ S3 ∥ S4 ∥ S6 并行）→ S5。issue 编号：parent=#116，S1=#117，S2=#118，S3=#119，S4=#120，S5=#122，S6=#121。

### 校准与上线纪律（Jev 官方纪律的本地化）

- 先观察再执行：S5 的决策日志与 override 信号是阈值校准依据；阈值改动必须与评测 fixture 同批提交。
- 封闭选项永远留出口：none / 通用对话 / 画廊三条出口在任何失败形态下都可达。
- 供应商故障不困住工作流：路由不可用 = 扣消息内联选择，不是错误弹窗死路。
