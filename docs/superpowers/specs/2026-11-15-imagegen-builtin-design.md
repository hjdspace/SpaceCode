# 内置生图能力设计（imagegen）

日期：2026-11-15
状态：已批准（待实现）

## 背景与目标

用户希望在 SpaceCode 桌面端直接说「画张图」就能出图，且不需要安装任何东西。
目标拆成三件独立的事：

1. **免安装的能力发现** —— `imagegen` 作为内置技能随包分发，启动即种入两个引擎的技能目录。
2. **可被 Agent 调用的执行通道** —— 一个真实工具，而不是只有提示词。
3. **生图模型配置** —— 设置里新增一节，填一次 key 即可用。

现状约束：`genui-card` 是唯一已内置的技能，它是纯提示词技能（ADR-0016），
**技能本身不能生图**。所以必须有一条真实的工具通道，技能只负责「何时画、怎么写提示词」。

## 已确认决策

1. **供应商范围**：OpenAI 兼容协议 + 国内预置（智谱 CogView、火山方舟 Seedream）+ 自定义
   baseUrl/model。阿里百炼 wanx 是异步任务制，不在本期。
2. **调用通道**：**主进程内置 loopback HTTP MCP server**，按会话注入两个引擎。
   否决了独立 stdio 子进程方案 —— 理由见下节。
3. **产物与 UI**：落盘到工作区 `outputs/imagegen/`，注册专用工具卡片（缩略图 + 灯箱 + 打开所在文件夹）。
4. **本期能力**：文生图 + 改图 + 批量/多变体。
5. **未配 key 时的行为**：工具照常暴露，调用返回 `isError` + 可读引导，让 Agent 主动带用户去设置。
   否决「未配置就不注入」—— 那样用户说「画张图」时 Agent 只会回一段文字，失败不可见。
6. **Profile 归属**：生图配置独立于 Profile，全局一份。生图账号与对话模型账号是两套，
   跟着 Profile 切换会迫使重复填写。
7. **多变体实现**：统一客户端扇出 N 次请求，不使用供应商原生批量参数。理由见「方言与能力矩阵」。

### 为什么是主进程 HTTP 而不是 stdio 子进程

仓库里已经有一个同形态的先例：`electron/todo/todoMcpServer.ts`。它的文件头注释
（第 4–6 行）已经权衡过并否决了 stdio：

> 形态是 Streamable HTTP，监听 127.0.0.1 的随机端口：两个引擎都支持 `type: 'http'` 的
> MCP 条目……而 stdio 形态需要额外落一个可执行脚本并在打包里带上它，成本更高。

沿用这个形态，下列成本全部归零：

| stdio + preset 方案要做的 | 主进程 HTTP 的既有做法 |
| --- | --- |
| 新增 `BUILTIN_MCP_PRESETS` 条目，但 `src/stores/mcp.ts:219` 注入时是 `enabled: false`，还要另设自动启用策略 | 不是 preset，按会话注入，无开关问题，MCP 面板里也不会出现用户删不掉的幽灵条目 |
| 改 `mcpConfigResolver.ts` 的 `BuiltinMcpName` / `resolveBuiltinMcp` / `detectBuiltinFromConfig` / `builtinNameFromServerKey` | 一行不改 |
| 把 API key 在 spawn 时注进子进程 env | 主进程直接读配置，key 不出主进程 |
| 打包带独立 JS 脚本 + `ELECTRON_RUN_AS_NODE` | 代码在 `electron/` 里，vite 已打包，打包配置零改动 |
| 自行解析工作区路径 | URL 自带 `?root=<cwd>`，两个引擎的注入点已经把 `config.cwd` 传进去了 |
| 手写 JSON-RPC 或引入 `@modelcontextprotocol/sdk` | 手写那份已在跑，带 Bearer token + Host 白名单 + 体积上限，且有测试 |

两个引擎的注入点都是现成的：`electron/session/sessionProcess.ts:1581`（Claude）与
`electron/engine/engines/PiSessionProcess.ts:1259`（Pi）。

## 方言与能力矩阵

**「OpenAI 兼容生图」不是一种协议，而是三种方言。** 这是本设计最重要的实现约束：
按单一协议写客户端，会让改图在智谱上静默失败、批量在智谱上只出 1 张。

