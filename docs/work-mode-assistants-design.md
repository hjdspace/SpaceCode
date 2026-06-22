# Work / Code 双模式 + 专业助手 — 实现设计文档（可直接落地版）

> 目标：左侧会话页面顶部加 `Work | Code` Tab。Code = 现有编码模式；Work = 复刻 AionUI 的"专业助手"（PPT/Word/Excel/论文/财务模型 等 ~20 个），助手具备**真实产物能力**（生成可编辑 `.pptx/.docx/.xlsx`），而非输出 Markdown 让用户自己排版。
>
> 本文档基于对 AionUI 真实源码（`D:\AI\AionUi`）的逐文件分析 + SpaceCode 现状核对编写，目标是**新开一个会话即可照此实现**。
>
> ## 已确认的产品决策
> 1. **默认工作目录** `~/Documents/SpaceCode`，但首次进入 Work 模式需**引导用户选择/确认 Work 目录**。
> 2. 模式开关用**顶部 Tab**（贴近 Claude Cowork 的 `Chat/Cowork/Code` 形态）。
> 3. **一次性实现全部助手**（下文完整 roster）。
> 4. **纳入 Artifacts 面板**（右侧 InfoPanel 新增产物 tab）。
>
> ## 技术路线（已确认）
> 办公文件生成走 **Node skills**：`pptxgenjs` / `docx` / `exceljs`，零外部运行时依赖、与 Electron 技术栈一致、打包简单。

---

## 0. 关键事实与边界（务必先读）

1. **AionUI 的助手"真定义"不在本仓库里。** `D:\AI\AionUi` 只是前端（Electron+React+TS）。内置助手的**系统提示词、技能绑定、推荐 prompt** 都在一个**独立的 Rust 后端仓库 `AionCore`**（`crates/aionui-app/assets/builtin-assistants/<id>/<id>.md`）里，前端通过 HTTP `/api/assistants` 拉取。本仓库只含：
   - ID 白名单：`packages/desktop/src/process/utils/migrateAssistants.ts`（20 个 builtin id）
   - 类型镜像：`packages/desktop/src/common/types/agent/assistantTypes.ts`
   - 其办公技能是后端的 `officecli-pptx / officecli-docx / officecli-xlsx / officecli-academic-paper / officecli-data-dashboard` 等，**脚本实现也在后端，拿不到**。

   **结论**：我们**复刻 roster（助手清单）+ 架构模式 + 交互**，但助手的角色设定与技能脚本由我们**自行用 SpaceCode 已有体系（agent .md + Node skill）重写**。这反而更干净——SpaceCode 自带 claude-code 式引擎（Bash + SkillTool），不需要 AionUI 那套 Rust 后端。

2. **AionUI 的 UI 与你的诉求有出入但不影响**：AionUI 实际没有顶部 `Chat/Cowork/Code` Tab——它的模式是 send box 里的 `AgentModeSelector` 下拉（per-conversation），助手选择在欢迎页 `guid` 的 pill bar。**你确认要顶部 Tab，所以我们按 Claude Cowork 的形态自行设计**（下文 §4.1）。

3. **SpaceCode 底座已具备所有原语**，本功能 ≈ 组装 + UI + 办公技能脚本，引擎/IPC 几乎不动。

---

## 1. AionUI 架构结论（已验证，作为参照）

`Assistant` 数据结构（`assistantTypes.ts`，与我们要建的模型一一对应）：

| 字段 | 含义 | SpaceCode 对应 |
|---|---|---|
| `id` / `source`(builtin\|user) | 标识 | agent `name` + 来源 |
| `name/description/avatar` (+`*_i18n`) | 展示 | frontmatter + i18n |
| `preset_agent_type` | 底层引擎 | 现有 `currentAgent` 通路 |
| `enabled_skills[]` | **真能力来源** | `.claude/skills` 注入 |
| `context` | 系统提示 | agent `.md` 正文 |
| `prompts[]` | 推荐起手 | frontmatter `recommendedPrompts` |
| `models` / `defaults`(model/permission/skills/mcps, fixed\|auto) | 默认 | frontmatter `model/permission` + startSession |

