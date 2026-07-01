# 复刻文档：在 SpaceCode 中实现 Design 设计模式（参考 open-design）

> 状态：设计阶段（仅设计 + 复刻方案，不含最终实现代码）
> 版本基线：SpaceCode v0.6.1（Electron 29 + Vue 3 + Pinia）
> 参考项目：open-design v0.12.1（位于 `D:\AI\open-design`，Apache-2.0）
> 目标读者：将据此独立实现该功能的工程师 / AI 工具
> 关联文档：[mini-browser-workbench.md](./mini-browser-workbench.md)、[STRUCTURE.md](../../STRUCTURE.md)、[CLAUDE.md](../../CLAUDE.md)

---

## 0. 一句话目标

在 SpaceCode 现有 `work` / `code` 两个模式旁新增第三个 **`design` 模式**，提供「输入 brief → 选 design system + skill → 调用现有 engine 生成 HTML artifact → sandboxed iframe 流式预览 → 导出」的一体化页面，体验对标 open-design 的 Studio，但**不引入 open-design 的 daemon/Express/SQLite 后端**，完全复用 SpaceCode 现有 engine + IPC + webview 基础设施。

---

## 1. 背景与目标

### 1.1 open-design 是什么

open-design 是开源的 Claude Design 替代品（`D:\AI\open-design`，pnpm monorepo），核心理念是 **agent-native**：不自带 AI，而是 spawn 用户本机已安装的 coding-agent CLI（claude/codex/cursor 等 25 选 1）来生成设计产物。核心循环：

```
brief → 选 skill + design system → spawn agent CLI → agent 读 SKILL.md + DESIGN.md
→ 生成 HTML artifact → 流式解析 <artifact> 标签 → sandboxed iframe 预览 → 导出
```

### 1.2 SpaceCode 现状（关键发现）

经源码核查，**SpaceCode 已具备 open-design 设计模式约 70% 的底层能力**：

| 能力 | SpaceCode 现状 | 位置 |
|------|---------------|------|
| AI agent CLI 调用 | ✅ engine（Claude Code CLI via `EngineFactory`） | `electron/engines/` |
| agent persona + skill 体系 | ✅ `agents-lib/`（80+ agent）+ `skills-lib/` | `agents-lib/`、`skills-lib/` |
| 设计类 agent 已存在 | ✅ `ui-ux-pro-max`（category: design，引用 ui-ux-pro-max skill，产物落 outputs/） | `agents-lib/work/ui-ux-pro-max.md` |
| SKILL.md 格式 | ✅ 与 open-design 完全兼容（YAML frontmatter + markdown） | `skills-lib/*/SKILL.md` |
| 产物落盘 + 监听 | ✅ `api.artifacts.{list,startWatch,onChanged}` 监听 outputs/ | `src/services/electronAPI.ts:444-460` |
| HTML 预览 | ✅ `<webview>` 标签 + `openFileInWebview(path)` | `src/components/layout/InfoPanel.vue:102`、`src/stores/app.ts` |
| 模式切换扩展点 | ✅ `AppMode` 类型 + `ModeTabs.vue`（当前 work/code） | `src/stores/app.ts:81`、`src/components/layout/ModeTabs.vue` |
| 流式消息 | ✅ `api.claudeCode.onStreamEvent`（IPC 事件流，非 SSE） | `src/services/electronAPI.ts` |

**结论**：复刻 design 模式本质是**提供更专注的 UI 入口与 sandboxed iframe 预览体验**，而非重建后端。open-design 的 daemon/Express/SQLite 在 SpaceCode 中**不需要**。

### 1.3 MVP 范围

| # | 功能点 | 一句话 |
|---|--------|--------|
| F1 | **新增 design 模式与 DesignPage 骨架** | 在 ModeTabs 加第三个 tab，中间面板渲染 DesignPage 三栏布局 |
| F2 | **brief 输入 + design system / skill 选择** | 左栏输入需求并选择 design system（如 Stripe/Linear）与 skill/agent + 5 视觉方向 |
| F3 | **提示词栈组装与注入** | 移植 `composeSystemPrompt()`，通过 `--system-prompt` 注入完整 23 层提示词栈（含 DESIGN.md + tokens.css） |
| F4 | **filesystem 模式文件监听预览** | chokidar 监听设计工作目录 → 读 index.html → buildSrcdoc → sandboxed iframe（MVP 主路径） |
| F5 | **产物列表 + 导出** | 右栏列出 outputs/design/ 产物，支持预览、导出 HTML/ZIP/MD/PDF |
| F6 | **question-form 发现协议** | 解析 agent 输出的 `<question-form>` 标记，渲染 17 种控件交互表单，用户答后回传 |
| F7 | **身份章程 + 5 维批判 + preflight** | 移植 official-system/directions/panel，huashu-design 作中文本地化来源 |

### 1.4 关键决策（已确认）

- **不引入 daemon**：完全复用 SpaceCode engine + IPC，不新建 Express/SQLite 服务。
- **不改 `engine/` 目录，但改 `electron/` 层**：`CLAUDE.md` 禁止修改的是 `engine/`（Bun CLI 子项目），而提示词栈注入通过 `electron/sessionProcess.ts` 已有的 `--system-prompt` 参数实现（第 938 行），**不触碰 `engine/` 代码**。design 模式用 `--system-prompt` **完全替换**默认 system prompt；非 design 模式保持现有 `--append-system-prompt` 行为不变，零侵入。
- **提示词栈是设计模式的灵魂**：open-design 的核心不是 UI 或 daemon，而是 `composeSystemPrompt()` 按严格顺序拼接的 23 层提示词栈（安全防护→发现层→身份章程→设计系统→技能→批判…）。复刻**必须移植提示词栈组装器**，仅靠前端拼接 DESIGN.md 到 user message 远远不够——agent 不会按设计师章程工作、不会发 question-form、不会做 5 维批判。
- **filesystem 执行模式优先**：SpaceCode 驱动 Claude Code CLI 有完整文件工具，天然是 `executionProfile='filesystem'`——agent 直接 Write 文件到磁盘，预览通过**文件监听**实现。`<artifact>` 流式 parser 仅作为 BYOK/text_artifact 模式的可选 fallback，**MVP 不需要 artifact parser**。这大幅简化 F4 实现。
- **iframe 安全模型**：复刻 open-design 的 `sandbox="allow-scripts allow-popups allow-downloads"`（**故意不加 allow-same-origin**），所有交互通过 postMessage 桥接。
- **design system 资源直接 copy**：open-design 的 `design-systems/` 目录（150+ 系统）可直接 copy 到 SpaceCode 作为数据源。每个系统含 DESIGN.md（9 段品牌契约）+ tokens.css（机器可读契约，要求 agent 逐字粘进工件 `:root`）。
- **huashu-design 是中文设计师章程金矿**：SpaceCode 已有的 `skills-lib/huashu-design/SKILL.md` 包含完整的中文版设计师章程、Junior Designer 工作流、anti-AI-slop 清单、5 维评审、React+Babel、Tweaks 等，可直接作为 `official-system.ts` 的中文本地化来源 + 首批激活技能，减少从 open-design 英文版翻译的工作量。
- **UI 用 Vue3 重写**：open-design 前端是 React，FileViewer/ChatComposer 等组件需用 Vue3 重写，参考其职责划分。

---

## 2. open-design 设计模式实现剖析

> 本章是对参考项目核心机制的深度剖析，为复刻提供理论依据。所有路径相对 `D:\AI\open-design`。

### 2.1 整体架构与数据流

open-design 采用三 sidecar 拓扑（daemon / web / desktop），通过 JSON-line IPC（Unix socket 或 Windows named pipe）协调。**SpaceCode 只需关注拓扑 A（完全本地）**。

完整数据流（用户输入 brief → artifact 渲染）：

```
[Renderer]  ChatComposer 收集 brief + skill + designSystem
    │ POST /api/chat (SSE)
    ▼
[Daemon: routes/runs.ts:1384]
    design.runs.create(meta)  → 写 SQLite agent_sessions
    design.runs.stream(run)   → 建立 SSE
    design.runs.start(run)    → 异步 startChatRun(meta, run)
        │ composeDaemonSystemPrompt(skill, designSystem, craft)  ← 注入 SKILL.md + DESIGN.md
        │ resolveAgentLaunch(agentId) → {command, args, env, cwd}
        │ spawn(agent CLI, {cwd: 项目产物目录, stdio:[stdin,pipe,pipe]})
        │ if def.promptViaStdin → child.stdin.write(prompt)
        ▼
[Agent CLI 子进程]  (claude / codex / cursor-agent ... 25 选 1)
    读取注入的 SKILL.md + DESIGN.md
    生成 HTML artifact，写入 cwd/index.html
    stdout 输出 stream-json / codex-stream-json
        ▼
[Daemon: claude-stream.ts / codex-stream.ts]
    解析 stdout JSONL → 6 类事件: status / text_delta / thinking_delta / tool_use / tool_result / usage
    通过 SSE 推给 web
        ▼
[Renderer]
    sse.ts 接收事件流
    artifacts/parser.ts 流式解析 <artifact identifier type title>...</artifact>
        产出 4 类事件: text / artifact:start / artifact:chunk / artifact:end
    runtime/srcdoc.ts buildSrcdoc(html, options)
        注入 12 个 bridge（selection/palette/manualEdit/tweaks/snapshot/export...）
    FileViewer.tsx 通过 postMessage('od:srcdoc-transport-activate', {html}) 注入 iframe
        iframe sandbox="allow-scripts allow-popups allow-downloads" (NO allow-same-origin)
```

**SpaceCode 对应映射**：daemon 的 spawn + stream 解析在 SpaceCode 由 engine + `api.claudeCode.onStreamEvent` 承担；SSE 换成 IPC 事件流；SQLite 换成 SpaceCode 现有会话存储。**无需复刻 daemon**。

### 2.2 Artifact 流式渲染机制（核心，可直接 copy）

文件：`apps/web/src/artifacts/parser.ts`

`createArtifactParser()` 返回 `{ feed, flush }`，`feed(chunk)` 是 generator，每收到一段文本 yield 4 类事件之一：

```ts
export type ArtifactEvent =
  | { type: 'text'; delta: string }
  | { type: 'artifact:start'; identifier: string; artifactType: string; title: string }
  | { type: 'artifact:chunk'; identifier: string; delta: string }
  | { type: 'artifact:end'; identifier: string; fullContent: string };
```

