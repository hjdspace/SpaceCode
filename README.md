<div align="center">

<img src="icons/icon.png" width="120" height="120" alt="SpaceCode Logo" />

# SpaceCode

### AI 驱动的智能编程桌面助手

基于 Claude Code 引擎构建的新一代 AI 辅助编程桌面应用，深度融合大语言模型能力，为开发者提供智能化的代码编写、调试、重构和项目管理体验。

[![Electron](https://img.shields.io/badge/Electron-29-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![Vue 3](https://img.shields.io/badge/Vue%203-3.4-4FC08D?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-2-black?style=flat-square&logo=bun)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)]()

[双模式核心](#双模式核心) · [更多特色](#更多特色) · [快速开始](#快速开始) · [项目结构](#项目结构) · [开发指南](#开发指南) · [技术栈](#技术栈)

</div>

---

## 项目简介

SpaceCode 是一款跨平台 AI 桌面助手，采用 **Electron + Vue 3 + TypeScript** 技术栈构建。它创造性地将 **AI 编程** 与 **AI 办公** 融合到同一应用中，通过顶部的 `💻 编码` / `💼 办公` 模式切换，在一款工具中同时满足开发者的代码编写需求和职场人的文档产出需求。

项目采用 Monorepo 架构，包含桌面 GUI 应用（根目录）、CLI 核心引擎（`engine/`）和 Flutter 移动端配套应用（`mobile-app/`），支持扫码配对远程协作。

---

## 双模式核心

SpaceCode 的核心是 **编码模式** 和 **办公模式** 两大场景，通过顶部 Tab 一键切换，共享会话管理、多模型支持、技能系统等底层能力。

### 💻 编码模式（Code Mode）

面向开发者的 AI 编程助手，深度集成 Claude Code 引擎，提供从代码编写、调试、重构到项目管理的全流程辅助。

<div align="center">

<img src="screenshots/code.png" alt="SpaceCode 编码模式" width="900" />

*编码模式：三栏 IDE 布局，AI 对话 + 工具调用卡片 + 文件树/Diff 面板*

</div>

**核心能力：**

| 能力 | 说明 |
|------|------|
| **AI 对话编程** | 自然语言描述需求，AI 自动读写文件、执行命令、生成代码 |
| **工具调用卡片** | Bash、Edit、Read、Write、Glob、Grep、WebFetch、WebSearch、Agent 等 13+ 工具的可视化卡片，每步操作清晰可见 |
| **代码 Diff 预览** | 基于 `@git-diff-view` 的行级差异对比，AI 每次编辑都可审查 |
| **集成终端** | 基于 xterm.js + node-pty，支持多终端标签页，与 AI 会话无缝协作 |
| **Git SCM 面板** | 暂存、提交、推送、分支管理、Diff 查看，事件驱动自动刷新 |
| **文件浏览器** | 项目树状导航，支持右键菜单与外部编辑器打开（VS Code、Cursor、Vim 等） |
| **对话回滚（Rewind）** | 支持将对话和代码变更回滚到历史消息节点，提供 4 种回滚策略 |
| **权限控制** | 自动批准 / 手动批准 / 始终拒绝 / 仅建议四种模式，精细控制 AI 操作范围 |
| **斜杠命令** | 内联命令芯片 + 斜杠命令菜单，70+ 命令覆盖常用操作 |

**对话回滚策略：**

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| 回滚对话和代码 | 删除目标消息后的所有消息并撤销代码更改 | 彻底回退到某个决策点 |
| 仅回滚对话 | 仅删除对话记录，保留代码变更 | 换种方式重新提问 |
| 仅回滚代码 | 仅撤销代码更改，保留对话上下文 | 代码改错了但想保留上下文 |
| 回滚并总结 | 回滚后生成变更总结 | 团队协作记录回滚原因 |

### 💼 办公模式（Work Mode）

面向职场场景的 AI 办公助手，内置 20+ 专业助手，能够直接生成可编辑的 `.pptx`、`.docx`、`.xlsx` 文件，而非输出 Markdown 让用户自行排版。

<div align="center">

<img src="screenshots/work.png" alt="SpaceCode 办公模式" width="900" />

*办公模式：办公助手快捷入口 + AI 对话 + 产物汇总卡片 + 文档实时预览*

</div>

**核心能力：**

| 能力 | 说明 |
|------|------|
| **专业办公助手** | 内置 PPT 制作、Word 文档、Excel 表格、财务模型、数据看板、学术论文等 20+ 专业助手 |
| **真实文件产出** | 通过 officecli 技能体系直接生成可编辑的 `.pptx`/`.docx`/`.xlsx` 文件，支持下载后二次编辑 |
| **产物汇总卡片** | 每轮对话自动收集和展示生成的文件，支持预览、打开、定位文件夹 |
| **文档实时预览** | 右侧面板支持 HTML 渲染、截图缩略图、实时观看三种预览模式 |
| **自定义助手** | 支持创建自定义办公助手，配置系统提示词、技能绑定与推荐 Prompt |
| **officecli 技能体系** | 全量接入 officecli 技能库，涵盖 PPT 多套样式、Word 表单、Excel 数据看板等场景 |
| **工作空间管理** | 首次进入办公模式引导选择工作目录，所有产物统一存放在 `outputs/` 目录 |

**内置助手一览：**

| 分类 | 助手示例 |
|------|----------|
| 📊 演示文稿 | PPT 制作、Morph PPT、Morph PPT 3D、融资路演 Pitch Deck |
| 📄 文档写作 | Word 文档、Word 表单、文档协作 |
| 📈 数据表格 | Excel 表格、数据看板 |
| 🎓 学术研究 | 学术论文、财务模型 |
| 🎨 创意设计 | UI/UX 设计、品牌指南、社交图片 |
| ⚡ 通用效率 | 文件规划、TDD 指导、代码审查 |

<div align="center">

<img src="screenshots/助手画廊.png" alt="SpaceCode 办公助手画廊" width="900" />

*办公助手画廊：20+ 专业助手，按分类筛选，支持自定义创建*

</div>

---

## 更多特色

### 🖥️ 分屏多会话布局

- **三栏式 IDE 布局**：侧边栏 + 聊天面板 + 信息面板，灵感来自 VSCode，支持拖拽调整面板宽度
- **分屏多会话**：中央区分屏布局系统，支持多会话并行展示，每个标签页独立管理
- **浏览器式 Tab 管理**：类似 Chrome 的标签页管理，新建、切换、关闭一气呵成
- **后台会话保持**：关闭 Tab 不会终止后台进程，任务继续运行
- **进程池管理**：多 CLI 进程并发，LRU 策略自动暂停最久未用的会话

<div align="center">

<img src="screenshots/多会话.png" alt="SpaceCode 分屏多会话" width="900" />

*分屏多会话：多个会话标签并行运行，各自独立管理*

</div>

### 🤖 双引擎多模型架构

- **双引擎支持**：Claude Code CLI 引擎 + Pi Engine，可随时切换
- **多模型兼容**：支持 Anthropic（Claude）、OpenAI（GPT）、Gemini、Grok、DeepSeek 等主流 LLM 服务商
- **API 代理桥**：内置 Anthropic ↔ OpenAI 消息格式转换代理，支持流式响应，无缝对接 OpenAI 兼容接口
- **引擎源配置**：可视化引擎源管理，支持 CLI 自动检测与一键安装

### 🔌 MCP 协议与扩展生态

- **MCP 服务器管理**：支持 stdio / SSE / HTTP 三种传输方式，可视化配置与连通性检测
- **Computer Use MCP**：内置预打包 Computer Use MCP 服务器，支持屏幕和浏览器操控
- **内置 MCP 依赖安装**：一键安装与状态检测，提升环境配置体验

### 📚 技能库与智能体系统

- **50+ 内置技能**：涵盖前端设计、PPT 生成、代码审查、TDD、文档创作、办公文档等领域
- **技能管理器**：技能浏览、安装、编辑、分类过滤，支持本地技能与市场技能
- **Agents 智能体**：完整的代理管理系统，70+ 内置 Agent，支持工作流编辑与执行

### ⚡ 高级功能

- **定时任务（Cron）**：Cron 表达式解析与定时任务调度，支持任务运行日志
- **Hook 管理系统**：会话生命周期钩子，支持用户级 / 项目级 / 本地级三种作用域
- **上下文用量管理**：Token 使用量追踪、上下文缓存统计、用量可视化与预警
- **链路追踪（Trace）**：完整的会话链路追踪与调用详情查看，便于调试
- **会话上下文面板**：Git 图表、分支创建、环境变量管理、任务面板
- **迷你浏览器工作台**：内置 WebView 浏览器，支持 HTML 产物自动预览

### 📱 移动端配套

- **Flutter 跨平台应用**：支持 Android、iOS、macOS、Linux、Windows、Web 六端
- **扫码配对**：扫描桌面端二维码快速连接
- **主题实时同步**：桌面端主题配置实时同步到移动端
- **远程操作**：移动端查看会话、审批工具调用、管理代理

### 🎨 精致的用户体验

- **主题系统**：Dark / Light 双主题，Anthropic 官方配色规范，CSS 变量动态切换
- **国际化（i18n）**：完整的中英文双语支持
- **自动更新**：内置 electron-updater，支持 GitHub Release 自动检查与更新
- **快捷键系统**：可自定义的快捷键配置
- **响应式设计**：可拖拽调整面板，适配不同屏幕尺寸

---

## 快速开始

### 环境要求

| 环境 | 最低版本 | 推荐版本 | 用途 |
|------|----------|----------|------|
| **Node.js** | >= 18 | >= 20 | Desktop 构建运行 |
| **Bun** | >= 2.0.0 | >= 2.1.0 | CLI 引擎运行时 |
| **npm** | >= 9 | 最新版 | 包管理器 |
| **Git** | >= 2.x | 最新版 | 版本控制 |

### 安装与启动

```bash
# 1. 克隆项目
git clone https://github.com/hjdspace/SpaceCode.git
cd SpaceCode

# 2. 安装 Desktop 依赖（会自动安装 engine 依赖）
npm install

# 3. 启动 Electron + Vite 开发服务器
npm run electron:dev
```

启动后将同时运行 Vite 前端开发服务器（热更新）、Electron 主进程和 IPC 通信桥接层。

### 首次配置

首次启动后，在设置面板中配置 LLM 提供商：

| 配置项 | 说明 | 示例值 |
|--------|------|--------|
| Base URL | API 服务端点 | `https://api.anthropic.com/v1` |
| API Key | 认证密钥 | `sk-ant-xxxxx` |
| 快速模型 | 轻量级模型 ID | `claude-haiku-4-5-20251001` |
| 均衡模型 | 平衡型模型 ID | `claude-sonnet-4-6` |
| 高性能模型 | 旗舰模型 ID | `claude-opus-4-6` |

兼容所有 Anthropic API 规范的服务商（OpenRouter、AWS Bedrock 代理、Azure OpenAI 等），也可通过内置 API 代理桥接入 OpenAI 兼容接口。

---

## 项目结构

```
SpaceCode/
├── src/                        # Vue 3 渲染进程
│   ├── App.vue                 # 根组件（三栏布局）
│   ├── components/             # UI 组件库
│   │   ├── chat/               # 聊天组件（消息渲染、工具卡片、回滚、命令菜单）
│   │   ├── layout/             # 布局组件（分屏容器、侧边栏、标题栏、终端）
│   │   ├── explorer/           # 文件浏览器
│   │   ├── scm/                # Git 源码管理
│   │   ├── terminal/           # 终端组件
│   │   ├── settings/           # 设置面板
│   │   ├── skills/             # 技能管理
│   │   ├── agents/             # Agent 智能体管理
│   │   ├── mcp/                # MCP 配置
│   │   ├── cron/               # 定时任务
│   │   ├── work/               # 工作模式与办公助手
│   │   ├── debug/              # 链路追踪
│   │   ├── session-context/    # 会话上下文面板
│   │   └── common/             # 通用 UI 组件
│   ├── stores/                 # Pinia 状态管理（20 个模块）
│   ├── composables/            # Vue 组合式函数
│   ├── services/               # LLM 客户端、Electron API 服务
│   ├── i18n/                   # 国际化（zh-CN / en-US）
│   ├── styles/                 # 全局样式与主题变量
│   └── types/                  # TypeScript 类型定义
│
├── electron/                   # Electron 主进程
│   ├── main.ts                 # 主进程入口
│   ├── preload.ts              # Context Bridge（安全 IPC API）
│   ├── sessionProcess.ts       # 会话进程管理
│   ├── claudeCodeProcessPool.ts # 进程池管理
│   ├── gitService.ts           # Git 操作服务
│   ├── terminalManager.ts      # PTY 终端管理器
│   ├── skillsService.ts        # 技能管理服务
│   ├── agentsService.ts        # Agent 管理服务
│   ├── cronService.ts          # 定时任务服务
│   ├── officeCliService.ts     # officecli 集成服务
│   ├── autoUpdaterService.ts   # 自动更新服务
│   ├── mobileServer.ts         # 移动端 WebSocket 服务
│   ├── proxy/                  # API 代理模块（Anthropic ↔ OpenAI 转换）
│   └── engines/                # 多引擎适配层（ClaudeCode / Pi）
│
├── engine/                     # CLI 核心引擎（Bun 独立子项目）
├── mobile-app/                 # Flutter 移动端配套应用
├── skills-lib/                 # 内置技能库（50+ 技能）
├── agents-lib/                 # 内置智能体库（70+ Agent）
├── docs/                       # 设计文档与原型
├── tests/                      # 测试套件
└── package.json                # Desktop 项目配置
```

---

## 开发指南

### 常用命令

```bash
# ─── 开发 ───
npm run electron:dev              # 启动 Electron 开发模式
npm run dev                       # 仅启动 Vite 前端开发服务器

# ─── 构建 ───
npm run build                     # 类型检查 + Vite 构建
npm run electron:build            # 完整 Electron 打包（图标 + 引擎 + electron-builder）
npm run electron:build:win        # 仅打包 Windows
npm run electron:build:mac        # 仅打包 macOS
npm run electron:build:linux      # 仅打包 Linux

# ─── 引擎 ───
cd engine && bun install          # 安装 CLI 引擎依赖
cd engine && bun run build-desktop.ts  # 构建桌面版引擎

# ─── 测试 ───
npm run test:electron             # Electron 主进程测试（Node test runner）
npx vitest run                     # Vue 组件与 composable 测试
npx vitest run --reporter=verbose # 详细测试输出

# ─── 其他 ───
npm run typecheck                 # 仅类型检查
npm run changelog                 # 生成 CHANGELOG
```

### 打包产物

| 平台 | 产物格式 |
|------|----------|
| **Windows** | NSIS 安装包（`.exe`）+ 便携版 |
| **macOS** | DMG + ZIP |
| **Linux** | AppImage + DEB |

### 代码规范

- TypeScript 严格模式，`@/` 路径别名映射到 `src/`
- Vue SFC 使用 `<script setup lang="ts">` + scoped SCSS
- 组件文件名 PascalCase，composables 使用 `use` 前缀，stores 使用驼峰命名
- 遵循 Conventional Commits 规范（feat/fix/style/refactor 等前缀）
- IPC 通信遵循 preload context bridge 安全模式

---

## 技术栈

### 桌面应用（根目录）

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
| **mermaid** | 11.x | 图表渲染 |
| **electron-builder** | 24.x | 应用打包工具 |
| **electron-updater** | 6.x | 自动更新 |

### CLI 引擎（`engine/`）

| 技术 | 版本 | 用途 |
|------|------|------|
| **Bun** | >= 2.0.0 | JavaScript 运行时、包管理器、构建工具 |
| **TypeScript** | 6.x | 类型安全 |
| **React** | 19.x | 终端 UI 渲染（配合 Ink） |
| **Commander.js** | 14.x | CLI 参数解析 |
| **@anthropic-ai/sdk** | - | Anthropic API 客户端 |
| **OpenAI SDK** | - | OpenAI 兼容接口适配 |
| **MCP SDK** | - | Model Context Protocol 实现 |

### 移动端（`mobile-app/`）

| 技术 | 用途 |
|------|------|
| **Flutter** | 跨平台移动端框架 |
| **WebSocket** | 桌面端通信协议 |

---

## 平台支持

| 平台 | 状态 | 说明 |
|------|------|------|
| ✅ Windows | 完整支持 | NSIS 安装包 + 便携版，支持 x64 |
| ✅ macOS | 完整支持 | DMG + ZIP，Intel & Apple Silicon |
| ✅ Linux | 完整支持 | AppImage + DEB |

---

## 相关文档

- [更新日志](./CHANGELOG.md) — 版本迭代记录
- [发布说明](./release-notes/) — 各版本发布亮点
- [设计文档](./docs/superpowers/) — 架构设计与功能规划
- [贡献指南](./CONTRIBUTING.md) — 如何参与开发
- [安全说明](./SECURITY.md) — 安全策略与漏洞报告

---

## 许可证

详见 [LICENSE](./LICENSE) 文件。

---

<div align="center">

**项目主页**: https://github.com/hjdspace/SpaceCode  
**问题反馈**: https://github.com/hjdspace/SpaceCode/issues  
**发布版本**: https://github.com/hjdspace/SpaceCode/releases

</div>
