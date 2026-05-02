# 项目结构说明

> 本文档详细描述 SpaceCode 项目的目录结构、各模块职责划分及主要入口文件，帮助开发者快速理解代码组织方式。

## 目录结构总览（tree -L 2）

```
claude-code-gui/
├── electron/                          # Electron 主进程代码
│   ├── claudeCodeIPC.ts               # Claude Code IPC 通信封装
│   ├── gitService.ts                  # Git 操作服务
│   ├── main.ts                        # 主进程入口文件
│   ├── preload.ts                     # Context Bridge (安全 API 暴露)
│   ├── skillsService.ts               # 技能管理服务
│   └── terminalManager.ts             # 终端会话管理器
│
├── engine/                            # CLI 核心引擎（Monorepo 子项目）
│   ├── src/                           # CLI 源代码
│   │   ├── __tests__/                 # 单元测试
│   │   ├── assistant/                 # 助手逻辑层
│   │   ├── bootstrap/                 # 启动引导模块
│   │   ├── bridge/                    # 进程间通信桥接
│   │   ├── buddy/                     # 伙伴系统（协作功能）
│   │   ├── cli/                       # CLI 命令行接口
│   │   ├── commands/                  # 斜杠命令实现（60+）
│   │   ├── components/                # React/Ink UI 组件
│   │   ├── constants/                 # 常量定义
│   │   ├── context/                   # 上下文管理
│   │   ├── daemon/                    # 守护进程
│   │   ├── entrypoints/               # 入口点定义
│   │   ├── hooks/                     # React Hooks
│   │   ├── jobs/                      # 后台任务
│   │   ├── keybindings/               # 快捷键绑定
│   │   ├── memdir/                    # 内存目录系统
│   │   ├── proactive/                 # 主动建议系统
│   │   ├── query/                     # 查询引擎配置
│   │   ├── schemas/                   # 数据模式验证
│   │   ├── screens/                   # 屏幕组件
│   │   ├── server/                    # HTTP 服务端
│   │   ├── services/                  # 业务服务层
│   │   ├── skills/                    # 内置技能
│   │   ├── state/                     # 状态管理
│   │   ├── tasks/                     # 任务管理
│   │   ├── tools/                     # 工具实现（45+）
│   │   ├── types/                     # TypeScript 类型定义
│   │   ├── utils/                     # 工具函数库（200+ 文件）
│   │   └── *.ts,*.tsx                 # 核心模块文件
│   ├── tests/                         # 集成测试 + Mock 数据
│   ├── packages/                      # Workspace 共享包
│   ├── scripts/                       # 构建与维护脚本
│   ├── docs/                          # 详细技术文档
│   └── package.json                   # CLI 项目配置
│
├── src/                               # Desktop 渲染进程（Vue 3）
│   ├── __tests__/                     # 单元测试
│   ├── assets/                        # 静态资源（字体等）
│   ├── components/                    # Vue 组件库
│   │   ├── chat/                      # 聊天相关组件
│   │   ├── common/                    # 通用组件
│   │   ├── explorer/                  # 文件浏览器
│   │   ├── layout/                    # 布局组件
│   │   ├── mcp/                       # MCP 相关组件
│   │   ├── scm/                       # 源码管理（Git）
│   │   ├── settings/                  # 设置面板
│   │   ├── skills/                    # 技能组件
│   │   └── terminal/                  # 终端组件
│   ├── composables/                   # Vue 组合式函数
│   ├── lib/                           # 业务逻辑库
│   ├── services/                      # 客户端服务
│   ├── stores/                        # Pinia 状态管理
│   ├── styles/                        # 全局样式
│   ├── types/                         # TypeScript 类型
│   ├── utils/                         # 工具函数
│   ├── App.vue                        # 根组件
│   └── main.ts                        # Vue 应用入口
│
├── tests/                             # Python 集成测试（pytest）
├── icons/                             # 应用图标资源
├── CHANGELOG.md                       # 版本更新日志
├── README.md                          # 项目说明文档
├── SCRIPTS.md                         # 脚本命令参考指南
├── package.json                       # Desktop 项目配置
└── .env                               # 环境变量配置
```

---

## 核心模块详解

### 1. Electron 主进程（`electron/`）

**职责**：管理桌面应用的生命周期、窗口创建、系统集成和 IPC 通信。

