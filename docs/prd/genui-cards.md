# 生成式 UI 卡片（GenUI Cards）产品规格

> 状态：ready-for-agent。术语见 `CONTEXT.md` 的 Generative UI 与 Agent Registry 两节；决策见 ADR 0015（独立 origin 沙箱）与 ADR 0016（单份 SKILL.md 分发到 Claude 与 Pi）。

## Problem Statement

AI 编码助手现在只能把结构化信息写成 Markdown 或 JSON：一份配置表、一组待确认的参数、一张构建结果概览，用户只能读，不能点。需要用户补信息时，模型只能再问一段自然语言，用户再用自然语言回答，双方都在猜字段名与取值范围。

SpaceCode 已有的 design 预览是**应用级**的：它把生成结果放在独立预览面板，和产生它的那条消息分离，也不参与对话回环。用户真正想要的是：模型在回答里**直接长出一个界面**，能填、能点、能提交；提交后模型拿到结构化结果继续干活，而这段历史以后还能原样打开。

## Solution

当用户要求「做成界面 / 表单 / 看板」时，助手输出一段卡片 Schema；SpaceCode 在产生它的消息下方把它渲染成可交互卡片。卡片跑在**完全断网、拿不到应用上下文的独立沙箱**里，只能通过宿主批准的动作（提交、复制、展开、打开外链）影响应用。提交后，时间线出现一条人类可读的摘要消息，模型同时收到完整 payload，下一轮直接继续。

能力由一份内置的 **GenUI Skill** 开启：它按需加载，同时分发给 Claude Code 与 Pi，不改变两个引擎的启动方式。卡片跟随应用明暗主题，随会话持久化，桌面与 H5 都能用；普通文本对话、design 模式与既有预览流程不受影响。

## User Stories

1. As a developer, I want the assistant to render an interactive card inline in the reply, so that I do not have to copy structured output into another tool.
2. As a developer, I want to ask for a form card when the agent needs several parameters, so that I can fill fields instead of writing a long prose answer.
3. As a developer, I want a table or dashboard card for build/test results, so that I can scan the outcome at a glance.
4. As a user, I want one reply to contain several cards, so that a multi-step plan can show each step separately.
5. As a user, I want cards in the same order the assistant emitted them, so that the reply still reads coherently.
6. As a user, I want prose around a card preserved, so that the card is introduced and explained.
7. As a user, I want the raw schema JSON hidden from the conversation, so that the chat stays readable.
8. As a user, I want a card that is still streaming to stay hidden until its schema is complete, so that I never see a half-built layout flash by.
9. As a user, I want a malformed or unsupported card to degrade to readable text, so that one bad schema does not destroy the whole reply.
10. As a user, I want to copy text out of a card, so that I can reuse it elsewhere.
11. As a user, I want to expand a card to a larger view, so that dense tables and forms are usable.
12. As a user, I want links inside a card to open in my system browser, so that clicking one never navigates the app away.
13. As a security-conscious user, I want cards to have no network access, so that a generated card cannot exfiltrate my conversation or files.
14. As a security-conscious user, I want cards unable to run shell commands or modify files/code, so that a malicious schema stays inert.
15. As a user, I want to submit a form card and have the agent continue with my answers, so that the interaction is a real conversation loop.
16. As a user, I want the submission to appear as a readable summary, so that my history still makes sense later.
17. As a user, I want the exact submitted payload available to the model, so that it does not have to re-ask or guess.
18. As a user, I want duplicate submits blocked, so that the agent does not perform the same action twice.
19. As a user, I want a submitted card to become read-only, so that history cannot diverge from what was actually sent.
20. As a user, I want cards to survive a reload or a switch between sessions, so that I can revisit an old interaction.
21. As a user, I want cards not to duplicate when a session is restored, so that history stays clean.
22. As a user, I want long conversations with many cards to stay responsive, so that offscreen cards do not keep consuming memory.
23. As a user, I want a card that fails to load to offer a retry, so that one broken card is recoverable.
24. As a dark-mode user, I want cards to follow the app's light/dark theme, so that they do not glare or look detached.
25. As a zh-CN or en-US user, I want host-provided card UI (actions, errors, submission summary) in my language.
26. As a Claude Code user, I want card generation to work without installing an extension, so that the capability is available out of the box.
27. As a Pi user, I want the same capability through Pi's native Skill mechanism, so that I do not maintain a second prompt or tool.
28. As a user, I want app updates to keep the skill and the renderer in sync, so that cards do not start failing after an upgrade.
29. As a user, I want normal chats to remain text-only unless a card is actually useful, so that I do not pay extra tokens or see cards everywhere.
30. As a user, I want plain text replies, tool cards, and reasoning to look exactly as before.
31. As a design-mode user, I want the existing design preview workflow untouched, so that this feature does not regress it.
32. As an H5 user, I want the same inline cards on the web app, so that the capability is not desktop-only.
33. As an H5 user, I want card-originated network access blocked there too, so that the browser deployment is not a weaker sandbox.
34. As an operator, I want the H5 sandbox origin/port documented, so that deployment does not silently break cards.
35. As a user, I want a card that stops responding to be replaceable by an error placeholder, so that it cannot wedge the message.
36. As a user, I want card size and count bounded, so that an oversized schema cannot bloat my session or storage.
37. As a user, I want oversized-card fallback to be visible, so that I know content was not lost silently.
38. As a keyboard user, I want host-level card controls reachable without a mouse, so that expand/retry are usable.
39. As a user, I want cards to never mutate my code or files, so that I remain in control of the repository.
40. As a user, I want the assistant to emit only the card when I ask for a card, so that there is no redundant "here is your card" prose.
41. As a user, I want the same card schema to render identically on desktop and H5, so that I do not learn two behaviors.
42. As a user, I want old card payloads to stop consuming my session budget gracefully, so that session saving never breaks because of cards.
43. As a user, I want a card that cannot handshake with the host to show an error instead of a blank frame.
44. As a user, I want card failures to be isolated to that card, so that the rest of the message and the app keep working.