会话装配（`useGuidSend.ts` → `buildAgentConversationParams.ts`）传参：`{ type, model, assistant:{id, locale, conversation_overrides:{model,permission,skill_ids,mcp_ids}}, extra:{ workspace, custom_workspace, preset_assistant_id, enabled_skills, session_mode, ... } }`。

Artifacts（`pages/conversation/Messages/artifacts.tsx` + `Preview/PreviewPanel.tsx`）：初始 `listArtifacts` 拉取 + `artifactStream` WebSocket 增量推送，右侧 Preview 面板按 `content_type`（code/markdown/html/image/pdf）用不同 viewer 打开，带可关闭 tab。

办公文件库（`common/chat/document/DocumentConverter.ts`，**仅用于读取/编辑**，非技能产出）：`docx`、`xlsx-republish`、`mammoth`、`turndown`——印证 Node 路线可行。

**完整内置助手 roster（20 个，来自 `migrateAssistants.ts` 白名单）**：
`word-creator, word-form-creator, ppt-creator, excel-creator, morph-ppt, morph-ppt-3d, pitch-deck-creator, dashboard-creator, academic-paper, financial-model-creator, openclaw-setup, cowork, game-3d, ui-ux-pro-max, planning-with-files, human-3-coach, social-job-publisher, moltbook, beautiful-mermaid, story-roleplay`。

---

## 2. SpaceCode 现状（已核对，集成锚点）

| 能力 | 文件 / API |
|---|---|
| Agent 定义/扫描/安装 | `agents-lib/*.md`（64 个，frontmatter: name/description/tools/model）；`electron/agentsService.ts`（`agents:scanLibrary/install/...`，`parseYamlFrontMatter`，`inferCategory`） |
| Agent store / 分类 | `src/stores/agents.ts`（`AGENT_CATEGORIES`、`fetchLibrary`、`filteredAgents`） |
| 每会话 persona | `src/stores/chat.ts`：`currentAgent` ref（行~508）、`setCurrentAgent`（行~2458）→ `claudeCode.startSession({ cwd, model, permissionMode, agent, ... })`（行~744） |
| Agent 选择 UI | `src/components/chat/ChatInput.vue`（agent 菜单）+ `src/composables/useAgentSelector.ts`（`availableAgents` built-in/custom） |
| Skills 系统 | `electron/skillsService.ts`：`BUNDLED_SKILLS`（行 451）、`skills-lib/` 根（`process.resourcesPath/skills-lib`，行~401）、本地库 bundle 扫描/安装（`skills:scan-local-library`/`install-local-bundle`）；技能从 `<cwd>/.claude/skills`、`~/.claude/skills` 发现 |
| Skills UI | `src/components/skills/SkillsManager.vue` |
| MCP | `src/stores/mcp.ts` + `src/components/mcp/McpManager.vue` |
| 应用状态 | `src/stores/app.ts`：`ref()` 模式，`projectRoot`、`showSettings/showSkillsManager/showAgentManager/showMCPManager/showCronManager` |
| 主布局 | `src/App.vue`（center-panel 按 `showX` 标志切视图）；`src/components/layout/Sidebar.vue`（图标轨 + history/explorer/scm/terminal 面板） |
| 右侧面板 | `src/components/layout/InfoPanel.vue`（`InfoPanelTabBar` + mode: diff/file/markdown/tool-diff/terminal/webview） |
| 会话启动 | `claudeCode.startSession(sessionId, { cwd, apiKey, baseUrl, provider, model, effortLevel, permissionMode, agent, thinkingEnabled, engineType, ... })` |

**唯一空白**：无办公文档类 agent，无办公类 skill（现有 `.agents/skills` 全前端/设计向）。

---

## 3. 数据模型设计