| 文件 | 功能 | 关键 API |
|------|------|----------|
| [main.ts](electron/main.ts) | 主进程入口，初始化 BrowserWindow | `app.whenReady()`, `BrowserWindow` |
| [preload.ts](electron/preload.ts) | Context Bridge 安全暴露 API | `contextBridge.exposeInMainWorld()` |
| [terminalManager.ts](electron/terminalManager.ts) | PTY 终端生命周期管理 | `node-pty.spawn()`, `xterm.js` |
| [claudeCodeIPC.ts](electron/claudeCodeIPC.ts) | 与 CLI 引擎的 IPC 通信封装 | `ipcMain.handle()`, `ipcRenderer.invoke()` |
| [gitService.ts](electron/gitService.ts) | Git 操作的桥接服务 | `simple-git` 封装 |
| [skillsService.ts](electron/skillsService.ts) | 技能系统的主进程支持 | 技能加载与注册 |

**架构特点**：
- 遵循 **Electron 安全最佳实践**：通过 preload 隔离渲染进程权限
- 使用 **TypeScript strict 模式**确保类型安全
- 集成 **Claude Code 引擎**作为后端计算核心

---

### 2. CLI 引擎（`engine/src/`）

**职责**：实现 AI 编程助手的核心业务逻辑，包括工具执行、命令解析、API 交互等。

#### 2.1 核心入口文件

| 文件 | 功能 | 说明 |
|------|------|------|
| [main.tsx](engine/src/main.tsx) | CLI 入口点 | 初始化 Commander 解析器，启动 REPL 循环 |
| [QueryEngine.ts](engine/src/QueryEngine.ts) | 查询编排引擎 | 核心 AI 对话循环（API 调用 → 工具执行 → 结果反馈） |
| [query.ts](engine/src/query.ts) | 查询循环实现 | 具体的 prompt 构建与响应处理逻辑 |
| [Tool.ts](engine/src/Tool.ts) | 工具抽象接口 | 定义工具的标准接口与默认行为 |
| [tools.ts](engine/src/tools.ts) | 工具注册表 | 管理 45+ 工具的实例化与查找 |
| [commands.ts](engine/src/commands.ts) | 命令注册表 | 管理 60+ 斜杠命令的路由分发 |
| [Task.ts](engine/src/Task.ts) | 任务模型 | 定义任务的数据结构与状态机 |

#### 2.2 工具层（`tools/`）

包含所有可被 AI 调用的操作能力：

```
tools/
├── AgentTool/          # 子代理生成（多 Agent 协作）
├── BashTool/           # Shell 命令执行（Bash）
├── BriefTool/          # 项目摘要生成
├── GlobTool/           # 文件名模糊匹配
├── GrepTool/           # 内容搜索（ripgrep）
├── LSPTool/            # Language Server Protocol 集成
├── MCPTool/            # Model Context Protocol 代理
├── SkillTool/          # 自定义技能调用
├── FileEditTool/       # 文件编辑（Search & Replace）
├── FileReadTool/       # 文件读取
├── WebFetchTool/       # URL 内容抓取
├── WebSearchTool/      # 搜索引擎查询
└── ... (30+ more)
```

**关键特性**：
- 每个工具遵循统一接口：`inputSchema`, `call()`, `description()`
- 支持权限控制：`isReadOnly`, `isDestructive`, `isEnabled`
- 并发安全标记：`isConcurrencySafe`

#### 2.3 命令层（`commands/`）

用户通过斜杠前缀触发的操作：

```
commands/
├── advisor.ts          # 智能建议
├── commit.ts           # Git 提交辅助
├── cost.ts             # 用量费用统计
├── diff.ts             # 代码差异查看
├── fast.ts             # 快速模式切换
├── help.ts             # 帮助信息展示
├── init.ts             # 项目初始化向导
├── install.ts          # 依赖安装
├── mcp/                # MCP 服务器管理
├── plan.ts             # 任务规划
├── review.ts           # 代码审查
├── send.ts             # 消息发送
├── tag.ts              # 标签管理
├── vim.ts              # Vim 模式切换
└── ... (40+ more)
```

#### 2.4 服务层（`services/`）

底层能力抽象：

| 目录 | 功能 | 说明 |
|------|------|------|
| `api/` | LLM API 客户端 | Anthropic/OpenAI/Gemini/Grok 适配器 |
| `mcp/` | MCP 协议实现 | stdio/SSE/HTTP/WebSocket 传输 |
| `lsp/` | LSP 客户端 | 代码智能补全、跳转定义 |
| `tips/` | 提示系统 | 用户引导与使用技巧 |
| `notifier.ts` | 系统通知 | OS 原生通知集成 |
| `vcr.ts` | 录制回放 | 会话录制与重放 |
| `voice.ts` | 语音服务 | 音频采集与识别 |

#### 2.5 工具函数库（`utils/`）

200+ 个实用函数，按功能分类：