## Implementation Decisions

### 1. Card Schema 与投影

- 唯一的卡片载体是 assistant 文本中的闭合围栏 ` ```schemaJson `。围栏内必须是 JSON 对象，根节点有 `componentName`；其他语言标记、缩进代码块与普通 JSON 围栏一律不动。
- 投影是一个纯函数：输入 assistant 累计文本、消息 id 与限额，输出「去围栏后的可见文本 + 卡片记录数组」。同样输入必须得到同样输出（幂等），供流式更新、历史回放与持久化复用。
- 流式期间只发射**已闭合**的围栏；未闭合围栏从可见文本中隐藏。消息结束时仍未闭合的围栏按普通代码块显示，不生成卡片。
- 卡片顺序即围栏出现顺序。可见文本只移除围栏本身，前后散文保留；移除后为空则时间线不渲染空文本行。
- 卡片记录挂在 assistant 消息的 metadata 上，时间线事件结构不变。记录形状：

  ```ts
  type GenuiCardRecord = {
    id: string                 // `${messageId}:card:${index}`，确定性 id 用于去重
    schema: Record<string, unknown>
    protocolVersion: number
    submitted?: { at: number; summary: string }
  }
  ```

- 解析失败、根组件不在物料白名单、或超过限额时，不生成卡片：原样保留为文本代码块，并附一条宿主提示（可折叠查看原始内容）。
- 限额集中在一个模块里：单卡 schema ≤ 64KB，单条消息 ≤ 8 张卡，单会话已持久化卡片总量 ≤ 512KB。超限按「后面的卡降级为文本」处理，不静默丢弃。
- 协议版本由渲染端与沙箱共同声明；不匹配时按「无法渲染」降级，避免旧技能配新渲染器产生错位界面。

### 2. 消息归属与渲染位置

- 卡片属于**产生它的 assistant 消息**，渲染在该消息的 AgentTimeline 之后、下一条消息之前；不插进时间线事件流，也不进独立侧栏。
- 同一消息多卡按记录顺序纵向排列；卡片不参与 Markdown 渲染，避免围栏内容被再次解析。
- 普通消息、design 模式的 `DesignBlocks`、工具卡与推理卡均不改变；design 模式与 GenUI 卡片共存，互不接管。
- 宿主渲染卡片外壳（展开、重试、错误态），卡片内部交互由沙箱负责。外壳控件可键盘聚焦。

### 3. 沙箱承载与通信

- 每张卡一个独立 iframe，只授予 `allow-scripts`，**不授予** `allow-same-origin`；文档因此是 opaque origin，读不到父文档、cookie、storage 与 preload API。
- 文档来源与主窗口分源：
  - 桌面生产：自定义协议 `spacecode-genui://`，注册为 standard + secure，从打包资源提供沙箱静态文件。
  - 桌面开发：独立 Vite 实例，主机名与端口都和主窗口不同（主窗口 `127.0.0.1:5173`，沙箱 `localhost:5174`），确保跨 site、拿到进程隔离。
  - H5：独立源（主服务端口 +1），逐响应注入 CSP 与 nonce。
