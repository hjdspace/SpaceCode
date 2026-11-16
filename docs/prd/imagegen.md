# 内置生图（Image Generation）产品规格

> 状态：ready-for-agent。决策依据见 ADR 0019（免安装技能 + 主进程 MCP + 三方言客户端 + 宿主授权闸门）与 `CONTEXT.md` 的 Image Generation 一节。已批准的设计稿与实施计划保留在 superpowers 目录下作为历史；**本 PRD 为权威产品口径**，与两者冲突时以本文与 ADR 0019 为准。

## Problem Statement

用户在 SpaceCode 里让 Agent 做一件带视觉产物的事——给 README 配一张封面、给落地页出三版 hero、把一张截图改个配色——今天做不到。桌面端没有任何生图入口：模型能写 SVG 和 CSS，但拿不到栅格图；用户只能自己去网页版生图、下载、拖进项目、再回来告诉 Agent 文件名。

已有的两条路都不通。让模型自己装 SDK 跑脚本，等于把 API key 交到会话里、把网络出口交给一段临时生成的代码，而且每个会话都要重来一遍。把生图做成引擎扩展，则只有认得那套扩展的引擎能用，另一个引擎上的用户什么也看不到。

用户要的是一条**开箱即用、两个引擎都能走、密钥不离开宿主**的通道：说一句话就出图，图直接落在项目里、在对话里能看能放大能定位到文件夹。他同时不希望这条通道变成一个不受控的计费出口——生图是要花钱的，他不希望模型在他没看清要生几张、用哪个模型之前就把请求发出去，也不希望点了「停止」之后请求还在后台继续烧钱。

## Solution

生图能力拆成三条互不耦合的链路，各自可独立验证：

- **发现**：一份纯说明的内置技能，随应用打包，启动时自动种入中心库并同时装到两个引擎的技能目录。用户不装任何东西，模型按需读取用法。
- **执行**：主进程起一个只监听回环地址的 MCP 服务器，按会话注入给引擎。三个工具——文生图、改图、批量生图——的实际 HTTP 请求全部在主进程发出。密钥只在主进程内存里，不进配置文件、不进引擎子进程环境、不回渲染层。
- **配置**：设置面板新增「生图」分区，选供应商预设、填 key、选模型。配置是全局的，与 Profile 无关，改完下一次调用即生效，不必重启会话。

供应商侧不是「一个 OpenAI 兼容协议」，而是**三种方言**：标准 OpenAI 图像接口、火山方舟 Seedream、智谱 CogView。方言差异（改图怎么传、能不能批量、返回 url 还是 base64、错误藏在哪）由客户端吸收，工具契约对模型保持一致。

每一次生图调用在发出第一个网络请求之前，都要先拿到**宿主授权**：对话里弹出一张卡，写清供应商、模型、张数和 prompt 摘要，用户选「允许一次 / 本会话总是允许 / 拒绝」。完全信任模式下自动放行。无人应答时按看门狗超时拒绝，绝不挂死。用户点「停止」会中止在途请求并丢弃排队项——已经落盘的图保留，被取消的项与失败的项分开报告，且**不自动重试**。

产物落在工作区的生图输出目录，自动出现在产物面板；对话里由专属工具卡片渲染缩略图，可放大、可打开所在文件夹。

## User Stories