机制要点：
- 检测 `<artifact identifier="..." type="..." title="...">` 开标签与 `</artifact>` 闭标签
- 处理 markdown 代码围栏干扰（```html 包裹的 artifact 标签也能识别），依赖同目录 `markdown-context.ts`
- 处理流式部分标签 holdback（流末尾若 `<artifact` 不完整则缓存到下次 feed）

**框架无关**：唯一 import 是 `./markdown-context`，纯 TS generator。**可直接 copy 到 `src/lib/artifacts/`**。

### 2.3 Sandboxed iframe 安全模型（核心，必须复刻）

文件：`apps/web/src/components/FileViewer.tsx`、`apps/web/src/runtime/srcdoc.ts`

**核心安全策略**：`sandbox="allow-scripts allow-popups allow-downloads"`，**故意不加 `allow-same-origin`**。

后果与设计：
- 宿主页面**无法读** `iframe.contentDocument`（跨域）
- iframe 内脚本**无法访问**父窗口 cookie/localStorage
- 所有交互（selection comment / palette / manual edit / snapshot / export）必须通过 **postMessage 桥接**

`buildSrcdoc(html, options)` 依次注入 12 个 bridge：
1. `sanitizeTitleInDoc` — 清理 `<title>` 防 XSS
2. `annotateMissingOdIds` — 给交互元素加 `data-od-id`（comment 锚点）
3. `injectSandboxShim` — 拦截 `window.open`/`alert`
4. `injectBaseHref` — `<base href>` 指向资源路径
5. `injectDeckBridge` — deck 模式 slide 切换
6. `injectSelectionBridge` — 选区 comment / inspect
7. `injectPaletteBridge` — 颜色拾取
8. `injectManualEditBridge` — 手动编辑回写
9. `injectTweaksBridge` — 微调（typography/spacing/color）
10. `injectSnapshotBridge` — 截图请求
11. `injectExportCaptureBridge` — 导出捕获
12. `injectSrcdocTransportActivationBridge` — 监听 `od:srcdoc-transport-activate` 消息，通过 `document.open/write/close` 替换整个文档（绕过 srcdoc 属性大小限制）

**MVP 复刻建议**：先实现 `sanitizeTitle` + `injectSandboxShim` + `injectSrcdocTransportActivationBridge` 三个核心 bridge，其余按需迭代。

### 2.4 Design System / Skill / Plugin 体系

#### DESIGN.md 9 段格式（`design-systems/<id>/DESIGN.md`）

来自 awesome-claude-design 约定，9 段：
1. Visual Theme & Atmosphere
2. Color Palette & Roles
3. Typography Scale
4. Spacing & Layout
5. Component Patterns
6. Motion & Interaction
7. Iconography & Imagery
8. Voice & Tone
9. Anti-Patterns

示例（`design-systems/stripe/DESIGN.md`）含具体颜色值（`#533afd` Stripe Purple）、字体（sohne-var）、阴影系统（`rgba(50,50,93,0.25)`）等，是纯 Markdown，**可直接作为 prompt 上下文注入 agent**。

design-system 目录还可能含：`manifest.json`（schemaVersion `od-design-system-project/v1`）、`tokens.css`、`components.html`、`design-tokens.json`、`tailwind-v4.css`、`preview/`。共 150+ 系统（stripe/linear-app/apple/github/vercel/notion...）。

#### SKILL.md frontmatter

Claude Code 兼容 + `od:` 扩展命名空间。SpaceCode 现有 `skills-lib/` 已采用相同格式（YAML frontmatter + markdown body），**完全兼容**。

#### 三层 discovery 优先级（`apps/daemon/src/skills.ts`）

`listSkills(roots)` 按 root 顺序去重：项目级 `./.claude/skills/` → 工作区级 `./skills/` → 用户级 `~/.claude/skills/`。SpaceCode 的 `electron/skillsService.ts` 已实现类似逻辑。

### 2.5 导出机制

文件：`apps/web/src/runtime/exports.ts`（客户端）+ `apps/daemon/src/{inline-assets,pdf-export,deck-export}.ts`（服务端）

| 格式 | 实现 | SpaceCode 可行性 |
|------|------|-----------------|
| HTML | `buildSrcdoc(html)` → Blob 下载 | ✅ 客户端直接实现 |
| ZIP | index.html + DESIGN-HANDOFF.md + DESIGN-MANIFEST.json | ✅ 客户端 JSZip |
| MD | 直接下载源码 | ✅ 客户端 |
| PDF | 调 host bridge `pdf.print(html)` → `webContents.print` | ✅ Electron `webContents.print` |
| 截图 | postMessage `od:snapshot` 给 iframe | ✅ postMessage |
| PPTX | Electron Chromium 渲染 slide 为 PNG + `pptxgenjs` | ⚠️ 较重，MVP 可后置 |

`inline-assets.ts` 的 `inlineRelativeAssets` 仅处理 `<link rel=stylesheet>` 和 `<script src>`，带 5 个保护性 cap（MAX_INLINE_OWNER_BYTES=2MiB 等）。**可 copy**。

### 2.6 open-design 关键文件速查

| 模块 | 路径 |
|------|------|
| artifact parser（**可 copy**） | `apps/web/src/artifacts/parser.ts` + `markdown-context.ts` |
| srcdoc 构造（参考重写） | `apps/web/src/runtime/srcdoc.ts` |
| 客户端导出（参考） | `apps/web/src/runtime/exports.ts` |
| 服务端 inline-assets（**可 copy**） | `apps/daemon/src/inline-assets.ts` |
| Claude 适配器（参考） | `apps/daemon/src/runtimes/defs/claude.ts` |
| Claude 流解析（参考） | `apps/daemon/src/runtimes/claude-stream.ts` |
| Studio 页面（参考重写） | `apps/web/src/components/ProjectView.tsx` |
| FileViewer（参考重写） | `apps/web/src/components/FileViewer.tsx` |
| design-systems 资源（**可 copy**） | `design-systems/`（150+ 目录） |
| skills 资源（**可 copy**） | `skills/`（160+ 目录） |
| SKILL.md 规范 | `docs/skills-protocol.md` |

### 2.7 提示词栈组装器（设计模式的灵魂，★★★ 必须）

文件：`apps/daemon/src/prompts/system.ts`（101KB）

`composeSystemPrompt(input: ComposeInput): string` 按严格顺序拼接 23 层指令，是 open-design 设计模式的核心。**仅靠前端拼接 DESIGN.md 到 user message 远远不够**——没有提示词栈，agent 不会按设计师章程工作、不会发 question-form、不会做 5 维批判。

#### 23 层拼接顺序

```
 1. PROMPT_INJECTION_RESISTANCE（安全防护）
 2. API_MODE_OVERRIDE（BYOK 无工具时）
 3. 模式 override（chat=轻量 / plan=先出MD / design=不注入=完整工作流）
 4. UI locale 提示
 5. renderDiscoveryAndPhilosophy() — 发现层 RULE 1/2/3 + 设计哲学
    └─ 无激活 DS 时追加 renderDirectionSpecBlock()（5 方向库）
 6. renderOfficialDesignerPrompt() — 身份章程（Ask 模式跳过）
 7. memory + 两环 hooks
 8. user/project 自定义指令
 9. 激活设计系统：USAGE.md → DESIGN.md → tokens.css → components.manifest
10. craft references
11. 激活技能 body + derivePreflight()（强制先读 assets/template.html、references/checklist.md）
12. metadata block（kind/platform/fidelity/slideCount...）
13. DECK_FRAMEWORK_DIRECTIVE（deck 项目）
14. media contract
15. critique panel（5 维批判）
16. ACTIVE_DESIGN_SYSTEM_VISUAL_DIRECTION_OVERRIDE（有 DS 则禁问方向）
17. FILESYSTEM_HANDOFF_OVERRIDE
18. CRITICAL: Never fabricate conversation turns
```

#### ComposeInput 接口（源码验证）

```ts
export interface ComposeInput {
  agentId?: string;
  skillBody?: string;          // 激活技能的 SKILL.md body
  skillName?: string;
  skillMode?: 'prototype' | 'deck' | 'template' | 'design-system' | 'image' | 'video' | 'audio';
  designSystemBody?: string;   // DESIGN.md 内容
  designSystemTitle?: string;
  designSystemUsageMd?: string;         // USAGE.md 路由
  designSystemTokensCss?: string;       // tokens.css 逐字粘进工件 :root
  designSystemComponentsManifest?: string;
  designSystemFixtureHtml?: string;
  craftBody?: string;           // craft references
  memoryBody?: string;          // 用户记忆
  metadata?: { kind?: string; platform?: string; fidelity?: string; slideCount?: number };
  critique?: boolean;
  locale?: string;
  sessionMode?: 'design' | 'chat' | 'plan';
  userInstructions?: string;
  projectInstructions?: string;
  executionProfile?: 'filesystem' | 'text_artifact';
  // ...更多字段
}
```

#### 关键门控规则

- `sessionMode === 'design'`：不注入 chat/plan override = 保留完整工作流
- 有激活 DS 时：`ACTIVE_DESIGN_SYSTEM_VISUAL_DIRECTION_OVERRIDE` 禁止 agent 再问方向/调色板
- 无激活 DS 时：追加 `renderDirectionSpecBlock()`（5 方向库），agent 可能发 `<question-form type="direction-cards">`
- `executionProfile === 'filesystem'`：注入 `FILESYSTEM_HANDOFF_OVERRIDE`，agent 用 Write 工具写文件，不输出 `<artifact>` 块

#### SpaceCode 注入点（已验证）

`electron/sessionProcess.ts:72` — `SessionConfig.systemPrompt?: string`
`electron/sessionProcess.ts:938` — `if (config.systemPrompt) args.push('--system-prompt', config.systemPrompt)`

**注入策略**：design 模式时，在 `chatSession.ts` 的 `initClaudeCodeSession` 中调用 `composeSystemPrompt()` 组装完整提示词栈，通过 `config.systemPrompt` 传入。非 design 模式保持现有 `--append-system-prompt` 行为不变。**不触碰 `engine/` 代码**。

#### 配套提示词模块（均存在于 open-design daemon）

| 文件 | 大小 | 职责 |
|------|------|------|
| `prompts/system.ts` | 101KB | 组装器 + `derivePreflight()` 函数（内嵌，非独立文件） |
| `prompts/discovery.ts` | 34KB | 发现层 RULE 1/2/3 + 设计哲学 + 表单模板 |
| `prompts/official-system.ts` | 16KB | `OFFICIAL_DESIGNER_PROMPT` 身份章程 + anti-AI-slop 清单 |
| `prompts/directions.ts` | 13KB | `DESIGN_DIRECTIONS` 5 方向（editorial/modern-minimal/human/tech/brutalist）+ OKLch palette + 字体栈 |
| `prompts/deck-framework.ts` | 24KB | `DECK_SKELETON_HTML` + `DECK_FRAMEWORK_DIRECTIVE` 幻灯片骨架 |
| `prompts/panel.ts` | 10KB | critique panel（5 维批判） |
| `prompts/media-contract.ts` | 25KB | 媒体契约 |

> **注意**：`preflight.ts` 不是独立文件，`derivePreflight()` 是 `system.ts:1623` 的内嵌函数，正则扫描 skill body 引用的 side files（assets/template.html、references/checklist.md），注入"Pre-flight: 先 Read 这些文件"指令。

### 2.8 Question-form 发现协议（★★★ 必须）

文件：`apps/web/src/artifacts/question-form.ts`（684 行）

open-design 的设计模式采用**3 轮发现流程**，agent 通过纯文本 `<question-form>` 标签向用户提问：

```
Turn 1: agent 输出 1 行散文 + <question-form id="discovery">{json}</question-form> → STOP
  → 前端 splitOnQuestionForms() 渲染表单 → 用户答
Turn 2: 按 brand 答案分支（A=品牌提取 / B=直接 TodoWrite）
  → 无 DS 时可能弹 <question-form type="direction-cards"> 5 方向卡
Turn 3+: TodoWrite 9 步计划 → agent Write index.html → 文件监听 → 预览
```