| | 文生图 | 改图 | 原生批量 | 返回形态 |
| --- | --- | --- | --- | --- |
| **OpenAI** | `POST {base}/images/generations`，JSON | `POST {base}/images/edits`，**multipart**，`image[]` 文件数组 | `n`（1–10；dall-e-3 仅 1） | gpt-image 系 `b64_json`；dall-e 系 `url`（60 分钟） |
| **火山 Seedream** | `POST {base}/images/generations`，JSON | **同一个 generations 端点**，JSON 里 `images: string[]`（URL 或 `data:image/png;base64,…`，最多 14 张） | `sequential_image_generation:'auto'` + `sequential_image_generation_options.max_images`（1–15） | `url`（24 小时）或 `b64_json`，由 `response_format` 决定 |
| **智谱 CogView** | `POST {base}/images/generations`，JSON | **不支持**（无 edits 端点） | **不支持**（无 `n`，`data[]` 恒 1 张） | 只有 `url`（30 天） |

已核实的字段细节：

- 智谱：`model` 枚举 `glm-image` / `cogview-4-250304` / `cogview-4` / `cogview-3-flash`；
  请求字段 `prompt` / `quality`(`hd`|`standard`) / `size` / `watermark_enabled`；
  响应 `{ created, data: [{ url }], content_filter }`。base URL `https://open.bigmodel.cn/api/paas/v4`。
- Seedream：请求字段 `prompt` / `images` / `size`（`2K`/`4K` 或 `WxH`）/ `response_format` / `watermark`；
  响应 `{ model, created, data: [{ url | b64_json, size, error? }], usage }`。
  **`data[]` 里可能逐图带 `error`**，必须逐项检查而不是只看 HTTP 200。
  base URL `https://ark.cn-beijing.volces.com/api/v3`。
- OpenAI：edits 的 `image` 是文件或文件数组（gpt-image-1 支持多图，PNG/WEBP/JPG，单张 < 25MB），
  `mask` 可选；`size` 取 `1024x1024` / `1536x1024` / `1024x1536` / `auto`。
  base URL `https://api.openai.com/v1`。

**决策 7 的理由**：Seedream 的 `auto` 由模型自行决定张数，不保证等于请求的 N；
智谱根本没有批量参数。统一扇出 N 次请求得到确定的张数和一条代码路径，
代价是 N 次调用（N ≤ 4，可接受）。原生批量参数本期不使用。

**能力缺失的处理**：`edit_image` 在 `dialect === 'zhipu'` 时直接返回 `isError`，
文案点名「当前供应商不支持改图，请在设置里切换到 OpenAI 或火山方舟」。
绝不降级成文生图 —— 那会产出一张与用户意图无关的图，且用户以为改图成功了。

## 架构

三条互不依赖的链路：

| 链路 | 机制 | 用户要做什么 |
| --- | --- | --- |
| 发现 | bundled skill `imagegen`，随包分发、启动自动种入 | 无 |
| 执行 | 主进程 loopback HTTP MCP `spacecode-imagegen`，按会话注入 | 无 |
| 配置 | 设置新增「生图模型」tab → `gui-settings.json` | 填一次 key |

技能正文里不出现任何 key，也不出现供应商凭证相关指令。

## 组件边界与文件清单

### 主进程新增 `electron/imagegen/`

分层镜像 `electron/todo/`：

- **`imageGenConfig.ts`** —— 读 `gui-settings.json` 的 `imageGenConfig`，归一化 + 预置解析。
  导出纯函数 `normalizeImageGenConfig(raw: unknown): ImageGenConfig | null`（无 IO，可直接测）；
  IO 只在 `loadImageGenConfig()` 一层。
- **`imageGenClient.ts`** —— **纯 HTTP 客户端，零 fs、零 electron**。
  `generateImages(config, request, fetchImpl): Promise<ImageGenOutcome>`。
  内含方言层：端点选择、改图机制、请求体构造、响应解析。这是最值得测的一块。
  **改图的图片字节由调用方传入**（`request.images?: { bytes: Buffer; mime: string }[]`），
  客户端只负责把字节编成 multipart 或 base64 data URL，绝不自己去读文件 ——
  否则「零 fs」这条边界就破了，测试也得挂真实文件系统。