1. As a desktop user, I want to ask the Agent for an image in plain language, so that I do not have to leave the conversation to produce a visual asset.
2. As a first-time user, I want image generation to work without installing a skill, an SDK, or a CLI, so that the capability is there the moment I open the app.
3. As a user of either engine, I want the same image capability on Claude Code and on Pi, so that switching engines does not silently remove a feature.
4. As a user, I want the skill to be loaded on demand rather than always in context, so that sessions that never generate images do not pay for its tokens.
5. As a user, I want a Settings section for image generation, so that I can see and change the provider, model and key in one place.
6. As a user, I want provider presets that fill in the base URL and a sensible default model, so that I only have to paste a key.
7. As a user, I want the model name to stay editable even when I picked a preset, so that I can use a newer or regional model the preset does not know about.
8. As a user, I want a custom provider option, so that I can point at a self-hosted or resold endpoint.
9. As a user, I want my image configuration to be independent of the chat model and of Profiles, so that switching conversation profiles does not reset my image provider.
10. As a user, I want configuration changes to take effect on the next call without restarting the session, so that fixing a wrong key is not a disruptive operation.
11. As a privacy-conscious user, I want my API key to stay inside the host process, so that it never appears in a config file the engine reads, in a subprocess environment, or in the renderer.
12. As a user, I want the key never echoed in error messages or logs, so that pasting an error report somewhere does not leak my credential.
13. As a user with no key configured, I want the tool to still be offered and to fail with actionable guidance, so that I learn what to configure instead of wondering why the model claims it cannot generate images.
14. As a user, I want to be told which provider and model will be used before a paid request is sent, so that I am not billed against an endpoint I did not intend.
15. As a user, I want to be told how many images a call will produce before it is sent, so that a request for "a few variants" cannot quietly become eight paid images.
16. As a user, I want to approve a generation once, so that a single mistaken request can be stopped before it costs anything.
17. As a user, I want to allow image generation for the rest of this session, so that an approved workflow does not ask me on every single call.
18. As a user, I want "always allow" to be scoped to this session only, so that approving one conversation does not silently authorize every other conversation.
19. As a user in fully-trusted mode, I want the authorization step to be skipped, so that unattended runs are not blocked on a card nobody will answer.
20. As a user who walked away, I want an unanswered authorization to expire and be refused, so that the session does not hang forever and no request is sent without a decision.
21. As a user, I want a refused authorization to produce a clear tool error and no files, so that the model can tell me it was denied rather than inventing a result.
22. As a user, I want the authorization prompt to appear at the point in the transcript where it was asked, so that it does not stick to the bottom of the conversation as output keeps streaming.
23. As a user, I want to press Stop and have in-flight image requests aborted, so that changing my mind stops the work rather than letting it finish in the background.
24. As a user, I want queued images that never started to be dropped on Stop, so that cancelling a batch does not still pay for the tail of it.
25. As a user, I want images that already finished to survive a cancellation, so that stopping a batch does not throw away work I already paid for.
26. As a user, I want cancelled items reported separately from failed items, so that I can tell "I stopped this" from "this broke".
27. As a user, I want no automatic retry after a cancellation, timeout or failure, so that the provider is not billed twice for the same image.
28. As a user, I want to be told that cancelling cannot guarantee the provider stopped billing, so that I have an accurate expectation rather than a false promise.
29. As a user, I want switching sessions, suspending a session, or the engine process dying to cancel that session's image work, so that no orphaned request outlives its conversation.
30. As a user, I want quitting the app to stop the image server and its in-flight work, so that shutdown is not delayed by a pending download.
31. As a user, I want a request for several variants of one prompt, so that I can compare options without writing the prompt four times.
32. As a user, I want a batch of distinct prompts in one call, so that a set of related assets is produced in one reviewable step.
33. As a user, I want variants and batches to be bounded, so that a vague request cannot turn into an unbounded bill.
34. As a user, I want an over-limit request rejected with the limit stated rather than silently truncated, so that I know exactly what was and was not produced.
35. As a user, I want results returned in the order I asked for them, so that "the second variant" means what I think it means.
36. As a user, I want a partially successful batch to still count as success with a per-item report, so that one bad prompt does not discard the images that did work.
37. As a user, I want an authentication failure to stop the remaining queued work immediately, so that a wrong key does not produce eight identical paid failures.
38. As a user, I want to edit an existing image by describing the change, so that I can iterate on an asset instead of regenerating it from scratch.
39. As a user, I want to pass several reference images to one edit, so that I can combine elements from more than one source.
40. As a user, I want an edit to never overwrite its source file, so that iterating cannot destroy the original.
41. As a user whose provider cannot edit images, I want an explicit refusal that names the limitation and where to change the model, so that I am not silently given a fresh generation instead of an edit.
42. As a user, I want generated files written into my workspace's image output directory, so that the assets are part of the project rather than hidden in app data.
43. As a user, I want generated images to show up in the artifacts panel automatically, so that I can find them again after the conversation scrolls away.
44. As a user, I want a dedicated tool card with thumbnails, so that I can see what was produced without opening a file manager.
45. As a user, I want to click a thumbnail to view it full size, so that I can judge detail before using the asset.
46. As a user, I want to open the containing folder from the card, so that I can drag the file into another tool.
47. As a user, I want filenames derived from my hint but sanitized, and collisions versioned rather than overwritten, so that a second run never destroys the first run's output.
48. As a user, I want the tool result to carry paths, size and the actual model used rather than image bytes, so that the conversation context is not flooded with base64.
49. As a user, I want the model to not re-embed the result paths as Markdown images, so that I do not see every image twice.
50. As a user, I want the model to not claim it looked at an image it only received a path for, so that its description of the result is trustworthy.
51. As a security-conscious user, I want reference image paths resolved through symlinks and confined to the workspace, so that a crafted path cannot make the host read a file outside the project.
52. As a security-conscious user, I want provider responses treated as untrusted and size-bounded, so that a hostile or broken endpoint cannot exhaust memory.
53. As a security-conscious user, I want returned image bytes validated by file signature, so that an HTML error page saved with a `.png` name is rejected instead of written.
54. As a security-conscious user, I want image downloads to refuse redirects, embedded credentials and cloud-metadata destinations, so that a provider-supplied URL cannot be turned into a request against my internal network.
55. As a security-conscious user, I want the image server reachable only from this machine, with a per-launch token, a Host allowlist and a body cap, so that another process or a rebinding page cannot drive it.
56. As a user, I want a provider error surfaced with its own message but without my key, so that I can act on it safely.
57. As a user, I want a per-image error inside an otherwise successful response to be reported as a failed item, so that a partial failure is not mistaken for a full success.
58. As a user, I want the built-in image server hidden from the MCP settings list, so that I cannot accidentally disable or misconfigure a capability the app manages itself.
59. As a user, I want sessions that disable MCP to not be offered image tools, so that the meaning of that switch stays consistent.
60. As a user, I want all new text in my language, so that the feature is consistent with the rest of the app.
61. As a user on a dark theme, I want the provider and model dropdowns to be readable when expanded, so that I can actually pick an option.
62. As a user, I want the skill's declared tool names and protocol expectations pinned by tests, so that a renderer or tool change cannot leave the model reading stale instructions.

