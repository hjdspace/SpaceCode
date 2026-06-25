# OfficeCLI 集成与办公能力增强 — 优化设计文档（可直接落地版）

> 目标：将开源项目 OfficeCLI 作为内置工具集成到 SpaceCode 桌面应用，补齐文件预览、办公能力增强、助手技能绑定与自定义助手等短板，使办公体验对齐甚至超越 AionUi 桌面应用。
>
> 本文档基于对 [AionUi](https://github.com/iOfficeAI/AionUi) 与 [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) 两个开源项目的源码与文档分析，结合 SpaceCode 现状编写，是 [work-mode-assistants-design.md](./work-mode-assistants-design.md) 的演进版——将办公能力底层从"Node skills 自研（pptxgenjs/docx/exceljs）"升级为"OfficeCLI 单二进制 + 内置渲染引擎"。
>
> ## 已确认的产品决策
> 1. **集成 OfficeCLI 二进制**，随包打包分发（非首次下载）。
> 2. **先写详细优化文档**，确认后再实施。
> 3. OfficeCLI 二进制按平台打包到 `extraResources`，主进程通过 `child_process` 调用。
> 4. **不修改 `engine/` 代码**（硬约束），所有改动集中在 `electron/`（主进程 IPC）和 `src/`（渲染进程 UI）。
> 5. 保留现有 Node 办公技能作为降级回退方案。

---

## 1. 背景与目标

### 1.1 问题陈述

当前 SpaceCode 桌面应用的办公模式存在以下不足（经实际使用验证）：

| 问题 | 表现 | 根因 |
|---|---|---|
| 无法应用内预览 office 文件 | PPT/Word/Excel/PDF 只能调 OS 默认程序打开，应用内看不到内容 | 仅 HTML 产物有 webview 预览，其余无原生 viewer |
| 办公产物质量不足 | pptxgenjs/docx/exceljs 生成的文件排版、图表、动效弱 | Node 库能力远不及专业 Office 工具 |
| 无 render→look→fix 闭环 | agent 生成文件后"看不见"效果，无法自查排版 | 缺少渲染引擎，agent 无法获取产物视觉反馈 |
| 依赖系统级工具 | LibreOffice/pandoc/poppler 未随包分发，打包后可能失效 | Node 技能脚本依赖外部二进制 |
| 产物发现延迟 | 3s 轮询 vs 实时推送 | 无 WebSocket / fs.watch 机制 |
| 技能脚本未自包含打包 | `scripts/build-office-skills.mjs` 未落地 | 打包后模块解析未验证 |

### 1.2 目标

1. **文件预览**：在应用内直接预览 PPT/Word/Excel/PDF 内容，支持缩略图、逐页浏览、实时刷新。
2. **办公能力增强**：用 OfficeCLI 替代 Node 办公技能，大幅提升产物质量与能力广度。
3. **助手技能绑定**：强化"助手默认绑定一个或多个技能"机制，支持技能组合与可视化。
4. **自定义助手**：让用户能创建自定义办公助手并绑定技能。
5. **OfficeCLI 内置集成**：随包打包 OfficeCLI 二进制，开箱即用，无需用户安装。

### 1.3 与原设计文档的关系

[work-mode-assistants-design.md](./work-mode-assistants-design.md) §0 明确选择了"不复刻 AionUI 的 Rust/OfficeCLI 路线，用 Node skills 自研"。当时的理由是"AionUI 的办公技能在后端 Rust 里，拿不到"。

**现在情况已变**：OfficeCLI 已于 2026 年开源（Apache-2.0），提供了：
- 单二进制零依赖，比 Node+LibreOffice+pandoc+poppler 链路更干净
- 内置高保真渲染引擎，解决预览这一最大体验短板
- 11 个现成专业化技能，能力远超 pptxgenjs/docx/exceljs
- 通过 `child_process` 调用，完全不触碰 `engine/` 代码

这是基于"实际使用发现差距"的务实演进，原设计文档的架构（Work/Code 模式、助手 frontmatter、技能绑定机制、Artifacts 面板）全部保留，仅替换底层办公引擎。

---

## 2. 开源项目分析

### 2.1 AionUi 架构分析

#### 2.1.1 项目定位

AionUi 是免费开源的 Cowork 平台（Electron + React + TS），核心理念是"AI agents work alongside you"——让 AI 直接操作用户电脑上的文件、执行多步骤任务。

#### 2.1.2 整体架构（Monorepo）

```
AionUi/
├── packages/
│   ├── desktop/          # Electron 主进程（main/preload/renderer/process/common）
│   ├── shared-scripts/   # 跨包共享脚本
│   ├── web-cli/          # Web 端 CLI
│   └── web-host/         # Web 宿主（远程访问）
├── resources/            # 资源文件
├── scripts/              # 构建/CI 脚本
├── docs/                 # 文档
└── examples/             # 示例
```

构建系统已从 Webpack 迁移到 **electron-vite**，lint/format 迁移到 **oxc 生态**（替代 ESLint + Prettier）。

#### 2.1.3 核心技术实现

**① 内置 Agent 引擎（零配置）**

AionUi 自带完整 AI agent 引擎（Rust 后端 `aioncore` / `aionrs`），无需另装 CLI。用户粘贴任意 API key 即可开始。21 个内置专业助手开箱即用，覆盖 PPT/Word/Excel/论文/财务模型/数据看板等。

**② 多 Agent 模式**

自动检测已安装的 CLI agents（Claude Code/Codex/Qwen Code/Hermes Agent/Snow CLI/Cursor Agent 等 13+），统一界面 + 并行会话 + MCP 统一管理。支持 YOLO/Full-Auto 模式（自动批准所有操作）。

**③ Team 模式（多 Agent 协作）**

Leader agent 接收指令 → 拆分子任务 → 委派给 Teammate agents 并行执行。通过 ACP（Agent Communication Protocol）协调，共享工作区 + 异步邮箱 + 任务看板。

**④ Office 助手体系**

21 个内置助手，每个助手通过 `enabled_skills[]` 字段声明依赖的技能。产物为真实可编辑的 `.pptx/.docx/.xlsx`（非 Markdown）。底层由 OfficeCLI 驱动。

**⑤ Artifacts 预览面板（核心体验差异）**

- `listArtifacts` 初始拉取 + `artifactStream` WebSocket 增量推送
- `PreviewPanel` 按 `content_type`（code/markdown/html/image/pdf）分发不同 viewer
- 支持应用内直接预览 + 外部应用打开
- 带 tab，可关闭

**⑥ 远程访问与自动化**

WebUI + Telegram/Lark/DingTalk/WeChat 远程访问，Cron 定时任务（24/7 无人值守）。

#### 2.1.4 助手数据结构

AionUi 的 `Assistant` 模型（来自 `assistantTypes.ts`）：

| 字段 | 含义 |
|---|---|
| `id` / `source`(builtin\|user) | 标识与来源 |
| `name`/`description`/`avatar` (+`*_i18n`) | 展示信息 + 国际化 |
| `preset_agent_type` | 底层引擎类型 |
| `enabled_skills[]` | **真能力来源**——绑定的技能列表 |
| `context` | 系统提示词 |
| `prompts[]` | 推荐起手 prompt |
| `models` / `defaults`(model/permission/skills/mcps, fixed\|auto) | 默认配置 |

会话装配（`useGuidSend.ts` → `buildAgentConversationParams.ts`）传参：
```typescript
{
  type, model,
  assistant: { id, locale, conversation_overrides: { model, permission, skill_ids, mcp_ids } },
  extra: { workspace, custom_workspace, preset_assistant_id, enabled_skills, session_mode }
}
```

#### 2.1.5 完整内置助手 roster（21 个）

`word-creator, word-form-creator, ppt-creator, excel-creator, morph-ppt, morph-ppt-3d, pitch-deck-creator, dashboard-creator, academic-paper, financial-model-creator, openclaw-setup, cowork, game-3d, ui-ux-pro-max, planning-with-files, human-3-coach, social-job-publisher, moltbook, beautiful-mermaid, story-roleplay, magazine-ppt-creator`

### 2.2 OfficeCLI 架构分析

#### 2.2.1 项目定位

OfficeCLI 是**世界首个专为 AI agent 设计的 Office 套件**——单二进制、零依赖、无需安装 Office，给任何 AI agent 对 Word/Excel/PowerPoint 的完整控制能力。

#### 2.2.2 核心架构

**① 单一自包含二进制**

.NET 运行时嵌入二进制，无需安装任何运行时。跨平台支持：

| 平台 | 二进制 |
|---|---|
| macOS Apple Silicon | `officecli-mac-arm64` |
| macOS Intel | `officecli-mac-x64` |
| Linux x64 | `officecli-linux-x64` |
| Linux ARM64 | `officecli-linux-arm64` |
| Windows x64 | `officecli-win-x64.exe` |
| Windows ARM64 | `officecli-win-arm64.exe` |

**② 内置高保真渲染引擎（基石能力）**

从零构建的 HTML 渲染引擎，让 AI 能"看见"渲染后的文档：

- 覆盖 shapes、charts（趋势线/误差线/瀑布图/烛台图/sparklines）、方程（OMML→MathJax）、3D `.glb` 模型（Three.js）、morph 过渡、shape 效果
- 逐页 PNG 截图通过 headless 浏览器渲染 HTML 生成
- **三种渲染模式**：
  - `view html` — 独立 HTML 文件，资源内联，任何浏览器可打开
  - `view screenshot` — 逐页 PNG，供多模态 agent 读取
  - `watch` — 本地 HTTP 服务器（默认端口 26315），自动刷新预览，每次 `add`/`set`/`remove` 即时更新

**③ L1→L2→L3 策略**

```
L1 (read) → L2 (DOM edit) → L3 (raw XML)
```

始终优先高层。命令集：

| 命令 | 用途 |
|---|---|
| `create <file>` | 创建空白 .docx/.xlsx/.pptx |
| `view <file> <mode>` | 查看：outline/stats/issues/text/annotated/html/screenshot |
| `get <file> <path> --depth N` | 获取节点及子节点，`--json` 结构化输出 |
| `query <file> <selector>` | CSS-like 查询（支持 boolean and/or） |
| `set <file> <path> --prop key=value` | 修改属性 |
| `add <file> <parent> --type <type>` | 添加/克隆元素 |
| `remove <file> <path>` | 删除元素 |
| `validate <file>` | 验证 OpenXML schema |
| `watch <file>` | 启动实时预览服务器 |
| `unwatch <file>` | 停止预览 |
| `mark <file> <path>` | 标记待审核的编辑提案 |
| `close <file>` | 保存并释放常驻会话 |

**④ Resident 模式（性能优化）**

首次访问自动启动常驻进程（60s 空闲超时），避免文件锁冲突。显式 `open`/`close` 用于长会话（12min 空闲）。可通过 `OFFICECLI_NO_AUTO_RESIDENT=1` 禁用。

**⑤ Watch & 交互式选择**

- 浏览器中点击/shift+点击/框选 shape，CLI 读取当前选择
- `get <file> selected` 读取用户点击的元素
- 选择在文件编辑后保持（使用 stable `@id=` 路径）
- 所有连接的浏览器共享同一选择（last-write-wins）

**⑥ Marks — 待审核的编辑提案**

`mark` 在文件外暂存变更，人工审核后再 `set` 落地。适用于需要人类确认的场景。支持 `find`（含正则）、`color`、`note`、`tofix` 属性。

**⑦ Stable ID 寻址**

元素有稳定 ID 时返回 `@attr=value` 路径而非位置索引：
```
/slide[1]/shape[@id=550950021]           # PPT shape
/body/p[@paraId=1A2B3C4D]                # Word paragraph
/comments/comment[@commentId=1]           # Word comment
```
PPT 还接受 `@name=` 选择器。多步骤工作流中优先使用稳定 ID。

**⑧ MCP 支持**

通过 MCP 暴露相同 schema：`{"command":"help","format":"docx","type":"paragraph"}`。可作为 MCP server 被 agent 调用。

#### 2.2.3 专业化技能体系

OfficeCLI 仓库 `skills/` 目录包含 11 个专业化技能：

| 技能 | 用途 | 对应 SpaceCode 助手 |
|---|---|---|
| `officecli` | 主技能（SKILL.md，通用入口） | 所有办公助手的基础 |
| `officecli-pptx` | PPT 通用创建 | ppt-creator |
| `officecli-docx` | Word 通用创建 | word-creator |
| `officecli-xlsx` | Excel 通用创建 | excel-creator |
| `morph-ppt` | Morph 动画 PPT | morph-ppt |
| `morph-ppt-3d` | 3D Morph PPT | morph-ppt-3d |
| `officecli-pitch-deck` | 融资路演 deck | pitch-deck-creator |
| `officecli-academic-paper` | 学术论文 | academic-paper |
| `officecli-financial-model` | 财务模型 | financial-model-creator |
| `officecli-data-dashboard` | 数据看板 | dashboard-creator |
| `officecli-word-form` | Word 表单 | word-form-creator |

每个技能含 `SKILL.md`（frontmatter `name`/`description` + 使用指南），遵循"help-first rule"（不确定就查 `officecli help` 而非猜测）。

技能通过 `load_skill` 加载，支持 frontmatter 的 `paths` 字段条件激活。

#### 2.2.4 能力广度

**Word（.docx）**：
- 完整 i18n & RTL 支持（per-script font slots、BCP-47 lang tags、direction=rtl 级联）
- 段落（framePr、tabs shorthand、char-based indents）、runs（underline.color、position half-pts）
- 表格（虚拟列操作 add/remove/move/copyfrom、hMerge）、样式
- textbox/shape（rotation、verticalText eaVert/vert270、gradient、shadow、opacity）
- 页眉页脚、图片（PNG/JPG/GIF/SVG）、方程（OMML）、评论、脚注、水印、书签
- TOC、图表、超链接、节（pageNumFmt、rtlGutter、pgBorders）
- 表单域、内容控件(SDT)、字段(28类型：MERGEFIELD/REF/PAGEREF/SEQ/STYLEREF/DOCPROPERTY/IF)
- OLE objects、修订/追踪变更（revision.type=ins|del|format|moveFrom|moveTo + accept|reject）

**Excel（.xlsx）**：
- 单元格（phonetic guide/furigana、--shift left|up on remove、shift=right|down on add）
- 公式（150+内置函数自动求值、_xlfn.自动前缀、OFFSET/INDIRECT、defined-name formula 内联）
- 表（listobject）、排序（多键、sidecar-aware）、条件格式（databar/colorscale/iconset/formulacf/cellIs/topN/aboveAverage）
- 图表（含箱线图、帕累托、对数轴）、数据透视表（多字段、日期分组、showDataAs、calculatedField、labelFilter/topN/fillDownLabels、cache CoW + 跨透视共享）
- 切片器、命名范围、数据验证、图片（SVG）、sparklines、评论（RTL）、自动筛选、shapes
- CSV/TSV 导入、`$Sheet:A1` 单元格寻址

**PowerPoint（.pptx）**：
- 幻灯片（header/footer/date/slidenum toggles、hidden）
- shapes（pattern fill、blur effect、hyperlink tooltip + slide-jump links、highlight color、slideMaster/slideLayout typed add/set/remove、arrow alias、effective.X）
- 图片（PNG/JPG/GIF/SVG、fill modes: stretch/contain/cover/tile、brightness/contrast/glow/shadow、rotation、link + tooltip）
- 表格（内置 PowerPoint style catalogue、虚拟 /col[C] get + swap/copyFrom、row/col Move/CopyFrom）
- 图表（pieOfPie、barOfPie、per-attr axisLine/gridline、series add/remove with theme palette、anchor shorthand、animation + chartBuild）
- 动画（15 emphasis + 16 exit template-backed presets、multi-effect chains、motion-path presets、repeat/restart/autoReverse）
- 过渡（morph + p14 + 12 p15 PowerPoint 2013+ presets）
- 3D 模型(.glb)（combined rotation=ax,ay,az）、slide zoom、方程、主题、连接器（@name= selector）
- 视频音频（loop、autoStart）、分组（link + tooltip、deep walk）
- 备注（RTL、lang）、评论（legacy + modern p188 threaded round-trip）
- SmartArt（round-trip via add-part + raw-set）、OLE objects、占位符（phType）

#### 2.2.5 Skill 安装机制

- `officecli install` 自动复制二进制到 PATH，并安装 officecli skill 到检测到的每个 AI 编码 agent（Claude Code/Cursor/Windsurf/Copilot 等）
- 配置存于 `~/.officecli/config.json`，支持自动更新（可禁用：`officecli config autoUpdate false`）

---

## 3. SpaceCode 现状与差距分析

### 3.1 现有能力

| 能力 | 实现位置 | 状态 |
|---|---|---|
| 22 个 Work 助手 | `agents-lib/work/*.md` | ✅ 已有 |
| 4 个办公技能包 | `skills-lib/{pptx,docx,xlsx,pdf}/` | ✅ 已有（Node 实现，能力弱） |
| 技能绑定机制 | frontmatter `skills: [...]` → `startWorkAssistantSession` 安装到 `.claude/skills` | ✅ 已有 |
| 产物管理 | `electron/artifactsService.ts`（list/open/reveal） | ✅ 已有（3s 轮询） |
| HTML 预览 | webview 内嵌（`src/stores/app.ts` `openFileInWebview`） | ✅ 已有（仅 HTML） |
| 外部打开 | `shell.openPath` + `openInEditor` + `shell.showItemInFolder` | ✅ 已有 |
| 自定义助手 | `~/.claude/agents/` + 工作流导出 | ✅ 已有 |
| Work/Code 模式 | 顶部 Tab 切换 | ✅ 已有 |
| IPC 通信架构 | `contextBridge.exposeInMainWorld` + `ipcMain.handle` | ✅ 已有 |

### 3.2 核心差距

| # | 差距 | SpaceCode 现状 | AionUI/OfficeCLI 方案 | 严重度 |
|---|---|---|---|---|
| 1 | 无原生 office 文件预览 | PPT/Word/Excel/PDF 只能调 OS 默认程序 | OfficeCLI `view html` 渲染 + 内嵌 webview | **高** |
| 2 | 办公能力弱 | pptxgenjs/docx/exceljs | OfficeCLI DOM 操作 + 渲染 + 150+函数 | **高** |
| 3 | 无实时预览 | 3s 轮询 | OfficeCLI `watch` 模式即时刷新 | **中** |
| 4 | 依赖系统级工具 | LibreOffice/pandoc/poppler 未随包 | OfficeCLI 单二进制自包含 | **高** |
| 5 | 无 render→look→fix 闭环 | agent 看不见产物效果 | OfficeCLI 渲染引擎给 AI "眼睛" | **高** |
| 6 | 技能脚本未自包含打包 | `build-office-skills.mjs` 未落地 | OfficeCLI 技能即 SKILL.md，无脚本依赖 | **中** |

### 3.3 关键约束

- **`engine/` 代码不可修改**（硬约束）
- 所有改动集中在 `electron/`（主进程 IPC）和 `src/`（渲染进程 UI）
- OfficeCLI 通过 `child_process.spawn` 调用，不触碰引擎代码
- 保留现有 Node 办公技能作为降级回退

---

## 4. 优化方案总览

### 4.1 总体策略

用 OfficeCLI 二进制替换现有的 Node 办公技能脚本作为办公能力的底层引擎。所有改动集中在 `electron/`（主进程 IPC）和 `src/`（渲染进程 UI），不触碰 `engine/`。

### 4.2 六个阶段

| 阶段 | 内容 | 核心改动 | 依赖 |
|---|---|---|---|
| Phase 1 | OfficeCLI 二进制集成 | `electron/officeCliService.ts` + `package.json` extraResources + preload | 无 |
| Phase 2 | 文件预览能力 | `src/components/work/PreviewPanel.vue` + ArtifactsPanel 增强 | Phase 1 |
| Phase 3 | 办公技能升级 | `skills-lib/officecli-*/` 引入 + 助手 frontmatter 更新 | Phase 1 |
| Phase 4 | 助手技能绑定增强 | AgentDef 扩展 + 技能组合可视化 | Phase 3 |
| Phase 5 | 自定义办公助手 | 助手编辑器 + 模板系统 | Phase 4 |
| Phase 6 | 产物管理增强 | fs.watch 替换轮询 + per-session workspace | Phase 2 |

### 4.3 改动文件清单总览

**新增文件**：
- `electron/officeCliService.ts` — OfficeCLI IPC 服务
- `src/components/work/PreviewPanel.vue` — 文件预览组件
- `src/components/work/OfficePreviewViewer.vue` — Office 文件渲染 viewer
- `src/components/work/CustomAssistantEditor.vue` — 自定义助手编辑器
- `skills-lib/officecli/SKILL.md` — OfficeCLI 主技能
- `skills-lib/officecli-pptx/SKILL.md` — PPT 技能
- `skills-lib/officecli-docx/SKILL.md` — Word 技能
- `skills-lib/officecli-xlsx/SKILL.md` — Excel 技能
- `skills-lib/morph-ppt/SKILL.md` — Morph PPT 技能
- `skills-lib/morph-ppt-3d/SKILL.md` — 3D Morph PPT 技能
- `skills-lib/officecli-pitch-deck/SKILL.md` — 融资路演技能
- `skills-lib/officecli-academic-paper/SKILL.md` — 学术论文技能
- `skills-lib/officecli-financial-model/SKILL.md` — 财务模型技能
- `skills-lib/officecli-data-dashboard/SKILL.md` — 数据看板技能
- `skills-lib/officecli-word-form/SKILL.md` — Word 表单技能
- `resources/officecli/` — OfficeCLI 二进制目录

**修改文件**：
- `package.json` — extraResources 配置
- `electron/main.ts` — IPC 注册
- `electron/preload.ts` — 暴露 officecli API
- `electron/artifactsService.ts` — 增加 fs.watch + 预览支持
- `electron/agentsService.ts` — AgentDef 扩展
- `src/stores/app.ts` — InfoPanelTab 扩展 + 预览状态
- `src/stores/agents.ts` — AgentDef 镜像扩展
- `src/stores/chatSession.ts` — startWorkAssistantSession 增强
- `src/components/work/ArtifactsPanel.vue` — 预览集成
- `src/components/work/WorkAssistantGallery.vue` — 技能标签 + 自定义入口
- `agents-lib/work/*.md` — 22 个助手 frontmatter 更新

---

## 5. Phase 1: OfficeCLI 二进制集成

### 5.1 目标

将 officecli 二进制随包打包，主进程提供 IPC 调用能力，渲染进程可通过 API 执行任意 officecli 命令。

### 5.2 二进制分发

#### 5.2.1 目录结构

```
resources/officecli/
├── officecli-win-x64.exe      # Windows x64
├── officecli-win-arm64.exe    # Windows ARM64
├── officecli-mac-arm64         # macOS Apple Silicon
├── officecli-mac-x64           # macOS Intel
├── officecli-linux-x64         # Linux x64
└── officecli-linux-arm64       # Linux ARM64
```

开发环境下二进制放在 `resources/officecli/`；打包后通过 `extraResources` 复制到 `process.resourcesPath/officecli/`。

#### 5.2.2 package.json 配置

在 `package.json` 的 `build.extraResources` 数组中**新增** `officecli` 条目（`agents-lib`/`skills-lib` 若已存在则保留不动，仅追加新条目）：

```json
{
  "build": {
    "extraResources": [
      {
        "from": "resources/officecli",
        "to": "officecli",
        "filter": ["**/*"]
      }
      // agents-lib / skills-lib 若已在现有 extraResources 中则保留原条目，不重复添加
    ]
  }
}
```

#### 5.2.3 路径解析

在 `electron/officeCliService.ts` 中实现路径解析：

```typescript
import { app } from 'electron'
import * as path from 'path'
import * as os from 'os'

/**
 * 解析 officecli 二进制路径
 * 开发环境：resources/officecli/officecli-{platform}-{arch}[.exe]
 * 打包环境：process.resourcesPath/officecli/officecli-{platform}-{arch}[.exe]
 */
function getOfficeCliBinaryPath(): string {
  const platform = process.platform // 'win32' | 'darwin' | 'linux'
  const arch = process.arch         // 'x64' | 'arm64'

  let platformName: string
  if (platform === 'win32') platformName = 'win'
  else if (platform === 'darwin') platformName = 'mac'
  else platformName = 'linux'

  const exeName = `officecli-${platformName}-${arch}${platform === 'win32' ? '.exe' : ''}`

  // 开发环境用 resources/，打包后用 process.resourcesPath/
  const isDev = !app.isPackaged
  const baseDir = isDev
    ? path.join(app.getAppPath(), 'resources', 'officecli')
    : path.join(process.resourcesPath, 'officecli')

  return path.join(baseDir, exeName)
}
```

### 5.3 IPC 服务设计

#### 5.3.1 新增 `electron/officeCliService.ts`

```typescript
import { ipcMain, app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ===== 类型定义 =====

export interface OfficeCliExecOptions {
  args: string[]                    // 命令参数，如 ['create', 'test.pptx']
  cwd?: string                      // 工作目录（默认 workWorkspace）
  timeout?: number                  // 超时毫秒（默认 30000）
  env?: Record<string, string>      // 额外环境变量
}

export interface OfficeCliExecResult {
  exitCode: number
  stdout: string
  stderr: string
  duration: number                  // 耗时毫秒
}

export interface OfficeCliWatchHandle {
  id: string                        // watch 实例 ID
  filePath: string
  port: number
  url: string                       // http://localhost:{port}
  process: ChildProcess
}

// ===== 全局状态 =====

const watchProcesses = new Map<string, OfficeCliWatchHandle>()

// ===== 路径解析 =====

function getOfficeCliBinaryPath(): string {
  const platform = process.platform
  const arch = process.arch

  let platformName: string
  if (platform === 'win32') platformName = 'win'
  else if (platform === 'darwin') platformName = 'mac'
  else platformName = 'linux'

  const exeName = `officecli-${platformName}-${arch}${platform === 'win32' ? '.exe' : ''}`

  const isDev = !app.isPackaged
  const baseDir = isDev
    ? path.join(app.getAppPath(), 'resources', 'officecli')
    : path.join(process.resourcesPath, 'officecli')

  return path.join(baseDir, exeName)
}

// ===== 跨平台进程树终止 =====

/**
 * 终止进程树（含子进程）。
 * Windows: taskkill /pid <pid> /T /F（SIGTERM 不杀子进程）
 * macOS/Linux: 进程组 kill（child.kill 默认仅杀主进程）
 */
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      process.kill(-pid, 'SIGTERM')  // 负 PID 杀进程组（需 child 以 detached:true 启动）
    }
  } catch {
    // 进程可能已退出
  }
}

// ===== 核心执行函数 =====

async function execOfficeCli(options: OfficeCliExecOptions): Promise<OfficeCliExecResult> {
  const binaryPath = getOfficeCliBinaryPath()

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`OfficeCLI 二进制不存在: ${binaryPath}`)
  }

  const cwd = options.cwd || os.homedir()
  const timeout = options.timeout || 30000
  const env = { ...process.env, ...options.env }

  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    const child = spawn(binaryPath, options.args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    const timer = setTimeout(() => {
      killProcessTree(child.pid!)
      reject(new Error(`OfficeCLI 执行超时 (${timeout}ms): officecli ${options.args.join(' ')}`))
    }, timeout)

    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      })
    })

    child.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(new Error(`OfficeCLI 执行失败: ${err.message}`))
    })
  })
}

// ===== IPC Handler 注册 =====

export function registerOfficeCliIPCHandlers(): void {
  // 检测 OfficeCLI 是否可用
  ipcMain.handle('officecli:version', async (): Promise<string> => {
    const result = await execOfficeCli({ args: ['--version'], timeout: 10000 })
    if (result.exitCode !== 0) {
      throw new Error(`检测版本失败: ${result.stderr}`)
    }
    return result.stdout.trim()
  })

  // 检测二进制是否存在
  ipcMain.handle('officecli:checkInstalled', async (): Promise<boolean> => {
    const binaryPath = getOfficeCliBinaryPath()
    return fs.existsSync(binaryPath)
  })

  // 执行任意命令
  ipcMain.handle('officecli:exec', async (_event, options: OfficeCliExecOptions): Promise<OfficeCliExecResult> => {
    return execOfficeCli(options)
  })

  // 渲染文件为 HTML
  ipcMain.handle('officecli:viewHtml', async (_event, filePath: string, outputDir?: string): Promise<string> => {
    const args = ['view', filePath, 'html']
    if (outputDir) {
      args.push('-o', outputDir)
    }
    const result = await execOfficeCli({ args, cwd: path.dirname(filePath), timeout: 60000 })
    if (result.exitCode !== 0) {
      throw new Error(`渲染 HTML 失败: ${result.stderr}`)
    }
    // officecli view html -o <path> 输出到指定路径
    // 未指定 -o 时输出到 stdout
    if (outputDir) {
      const htmlPath = path.join(outputDir, path.basename(filePath, path.extname(filePath)) + '.html')
      return htmlPath
    }
    // 未指定输出路径时，写入临时文件
    const tmpPath = path.join(os.tmpdir(), `officecli-${Date.now()}.html`)
    fs.writeFileSync(tmpPath, result.stdout)
    return tmpPath
  })

  // 渲染文件为 PNG 截图
  ipcMain.handle('officecli:viewScreenshot', async (_event, filePath: string, outputDir: string, page?: number): Promise<string[]> => {
    const args = ['view', filePath, 'screenshot', '-o', outputDir]
    if (page) {
      args.push('--page', String(page))
    }
    const result = await execOfficeCli({ args, cwd: path.dirname(filePath), timeout: 60000 })
    if (result.exitCode !== 0) {
      throw new Error(`渲染截图失败: ${result.stderr}`)
    }
    // 返回生成的 PNG 文件列表
    const files = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .map(f => path.join(outputDir, f))
    return files
  })

  // 启动 watch 模式
  ipcMain.handle('officecli:watch:start', async (_event, filePath: string, port?: number): Promise<OfficeCliWatchHandle> => {
    const binaryPath = getOfficeCliBinaryPath()
    const args = ['watch', filePath]
    if (port) {
      args.push('--port', String(port))
    }

    const child = spawn(binaryPath, args, {
      cwd: path.dirname(filePath),
      shell: false,
      windowsHide: true,
    })

    return new Promise((resolve, reject) => {
      const id = `watch-${Date.now()}`
      let resolvedPort = port || 26315
      let outputBuffer = ''

      const timer = setTimeout(() => {
        reject(new Error('watch 启动超时'))
      }, 10000)

      child.stdout?.on('data', (data: Buffer) => {
        outputBuffer += data.toString()
        // 解析输出中的端口号和 URL
        const urlMatch = outputBuffer.match(/http:\/\/localhost:(\d+)/)
        if (urlMatch) {
          resolvedPort = parseInt(urlMatch[1])
          clearTimeout(timer)
          const handle: OfficeCliWatchHandle = {
            id,
            filePath,
            port: resolvedPort,
            url: `http://localhost:${resolvedPort}`,
            process: child,
          }
          watchProcesses.set(id, handle)
          resolve(handle)
        }
      })

      child.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new Error(`watch 启动失败: ${err.message}`))
      })

      child.on('close', () => {
        watchProcesses.delete(id)
      })
    })
  })

  // 停止 watch 模式
  ipcMain.handle('officecli:watch:stop', async (_event, watchId: string): Promise<boolean> => {
    const handle = watchProcesses.get(watchId)
    if (!handle) return false
    killProcessTree(handle.process.pid!)
    watchProcesses.delete(watchId)
    return true
  })

  // 停止所有 watch 进程（应用退出时调用）
  ipcMain.handle('officecli:watch:stopAll', async (): Promise<number> => {
    const count = watchProcesses.size
    for (const handle of watchProcesses.values()) {
      killProcessTree(handle.process.pid!)
    }
    watchProcesses.clear()
    return count
  })

  // 获取当前活跃的 watch 列表
  ipcMain.handle('officecli:watch:list', async (): Promise<Array<{ id: string; filePath: string; url: string }>> => {
    return Array.from(watchProcesses.values()).map(h => ({
      id: h.id,
      filePath: h.filePath,
      url: h.url,
    }))
  })
}