- **`imageGenStore.ts`** —— 落盘。`saveImage(root, bytes, nameHint, index): Promise<string>`
  写入 `<root>/outputs/imagegen/`，返回绝对路径。
  **扩展名由字节头判定，不写死 `.png`**：Seedream 默认返回 jpeg，OpenAI 返回 png，
  写死扩展名会产出一个扩展名与实际格式不符的文件。
- **`imageGenTools.ts`** —— 三个工具的定义 + dispatch，形态照 `electron/todo/todoMcpTools.ts`
  （`McpToolDefinition` / `McpToolResult` / `isError`）。
- **`imageGenMcpServer.ts`** —— HTTP/JSON-RPC 外壳 + 单例 + `getImageGenMcpEntry(sessionId, root)`。
  外壳照抄 `todoMcpServer.ts`：同样的协议版本协商、Bearer 定时安全比较、Host 白名单、
  1MB 体积上限、无会话状态、`start/stop/entry` 三件套。

**关键缝**：工具层接收 `config` 与 `fetchImpl` 作为参数，不自己读文件、不自己发请求。
这样测试能真的 import 被测模块（ADR-0011），而不是手抄一份实现进测试。

### 共享

- **`src/shared/imageGenReference.ts`** —— `IMAGEGEN_MCP_SERVER_KEY = 'spacecode-imagegen'`、
  `IMAGEGEN_TOOL_PREFIX`、三个工具全名常量。主/渲染共用，照 `src/shared/todoReference.ts:15`。

### 渲染

- **`src/components/settings/ImageGenSettings.vue`** —— 自持久化 tab，照
  `VoiceInputSettings.vue` 的模式（组件自己调 store action 保存，不走 `v-model` + `@change`）。
- **`src/components/settings/SettingsPanel.vue`** —— 三处接线，漏一处就是「组件写了但进不去」：
  `asyncSetting()` 异步组件声明（第 142–159 行区块）、`settingMenuItems` 加菜单项
  （第 165–177 行，放在 `browser-use` 之后）、KeepAlive 里加 `v-else-if="activeTab === 'image-gen'"`
  挂载点（第 58–115 行）。
- **`src/components/chat/tools/ImageGenToolCard.vue`** —— 缩略图网格 + 灯箱 + 「打开所在文件夹」。
  取图走已有的 `api.readFileAsBase64`（`electron/preload/fs.ts:12`）转 data URL。
- **`src/components/chat/tools/index.ts`** —— 注册**工具全名**。该表是精确名字匹配、
  无任何前缀归一化（第 3 行起），而 MCP 工具到达时叫 `mcp__<key>__<tool>`，
  所以键必须是 `mcp__spacecode-imagegen__generate_image` 这样的全名。
- **`src/lib/tool-registry.ts`** —— 补 UI 元数据（`hasSpecialUI`、分类）。

### i18n

AGENTS.md 强制要求，两个 locale 同名域模块缺一不可（`tests/i18n/localeParity.test.ts` 会红）：

- 新增 `src/i18n/locales/zh-CN/imageGen.ts` 与 `src/i18n/locales/en-US/imageGen.ts`
- 两侧 `index.ts` 聚合注册
- `settings` 域补菜单标题键 `settings.imageGen`（zh-CN / en-US 各一处）

覆盖范围：设置页全部标签与提示、水印开关的免责声明前提、工具卡片的按钮与失败态、
未配置引导文案。工具返回给 Agent 的文本是模型可读内容，不走 i18n。

### 资源与内置技能

- **`resources/builtin-skills/imagegen/SKILL.md`** + 精简后的 `references/prompting.md`、
  `references/sample-prompts.md`。
- **`electron/skillManagerV2/bundledSkills.ts`** —— `BUNDLED_SKILLS` 追加
  `{ skillId: 'imagegen', targetAgentIds: ['claude-code', 'pi'] }`。
  种入、版本哈希重写、用户删除后尊重删除直到版本变化，全部由既有 `seedBundledSkills()` 承担，
  不需要新逻辑。

技能正文相对来源技能的改写：删掉全部 Codex 专属内容（`$CODEX_HOME` 路径、内置 `image_gen` 工具、
CLI fallback、`gpt-image-1.5` 降级规则、chroma-key 透明背景流程）；保留意图判定
（generate vs edit）、提示词 schema、用例分类、改图不变量、非破坏性命名、报告落盘路径。
新增：三个工具的全名与 ToolSearch 加载写法、能力矩阵缺失时的话术。

