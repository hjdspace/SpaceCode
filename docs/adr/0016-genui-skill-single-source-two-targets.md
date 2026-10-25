# 生成式 UI 技能以单份 SKILL.md 同时分发到 Claude 与 Pi

## Status

Accepted（2026-10-25）。术语见根目录 `CONTEXT.md` 的 Generative UI 与 Agent Registry 两节。

## Context

卡片生成需要三样东西：Card Schema 协议、物料用法、输出契约。这是**按需加载的说明**，不需要运行时工具。

两个引擎都已经原生支持 Skill，并且在自定义 system prompt 下仍然可见：

- Claude：技能目录 `${CLAUDE_CONFIG_DIR || ~/.claude}/skills`。清单由 `skill_listing` 附件注入，正文由 `Skill` 工具在被调用时读取（`engine/src/utils/attachments.ts`）。
- Pi 1.3.0：技能目录 `${PI_CODING_AGENT_DIR || ~/.pi/agent}/skills` 与项目 `.pi/skills`；`<skills>` 段即使传了 `--system-prompt` 也会追加（`dist/core/system-prompt.js`）。`~/.pi/agents` 是**子代理定义**目录，不是技能目录。
- Pi 还会读共享的 `~/.agents/skills`，但那是 registry 里的 `agents` 伪条目，不是某个引擎的专用位置。

同时，Skill Manager 的 Target/Claim 模型已经能表达「一份技能装到多个 Agent」。

## Decision

1. **只维护一份 `genui-card/SKILL.md`**，放中心库，`bootstrap()` 时 seed，来源标记为 `bundled`。
2. **同时建两个 Target**：`claude-code` → `${CLAUDE_CONFIG_DIR || ~/.claude}/skills`；`pi` → `${PI_CODING_AGENT_DIR || ~/.pi/agent}/skills`。默认 `link`，失败按既有 `linkFailPolicy` 退 `copy`。
3. **补齐 registry**：新增 `pi` 条目；Claude 的路径改为尊重 `CLAUDE_CONFIG_DIR`（当前硬编码 `~/.claude`）。
4. **技能正文构建期生成**：用 `genPrompt('Vue', miniMaterialsMeta, customActions, …)` 产出物料与协议说明，frontmatter 与输出契约手写。正文必须写明：只输出 ` ```schemaJson ` 围栏、动作白名单、不得请求网络或修改代码。
5. **不写 Pi 扩展、不注册 `render_ui` 工具、不维护第二份提示。** 两个引擎读同一份文本，差异只在安装目录。
6. **漂移由测试钉住**：技能引用的物料名单与协议版本必须与渲染端依赖一致；`genPrompt` 产物变化时测试失败。

## Consequences

- 技能是「按需加载」：不触发卡片生成的会话只付一行清单的 token，正文按需读取。
- 换引擎或新增 Agent 时只决定它的技能目录，不复制技能内容；删除中心库 Skill 会同时撤销两个 Target。
- 「只给 Pi 不给 Claude」通过 Target/Claim 粒度表达，不靠复制文件。
- frontmatter 必须取两者交集：Pi 要求 name 小写连字符且 ≤64、description 必填 ≤1024；Claude 更宽松。
- `link` 模式依赖 Agent 扫描器跟随符号链接。Pi 侧需在实现阶段实测；不成立就对该 Target 用 `copy` 并纳入 Diagnose，而不是给 Pi 单独维护一份文本。
- 技能正文与渲染端版本同批升级：物料升级而技能没升级时，模型会按旧物料写 schema。

## Alternatives considered

- **Pi 扩展提供 `render_ui` 工具**：需要额外提示与扩展加载条件（没加载就没能力），而 Pi 原生技能已经覆盖同一需求；已否决。
- **每个引擎各写一份 SKILL.md**：内容必然漂移，物料升级时容易只改一边。
- **只用 system prompt 常驻注入**：每个会话都付全文 token，且无法按需读取物料细节。
- **只装到 `~/.agents/skills` 共享**：Claude 不读该目录，仍要第二个 Target；还会让「谁装的」在未管理视图里变糊。