### 3.1 模式状态（`src/stores/app.ts`）
```ts
const mode = ref<'work' | 'code'>(loadPersisted('mode', 'code'))
function setMode(m: 'work' | 'code') { mode.value = m; persist('mode', m) }
// Work 目录（首次需引导）
const workWorkspace = ref<string>(loadPersisted('workWorkspace', ''))
const workWorkspaceConfirmed = ref<boolean>(loadPersisted('workWorkspaceConfirmed', false))
// export: mode, setMode, workWorkspace, workWorkspaceConfirmed
```

### 3.2 Assistant = 扩展版 agent `.md`（向后兼容现有 64 个）
办公助手放 `agents-lib/work/<id>.md`，frontmatter 新增字段（旧 agent 无这些字段 → 缺省即旧行为）：
```yaml
---
name: ppt-creator
mode: work                       # work | code（缺省 code）
category: office                 # office | research | finance | design | creative | productivity
description: 生成可编辑的 .pptx 演示文稿
description_zh: 生成可编辑的 PPT 演示文稿
avatar: "📊"
model: sonnet
permission: acceptEdits          # 该助手默认权限模式
skills: [office-pptx]            # ★ 绑定的 skill 名（注入会话 .claude/skills）
mcps: []                         # 可选 MCP id
recommendedPrompts:
  - 把这份大纲做成 12 页商业路演 PPT
  - 根据这份 Word 文档生成同主题幻灯片
recommendedPrompts_zh:
  - 把这份大纲做成 12 页商业路演 PPT
---
（角色设定正文：身份、工作流程、调用技能的步骤、输出落点规范……）
```

`AgentDef`（`electron/agentsService.ts` 与 `src/stores/agents.ts` 同步扩展）新增：
```ts
mode?: 'work' | 'code'
avatar?: string
permission?: string
skills?: string[]
mcps?: string[]
recommendedPrompts?: string[]
```

### 3.3 会话扩展（`src/types` + `chat.ts`）
`Session` 增加 `mode?: 'work'|'code'`、`assistantId?: string`。旧会话无 `mode` → 视为 `code`。

---

## 4. UI 设计

### 4.1 顶部模式 Tab（新增 `src/components/layout/ModeTabs.vue`）
- 形态：history 面板顶部一行 Tab：`Work` `Code`（图标 + 文案），下方接当前内容。
- 切换 `appStore.setMode()`：
  - **Work**：会话列表过滤为 `mode==='work'`；`新建会话` 走 Work 装配流程；进入前若 `!workWorkspaceConfirmed` → 弹工作区引导（§4.2）。
  - **Code**：维持现状。
- 接入点：`src/components/layout/Sidebar.vue` history 面板（`<div v-show="activeTab==='history'">` 顶部、`chat-toolbar` 之上）。

### 4.2 Work 工作区引导（新增 `src/components/work/WorkspaceOnboarding.vue`）
- 首次切到 Work 或新建 Work 会话且未确认时弹出。
- 内容：说明 + 默认路径 `~/Documents/SpaceCode`（不存在则创建）+「选择其他文件夹」按钮（调用现有 `api` 的目录选择 IPC，参考 `useOpenProjectWorkflow`）。
- 确认后写 `workWorkspace` + `workWorkspaceConfirmed=true`。

### 4.3 Work 助手选择 + 空状态推荐 prompt
- **助手画廊**：复用 `AgentManager`/`AgentLibrary`，Work 模式下按 `mode==='work'` + `category` 展示办公助手卡（`AgentCard` 加 `avatar`）。
- **空状态**（新增 `src/components/chat/RecommendedPrompts.vue`）：当前会话选中助手且无消息时，渲染该助手 `recommendedPrompts` 为 chips，点击填入输入框（参考 AionUI `AssistantSelectionArea` 的 promptChip：`onSetInput(prompt)+onFocusInput()`）。
- **ChatInput**：Work 模式下 agent 菜单切换为办公助手集合。