## Implementation Decisions

### 1. 三条链路解耦

发现、执行、配置三条链路各自独立成立：技能只是说明，不含凭证也不含运行时；MCP 服务器只是执行面，不决定模型能看到什么用法；配置只是数据，不被技能正文引用。任何一条改动能单独验证，不需要另两条同时到位。

技能遵循 ADR 0016 的单份正文双 Target 模型：一份内置技能种入中心库、来源标记为 bundled，同时装到两个引擎的技能目录，默认 link、失败按既有策略退 copy。删除中心库技能会同时撤销两个 Target。**不写引擎扩展、不维护第二份提示。**

### 2. 供应商方言与预设

供应商侧是三种方言，不是三种配置：

| 方言 | 文生图 | 改图 | 批量 | 返回形态 | 错误位置 |
| --- | --- | --- | --- | --- | --- |
| `openai` | JSON generations | multipart edits | 原生张数参数 | base64 或短期 url | HTTP 状态码 |
| `seedream` | JSON generations | **同一 generations 端点**，参考图以 data URL 数组传入 | 顺序生成开关，不保证张数 | url（24h）或 base64 | **HTTP 200 内的逐图 error 字段** |
| `zhipu` | JSON generations | **无改图端点** | **无批量，返回数组恒为 1** | 仅 url（30 天） | HTTP 状态码 |

预设四项：OpenAI、智谱、火山方舟、自定义。预设填 base URL 与一个默认模型，**模型名始终可编辑**。火山方舟预设使用 seedream 方言而非 openai 方言——这是它与「OpenAI 兼容」宣传语的实际差异所在。

去水印开关默认**关闭**。智谱要求签署声明后才允许去水印，默认开启会让未签署账号直接报错。

**张数由客户端扇出，不使用供应商原生批量参数。** 每次物理请求只要一张：seedream 的顺序生成不保证张数，zhipu 根本没有批量。扇出也让每张图有独立的成功/失败/取消归属。

### 3. 工具契约

三个工具，契约对模型稳定，方言差异不外泄：

- **文生图**：prompt 必填；张数 1–4，默认 1；可选尺寸与文件名提示。
- **改图**：prompt 必填；参考图路径 1–4 张，必填；张数与尺寸同上。
- **批量生图**：prompt 数组 1–8 条，必填；尺寸与文件名提示同上。

