# Claude Code GUI

> AI 驱动的智能编程助手，提供 CLI 终端界面和桌面 GUI 两种使用方式。基于 [Claude Code Best](https://github.com/claude-code-best/claude-code) 逆向工程构建的 CLI 引擎。

[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![Electron](https://img.shields.io/badge/framework-Electron-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![Vue 3](https://img.shields.io/badge/framework-Vue%203-4FC08D?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

## 项目概述

### 核心目标

SpaceCode 致力于打造**新一代 AI 辅助编程工具**，通过深度整合大语言模型能力，为开发者提供智能化的代码编写、调试、重构和项目管理体验。本项目采用 Monorepo 架构，同时提供：

1. **CLI 命令行版本** (`claude-code`) — 面向终端用户的高效交互式编程助手
2. **桌面 GUI 版本** (`claude-code-desktop`) — 面向可视化用户的现代化桌面应用

### 主要价值

- **提升开发效率**：45+ 内置工具覆盖文件操作、代码搜索、Web 抓取、API 调用等场景
- **降低学习成本**：60+ 斜杠命令提供直观的操作入口，无需记忆复杂参数
- **多模型支持**：兼容 Anthropic、OpenAI、Gemini、Grok 等主流 LLM 服务商
- **灵活部署方式**：支持本地终端、桌面应用、远程协作等多种使用模式
- **企业级可靠性**：完善的测试体系（100+ 测试用例）、CI/CD 流程、错误处理机制

## 项目架构

本仓库采用 **Monorepo** 结构，包含两个互补的子项目：

| 子项目 | 定位 | 技术栈 | 目标用户 |
|--------|------|--------|----------|
| **engine/** (CLI) | 终端交互式 AI 编程助手 | Bun + TypeScript + React/Ink | 终端爱好者、DevOps 工程师 |
| **根目录** (Desktop) | 桌面 GUI 应用 | Electron + Vue 3 + Vite | 可视化用户、初学者 |

```
SpaceCode/
├── engine/                          # CLI 核心引擎
│   ├── src/                         # 源代码
│   │   ├── main.tsx                 # 入口文件 (Commander + React/Ink REPL)
│   │   ├── QueryEngine.ts           # 查询编排引擎
│   │   ├── tools/                   # 45+ 工具实现
│   │   ├── commands/                # 60+ 命令实现
│   │   └── services/                # API/MCP/LSP 服务层
│   ├── tests/                       # 测试套件
│   └── packages/                    # 工作区包
│
├── electron/                        # Electron 主进程
│   ├── main.ts                      # 主进程入口
│   ├── preload.ts                   # Context Bridge (IPC API)
│   └── terminalManager.ts           # PTY 终端管理器
│
├── src/                             # Vue 3 渲染进程
│   ├── App.vue                      # 根组件（三栏布局）
│   ├── components/                  # UI 组件库
│   ├── stores/                      # Pinia 状态管理
│   └── services/                    # LLM 客户端服务
│
├── CHANGELOG.md                     # 更新日志
├── README.md                        # 本文档
└── package.json                     # Desktop 项目配置
```

## 功能特性

### CLI 功能（`engine/`）

#### 核心工具集（45+）

| 类别 | 工具示例 | 说明 |
|------|----------|------|
| **文件操作** | FileRead, FileEdit, Glob, Grep | 读取、编辑、搜索文件 |
| **Shell 执行** | BashTool, PowerShellTool | 执行系统命令 |
| **Web 能力** | WebFetch, WebSearch | 抓取网页、搜索引擎查询 |
| **IDE 集成** | LSPTool | Language Server Protocol 支持 |
| **扩展协议** | MCPTool | Model Context Protocol 代理 |
| **子代理** | AgentTool | 多代理协作任务分发 |

#### 斜杠命令（60+）

常用命令速查：

| 命令 | 说明 | 使用场景 |
|------|------|----------|
| `/help` | 显示帮助信息 | 初次使用、查看可用命令 |
| `/login` | 配置 API 提供商 | 首次启动、切换服务商 |
| `/model` | 切换模型 | 选择 Haiku/Sonnet/Opus |
| `/config` | 编辑配置文件 | 调整参数、自定义行为 |
| `/compact` | 压缩对话上下文 | 对话过长时优化 Token 用量 |
| `/diff` | 查看代码差异 | 代码审查、变更对比 |
| `/review` | 代码审查 | 提交前质量检查 |
| `/cost` | 显示用量成本 | 监控 API 费用 |
| `/doctor` | 运行诊断 | 排查问题、健康检查 |
| `/mcp` | 管理 MCP 服务器 | 扩展工具能力 |
| `/voice` | 切换语音输入 | 免手写操作 |
| `/theme` | 切换主题 | 明暗模式切换 |

#### 高级特性

- **多实例协作**：基于 Pipe IPC 的多实例通信 + LAN 局域网发现
- **计算机控制**：Computer Use / Chrome Use 屏幕和浏览器操控
- **语音模式**：Push-to-Talk 按键通话
- **扩展思考**：Extended Thinking 深度推理模式
- **会话历史**：完整的对话记录和费用追踪
- **MCP 协议**：支持 stdio/SSE/HTTP/WebSocket 四种传输方式

#### 多会话管理（Multi-Session Management）

支持同时运行多个独立的 AI 会话任务，实现真正的多任务并行处理：

| 特性 | 说明 |
|------|------|
| **浏览器式 Tab 界面** | 类似 Chrome 的标签页管理，支持新建、切换、关闭 Tab |
| **后台会话保持** | 关闭 Tab 不会终止后台进程，任务继续运行 |
| **进程池管理** | 最多 3 个 CLI 进程并发，LRU 策略自动暂停最久未用的会话 |
| **状态实时显示** | 旋转动画（处理中）、绿色圆点（空闲）、黄色圆点（已暂停） |
| **会话恢复** | 应用重启后自动恢复会话列表，点击时懒加载恢复对话 |

**使用场景：**
- 同时进行代码审查和 Bug 修复两个任务
- 长耗时任务（如大规模重构）在后台运行，前台处理其他工作
- 不同项目间快速切换，每个项目保持独立的对话上下文

### Desktop 功能（根目录）

#### 界面设计

- **三栏布局**：侧边栏 + 聊天面板 + 信息面板（灵感来自 VSCode）
- **浏览器式 Tab 栏**：支持多会话并行，Tab 关闭后后台任务继续运行
- **主题系统**：Dark/Light 双主题，CSS Variables 动态切换
- **响应式设计**：可拖拽调整面板大小

#### 核心组件

| 组件 | 功能 | 技术实现 |
|------|------|----------|
| Markdown 渲染器 | 富文本展示 | marked + highlight.js |
| 代码差异查看器 | 行级 Diff 对比 | diff 库 + 自定义 UI |
| 集成终端 | Shell 交互环境 | xterm.js + node-pty |
| 文件树浏览器 | 项目结构导航 | 自定义递归组件 |
| 会话管理器 | 历史记录切换 | Pinia Store 持久化 |
| 多会话管理 | 多 Tab 并行会话 | 进程池 + LRU 淘汰 + 事件路由 |
| **回滚对话框** | **消息回滚操作** | Teleport 模态弹窗 + Pinia Rewind State |
| **消息选择器** | **选择回滚目标消息** | 消息列表弹窗 + 时间格式化 |

#### 平台支持

- ✅ Windows (NSIS 安装包 + Portable 便携版)
- ✅ macOS (DMG + ZIP)
- ✅ Linux (AppImage + DEB + RPM)

#### 对话回滚（Rewind）

支持将对话和代码变更回滚到历史消息节点，提供灵活的回滚策略：

| 选项 | 说明 | 适用场景 |
|------|------|----------|
| **回滚对话和代码** | 删除目标消息之后的所有消息，并撤销对应的代码更改 | 彻底回退到某个决策点 |
| **仅回滚对话** | 仅删除目标消息后的对话记录，保留代码变更 | 想换种说法重新提问，但不丢失已有改动 |
| **仅回滚代码** | 仅撤销代码更改，保留所有消息记录 | 代码改错了，但对话上下文还想保留 |
| **回滚并总结** | 回滚后生成变更总结 | 团队协作时记录回滚原因 |

**工作流程：**
1. 在消息列表中右键或点击回滚按钮
2. 在消息选择器中选择要回滚到的目标用户消息
3. 选择回滚策略（对话/代码/两者/总结）
4. 预览变更统计（文件数、增删行数）
5. 确认执行回滚

**技术实现：**
- `RewindDialog.vue` — Teleport 模态弹窗，支持 5 种回滚选项和变更统计预览
- `MessageSelector.vue` — 消息选择器，展示时间线和内容预览
- `chat.ts` (Pinia Store) — RewindState 状态管理 + 对话裁剪 + 代码回滚 IPC 调用
- 完整的中/英文 i18n 文案支持
- 配套单元测试和集成测试覆盖

## 快速开始

### 环境要求

| 环境 | 最低版本 | 推荐版本 | 用途 |
|------|----------|----------|------|
| **Bun** | >= 1.2.0 | >= 1.3.11 | CLI 运行时 |
| **Node.js** | >= 18 | >= 20 | Desktop 构建 |
| **npm** | >= 9 | 最新版 | 包管理器 |
| **Git** | >= 2.x | 最新版 | 版本控制 |

### 依赖安装

#### 全局工具准备

```bash
# 安装 Bun（如未安装）
powershell -c "irm bun.sh/install.ps1 | iex"

# 验证安装
bun --version  # 应显示 >= 1.2.0
node --version  # 应显示 >= 18
```

#### 克隆项目

```bash
git clone https://github.com/hjdspace/SpaceCode.git
cd SpaceCode
```

#### 安装依赖

```bash
# 安装 Desktop 项目依赖（根目录）
npm install

# 安装 CLI 引擎依赖（engine 目录）
cd engine && bun install && cd ..
```

### 开发环境启动

#### 方式一：启动 CLI 开发模式

```bash
cd engine

# 启动开发服务器（热重载）
bun run dev

# 或启用调试模式（Inspector）
bun run dev:inspect
```

启动后即可在终端中使用 `ccb` 命令与 AI 助手交互。

#### 方式二：启动 Desktop 开发模式

```bash
# 回到项目根目录
cd ..

# 启动 Electron + Vite 开发服务器
npm run electron:dev
```

此命令会同时启动：
- Vite 前端开发服务器（热更新）
- Electron 主进程（自动重载）
- IPC 通信桥接层

### 生产环境构建

#### 构建 CLI

```bash
cd engine

# 执行构建（生成 dist/ 目录）
bun run build

# 运行构建产物
./dist/cli.js  # 或全局安装后使用 ccb 命令
```

#### 构建 Desktop 应用

```bash
# 类型检查 + Vite 构建
npm run build

# 打包 Electron 应用（生成 release/ 目录）
npm run electron:build
```

打包输出：
- **Windows**: `release/SpaceCode Setup x.x.x.exe`（安装包）+ `SpaceCode x.x.x.exe`（便携版）
- **macOS**: `release/SpaceCode-x.x.x.dmg` + `SpaceCode-x.x.x-mac.zip`
- **Linux**: `release/SpaceCode-x.x.x.AppImage` + `.deb` + `.rpm`

### 配置说明

首次启动时，需要配置 LLM 提供商：

**CLI 方式**（在终端中执行）：
```bash
/login
```

**Desktop 方式**（在设置面板中填写）：

| 配置项 | 说明 | 示例值 |
|--------|------|--------|
| Base URL | API 服务端点 | `https://api.anthropic.com/v1` |
| API Key | 认证密钥 | `sk-ant-xxxxx` |
| 快速模型 | 轻量级模型 ID | `claude-haiku-4-5-20251001` |
| 均衡模型 | 平衡型模型 ID | `claude-sonnet-4-6` |
| 高性能模型 | 旗舰模型 ID | `claude-opus-4-6` |

兼容所有 Anthropic API 规范的服务商（OpenRouter、AWS Bedrock 代理、Azure OpenAI 等）。

## 技术栈详解

### CLI 引擎（`engine/`）

| 技术 | 版本 | 用途 |
|------|------|------|
| **Bun** | >= 1.2.0 | JavaScript 运行时、包管理器、构建工具 |
| **TypeScript** | 6.x | 类型安全、编译时检查 |
| **React** | 19.x | 终端 UI 渲染（配合 Ink） |
| **Ink** | workspace:* | React 终端渲染库 |
| **Zustand** | - | 轻量状态管理 |
| **Commander.js** | 14.x | CLI 参数解析 |
| **Biome** | 2.x | 代码格式化 + Lint |
| **@anthropic-ai/sdk** | 0.80.x | Anthropic API 客户端（流式） |
| **OpenAI SDK** | 6.x | OpenAI 兼容接口适配 |
| **MCP SDK** | 1.29.x | Model Context Protocol 实现 |

### Desktop 应用（根目录）

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
| **electron-builder** | 24.x | 应用打包工具 |

## 项目约定

### 代码规范

- **UI 复用原则**：CLI 的 React/Ink 组件仅用于终端渲染，不与 Desktop 共享；Desktop 复用 CLI 的业务逻辑（Markdown 配置、Diff 算法、消息类型），但实现独立的 Vue UI 层
- **IPC 通信**：Electron 主进程与渲染进程遵循 preload context bridge 安全模式
- **QueryEngine 集成**：Desktop 通过主进程适配层调用 CLI 的 QueryEngine，避免重复实现

### 目录职责划分

| 目录 | 职责 | 说明 |
|------|------|------|
| `electron/` | Electron 主进程 | 窗口管理、IPC 服务、系统集成 |
| `src/components/layout/` | 布局组件 | Sidebar、ChatPanel、InfoPanel、TitleBar |
| `src/components/chat/` | 聊天组件 | 消息渲染、输入框、Markdown 展示、回滚对话框、消息选择器 |
| `src/components/explorer/` | 文件浏览器 | 项目树状导航 |
| `src/components/terminal/` | 终端组件 | xterm.js 封装 |
| `src/stores/` | 状态管理 | Pinia Store（app.ts、chat.ts） |
| `src/services/` | 业务服务 | LLM 客户端、Electron API 封装 |
| `src/styles/` | 样式资源 | SCSS 变量、主题定义 |

## 相关文档

- [更新日志](./CHANGELOG.md) — 版本迭代记录
- [贡献指南](./CONTRIBUTING.md) — 如何参与开发
- [安全说明](./SECURITY.md) — 安全策略与漏洞报告
- [英文文档](./README_EN.md) — English Version

## 许可证

详见各子项目的许可证文件。

---

**项目主页**: https://github.com/hjdspace/SpaceCode
**问题反馈**: https://github.com/hjdspace/SpaceCode/issues