### 4.4 Artifacts 面板（右侧 InfoPanel 新增 mode `artifacts`）
- `InfoPanelTabBar` 增 Artifacts tab；新增 `src/components/work/ArtifactsPanel.vue`。
- **产物发现（不依赖后端流，走文件监听）**：监听会话工作目录下 `outputs/`，列出 `.pptx/.docx/.xlsx/.pdf/.png` 等；提供「打开 / 在文件夹中显示」。
  - 主进程新增 watcher：`electron/` 加 `artifactsService.ts`，用 `fs.watch`/chokidar 监听 `<cwd>/outputs`，经 IPC `artifacts:list` + `artifacts:changed` 推送到渲染层（参考 AionUI listArtifacts + stream 的两段式）。
  - 打开文件用系统默认程序（`shell.openPath`），「在文件夹显示」用 `shell.showItemInFolder`。

---

## 5. 会话装配（核心，复用现有 startSession）

选中某 Work 助手并新建/进入会话时（`src/stores/chat.ts` 增 `startWorkAssistantSession(assistantId)`）：
1. 取该 assistant 的 `AgentDef`。
2. `cwd = appStore.workWorkspace`（确保存在；产物落 `<cwd>/outputs/`）。
3. **激活技能**：把 `assistant.skills` 对应的 skill 安装到 `<cwd>/.claude/skills/<name>/`（复用 `skills:install-local-bundle`；若已是 bundled 且引擎能从 home/cwd 发现则免装）。
4. `setCurrentAgent(assistant.name)`（persona 经现有通路下发）。
5. `currentPermissionMode = assistant.permission || 'acceptEdits'`；`config.model = assistant.model || 默认`。
6. `startSession(sessionId, { cwd, agent, model, permissionMode, ... })`（**签名已支持，无需改引擎**）。
7. `session.mode='work'`、`session.assistantId=assistant.id`，保存。

> 仅在 chat store 增加一个装配函数；引擎、IPC `startSession` 均不改。

---

## 6. Node 办公技能包设计（命门）

### 6.1 依赖与打包
- 根 `package.json` 新增依赖：`pptxgenjs`、`docx`、`exceljs`（生成）；可选 `mammoth`+`turndown`（读 docx）、`xlsx`（读 xlsx）。
- **模块解析**：技能脚本由 agent 经 Bash 跑 `node <script>`，需能 `require` 上述库。为避免打包后解析失败，**用 esbuild 在构建期把每个技能脚本 bundle 成自包含 `.cjs`**（无外部依赖），随 `skills-lib/` 一起 `asarUnpack` 分发。构建脚本加到 `engine/scripts/` 或根 `scripts/`。
- 这是阶段 3 唯一需要打磨的工程点（dev 直接 `node` 即可，packaged 走 unpacked 路径）。

### 6.2 技能包结构（统一放 `skills-lib/office/<id>/`）
```
skills-lib/office/pptx/
├── SKILL.md                 # name: office-pptx；指导 agent：先产出 slides JSON，再调脚本
├── scripts/build_pptx.cjs   # 读 JSON → pptxgenjs → 写 .pptx 到 outputs/
└── references/slide-schema.md
skills-lib/office/docx/  (office-docx, docx 库)
skills-lib/office/xlsx/  (office-xlsx, exceljs 库)
skills-lib/office/dashboard/ (office-dashboard, exceljs 图表)
skills-lib/office/mermaid/   (beautiful-mermaid，输出 .md/.svg)
```
- 同时把这些注册进 `BUNDLED_SKILLS`（`electron/skillsService.ts` 行 451 数组），让其在技能系统可见、可被会话发现。

### 6.3 SKILL.md 约定（以 pptx 为例，要点）
- `name: office-pptx`，`description: 生成可编辑 .pptx`。
- 正文指导 agent：
  1. 将内容组织为 `slides[]` JSON（schema 见 references）。
  2. 写入 `outputs/<name>.slides.json`。
  3. 运行 `node <SKILL_DIR>/scripts/build_pptx.cjs outputs/<name>.slides.json outputs/<name>.pptx`。
  4. 校验产物存在，向用户报告路径。
