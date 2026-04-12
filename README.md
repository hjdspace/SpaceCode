# agent — Claude Code Python Port

> **项目状态**: P0 核心运行链路 ✅ 已完成 | P1 关键功能 ✅ 已完成 (2026-04-03) | 桌面端 ✅ 已完成 (2026-04-06)

agent 是 [Anthropic Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (v2.1.88) 的 Python 移植版本。源代码从 TypeScript/React (Ink) 架构忠实翻译为 Python 3.11+，保留了原始的模块结构、业务逻辑和数据流，同时排除了所有 UI 层（`.tsx` / React / Ink 组件）。

本项目包含两个主要组件：
- **agent/** — Python CLI 核心，提供命令行交互和 SDK
- **claude-code-desktop/** — Electron + Vue 3 桌面应用，提供图形化界面

## 项目概览

| 指标 | 数值 |
|------|------|
| Python 文件 | 1,310 |
| 代码行数 | 61,385 |
| 覆盖 TS 核心模块 | 1,172 / 1,131 (103%) |
| 导入错误 | 0 |

> 覆盖率超过 100% 是因为部分 TypeScript 模块在 Python 中被拆分为更细粒度的文件。

## 目录结构

```
 agent/
├── bridge/          # IDE/扩展通信桥接 (30 files)
├── buddy/           # 上下文助手提示 (7 files)
├── cli/             # 结构化 IO、传输层、处理器 (23 files)
├── commands_impl/   # 斜杠命令实现 (/compact, /diff, /doctor 等) (105 files)
├── constants/       # 全局常量、系统提示片段、限制 (22 files)
├── entrypoints/     # CLI 入口、SDK 类型、MCP 服务 (18 files)
├── keybindings/     # 键绑定定义与解析 (14 files)
├── memdir/          # 内存目录 (CLAUDE.md) 管理 (9 files)
├── migrations/      # 配置迁移脚本 (14 files)
├── plugins/         # 插件加载器 (2 files)
├── query/           # 查询引擎依赖、停止钩子、token 预算 (5 files)
├── remote/          # WebSocket 远程会话管理 (5 files)
├── schemas/         # JSON Schema 定义 (3 files)
├── server/          # HTTP/WebSocket 服务器 (5 files)
├── services/        # 核心服务层 (160 files)
│   ├── analytics/       # 事件日志与遥测
│   ├── api/             # API 客户端、认证、限流
│   ├── auto_dream/      # 自动后台任务
│   ├── compact/         # 对话压缩
│   ├── extract_memories/ # 记忆提取
│   ├── lsp/             # LSP 服务器管理
│   ├── mcp/             # MCP 协议客户端
│   ├── oauth/           # OAuth 认证流
│   ├── session_memory/  # 会话记忆 (CLAUDE.md)
│   ├── team_memory_sync/ # 团队记忆同步
│   ├── tips/            # 上下文提示
│   ├── tools/           # 工具执行与流式处理
│   └── ...
├── skills/          # 技能加载与内置技能 (13 files)
├── state/           # 应用状态管理 (4 files)
├── task/            # 任务类型与管理器 (3 files)
├── tasks/           # 任务实现 (Shell/Dream/Teammate) (9 files)
├── tools_impl/      # 工具实现 (191 files)
│   ├── AgentTool/       # 子代理创建与管理
│   ├── BashTool/        # Shell 命令执行
│   ├── FileEditTool/    # 文件编辑 (sed/patch)
│   ├── FileReadTool/    # 文件读取
│   ├── FileWriteTool/   # 文件写入
│   ├── GlobTool/        # 文件搜索
│   ├── GrepTool/        # 内容搜索 (ripgrep)
│   ├── MCPTool/         # MCP 工具代理
│   ├── PowerShellTool/  # PowerShell 执行
│   ├── WebFetchTool/    # HTTP 请求
│   ├── WebSearchTool/   # 网络搜索
│   ├── TodoWriteTool/   # TODO 管理
│   └── ...              # 30+ 其他工具
├── types/           # 类型定义 (Message, Tool, Config 等) (12 files)
├── utils/           # 工具函数库 (630 files)
│   ├── bash/            # Bash 解析、引用、命令规格
│   ├── claude_in_chrome/ # Chrome 原生主机集成
│   ├── computer_use/    # 计算机使用工具
│   ├── deep_link/       # 深度链接解析
│   ├── git/             # Git diff/status/log
│   ├── hooks/           # 钩子系统
│   ├── model/           # 模型配置与选择
│   ├── permissions/     # 权限系统
│   ├── plugins/         # 插件管理
│   ├── secure_storage/  # 安全存储
│   ├── settings/        # 设置管理
│   ├── shell/           # Shell 提供者
│   ├── swarm/           # 多代理后端
│   ├── task/            # 任务输出与格式化
│   ├── telemetry/       # 遥测与日志
│   ├── teleport/        # 远程环境
│   └── ...              # 200+ 其他工具模块
└── vim/             # Vim 模式支持 (8 files)
```

## 技术选型

| TypeScript 概念 | Python 等价 |
|------------------|-------------|
| `interface` / `type` | `dataclass` / `TypedDict` / `Protocol` |
| Zod schemas | `dict[str, Any]` + JSON Schema |
| `async/await` + Promises | `asyncio` + `async/await` |
| React/Ink 组件 | 排除（非 UI 移植） |
| `lodash` 工具函数 | Python 标准库等价实现 |
| Node.js `child_process` | `asyncio.create_subprocess_exec` |
| `AbortController` | `asyncio.Event` / cancellation patterns |
| ES Modules | Python packages + `__init__.py` |

## 环境要求

- Python 3.11+
- `anthropic` SDK（调用 Anthropic API 必需）
- Node.js 18+（仅桌面端需要）

## 快速开始

### 方式一：命令行 (CLI)

### 1. 安装依赖

```bash
pip install anthropic
```

### 2. 设置 API Key

```bash
# Linux / macOS
export ANTHROPIC_API_KEY="sk-ant-api03-你的key"

# Windows PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-api03-你的key"

# Windows CMD
set ANTHROPIC_API_KEY=sk-ant-api03-你的key
```

### 3. 运行

```bash
# 交互模式（REPL）
python -m agent

# 非交互模式（单次问答，结果直接输出到 stdout）
python -m agent -p "帮我写一个 Python hello world"

# 指定模型
python -m agent -p "hello" --model claude-sonnet-4-6-20260301

# 指定工作目录
python -m agent --cwd /path/to/project

# 查看所有选项
python -m agent --help
```

### 4. 作为库使用

```python
import asyncio
from agent.main import cli_main

# 等价于命令行 python -m agent -p "hello"
asyncio.run(cli_main(["-p", "hello"]))
```

### 可选环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | **必需** — Anthropic API 密钥 |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点（代理/自托管） |
| `CLAUDE_CODE_SIMPLE` | 设为 `1` 启用精简模式（仅 Bash + Read + Edit 三个工具） |

### 方式二：桌面应用 (Desktop)

#### 1. 安装依赖

```bash
cd claude-code-desktop
npm install
```

#### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

```env
# OpenAI / OpenRouter 配置
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=anthropic/claude-sonnet-4

# 或 Anthropic 配置
ANTHROPIC_API_KEY=your-api-key
LLM_PROVIDER=anthropic
```

#### 3. 运行开发模式

```bash
npm run dev
```

#### 4. 构建生产版本

```bash
npm run electron:build
```

#### 桌面端功能特性

| 功能 | 说明 |
|------|------|
| 多 Provider 支持 | OpenAI/OpenRouter、Anthropic |
| 流式响应 | 实时显示 AI 回复 |
| 工具执行 | Bash、文件读写、搜索等 |
| 会话管理 | 多会话、本地持久化 |
| 上下文压缩 | 自动压缩长对话 |
| 模型选择 | 支持 OpenRouter 300+ 模型 |
| 文件浏览 | 项目文件树 |
| Diff 预览 | 代码变更对比 |

## 模块统计

| 模块 | 文件数 | 代码行数 | 说明 |
|------|--------|----------|------|
| `utils/` | 630 | 35,710 | 工具函数、权限、插件、Shell、Git 等 |
| `tools_impl/` | 191 | 7,285 | 所有工具的 prompt + schema + 实现 |
| `services/` | 160 | 5,761 | API、MCP、OAuth、分析、压缩等服务 |
| `commands_impl/` | 105 | 1,472 | 斜杠命令 |
| `bridge/` | 30 | 811 | IDE 桥接通信 |
| `cli/` | 23 | 639 | CLI 传输与处理 |
| `constants/` | 22 | 543 | 常量定义 |
| `entrypoints/` | 18 | 417 | 入口点 |
| `keybindings/` | 14 | 1,367 | 键绑定 |
| `migrations/` | 14 | 495 | 配置迁移 |
| `skills/` | 13 | 394 | 技能系统 |
| `types/` | 12 | 831 | 核心类型 |
| 其他 | 58 | 4,660 | memdir, vim, tasks, remote 等 |
| **总计** | **1,310** | **61,385** | |

## 排除内容

以下 TypeScript 模块被有意排除，因为它们是 UI 层（React/Ink）专用代码：

- `components/` — React 组件 (111 个 `.tsx` 文件)
- `hooks/` — React Hooks (68 个 `.ts` + 15 个 `.tsx`)
- `ink/` — Ink 终端 UI 框架 (41 个 `.ts`)
- `screens/` — 屏幕组件
- `context/` — React Context
- `state/` — UI 状态管理（部分）

## 模块级使用示例

```python
# 工具注册表
from agent.tools import get_all_base_tools
tools = get_all_base_tools()  # [Agent, Bash, Glob, Grep, Read, Edit, Write, ...]

# QueryEngine（对话引擎核心）
from agent.query_engine import QueryEngine, QueryEngineConfig

# 环境信息
from agent.utils.env import env
print(env.platform, env.arch)

# 单独调用内置工具
from agent.tools_impl.FileReadTool.file_read_tool import call as read_file
import asyncio
result = asyncio.run(read_file(file_path="/etc/hosts"))
```

## 源码对照

| 源码 (TypeScript) | 移植 (Python) |
|-------------------|---------------|
| `src/utils/env.ts` | ` agent/utils/env.py` |
| `src/tools/BashTool/` | ` agent/tools_impl/BashTool/` |
| `src/services/api/` | ` agent/services/api/` |
| `src/commands/compact/` | ` agent/commands_impl/compact.py` |
| `src/utils/permissions/` | ` agent/utils/permissions/` |
| `src/bridge/` | ` agent/bridge/` |

命名转换规则：
- 文件名: `camelCase.ts` → `snake_case.py`
- 目录名: `camelCase/` → `snake_case/`
- 特殊映射: `tools/` → `tools_impl/`, `commands/` → `commands_impl/`

## 桌面端架构

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3 + TypeScript |
| 状态管理 | Pinia |
| 样式 | SCSS + CSS Variables |
| 桌面框架 | Electron 29 |
| 构建工具 | Vite 5 |
| LLM SDK | @anthropic-ai/sdk, openai |

### 目录结构

```
claude-code-desktop/
├── electron/                      # Electron 主进程
│   ├── main.ts                    # 入口、窗口管理、IPC
│   ├── preload.ts                 # 渲染进程桥接
│   ├── queryEngineIntegration.ts  # QueryEngine 核心实现
│   └── services/
│       └── contextManager.ts      # 上下文压缩、会话记忆
├── src/
│   ├── components/
│   │   ├── chat/                  # 聊天 UI (MessageList, ChatInput)
│   │   ├── common/                # 通用组件 (CodeViewer, DiffViewer)
│   │   ├── explorer/              # 文件浏览器 (FileTree)
│   │   ├── layout/                # 布局 (Sidebar, ChatPanel)
│   │   └── settings/              # 设置面板
│   ├── services/                  # 前端服务层
│   ├── stores/                    # Pinia 状态管理
│   │   ├── chat.ts                # 会话状态
│   │   ├── settings.ts            # 配置状态
│   │   └── app.ts                 # 应用状态
│   ├── styles/                    # 全局样式
│   └── types/                     # TypeScript 类型定义
└── package.json
```

### 核心模块说明

#### QueryEngine Integration

`queryEngineIntegration.ts` 是桌面端的核心，实现了：

- **会话管理**: 创建、删除、持久化会话
- **流式响应**: 通过 IPC 实现主进程到渲染进程的实时流
- **工具执行**: Bash、文件操作、搜索等工具
- **上下文压缩**: 自动检测并压缩长对话
- **动态 System Prompt**: 根据上下文构建系统提示

#### Context Manager

`contextManager.ts` 提供上下文管理能力：

- **Token 估算**: 简化的 token 计数
- **对话压缩**: 保留最近消息，压缩历史
- **会话记忆**: 持久化关键信息
- **动态提示**: 注入工作目录、工具列表、最近文件等

#### IPC 通信

```
渲染进程 <---> preload.js <---> 主进程
     |                              |
     |  queryengine:createSession   |
     |  queryengine:streamMessage   |
     |  queryengine:chunk (返回)    |
     |  queryengine:complete (返回) |
     v                              v
   Pinia Store              QueryEngine
```

## 未来优化与新增特性

### P0 - 高优先级

| 特性 | 说明 | 复杂度 |
|------|------|--------|
| Python Agent 深度集成 | 通过子进程调用 Python agent 模块，复用完整的工具链 | 高 |
| MCP 协议支持 | 集成 MCP 工具服务器，扩展工具生态 | 中 |
| 权限系统 | 工具执行前请求用户确认，敏感操作审计 | 中 |
| 错误恢复 | 网络断开自动重连、消息重试机制 | 低 |

### P1 - 中优先级

| 特性 | 说明 | 复杂度 |
|------|------|--------|
| 多窗口支持 | 独立会话窗口，窗口间状态隔离 | 中 |
| 主题系统 | 深色/浅色主题切换，自定义主题 | 低 |
| 快捷键系统 | 完善的键盘操作支持 | 低 |
| Git 集成 | 文件状态显示、diff 预览、提交操作 | 中 |
| 终端集成 | 内置终端面板，直接执行命令 | 高 |

### P2 - 低优先级

| 特性 | 说明 | 复杂度 |
|------|------|--------|
| 插件系统 | 支持自定义工具和 UI 扩展 | 高 |
| 代码补全 | 集成 LSP，提供智能补全 | 高 |
| 项目模板 | 快速创建项目脚手架 | 中 |
| 团队协作 | 会话共享、云端同步 | 高 |
| 语音输入 | 语音转文字输入 | 中 |

### 技术债务

1. **工具执行安全性**: 当前工具执行缺少沙箱隔离，需要增加安全限制
2. **测试覆盖**: 缺少单元测试和集成测试
3. **错误处理**: 部分错误处理不够完善，需要统一错误处理机制
4. **性能优化**: 大量消息时的渲染性能优化
5. **类型安全**: 部分 `any` 类型需要替换为具体类型

## License

本项目为 Anthropic Claude Code 的非官方 Python 移植，仅供学习和研究用途。