### 设置存储改动点

`src/stores/settings.ts` —— 少改一处就会静默不保存：

1. `ImageGenConfig` 接口 + `AuthSettings.imageGenConfig?: ImageGenConfig`（第 65–100 行区块）
2. `const imageGenConfig = ref<ImageGenConfig | null>(null)`
3. `saveSettings()` 的 `data` 对象（第 549–574 行）加字段
4. `applySettings()`（第 864–888 行）加 `if (settings.imageGenConfig !== undefined) …`
5. 新增 action `setImageGenConfig(config): Promise<{ success: boolean; error?: string }>`
6. store return 块导出字段与 action

**不动** `updateFromSettingsPanel()` —— 独立 action 保存，与 `voiceInputCustomUrl` 同口径
（该字段也不在 `updateFromSettingsPanel` 里）。

### 生命周期接线

`electron/main.ts:282` 附近（`registerTodoIPCHandlers()` 之后）启动服务器，
并在 `before-quit` 收口，照 `electron/todo/todoService.ts:364-368` 的写法：
起不来只是这一轮没有生图工具，不阻塞启动。

## 配置模型

```ts
export type ImageGenDialect = 'openai' | 'seedream' | 'zhipu'

export interface ImageGenConfig {
  presetId: 'openai' | 'zhipu' | 'ark' | 'custom'
  /** 客户端实际使用的协议方言；预置时锁定，custom 时由用户选。 */
  dialect: ImageGenDialect
  baseUrl: string
  apiKey: string
  model: string
  /** 关闭供应商水印。默认 false = 不发送该字段，用供应商默认。 */
  disableWatermark: boolean
}
```

预置表（`presetId` → `dialect` / `baseUrl` / 默认 `model`）：

| presetId | dialect | baseUrl | 默认 model |
| --- | --- | --- | --- |
| `openai` | `openai` | `https://api.openai.com/v1` | `gpt-image-1` |
| `zhipu` | `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | `cogview-4` |
| `ark` | `seedream` | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seedream-4-0-250828` |
| `custom` | 用户选 | 用户填 | 用户填 |

模型名一律可编辑：供应商随时上新版本，预置值只是起点，不是约束。

`disableWatermark` 为 true 时发送 `watermark: false`（seedream）/ `watermark_enabled: false`（智谱）；
OpenAI 无此参数，忽略。**默认 false 是刻意的**：智谱关闭水印要求账号已签署免责声明，
默认就发 false 会让未签署的账号直接报错。设置页在该开关旁注明这一前提。

### 设置页字段

预置下拉、协议方言下拉（仅 `custom` 可选）、Base URL、API Key（密码框 + 显示切换）、
模型名、关闭水印开关、保存按钮 + 保存状态（saved / failed，照 VoiceInputSettings）。

两个 `<select>` 必须遵守 AGENTS.md 的原生控件主题规则：复用 `src/styles/global.scss` 的
`color-scheme` 与 `option` 主题变量，不写硬编码浅色背景。验证要在暗色主题下**真正展开弹层**确认。

## 工具契约

三个工具，前缀 `mcp__spacecode-imagegen__`。

### `generate_image`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | 是 | 图像描述 |
| `n` | integer 1–4 | 否，默认 1 | 同一提示词的变体张数，客户端扇出 |
| `size` | string | 否 | 省略则用供应商默认，不自行编造 |
| `nameHint` | string | 否 | 文件名主干，净化后使用 |

### `edit_image`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | 是 | 改动描述，应包含不变量 |
| `imagePaths` | string[] 1–4 | 是 | 工作区内的绝对或相对路径 |
| `n` | integer 1–4 | 否，默认 1 | 变体张数 |
| `size` | string | 否 | 同上 |
| `nameHint` | string | 否 | 同上 |

`dialect === 'zhipu'` 时直接 `isError`（见能力矩阵）。

### `generate_batch`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompts` | string[] 1–8 | 是 | 每项一个独立资产，不是同一提示词的变体 |
| `size` | string | 否 | 同上 |
| `nameHint` | string | 否 | 作为文件名前缀 |

并发上限 2（与 `generate_image` 的 `n` 扇出共用同一个上限）。逐项报告成功/失败，
不因单项失败丢掉其余结果。