- `build_pptx.cjs` 用 `pptxgenjs`：`new pptxgen()` → 每个 slide `addSlide()` + `addText/addTable/addImage` → `pres.writeFile({ fileName })`。docx/xlsx 同构（`docx` 的 `Document/Packer`、`exceljs` 的 `Workbook/addWorksheet`）。

### 6.4 产物落点
统一 `<cwd>/outputs/`；Artifacts 面板监听此目录（§4.4）。

---

## 7. 完整助手清单与技能映射（一次性实现）

> 全部新建为 `agents-lib/work/<id>.md`。技能不存在的复用最接近的；纯 prompt 型助手 `skills: []`。

| # | id | 分类 | 绑定技能 | 真实产物 |
|---|---|---|---|---|
| 1 | word-creator | office | office-docx | .docx |
| 2 | word-form-creator | office | office-docx | .docx（表单/表格） |
| 3 | ppt-creator | office | office-pptx | .pptx |
| 4 | excel-creator | office | office-xlsx | .xlsx |
| 5 | pitch-deck-creator | office | office-pptx | .pptx（融资路演） |
| 6 | morph-ppt | office | office-pptx | .pptx（过渡/动画版式） |
| 7 | dashboard-creator | finance | office-dashboard | .xlsx（图表看板） |
| 8 | academic-paper | research | office-docx | .docx（含目录/引用） |
| 9 | financial-model-creator | finance | office-xlsx | .xlsx（财务模型） |
| 10 | beautiful-mermaid | productivity | beautiful-mermaid | .md/.svg 图 |
| 11 | planning-with-files | productivity | （复用文件工具） | .md 计划/产物 |
| 12 | cowork | productivity | 全部 office | 自主多步，混合产物 |
| 13 | ui-ux-pro-max | design | （复用现有设计 skills） | 设计稿/HTML |
| 14 | game-3d | creative | — | 代码/HTML |
| 15 | morph-ppt-3d | creative | office-pptx | .pptx |
| 16 | human-3-coach | productivity | — | 纯对话 |
| 17 | social-job-publisher | productivity | — | 文案/草稿 |
| 18 | moltbook | creative | office-docx | .docx |
| 19 | story-roleplay | creative | — | 纯对话 |
| 20 | openclaw-setup | productivity | — | 配置向导 |

> 优先级：先打通 **3/1/4（PPT/Word/Excel）** 的端到端闭环，其余助手 `.md` 一并创建（共享上述技能或纯 prompt）。

---

## 8. 涉及文件清单（精确到文件，可直接照建）

### 8.1 新增
| 文件 | 用途 |
|---|---|
| `agents-lib/work/*.md`（20 个） | 全部 Work 助手定义 |
| `skills-lib/office/{pptx,docx,xlsx,dashboard,mermaid}/SKILL.md` + `scripts/*.cjs` + `references/*.md` | Node 办公技能包 |
| `src/components/layout/ModeTabs.vue` | 顶部 Work/Code Tab |
| `src/components/work/WorkspaceOnboarding.vue` | Work 工作区引导 |
| `src/components/work/ArtifactsPanel.vue` | 产物面板 |
| `src/components/chat/RecommendedPrompts.vue` | 空状态推荐 prompt chips |
| `electron/artifactsService.ts` | 监听 outputs/ + IPC（list/changed/open/reveal） |
| `scripts/build-office-skills.mjs`（或 engine/scripts/） | esbuild 打包技能脚本为自包含 .cjs |