// ===== 应用退出时清理 =====

export function cleanupOfficeCli(): void {
  for (const handle of watchProcesses.values()) {
    try {
      killProcessTree(handle.process.pid!)
    } catch {
      // 进程可能已退出
    }
  }
  watchProcesses.clear()
}
```

#### 5.3.2 main.ts 注册

在 `electron/main.ts` 的 `app.whenReady()` 内，与其他 IPC handler 并列注册：

```typescript
import { registerOfficeCliIPCHandlers, cleanupOfficeCli } from './officeCliService'

app.whenReady().then(() => {
  // ... 其他 handler 注册 ...
  registerOfficeCliIPCHandlers()
  // ...
})

// 应用退出前清理所有 watch 进程
app.on('before-quit', () => {
  cleanupOfficeCli()
})
```

### 5.4 preload API 暴露

在 `electron/preload.ts` 的 `contextBridge.exposeInMainWorld('electronAPI', {...})` 内新增 `officecli` 命名空间：

```typescript
officecli: {
  /** 检测 OfficeCLI 版本 */
  version: () => ipcRenderer.invoke('officecli:version'),

  /** 检测二进制是否已安装 */
  checkInstalled: () => ipcRenderer.invoke('officecli:checkInstalled'),

  /** 执行任意 officecli 命令 */
  exec: (options: { args: string[]; cwd?: string; timeout?: number; env?: Record<string, string> }) =>
    ipcRenderer.invoke('officecli:exec', options),

  /** 渲染文件为 HTML，返回 HTML 文件路径 */
  viewHtml: (filePath: string, outputDir?: string) =>
    ipcRenderer.invoke('officecli:viewHtml', filePath, outputDir),

  /** 渲染文件为 PNG 截图，返回图片路径列表 */
  viewScreenshot: (filePath: string, outputDir: string, page?: number) =>
    ipcRenderer.invoke('officecli:viewScreenshot', filePath, outputDir, page),

  /** 启动 watch 实时预览 */
  watchStart: (filePath: string, port?: number) =>
    ipcRenderer.invoke('officecli:watch:start', filePath, port),

  /** 停止 watch */
  watchStop: (watchId: string) =>
    ipcRenderer.invoke('officecli:watch:stop', watchId),

  /** 停止所有 watch */
  watchStopAll: () =>
    ipcRenderer.invoke('officecli:watch:stopAll'),

  /** 获取活跃 watch 列表 */
  watchList: () =>
    ipcRenderer.invoke('officecli:watch:list'),
},
```

### 5.5 验证标准

1. 开发模式下 `await api.officecli.version()` 返回版本号字符串
2. `await api.officecli.checkInstalled()` 返回 `true`
3. `await api.officecli.exec({ args: ['create', 'test.pptx'], cwd: '/tmp' })` 成功生成文件
4. `await api.officecli.viewHtml('test.pptx')` 返回 HTML 文件路径，文件内容为渲染后的 HTML
5. `await api.officecli.watchStart('test.pptx')` 返回 `{ id, url }`，浏览器访问 url 可见预览
6. 应用退出后无残留 officecli 进程
7. Agent 会话中执行 `officecli --version` 返回版本号（见 §5.6）

### 5.6 Agent 侧二进制 PATH 解决方案（关键）

> **问题**：§5.3-§5.4 的 IPC 仅服务渲染进程（UI）。Agent（引擎的 Bash 工具）直接执行 `officecli` 命令时，二进制不在 PATH 上——随包打包在 `resources/officecli/`，且文件名为 `officecli-{platform}-{arch}[.exe]`（非标准名 `officecli`）。SKILL.md 中的 `officecli view ...` 等命令会因 `command not found` 失败。
>
> 本节解决"agent 侧如何调用 officecli"这一命门问题。

#### 5.6.1 方案：启动时 install + buildEnv 注入 PATH（双保险）

采用"官方 install 机制 + 引擎 env 兜底注入"双保险，确保 agent 的 Bash 工具能直接使用 `officecli` 命令。

**① 应用启动时执行 `officecli install`**

`officecli install` 是官方提供的安装命令，会：
- 将二进制复制到用户级 PATH 目录（`~/.officecli/bin/officecli[.exe]`，标准命名）
- 将 officecli skill 安装到检测到的 AI agent（Claude Code/Cursor 等）

我们在 `app.whenReady()` 内调用 bundled 二进制执行 `install`，幂等且非阻塞：

```typescript
// electron/officeCliService.ts 新增