扇出与批量共享同一个并发上限 **2**。超限请求**拒绝并说明上限，不截断**。结果按输入顺序返回，不按完成顺序。

**部分失败口径**：任一张成功即为成功，附逐图报告；全部失败才返回工具错误。逐图状态是 `succeeded | failed | cancelled` 三态，`cancelled` 不得被折叠进 `failed`。请求与供应商链路的失败项带稳定的错误码前缀，便于卡片与技能识别；本地落盘失败直接报系统错误，不伪装成供应商错误。

成功文本携带绝对路径、尺寸、实际使用的模型名；**绝不携带 base64**。

未配置 key 时工具**照常暴露**，调用返回工具错误并指向设置分区。「不注入」被否决：那样模型只会说「我没有生图能力」，用户永远看不到真正的原因。

### 4. 宿主授权闸门

**每一次生图调用在发出第一个出站请求之前必须取得宿主授权。** 这是一条计费的网络出口，不能因为「工具是内置的」就免检。

**与引擎无关。** 引擎的 `can_use_tool` 权限管线只有 Claude Code 实现，Pi 走的是另一套；把闸门挂在那条链上等于只保护一半用户。因此闸门由宿主自持。

**复用既有的宿主问答通道**，不新建卡片、不新建 IPC 通道：宿主自铸一个对话框 id，以 select 形态问出来，标题与正文写清供应商、模型、张数、prompt 摘要与计费提示，选项为「允许一次 / 本会话总是允许 / 拒绝」。这条通道本来就带 id 应答、超时看门狗、进程丢失清理与时间线锚点，正是闸门需要的全部语义。

**应答路由**：统一网关在把应答交给引擎之前，先按对话框 id 查宿主授权登记表；命中就地兑现，未命中按原样交给引擎。这是本特性唯一新增的判定点。

**模式口径**：读**用户选定的**每会话权限模式（ADR 0012），不是引擎当前模式。完全信任模式自动放行并留痕；其余模式问。「本会话总是允许」只作用于该会话，不写全局配置、不跨应用重启。

**看门狗**：沿用既有宿主对话框看门狗时长。到点无人应答即**拒绝**（fail closed），并按既有「长时间无人应答」口径关卡。绝不无限期挂住这次 MCP 调用。

**拒绝**：返回工具错误，不发 HTTP、不落文件。

授权对话框的标题与选项签名必须与 plan-mode 问卷的配对规则不相交，否则会被那张卡抢走消费。

### 5. 取消与在途工作

主进程按会话登记在途生图工作，每次调用自持一个中止控制器，扇出与批量的子请求继承同一信号。

**取消入口收敛在统一网关**：中止、停止、挂起三个动作都先取消该会话的在途生图工作，再走引擎原有语义。三个适配器（Electron / H5 / IM）的派发全部委托到网关，因此这一处即覆盖全部端。会话进程退出与 MCP 服务器停止（应用退出序列）同样触发取消。

**语义**：中止在途 HTTP、丢弃尚未开始的排队项；**已落盘的文件保留**；逐图状态标为 `cancelled`。全被取消时返回取消结果，不冒充通用失败。

**不自动重试**——取消、超时、失败都不重试，供应商可能已经计费。技能正文必须写明这一点，并且必须写明**中止本地请求不能保证供应商停止计费**。

**鉴权失败快速止血**：401/403 立即取消剩余排队项并标为鉴权失败，与用户取消共用同一套中止机制、不同的原因。

### 6. 不受信响应与越界输入防护

供应商响应与它给出的 URL 一律按不受信输入处理：

- **响应体有界**：JSON 与图片字节都设上限，先看 content-length 再在流上兜底，超限即中止读取。
- **base64 先量长度再解码**：长度上界先行拒绝，格式校验不使用会在多兆字符串上递归爆栈的重复分组正则。
- **图片按签名校验**：PNG 校验完整魔数与首个块标识，JPEG 校验起始与结束标记，WebP 校验 RIFF 容器标识。**不接受 GIF**。改图的输入图同样按签名校验，不看扩展名。
- **输入路径先 realpath 再判归属**：仅做路径规范化会让符号链接逃出工作区。
- **下载 URL 校验**：拒绝非 http(s)、拒绝 URL 内嵌凭证、拒绝重定向、解析后钉定已校验的地址再连；始终拒绝云元数据地址。下载请求**不携带供应商凭证头**。
- **单图与多图的 multipart 字段名不同**：一张用一个字段名，多张用数组字段名。恒用数组名会让部分端点拒收单图改图。