### 8.2 修改
| 文件 | 改动 |
|---|---|
| `src/stores/app.ts` | `mode/setMode` + `workWorkspace/workWorkspaceConfirmed` + 持久化 |
| `electron/agentsService.ts` | frontmatter 扩展解析（mode/category/avatar/permission/skills/mcps/recommendedPrompts）+ 递归扫 `agents-lib/work/` |
| `src/stores/agents.ts` | `AgentDef` 扩展字段；按 `mode/category` 过滤；暴露 work 助手 |
| `src/stores/chat.ts` | `startWorkAssistantSession()`；`Session.mode/assistantId`；新建会话按 mode 选 cwd/装配 |
| `src/components/layout/Sidebar.vue` | history 顶部接 `ModeTabs`；会话列表按 mode 过滤；Work 新建走引导 |
| `src/components/layout/InfoPanel.vue` + `InfoPanelTabBar` | 新增 `artifacts` mode/tab |
| `src/components/chat/ChatInput.vue` | Work 模式 agent 菜单切换为办公助手 |
| `src/components/chat/ChatPanel.vue` | 空状态挂 `RecommendedPrompts` |
| `electron/skillsService.ts` | office-* 注册进 `BUNDLED_SKILLS`；确保 `skills-lib/office` 被本地库扫描 |
| `electron/main.ts`（或 preload 注册处） | 注册 `artifactsService` IPC |
| `electron/preload.ts` + `src/services/electronAPI.ts` | 暴露 `artifacts:*` API |
| 根 `package.json` | 加 `pptxgenjs/docx/exceljs`；构建脚本 + `asarUnpack`（`skills-lib/**`） |
| i18n 资源（`src/...`） | Work 模式/助手/工作区/Artifacts 文案 |

> 原则（遵循 CLAUDE.md）：每行改动可追溯本需求；不重构无关代码；新增字段全部缺省兼容旧数据。

---

## 9. 分阶段实施与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| 1. 模式骨架 | `app.mode` + `ModeTabs` + 会话带 mode + 列表过滤 | 顶部 Tab 切换、列表随之过滤、状态持久化 |
| 2. 工作区引导 | `WorkspaceOnboarding` + 默认目录创建 + 选择 | 首次进 Work 弹引导，确认后记住 |
| 3. 助手数据层 | frontmatter 扩展解析 + 20 个 `agents-lib/work/*.md` | 画廊可见、可选中、persona 生效 |
| 4. 技能闭环（命门） | office-pptx/docx/xlsx 三包 + esbuild 打包 + 注册 + 装配激活 | **一句话真实产出可打开的 .pptx/.docx/.xlsx** |
| 5. Work 体验 | RecommendedPrompts + ArtifactsPanel（监听 outputs/） | 空状态有起手 chips；产物在 Artifacts 可打开/定位 |
| 6. 助手矩阵补全 | 其余助手 .md + 剩余技能（dashboard/mermaid） | 全 roster 可用 |

---

## 10. 风险与权衡

- **打包后模块解析**：必须验证 packaged 下 `node` 能跑技能脚本（esbuild 自包含 + asarUnpack 解决）。**这是头号风险，阶段 4 优先验证**。
- **PPT 高级排版**：pptxgenjs 弱于 python-pptx；首期聚焦标准商务版式，后续以模板补强。
- **权限安全**：Work 默认 `acceptEdits`，产物写入限定 `<cwd>/outputs/`，避免误写仓库。
- **会话兼容**：旧会话无 `mode` → 按 `code`。
- **roster 落差**：我们的助手系自研，能力/措辞与 AionUI 不完全一致（其定义在不可得的 AionCore 后端），属预期。

---

## 11. 给实现会话的起步指引（TL;DR）
1. 先做 §3.1 `app.mode` 与 §4.1 `ModeTabs`，跑起来看切换效果。
2. 再做 §8.2 `agentsService.ts` frontmatter 扩展 + 建 3 个核心助手（ppt/word/excel）。
3. **打通一个端到端**：`office-pptx` 技能（SKILL.md + esbuild 后的 build_pptx.cjs）+ §5 装配，验证真出 `.pptx`。
4. 补 `RecommendedPrompts` + `ArtifactsPanel`（监听 outputs/）。
5. 铺满 §7 全部助手与剩余技能。

每阶段以"可运行 + 可验证产物"为准出口，遵循仓库 analyze-first / surgical-changes 约定。