- 沙箱文档自带 CSP，不与主窗口共享：`default-src 'none'`；脚本只允许自身资源与 `'unsafe-eval'`；样式允许自身与内联；图片允许自身与 `data:`；`connect-src 'none'`；`form-action 'none'`；`base-uri 'none'`；`frame-src 'none'`；`object-src 'none'`。主窗口 CSP 不增加 `unsafe-eval`，只为 framing 增加沙箱源。
- 通信使用 `MessageChannel` + 每卡 nonce：宿主经初始化消息注入 nonce、端口、主题、locale 与 schema；沙箱回 `ready` 并声明协议版本。宿主只接受 `event.source === iframe.contentWindow` 且 nonce 匹配的消息。
- 卡片不能导航：桌面端拒绝 frame navigation 与新窗口；沙箱不授予 top navigation；H5 依赖 CSP 的 `form-action` / `base-uri` 与应用侧来源校验。
- 握手超时（默认 5 秒）、iframe 加载失败或动作确认超时，都落到该卡的错误态，提供重试；不阻塞消息其余部分。
- 卡片只接收明暗与 locale，不读父窗口 CSS；主题或语言变化由宿主推送。

### 4. 动作与提交

- 卡片能请求的动作是固定白名单：`submit`、`copy`、`expand`、`openLink`。白名单之外的消息忽略并记录，不抛错、不转成通用 IPC。
- `submit`：沙箱提交表单 payload；宿主校验为 JSON 可序列化对象且 ≤ 64KB。通过后：
  - 生成一条 user 消息，正文 = 本地化摘要 + 围栏 JSON payload（完整 payload 因此进入模型上下文）；
  - 该消息 metadata 记录 `{ cardId, summary, payload }`，气泡只渲染摘要，围栏部分折叠；
  - 原卡片变为只读并记录 `submitted`；同一卡片的后续 submit 被忽略。
- `copy`：沙箱给出待复制文本（≤ 64KB），宿主写入剪贴板。桌面走 Electron 剪贴板，H5 走浏览器 Clipboard API；不可用时返回失败，由卡片或宿主提示。
- `expand`：宿主用同一份已存 schema 在弹窗内再起一个沙箱实例，不移动原 iframe、不复制 schema 到消息正文。
- `openLink`：只接受绝对 `http:` / `https:` URL；桌面经主进程 `openExternal`，H5 用带 `noopener` 的新窗口。`javascript:`、`file:`、`data:` 与其他协议一律拒绝。
- 卡片**没有** shell、文件、代码修改、引擎调用或任意 IPC 能力；宿主也不为卡片提供这些桥。

### 5. 持久化、配额与生命周期

- 卡片记录写入消息 metadata，随会话持久化；已提交状态与提交摘要一并保留。正文中的围栏在消息收口时移除，因此重载后不会重新显示 JSON。
- 历史回放或中断后重新投影时，用确定性 id 合并：已有记录优先，不重复添加；同一 schema 重复投影结果一致。
- 离屏卡片卸载 iframe，只保留与最后测量高度一致的占位，滚回时从 schema 重建。**未提交的临时输入不承诺跨卸载保留**；已提交结果与只读状态保留。
- 单会话已持久化卡片总量超过 512KB 时，按从旧到新丢弃卡片 payload，改为「卡片内容已过期」的可见占位；会话其余内容照常保存。
- metadata 损坏、schema 校验失败或协议版本不匹配时，卡片降级为文本/错误占位，不影响消息读取。
- 卡片数量与体积的上限同时作用于渲染、桥消息和持久化，避免「能渲染但存不下」的分裂状态。

### 6. 技能生成与分发