| 类别 | 示例 | 数量 |
|------|------|------|
| **Git 操作** | git.ts, gitDiff.ts, gitSettings.ts | 15+ |
| **Shell 解析** | bash/parser.ts, bash/ast.ts, bash/commands.ts | 10+ |
| **环境管理** | env.ts, envUtils.ts, envValidation.ts | 8+ |
| **文件操作** | file.ts, fileRead.ts, glob.ts | 12+ |
| **认证授权** | auth.ts, authPortable.ts, oauth.ts | 6+ |
| **网络请求** | http.ts, api.ts, apiPreconnect.ts | 5+ |
| **UI 渲染** | ansiToSvg.ts, ansiToPng.ts, format.ts | 10+ |
| **其他** | crypto.ts, hash.ts, diff.ts, cachePaths.ts | 120+ |

---

### 3. Desktop 渲染进程（`src/`）

**职责**：实现桌面应用的图形用户界面，基于 Vue 3 Composition API。

#### 3.1 核心入口

| 文件 | 功能 |
|------|------|
| [main.ts](src/main.ts) | Vue 应用初始化，挂载根组件 |
| [App.vue](src/App.vue) | 三栏布局容器（Sidebar + ChatPanel + InfoPanel） |

#### 3.2 组件架构

```
components/
├── layout/             # 布局骨架
│   ├── Sidebar.vue     # 左侧边栏（会话列表）
│   ├── ChatPanel.vue   # 中间聊天面板
│   ├── InfoPanel.vue   # 右侧信息面板
│   └── TitleBar.vue    # 自定义标题栏
│
├── chat/               # 聊天功能
│   ├── MessageList.vue # 消息列表
│   ├── MessageItem.vue # 单条消息
│   ├── InputBox.vue    # 输入框（支持 Markdown）
│   └── MarkdownView.vue # 富文本渲染
│
├── explorer/           # 文件浏览器
│   ├── FileTree.vue    # 树状目录
│   └── FileItem.vue    # 文件节点
│
├── terminal/           # 集成终端
│   ├── TerminalTab.vue # 终端标签页
│   └── TerminalPane.vue # xterm.js 封装
│
├── common/             # 通用组件
│   ├── DiffViewer.vue  # 代码对比视图
│   ├── CodeViewer.vue  # 代码高亮显示
│   └── SettingsModal.vue # 设置弹窗
│
├── settings/           # 设置面板
│   ├── ProviderConfig.vue # LLM 配置
│   └── ThemeSelector.vue # 主题切换
│
├── mcp/                # MCP 服务器管理 UI
├── scm/                # Git 源码管理 UI
└── skills/             # 技能市场/管理 UI
```

#### 3.3 状态管理（`stores/`）

使用 Pinia 实现响应式全局状态：

| Store | 职责 | 关键 State |
|-------|------|------------|
| `app.ts` | 应用级状态 | 主题、面板尺寸、窗口状态 |
| `chat.ts` | 聊天状态 | 消息列表、当前会话、输入内容 |
| `config.ts` | 配置管理 | API 设置、模型选择 |
| `mcp.ts` | MCP 状态 | 服务器列表、连接状态 |
| `scm.ts` | Git 状态 | 分支、变更、提交历史 |
| `settings.ts` | 用户偏好 | 快捷键、外观设置 |
| `skills.ts` | 技能状态 | 已安装技能、技能配置 |

#### 3.4 组合式函数（`composables/`）

Vue 3 的逻辑复用机制：

| 函数 | 功能 | 依赖 |
|------|------|------|
| `useChatCommands.ts` | 聊天命令处理 | chat store |
| `useShortcuts.ts` | 全局快捷键绑定 | 键盘事件 |
| `useTaskManager.ts` | 后台任务管理 | Task API |

#### 3.5 样式系统（`styles/`）

采用 SCSS + CSS Variables 实现主题切换：

```scss
// _variables.scss
:root {
  --bg-primary: #ffffff;
  --text-primary: #1f2937;
  // ... Light theme variables
}

[data-theme="dark"] {
  --bg-primary: #1e1e1e;
  --text-primary: #d4d4d4;
  // ... Dark theme variables
}
```

---

### 4. 测试目录（`tests/` & `__tests__/`）

详见 [TESTS.md](./TESTS.md) 测试说明文档。

---

### 5. Workspace 包（`engine/packages/`）

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

**NAPI (Native API)**：使用 Rust 编写的高性能原生模块，通过 Node.js/Bun 的 N-API 接口调用，用于性能敏感场景。

---

### 6. 构建与维护脚本（`engine/scripts/`）