### 7. 回环 MCP 外壳

外壳从既有内置 MCP 服务器抽出为可参数化的通用件，两个服务器共用：回环随机端口、Streamable HTTP、无状态（不签发会话 id、不做服务端推送）。三道闸：每轮启动生成的 Bearer token（定长比较，先比长度）、Host 白名单（防 DNS rebinding）、请求体上限。不发 CORS 头。协议版本协商，容忍 JSON-RPC 批处理。超限时暂停读取而非直接销毁连接，以便把错误状态码发回去。

服务器起不来时注入 `null` 条目——**不把不可达地址交给引擎**。禁用 MCP 的会话不注入。内置服务器不出现在 MCP 设置列表里。

### 8. 产物与展示

产物写入工作区的生图输出目录。该目录已被产物服务扫描且不做扩展名过滤，因此图片自动进入产物面板。

文件名由提示 sanitize 后生成，冲突追加版本后缀，**绝不覆盖**。

专属工具卡片按**完整 MCP 工具名**注册——工具组件表是精确名匹配，没有前缀归一化，裸名注册不会命中。卡片渲染缩略图、支持放大与打开所在文件夹。本地图片必须转成 data URL 内联：渲染层 CSP 的 img-src 不含 `file:`。

「打开所在文件夹」需要一个目前不存在的 shell 能力包装，与既有的「打开外部链接」并列，H5 下降级为不可用而非报错。

### 9. 技能正文的两条产品约束

技能必须明确禁止两件事，两者都是实测过的坏行为：

- **不得把结果路径再以 Markdown 图片形式贴一遍**——卡片已经渲染了图片，重复贴等于每张图显示两次。
- **不得声称自己看过某张图**，如果它只拿到了路径。

同时必须写明：可能计费、不自动重试、改图失败不得偷偷换成重新生成、超出上限的大集合要拆成有界批次。

### 10. 配置落点与国际化

配置类型与预设表放在 main/renderer 共享层，不放在会顶层引入主进程依赖的模块里——渲染层导入后者会把主进程依赖拖进浏览器 bundle。

设置项按既有 settings store 的六点式接线（类型、ref、保存、应用、action、导出）成对补齐。**key 字段是只写的**：用户能填入并保存，回读只给「是否已配置」，不回明文——这是「不回给渲染端明文」在设置面上的可执行含义。

所有用户可见文案成对进入 zh-CN / en-US 对应域模块。新增的原生下拉复用全局主题规则，不写硬编码浅色选项背景。

**不改动工具注册表**：那份表只喂设置里的工具开关列表与默认工具配置，而 MCP 工具是按会话注入的、不受那份白名单管辖。往里加三条只会造出三个点了没反应的开关。

## Testing Decisions

**好测试的标准.** 只断言外部可观察行为：给定配置与请求，客户端发出了什么 HTTP 请求、返回了什么逐图结果；给定响应字节与磁盘状态，落下了什么文件、报了什么错误码；给定授权应答或超时，工具是发了请求还是没发；给定取消信号，哪些项被中止、哪些文件存活。不断言私有方法、内部字段或日志文本。

**已确认的测试缝（只新增一条）.**

唯一新增的缝是**参数化后的回环 MCP 外壳工厂**：把既有内置服务器里那段与业务无关的 HTTP/鉴权/协议外壳抽成可注入工具表的工厂函数。其余全部挂既有缝：