/** officecli install 的用户级安装目录 */
export function getOfficeCliInstallDir(): string {
  return path.join(os.homedir(), '.officecli', 'bin')
}

/** 用户级 officecli 可执行文件路径（install 后的标准名） */
export function getOfficeCliInstalledBinary(): string {
  const exe = process.platform === 'win32' ? 'officecli.exe' : 'officecli'
  return path.join(getOfficeCliInstallDir(), exe)
}

/** bundled 二进制所在目录（含平台特定二进制，兜底用） */
export function getOfficeCliBinaryDir(): string {
  return path.dirname(getOfficeCliBinaryPath())
}

/**
 * 确保 officecli 已安装到用户级 PATH。
 * 幂等：已安装且版本可获取则跳过。
 * 在 app.whenReady() 内调用，非阻塞（后台执行，不 await）。
 */
export async function ensureOfficeCliInstalled(): Promise<void> {
  const installedPath = getOfficeCliInstalledBinary()

  // 已安装且可执行：跳过
  if (fs.existsSync(installedPath)) {
    try {
      const result = await execOfficeCli({ args: ['--version'], timeout: 5000 })
      if (result.exitCode === 0) {
        info('OfficeCli', `已安装 | version=${result.stdout.trim()} | path=${installedPath}`)
        return
      }
    } catch {
      // 版本检测失败，继续重装
    }
  }

  // 执行 install：复制二进制到 ~/.officecli/bin/ 并命名为 officecli
  info('OfficeCli', `开始安装 | bundled=${getOfficeCliBinaryPath()}`)
  try {
    const result = await execOfficeCli({ args: ['install'], timeout: 30000 })
    if (result.exitCode === 0) {
      info('OfficeCli', `安装完成 | stdout=${result.stdout.trim()}`)
    } else {
      warn('OfficeCli', `安装失败 | exitCode=${result.exitCode} | stderr=${result.stderr}`)
    }
  } catch (err) {
    warn('OfficeCli', `安装异常 | error=${String(err)}`)
  }
}
```

在 `electron/main.ts` 注册（非阻塞，避免拖慢启动）：

```typescript
import { registerOfficeCliIPCHandlers, cleanupOfficeCli, ensureOfficeCliInstalled } from './officeCliService'