### 返回

成功：`content: [{ type: 'text', text }]`，文本含每张图的**绝对路径**、尺寸、实际模型名。
不回传 base64（会撑爆上下文），卡片自己去读文件。

失败：`{ content: [{ type: 'text', text: 原因 }], isError: true }`。

**部分失败的口径**（`n > 1` 与 `generate_batch` 共用）：只要有一张成功就返回成功，
文本里逐项列出成功路径与失败原因；全部失败才 `isError`。
理由与 `generate_batch` 的逐项报告一致 —— 因为第 3 张失败就丢掉前 2 张已落盘的图，
会让用户以为整次调用白费。

## 数据流

```
用户「画张图」
  → 引擎自发现 imagegen 技能（宿主不注入技能正文）
  → 技能正文指名 mcp__spacecode-imagegen__generate_image（含 ToolSearch 加载写法）
  → POST http://127.0.0.1:<port>/mcp/<sessionId>?root=<cwd>   [Authorization: Bearer <token>]
  → 主进程 loadImageGenConfig() → imageGenClient 按 dialect 发请求
  → 拿到 url 则下载字节，拿到 b64_json 则解码
  → saveImage() 按字节头定扩展名，落盘 <cwd>/outputs/imagegen/<name>.<png|jpg|webp>
  → 返回文本：绝对路径 + 尺寸 + 模型
  → ImageGenToolCard 用 api.readFileAsBase64 → data URL 缩略图
  → artifactsService 已在扫 outputs/ → 产物面板自动出现
```

两处已被现有代码保证、不需要新机制的事实：

- **CSP 禁 `file:`**（`index.html:6` 的 `img-src 'self' data: http: https: blob:`），
  所以本地图片必须内联成 data URL。`MarkdownRenderer.vue` 的 `resolveLocalImages()` 已这么做。
- **`outputs/` 下的文件不受扩展名过滤**（`electron/skills/artifactsService.ts:65` 的注释与
  `DELIVERABLE_EXTS` 只作用于工作区根目录扫描），所以 PNG 会自动进产物面板。

供应商返回的 URL 一律**立即下载落盘**：智谱 30 天、Seedream 24 小时、OpenAI 60 分钟，
把 URL 当产物交给用户等于交一个会过期的链接。

## 错误处理与安全

- **未配 key / 配置不完整** → `isError` + 「请在设置 → 生图模型里配置」，Agent 据此引导用户。
- **会话没有工作区**（URL 里没有 `root`，或 `root` 不是可用目录）→ `isError` +
  「请先打开一个工作区文件夹」。不猜一个落盘位置 —— 猜出来的图用户找不到，
  也进不了产物面板。
- **上游 4xx/5xx** → `isError` + 状态码 + 供应商 message。**不回显 key，不写进日志。**
- **逐图错误**（Seedream 的 `data[].error`）→ 该项计为失败并带上原因，其余项照常落盘。
- **URL 下载失败**（链接过期、网络中断、非 2xx）→ 该项计为失败并带上原因，
  不留一个 0 字节文件冒充产物。
- **响应形态不认识**（既无 `url` 也无 `b64_json`）→ `isError` 说明该供应商返回结构不支持，
  不静默产空图。
- **超时** → 固定 120s，不做成配置项。
- **服务器没起来** → `getImageGenMcpEntry()` 返回 `null`，这一轮不注入条目，
  不给引擎一个连不上的 URL 让它在握手阶段白等超时（照 todo 的语义）。
- **`disableMcp` 会话**（Super Agent Router）→ 不注入，与 todo 一致。
- **路径安全** → `imagePaths` 解析后必须落在 `root` 内，越界直接 `isError`；
  `nameHint` 净化掉路径分隔符与 `..`；输出文件名冲突时追加 `-v2`、`-v3`，**不覆盖既有文件**。
- **密钥** → 只在主进程内存；不落 `mcp-servers.json`、不进引擎子进程 env、不回给渲染端明文。
- **loopback 入口** → Bearer token（定时安全比较）+ Host 白名单（挡 DNS rebinding）+ 1MB 体积上限，
  不发 CORS 头。三道闸照抄 `todoMcpServer.ts`。

## 测试计划

主进程（`electron/imagegen/__tests__/`，文件首行 `// @vitest-environment node`）：