**协议要点**：
- `<question-form>` / `<ask-question>` 是纯文本标记（不是工具调用），前端正则切分
- body 是 JSON，格式 `{ questions: [{ id, label, type, options?, required? }] }`
- RULE 1 要求 agent 发完表单就 STOP，靠提示词约束（不是代码强制）
- 支持 17 种控件类型：radio/checkbox/select/text/textarea/number/range/date/time/datetime-local/color/url/email/tel/file/switch/**direction-cards**
- `direction-cards` 是特殊类型：渲染 5 方向卡（色板 swatch + 字体 "Aa" 样本 + mood 描述）

**SpaceCode 接入点**：`chatStream.ts` 的 `text_delta` 累积处（约第 345 行），design 模式会话额外调用 `findFirstQuestionForm(accumulatedContent)`，发现表单时：
1. 把表单段从消息文本中剥离（避免重复显示）
2. 写入 `session.pendingQuestionForm`
3. 触发 UI 渲染 Questions 面板
4. 用户答完 → 用 `[form answers — discovery] {json}` 格式作为下一条 user message 发送

### 2.9 身份章程（Official Designer Prompt，★★★ 必须）

文件：`apps/daemon/src/prompts/official-system.ts`

`OFFICIAL_DESIGNER_PROMPT` 定义 agent 的设计师身份，核心理念：
- **"HTML 是工具不是媒介"** — 根据任务 embody 对应领域专家（动画师/UX 设计师/幻灯片设计师/原型师）
- **anti-AI-slop 清单** — 禁紫色渐变、emoji 图标、Inter 字体、卡片套卡片等 AI 生成常见套路
- **Junior Designer 工作流** — 先假设 + reasoning + placeholder，再迭代

**SpaceCode 本地化来源**：`skills-lib/huashu-design/SKILL.md` 已包含完整的中文版设计师章程，内容与 open-design 的 `official-system.ts` 高度一致，可直接作为中文本地化来源，减少翻译工作量。

### 2.10 执行模式（Execution Profile，关键架构决策）

open-design 有两种执行模式，决定产物交付方式：

| 模式 | 产物交付 | 预览方式 | 适用场景 |
|------|---------|---------|---------|
| `filesystem` | agent 用 Write 工具直接写文件到磁盘 | 文件监听（chokidar）→ 读文件 → buildSrcdoc → iframe | 有文件工具的 CLI（Claude Code） |
| `text_artifact` | agent 输出 `<artifact>` 块到 stdout | artifact parser 流式解析 → iframe | BYOK 无文件工具 |

**SpaceCode = filesystem 模式**：Claude Code CLI 有完整文件工具，agent 直接 Write `index.html` 到设计工作目录。预览通过文件监听实现，**MVP 不需要 artifact parser**（那是 text_artifact 模式的 fallback）。

`FILESYSTEM_HANDOFF_OVERRIDE` 提示词块（`system.ts:317`）明确告知 agent：
- 项目文件是产物的唯一真实来源
- 使用原生文件工具（Write/Edit）交付产物
- filesystem 模式输出源码 `<artifact>` 被视为意外的 fallback

### 2.11 5 视觉方向（Visual Directions，★★ 推荐）

文件：`apps/daemon/src/prompts/directions.ts`

当用户**未选择 design system** 时，agent 通过 `<question-form type="direction-cards">` 让用户从 5 个预设视觉方向中选择：

| 方向 | 风格 | 色板 | 字体栈 |
|------|------|------|--------|
| editorial | 编辑杂志风 | 暖色单色 | 衬线 display |
| modern-minimal | 现代极简 | 冷色单色 | 无衬线 |
| human | 人文温暖 | 大地色 | 圆润无衬线 |
| tech | 科技感 | 深色+霓虹 | 等宽 |
| brutalist | 粗野主义 | 高对比黑白 | 粗体衬线 |

每个方向含 OKLch palette + 字体栈 + mood 描述。**有激活 DS 时此机制被跳过**（`ACTIVE_DESIGN_SYSTEM_VISUAL_DIRECTION_OVERRIDE` 禁止再问方向），两者互斥。

### 2.12 Deck Framework（幻灯片骨架，★★ 后置）

文件：`apps/daemon/src/prompts/deck-framework.ts`（24KB）

当 skill mode 为 `deck` 时，注入 `DECK_SKELETON_HTML`（1920×1080 幻灯片 HTML 骨架）+ `DECK_FRAMEWORK_DIRECTIVE`（翻页、键盘导航、Speaker Notes 等指令）。agent 产出可翻页的 HTML 幻灯片。

SpaceCode 已有相关 skill：`skills-lib/html-ppt-skill/`、`skills-lib/morph-ppt/`、`skills-lib/guizang-ppt-skill/`。**MVP 后置**，后续按需迭代。

### 2.13 5 维批判面板（Critique Panel，★★ 后置）

文件：`apps/daemon/src/prompts/panel.ts`（10KB）

提示词栈第 15 层注入 5 维批判要求，agent 完成设计后自我评审：

1. **哲学一致性**（10 分）— 设计方向与 brief 是否匹配
2. **视觉层级**（10 分）— 信息架构是否清晰
3. **细节打磨**（10 分）— 间距/对齐/微交互
4. **功能性**（10 分）— 交互是否可用
5. **创新性**（10 分）— 是否避免 AI slop

**SpaceCode 渲染**：复用现有 ToolCard 组件渲染批判结果，无需新建 UI。提示词栈已含批判指令。

### 2.14 Preflight 注入（★★ 必须）

`derivePreflight(skillBody)` 是 `system.ts:1623` 的内嵌函数（**非独立文件**），正则扫描 skill body 是否引用 `assets/template.html`、`references/checklist.md` 等 side files，若有则注入"Pre-flight: 先 Read 这些文件"指令。技能的 side files 路径在 prompt 开头以 skill-root preamble 形式告知 agent。

### 2.15 huashu-design 与 open-design 的映射关系

SpaceCode 已有的 `skills-lib/huashu-design/SKILL.md` 与 open-design 提示词栈的对应关系：

| open-design 模块 | huashu-design 对应内容 | 复用方式 |
|------------------|----------------------|---------|
| `official-system.ts` 身份章程 | "你是一位用 HTML 工作的设计师" + anti-AI-slop | 直接作中文版 official-system |
| `discovery.ts` 发现层 RULE 1/2/3 | 需求模糊 Fallback：5 流派×20 哲学推 3 方向 | 部分复用，需补充 question-form 协议 |
| `directions.ts` 5 方向 | 5 流派（Pentagram/Field.io/Kenya Hara/Sagmeister...） | 可作为 direction-cards 的中文版 |
| `panel.ts` 5 维批判 | 5 维度评审（哲学一致/视觉层级/细节/功能/创新各 10 分） | 直接对应，几乎一致 |
| `deck-framework.ts` 幻灯片 | Speaker Notes + Starter Components | 部分复用 |
| Junior Designer 工作流 | "先假设+reasoning+placeholder 再迭代" | 直接对应 |

**结论**：huashu-design 可作为 `official-system.ts` + `panel.ts` + `directions.ts` 的中文本地化来源，大幅减少翻译工作量。首批激活技能清单：huashu-design、canvas-design、frontend-design、prototype、html-ppt-skill、morph-ppt、guizang-ppt-skill、theme-factory、brand-guidelines、ui-ux-pro-max。

---

## 3. SpaceCode 现状基线（可直接复用的资产）

### 3.1 模式切换机制（官方扩展点）

- `src/stores/app.ts:81` — `export type AppMode = 'work' | 'code'`
- `src/stores/app.ts:128` — `const mode = ref<AppMode>(_initialMode)`，持久化到 localStorage `app_mode`
- `src/stores/app.ts:640` — `setMode(m)` 实现：仅 `mode.value = m` + localStorage 持久化，**无会话过滤逻辑**
- `src/components/layout/ModeTabs.vue` — 当前两个 tab（work=Briefcase 图标，code=Code2 图标），`handleSelect(mode: AppMode)` 通用
- 会话过滤在 `src/components/layout/Sidebar.vue` 的 `filteredSessions` computed（约第 370 行）基于 `session.mode` 过滤

**扩展方式**：`AppMode` 加 `'design'` + ModeTabs 加第三个 tab + Sidebar 的 filteredSessions 加 design 分支。`createSession`（`src/stores/chatSession.ts:606`）已自动写入 `mode: appStore.mode`，**无需改动**。

### 3.2 中间面板渲染机制

`src/App.vue:26-36` 中间面板按优先级互斥渲染：

```
SettingsPanel ← showSettings
SkillsManager ← showSkillsManager
AgentManager  ← showAgentManager
McpManager    ← showMCPManager
CronManager   ← showCronManager
WorkAssistantGallery ← showWorkGallery
SplitContainer ← !showTraceViewer (默认)
TraceViewer    ← showTraceViewer
```

**扩展方式**：在条件链加入 `<DesignPage v-else-if="appStore.mode === 'design'" />`（优先级置于 SplitContainer 之前）。

### 3.3 agent + skill + outputs 闭环（核心复用）

调用链（已验证）：

```
DesignPage 发送 brief
  → src/stores/chat.ts (Proxy)
  → chatSession.ts initClaudeCodeSession(sessionId)  [第 623 行]
      从 settingsStore.config 取 provider/model/apiKey/baseUrl
      从 currentAgent 取 agent 名
      调 api.claudeCode.startSession(sessionId, config)
        config = { cwd, apiKey, baseUrl, provider, model, effortLevel,
                   permissionMode, agent: currentAgent.value, ... }
  → electron/claudeCodeIPC.ts  (ipcMain.handle 'claude-code:startSession')
  → EngineFactory.getEngine(engineType).startSession(sessionId, config)
  → spawn Claude Code CLI 子进程
  → stdout 流式输出
  → mainWindow.webContents.send('claude-code:stream_event', {sessionId, data})
  → 渲染进程 api.claudeCode.onStreamEvent(callback)
```

**关键**：`config.agent` 字段把 agent 名传给 engine，engine 加载 `~/.claude/skills/` 下对应 skill。`ui-ux-pro-max` agent 的 .md 指示"using the ui-ux-pro-max skill. Read its SKILL.md first. Save deliverables under outputs/"。

### 3.4 产物监听与 HTML 预览

`src/services/electronAPI.ts:444-460` — `api.artifacts`：
```ts
artifacts: {
  list(workingDir)              // 列出 outputs/ 产物
  open(filePath)                // 系统打开
  reveal(filePath)              // 资源管理器定位
  startWatch(artifactsDir)      // 监听目录变化
  stopWatch()
  onChanged(callback)           // 回调 {eventType, filename}
}
```

`src/stores/app.ts` — `openFileInWebview(filePath)`（约第 692 行）：转 `file://` URL 在 InfoPanel 的 `<webview>` 打开。

`src/components/work/ArtifactsPanel.vue`（约第 150-159 行）：监听 outputs/ + 列出产物 + 对 .html 调 `openFileInWebview`。**这是 open-design artifact 预览的 SpaceCode 版本，可直接参考**。

### 3.5 webview 预览能力

两处成熟实现可参考：
- `src/components/layout/InfoPanel.vue:102-118` — `<webview :src partition="persist:webview-session">` + 导航栏
- `src/components/work/PreviewPanel.vue:37-44` — `<webview partition="persist:office-preview">` Office 预览

`electron/main.ts` 已启用 `webPreferences.webviewTag: true`，`contextIsolation: true`，`nodeIntegration: false`。

> **注意**：open-design 用 `<iframe sandbox>` 而非 `<webview>`。iframe sandbox 更轻量且安全模型更严格（无 allow-same-origin 时完全隔离）。design 页面的流式预览**建议用 `<iframe sandbox>`**（见 F4），产物最终预览可复用现有 `<webview>`。

### 3.6 主题与样式

`src/styles/_variables.scss` 定义 4 套主题（light/dark/anthropic/anthropic-dark），关键变量：
- 背景：`--bg-primary` `--bg-secondary` `--bg-elevated` `--bg-hover` `--bg-active`
- 表面：`--surface-glass` `--surface-glass-hover` `--surface-border` `--surface-card`
- 文本：`--text-primary` `--text-secondary` `--text-muted`
- 强调：`--accent-primary` `--accent-primary-hover` `--accent-primary-glow`
- 圆角：`--radius-xs/sm/md/lg/xl/full`
- 阴影：`--shadow-sm/md/lg/xl/glow`

`App.vue:2` — `<div class="app-container" :data-theme="appStore.theme">` 保证主题变量全局可用。新页面照此用变量即可自动适配主题。

### 3.7 现有 skills/agents 资源

- `skills-lib/ui-ux-pro-max/` — 高端 UI/UX 设计 skill（含 csv 数据 + cli 工具）
- `skills-lib/web-artifacts-builder/` — React+Tailwind+shadcn 单文件 HTML artifact skill
- `agents-lib/work/ui-ux-pro-max.md` — 设计类 agent（model: sonnet, permission: acceptEdits, skills: [ui-ux-pro-max]）
- `agents-lib/work/html-ppt-creator.md` — HTML PPT 生成 agent

**这些已构成 design 模式的默认 agent/skill 集**。

---

## 4. 缺口总览

| 能力 | 现状 | 缺口 | 优先级 |
|------|------|------|--------|
| design 模式入口 | ❌ AppMode 只有 work/code | 扩展类型 + ModeTabs tab + App.vue 渲染 | ★★★ |
| DesignPage 页面 | ❌ 无 | 新建三栏布局组件 | ★★★ |
| **提示词栈组装器** | ❌ 无 | 移植 `composeSystemPrompt()` + 6 个提示词模块到 `electron/design/prompts/` | ★★★ |
| **DESIGN.md + tokens.css 注入** | ❌ 无 | 通过 `--system-prompt` 注入完整提示词栈（含 DESIGN.md + tokens.css），非前端 user message 拼接 | ★★★ |
| **question-form 发现协议** | ❌ 无 | copy `question-form.ts` 解析器 + 新建 `QuestionForm.vue` 渲染 17 种控件 | ★★★ |
| **身份章程（official-system）** | ⚠️ huashu-design 有中文版 | 移植 `official-system.ts`，huashu-design 作中文本地化来源 | ★★★ |
| brief 输入 + 选择器 | ❌ 无 | 新建 BriefEditor + DesignSystemPicker + SkillPicker + DirectionPicker | ★★★ |
| design system 资源 | ❌ 无 150+ 系统 | copy open-design design-systems/（含 DESIGN.md + tokens.css） | ★★★ |
| **文件监听预览（filesystem 模式）** | ❌ 无 | chokidar 监听设计工作目录 → IPC 推送 → 读文件 → buildSrcdoc → iframe | ★★★ |
| artifact 流式解析 | ❌ 无 | copy open-design parser.ts（仅 text_artifact fallback，MVP 可选） | ★ 可选 |
| sandboxed iframe 预览 | ❌ 无（有 webview 但非 sandbox iframe） | 新建 DesignPreview + srcdoc bridge | ★★★ |
| **5 视觉方向** | ⚠️ huashu-design 有 5 流派 | 移植 `directions.ts` + direction-cards 表单 | ★★ 推荐 |
| **preflight 注入** | ❌ 无 | `derivePreflight()` 逻辑内嵌到提示词栈组装器 | ★★ |
| **5 维批判面板** | ⚠️ huashu-design 有 5 维评审 | 提示词栈已含，复用 ToolCard 渲染 | ★★ 后置 |
| **Deck 幻灯片框架** | ⚠️ 有 html-ppt-skill 等 | 移植 `deck-framework.ts` | ★★ 后置 |
| **od: frontmatter 扩展** | ❌ 无 | 为设计技能 SKILL.md 加 `od:` 块（mode/surface/scenario） | ★★ |
| **Session design 元数据** | ❌ 无 | Session 类型加 `designSkillId`/`designSystemId`/`designSessionMode` | ★★ |
| 产物列表 | ⚠️ 有 ArtifactsPanel 但绑 Work 模式 | 新建 DesignArtifactList 或复用 | ★★ |
| 导出 | ❌ 无 | 新建导出菜单（HTML/ZIP/MD/PDF） | ★★ |
| design store | ❌ 无 | 新建 src/stores/design.ts | ★★★ |
| i18n | ⚠️ 需补 key | 在 zh-CN.ts/en-US.ts 加 design.* | ★★ |

---

## 5. 总体架构（复刻后目标）

```
┌──────────────────────── 渲染进程 (Vue 3) ────────────────────────┐
│                                                                    │
│  App.vue  (mode === 'design' 时渲染 DesignPage)                    │
│    └ DesignPage.vue  ──────────────────────────────────────────    │
│       ├ 左栏: BriefEditor + DesignSystemPicker + SkillPicker       │
│       │    │                  + DirectionPicker(无DS时)            │
│       │    ├ brief 文本框                                          │
│       │    ├ design system 列表（读 design-systems-lib/）          │
│       │    ├ skill/agent 列表（读 api.skills.getBundledSkills）    │
│       │    └ 5 视觉方向卡（无 DS 时显示）                          │
│       │                                                            │
│       ├ 中栏: DesignPreview（sandboxed iframe 预览）               │
│       │    ├ <iframe sandbox="allow-scripts allow-popups           │
│       │    │     allow-downloads">（NO allow-same-origin）         │
│       │    ├ filesystem 模式：chokidar 监听文件变化                │
│       │    │    → 读 index.html → buildSrcdoc → postMessage 注入   │
│       │    ├ text_artifact 模式(可选)：ArtifactParser 流式解析     │
│       │    ├ buildSrcdoc + bridge 注入（Vue3 重写）                │
│       │    ├ QuestionForm.vue（发现表单 17 种控件）                │
│       │    └ postMessage('od:srcdoc-transport-activate', {html})   │
│       │                                                            │
│       └ 右栏: DesignArtifactList + 导出菜单                        │
│            ├ api.artifacts.startWatch/onChanged 监听 outputs/      │
│            ├ .html → iframe 预览 / .pptx → officePreview           │
│            └ 导出: HTML / ZIP / MD / PDF                           │
│                                                                    │
│  src/stores/design.ts  (design 会话状态/brief/选中项/预览URL)      │
│  src/utils/design/questionForm.ts  (copy 自 open-design)           │
│  src/lib/artifacts/srcdoc.ts  (Vue3 版 bridge 注入)               │
│  src/lib/artifacts/exports.ts (客户端导出纯函数)                   │
│  src/lib/artifacts/parser.ts  (可选，text_artifact fallback)      │
└────────────────────────────────────────────────────────────────────┘
            │ api.claudeCode.startSession (config.systemPrompt=提示词栈)
            │ api.claudeCode.sendMessage (brief + question-form 答案)
            │ api.claudeCode.onStreamEvent (IPC 事件流)
            │ api.artifacts.startWatch / onChanged
            │ design:file-changed (chokidar IPC 推送)
            ▼
┌──────────────────────── Electron 主进程 ──────────────────────────┐
│  electron/design/prompts/system.ts  ← composeSystemPrompt()        │
│    ├ prompts/discovery.ts      (发现层 RULE 1/2/3)                 │
│    ├ prompts/official-system.ts (身份章程 + anti-AI-slop)         │
│    ├ prompts/directions.ts     (5 视觉方向)                       │
│    ├ prompts/deck-framework.ts (幻灯片骨架, 后置)                 │
│    ├ prompts/panel.ts          (5 维批判)                         │
│    └ prompts/media-contract.ts (媒体契约)                         │
│  electron/design/designSystems.ts  (扫描 design-systems-lib/)     │
│  electron/design/designSkills.ts   (扫描 od: frontmatter 技能)    │
│  electron/design/fileWatcher.ts    (chokidar 文件监听)            │
│  electron/claudeCodeIPC.ts  →  EngineFactory.getEngine()           │
│    → --system-prompt 注入提示词栈（非 --append-system-prompt）     │
│    → spawn Claude Code CLI（agent 名 via config.agent）            │
│    → stdout 流 → webContents.send('claude-code:stream_event')      │
│  electron/skillsService.ts  (加载 skills-lib/ + ~/.claude/skills)  │
│  electron/main.ts  (webviewTag:true, 产物文件读写 IPC)             │
└────────────────────────────────────────────────────────────────────┘
            │ spawn --system-prompt "提示词栈"
            ▼
┌──────────────────────── Claude Code CLI 子进程 ───────────────────┐
│  加载 agent persona (agents-lib/work/ui-ux-pro-max.md)            │
│  加载 skill (skills-lib/huashu-design/SKILL.md)                   │
│  接收 --system-prompt（完整 23 层提示词栈）                        │
│    ├ 安全防护 + 身份章程 + anti-AI-slop                            │
│    ├ 发现层 RULE 1/2/3 + 设计哲学                                 │
│    ├ 激活 DS 的 DESIGN.md + tokens.css（逐字粘进工件 :root）      │
│    ├ 激活 skill body + preflight 指令                             │
│    ├ FILESYSTEM_HANDOFF_OVERRIDE（用 Write 工具写文件）           │
│    └ 5 维批判面板                                                 │
│  filesystem 模式：Write index.html → 设计工作目录                 │
│  Turn 1: 输出 <question-form id="discovery">{json}</question-form>│
│  Turn 3+: TodoWrite 9 步计划 → Write index.html → 自我批判       │
│  stdout 流式返回文本（含 question-form 标记）                     │
└────────────────────────────────────────────────────────────────────┘
```

**核心思想**：
1. 提示词栈由 **Electron 主进程 `composeSystemPrompt()` 组装**，通过 `--system-prompt` 注入（完全替换默认 system prompt），非 design 模式保持 `--append-system-prompt` 不变
2. DESIGN.md + tokens.css 由**提示词栈第 9 层注入**（非前端 user message 拼接），agent 被要求将 tokens.css 逐字粘进工件 `:root`
3. filesystem 模式：agent 直接 **Write 文件到磁盘**，预览通过 **chokidar 文件监听 → 读文件 → buildSrcdoc → iframe** 实现（MVP 主路径）
4. question-form：agent 输出纯文本 `<question-form>` 标记，前端解析渲染交互表单，用户答后以特定格式回传
5. artifact parser 仅作为 **text_artifact 模式可选 fallback**（MVP 不需要）
6. engine 完全复用，仅传不同 agent 名 + cwd + systemPrompt

---

## 6. 可复用性清单

### 6.1 可直接 copy（内容资产 / 纯函数 / 协议）

| 来源（open-design） | 目标（SpaceCode） | 说明 |
|---------------------|------------------|------|
| `design-systems/`（150+ 目录） | `design-systems-lib/`（新建，参照 skills-lib 模式） | DESIGN.md + tokens.css 等内容资产。**注意保留各目录 LICENSE**。MVP 可先 copy 10-20 个常用系统（stripe/linear-app/apple/github/vercel/notion/figma/anthropic/cursor/supabase） |
| **`apps/daemon/src/prompts/system.ts`** | **`electron/design/prompts/system.ts`** | **提示词栈组装器 `composeSystemPrompt()` + `derivePreflight()`。设计模式的灵魂，必须移植** |
| **`apps/daemon/src/prompts/discovery.ts`** | **`electron/design/prompts/discovery.ts`** | **发现层 RULE 1/2/3 + 设计哲学 + 表单模板** |
| **`apps/daemon/src/prompts/official-system.ts`** | **`electron/design/prompts/official-system.ts`** | **身份章程 `OFFICIAL_DESIGNER_PROMPT` + anti-AI-slop 清单。huashu-design 可作中文本地化来源** |
| **`apps/daemon/src/prompts/directions.ts`** | **`electron/design/prompts/directions.ts`** | **`DESIGN_DIRECTIONS` 5 视觉方向 + OKLch palette + 字体栈** |
| **`apps/daemon/src/prompts/deck-framework.ts`** | **`electron/design/prompts/deck-framework.ts`** | **幻灯片骨架（后置）** |
| **`apps/daemon/src/prompts/panel.ts`** | **`electron/design/prompts/panel.ts`** | **5 维批判面板** |
| **`apps/daemon/src/prompts/media-contract.ts`** | **`electron/design/prompts/media-contract.ts`** | **媒体契约** |
| **`apps/web/src/artifacts/question-form.ts`** | **`src/utils/design/questionForm.ts`** | **question-form 解析器：`splitOnQuestionForms()` / `findFirstQuestionForm()`，684 行纯 TS** |
| `apps/web/src/artifacts/parser.ts` | `src/lib/artifacts/parser.ts` | 纯 TS generator，框架无关。需同时 copy `markdown-context.ts`。**仅 text_artifact 模式需要，MVP 可选** |
| `apps/web/src/artifacts/markdown-context.ts` | `src/lib/artifacts/markdown-context.ts` | parser 依赖（仅 text_artifact 模式） |
| `apps/daemon/src/inline-assets.ts` | `src/lib/artifacts/inline-assets.ts` | 纯字符串处理，导出时 inline 相对资源。需适配 fileReader |
| `skills/` 中 design 相关 skill（如 `minimalist-ui`、`web-prototype`） | `skills-lib/`（按需） | 与现有 SKILL.md 格式兼容。检查是否与现有 ui-ux-pro-max 重复 |
| DESIGN.md 9 段 schema | 文档参考 | `design-systems/_schema/` |

### 6.2 需参考重写（React → Vue3）

| open-design 模块 | SpaceCode 对应 | 重写要点 |
|------------------|---------------|---------|
| `apps/web/src/components/ProjectView.tsx`（367KB） | `src/components/design/DesignPage.vue` | 三栏布局，Vue3 `<script setup>` + scoped SCSS |
| `apps/web/src/components/FileViewer.tsx`（489KB） | `src/components/design/DesignPreview.vue` | sandbox iframe + postMessage。**拆小**：preview 组件 + `useIframeTransport` composable |
| `apps/web/src/components/ChatComposer.tsx` | `src/components/design/BriefEditor.vue` + `DesignSystemPicker.vue` | brief 输入 + 选择器 |
| `apps/web/src/runtime/srcdoc.ts`（116KB） | `src/lib/artifacts/srcdoc.ts` | bridge 注入逻辑。MVP 只实现 sanitizeTitle + sandboxShim + transportActivation 三个 |
| `apps/web/src/runtime/exports.ts` | `src/lib/artifacts/exports.ts` | exportAsHtml/Zip/Md 纯函数可 copy；PDF 调 Electron `webContents.print` |
| `apps/web/src/components/AssistantMessage.tsx` | `src/components/design/DesignMessage.vue`（可选） | 流式消息渲染，参考其 artifact 卡片 |

### 6.3 需新建（open-design 无对应）

| 模块 | 说明 |
|------|------|
| `src/stores/design.ts` | design 会话状态、当前 brief、选中 designSystem/skill/direction、预览 html、产物列表、pendingQuestionForm |
| `src/components/design/DesignPage.vue` | 主页面 |
| `src/components/design/DesignArtifactList.vue` | 产物列表（参考 ArtifactsPanel.vue） |
| **`src/components/design/QuestionForm.vue`** | **question-form 渲染组件，支持 17 种控件 + direction-cards** |
| **`src/components/design/DirectionPicker.vue`** | **5 视觉方向选择器（无 DS 时显示）** |
| **`electron/design/designSystems.ts`** | **设计系统服务：扫描 design-systems-lib/，解析 frontmatter + 提取 swatches，IPC 注册** |
| **`electron/design/designSkills.ts`** | **设计技能服务：扫描 od: frontmatter 技能，IPC 注册** |
| **`electron/design/fileWatcher.ts`** | **chokidar 文件监听：监听设计工作目录，IPC 推送 design:file-changed** |
| `src/composables/useIframeTransport.ts` | 封装 postMessage `od:srcdoc-transport-activate` 协议 |
| `src/composables/useDesignSession.ts` | 封装 design 会话启动 + 流式接收 + question-form 解析 + 文件监听 |
| `design-systems-lib/` | 新目录（参照 skills-lib 打包进 extraResources） |
| i18n key | `src/i18n/locales/zh-CN.ts` + `en-US.ts` 加 `design.*` |

### 6.4 不需要引入（明确排除）

| open-design 模块 | 排除理由 |
|------------------|---------|
| `apps/daemon/`（Express + SQLite） | SpaceCode 已有 engine + IPC，无需独立后端 |
| `apps/web/`（Next.js） | SpaceCode 用 Vue3 |
| `packages/sidecar*`（JSON-line IPC） | SpaceCode 单进程，用 Electron IPC 即可 |
| `packages/host/`（host bridge） | SpaceCode 已有 preload.ts contextBridge |
| 25 个 agent 适配器 defs | SpaceCode engine 已封装 Claude Code CLI 调用 |
| HMAC 门控（PR #974） | SpaceCode 无「文件夹导入 daemon」场景 |

---

## 7. 功能点详细设计

### F1 — 新增 design 模式与 DesignPage 骨架

**目标**：ModeTabs 出现第三个「Design」tab，点击后中间面板渲染 DesignPage。

**改动点**：

1. `src/stores/app.ts:81` — 扩展类型：
   ```ts
   export type AppMode = 'work' | 'code' | 'design'
   ```
   `setMode`（第 640 行）已通用，无需改逻辑。`_initialMode`（第 124 行）从 localStorage 读取，自动支持 design。

2. `src/components/layout/ModeTabs.vue` — 加第三个 tab：
   ```vue
   <button
     class="mode-tab"
     :class="{ active: appStore.mode === 'design' }"
     role="tab"
     :aria-selected="appStore.mode === 'design'"
     @click="handleSelect('design')"
   >
     <Palette :size="14" />
     <span>{{ t('mode.design') }}</span>
   </button>
   ```
   import 加 `Palette` from `lucide-vue-next`。

3. `src/App.vue` — 中间面板条件链（第 26-36 行）加入：
   ```vue
   <DesignPage v-else-if="appStore.mode === 'design'" />
   ```
   置于 `SplitContainer` 之前。import `DesignPage from './components/design/DesignPage.vue'`。

4. `src/components/layout/Sidebar.vue` — `filteredSessions`（约第 370 行）加 design 分支：design 模式下显示 `session.mode === 'design'` 的会话；`handleModeSelect`（约第 392 行）扩展处理 design：切换会话过滤、创建新会话时 `createSession` 自动带 `mode: appStore.mode`（已支持）。

5. 新建 `src/components/design/DesignPage.vue` — 三栏布局骨架（header + 左/中/右栏，用 flex + `var(--bg-primary)` 等主题变量）。

**验收**：点击 ModeTabs 的 Design tab → 中间显示 DesignPage 骨架，sidebar 会话列表切换为 design 模式会话，刷新应用后 mode 持久化。

---

### F2 — brief 输入 + design system / skill 选择

**目标**：DesignPage 左栏提供 brief 文本框 + design system 选择器 + skill/agent 选择器。

**组件**：
- `src/components/design/BriefEditor.vue` — textarea + 模板快捷按钮（如「落地页」「Dashboard」「移动端 App」）+ 附件支持（可选）
- `src/components/design/DesignSystemPicker.vue` — 列出 `design-systems-lib/` 下的系统（读 manifest 或 DESIGN.md frontmatter），按 category 分组，含搜索
- `src/components/design/SkillPicker.vue`（或复用 agent 选择）— 列出 design 相关 skill/agent（`api.skills.getBundledSkills()` 过滤 category=design，或 `api.agents.scanLibrary(cwd)` 过滤 mode/design）

**design system 资源加载**：
- 新增 IPC：`electron/skillsService.ts` 或新 service 扫描 `design-systems-lib/` 返回 `{id, name, category, designMdPath}[]`
- 或前端通过 `api.readFile` 读取 manifest.json（若已在 extraResources）
- MVP 可硬编码一个 design system 列表（从 copy 过来的目录枚举）

**design system 目录部署**：参照 `skills-lib` 在 `package.json` 的 `build.extraResources` 加入：
```json
{ "from": "design-systems-lib", "to": "design-systems-lib" }
```

**验收**：左栏能输入 brief、从下拉选择 Stripe/Linear 等 design system、选择 ui-ux-pro-max agent。

---

### F3 — 提示词栈组装与注入（核心）

**目标**：点击「生成」后，组装完整 23 层提示词栈，通过 `--system-prompt` 注入，启动 design 会话。

**核心逻辑**（`electron/design/prompts/system.ts` + `src/composables/useDesignSession.ts`）：

```ts
// === Electron 主进程：提示词栈组装 ===
// electron/design/prompts/system.ts
import { composeSystemPrompt } from './system'
import { readDesignSystemAssets } from '../designSystems'

async function composeDesignPrompt(input: {
  designSystemId?: string
  skillBody?: string
  skillName?: string
  locale: string
}) {
  let designSystem: DesignSystemAssets | undefined
  if (input.designSystemId) {
    designSystem = await readDesignSystemAssets('design-systems-lib', input.designSystemId)
  }
  return composeSystemPrompt({
    sessionMode: 'design',
    executionProfile: 'filesystem',  // SpaceCode = filesystem 模式
    locale: input.locale,
    skillBody: input.skillBody,
    skillName: input.skillName,
    designSystemBody: designSystem?.designMd,
    designSystemTitle: input.designSystemId,
    designSystemTokensCss: designSystem?.tokensCss,  // 逐字粘进工件 :root
    designSystemComponentsManifest: designSystem?.componentsManifest,
    critique: true,  // 启用 5 维批判
  })
}

// === 渲染进程：启动 design 会话 ===
// src/composables/useDesignSession.ts
async function startGeneration(brief: string, designSystemId: string, agentName: string) {
  // 1. 创建会话（mode 自动为 'design'）
  const session = chatStore.createSession(`Design: ${brief.slice(0, 20)}`, designWorkspace.value)

  // 2. 初始化 session，注入提示词栈（chatSession.ts initClaudeCodeSession 扩展）
  // design 模式时 config.systemPrompt = composeDesignPrompt() 的输出
  // 非 design 模式保持现有 --append-system-prompt 行为不变
  await chatStore.initClaudeCodeSession(session.id, {
    designMode: true,  // 触发提示词栈组装
    designSystemId,
    agentName,
  })

  // 3. 发送 brief（纯用户输入，不含 DESIGN.md —— 那已在 system prompt 里）
  await chatStore.sendMessage(session.id, brief)

  // 4. 订阅流式事件 → 接入 question-form 解析（见 F6）+ 文件监听（见 F4）
}
```

**关键点**：
- **DESIGN.md + tokens.css 不再拼进 user message**，而是通过提示词栈第 9 层注入到 system prompt
- `createSession(title, workingDirectory)` 第二参指定 cwd（design 工作区，建议独立目录如 `~/.spacecode/design-workspace/`）
- `initClaudeCodeSession` 扩展：design 模式时调 `composeDesignPrompt()` 组装提示词栈，通过 `config.systemPrompt` 传入 `--system-prompt`；非 design 模式保持 `--append-system-prompt` 不变
- 提示词栈含 `FILESYSTEM_HANDOFF_OVERRIDE`，agent 会用 Write 工具写文件到 cwd
- 同时通过 `api.artifacts.startWatch(designWorkspace + '/outputs')` 监听新产物

**chatSession.ts 修改要点**（`initClaudeCodeSession`，约第 623 行）：
```ts
// design 模式：用 --system-prompt 完全替换
if (session.mode === 'design') {
  config.systemPrompt = await composeDesignPrompt({
    designSystemId: session.designSystemId,
    skillBody: session.designSkillBody,
    skillName: session.designSkillName,
    locale: i18n.locale.value,
  })
  // 不设 appendSystemPrompt
} else {
  // 非 design 模式：保持现有 --append-system-prompt 行为
  config.appendSystemPrompt = 现有逻辑
}
```

**验收**：点击生成 → agent 按设计师章程工作（输出 question-form / TodoWrite / 5 维批判）→ outputs/design/ 出现 .html 文件。

---

### F4 — filesystem 模式文件监听预览（核心）

**目标**：中栏通过文件监听实时预览 agent 写入的 HTML 文件。SpaceCode 使用 `executionProfile='filesystem'`，agent 直接 Write 文件到磁盘，**不需要 artifact parser**（那是 text_artifact 模式的 fallback）。

**步骤**：

1. **新建 `electron/design/fileWatcher.ts`**（chokidar 文件监听）：
   ```ts
   import chokidar from 'chokidar'
   
   // 监听设计工作目录，文件变化时 IPC 推送
   export function startDesignFileWatcher(sessionId: string, workspaceDir: string) {
     const watcher = chokidar.watch(workspaceDir, {
       ignored: /node_modules|\.git/,
       persistent: true,
       ignoreInitial: true,
     })
     watcher.on('change', (filepath) => {
       if (filepath.endsWith('.html') || filepath.endsWith('.css') || filepath.endsWith('.js')) {
         mainWindow.webContents.send('design:file-changed', { sessionId, filepath })
       }
     })
     return watcher
   }
   ```

2. **新建 `src/lib/artifacts/srcdoc.ts`**（Vue3 版，参考 open-design）：
   ```ts
   export function buildSrcdoc(html: string): string {
     let doc = html
     if (!/<html|<!doctype/i.test(html)) {
       doc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
     }
     doc = sanitizeTitle(doc)
     doc = injectSandboxShim(doc)
     doc = injectTransportActivation(doc)
     return doc
   }
   ```
   MVP 实现 3 个 bridge：
   - `sanitizeTitle` — 清理/截断 `<title>`
   - `injectSandboxShim` — 拦截 `window.open/alert/confirm`，改为 postMessage 通知宿主
   - `injectTransportActivation` — 监听 `od:srcdoc-transport-activate` 消息，`document.open/write/close` 替换内容（绕过 srcdoc 大小限制，支持流式更新）

3. **新建 `src/components/design/DesignPreview.vue`**：
   ```vue
   <template>
     <div class="design-preview">
       <div class="preview-toolbar">
         <span>{{ title }}</span>
         <button @click="refresh">刷新</button>
         <button @click="exportHtml">导出</button>
       </div>
       <iframe
         ref="iframeRef"
         sandbox="allow-scripts allow-popups allow-downloads"
         class="preview-iframe"
         @load="onLoad"
       />
     </div>
   </template>
   <script setup lang="ts">
   import { watch, ref, onMounted, onUnmounted } from 'vue'
   import { buildSrcdoc } from '@/lib/artifacts/srcdoc'
   import { api } from '@/services/electronAPI'

   const props = defineProps<{ html: string; title: string; sessionId: string }>()
   const iframeRef = ref<HTMLIFrameElement>()

   // 监听文件变化（filesystem 模式主路径）
   onMounted(() => {
     api.onDesignFileChanged(({ sessionId, filepath }) => {
       if (sessionId !== props.sessionId) return
       if (filepath.endsWith('.html')) {
         refreshPreview(filepath)
       }
     })
   })

   async function refreshPreview(filepath: string) {
     const html = await api.readFile(filepath)
     updateIframe(html)
   }

   function updateIframe(html: string) {
     const iframe = iframeRef.value
     if (!iframe) return
     if (!iframe.srcdoc) {
       iframe.srcdoc = buildSrcdoc(html)
     } else {
       iframe.contentWindow?.postMessage(
         { type: 'od:srcdoc-transport-activate', html: buildSrcdoc(html) },
         '*'
       )
     }
   }

   // 也支持直接传入 html（text_artifact 模式可选 fallback）
   watch(() => props.html, (html) => { if (html) updateIframe(html) })
   </script setup>
   ```

   **关键**：`sandbox` 不含 `allow-same-origin`，宿主无法读 `contentDocument`，所有交互走 postMessage。

4. **新建 `src/composables/useIframeTransport.ts`** — 封装 postMessage 协议（接收 iframe 内的 selection/snapshot 请求）。

5. **可选：artifact parser（text_artifact 模式 fallback）**：
   - copy `parser.ts` + `markdown-context.ts` 到 `src/lib/artifacts/`
   - 仅当 agent 意外输出 `<artifact>` 块时启用（filesystem 模式正常不应出现）
   - 接入流式事件解析 artifact chunk → updateIframe

**验收**：生成过程中 agent Write index.html → 文件监听触发 → iframe 实时显示 HTML 变化；iframe 内脚本无法访问 `window.parent` 的 cookie/localStorage；点击 iframe 内链接不跳转父窗口。

---

### F5 — 产物列表 + 导出

**目标**：右栏列出 outputs/design/ 产物，支持预览与导出。

**产物列表**（`src/components/design/DesignArtifactList.vue`，参考 `src/components/work/ArtifactsPanel.vue`）：
```ts
api.artifacts.startWatch(designWorkspace + '/outputs')
api.artifacts.onChanged(({ eventType, filename }) => {
  if (filename.endsWith('.html')) {
    designStore.refreshArtifactList()
  }
})
```
点击产物 → `designStore.previewUrl = fileUrl` → 中栏 iframe 切换显示该文件内容（`api.readFile` 读 HTML → buildSrcdoc → postMessage）。

**导出菜单**（`src/lib/artifacts/exports.ts`）：
- **HTML**：`buildSrcdoc(html)` → Blob → `<a download>`
- **ZIP**：用 JSZip 打包 index.html + DESIGN-HANDOFF.md（参考 open-design `buildDesignHandoffContent`）
- **MD**：直接下载源码
- **PDF**：调用 Electron `webContents.print`（需新增 IPC `design:export-pdf`，在 main 进程用隐藏 BrowserWindow 加载 HTML 后 print）
- **截图**：postMessage `od:snapshot` 给 iframe，iframe 内 bridge 用 `html2canvas` 或 Canvas API 生成 dataURL 回传

**验收**：产物列表实时更新；点击产物在 iframe 预览；导出 HTML/ZIP/PDF 成功。

---

### F6 — question-form 发现协议（核心）

**目标**：解析 agent 输出的 `<question-form>` 标记，渲染交互表单，用户答后回传。

**步骤**：

1. **copy 解析器**：`open-design/apps/web/src/artifacts/question-form.ts` → `src/utils/design/questionForm.ts`
   ```ts
   export function splitOnQuestionForms(input: string): Segment[]
   export function findFirstQuestionForm(input: string): QuestionFormBlock | null
   ```
   正则 `/<(question-form|ask-question)\b([^>]*)>([\s\S]*?)<\/\1>/i`，body 是 JSON。注意跳过 markdown 代码围栏内的伪标记。

2. **接入流式**（`chatStream.ts` 约第 345 行 `text_delta` 累积处）：
   ```ts
   // design 模式会话额外处理 question-form
   if (session.mode === 'design') {
     const form = findFirstQuestionForm(accumulatedContent)
     if (form && !session.pendingQuestionForm) {
       // 1. 把表单段从消息文本中剥离
       const segments = splitOnQuestionForms(accumulatedContent)
       const textOnly = segments.filter(s => s.type === 'text').map(s => s.text).join('')
       // 2. 写入 session 状态
       session.pendingQuestionForm = form
       // 3. 更新消息文本（去除表单标记）
       message.content = textOnly
       // 4. 触发 UI 渲染
       designStore.setPendingQuestionForm(form)
     }
   }
   ```

3. **新建 `src/components/design/QuestionForm.vue`**：
   - 支持 17 种控件：radio/checkbox/select/text/textarea/number/range/date/time/datetime-local/color/url/email/tel/file/switch
   - **direction-cards** 特殊类型：渲染 5 方向卡（色板 swatch + 字体 "Aa" 样本 + mood 描述）
   - 表单提交后，用 `[form answers — discovery] {json}` 格式作为下一条 user message 发送：
   ```ts
   function submitForm(answers: Record<string, unknown>) {
     const response = `[form answers — discovery] ${JSON.stringify(answers)}`
     chatStore.sendMessage(session.id, response)
     designStore.clearPendingQuestionForm()
   }
   ```

4. **UI 布局**：Questions 面板可放在右栏或中栏底部（参考 open-design 的 inline 渲染）。

**验收**：agent 首轮输出 `<question-form>` → 前端渲染表单 → 用户填写提交 → agent 继续工作。direction-cards 渲染 5 方向卡。

---

### F7 — 身份章程 + 5 维批判 + preflight（提示词栈配套）

**目标**：移植 open-design 的身份章程、5 维批判、preflight 逻辑，确保 agent 按设计师章程工作。

**步骤**：

1. **移植 `official-system.ts`** → `electron/design/prompts/official-system.ts`
   - `OFFICIAL_DESIGNER_PROMPT` 定义设计师身份
   - anti-AI-slop 清单（禁紫色渐变/emoji 图标/Inter 字体等）
   - **中文本地化**：直接使用 `skills-lib/huashu-design/SKILL.md` 的内容作为中文版身份章程

2. **移植 `directions.ts`** → `electron/design/prompts/directions.ts`
   - `DESIGN_DIRECTIONS` 5 视觉方向（editorial/modern-minimal/human/tech/brutalist）
   - 每方向含 OKLch palette + 字体栈 + mood 描述
   - 无激活 DS 时由提示词栈第 5 层追加 `renderDirectionSpecBlock()`

3. **移植 `panel.ts`** → `electron/design/prompts/panel.ts`
   - 5 维批判（哲学一致/视觉层级/细节打磨/功能性/创新性，各 10 分）
   - 提示词栈第 15 层注入，agent 完成设计后自我评审
   - **渲染**：复用现有 ToolCard 组件渲染批判结果

4. **preflight 逻辑**（内嵌在 `system.ts` 的 `derivePreflight()` 函数中）
   - 正则扫描 skill body 引用的 side files
   - 注入"Pre-flight: 先 Read 这些文件"指令

5. **od: frontmatter 扩展**：为设计技能 SKILL.md 加 `od:` 块
   ```yaml
   od:
     mode: prototype          # prototype|deck|template
     surface: web
     scenario: marketing
     design_system: { requires: false }
     craft: { requires: [...] }
     critique: { policy: required }
     preview: { type: html, entry: index.html }
   ```
   `skillsService.ts` 扩展：扫描带 `od:` frontmatter 的技能，解析为 `DesignSkillInfo`

**验收**：agent 输出符合设计师章程（无 AI slop）；完成设计后输出 5 维批判；有 side files 的技能触发 preflight Read 指令。

---

## 8. 实现步骤（分阶段）

### 阶段 1：模式骨架（F1）
1. 扩展 `AppMode` 加 `'design'`
2. ModeTabs 加 Palette tab + i18n key
3. App.vue 加 DesignPage 渲染分支
4. Sidebar filteredSessions 加 design 分支
5. 新建 `DesignPage.vue` 骨架（三栏空壳）
6. 新建 `src/stores/design.ts` 基础状态

**验证**：能切换到 design 模式，看到空骨架页面，模式持久化。

### 阶段 2：资源准备 + 选择器（F2）
1. copy 10-20 个常用 design-system 目录到 `design-systems-lib/`
2. `package.json` build.extraResources 加 design-systems-lib
3. 新增 IPC 扫描 design-systems-lib 返回列表（`electron/skillsService.ts` 或新 `designSystemService.ts`）
4. 新建 BriefEditor + DesignSystemPicker + SkillPicker 组件
5. design store 加 selectedDesignSystem / selectedAgent / brief 状态

**验证**：左栏可选择 design system 与 agent，输入 brief。

### 阶段 3：提示词栈组装 + 注入（F3 + F7 前半）— ★ 核心阶段
1. copy open-design prompt 模块到 `electron/design/prompts/`：
   - `system.ts`（composeSystemPrompt 23 层逻辑）
   - `official-system.ts`（身份章程 OFFICIAL_DESIGNER_PROMPT）
   - `directions.ts`（5 视觉方向 + renderDirectionSpecBlock）
   - `panel.ts`（5 维批判面板）
2. 本地化：用 `skills-lib/huashu-design/SKILL.md` 替换/增强 `official-system.ts` 的中文版身份章程
3. 新建 `electron/design/promptStack.ts`：封装 `composeSystemPrompt(ComposeInput)` → 返回完整 system prompt 字符串
4. 扩展 `electron/claudeCodeIPC.ts`：spawn Claude Code CLI 时，若 session.mode==='design'，加 `--system-prompt` 参数注入组装好的提示词栈
5. 扩展 `src/stores/chatSession.ts` 的 `initClaudeCodeSession`：design 模式传递 `systemPromptOverride` 参数
6. 验证 preflight 逻辑：`derivePreflight()` 扫描 skill body 中的 side files 引用

**验证**：design 模式会话启动时，agent 收到的 system prompt 包含身份章程 + 设计系统 + 5 维批判规则；可通过日志确认 23 层均已注入。

### 阶段 4：filesystem 模式文件监听预览（F4）— ★ 核心阶段
1. 新建 `electron/design/fileWatcher.ts`（chokidar 监听 design 工作目录）
2. 新建 `src/lib/artifacts/srcdoc.ts`（Vue3 版 3 核心 bridge：sanitizeTitle / injectSandboxShim / injectTransportActivation）
3. 新建 `useDesignSession.ts` + `useIframeTransport.ts` composables
4. 新建 `DesignPreview.vue`（sandboxed iframe，主路径走文件监听）
5. 实现「生成」按钮：createSession（携带 systemPromptOverride）→ sendMessage → 文件监听触发 → iframe 实时更新
6. 配置 design 工作区 cwd（如 `~/.spacecode/design-workspace/`），chokidar 监听 .html/.css/.js 变化
7. **可选 fallback**：copy `parser.ts` + `markdown-context.ts` 到 `src/lib/artifacts/`，仅当 agent 意外输出 `<artifact>` 块时启用

**验证**：输入 brief + 选 Stripe → 生成 → agent Write index.html → 文件监听触发 → iframe 实时显示 HTML 变化，outputs/ 出现 .html 文件。

### 阶段 5：question-form 发现协议（F6）
1. copy `question-form.ts` 解析器到 `src/utils/design/questionForm.ts`
2. 接入 `chatStream.ts` 流式处理：design 模式额外解析 `<question-form>` 标记
3. 新建 `QuestionForm.vue`（17 种控件 + direction-cards 特殊类型）
4. 表单提交后以 `[form answers — discovery] {json}` 格式回传

**验证**：agent 首轮输出 question-form → 前端渲染表单 → 用户填写提交 → agent 继续。

### 阶段 6：产物管理 + 导出（F5）
1. 新建 `DesignArtifactList.vue`（参考 ArtifactsPanel）
2. 点击产物在 iframe 预览
3. 实现导出 HTML/ZIP/MD（客户端纯函数）
4. 实现 PDF 导出（Electron `webContents.print` IPC）
5. 实现截图（postMessage `od:snapshot`）

**验证**：产物列表实时更新，导出各格式成功。

### 阶段 7：打磨
1. 补齐 srcdoc bridge（selection comment / palette / manualEdit，按需）
2. design 模式专属 agent：新建 `agents-lib/design/design-generator.md`（mode: design, skills: [ui-ux-pro-max]）
3. i18n 全量补齐（zh-CN + en-US）
4. 主题适配验证（4 套主题下 design 页面表现）
5. 错误处理与重试（参考 chatStream 的自动重试）

---

## 9. 关键文件清单

### 9.1 需修改的现有文件

| 文件 | 修改要点 |
|------|---------|
| `src/stores/app.ts` | 第 81 行 `AppMode` 加 `'design'`；可选加 `designWorkspace` 状态（参照 workWorkspace） |
| `src/components/layout/ModeTabs.vue` | 加第三个 Palette tab 按钮 |
| `src/components/layout/Sidebar.vue` | `filteredSessions` 加 design 分支；`handleModeSelect` 处理 design |
| `src/App.vue` | 第 26-36 行条件链加 `<DesignPage v-else-if="appStore.mode==='design'">` |
| `src/i18n/locales/zh-CN.ts` + `en-US.ts` | 加 `mode.design` + `design.*` 系列 key |
| `package.json` | `build.extraResources` 加 `design-systems-lib` |
| `electron/preload.ts` | 新增 design IPC bridge：`onDesignFileChanged`、`readFile`、`startDesignFileWatcher`、`composePromptStack`、`export-pdf` |
| `electron/main.ts` | 注册 design 相关 IPC handler（文件监听、提示词栈组装、PDF 导出） |
| `electron/claudeCodeIPC.ts` | **关键**：spawn Claude Code CLI 时，若 session.mode==='design'，加 `--system-prompt` 参数注入组装好的提示词栈 |
| `electron/skillsService.ts` | 加扫描 design-systems-lib 的 IPC handler；扩展 `od:` frontmatter 解析为 `DesignSkillInfo` |
| `src/services/electronAPI.ts` | 新增 design API surface：`onDesignFileChanged`、`readFile`、`composePromptStack` 等 |
| `src/stores/chatSession.ts` | `initClaudeCodeSession`（第 623 行）扩展：design 模式传递 `systemPromptOverride` 参数 |
| `src/stores/chatStream.ts` | 约第 345 行 `text_delta` 累积处：design 模式额外解析 `<question-form>` 标记 |

### 9.2 需新增的文件

#### 9.2.1 Electron 主进程（提示词栈 + 文件监听）

| 文件 | 职责 |
|------|------|
| `electron/design/promptStack.ts` | **核心**：封装 `composeSystemPrompt(ComposeInput)` → 23 层提示词栈组装 → 返回完整 system prompt 字符串 |
| `electron/design/fileWatcher.ts` | chokidar 监听 design 工作目录，文件变化时 IPC 推送 `design:file-changed` |
| `electron/design/prompts/system.ts` | **copy 自 open-design**：23 层 composeSystemPrompt 逻辑 + derivePreflight |
| `electron/design/prompts/official-system.ts` | **copy + 本地化**：OFFICIAL_DESIGNER_PROMPT 身份章程（中文版用 huashu-design） |
| `electron/design/prompts/directions.ts` | **copy 自 open-design**：5 视觉方向 + renderDirectionSpecBlock |
| `electron/design/prompts/panel.ts` | **copy 自 open-design**：5 维批判面板提示词 |

#### 9.2.2 渲染进程（Vue3 组件 + 工具）

| 文件 | 职责 |
|------|------|
| `src/components/design/DesignPage.vue` | 主页面三栏布局 |
| `src/components/design/BriefEditor.vue` | brief 输入 + 模板 |
| `src/components/design/DesignSystemPicker.vue` | design system 选择器 |
| `src/components/design/SkillPicker.vue` | skill/agent 选择器 |
| `src/components/design/DesignPreview.vue` | sandboxed iframe 预览（主路径：文件监听） |
| `src/components/design/DesignArtifactList.vue` | 产物列表 + 导出菜单 |
| `src/components/design/QuestionForm.vue` | question-form 交互表单（17 种控件 + direction-cards） |
| `src/stores/design.ts` | design 状态管理 |
| `src/composables/useDesignSession.ts` | 会话启动 + 流式 + 文件监听接入 |
| `src/composables/useIframeTransport.ts` | postMessage 协议封装 |
| `src/utils/design/questionForm.ts` | **copy 自 open-design**：splitOnQuestionForms / findFirstQuestionForm 解析器 |
| `src/lib/artifacts/srcdoc.ts` | Vue3 版 bridge 注入（参考重写） |
| `src/lib/artifacts/exports.ts` | 客户端导出纯函数（参考重写） |
| `src/lib/artifacts/inline-assets.ts` | **copy 自 open-design**（导出时 inline 资源） |
| `src/lib/artifacts/parser.ts` | **copy 自 open-design**（仅 text_artifact 模式 fallback） |
| `src/lib/artifacts/markdown-context.ts` | **copy 自 open-design**（parser 依赖） |
| `design-systems-lib/` | **copy 自 open-design**（10-20 个常用系统起步） |
| `agents-lib/design/design-generator.md` | 可选：design 模式专属 agent |

---

## 10. 验收标准

1. **模式切换**：ModeTabs 出现 Design tab，点击切换，刷新后持久化
2. **资源选择**：能从 10+ design system 中选择，能选 design 类 agent
3. **提示词栈注入**：design 模式会话启动时，agent 收到的 system prompt 包含身份章程 + 设计系统 + 5 维批判规则（通过日志确认 23 层注入）
4. **生成闭环**：输入 brief + 选 Stripe + ui-ux-pro-max → 生成符合 Stripe 设计风格的 HTML 落地页
5. **filesystem 模式预览**：agent Write index.html → 文件监听触发 → iframe 实时显示 HTML 变化，无白屏闪烁
6. **安全隔离**：iframe 内 `window.parent.document` 访问被浏览器拦截（sandbox 生效）
7. **产物落盘**：outputs/design/ 出现 .html 文件，产物列表实时更新
8. **question-form**：agent 首轮输出 `<question-form>` → 前端渲染表单 → 用户填写提交 → agent 继续工作
9. **身份章程**：agent 输出符合设计师章程（无 AI slop：无紫色渐变、无 emoji 图标、无 Inter 字体滥用）
10. **5 维批判**：agent 完成设计后输出 5 维批判（哲学一致/视觉层级/细节打磨/功能性/创新性，各 10 分）
11. **导出**：HTML/ZIP/PDF 导出成功，HTML 导出文件双击可在浏览器打开
12. **主题适配**：light/dark/anthropic/anthropic-dark 四套主题下 design 页面样式正常
13. **i18n**：中英文切换后 design 页面文案正确
14. **类型安全**：`npm run typecheck` 通过，无 `any`

---

## 11. 风险与注意事项

### 11.1 安全
- **iframe sandbox 必须不含 `allow-same-origin`**：否则 agent 生成的恶意 HTML 可访问父窗口。这是 open-design 的核心安全边界，不可妥协。
- **DESIGN.md 内容注入 prompt**：DESIGN.md 是 Markdown，拼进 prompt 前无需转义，但要警惕 prompt injection（design system 来自第三方，应来自可信 copy）。
- **产物 HTML 执行**：agent 生成的 HTML 在 sandbox iframe 内执行，已隔离；但导出后用户自行打开无 sandbox，属用户行为。

### 11.2 兼容性
- **engine 不改，electron 层注入**：不改 `engine/` 目录（遵守 CLAUDE.md），但通过 `electron/claudeCodeIPC.ts` 在 spawn CLI 时加 `--system-prompt` 参数，实现主进程级提示词栈注入。这是比前端 user message 拼接更可靠的方案，确保 system prompt 完全替换而非追加。
- **`--system-prompt` 兼容性**：需确认 SpaceCode 使用的 Claude Code CLI 版本支持 `--system-prompt` 参数。若不支持，fallback 为在 user message 前缀拼接（降级方案）。
- **SKILL.md 兼容**：open-design 的 skill 与 SpaceCode 现有格式兼容，但 `od:` 扩展 frontmatter 字段 SpaceCode engine 不识别——这些字段仅用于前端 UI 分组展示与提示词栈组装，不影响 engine 加载。
- **design-systems-lib 打包**：参照 skills-lib 加入 `build.extraResources`，否则打包后找不到资源。

### 11.3 性能
- **文件监听节流**：filesystem 模式下 chokidar 可能在短时间内触发多次 change 事件（agent 连续 Write），需做防抖（如 200ms 内只更新一次 iframe）。
- **transport activation 更新**：用 transport activation（document.write）而非重新设 srcdoc，避免重载，并考虑节流。
- **parser holdback**（fallback 模式）：流末尾不完整 `<artifact` 标签会被 holdback，需确保 `flush()` 在流结束时调用，否则末尾 artifact 丢失。

### 11.4 许可证
- open-design 是 Apache-2.0，copy 的 design-systems/ 部分目录可能有各自 LICENSE（如 guizang-ppt 是 MIT）。**copy 时保留原 LICENSE 文件**。
- `design-systems/` 来源标注 `VoltAgent/awesome-design-md`，应在文档/README 注明出处。

### 11.5 边界
- **不改 engine**：不改 `engine/` 目录（遵守 CLAUDE.md）。提示词栈注入通过 electron 层 `--system-prompt` 参数实现，不修改 engine 本身。若需更深集成（如 engine 原生支持 design system 注入），需另立议题。
- **PPTX/视频导出**：open-design 的 PPTX/HyperFrames 较重，MVP 不纳入，后续按需迭代。
- **多 agent 适配**：SpaceCode engine 主要支持 Claude Code CLI，open-design 的 25 agent 适配器不纳入。

---

## 12. 与 open-design 的能力对照

| open-design 能力 | SpaceCode 复刻方案 | 状态 |
|------------------|-------------------|------|
| daemon spawn agent CLI | engine + `api.claudeCode` IPC | ✅ 复用现有 |
| SSE 流式 | IPC `onStreamEvent` 事件流 | ✅ 复用现有 |
| **提示词栈 23 层组装** | electron 主进程 `composeSystemPrompt` + `--system-prompt` 注入 | ✅ 主进程注入（核心复刻） |
| **filesystem 执行模式** | chokidar 文件监听 → iframe 实时预览 | ✅ 核心复刻 |
| **question-form 发现协议** | copy 解析器 + Vue3 QuestionForm 组件 | ✅ 直接 copy + 重写 |
| **身份章程（Official Designer）** | copy official-system.ts + huashu-design 本地化 | ✅ 直接 copy + 本地化 |
| **5 维批判面板** | copy panel.ts 提示词栈第 15 层注入 | ✅ 直接 copy |
| **preflight 注入** | copy derivePreflight 逻辑 | ✅ 直接 copy |
| sandboxed iframe + 12 bridge | Vue3 重写 3 核心 bridge，其余迭代 | ✅ 参考重写 |
| 150+ design systems | copy 10-20 个起步 | ✅ 直接 copy |
| SKILL.md 体系 | skills-lib 已兼容 | ✅ 复用现有 |
| `<artifact>` 流式 parser | copy parser.ts（仅 fallback） | ✅ 直接 copy（降级用） |
| 多 agent 适配器（25 个） | 仅 Claude Code | ❌ 不纳入 MVP |
| Express + SQLite 后端 | 无 | ❌ 不需要 |
| PDF/PPTX 导出 | HTML/ZIP/MD/PDF | ⚠️ PPTX 后置 |
| HMAC 文件夹导入门控 | 无场景 | ❌ 不需要 |
| comment / palette / tweaks bridge | MVP 后迭代 | ⚠️ 后置 |

---

## 附录 A：open-design 关键文件路径速查

### A.1 提示词栈模块（★★★ 核心）

| 模块 | 绝对路径 |
|------|---------|
| **composeSystemPrompt 23 层** | `D:\AI\open-design\apps\daemon\src\prompts\system.ts` |
| 身份章程 OFFICIAL_DESIGNER_PROMPT | `D:\AI\open-design\apps\daemon\src\prompts\official-system.ts` |
| 5 视觉方向 + renderDirectionSpecBlock | `D:\AI\open-design\apps\daemon\src\prompts\directions.ts` |
| 5 维批判面板 | `D:\AI\open-design\apps\daemon\src\prompts\panel.ts` |
| question-form 解析器 | `D:\AI\open-design\apps\web\src\artifacts\question-form.ts` |
| derivePreflight（内嵌 system.ts） | `D:\AI\open-design\apps\daemon\src\prompts\system.ts` |

### A.2 前端渲染模块

| 模块 | 绝对路径 |
|------|---------|
| artifact parser（fallback） | `D:\AI\open-design\apps\web\src\artifacts\parser.ts` |
| markdown-context | `D:\AI\open-design\apps\web\src\artifacts\markdown-context.ts` |
| srcdoc 构造 | `D:\AI\open-design\apps\web\src\runtime\srcdoc.ts` |
| 客户端导出 | `D:\AI\open-design\apps\web\src\runtime\exports.ts` |
| inline-assets | `D:\AI\open-design\apps\daemon\src\inline-assets.ts` |
| Studio 页面 | `D:\AI\open-design\apps\web\src\components\ProjectView.tsx` |
| FileViewer | `D:\AI\open-design\apps\web\src\components\FileViewer.tsx` |
| ChatComposer | `D:\AI\open-design\apps\web\src\components\ChatComposer.tsx` |

### A.3 资源目录

| 模块 | 绝对路径 |
|------|---------|
| design-systems 资源 | `D:\AI\open-design\design-systems\` |
| skills 资源 | `D:\AI\open-design\skills\` |
| SKILL.md 规范 | `D:\AI\open-design\docs\skills-protocol.md` |
| 架构文档 | `D:\AI\open-design\docs\architecture.md` |

## 附录 B：SpaceCode 关键文件路径速查

### B.1 现有文件（需修改）

| 模块 | 绝对路径 |
|------|---------|
| AppMode 定义 | `D:\AI\SpaceCode\src\stores\app.ts:81` |
| setMode | `D:\AI\SpaceCode\src\stores\app.ts:640` |
| ModeTabs | `D:\AI\SpaceCode\src\components\layout\ModeTabs.vue` |
| App.vue 渲染链 | `D:\AI\SpaceCode\src\App.vue:26-36` |
| Sidebar 会话过滤 | `D:\AI\SpaceCode\src\components\layout\Sidebar.vue`（filteredSessions 约 370 行） |
| createSession | `D:\AI\SpaceCode\src\stores\chatSession.ts:593`（mode 在 606 行） |
| initClaudeCodeSession | `D:\AI\SpaceCode\src\stores\chatSession.ts:623` |
| **claudeCodeIPC（--system-prompt 注入点）** | `D:\AI\SpaceCode\electron\claudeCodeIPC.ts` |
| electronAPI | `D:\AI\SpaceCode\src\services\electronAPI.ts` |
| artifacts API | `D:\AI\SpaceCode\src\services\electronAPI.ts:444-460` |
| chatStream（question-form 接入点） | `D:\AI\SpaceCode\src\stores\chatStream.ts`（约 345 行 text_delta） |
| skillsService | `D:\AI\SpaceCode\electron\skillsService.ts` |
| main.ts IPC 注册 | `D:\AI\SpaceCode\electron\main.ts` |
| preload.ts bridge | `D:\AI\SpaceCode\electron\preload.ts` |
| openFileInWebview | `D:\AI\SpaceCode\src\stores\app.ts`（约 692 行） |
| ArtifactsPanel 参考 | `D:\AI\SpaceCode\src\components\work\ArtifactsPanel.vue` |
| InfoPanel webview 参考 | `D:\AI\SpaceCode\src\components\layout\InfoPanel.vue:102` |
| PreviewPanel 参考 | `D:\AI\SpaceCode\src\components\work\PreviewPanel.vue:37` |
| ui-ux-pro-max agent | `D:\AI\SpaceCode\agents-lib\work\ui-ux-pro-max.md` |
| ui-ux-pro-max skill | `D:\AI\SpaceCode\skills-lib\ui-ux-pro-max\SKILL.md` |
| 主题变量 | `D:\AI\SpaceCode\src\styles\_variables.scss` |
| main.ts webPreferences | `D:\AI\SpaceCode\electron\main.ts`（webviewTag:true） |

### B.2 新增文件（design 模式）

| 模块 | 绝对路径 |
|------|---------|
| 提示词栈组装器 | `D:\AI\SpaceCode\electron\design\promptStack.ts` |
| 文件监听服务 | `D:\AI\SpaceCode\electron\design\fileWatcher.ts` |
| 23 层 system prompt（copy） | `D:\AI\SpaceCode\electron\design\prompts\system.ts` |
| 身份章程（copy + 本地化） | `D:\AI\SpaceCode\electron\design\prompts\official-system.ts` |
| 5 视觉方向（copy） | `D:\AI\SpaceCode\electron\design\prompts\directions.ts` |
| 5 维批判面板（copy） | `D:\AI\SpaceCode\electron\design\prompts\panel.ts` |
| question-form 解析器（copy） | `D:\AI\SpaceCode\src\utils\design\questionForm.ts` |
| QuestionForm 组件 | `D:\AI\SpaceCode\src\components\design\QuestionForm.vue` |
| DesignPage 主页面 | `D:\AI\SpaceCode\src\components\design\DesignPage.vue` |
| DesignPreview 预览 | `D:\AI\SpaceCode\src\components\design\DesignPreview.vue` |
| design store | `D:\AI\SpaceCode\src\stores\design.ts` |
| huashu-design 本地化资源 | `D:\AI\SpaceCode\skills-lib\huashu-design\SKILL.md` |

---

**文档结束。** 本方案已覆盖：open-design 设计模式机制剖析（含提示词栈 23 层组装器、filesystem 执行模式、question-form 发现协议、身份章程、5 维批判面板）、SpaceCode 现状基线、缺口分析、目标架构（主进程 `--system-prompt` 注入 + 文件监听预览）、可复用性清单（直接 copy / 参考重写 / 新建 / 排除）、7 个功能点详细设计、分阶段实现步骤、关键文件清单、验收标准、风险注意事项、能力对照表、双项目文件速查附录。据此可实现完整 design 模式复刻。