app.whenReady().then(async () => {
  // ... 其他 handler 注册 ...
  registerOfficeCliIPCHandlers()
  // 后台确保 officecli 在 PATH（不 await，不阻塞 UI 启动）
  void ensureOfficeCliInstalled()
  // ...
})
```

**② `buildEnv` 注入 PATH（兜底）**

即使 `officecli install` 未执行完毕或失败，引擎子进程的 PATH 也应包含 officecli 的安装目录。修改 `electron/sessionProcess.ts` 的 `buildEnv`，在 `return env` 前追加：

```typescript
// electron/sessionProcess.ts — buildEnv() 末尾，return env 之前新增

import { getOfficeCliInstallDir } from './officeCliService'

// ... 现有 buildEnv 逻辑 ...

// 注入 officecli 用户级安装目录到 PATH（兜底，确保 agent Bash 工具可用）
const officeCliDir = getOfficeCliInstallDir()
if (fs.existsSync(officeCliDir)) {
  const existingPath = env.PATH || process.env.PATH || ''
  if (!existingPath.split(path.delimiter).includes(officeCliDir)) {
    env.PATH = [officeCliDir, existingPath].join(path.delimiter)
    debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Injected officecli to PATH | dir=${officeCliDir}`)
  }
}

return env
```

> **为什么不在 SKILL.md 用 `${CLAUDE_SKILL_DIR}`？**
> `loadSkillsDir.ts` 支持 `${CLAUDE_SKILL_DIR}` 变量（指向 skill 安装目录），理论上可在 SKILL.md 写 `${CLAUDE_SKILL_DIR}/bin/officecli`。但：
> 1. OfficeCLI 的 SKILL.md 是上游官方维护的，频繁改动会带来维护成本
> 2. `${CLAUDE_SKILL_DIR}` 仅在 skill 脚本内替换，agent 的 ad-hoc Bash 命令（如 `officecli view test.pptx`）仍找不到二进制
> 3. `officecli install` 是官方推荐的部署方式，更稳定且自动处理跨平台命名
>
> 因此选择"install + PATH 注入"而非 `${CLAUDE_SKILL_DIR}`。

#### 5.6.2 与技能系统的关系

`officecli install` 会将 officecli skill 安装到 `~/.claude/skills/officecli/`（全局级）。这与 §7 的 `skills-lib/officecli/`（项目级，安装到 `<cwd>/.claude/skills/`）存在重叠但不冲突：
- 全局级 skill 是兜底（任何会话可用）
- 项目级 skill 是主路径（由 `startWorkAssistantSession` 精确装配，支持版本与降级控制）
- 引擎的 `loadSkillsDir.ts` 同时扫描两级目录，项目级优先

若不希望 `install` 安装全局 skill，可在 `ensureOfficeCliInstalled` 中设置 `OFFICECLI_NO_SKILL_INSTALL=1` 环境变量（若上游支持），或 install 后删除 `~/.claude/skills/officecli/`。当前方案选择保留全局 skill 作为兜底。

#### 5.6.3 验证

1. 首次启动应用后，`~/.officecli/bin/officecli`（或 `.exe`）存在且可执行
2. 在 agent 会话中执行 `officecli --version` 返回版本号
3. `officecli create test.pptx` 在会话 cwd 下成功创建文件
4. 删除 `~/.officecli/bin/` 后重启应用，install 自动重新执行
5. install 未完成时启动会话，agent 仍可通过 PATH 注入找到二进制（兜底生效）

---

## 6. Phase 2: 文件预览能力

### 6.1 目标

在应用内直接预览 PPT/Word/Excel/PDF 内容，支持缩略图网格、逐页浏览、实时刷新，无需外部程序。

### 6.2 InfoPanelTabType 扩展

> **注意类型名**：`src/stores/app.ts` 中 `InfoPanelTabType` 是字符串联合类型，`InfoPanelTab` 是接口（含 `id`/`type`/`title`/`icon`/`data`/`closeable` 字段）。扩展的是前者，后者无需改动。

扩展 `InfoPanelTabType` 联合类型，新增 `office-preview`：

```typescript
// src/stores/app.ts — 现有（行 54）
export type InfoPanelTabType = 'file' | 'markdown' | 'diff' | 'tool-diff' | 'webview' | 'terminal' | 'artifacts'

// 修改为
export type InfoPanelTabType = 'file' | 'markdown' | 'diff' | 'tool-diff' | 'webview' | 'terminal' | 'artifacts' | 'office-preview'
```

`InfoPanelTab` 接口（行 56-63）无需改动——`type` 字段已是 `InfoPanelTabType`，扩展联合类型后自动生效：

```typescript
// src/stores/app.ts — 现有（行 56-63），无需修改
export interface InfoPanelTab {
  id: string
  type: InfoPanelTabType   // ← 自动支持 'office-preview'
  title: string
  icon: any
  data: FileInfo | ToolDiffData | WebviewTabData | ScmDiffTabData | null
  closeable: boolean
}
```

新增预览状态与打开函数（使用现有 `openInfoTab` 而非不存在的 `infoPanelTab` ref）：

```typescript
// src/stores/app.ts 新增

import { markRaw } from 'vue'
import { FileText } from 'lucide-vue-next'  // 或项目使用的图标库

// 当前预览的文件路径
const officePreviewFile = ref<string>('')
// 预览模式：'html' | 'screenshots' | 'watch'
const officePreviewMode = ref<'html' | 'screenshots' | 'watch'>('html')
// watch 实例 ID
const officePreviewWatchId = ref<string>('')
// watch URL
const officePreviewWatchUrl = ref<string>('')

function openOfficePreview(filePath: string, mode: 'html' | 'screenshots' | 'watch' = 'html') {
  officePreviewFile.value = filePath
  officePreviewMode.value = mode

  // 复用现有 openInfoTab 打开 office-preview tab（参考现有 openTerminalTab 等模式）
  openInfoTab({
    id: 'office-preview',
    type: 'office-preview',
    title: path.basename(filePath),
    icon: markRaw(FileText),
    data: { filePath, mode } as any,
    closeable: true,
  })
}

function closeOfficePreview() {
  // 如果有 watch 进程，停止它
  if (officePreviewWatchId.value) {
    api.officecli.watchStop(officePreviewWatchId.value)
    officePreviewWatchId.value = ''
    officePreviewWatchUrl.value = ''
  }
  officePreviewFile.value = ''
  // 关闭 tab（复用现有 closeInfoTab）
  closeInfoTab('office-preview')
}
```

> **关键**：不直接操作 `infoPanelTab.value`（该 ref 不存在），而是复用现有 `openInfoTab({ id, type, title, icon, data, closeable })` 模式，与 `openTerminalTab`/`openWebviewTab` 等保持一致。

### 6.3 PreviewPanel 组件

新增 `src/components/work/PreviewPanel.vue`：

```vue
<template>
  <div class="office-preview-panel">
    <!-- 工具栏 -->
    <div class="preview-toolbar">
      <div class="preview-file-info">
        <span class="file-icon">{{ fileIcon }}</span>
        <span class="file-name">{{ fileName }}</span>
      </div>
      <div class="preview-actions">
        <button
          v-for="mode in availableModes"
          :key="mode.id"
          class="preview-mode-btn"
          :class="{ active: currentMode === mode.id }"
          @click="switchMode(mode.id)"
        >
          {{ mode.label }}
        </button>
        <button class="preview-action-btn" @click="openExternal" title="外部打开">
          <span>↗</span>
        </button>
        <button class="preview-action-btn" @click="revealInFolder" title="在文件夹中显示">
          <span>📁</span>
        </button>
      </div>
    </div>

    <!-- 预览内容区 -->
    <div class="preview-content">
      <!-- HTML 渲染模式 -->
      <div v-if="currentMode === 'html'" class="html-viewer">
        <div v-if="loading" class="preview-loading">渲染中...</div>
        <webview
          v-else
          :src="htmlPreviewUrl"
          class="preview-webview"
          @did-finish-load="onWebviewLoad"
        />
      </div>

      <!-- 截图缩略图模式 -->
      <div v-else-if="currentMode === 'screenshots'" class="screenshot-viewer">
        <div v-if="loading" class="preview-loading">生成截图中...</div>
        <div v-else class="screenshot-grid">
          <div
            v-for="(img, index) in screenshotImages"
            :key="index"
            class="screenshot-item"
            @click="openFullSize(img)"
          >
            <img :src="getLocalImageUrl(img)" :alt="`第 ${index + 1} 页`" />
            <span class="page-num">{{ index + 1 }}</span>
          </div>
        </div>
      </div>

      <!-- watch 实时模式 -->
      <div v-else-if="currentMode === 'watch'" class="watch-viewer">
        <div v-if="loading" class="preview-loading">启动实时预览...</div>
        <webview
          v-else
          :src="watchUrl"
          class="preview-webview"
          @did-finish-load="onWebviewLoad"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'

const props = defineProps<{
  filePath: string
}>()

const appStore = useAppStore()
const loading = ref(false)
const currentMode = ref<'html' | 'screenshots' | 'watch'>('html')
const htmlPreviewUrl = ref('')
const screenshotImages = ref<string[]>([])
const watchUrl = ref('')
const watchId = ref('')

const fileName = computed(() => {
  const parts = props.filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1]
})

const fileIcon = computed(() => {
  const ext = fileName.value.split('.').pop()?.toLowerCase()
  const icons: Record<string, string> = {
    pptx: '📊',
    docx: '📝',
    xlsx: '📈',
    pdf: '📄',
  }
  return icons[ext] || '📄'
})

const availableModes = computed(() => {
  const ext = fileName.value.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') {
    return [{ id: 'html' as const, label: 'HTML 预览' }]
  }
  return [
    { id: 'html' as const, label: 'HTML 预览' },
    { id: 'screenshots' as const, label: '缩略图' },
    { id: 'watch' as const, label: '实时预览' },
  ]
})

async function renderHtml() {
  loading.value = true
  try {
    const htmlPath = await api.officecli.viewHtml(props.filePath)
    htmlPreviewUrl.value = pathToFileURL(htmlPath)
  } catch (err) {
    console.error('HTML 渲染失败:', err)
  } finally {
    loading.value = false
  }
}

async function renderScreenshots() {
  loading.value = true
  try {
    const tmpDir = `${props.filePath}.screenshots`
    const images = await api.officecli.viewScreenshot(props.filePath, tmpDir)
    screenshotImages.value = images
  } catch (err) {
    console.error('截图生成失败:', err)
  } finally {
    loading.value = false
  }
}

async function startWatch() {
  loading.value = true
  try {
    const handle = await api.officecli.watchStart(props.filePath)
    watchId.value = handle.id
    watchUrl.value = handle.url
  } catch (err) {
    console.error('watch 启动失败:', err)
  } finally {
    loading.value = false
  }
}

async function switchMode(mode: 'html' | 'screenshots' | 'watch') {
  // 停止之前的 watch
  if (watchId.value) {
    await api.officecli.watchStop(watchId.value)
    watchId.value = ''
  }
  currentMode.value = mode
  if (mode === 'html') await renderHtml()
  else if (mode === 'screenshots') await renderScreenshots()
  else if (mode === 'watch') await startWatch()
}

function getLocalImageUrl(imgPath: string): string {
  return pathToFileURL(imgPath)
}

/** 跨平台 file:// URL：Windows 产生 file:///C:/...，macOS/Linux 产生 file:///Users/... */
function pathToFileURL(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  // Windows 绝对路径形如 C:/... → file:///C:/...
  // Unix 绝对路径形如 /Users/... → file:///Users/...
  return 'file://' + (normalized.startsWith('/') ? '' : '/') + normalized
}

function openFullSize(imgPath: string) {
  api.openInEditor('fileExplorer', imgPath)
}

function openExternal() {
  api.artifacts.open(props.filePath)
}

function revealInFolder() {
  api.artifacts.reveal(props.filePath)
}

function onWebviewLoad() {
  loading.value = false
}

watch(() => props.filePath, async (newPath) => {
  if (newPath) {
    await switchMode(currentMode.value)
  }
})

onMounted(async () => {
  await switchMode('html')
})

onBeforeUnmount(async () => {
  if (watchId.value) {
    await api.officecli.watchStop(watchId.value)
  }
})
</script>

<style scoped lang="scss">
.office-preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.preview-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  .file-icon { font-size: 18px; }
  .file-name { font-size: 13px; color: var(--text-primary); }
}

.preview-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.preview-mode-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  &.active {
    background: var(--accent-color);
    color: white;
    border-color: var(--accent-color);
  }
}

.preview-action-btn {
  padding: 4px 8px;
  font-size: 14px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
}

.preview-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 14px;
}

.preview-webview {
  width: 100%;
  height: 100%;
  border: none;
}

.screenshot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  height: 100%;
}

.screenshot-item {
  position: relative;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s;
  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  img {
    width: 100%;
    display: block;
  }
  .page-num {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
  }
}
</style>
```

### 6.4 ArtifactsPanel 增强

修改 `src/components/work/ArtifactsPanel.vue`，双击文件时优先在 PreviewPanel 内嵌预览：

```vue
<!-- 在文件列表项的双击处理中 -->
<script setup lang="ts">
async function handleFileDoubleClick(file: ArtifactFile) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const officeExtensions = ['pptx', 'docx', 'xlsx', 'pdf']

  if (officeExtensions.includes(ext)) {
    // office 文件：在应用内预览
    appStore.openOfficePreview(file.path, 'html')
  } else if (ext === 'html' || ext === 'htm') {
    // HTML 文件：webview 预览（现有逻辑）
    appStore.openFileInWebview(file.path)
  } else {
    // 其他文件：OS 默认程序打开
    await api.artifacts.open(file.path)
  }
}
</script>
```

在 ArtifactsPanel 的每个文件项上增加"预览"按钮（眼睛图标），点击触发 `handleFileDoubleClick`。

### 6.5 InfoPanel 集成

修改 `src/components/layout/InfoPanel.vue`，新增 `office-preview` 的渲染分支。

> **注意实际组件 API**：`<InfoPanelTabBar />` 是自包含组件，**无 `v-model`/`:tabs` props**（它直接读 `appStore.infoPanelTabs`/`activeInfoTabId`）。面板内容按 `mode`（来自 `appStore.infoPanelMode`，即 `activeInfoTab.type`）分发，用 `v-if/v-else-if` 链。

```vue
<template>
  <aside class="info-panel" :class="[mode]">
    <InfoPanelTabBar />

    <div class="panel-content">
      <!-- 现有 tabs（保持不变） -->
      <DiffViewer v-if="mode === 'diff'" />
      <CodeViewer v-else-if="mode === 'file'" />
      <MarkdownViewer v-else-if="mode === 'markdown'" ... />
      <ToolDiffViewer v-else-if="mode === 'tool-diff'" />
      <ArtifactsPanel v-else-if="mode === 'artifacts'" />
      <TerminalPanel v-else-if="mode === 'terminal'" />
      <template v-else-if="mode === 'webview'"> ... </template>

      <!-- 新增 office-preview 分支 -->
      <PreviewPanel
        v-else-if="mode === 'office-preview'"
        :file-path="appStore.officePreviewFile"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
const appStore = useAppStore()
// mode 是 computed，来自 activeInfoTab.type（无需新增 ref）
const mode = computed(() => appStore.infoPanelMode)
</script>
```

### 6.6 渲染流程

#### 6.6.1 HTML 预览流程

```
用户双击 .pptx 文件
  → ArtifactsPanel.handleFileDoubleClick
  → appStore.openOfficePreview(filePath, 'html')
  → InfoPanel 切换到 office-preview tab
  → PreviewPanel.onMounted → switchMode('html')
  → api.officecli.viewHtml(filePath)
  → 主进程: officecli view <file> html -o <tmp>
  → 返回 HTML 文件路径
  → webview 加载 file:///tmp/xxx.html
  → 用户看到渲染后的文档
```

#### 6.6.2 实时预览流程

```
用户点击"实时预览"按钮
  → PreviewPanel.switchMode('watch')
  → api.officecli.watchStart(filePath)
  → 主进程: spawn officecli watch <file>
  → 解析 stdout 获取端口号
  → 返回 { id, url: 'http://localhost:26315' }
  → webview 加载 http://localhost:26315
  → agent 执行 add/set/remove 命令
  → 浏览器自动刷新
  → 用户看到实时更新的预览
```

#### 6.6.3 缩略图流程

```
用户点击"缩略图"按钮
  → PreviewPanel.switchMode('screenshots')
  → api.officecli.viewScreenshot(filePath, tmpDir)
  → 主进程: officecli view <file> screenshot -o <tmpDir>
  → 返回 PNG 文件路径列表
  → 网格展示所有页面的缩略图
  → 点击缩略图可放大查看
```

### 6.7 验证标准

1. 双击 .pptx 产物文件，InfoPanel 切换到 office-preview tab，显示渲染后的幻灯片
2. 切换到"缩略图"模式，显示所有页面的 PNG 缩略图网格
3. 切换到"实时预览"模式，webview 加载 watch URL，agent 修改文件后预览自动刷新
4. .docx 文件能正确渲染为 HTML 并在 webview 中显示
5. .xlsx 文件能正确渲染为 HTML 并在 webview 中显示
6. "外部打开"按钮调用 OS 默认程序打开文件
7. 关闭预览 tab 时，若有 watch 进程则自动停止

---

## 7. Phase 3: 办公技能升级

### 7.1 目标

用 OfficeCLI 的 11 个专业化技能替换现有 Node 办公技能，大幅提升产物质量与能力广度。

### 7.2 技能库引入

#### 7.2.1 技能目录结构

从 OfficeCLI 仓库 `skills/` 目录引入，放入 SpaceCode 的 `skills-lib/`：

```
skills-lib/
├── officecli/                    # OfficeCLI 主技能（通用入口）
│   └── SKILL.md
├── officecli-pptx/               # PPT 通用创建
│   └── SKILL.md
├── officecli-docx/               # Word 通用创建
│   └── SKILL.md
├── officecli-xlsx/               # Excel 通用创建
│   └── SKILL.md
├── morph-ppt/                    # Morph 动画 PPT
│   └── SKILL.md
├── morph-ppt-3d/                 # 3D Morph PPT
│   └── SKILL.md
├── officecli-pitch-deck/         # 融资路演 deck
│   └── SKILL.md
├── officecli-academic-paper/     # 学术论文
│   └── SKILL.md
├── officecli-financial-model/    # 财务模型
│   └── SKILL.md
├── officecli-data-dashboard/     # 数据看板
│   └── SKILL.md
├── officecli-word-form/          # Word 表单
│   └── SKILL.md
├── pptx/                         # 保留：Node 降级方案
│   ├── SKILL.md
│   └── scripts/
├── docx/                         # 保留：Node 降级方案
│   ├── SKILL.md
│   └── scripts/
├── xlsx/                         # 保留：Node 降级方案
│   ├── SKILL.md
│   └── scripts/
└── pdf/                          # 保留：现有 PDF 技能
    └── SKILL.md
```

#### 7.2.2 技能 SKILL.md 格式

OfficeCLI 的 SKILL.md 已使用 frontmatter 格式，与 SpaceCode 的 `loadSkillsDir.ts` 兼容：

```yaml
---
name: officecli-pptx
description: "Use this skill any time a .pptx file is involved -- as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx file; editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates, layouts, speaker notes, or comments. Trigger whenever the user mentions 'deck', 'slides', 'presentation', 'pitch', or references a .pptx filename."
---
# OfficeCLI PPTX Skill
## Setup
...
```

引擎的 `loadSkillsDir.ts` 扫描 `.claude/skills` 目录，发现 `SKILL.md` 后**按目录名注册技能**（非 frontmatter 的 `name` 字段）。因此 `skills-lib/officecli-pptx/SKILL.md` 注册为技能名 `officecli-pptx`（目录名），frontmatter 的 `name` 仅用于展示。**目录名必须与 frontmatter `name` 一致**，否则助手 frontmatter 的 `skills: [officecli-pptx]` 引用会失效。无需修改引擎代码。

#### 7.2.3 技能安装流程

现有 `startWorkAssistantSession` 已支持将 skill 安装到 `<cwd>/.claude/skills/`：

```typescript
// src/stores/chatSession.ts (现有逻辑，无需修改)
for (const skill of assistant.skills || []) {
  await api.skills.installLocal(skill, 'project', cwd)
}
```

`skillsService.ts` 的 `installLocal` 从 `skills-lib/` 复制到 `<cwd>/.claude/skills/<name>/`。新增的 officecli 技能自动被覆盖。

### 7.3 助手 frontmatter 更新

更新 `agents-lib/work/` 下需要改动的 14 个助手 frontmatter（其余 8 个纯 prompt 型助手如 `human-3-coach`/`story-roleplay` 等 `skills: []` 无需改动），将 `skills` 字段改为对应的 officecli 技能：

| 助手 | 现有 skills | 新 skills | 说明 |
|---|---|---|---|
| ppt-creator | `[pptx]` | `[officecli-pptx]` | PPT 通用 |
| morph-ppt | `[pptx]` | `[morph-ppt]` | Morph 动画 |
| morph-ppt-3d | `[pptx]` | `[morph-ppt-3d]` | 3D Morph |
| pitch-deck-creator | `[pptx]` | `[officecli-pitch-deck]` | 融资路演 |
| magazine-ppt-creator | `[guizang-ppt-skill]` | `[guizang-ppt-skill, officecli-pptx]` | 杂志风 PPT（保留原 skill + 增 officecli） |
| html-ppt-creator | `[html-ppt]` | `[html-ppt]` | HTML PPT 不变 |
| word-creator | `[docx]` | `[officecli-docx]` | Word 通用 |
| word-form-creator | `[docx]` | `[officecli-word-form]` | Word 表单 |
| moltbook | `[docx]` | `[officecli-docx]` | 长文/电子书 |
| academic-paper | `[docx, pdf]` | `[officecli-academic-paper, pdf]` | 学术论文（**保留 pdf** 用于导出/引用） |
| excel-creator | `[xlsx]` | `[officecli-xlsx]` | Excel 通用 |
| financial-model-creator | `[xlsx]` | `[officecli-financial-model]` | 财务模型 |
| dashboard-creator | `[xlsx]` | `[officecli-data-dashboard]` | 数据看板 |
| cowork | `[planning-with-files, pptx, docx, xlsx]` | `[planning-with-files, officecli-pptx, officecli-docx, officecli-xlsx]` | 混合产物 |

示例（ppt-creator.md）：

```yaml
---
name: ppt-creator
mode: work
category: office
description: 生成可编辑的 .pptx 演示文稿
description_zh: 生成可编辑的 PPT 演示文稿
avatar: "📊"
model: sonnet
permission: acceptEdits
skills: [officecli-pptx]          # ★ 改为 officecli 技能
mcps: []
recommendedPrompts:
  - 把这份大纲做成 12 页商业路演 PPT
  - 根据这份 Word 文档生成同主题幻灯片
recommendedPrompts_zh:
  - 把这份大纲做成 12 页商业路演 PPT
---
```

### 7.4 助手 prompt 增强（render→look→fix 闭环）

> **前提**：以下 `officecli` 命令依赖 §5.6 的 PATH 解决方案（`officecli install` + `buildEnv` 注入）。agent 的 Bash 工具必须能直接执行 `officecli` 命令。

在每个办公助手 `.md` 正文末尾追加"自查排版"步骤：

```markdown
## 产物自查（重要）
生成文件后，必须执行以下自查步骤：
1. 运行 `officecli view <file> screenshot -o /tmp/preview` 生成截图
2. 查看截图，检查以下问题：
   - 文字是否溢出或重叠
   - 排版是否对齐
   - 颜色搭配是否协调
   - 图表是否正确显示
3. 如发现问题，用 `officecli set` 修正后重新截图确认
4. 确认无误后再交付

这确保你"看见"了产物效果，而非盲目生成。
```

### 7.5 降级方案

保留现有 `skills-lib/pptx,docx,xlsx` 作为降级回退。当 OfficeCLI 二进制不可用时（如检测失败），助手可回退到 Node 技能：

在 `startWorkAssistantSession` 中增加检测逻辑：

> **注意**：现有 `startWorkAssistantSession`（`src/stores/chatSession.ts` 行 1294）参数为内联类型 `{ name; skills?; permission? }`，非完整 `AgentDef`。本方案将其签名扩展为接收 `AgentDef`（向后兼容：内联类型的字段是 `AgentDef` 的子集）。

```typescript
// src/stores/chatSession.ts
async function startWorkAssistantSession(assistant: AgentDef) {
  const cwd = appStore.workWorkspace || appStore.projectRoot

  // 检测 OfficeCLI 是否可用
  const officeCliAvailable = await api.officecli.checkInstalled()

  // 根据可用性选择技能
  let skillsToInstall = assistant.skills || []
  if (!officeCliAvailable) {
    // 降级：officecli-* → Node 技能
    skillsToInstall = skillsToInstall.map(skill => {
      const fallbackMap: Record<string, string> = {
        'officecli-pptx': 'pptx',
        'officecli-docx': 'docx',
        'officecli-xlsx': 'xlsx',
        'morph-ppt': 'pptx',
        'morph-ppt-3d': 'pptx',
        'officecli-pitch-deck': 'pptx',
        'officecli-academic-paper': 'docx',
        'officecli-financial-model': 'xlsx',
        'officecli-data-dashboard': 'xlsx',
        'officecli-word-form': 'docx',
      }
      return fallbackMap[skill] || skill
    })
    console.warn('OfficeCLI 不可用，降级为 Node 技能:', skillsToInstall)
  }

  // 安装 agent
  await api.agents.install(assistant.name, 'global', cwd)

  // 安装技能
  for (const skill of skillsToInstall) {
    await api.skills.installLocal(skill, 'project', cwd)
  }

  // ... 其余现有逻辑 ...
}
```

### 7.6 验证标准

1. 选择 ppt-creator 助手启动会话，技能列表显示 `officecli-pptx`
2. 生成 PPT 后，助手自动执行 `view screenshot` 自查排版
3. 产物质量（排版/图表/动效）显著优于现有 pptxgenjs 方案
4. OfficeCLI 不可用时，自动降级为 Node 技能，助手仍可工作（但产物质量回退）
5. cowork 助手能同时使用 3 个 officecli 技能生成混合产物

---

## 8. Phase 4: 助手技能绑定增强

### 8.1 目标

强化"助手默认绑定一个或多个技能"机制，支持技能组合可视化、可用性校验、技能市场联动。

### 8.2 AgentDef 扩展

在 `electron/agentsService.ts` 和 `src/stores/agents.ts` 同步扩展 `AgentDef`：

```typescript
export interface AgentDef {
  // 现有字段
  name: string
  description: string
  content: string
  tools?: string[]
  model?: string
  color?: string
  sourceDir: string
  agentPath: string
  isInstalled: boolean
  installedScope?: 'global' | 'project'
  category: string
  mode?: 'work' | 'code'
  avatar?: string
  permission?: string
  skills?: string[]
  mcps?: string[]
  recommendedPrompts?: string[]
  descriptionZh?: string
  recommendedPromptsZh?: string[]

  // ===== 新增字段 =====
  /** 技能是否为必须（缺则无法启动会话） */
  skillsRequired?: boolean
  /** 技能依赖的运行时（如 'officecli'），用于可用性检测 */
  skillRuntime?: 'officecli' | 'node' | 'none'
  /** 技能描述（用于 UI 展示，非技能名） */
  skillDescriptions?: string[]
}
```

### 8.3 技能可用性校验

在 `startWorkAssistantSession` 增加校验：

```typescript
async function startWorkAssistantSession(assistant: AgentDef) {
  const cwd = appStore.workWorkspace || appStore.projectRoot

  // 技能可用性校验
  if (assistant.skillRuntime === 'officecli') {
    const available = await api.officecli.checkInstalled()
    if (!available && assistant.skillsRequired) {
      // 弹窗提示
      const confirmed = await showConfirmDialog({
        title: 'OfficeCLI 不可用',
        message: `助手 "${assistant.name}" 需要 OfficeCLI，但未检测到。是否降级为 Node 技能继续？`,
        confirmText: '降级继续',
        cancelText: '取消',
      })
      if (!confirmed) return
    }
  }

  // ... 继续现有逻辑 ...
}
```

### 8.4 技能组合可视化

修改 `src/components/work/WorkAssistantGallery.vue`，在助手卡片上展示技能标签：

```vue
<template>
  <div class="assistant-card" @click="selectAssistant(assistant)">
    <div class="assistant-avatar">{{ assistant.avatar || '🤖' }}</div>
    <div class="assistant-info">
      <div class="assistant-name">{{ assistant.name }}</div>
      <div class="assistant-desc">{{ assistant.descriptionZh || assistant.description }}</div>
      <!-- 新增：技能标签 -->
      <div class="assistant-skills" v-if="assistant.skills?.length">
        <span
          v-for="skill in assistant.skills"
          :key="skill"
          class="skill-badge"
          :class="{ 'skill-available': isSkillAvailable(skill) }"
        >
          {{ skill }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const officeCliAvailable = ref(false)

onMounted(async () => {
  officeCliAvailable.value = await api.officecli.checkInstalled()
})

function isSkillAvailable(skillName: string): boolean {
  if (skillName.startsWith('officecli') || skillName.startsWith('morph')) {
    return officeCliAvailable.value
  }
  return true // Node 技能始终可用
}
</script>

<style scoped lang="scss">
.assistant-skills {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.skill-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);

  &.skill-available {
    background: rgba(34, 197, 94, 0.1);
    color: rgb(22, 163, 74);
    border-color: rgba(34, 197, 94, 0.3);
  }
}
</style>
```

### 8.5 验证标准

1. 助手卡片显示绑定的技能标签（绿色=可用，灰色=不可用）
2. OfficeCLI 未安装时，officecli 技能标签为灰色
3. 启动需要 OfficeCLI 的助手时，若不可用则弹窗提示降级
4. cowork 助手显示 3 个技能标签

---

## 9. Phase 5: 自定义办公助手

### 9.1 目标

让用户能创建自定义办公助手并绑定技能，支持模板快速创建。

### 9.2 自定义助手编辑器

新增 `src/components/work/CustomAssistantEditor.vue`：

```vue
<template>
  <div class="custom-assistant-editor">
    <div class="editor-header">
      <h2>{{ editing ? '编辑助手' : '创建自定义助手' }}</h2>
    </div>

    <div class="editor-form">
      <!-- 基本信息 -->
      <div class="form-section">
        <div class="form-label">名称</div>
        <input v-model="form.name" type="text" placeholder="my-ppt-assistant" class="form-input" />
      </div>

      <div class="form-section">
        <div class="form-label">显示名称（中文）</div>
        <input v-model="form.descriptionZh" type="text" placeholder="我的 PPT 助手" class="form-input" />
      </div>

      <div class="form-section">
        <div class="form-label">头像（emoji）</div>
        <input v-model="form.avatar" type="text" placeholder="📊" class="form-input emoji-input" />
      </div>

      <div class="form-section">
        <div class="form-label">描述</div>
        <textarea v-model="form.description" placeholder="助手的功能描述" class="form-textarea"></textarea>
      </div>

      <!-- 模式 -->
      <div class="form-section">
        <div class="form-label">模式</div>
        <select v-model="form.mode" class="form-select">
          <option value="work">Work（办公）</option>
          <option value="code">Code（编程）</option>
        </select>
      </div>

      <!-- 技能绑定（核心） -->
      <div class="form-section">
        <div class="form-label">
          绑定技能
          <span class="form-hint">选择此助手需要的办公技能</span>
        </div>
        <div class="skill-checkbox-group">
          <label
            v-for="skill in availableSkills"
            :key="skill.name"
            class="skill-checkbox-item"
            :class="{ 'skill-unavailable': !skill.available }"
          >
            <input
              type="checkbox"
              :value="skill.name"
              v-model="form.skills"
              :disabled="!skill.available"
            />
            <span class="skill-name">{{ skill.name }}</span>
            <span class="skill-desc">{{ skill.description }}</span>
          </label>
        </div>
      </div>

      <!-- 模型与权限 -->
      <div class="form-row">
        <div class="form-section">
          <div class="form-label">模型</div>
          <select v-model="form.model" class="form-select">
            <option value="">默认</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
          </select>
        </div>
        <div class="form-section">
          <div class="form-label">权限模式</div>
          <select v-model="form.permission" class="form-select">
            <option value="acceptEdits">acceptEdits</option>
            <option value="default">default</option>
            <option value="plan">plan</option>
            <option value="bypassPermissions">bypassPermissions</option>
          </select>
        </div>
      </div>

      <!-- 推荐 prompt -->
      <div class="form-section">
        <div class="form-label">推荐起手 Prompt（每行一个）</div>
        <textarea
          v-model="recommendedPromptsText"
          placeholder="把这份大纲做成 12 页商业路演 PPT&#10;根据这份 Word 文档生成同主题幻灯片"
          class="form-textarea"
        ></textarea>
      </div>

      <!-- 系统提示 -->
      <div class="form-section">
        <div class="form-label">系统提示（角色设定）</div>
        <textarea
          v-model="form.content"
          placeholder="你是一个专业的 PPT 制作助手..."
          class="form-textarea content-textarea"
        ></textarea>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="editor-actions">
      <button class="btn-cancel" @click="$emit('close')">取消</button>
      <button class="btn-save" @click="saveAssistant">保存</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/services/electronAPI'

const emit = defineEmits<{
  close: []
  saved: [name: string]
}>()

const form = ref({
  name: '',
  description: '',
  descriptionZh: '',
  avatar: '🤖',
  mode: 'work' as 'work' | 'code',
  category: 'custom',
  model: '',
  permission: 'acceptEdits',
  skills: [] as string[],
  content: '',
  recommendedPrompts: [] as string[],
  recommendedPromptsZh: [] as string[],
})

const availableSkills = ref<Array<{ name: string; description: string; available: boolean }>>([])
const officeCliAvailable = ref(false)
const editing = ref(false)

const recommendedPromptsText = computed({
  get: () => form.value.recommendedPromptsZh?.join('\n') || '',
  set: (val: string) => {
    form.value.recommendedPromptsZh = val.split('\n').filter(s => s.trim())
    form.value.recommendedPrompts = form.value.recommendedPromptsZh
  },
})

onMounted(async () => {
  officeCliAvailable.value = await api.officecli.checkInstalled()

  // 加载可用技能列表
  const skills = await api.skills.getBundledSkills()
  availableSkills.value = skills.map((s: any) => ({
    name: s.name,
    description: s.description || '',
    available: s.name.startsWith('officecli') || s.name.startsWith('morph')
      ? officeCliAvailable.value
      : true,
  }))
})

async function saveAssistant() {
  if (!form.value.name) {
    alert('请输入助手名称')
    return
  }

  // 校验名称（仅字母/数字/连字符，避免路径问题）
  if (!/^[a-zA-Z0-9-]+$/.test(form.value.name)) {
    alert('助手名称只能包含字母、数字和连字符')
    return
  }

  // 生成 agent .md frontmatter + 正文
  const frontmatter: Record<string, any> = {
    name: form.value.name,
    mode: form.value.mode,
    category: form.value.category,
    description: form.value.description,
    description_zh: form.value.descriptionZh,
    avatar: form.value.avatar,
    model: form.value.model || undefined,
    permission: form.value.permission,
    skills: form.value.skills,
    recommendedPrompts: form.value.recommendedPrompts,
    recommendedPrompts_zh: form.value.recommendedPromptsZh,
  }

  // 移除空值
  Object.keys(frontmatter).forEach(k => {
    if (frontmatter[k] === undefined || frontmatter[k] === '' || frontmatter[k] === null) {
      delete frontmatter[k]
    }
  })

  // 生成 YAML frontmatter（含转义）
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}: [${v.map(yamlEscape).join(', ')}]`
      }
      return `${k}: ${yamlEscape(v)}`
    })
    .join('\n')

  const mdContent = `---\n${yaml}\n---\n\n${form.value.content || ''}\n`

  // 调用新增 IPC 直接写文件到 ~/.claude/agents/<name>.md（见下方 agents:saveCustom）
  try {
    await api.agents.saveCustom(form.value.name, mdContent)
    emit('saved', form.value.name)
    emit('close')
  } catch (err) {
    alert(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** YAML 值转义：含特殊字符（: # [ ] { } , & * ! | > ' " % @）时用双引号包裹并转义内部双引号 */
function yamlEscape(v: any): string {
  const s = String(v)
  if (/[:#\[{}\],&*!|>'"%@\n\r]/.test(s) || s.includes(' ')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}
</script>
```

### 9.3 助手模板

在 `CustomAssistantEditor.vue` 中提供模板快速创建：

```typescript
const templates = [
  {
    name: 'custom-ppt',
    label: '自定义 PPT 助手',
    avatar: '📊',
    mode: 'work',
    skills: ['officecli-pptx'],
    content: '你是一个专业的 PPT 制作助手。根据用户需求，使用 officecli 创建高质量的可编辑 .pptx 文件。',
  },
  {
    name: 'custom-word',
    label: '自定义 Word 助手',
    avatar: '📝',
    mode: 'work',
    skills: ['officecli-docx'],
    content: '你是一个专业的 Word 文档制作助手。根据用户需求，使用 officecli 创建高质量的可编辑 .docx 文件。',
  },
  {
    name: 'custom-excel',
    label: '自定义 Excel 助手',
    avatar: '📈',
    mode: 'work',
    skills: ['officecli-xlsx'],
    content: '你是一个专业的 Excel 表格制作助手。根据用户需求，使用 officecli 创建高质量的可编辑 .xlsx 文件。',
  },
  {
    name: 'custom-multi',
    label: '多技能助手',
    avatar: '🚀',
    mode: 'work',
    skills: ['officecli-pptx', 'officecli-docx', 'officecli-xlsx'],
    content: '你是一个全能办公助手，能同时处理 PPT、Word、Excel 三种格式。根据用户需求选择合适的技能。',
  },
]

function applyTemplate(template: typeof templates[0]) {
  Object.assign(form.value, template)
}
```

### 9.4 WorkAssistantGallery 集成

在助手画廊增加"创建自定义助手"入口：

```vue
<template>
  <div class="assistant-gallery">
    <!-- 新增：创建按钮 -->
    <div class="create-assistant-card" @click="showEditor = true">
      <div class="create-icon">+</div>
      <div class="create-text">创建自定义助手</div>
    </div>

    <!-- 现有助手列表 -->
    <div v-for="assistant in assistants" :key="assistant.name" class="assistant-card">
      ...
    </div>

    <!-- 编辑器弹窗 -->
    <CustomAssistantEditor
      v-if="showEditor"
      @close="showEditor = false"
      @saved="onAssistantSaved"
    />
  </div>
</template>
```

### 9.5 验证标准

1. 点击"创建自定义助手"，打开编辑器表单
2. 选择模板"自定义 PPT 助手"，表单自动填充
3. 选择技能 officecli-pptx，保存
4. 助手列表出现新创建的助手
5. 点击新助手能启动会话，技能正确安装

---

## 10. Phase 6: 产物管理增强

### 10.1 目标

用 fs.watch 替换 3s 轮询实现实时产物推送，支持 per-session workspace。

### 10.2 fs.watch 替换轮询

修改 `electron/artifactsService.ts`：

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { BrowserWindow } from 'electron'

// 产物目录的 watcher
let artifactsWatcher: fs.FSWatcher | null = null

function startArtifactsWatch(artifactsDir: string): void {
  // 停止旧的 watcher
  if (artifactsWatcher) {
    artifactsWatcher.close()
    artifactsWatcher = null
  }

  if (!fs.existsSync(artifactsDir)) {
    return
  }

  // 使用 recursive watch 监听 outputs 目录
  // 注意：recursive:true 仅 macOS/Windows 支持，Linux 下退化为非递归（仅监听顶层）
  // 若需 Linux 递归监听，引入 chokidar 作为可选依赖
  artifactsWatcher = fs.watch(artifactsDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return
    // 过滤噪声文件
    if (filename.includes('node_modules') || filename.includes('.git')) return

    // 通知渲染进程产物已变化
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('artifacts:changed', { eventType, filename })
    }
  })

  // Linux 兼容：若 recursive 被忽略，补充监听子目录
  if (process.platform === 'linux') {
    try {
      const subdirs = fs.readdirSync(artifactsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => path.join(artifactsDir, d.name))
      for (const subdir of subdirs) {
        fs.watch(subdir, (eventType, filename) => {
          if (!filename) return
          const windows = BrowserWindow.getAllWindows()
          for (const win of windows) {
            win.webContents.send('artifacts:changed', { eventType, filename: path.basename(subdir) + '/' + filename })
          }
        })
      }
    } catch {
      // 子目录监听失败不阻断主流程
    }
  }
}

// IPC: 启动监听
ipcMain.handle('artifacts:startWatch', async (_event, dir: string) => {
  startArtifactsWatch(dir)
  return true
})

// IPC: 停止监听
ipcMain.handle('artifacts:stopWatch', async () => {
  if (artifactsWatcher) {
    artifactsWatcher.close()
    artifactsWatcher = null
  }
  return true
})
```

preload 暴露（`electron/preload.ts` 的 `artifacts` 命名空间扩展）——**渲染进程不直接 import `ipcRenderer`**，通过 `api.artifacts.onChanged` 订阅：

```typescript
artifacts: {
  // ... 现有 list/open/reveal ...
  startWatch: (dir: string) => ipcRenderer.invoke('artifacts:startWatch', dir),
  stopWatch: () => ipcRenderer.invoke('artifacts:stopWatch'),
  /** 订阅产物变化，返回取消订阅函数 */
  onChanged: (callback: (data: { eventType: string; filename: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { eventType: string; filename: string }) => callback(data)
    ipcRenderer.on('artifacts:changed', handler)
    return () => ipcRenderer.removeListener('artifacts:changed', handler)
  },
},
```

渲染进程在 `ArtifactsPanel.vue` 中监听（**正确传递 handler 引用，避免 removeListener 失效**）：

```typescript
import { api } from '@/services/electronAPI'

let unsubscribe: (() => void) | null = null

onMounted(() => {
  // 启动 watch
  api.artifacts.startWatch(workingDir + '/outputs')

  // 监听变化（onChanged 返回取消订阅函数）
  unsubscribe = api.artifacts.onChanged(() => {
    refresh() // 立即刷新产物列表
  })
})

onBeforeUnmount(() => {
  // 调用返回的取消订阅函数（正确移除 handler，避免内存泄漏）
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  api.artifacts.stopWatch()
})
```

> **关键修复**：
> 1. 渲染进程不直接 `import { ipcRenderer } from 'electron'`（违反 contextBridge 沙箱），改用 `api.artifacts.onChanged(callback)` 模式
> 2. `onChanged` 返回取消订阅函数，`onBeforeUnmount` 调用它——而非 `ipcRenderer.removeListener('artifacts:changed')`（缺 handler 参数，实际不生效）
> 3. Linux 下 `fs.watch` 的 `recursive` 被忽略，补充子目录监听

### 10.3 per-session workspace

在 `src/stores/chatSession.ts` 中支持每个会话独立工作目录：

```typescript
interface ChatSession {
  // 现有字段
  id: string
  // ...

  // 新增：会话级工作目录（不设置则用全局 workWorkspace）
  customWorkspace?: string
}

async function startWorkAssistantSession(assistant: AgentDef, customWorkspace?: string) {
  const cwd = customWorkspace || appStore.workWorkspace || appStore.projectRoot

  // 创建会话时传入 customWorkspace
  const session = createSession(assistant.name, cwd)
  session.customWorkspace = customWorkspace

  // ... 其余逻辑 ...
}
```

在助手画廊中增加"工作目录"选择：

```vue
<div class="workspace-selector">
  <label>工作目录：</label>
  <input v-model="customWorkspace" type="text" :placeholder="defaultWorkspace" />
  <button @click="selectFolder">浏览...</button>
</div>
```

### 10.4 验证标准

1. 生成新文件后，ArtifactsPanel 立即刷新（无需等待 3s）
2. 删除文件后，列表立即更新
3. 每个会话可选择不同的工作目录，产物互不干扰
4. 应用退出时 watcher 正确关闭

---

## 11. 数据模型设计

### 11.1 AgentDef 完整定义（扩展后）

```typescript
// electron/agentsService.ts + src/stores/agents.ts 同步
export interface AgentDef {
  // === 现有字段 ===
  name: string
  description: string
  content: string
  tools?: string[]
  model?: string
  color?: string
  sourceDir: string
  agentPath: string
  isInstalled: boolean
  installedScope?: 'global' | 'project'
  category: string
  mode?: 'work' | 'code'
  avatar?: string
  permission?: string
  skills?: string[]
  mcps?: string[]
  recommendedPrompts?: string[]
  descriptionZh?: string
  recommendedPromptsZh?: string[]

  // === Phase 4 新增 ===
  skillsRequired?: boolean
  skillRuntime?: 'officecli' | 'node' | 'none'
  skillDescriptions?: string[]
}
```

### 11.2 OfficeCliWatchHandle

```typescript
export interface OfficeCliWatchHandle {
  id: string
  filePath: string
  port: number
  url: string
  process: ChildProcess
}
```

### 11.3 OfficeCliExecOptions / Result

```typescript
export interface OfficeCliExecOptions {
  args: string[]
  cwd?: string
  timeout?: number
  env?: Record<string, string>
}

export interface OfficeCliExecResult {
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}
```

### 11.4 InfoPanelTabType 扩展

```typescript
// InfoPanelTabType 是字符串联合类型（注意：不是 InfoPanelTab 接口）
type InfoPanelTabType =
  | 'file'
  | 'markdown'
  | 'diff'
  | 'tool-diff'
  | 'webview'
  | 'terminal'
  | 'artifacts'
  | 'office-preview'    // 新增

// InfoPanelTab 接口无需改动（type 字段已是 InfoPanelTabType）
```

---

## 12. IPC 接口清单

### 12.1 新增 IPC 接口（officecli 命名空间）

| Channel | 参数 | 返回值 | 用途 |
|---|---|---|---|
| `officecli:version` | 无 | `string` | 检测版本 |
| `officecli:checkInstalled` | 无 | `boolean` | 检测二进制是否存在 |
| `officecli:exec` | `OfficeCliExecOptions` | `OfficeCliExecResult` | 执行任意命令 |
| `officecli:viewHtml` | `filePath, outputDir?` | `string`（HTML 路径） | 渲染为 HTML |
| `officecli:viewScreenshot` | `filePath, outputDir, page?` | `string[]`（PNG 路径列表） | 渲染为截图 |
| `officecli:watch:start` | `filePath, port?` | `OfficeCliWatchHandle` | 启动实时预览 |
| `officecli:watch:stop` | `watchId` | `boolean` | 停止预览 |
| `officecli:watch:stopAll` | 无 | `number`（停止数量） | 停止所有预览 |
| `officecli:watch:list` | 无 | `Array<{id, filePath, url}>` | 活跃预览列表 |

### 12.2 新增 IPC 接口（agents 命名空间扩展）

| Channel | 参数 | 返回值 | 用途 |
|---|---|---|---|
| `agents:saveCustom` | `name: string, content: string` | `string`（文件路径） | 写入自定义助手 .md 到 `~/.claude/agents/<name>.md`（覆盖式） |

`agents:saveCustom` 主进程实现（`electron/agentsService.ts` 新增）：

```typescript
ipcMain.handle('agents:saveCustom', async (_event, name: string, content: string): Promise<string> => {
  // 校验名称（防路径穿越）
  if (!/^[a-zA-Z0-9-]+$/.test(name)) {
    throw new Error(`非法助手名称: ${name}`)
  }
  const agentsDir = path.join(os.homedir(), '.claude', 'agents')
  await fs.promises.mkdir(agentsDir, { recursive: true })
  const filePath = path.join(agentsDir, `${name}.md`)
  await fs.promises.writeFile(filePath, content, 'utf-8')
  return filePath
})
```

preload 暴露（`electron/preload.ts` 的 `agents` 命名空间）：

```typescript
agents: {
  // ... 现有方法 ...
  /** 保存自定义助手内容到 ~/.claude/agents/<name>.md（覆盖式，支持重复保存） */
  saveCustom: (name: string, content: string) =>
    ipcRenderer.invoke('agents:saveCustom', name, content),
},
```

### 12.3 新增 IPC 接口（artifacts 命名空间扩展）

| Channel | 参数 | 返回值 | 用途 |
|---|---|---|---|
| `artifacts:startWatch` | `dir` | `boolean` | 启动目录监听 |
| `artifacts:stopWatch` | 无 | `boolean` | 停止监听 |

### 12.4 事件推送（主进程→渲染进程）

| Event | 数据 | 用途 |
|---|---|---|
| `artifacts:changed` | `{ eventType, filename }` | 产物目录文件变化通知 |

---

## 13. 组件设计

### 13.1 新增组件清单

| 组件 | 路径 | 职责 |
|---|---|---|
| PreviewPanel | `src/components/work/PreviewPanel.vue` | office 文件预览面板（HTML/截图/watch 三模式） |
| CustomAssistantEditor | `src/components/work/CustomAssistantEditor.vue` | 自定义助手编辑器表单 |

### 13.2 修改组件清单

| 组件 | 路径 | 改动 |
|---|---|---|
| ArtifactsPanel | `src/components/work/ArtifactsPanel.vue` | 双击预览 + fs.watch 事件监听 |
| WorkAssistantGallery | `src/components/work/WorkAssistantGallery.vue` | 技能标签 + 自定义助手入口 |
| InfoPanel | `src/components/layout/InfoPanel.vue` | 新增 office-preview tab |
| App | `src/App.vue` | 无（InfoPanel 已集成） |

### 13.3 组件交互图

```
用户双击产物文件
  → ArtifactsPanel
    → appStore.openOfficePreview(filePath)
      → InfoPanel 切换到 office-preview tab
        → PreviewPanel
          → api.officecli.viewHtml(filePath)
          → 主进程 officeCliService
            → spawn officecli view <file> html
          → 返回 HTML 路径
          → webview 加载 file:///path.html
          → 用户看到渲染预览

用户点击"实时预览"
  → PreviewPanel.switchMode('watch')
    → api.officecli.watchStart(filePath)
      → 主进程 spawn officecli watch <file>
      → 返回 { id, url }
    → webview 加载 http://localhost:26315
    → agent 修改文件 → 浏览器自动刷新

用户创建自定义助手
  → WorkAssistantGallery 点击"+"
    → CustomAssistantEditor 打开
      → 选择模板/填写表单/选择技能
      → 保存 → ~/.claude/agents/<name>.md
    → 助手列表刷新
```

---

## 14. 实施路径与里程碑

### 14.1 实施顺序

```
Phase 1 (基础层)
  ├─ 5.2 二进制分发（resources/officecli/ + package.json）
  ├─ 5.3 officeCliService.ts IPC 服务
  ├─ 5.4 preload API 暴露
  └─ 5.5 验证：version/checkInstalled/exec/viewHtml/watch

Phase 2 (预览能力) ← 依赖 Phase 1
  ├─ 6.2 InfoPanelTab 扩展
  ├─ 6.3 PreviewPanel.vue 组件
  ├─ 6.4 ArtifactsPanel 增强
  ├─ 6.5 InfoPanel 集成
  └─ 6.7 验证：pptx/docx/xlsx 预览 + watch 实时刷新

Phase 3 (技能升级) ← 依赖 Phase 1
  ├─ 7.2 引入 11 个 officecli 技能到 skills-lib/
  ├─ 7.3 更新 22 个助手 frontmatter
  ├─ 7.4 助手 prompt 增强（render→look→fix）
  ├─ 7.5 降级方案
  └─ 7.6 验证：产物质量提升 + 自查排版

Phase 4 (技能绑定) ← 依赖 Phase 3
  ├─ 8.2 AgentDef 扩展
  ├─ 8.3 技能可用性校验
  ├─ 8.4 技能组合可视化
  └─ 8.5 验证：技能标签 + 降级提示

Phase 5 (自定义助手) ← 依赖 Phase 4
  ├─ 9.2 CustomAssistantEditor.vue
  ├─ 9.3 助手模板
  ├─ 9.4 Gallery 集成
  └─ 9.5 验证：创建/保存/启动自定义助手

Phase 6 (产物管理) ← 依赖 Phase 2
  ├─ 10.2 fs.watch 替换轮询
  ├─ 10.3 per-session workspace
  └─ 10.4 验证：实时刷新 + 独立工作目录
```

### 14.2 里程碑

| 里程碑 | 交付物 | 价值 |
|---|---|---|
| M1: OfficeCLI 可调用 | Phase 1 完成 | 基础能力就绪 |
| M2: 文件可预览 | Phase 2 完成 | 最大体验短板补齐 |
| M3: 办公能力升级 | Phase 3 完成 | 产物质量对齐 AionUI |
| M4: 技能体系完善 | Phase 4 完成 | 助手-技能绑定可视化 |
| M5: 自定义能力 | Phase 5 完成 | 用户可创建办公助手 |
| M6: 产物管理优化 | Phase 6 完成 | 实时推送 + 独立工作区 |

---

## 15. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| 1 | **二进制体积** | OfficeCLI 单二进制约 30-50MB，增加安装包体积 | 按平台只打包对应二进制；使用 electron-builder 的 `extraResources` 按平台过滤 |
| 2 | **Windows 路径/权限** | child_process 调用 exe 需处理路径空格、UAC | `spawn` 时 `shell: false` + 显式路径；路径用引号包裹 |
| 3 | **与现有 Node 技能共存** | 两套技能并存可能混淆 | 保留旧技能为降级方案；officecli 不可用时自动回退；UI 标签区分 |
| 4 | **watch 进程生命周期** | 会话结束/应用退出时残留进程 | `app.on('before-quit')` 统一 `cleanupOfficeCli()`；PreviewPanel `onBeforeUnmount` 停止 watch |
| 5 | **设计文档冲突** | work-mode-assistants-design.md §0 明确反对 OfficeCLI | 本文档 §1.3 已说明演进理由；建议在原文档顶部加注"已被 office-cli-integration-design.md 演进" |
| 6 | **webview 跨域限制** | file:// 协议加载 HTML 可能受限 | Electron webview 默认允许 file://；如需可配置 `webPreferences.webSecurity: false`（仅预览场景） |
| 7 | **OfficeCLI 版本更新** | 随包打包的版本可能过时 | 支持运行时检测版本 + 提示更新；配置 `autoUpdate` |
| 8 | **并发文件锁** | 多会话操作同一文件 | OfficeCLI Resident 模式自动处理文件锁；建议 per-session workspace（Phase 6） |
| 9 | **macOS 签名/公证** | 未签名二进制可能被 Gatekeeper 拦截 | 打包时对 officecli 二进制签名；或在首次运行时引导用户授权 |
| 10 | **OfficeCLI 技能 SKILL.md 兼容性** | OfficeCLI 的 SKILL.md 格式可能与引擎 loadSkillsDir 不完全兼容 | 验证 frontmatter 字段；必要时微调 SKILL.md 的 frontmatter（不修改引擎） |

---

## 16. 测试计划

### 16.1 单元测试

| 测试项 | 测试内容 | 验证标准 |
|---|---|---|
| getOfficeCliBinaryPath | 路径解析 | 开发/打包环境返回正确路径 |
| execOfficeCli | 命令执行 | `--version` 返回非空字符串 |
| viewHtml | HTML 渲染 | .pptx → HTML 文件生成且非空 |
| viewScreenshot | 截图渲染 | .pptx → PNG 文件列表且图片非空 |
| watchStart/Stop | watch 生命周期 | 启动返回 URL；停止后进程不存在 |
| 降级方案 | 技能回退 | officecli 不可用时 skills 替换为 Node 技能 |

### 16.2 集成测试

| 测试项 | 测试内容 | 验证标准 |
|---|---|---|
| PPT 预览全流程 | 双击 .pptx → 预览 | InfoPanel 显示渲染后的幻灯片 |
| Word 预览全流程 | 双击 .docx → 预览 | InfoPanel 显示渲染后的文档 |
| Excel 预览全流程 | 双击 .xlsx → 预览 | InfoPanel 显示渲染后的表格 |
| watch 实时预览 | 启动 watch → 修改文件 → 刷新 | 浏览器内容自动更新 |
| 助手技能绑定 | 选择 ppt-creator → 启动会话 | .claude/skills/ 下有 officecli-pptx |
| 自定义助手创建 | 编辑器 → 保存 → 列表 | 新助手出现且可启动会话 |
| 产物实时推送 | 生成文件 → ArtifactsPanel | 列表立即刷新（<1s） |

### 16.3 端到端测试

| 场景 | 操作 | 预期结果 |
|---|---|---|
| PPT 创建全流程 | 选择 ppt-creator → 输入需求 → 生成 → 预览 | 生成 .pptx + 应用内预览 + 产物质量合格 |
| 自查排版 | 助手生成后 view screenshot | 截图可见且 agent 能据此修正 |
| 多技能助手 | 选择 cowork → 生成 PPT+Word+Excel | 三种格式文件均生成且可预览 |
| 降级场景 | 删除 officecli 二进制 → 启动助手 | 弹窗提示 + 降级为 Node 技能 |
| 自定义助手 | 创建自定义 PPT 助手 → 启动 → 生成 | 全流程通畅 |
| 应用退出 | watch 运行中退出应用 | 无残留 officecli 进程 |

### 16.4 性能测试

| 指标 | 目标 |
|---|---|
| officecli 命令执行延迟 | `--version` < 1s；`create` < 2s |
| HTML 渲染延迟 | 10 页 PPT < 5s |
| 截图渲染延迟 | 10 页 PPT < 10s |
| watch 启动延迟 | < 3s |
| 产物列表刷新延迟 | fs.watch 触发后 < 500ms |
| 应用启动时 officecli 检测 | < 500ms（异步，不阻塞启动） |

---

## 17. 附录

### 17.1 OfficeCLI 命令速查

```bash
# 创建
officecli create deck.pptx
officecli create report.docx
officecli create data.xlsx

# 添加内容
officecli add deck.pptx / --type slide --prop title="Q4 Report"
officecli add report.docx /body --type paragraph --prop text="Executive Summary" --prop style=Heading1
officecli set data.xlsx /Sheet1/A1 --prop value="Name" --prop bold=true

# 查看
officecli view deck.pptx outline          # 大纲
officecli view deck.pptx html             # HTML 渲染
officecli view deck.pptx screenshot       # PNG 截图
officecli view deck.pptx issues           # 格式问题

# 获取
officecli get deck.pptx '/slide[1]' --depth 1 --json

# 修改
officecli set deck.pptx '/slide[1]/shape[1]' --prop font.color=red

# 实时预览
officecli watch deck.pptx                 # http://localhost:26315
officecli unwatch deck.pptx

# 保存关闭
officecli close deck.pptx
```

### 17.2 与原设计文档的差异对照

| 维度 | work-mode-assistants-design.md | 本文档 |
|---|---|---|
| 办公引擎 | Node skills (pptxgenjs/docx/exceljs) | OfficeCLI 单二进制 |
| 文件预览 | 仅 HTML webview | OfficeCLI 渲染 HTML/截图/watch |
| 系统依赖 | LibreOffice/pandoc/poppler | 无（二进制自包含） |
| 技能来源 | 自研 SKILL.md + scripts/ | OfficeCLI 开源 11 个技能 |
| render→look→fix | 无 | 有（screenshot 自查） |
| 助手数量 | 22 个 | 22 个（不变，仅更新 skills 绑定） |
| 模式切换 | Work/Code Tab | 不变 |
| Artifacts 面板 | 3s 轮询 | fs.watch 实时推送 |
| 自定义助手 | 工作流导出 | 专用编辑器 + 模板 |
| engine/ 改动 | 无 | 无（硬约束保持） |

### 17.3 参考链接

- AionUi 仓库：https://github.com/iOfficeAI/AionUi
- OfficeCLI 仓库：https://github.com/iOfficeAI/OfficeCLI
- OfficeCLI SKILL.md：https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/SKILL.md
- OfficeCLI 技能目录：https://github.com/iOfficeAI/OfficeCLI/tree/main/skills
- OfficeCLI 官网：https://officecli.ai/
- 原设计文档：[work-mode-assistants-design.md](./work-mode-assistants-design.md)