- `imageGenClient.test.ts` —— 注入 `fetchImpl`：三种 dialect 的端点与请求体、
  multipart vs JSON 改图、`url` 与 `b64_json` 两种响应、Seedream 逐图 error、
  上游错误码、未知响应形态。
- `imageGenTools.test.ts` —— 未配置、无工作区、参数校验（n 越界 / prompts 空 / imagePaths 越界）、
  智谱改图拒绝、落盘命名不覆盖、字节头定扩展名（png / jpeg 两种输入）、
  部分失败口径（一成功一失败 → 成功且逐项报告；全失败 → isError）。
- `imageGenMcpServer.test.ts` —— 照 `electron/todo/__tests__/todoMcpServer.test.ts`：
  token 校验、Host 白名单、体积上限、`initialize` / `ping` / `tools/list` / `tools/call`。
- `imageGenConfig.test.ts` —— `normalizeImageGenConfig` 的坏输入与预置解析。

接线与既有测试补充：

- `electron/session/__tests__/sessionProcess.buildArgs.test.ts` —— 注入断言 + `disableMcp` 不注入
  + 服务器未监听时不注入。
- `electron/engine/engines/__tests__/piSessionProcess.config.test.ts` —— 同上（Pi 投影）。
- `electron/skillManagerV2` 既有 bundled 测试 —— 补 `imagegen` 条目的种入与目标放置。
- **技能正文防漂移**（照 ADR-0016 决策 6 的口径）—— 断言
  `resources/builtin-skills/imagegen/SKILL.md` 里出现的工具全名集合，与
  `imageGenTools.ts` 实际定义的工具名集合一致。技能写错一个工具名，
  Agent 就会去调一个不存在的工具，而这种错在运行时只表现为「模型说它调了但没出图」。

渲染：

- `src/components/chat/tools/__tests__/ImageGenToolCard.test.ts` —— 路径 → data URL、
  读失败兜底、灯箱开关。
- `tests/i18n/localeParity.test.ts` —— 自动覆盖新增 `imageGen` 域，无需改测试。

收尾验证：`npm run test:changed` 然后 `npm run build`，两者都过才算完成。

## 范围外

- **透明背景 / chroma-key 抠图**：来源技能依赖 Python + pillow 脚本，不随包分发。
  本期不做，技能正文里也不承诺。
- **阿里百炼 wanx**：异步任务制（提交任务 → 轮询），与本期同步协议模型不同。
- **Profile 联动**：决策 6 已排除。
- **既有 `browser_use` 裸名键失配**：`TOOL_COMPONENT_MAP` 里那几个裸名键匹配不上
  `mcp__browser-use__*`，是既有问题，本次不动。
- **供应商原生批量参数**：决策 7 已排除。
- **mask 局部重绘**：OpenAI 的 `mask` 参数本期不暴露。

## 参考

- 智谱图像生成 API：<https://docs.bigmodel.cn/api-reference/模型-api/图像生成>
- Seedream 请求/响应字段表（含 `images` / `sequential_image_generation` / `response_format`）：
  <https://github.com/UCloudDoc-Team/modelverse/blob/master/api_doc/image_api/doubao-seedream.md>
- 火山方舟图片生成 API：<https://www.volcengine.com/docs/ark/image-generation-api>
- 火山方舟模型 ID `doubao-seedream-4-0-250828` 的两处独立佐证：
  <https://s.apifox.cn/apidoc/docs-site/5473751/365898983e0>、
  <https://github.com/nsmao-com/seedream-mcp>
- OpenAI 图像 API 字段与 multipart 改图契约：
  <https://github.com/QuantumNous/new-api-docs/blob/main/docs/en/api/openai-image.md>
- 先例实现：`electron/todo/todoMcpServer.ts`、`electron/todo/todoMcpTools.ts`
- 相关 ADR：`docs/adr/0001-skill-manager-v2-architecture.md`（中心库与 Target/Claim 分发）、
  `docs/adr/0016-genui-skill-single-source-two-targets.md`（单份 SKILL.md 同时分发到两个引擎；
  其 Context 明确「按需加载的说明，不需要运行时工具」，正是本设计必须另建工具通道的原因）、
  `docs/adr/0011-tests-must-cross-the-seam.md`（测试必须跨过缝）