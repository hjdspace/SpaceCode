# Pi agent 名单只列「本会话真的用得上」的定义

## Status

Accepted。落实 [issue #58](https://github.com/hjdspace/SpaceCode/issues/58) 的收口口径；沿用 [ADR 0004](0004-engine-gateway-deep-module.md) 的「名单与能力同源」原则。

## Context

Host 与 `@tintinweb/pi-subagents` 对「agent 从哪来」的扫描范围不同：

- Host 只扫项目的 `.pi/agents`、`.claude/agents` 与用户的 `$PI_CODING_AGENT_DIR/agents`（默认 `~/.pi/agent/agents`）、`~/.claude/agents`（`electron/engine/engines/agentDefinitions.ts` 的 `scanDirs`）。
- 扩展还扫项目的 `.agents/agents`、pi 包通过 `pi.subagents.agents` 声明的目录，并在代码里内置 `general-purpose` / `Explore` / `Plan`（`@tintinweb/pi-subagents` 的 `custom-agents.ts`、`default-agents.ts`）。

如果 host 把扩展能发现、但它自己注入不了的定义也列进下拉框，就会造出 #46 要消灭的形态：**看得见、点下去没反应**。反过来，host 列出的每个名字都必须是「选为本会话 agent 后真的能落到会话上」的定义。

## Decision

### 1. 名单范围维持窄口径

Host 只扫能同时满足「有 md 正文可注入」和「宿主能定位」的位置：

| 来源 | SpaceCode 下拉框/人设 | 扩展委派 |
| --- | --- | --- |
| 项目 `.pi/agents` | 是 | 是 |
| 用户 `$PI_CODING_AGENT_DIR/agents` | 是 | 是 |
| 项目/用户 `.claude/agents` | 是（Pi 会话只取正文当人设） | 否（扩展不读该目录） |
| 项目 `.agents/agents` | 否 | 是 |
| pi 包声明目录 | 否 | 是 |
| 扩展内置 `general-purpose`/`Explore`/`Plan` | 否 | 是 |

- `.agents/agents` 技术上可注入（就是一段 md 正文），不纳入是**产品口径**：跨工具共享目录不是 SpaceCode 的配置面。
- pi 包声明目录不纳入是**结构限制**：目录根由 pi 的包管理器从 `settings.json -> packages[]` 解析，宿主不复刻这套解析器。
- 扩展内置 agent 没有可注入的 md 正文。宿主若列出来，`findAgentDefinition` 必然返回 null，选中后只能报 `agentApplied = false`。
- 扩展只在会话选了 agent 时才加载，所以「扩展可委派」在 SpaceCode 里本身是有条件的。

以上三类保持「仅委派」，不为了名单完整硬塞进下拉框。将来若要在界面展示，正确的缝是让扩展提供「列出已发现 agent」的接口（当前 RPC 只有 ping/spawn/stop/consume），或由 companion extension 落缓存，而不是宿主侧抄一份包解析器。

### 2. pi 方言跟随扩展的加载规则

对 `.pi/agents` 与 `$PI_CODING_AGENT_DIR/agents`：

- `enabled: false`（仅 YAML 布尔；带引号的 `"false"`、`0/no/off` 都视为启用，与扩展的 `fm.enabled !== false` 一致）的定义不进入名单，也不能被 `findAgentDefinition` 注入人设。
- 禁用的定义仍**占用名字**：扩展的注册表先按优先级覆盖、再由派发侧拒绝；host 若直接跳过，低优先级的同名定义会顶上来，界面就会展示一个扩展明确拒绝的类型。
- `name:` 含 `:` 的定义不加载，与扩展保留 plugin 作用域标识符的规则一致。
- 解析前剥 UTF-8 BOM，与 pi 的 `parseFrontmatter` 对齐。

`.claude/agents` 不适用以上规则：Claude 不认 `enabled`，也不把冒号当作保留字符。它在 Pi 会话里只作为人设正文来源。

### 3. 名单每次打开选择器都重新读盘

`loadAgents` 不再按 `engineType|cwd` 缓存。扫描成本只是几个目录的 `readdir/readFile`，不值得为它保留一层会过期的缓存；运行中新增、删除、禁用定义应在下一次打开菜单时立刻可见。保留在途去重，避免同一瞬间的多次打开各打一遍 IPC。

## Consequences

- `.pi/agents` 里 `enabled: false` 的文件从下拉框消失，也不会再被注入人设；已指向该名字的会话下一次启动会收到 `agentApplied = false` 与既有提示，而不是静默按旧定义运行。
- 运行中修改 agent 定义不再需要重启应用或切换工作区。
- `.claude/agents` 的 `enabled: false` 仍会被列出；这是 Claude 方言的既定语义，不是遗漏。
- 只把 agent 放在 `.agents/agents` 或 pi 包里的用户，在 SpaceCode 下拉框里仍看不到它，也不会收到「不支持」提示。这是明确接受的边界；扩展内置 agent 同理。
- 同一个名字在 `.pi/agents` 被禁用后，低优先级的同名定义（包括 `.claude/agents`）不会顶替它。用户若想保留 `.claude` 人设，应换一个不冲突的名字，或在 `.pi` 侧删除禁用文件。

## Alternatives considered

- **扩大名单到 `.agents/agents`**：技术上可行，但下拉框会依赖第三方扩展的目录约定，并扩大与 `.claude/agents` 的同名冲突面；已由 #58 否决。
- **宿主复刻 pi 包解析器**：要跟住 npm/git/local 等多种包形态与 `settings.json` 的优先级，收益是把「仅委派」的东西列出来，不匹配成本。
- **在 host 硬编码三个内置 agent 的正文**：复制扩展内部实现，扩展升级即漂移，且违背「名单来自真实定义」。
- **保留名单缓存 + 手动刷新**：能省掉每次菜单打开的 IPC，但用户不知道要刷新；扫描成本远低于一次误判「修复无效」的代价。
