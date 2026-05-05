# SpaceCode Code Wiki

> 本文档是 SpaceCode 项目的结构化代码百科，涵盖项目整体架构、主要模块职责、关键类与函数说明、依赖关系以及项目运行方式等关键信息。

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 整体架构](#2-整体架构)
- [3. 技术栈与依赖](#3-技术栈与依赖)
- [4. 目录结构](#4-目录结构)
- [5. 核心模块详解](#5-核心模块详解)
  - [5.1 CLI 引擎（engine/）](#51-cli-引擎engine)
  - [5.2 Electron 主进程（electron/）](#52-electron-主进程electron)
  - [5.3 Vue 3 渲染进程（src/）](#53-vue-3-渲染进程src)
  - [5.4 Workspace 原生包（engine/packages/）](#54-workspace-原生包enginepackages)
- [6. 关键类与函数说明](#6-关键类与函数说明)
  - [6.1 CLI 引擎核心](#61-cli-引擎核心)
  - [6.2 Electron 主进程核心](#62-electron-主进程核心)
  - [6.3 Vue 3 前端核心](#63-vue-3-前端核心)
- [7. 数据流与通信机制](#7-数据流与通信机制)
- [8. 模块依赖关系](#8-模块依赖关系)
- [9. 项目运行方式](#9-项目运行方式)
- [10. 构建与发布](#10-构建与发布)
- [11. 扩展开发指南](#11-扩展开发指南)

---

## 1. 项目概述

SpaceCode 是一款 AI 驱动的智能编程助手，提供两种使用方式：

| 使用方式 | 入口 | 技术栈 | 目标用户 |
|----------|------|--------|----------|
| **CLI 终端版** | `engine/` | Bun + TypeScript + React/Ink | 终端爱好者、DevOps 工程师 |
| **Desktop 桌面版** | 根目录 | Electron + Vue 3 + Vite | 可视化用户、初学者 |

项目采用 **Monorepo** 架构，CLI 引擎作为核心计算层，Desktop 应用通过 Electron IPC 桥接调用引擎能力，避免重复实现业务逻辑。

核心价值：

- **45+ 内置工具**：覆盖文件操作、代码搜索、Web 抓取、Shell 执行等场景
- **60+ 斜杠命令**：提供直观的操作入口，无需记忆复杂参数
- **多模型支持**：兼容 Anthropic、OpenAI、Gemini、Grok 等主流 LLM 服务商
- **多会话管理**：浏览器式 Tab 界面，进程池 + LRU 淘汰策略
- **跨平台**：Windows / macOS / Linux 全覆盖

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Desktop 应用层                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Sidebar  │  │ChatPanel │  │InfoPanel │  Vue 3 组件   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │             │             │                      │
│       └─────────────┼─────────────┘                      │
│                     │                                    │
│              Pinia Store 层                              │
│       (app / chat / config / mcp / scm / skills)        │
│                     │                                    │
│              electronAPI 服务层                           │
│                     │ IPC (contextBridge)                │
├─────────────────────┼────────────────────────────────────┤
│              Electron 主进程层                            │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │main.ts       │  │claudeCodeIPC  │  │terminalMgr   │ │
│  │(窗口/生命周期)│  │(进程池管理)    │  │(PTY 终端)    │ │
│  └──────────────┘  └───────┬───────┘  └──────────────┘ │
│                            │ 子进程通信                   │
├────────────────────────────┼────────────────────────────┤
│                    CLI 引擎层                             │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │QueryEngine   │  │Tool 系统      │  │Command 系统  │ │
│  │(查询编排)     │  │(45+ 工具)     │  │(60+ 命令)    │ │
│  └──────┬───────┘  └───────────────┘  └──────────────┘ │
│         │                                                │
│  ┌──────┴───────────────────────────────────────────┐   │
│  │              Services 服务层                       │   │
│  │  api/ │ mcp/ │ lsp/ │ voice/ │ compact/ │ tips/  │   │
│  └──────────────────────────────────────────────────┘   │
│         │                                                │
│  ┌──────┴───────────────────────────────────────────┐   │
│  │              Utils 工具函数层（200+ 文件）          │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**架构设计原则**：

- **Desktop ↔ Engine**：仅通过 IPC 通信，不直接 import 源码
- **Tools ↔ Services**：工具层依赖服务层抽象接口，便于替换实现
- **Components ↔ Stores**：组件通过 Pinia Store 访问状态，避免 prop drilling

---

## 3. 技术栈与依赖

### 3.1 CLI 引擎（engine/）

| 技术 | 版本 | 用途 |
|------|------|------|
| **Bun** | >= 1.2.0 | JavaScript 运行时、包管理器、构建工具 |
| **TypeScript** | 6.x | 类型安全、编译时检查 |
| **React** | 19.x | 终端 UI 渲染（配合 Ink） |
| **@anthropic/ink** | workspace:* | React 终端渲染库 |
| **Commander.js** | 14.x | CLI 参数解析 |
| **Biome** | 2.x | 代码格式化 + Lint |
| **@anthropic-ai/sdk** | 0.80.x | Anthropic API 客户端（流式） |
| **OpenAI SDK** | 6.x | OpenAI 兼容接口适配 |
| **MCP SDK** | 1.29.x | Model Context Protocol 实现 |
| **Zod** | 4.x | 数据模式验证 |
| **AWS SDK** | 3.x | Bedrock / Vertex 适配 |
| **OpenTelemetry** | 0.214.x | 可观测性（Trace/Metrics/Logs） |

### 3.2 Desktop 应用（根目录）

| 技术 | 版本 | 用途 |
|------|------|------|
| **Electron** | 29.x | 跨平台桌面应用框架 |
| **Vue 3** | 3.4.x | 前端框架（Composition API） |
| **Vite** | 5.x | 构建工具（极速热更新） |
| **TypeScript** | 5.x | 类型安全（strict 模式） |
| **Pinia** | 2.x | Vue 状态管理 |
| **SCSS** | 1.7.x | CSS 预处理器 |
| **xterm.js** | 6.x | 终端模拟器渲染 |
| **node-pty** | 1.x | 伪终端（PTY）管理 |
| **marked** | 12.x | Markdown 解析 |
| **highlight.js** | 11.x | 语法高亮 |
| **Lucide Icons** | 0.344.x | 图标库 |
| **vue-i18n** | 9.x | 国际化支持（中/英） |
| **electron-builder** | 24.x | 应用打包工具 |

---

## 4. 目录结构

```
SpaceCode/
├── electron/                          # Electron 主进程代码
│   ├── main.ts                        # 主进程入口（窗口管理、系统集成）
│   ├── preload.ts                     # Context Bridge（安全 API 暴露）
│   ├── claudeCodeIPC.ts              # CLI 引擎 IPC 通信封装
│   ├── claudeCodeProcessPool.ts      # 多会话进程池
│   ├── claudeCodeProcessManager.ts   # 单会话进程管理
│   ├── terminalManager.ts            # PTY 终端生命周期管理
│   ├── gitService.ts                 # Git 操作桥接服务
│   ├── skillsService.ts              # 技能系统主进程支持
│   ├── sessionProcess.ts             # 会话进程辅助
│   └── logger.ts                     # 主进程日志系统
│
├── engine/                            # CLI 核心引擎（Monorepo 子项目）
│   ├── src/                           # CLI 源代码
│   │   ├── main.tsx                   # CLI 入口（Commander + React/Ink REPL）
│   │   ├── QueryEngine.ts            # 查询编排引擎（核心 AI 对话循环）
│   │   ├── query.ts                  # 查询循环实现（Prompt 构建 + 响应处理）
│   │   ├── Tool.ts                   # 工具抽象接口定义
│   │   ├── tools.ts                  # 工具注册表（45+ 工具实例化与查找）
│   │   ├── commands.ts               # 命令注册表（60+ 斜杠命令路由分发）
│   │   ├── Task.ts                   # 任务模型（数据结构与状态机）
│   │   ├── context.ts               # 上下文管理（Git 状态、用户环境）
│   │   ├── setup.ts                 # 启动初始化流程
│   │   ├── cost-tracker.ts          # API 费用追踪
│   │   ├── history.ts               # 对话历史管理
│   │   │
│   │   ├── assistant/                # 助手逻辑层
│   │   ├── bootstrap/               # 启动引导模块（会话状态持久化）
│   │   ├── bridge/                  # 进程间通信桥接（JWT、Poll、REPL）
│   │   ├── buddy/                   # 伙伴系统（协作功能）
│   │   ├── cli/                     # CLI 命令行接口（handlers、utils）
│   │   ├── commands/                # 斜杠命令实现（60+）
│   │   ├── components/              # React/Ink UI 组件
│   │   ├── constants/               # 常量定义（API 限制、消息、工具名）
│   │   ├── context/                 # React Context（Mailbox、Stats、Voice）
│   │   ├── daemon/                  # 守护进程模式
│   │   ├── entrypoints/             # 入口点定义（CLI、Init、MCP）
│   │   ├── hooks/                   # React Hooks（Ink、Diff、Vim 等）
│   │   ├── jobs/                    # 后台任务（分类器）
│   │   ├── keybindings/             # 快捷键绑定系统
│   │   ├── memdir/                  # 内存目录系统（CLAUDE.md 管理）
│   │   ├── proactive/               # 主动建议系统
│   │   ├── query/                   # 查询引擎配置（Token 预算、状态转换）
│   │   ├── schemas/                 # 数据模式验证
│   │   ├── screens/                 # 屏幕组件（Doctor、REPL）
│   │   ├── server/                  # HTTP 服务端（锁文件、日志）
│   │   ├── services/                # 业务服务层
│   │   │   ├── api/                 # LLM API 客户端（Anthropic/OpenAI/Bedrock）
│   │   │   ├── mcp/                 # MCP 协议实现（stdio/SSE/HTTP/WS）
│   │   │   ├── lsp/                 # LSP 客户端（代码智能）
│   │   │   ├── compact/             # 上下文压缩服务
│   │   │   ├── analytics/           # 分析与 A/B 测试（GrowthBook）
│   │   │   ├── langfuse/            # Langfuse 可观测性
│   │   │   ├── policyLimits/        # 策略限制服务
│   │   │   ├── sessionMemory/       # 会话记忆服务
│   │   │   ├── skillSearch/         # 技能搜索服务
│   │   │   ├── toolUseSummary/      # 工具使用摘要生成
│   │   │   └── tips/                # 提示系统
│   │   ├── skills/                  # 内置技能
│   │   ├── state/                   # 状态管理（AppState、Store）
│   │   ├── tasks/                   # 任务管理
│   │   ├── tools/                   # 工具实现（45+）
│   │   ├── types/                   # TypeScript 类型定义
│   │   ├── utils/                   # 工具函数库（200+ 文件）
│   │   └── vim/                     # Vim 模式支持
│   │
│   ├── packages/                     # Workspace 共享包
│   ├── scripts/                      # 构建与维护脚本
│   ├── docs/                         # 技术文档
│   └── package.json                  # CLI 项目配置
│
├── src/                               # Desktop 渲染进程（Vue 3）
│   ├── main.ts                       # Vue 应用入口
│   ├── App.vue                       # 根组件（三栏布局）
│   ├── components/                   # Vue 组件库
│   │   ├── chat/                     # 聊天相关组件
│   │   ├── layout/                   # 布局骨架（Sidebar、ChatPanel、InfoPanel）
│   │   ├── mcp/                      # MCP 管理 UI
│   │   ├── scm/                      # 源码管理（Git）UI
│   │   └── skills/                   # 技能管理 UI
│   ├── composables/                  # Vue 组合式函数
│   ├── i18n/                         # 国际化（中/英）
│   ├── lib/                          # 业务逻辑库（命令常量、工具注册）
│   ├── services/                     # 客户端服务（electronAPI、LLM）
│   ├── stores/                       # Pinia 状态管理
│   ├── styles/                       # 全局样式（SCSS 变量、主题）
│   ├── types/                        # TypeScript 类型定义
│   └── utils/                        # 工具函数
│
├── tests/                             # Python 集成测试（pytest）
├── icons/                             # 应用图标资源
├── build/                             # 构建配置（NSIS 安装脚本）
├── scripts/                          # 辅助脚本（Bun 复制）
├── package.json                      # Desktop 项目配置
├── vite.config.ts                    # Vite 构建配置
└── tsconfig.json                     # TypeScript 编译选项
```

---

## 5. 核心模块详解

### 5.1 CLI 引擎（engine/）

#### 5.1.1 查询编排引擎 — QueryEngine

[QueryEngine.ts](engine/src/QueryEngine.ts) 是整个 CLI 的核心调度器，负责 AI 对话的完整生命周期：

```
用户输入 → QueryEngine 编排
         → query.ts 构建 Prompt
         → services/api/ 调用 LLM API（流式）
         → 收到 Tool Use 指令
         → tools/[ToolName]/ 执行工具
         → 返回结果给 QueryEngine
         → 再次调用 API（继续对话或结束）
         → components/ 渲染到终端
```

关键职责：

- 管理 AI 对话循环（API 调用 → 工具执行 → 结果反馈）
- 处理上下文压缩（Auto Compact）
- 跟踪 API 费用和 Token 用量
- 协调工具调用和权限控制
- 支持多轮对话和中断恢复

#### 5.1.2 工具系统 — Tool

[Tool.ts](engine/src/Tool.ts) 定义了工具的标准接口，所有 45+ 工具均遵循此契约：

```typescript
interface Tool {
  name: string                    // 工具唯一标识
  inputSchema: ToolInputJSONSchema // 参数 JSON Schema
  description(): string           // 工具描述（供 AI 理解）
  call(input, context): Promise<ToolResult>  // 执行工具逻辑
  isReadOnly?: boolean            // 是否只读
  isDestructive?: boolean         // 是否破坏性操作
  isConcurrencySafe?: boolean     // 是否并发安全
  isEnabled?: boolean             // 是否启用
}
```

[tools.ts](engine/src/tools.ts) 是工具注册表，负责：

- 实例化所有工具并建立查找映射
- 条件加载特性开关控制的工具（Proactive、Kairos 等）
- 提供 `getTools()` 函数供 QueryEngine 调用
- 管理工具的启用/禁用状态

主要工具分类：

| 类别 | 工具 | 说明 |
|------|------|------|
| **文件操作** | FileReadTool, FileEditTool, FileWriteTool, GlobTool, GrepTool | 读取、编辑、写入、搜索文件 |
| **Shell 执行** | BashTool | 执行系统命令 |
| **Web 能力** | WebFetchTool, WebSearchTool | 抓取网页、搜索引擎查询 |
| **IDE 集成** | LSPTool | Language Server Protocol 支持 |
| **扩展协议** | MCPTool, ListMcpResourcesTool, ReadMcpResourceTool | Model Context Protocol 代理 |
| **子代理** | AgentTool | 多代理协作任务分发 |
| **任务管理** | TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool, TaskStopTool, TaskOutputTool | 任务 CRUD 与输出 |
| **规划模式** | EnterPlanModeTool, ExitPlanModeV2Tool, EnterWorktreeTool, ExitWorktreeTool | 规划与工作树管理 |
| **用户交互** | AskUserQuestionTool, TodoWriteTool | 向用户提问、待办管理 |
| **技能系统** | SkillTool, ToolSearchTool | 技能调用与工具搜索 |
| **配置** | ConfigTool | 运行时配置修改 |
| **摘要** | BriefTool | 项目摘要生成 |
| **团队协作** | TeamCreateTool, TeamDeleteTool, SendMessageTool | 多人协作 |
| **定时任务** | CronCreateTool, CronDeleteTool, CronListTool | Cron 定时任务管理 |

#### 5.1.3 命令系统 — Commands

[commands.ts](engine/src/commands.ts) 管理所有斜杠命令的路由分发。用户在 REPL 中输入 `/command` 格式的指令时，由该模块匹配并执行对应处理函数。

常用命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/login` / `/logout` | 配置/注销 API 提供商 |
| `/config` | 编辑配置文件 |
| `/compact` | 压缩对话上下文 |
| `/diff` | 查看代码差异 |
| `/review` | 代码审查 |
| `/cost` | 显示用量成本 |
| `/doctor` | 运行诊断 |
| `/mcp` | 管理 MCP 服务器 |
| `/vim` | Vim 模式切换 |
| `/theme` | 主题切换 |
| `/commit` | Git 提交辅助 |
| `/init` | 项目初始化向导 |
| `/skills` | 技能管理 |
| `/resume` | 恢复历史会话 |

#### 5.1.4 服务层 — Services

底层能力抽象，为工具和命令提供基础设施：

| 目录/文件 | 功能 | 关键技术 |
|-----------|------|----------|
| `api/claude.ts` | Anthropic API 客户端 | 流式消息、Token 计数、Usage 追踪 |
| `api/client.ts` | 通用 API 客户端 | 多 Provider 适配 |
| `api/errors.ts` | API 错误分类 | 可重试错误识别 |
| `api/usage.ts` | 用量统计 | Token 消耗、费用计算 |
| `mcp/client.ts` | MCP 客户端 | stdio/SSE/HTTP/WS 传输 |
| `mcp/config.ts` | MCP 配置管理 | 服务器发现与连接 |
| `mcp/auth.ts` | MCP 认证 | OAuth / XAA 认证流程 |
| `lsp/config.ts` | LSP 客户端配置 | Language Server 管理 |
| `compact/` | 上下文压缩 | Auto Compact、Reactive Compact |
| `analytics/` | 分析与 A/B 测试 | GrowthBook 集成 |
| `sessionMemory/` | 会话记忆 | 跨会话知识持久化 |

#### 5.1.5 状态管理 — State

| 文件 | 功能 |
|------|------|
| `AppStateStore.ts` | 全局应用状态（Zustand 风格 Store） |
| `AppState.tsx` | React Context Provider，注入 AppState |
| `store.ts` | Store 工厂函数 |
| `selectors.ts` | 状态选择器 |

#### 5.1.6 上下文系统 — Context

[context.ts](engine/src/context.ts) 负责构建系统 Prompt 的上下文信息：

- **Git 状态**：当前分支、工作区状态、远程仓库信息
- **用户环境**：操作系统、Shell 类型、工作目录
- **CLAUDE.md**：项目级和用户级指令文件
- **内存目录**：memdir 系统，管理 AI 记忆文件

#### 5.1.7 工具函数库 — Utils（200+ 文件）

按功能分类的核心工具：

| 类别 | 文件 | 说明 |
|------|------|------|
| **Git 操作** | git.ts, gitDiff.ts, gitSettings.ts, ghPrStatus.ts | Git 命令封装 |
| **Shell 解析** | bash/parser.ts, bash/ast.ts, bash/commands.ts | Bash 语法分析 |
| **环境管理** | env.ts, envUtils.ts, envDynamic.ts | 环境变量与特性开关 |
| **文件操作** | file.ts, fileRead.ts, glob.ts, diff.ts | 文件读写与搜索 |
| **认证授权** | auth.ts, authPortable.ts, oauth.ts | API Key 与 OAuth |
| **模型管理** | model/model.ts, model/aliases.ts, model/configs.ts | 模型选择与配置 |
| **UI 渲染** | ansiToSvg.ts, ansiToPng.ts, format.ts, markdown.ts | 终端渲染辅助 |
| **安全** | crypto.ts, hash.ts, sanitization.ts | 加密与清理 |
| **进程** | process.ts, signal.ts, tree-kill | 进程管理 |
| **配置** | config.ts, cliArgs.ts, shellConfig.ts | 配置文件管理 |

---

### 5.2 Electron 主进程（electron/）

#### 5.2.1 主进程入口 — main.ts

[main.ts](electron/main.ts) 是 Electron 应用的入口，负责：

- 创建 BrowserWindow（三栏布局，1400×900 默认尺寸）
- 加载 .env 环境变量
- 注册 IPC Handler（文件系统、Shell、对话框等）
- 系统托盘（Tray）管理
- 应用菜单配置
- 平台适配（macOS hiddenInset 标题栏、Windows AppUserModelId）
- 安全配置（contextIsolation、nodeIntegration: false）

#### 5.2.2 Preload 安全桥 — preload.ts

[preload.ts](electron/preload.ts) 通过 `contextBridge.exposeInMainWorld` 安全暴露 API 给渲染进程，是 Electron 安全模型的核心：

暴露的 API 命名空间：

| 命名空间 | 功能 | 关键方法 |
|----------|------|----------|
| `electronAPI` (顶层) | 基础通信 | sendMessage, onMessage, getAppState |
| `electronAPI` (文件系统) | 文件操作 | readDir, readFile, writeFile, stat, searchFiles |
| `electronAPI` (终端) | PTY 管理 | terminal.create, write, resize, kill, runCommand |
| `electronAPI` (Git) | SCM 操作 | git.isRepo, getStatus, stage, commit, getDiff, getLog 等 |
| `electronAPI` (Claude Code) | 会话管理 | claudeCode.startSession, sendMessage, abort, stop 等 |
| `electronAPI` (技能) | 技能管理 | skills.getSkills, createSkill, searchMarketplace 等 |
| `electronAPI` (设置) | 配置持久化 | saveGuiSettings, loadGuiSettings, injectGuiModelsToSettings |
| `electronAPI` (对话框) | 系统对话框 | selectFolder, selectFiles |
| `electronAPI` (HTTP) | 网络代理 | httpFetch（绕过 CORS） |
| `electronAPI.logger` | 日志桥接 | debug, info, warn, error（转发到主进程） |

#### 5.2.3 Claude Code IPC — claudeCodeIPC.ts

[claudeCodeIPC.ts](electron/claudeCodeIPC.ts) 封装了与 CLI 引擎的 IPC 通信：

- **进程池管理**：`ClaudeCodeProcessPool` 管理多个 CLI 子进程
- **会话生命周期**：startSession / sendMessage / abort / stop / suspend / resume
- **事件流**：assistant / user / tool_use / tool_result / result / stream_event / log / exit
- **内置 Agent**：general-purpose、Explore、Plan、verification

#### 5.2.4 终端管理器 — terminalManager.ts

[terminalManager.ts](electron/terminalManager.ts) 基于 node-pty 实现集成终端：

- 创建 PTY 进程（支持自定义 Shell 和环境变量）
- 转发终端输出到渲染进程（IPC `terminal:data`）
- 支持终端 resize 和 kill 操作
- 自动检测平台默认 Shell（PowerShell / bash / zsh）

---

### 5.3 Vue 3 渲染进程（src/）

#### 5.3.1 应用入口 — main.ts

[main.ts](src/main.ts) 初始化 Vue 应用：

```typescript
const app = createApp(App)
app.use(createPinia())     // 状态管理
app.use(i18n)              // 国际化
app.mount('#app')
```

#### 5.3.2 根组件 — App.vue

[App.vue](src/App.vue) 实现三栏布局：

- **TitleBar**：自定义标题栏（macOS hiddenInset / Windows 原生）
- **Sidebar**：左侧边栏（会话列表、项目导航）
- **ChatPanel**：中间聊天面板（消息列表 + 输入框）
- **InfoPanel**：右侧信息面板（Diff / 文件预览 / Markdown）
- 可拖拽调整面板大小（resize handle）

#### 5.3.3 状态管理 — Pinia Stores

| Store | 文件 | 职责 | 关键 State |
|-------|------|------|------------|
| `app` | [stores/app.ts](src/stores/app.ts) | 应用级状态 | theme, sidebarCollapsed, infoPanelVisible, projectRoot, centerTabs |
| `chat` | [stores/chat.ts](src/stores/chat.ts) | 聊天状态 | sessions, messages, currentSessionId, processStatus |
| `config` | [stores/config.ts](src/stores/config.ts) | 配置管理 | API 设置、模型选择 |
| `settings` | [stores/settings.ts](src/stores/settings.ts) | 用户偏好 | 快捷键、外观、Provider 配置 |
| `mcp` | [stores/mcp.ts](src/stores/mcp.ts) | MCP 状态 | 服务器列表、连接状态 |
| `scm` | [stores/scm.ts](src/stores/scm.ts) | Git 状态 | 分支、变更、提交历史 |
| `skills` | [stores/skills.ts](src/stores/skills.ts) | 技能状态 | 已安装技能、技能配置 |
| `terminal` | [stores/terminal.ts](src/stores/terminal.ts) | 终端状态 | 终端实例、活动终端 |

#### 5.3.4 服务层

| 文件 | 功能 |
|------|------|
| [services/electronAPI.ts](src/services/electronAPI.ts) | Electron IPC API 的渲染进程封装，提供类型安全的调用接口 |
| [services/llm.ts](src/services/llm.ts) | 轻量 LLM 服务封装，用于非 Agent 功能（如 commit message 生成） |

#### 5.3.5 类型系统 — types/index.ts

[src/types/index.ts](src/types/index.ts) 定义了渲染进程的核心数据类型：

| 类型 | 说明 |
|------|------|
| `Message` | 聊天消息（含 reasoning、toolCalls、toolResults） |
| `ToolCall` | 工具调用（含状态机：pending → running → completed/error） |
| `ToolResult` | 工具执行结果 |
| `Session` | 会话（含 processStatus 状态机） |
| `ProcessStatus` | 进程状态：none / starting / active / idle / suspended / exited |
| `FileNode` | 文件树节点 |
| `DiffInfo` / `DiffHunk` / `DiffLine` | 代码差异信息 |
| `SlashCommand` | 斜杠命令定义 |

#### 5.3.6 国际化 — i18n/

支持中文（zh-CN）和英文（en-US）两种语言，通过 vue-i18n 实现。

#### 5.3.7 样式系统 — styles/

采用 SCSS + CSS Variables 实现主题切换：

- `_variables.scss`：CSS 自定义属性（Light / Dark 双主题）
- `_mixins.scss`：常用 SCSS 混入
- `_fonts.scss`：字体定义
- `global.scss`：全局样式

---

### 5.4 Workspace 原生包（engine/packages/）

共享的 NPM 工作区包，供 CLI 引擎内部使用：

| 包名 | 功能 | 技术 |
|------|------|------|
| `@ant/claude-for-chrome-mcp` | Chrome 浏览器控制 MCP | Puppeteer |
| `@ant/computer-use-input` | 计算机输入模拟 | NAPI (Rust) |
| `@ant/computer-use-mcp` | 计算机使用 MCP | 截图 + OCR |
| `@ant/computer-use-swift` | macOS 原生交互 | Swift bridge |
| `@ant/ink` | Ink 终端渲染扩展 | React 19 |
| `audio-capture-napi` | 音频采集 | NAPI (Rust) |
| `color-diff-napi` | 语法高亮 Diff | NAPI (Rust) |
| `image-processor-napi` | 图片处理（缩放、格式转换） | NAPI (Rust) |
| `modifiers-napi` | 键盘修饰符检测 | NAPI (Rust) |
| `remote-control-server` | 远程控制服务端 | WebSocket + HTTP |
| `url-handler-napi` | URL 协议处理 | NAPI (Rust) |

**NAPI (Native API)**：使用 Rust 编写的高性能原生模块，通过 Node.js/Bun 的 N-API 接口调用，用于性能敏感场景（图片处理、Diff 计算、音频采集等）。

---

## 6. 关键类与函数说明

### 6.1 CLI 引擎核心

#### QueryEngine

| 方法/属性 | 说明 |
|-----------|------|
| `query()` | 核心查询循环，构建 Prompt → 调用 API → 处理工具调用 → 迭代 |
| `accumulateUsage()` | 累计 API Usage（Token 消耗） |
| `loadMemoryPrompt()` | 加载内存目录中的 Prompt |
| `fetchSystemPromptParts()` | 获取系统 Prompt 组成部分 |
| `getMainLoopModel()` | 获取当前对话使用的主模型 |

#### Tool 接口

| 方法/属性 | 说明 |
|-----------|------|
| `name` | 工具唯一标识符 |
| `inputSchema` | 参数 JSON Schema（供 AI 理解输入格式） |
| `description()` | 工具描述文本 |
| `call(input, context)` | 执行工具逻辑，返回 ToolResult |
| `isReadOnly` | 标记是否为只读操作 |
| `isDestructive` | 标记是否为破坏性操作 |
| `isConcurrencySafe` | 标记是否可并发执行 |
| `toolMatchesName()` | 工具名称匹配工具函数 |

#### Task 模型

| 类型/方法 | 说明 |
|-----------|------|
| `TaskType` | 任务类型：local_bash / local_agent / remote_agent / in_process_teammate / local_workflow / monitor_mcp / dream |
| `TaskStatus` | 任务状态：pending / running / completed / failed / killed |
| `isTerminalTaskStatus()` | 判断任务是否处于终态 |
| `TaskStateBase` | 任务基础状态（id, type, status, description, startTime, endTime） |
| `Task.name` | 任务名称 |
| `Task.kill()` | 终止任务 |

#### setup()

| 参数 | 说明 |
|------|------|
| `cwd` | 工作目录 |
| `permissionMode` | 权限模式 |
| `allowDangerouslySkipPermissions` | 是否允许跳过权限检查 |
| `worktreeEnabled` | 是否启用工作树 |

初始化流程：设置工作目录 → 检测 Git 仓库 → 加载配置 → 初始化会话记忆 → 注册 Hooks → 启动文件变更监听。

---

### 6.2 Electron 主进程核心

#### TerminalManager

| 方法 | 说明 |
|------|------|
| `create(cwd?, command?, env?)` | 创建 PTY 终端实例，返回终端 ID |
| `write(id, data)` | 向终端写入数据 |
| `resize(id, cols, rows)` | 调整终端尺寸 |
| `kill(id)` | 终止终端进程 |
| `runCommand(id, command)` | 在终端中执行命令 |
| `getDefaultShell()` | 获取平台默认 Shell |

#### ClaudeCodeProcessPool

| 方法 | 说明 |
|------|------|
| `startSession(sessionId, config)` | 启动新的 CLI 会话进程 |
| `sendMessage(sessionId, content)` | 向指定会话发送消息 |
| `abortSession(sessionId)` | 中止指定会话 |
| `killSession(sessionId)` | 终止指定会话进程 |
| `suspendSession(sessionId)` | 挂起指定会话 |
| `resumeSession(sessionId)` | 恢复指定会话 |
| `getSessionStatus(sessionId)` | 获取会话状态 |
| `getActiveSessions()` | 获取所有活跃会话 |

---

### 6.3 Vue 3 前端核心

#### useAppStore

| State / Action | 说明 |
|----------------|------|
| `theme` | 当前主题（light / dark） |
| `sidebarCollapsed` | 侧边栏是否折叠 |
| `infoPanelVisible` | 信息面板是否可见 |
| `infoPanelMode` | 信息面板模式（diff / file / markdown / tool-diff） |
| `projectRoot` | 当前项目根目录 |
| `centerTabs` | 中间面板 Tab 列表 |
| `activeCenterTab` | 当前活跃 Tab |
| `toggleTheme()` | 切换主题 |
| `toggleSidebar()` | 切换侧边栏 |
| `openTerminalTab()` | 打开终端 Tab |
| `closeCenterTab(id)` | 关闭指定 Tab |

#### useChatStore

| State / Action | 说明 |
|----------------|------|
| `sessions` | 会话列表 |
| `currentSessionId` | 当前活跃会话 ID |
| `messages` | 当前会话消息列表 |
| `createSession(title?)` | 创建新会话 |
| `deleteSession(id)` | 删除会话 |
| `switchProject(root)` | 切换项目 |
| `addProject(root)` | 添加项目 |

#### api（electronAPI 封装）

| 方法 | 说明 |
|------|------|
| `sendMessage(text)` | 发送聊天消息 |
| `readDir(path)` | 读取目录内容 |
| `readFile(path)` | 读取文件内容 |
| `writeFile(path, content)` | 写入文件 |
| `searchFiles(dir, query)` | 搜索文件 |
| `httpFetch(url, options)` | HTTP 请求（绕过 CORS） |
| `claudeCode.startSession(id, config)` | 启动 Claude Code 会话 |
| `claudeCode.sendMessage(id, content)` | 发送会话消息 |
| `git.getStatus(cwd)` | 获取 Git 状态 |

---

## 7. 数据流与通信机制

### 7.1 CLI 请求处理流程

```
用户输入
  ↓
main.tsx (Commander 解析命令行参数)
  ↓
launchRepl() (启动交互式 REPL)
  ↓
QueryEngine (编排 AI 对话循环)
  ↓
query.ts (构建 Prompt：系统上下文 + 对话历史 + 工具定义)
  ↓
services/api/claude.ts (调用 LLM API，流式接收)
  ↓
收到 Tool Use 指令 → Tool.call() (执行工具)
  ↓
返回 Tool Result → 再次调用 API (继续对话)
  ↓
components/ (React/Ink 渲染到终端)
```

### 7.2 Desktop 请求处理流程

```
用户输入 → ChatInput.vue
  ↓
chat.ts (Pinia Store 更新状态)
  ↓
electronAPI.claudeCode.sendMessage() (IPC 调用)
  ↓
preload.ts → ipcRenderer.invoke()
  ↓
claudeCodeIPC.ts → ipcMain.handle()
  ↓
ClaudeCodeProcessPool.sendMessage() (转发到子进程)
  ↓
engine/QueryEngine.ts (同 CLI 流程)
  ↓
结果通过 IPC 事件流返回：
  claude-code:assistant     → 助手消息
  claude-code:tool_use      → 工具调用
  claude-code:tool_result   → 工具结果
  claude-code:result        → 最终结果
  claude-code:stream_event  → 流式事件
  ↓
chat.ts (更新消息列表)
  ↓
MessageList.vue (重新渲染)
```

### 7.3 IPC 通信协议

Desktop 应用中，渲染进程与主进程通过以下 IPC 通道通信：

| 通道模式 | 方向 | 示例 |
|----------|------|------|
| `invoke/handle` | 渲染→主（请求-响应） | `cli:sendMessage`, `fs:readFile`, `git:getStatus` |
| `send/on` | 渲染→主（单向通知） | `terminal:write`, `terminal:resize`, `ui:showInfoPanel` |
| `on` | 主→渲染（事件推送） | `cli:message`, `terminal:data`, `claude-code:assistant` |

---

## 8. 模块依赖关系

### 8.1 强依赖关系

```
Desktop (src/) ──→ Electron (electron/) ──→ Engine (engine/)
   Vue 3 UI            IPC Bridge              Core Logic
                                              React/Ink UI
```

- Desktop 的 Vue 组件依赖 Pinia Store
- Pinia Store 依赖 electronAPI 服务
- electronAPI 通过 IPC 与 Electron 主进程通信
- Electron 主进程通过子进程调用 CLI 引擎

### 8.2 引擎内部依赖

```
QueryEngine ──→ query.ts ──→ services/api/
     │              │              │
     ├──→ tools.ts ──┘              │
     │         │                    │
     │    Tool.call()               │
     │         │                    │
     ├──→ commands.ts               │
     │         │                    │
     │    Command.handler()         │
     │                              │
     ├──→ context.ts ──→ utils/claudemd.ts
     │                              │
     ├──→ state/AppState ──→ state/store.ts
     │                              │
     └──→ services/mcp/ ──→ @modelcontextprotocol/sdk
                                    │
                    services/lsp/ ──→ vscode-languageserver-protocol
```

### 8.3 共享代码策略

Desktop 复用 Engine 的以下部分：

- Markdown 配置（marked + highlight.js 选项）
- Diff 算法（diff 库的使用方式）
- TypeScript 类型定义（消息、工具、命令类型）
- 常量定义（错误码、限制值、提示文本）

**不共享的部分**：

- React/Ink 组件（终端专用，Desktop 使用 Vue 组件）
- Bash AST 解析器（Engine 内部细节）
- MCP 底层传输实现（Desktop 通过 IPC 间接使用）

---

## 9. 项目运行方式

### 9.1 环境要求

| 环境 | 最低版本 | 推荐版本 | 用途 |
|------|----------|----------|------|
| **Bun** | >= 1.2.0 | >= 1.3.11 | CLI 运行时 |
| **Node.js** | >= 18 | >= 20 | Desktop 构建 |
| **npm** | >= 9 | 最新版 | 包管理器 |
| **Git** | >= 2.x | 最新版 | 版本控制 |

### 9.2 依赖安装

```bash
# 克隆项目
git clone https://github.com/hjdspace/SpaceCode.git
cd SpaceCode

# 安装 Desktop 项目依赖（根目录）
npm install

# 安装 CLI 引擎依赖（engine 目录，自动触发 postinstall）
cd engine && bun install && cd ..
```

### 9.3 开发模式启动

#### CLI 开发模式

```bash
cd engine

# 启动开发服务器（热重载）
bun run dev

# 或启用调试模式（Inspector）
bun run dev:inspect
```

#### Desktop 开发模式

```bash
# 启动 Electron + Vite 开发服务器
npm run electron:dev
```

此命令同时启动：

- Vite 前端开发服务器（端口 5173，热更新）
- Electron 主进程（自动重载）
- IPC 通信桥接层

### 9.4 配置 LLM 提供商

**CLI 方式**：在终端中执行 `/login`

**Desktop 方式**：在设置面板中填写：

| 配置项 | 说明 | 示例值 |
|--------|------|--------|
| Base URL | API 服务端点 | `https://api.anthropic.com/v1` |
| API Key | 认证密钥 | `sk-ant-xxxxx` |
| 快速模型 | 轻量级模型 ID | `claude-haiku-4-5-20251001` |
| 均衡模型 | 平衡型模型 ID | `claude-sonnet-4-6` |
| 高性能模型 | 旗舰模型 ID | `claude-opus-4-6` |

---

## 10. 构建与发布

### 10.1 构建 CLI

```bash
cd engine
bun run build    # 生成 dist/ 目录
```

### 10.2 构建 Desktop 应用

```bash
# 类型检查 + Vite 构建
npm run build

# 打包 Electron 应用
npm run electron:build          # 通用
npm run electron:build:win      # Windows
npm run electron:build:mac      # macOS
npm run electron:build:linux    # Linux
```

构建流程：

1. `copy-bun`：复制 Bun 运行时到项目
2. `engine:build:desktop`：构建 CLI 引擎的桌面版
3. `vue-tsc --noEmit`：TypeScript 类型检查
4. `vite build`：构建 Vue 前端
5. `electron-builder`：打包 Electron 应用

### 10.3 打包输出

| 平台 | 输出格式 | 输出路径 |
|------|----------|----------|
| **Windows** | NSIS 安装包 + Portable 便携版 | `release/SpaceCode Setup x.x.x.exe` |
| **macOS** | DMG + ZIP | `release/SpaceCode-x.x.x.dmg` |
| **Linux** | AppImage + DEB | `release/SpaceCode-x.x.x.AppImage` |

### 10.4 常用脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | TypeScript 类型检查 + Vite 构建 |
| `npm run typecheck` | 仅类型检查 |
| `npm run electron:dev` | 启动 Electron 开发模式 |
| `npm run electron:build` | 打包 Electron 应用 |
| `npm run changelog` | 生成更新日志 |

Engine 专用脚本：

| 脚本 | 说明 |
|------|------|
| `bun run dev` | 启动 CLI 开发服务器 |
| `bun run build` | 构建 CLI |
| `bun run test` | 运行测试 |
| `bun run lint` | Biome Lint 检查 |
| `bun run lint:fix` | Biome Lint 自动修复 |
| `bun run format` | Biome 格式化 |
| `bun run health` | 环境健康检查 |

---

## 11. 扩展开发指南

### 添加新工具（Engine）

1. 在 `engine/src/tools/` 创建新目录，如 `MyTool/`
2. 实现 `Tool` 接口的必要方法（name, inputSchema, description, call）
3. 在 `engine/src/tools.ts` 中注册工具（import + 添加到工具列表）
4. 编写单元测试 `engine/src/__tests__/`
5. 添加 React/Ink UI 组件（如需终端渲染）`tools/MyTool/UI.tsx`

### 添加新命令（Engine）

1. 在 `engine/src/commands/` 创建新文件或目录
2. 实现 Command 接口（name, description, handler）
3. 在 `engine/src/commands.ts` 中注册命令路由
4. 添加帮助文本

### 添加新组件（Desktop）

1. 在 `src/components/` 相应子目录创建 `.vue` 文件
2. 使用 `<script setup lang="ts">` + Composition API
3. 通过 Pinia Store 管理状态
4. 遵循 SCSS Variables 主题规范（使用 `var(--bg-primary)` 等 CSS 变量）

### 添加新 IPC 通道

1. 在 `electron/preload.ts` 中通过 `contextBridge` 暴露新 API
2. 在对应的 Electron 服务文件中注册 `ipcMain.handle()` 或 `ipcMain.on()`
3. 在 `src/services/electronAPI.ts` 中添加类型安全的封装

### 添加新 Pinia Store

1. 在 `src/stores/` 创建新文件
2. 使用 `defineStore()` 定义 Store
3. 在组件中通过 `useXxxStore()` 使用