- 只维护一份 GenUI Skill（`genui-card`）。正文在构建期由 OpenTiny `genPrompt` 基于官方 mini 物料元数据生成，frontmatter 与输出契约手写。
- 正文必须写明：只输出 ` ```schemaJson ` 围栏、卡片之外不写解释性散文、可用动作仅四项、不得请求网络/执行命令/修改文件、schema 必须匹配内置物料与协议版本。
- 该技能作为 `bundled` 来源 seed 进中心库；bootstrap 只在「从未 seed 过」或「内置版本变化」时写入，用户删除后不会在每次启动被复活，升级时才重新出现。
- 同时创建两个 Target：Claude Code 的 `${CLAUDE_CONFIG_DIR || ~/.claude}/skills` 与 Pi 的 `${PI_CODING_AGENT_DIR || ~/.pi/agent}/skills`。默认 link，失败按既有策略退 copy。
- Agent Registry 增加 Pi 条目，并让 Claude 路径尊重 `CLAUDE_CONFIG_DIR`；不新增 Pi 扩展、不注册 `render_ui` 工具、不维护第二份提示。
- 漂移由测试钉住：技能引用的协议版本、物料名单与渲染端依赖版本一致；物料升级而未同步技能时测试失败。

### 7. H5 承载

- H5 主服务之外再起一个只提供沙箱静态资源的 HTTP 服务，端口为主服务端口 +1（可配置）；它不暴露 API、不读引擎、不返回会话数据。
- 沙箱响应逐个注入 CSP 与 nonce；父页面 `frame-src` 只放行该源；路径穿越、目录列举与非预期 MIME 一律拒绝，复用既有 H5 路径防护口径。
- H5 上的卡片在渲染、动作、提交、持久化上与桌面一致；不可达第二个源时，卡片显示明确的部署错误，而不是空白 iframe。
- 运维文档写明第二个端口需要被反向代理/隧道一并暴露；不自动尝试打洞或改端口。
  - 票 06 落地备注：运维文档在 `docs/genui-h5-sandbox-deployment.md`。
    「逐响应注入 CSP 与 nonce」要求同时改写**文档自带的 CSP meta**：浏览器对同一个文档执行
    meta ∩ 响应头，只换响应头的那条 nonce 永远授权不到任何东西（`electron/infra/cspDocument.ts`）。
    nonce 只加在 `script-src`，不加 `style-src` — 官方物料在运行时注入 `<style>`，而 CSP3 规定
    策略里出现 nonce/hash 来源时 `style-src` 的 `'unsafe-inline'` 会被忽略，加了等于把卡片样式整体打死。
    父页面那一条 nonce 是承重的：服务端逐响应改写 `index.html` 的 CSP meta，并用同一个 nonce 授权一段
    内联引导脚本，把**权威沙箱源**交给渲染端。渲染端不再自己按"端口 +1"推导，因为走反向代理时浏览器看到的
    端口与服务端监听的端口不是一回事，而 `frame-src` 与引导脚本必须出自同一次计算，否则卡片一定被拦。
    第二端口在本进程里没绑定成功时，服务端干脆不广播沙箱源，卡片立即显示"宿主未接入"而不是先亮 5 秒空白 iframe。

### 8. 与现有能力的边界

- design 模式与其预览桥不改动；GenUI 卡片不接管 design 输出。
- `engine/` 视为只读；两种引擎都只通过既有 Skill 加载路径获得能力。
- 主窗口 CSP 保持 `script-src 'self'`；沙箱的 `unsafe-eval` 不泄漏到主文档。
- 现有的页面级消息持久化与时间线裁剪逻辑不改语义；卡片只增加 metadata 字段与独立配额。

## Testing Decisions

**好测试的标准.** 只断言外部可观察行为：给一段 assistant 文本，消息里最终出现哪些卡片、正文剩下什么；给一串桥消息，宿主执行了哪个动作、拒绝了哪个；给临时目录与假的 home，中心库里多了哪些技能、哪些 Target。不断言私有方法、内部缓存或日志文案。

**已确认的测试缝（优先用现有缝）.**

1. **消息投影缝（最高缝，现有）**：从 assistant 事件驱动到消息落库，断言 content 与 metadata。覆盖流式闭合、未闭合、多卡、重投影去重、普通消息零变化。先例是现有 turn store 的 assistant 事件测试。
2. **卡片投影纯函数（新缝，唯一必要的纯逻辑边界）**：表驱动覆盖围栏识别、散文保留、畸形 JSON、白名单失败、限额、幂等。投影逻辑必须从 UI 与 store 中独立出来，否则无法在不挂载组件的情况下钉住边界。
3. **沙箱宿主/桥（新缝，安全边界）**：注入假 iframe 与端口，覆盖 nonce/source 校验、握手超时、动作白名单、payload 上限、外链协议拒绝、错误态路由。协议文件处理器用注入的资源根测试路径穿越、MIME 与 CSP 头。
4. **技能分发（现有缝）**：Skill Manager 服务用临时中心库与可覆盖的 home 启动，断言 bundled 技能 seed、Claude/Pi 两个 Target、环境变量覆盖、重复 bootstrap 幂等、用户删除不复活、版本升级重新 seed。先例是现有 service/distribute/diagnosis 测试。
5. **H5 沙箱服务（现有缝）**：沿现有 H5 HTTP 测试夹具启动服务，断言第二端口只服务沙箱资源、CSP 与 nonce 注入、路径穿越拒绝、父页面 frame-src 契约。先例是现有 H5 server HTTP 测试。
6. **卡片组件（现有组件测试惯例）**：用假桥挂载消息级卡片容器，断言一卡一 iframe、顺序、离屏卸载与重建、只读状态、错误/过期占位。先例是现有 iframe 预览组件测试。

**不进 CI 的部分.** 真实 Electron 进程隔离与真实打包产物、真实浏览器中的 H5 第二源、真实 Claude/Pi 生成卡片，由手工验收矩阵覆盖；自动化只钉住可注入的逻辑与响应。

## Out of Scope

- 卡片执行 shell、读写文件、修改代码、调用引擎或任意应用 IPC。
- 卡片访问网络、加载远程图片/字体/脚本、嵌入外部页面。
- 用卡片替换 design 模式的预览面板，或让 design 输出自动变成 GenUI 卡片。
- 移动端 / Flutter / IM 桥接端的卡片入口。
- Pi 扩展、`render_ui` 工具、第二份 Pi 提示。
- 卡片市场、用户自写技能、技能内容在线更新。
- 流式逐字渲染半张卡片；只在围栏闭合后出现。
- 卡片主题定制（仅跟随应用明暗）、卡片级字体/配色设置。
- 卡片导出为图片/PDF、卡片间联动、跨设备同步卡片状态。
- 在 H5 上实现进程级 CPU 隔离（作为已知残余风险记录）。
- 自动检测并修复生成错误 schema 的「重生成卡片」交互。

## Further Notes

- 依赖基线：`@opentiny/genui-sdk-core`、`@opentiny/genui-sdk-vue`、`@opentiny/genui-sdk-materials-vue-opentiny-vue` 固定同一 1.4.x 版本；沙箱只打包官方 mini 物料白名单内的组件，不整包引入图表等重物料。
  - 实测偏差（票 02）：官方 `miniMaterials` 的三个导出共用同一张 `components` 表，里面含 12 个 `TinyHuicharts*`，mini 收窄的是 schema/prompt 面而非注册面，因此打不打得进包不由名单决定 —— 沙箱产物约 4.9MB JS / 1.2MB CSS。「只认 mini 物料」改由两处行为保证：宿主投影按白名单判定根组件（未列入即降级为文本），沙箱注册前用同一份名单再过滤一遍组件表。真正的体积裁剪需要官方拆出可 tree-shake 的物料入口，另开票跟进。
- 沙箱安全红线段落见 ADR 0015：主窗口永不引入 `unsafe-eval`；沙箱永不授予 `allow-same-origin`；卡片永不获得通用 IPC。
- 技能分发口径见 ADR 0016：一份 SKILL.md、两个 Target；Pi 的技能目录是 `~/.pi/agent/skills`（单数 agent），`~/.pi/agents` 是子代理定义目录，不用于技能。
- 已知残余风险：H5 的第二端口与主服务同 site，只有跨 origin、没有 OOPIF 进程隔离；恶意卡片中的死循环可能拖住同进程页面。桌面端由 OOPIF 隔离，并在导航层拦截自跳转外泄。
- 既有的 DesignPreview iframe 桥没有 source/origin 校验、外链也未限制协议，属于存量安全债，单独开票处理，不在本规格内顺手改。
- 卡片 metadata 会计入会话持久化体积；现有裁剪逻辑不裁 metadata，因此 512KB 配额是功能的一部分，不是可选优化。
- 术语以 `CONTEXT.md` 为准：GenUI Card、Card Schema、Card Sandbox、Card Action、Card Submission、GenUI Skill。