| 脚本 | 功能 | 触发时机 |
|------|------|----------|
| `dev.ts` | 开发服务器启动 | `bun run dev` |
| `dev-debug.ts` | Inspector 调试模式 | `bun run dev:inspect` |
| `build.ts` | 生产构建流程 | `bun run build` |
| `health-check.ts` | 环境健康检查 | `bun run health` |
| `postinstall.cjs` | 安装后处理（下载 ripgrep） | npm/bun install 后 |
| `rcs.ts` | 发布候选版本检查 | `bun run rcs` |
| `verify-gates.ts` | CI 门禁验证 | GitHub Actions |
| `defines.ts` | 构建常量定义 | 被 build.ts 引用 |
| `download-ripgrep.ts` | 下载 ripgrep 二进制 | postinstall 时调用 |

---

## 数据流架构

### 请求处理流程（CLI）

```
用户输入 → main.tsx (Commander 解析)
         ↓
    QueryEngine.ts (编排)
         ↓
    query.ts (构建 Prompt)
         ↓
    services/api/ (调用 LLM API)
         ↓
    收到 Tool Use 指令
         ↓
    tools/[ToolName]/ (执行工具)
         ↓
    返回结果给 QueryEngine
         ↓
    再次调用 API (继续对话或结束)
         ↓
    components/ (渲染到终端)
```

### 请求处理流程（Desktop）

```
用户输入 → src/components/chat/InputBox.vue
         ↓
    src/stores/chat.ts (更新状态)
         ↓
    src/services/electronAPI.ts (IPC 调用)
         ↓
    electron/claudeCodeIPC.ts (接收并转发)
         ↓
    engine/QueryEngine.ts (同 CLI 流程)
         ↓
    结果返回 → electron/main.ts (IPC 回调)
         ↓
    src/services/electronAPI.ts (接收结果)
         ↓
    src/stores/chat.ts (更新消息列表)
         ↓
    src/components/chat/MessageList.vue (重新渲染)
```

---

## 模块边界与依赖关系

### 强依赖关系

```
Desktop (src/) ──→ Electron (electron/) ──→ Engine (engine/)
   Vue 3 UI            IPC Bridge              Core Logic
                                              React/Ink UI
```

### 松耦合设计

- **Desktop ↔ Engine**：仅通过 IPC 通信，不直接 import 源码
- **Tools ↔ Services**：工具层依赖服务层抽象接口，便于替换实现
- **Components ↔ Stores**：组件通过 Pinia Store 访问状态，避免 prop drilling

### 共享代码策略

Desktop 复用 Engine 的以下部分：
- Markdown 配置（marked + highlight.js 选项）
- Diff 算法（diff 库的使用方式）
- TypeScript 类型定义（消息、工具、命令类型）
- 常量定义（错误码、限制值、提示文本）

**不共享的部分**：
- React/Ink 组件（终端专用）
- Bash AST 解析器（Engine 内部细节）
- MCP 底层传输实现

---

## 配置文件说明

| 文件 | 位置 | 用途 |
|------|------|------|
| `package.json` | 根目录 | Desktop 项目元数据与脚本 |
| `package.json` | engine/ | CLI 项目元数据与脚本 |
| `tsconfig.json` | engine/ | TypeScript 编译选项 |
| `biome.json` | engine/ | Biome Lint/Format 规则 |
| `knip.json` | engine/ | 未使用依赖检测配置 |
| `bunfig.toml` | engine/ | Bun 运行时配置 |
| `.env` | 根目录 | 环境变量（API Key 等） |
| `.npmrc` | 根目录 | npm 行为配置 |
| `.versionrc.js` | 根目录 | Versioning 规范配置 |
| `build.ts` | engine/ | 自定义构建脚本 |
| `mint.json` | engine/ | Mintlify 文档配置 |

---

## 扩展开发指南

### 添加新工具（Engine）

1. 在 `engine/src/tools/` 创建新目录
2. 实现 `Tool` 接口的必要方法
3. 在 `engine/src/tools.ts` 注册工具
4. 编写单元测试 `__tests__/`
5. 更新文档（如有用户可见功能）

### 添加新命令（Engine）

1. 在 `engine/src/commands/` 创建新文件
2. 实现 Command 接口
3. 在 `engine/src/commands.ts` 注册命令路由
4. 添加帮助文本

### 添加新组件（Desktop）

1. 在 `src/components/` 相应子目录创建 `.vue` 文件
2. 使用 `<script setup lang="ts">` + Composition API
3. 通过 Pinia Store 管理状态
4. 遵循 SCSS Variables 主题规范

---

**相关文档**：
- [README.md](./README.md) — 项目概述与快速开始
- [SCRIPTS.md](./SCRIPTS.md) — 命令参考指南
- [TESTS.md](./TESTS.md) — 测试体系说明
- [CHANGELOG.md](./CHANGELOG.md) — 版本迭代记录