1. **回环外壳**：用真实 MCP SDK 客户端做握手与调用，覆盖 token 错误、Host 不在白名单、超限请求体、协议版本协商、批处理、停止时连接回收。
2. **方言客户端**：注入 fetch 替身，按脚本回三种方言的响应形态，断言请求 URL/字段/体与逐图结果。覆盖 HTTP 200 内的逐图 error、只回 url、只回 base64、鉴权失败止血、超限拒绝、响应体超限、签名不符、下载重定向与内嵌凭证拒绝。
3. **工具分发面**：注入客户端与文件系统，覆盖张数/批量上限拒绝而非截断、输入顺序、并发上限、部分失败即成功、全失败即错误、路径越界（含符号链接）、文件名冲突版本化、未配 key 的可诊断错误、改图能力拒绝。
4. **宿主授权登记表 + 网关应答路由**：覆盖问出来→允许→发请求、拒绝→不发请求、本会话总是允许→第二次不再问、完全信任→不问、看门狗到点→拒绝且关卡、取消→关卡且工具返回取消、非宿主 id 仍原样交给引擎。
5. **会话注入**：沿用既有的启动参数与 MCP 配置投影测试缝，断言两个引擎都拿到条目、服务器未监听时为 null、禁用 MCP 时不注入、内置服务器不出现在用户可见列表。
6. **技能播种与漂移**：沿用既有技能服务 bootstrap 缝与产物漂移测试，断言两个 Target 都可见、技能引用的工具名集合与工具定义完全一致、禁止字符串不出现。
7. **配置与设置 store**：沿用既有 Pinia + 注入 api 的写法，覆盖预设切换、模型名可编辑、持久化往返、默认值。
8. **组件**：卡片 mount 断言缩略图渲染、放大、打开文件夹调用、data URL 内联；设置分区断言可见性与禁用态。授权对话框复用既有卡片，只补「不被 plan-mode 配对抢走」的判定测试。

**不进 CI 的部分.** 真实供应商调用（计费）、真实图片质量。前者由仓库外的手动冒烟覆盖，后者人工验收。

**先例.** 回环外壳测试参考既有内置 MCP 服务器的鉴权/超限测试；方言客户端参考既有第三方 HTTP 客户端的「注入 fetch、断言失败不留下半成品」写法；技能漂移参考生成式 UI 技能的产物测试；设置 store 参考语音输入自定义地址那一项的六点式接线测试；工具卡片参考既有工具卡片的 mount 测试与 contenteditable/jsdom 补丁方式。

## Out of Scope

- 透明背景 / 抠色（chroma-key）、mask 局部重绘。
- 阿里云万相的异步任务式接口（提交—轮询模型与本期的同步契约不同构）。
- 生图配置与 Profile 联动。
- 供应商原生批量参数（张数一律客户端扇出）。
- 既有浏览器工具裸名注册键不匹配的问题（独立缺陷，不在本期顺手改）。
- 图片质量评估、自动挑图、自动重试。
- 把供应商返回的 url 直接交给渲染层加载（一律主进程下载后落盘）。
- 生图历史的独立管理界面（产物面板已覆盖）。
- 非桌面端（H5 / 移动 / IM 桥接）的生图入口渲染。

## Further Notes

- 术语以 `CONTEXT.md` 的 Image Generation 一节为准：Image Model、Dialect、Image Binding、Variant、Batch、Image Artifact、Authorization Gate。
- 本期口径参考了另一个开源桌面实现（PI-Desktop）的同类能力，采纳其七项硬化与两条技能约束；其「宿主只做授权、实际请求由本地服务发出」的分层是授权闸门的直接依据。差异在于本项目要同时覆盖两个引擎，因此闸门不能挂在任一引擎的权限管线上。
- 引擎侧 MCP 工具调用的默认超时极长（约 27.8 小时），因此授权卡不会被引擎提前判超时；但宿主仍必须自持看门狗，否则无人值守会话会永久占住一条连接。
- MCP 调用帧**不携带工具调用 id**（引擎的可选 meta 参数在调用点未被填充）。这是授权闸门不能按工具调用 id 挂到权限卡上的根本原因，也是选择宿主自铸对话框 id 的依据。
- 权限卡表按工具调用 id 索引，是 Claude 权限链路的承重墙；宿主问答表按对话框 id 索引、时间线上不需要对应工具条目。两者不可混用。
- 实施计划中的两处偏离已核实并保留：不动工具注册表；配置类型与预设表放共享层。
- 人工验收必须包含：两个引擎都跑通、暗色主题下**真正展开**两个原生下拉、未配 key 的可见失败、改图在智谱下明确拒绝且不偷偷产新图、授权拒绝后无文件产生、停止后在途请求确实中止且已完成的图保留。