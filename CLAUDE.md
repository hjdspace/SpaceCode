# CLAUDE.md

This file provides guidance to SpaceCode when working with code in this repository.

## Tech Stack

- **Frontend**: Vue 3 + TypeScript + Vite 5
- **Desktop**: Electron 29 (main process: `electron/`, renderer: `src/`)
- **State**: Pinia stores in `src/stores/`
- **Styling**: Sass (`.scss`), scoped styles in Vue SFC
- **Engine**: Bun runtime in `engine/` (CLI sub-project)
- **AI SDK**: `@anthropic-ai/sdk`, `openai`

## Commands

```bash
npm run dev              # Start Vite dev server
npm run build            # Type-check + Vite build
npm run typecheck        # vue-tsc type checking only
npm run preview          # Vite preview
npm run electron:dev     # Electron dev mode (via Vite)
npm run electron:build   # Full Electron build (icons + engine + electron-builder)

npm run test:electron              # Node test runner (Electron unit tests)
npx vitest run                     # Vitest (Vue composables + Electron tests)
npx vitest run --reporter=verbose  # Verbose vitest output

cd engine && bun install           # Engine deps
cd engine && bun run build-desktop.ts  # Build engine
```

## Project Structure

```
SpaceCode/
├── src/                    # Vue 3 渲染进程
│   ├── components/         # Vue SFC 组件
│   │   ├── chat/           # 聊天/对话相关组件
│   │   ├── layout/         # 分栏布局、标题栏、侧边栏
│   │   ├── common/         # 通用 UI 组件
│   │   ├── explorer/       # 文件浏览器
│   │   ├── scm/            # Git 源码管理
│   │   ├── settings/       # 设置面板
│   │   ├── terminal/       # 终端组件
│   │   ├── agents/         # Agent 管理
│   │   ├── mcp/            # MCP 配置
│   │   └── skills/         # 技能管理
│   ├── stores/             # Pinia stores (chatSession, chatStream, app, settings, mcp, scm...)
│   ├── composables/        # Vue composable functions (useChat, useContentEditor, ...)
│   ├── services/           # LLM 客户端、API 服务
│   ├── lib/                # 业务逻辑库
│   ├── styles/             # 全局样式 (variables, themes)
│   ├── types/              # TypeScript 类型定义
│   ├── utils/              # 工具函数
│   ├── i18n/               # 国际化
│   └── App.vue             # 根组件（三栏布局）
│
├── electron/               # Electron 主进程
│   ├── main.ts             # 主进程入口
│   ├── preload.ts          # Context Bridge (安全 IPC API 暴露)
│   ├── claudeCodeIPC.ts    # Claude Code CLI 进程 IPC
│   ├── sessionProcess.ts   # Chat session 进程管理
│   ├── skillsService.ts    # 技能管理服务
│   └── gitService.ts       # Git 操作服务
│
├── engine/                 # CLI 核心引擎 (Bun, 独立子项目)
├── tests/                  # Python 集成测试 (pytest)
├── vite.config.mts         # Vite 配置
└── vitest.config.ts        # Vitest 配置
```

## Key Architecture

- **三栏布局**: Sidebar（左侧导航）→ ChatPanel（中间主聊天区）→ InfoPanel（右侧信息面板），通过 `splitLayout` store 管理面板宽度
- **Chat Session 生命周期**: `chatSession` store 管理会话列表 → `sessionProcess` (Electron) 管理 Claude Code CLI 子进程 → `chatStream` store 处理流式响应
- **IPC 通信**: Electron main ↔ renderer 通过 preload.ts 的 contextBridge 暴露安全 API
- **Pinia stores** 集中在 `src/stores/`，按功能模块拆分（chat, app, settings, mcp, scm, terminal 等）
- **Vue 组件** 遵循组合式 API (`<script setup lang="ts">`)，样式使用 scoped SCSS

## Code Style

- TypeScript 严格模式，`@/` 路径别名映射到 `src/`
- 组件文件名使用 PascalCase（如 `ChatPanel.vue`），composables 使用 `use` 前缀（`useChat.ts`），stores 使用驼峰（`chatSession.ts`）
- Vue SFC 使用 `<script setup lang="ts">` + scoped SCSS 样式
- 遵循 Conventional Commits 规范（feat/fix/style/refactor 等前缀）
- npm scripts 定义在 `package.json`，engine 子项目使用 Bun

## Test Conventions

- Electron 主进程测试：`electron/__tests__/*.test.ts`（Node test runner: `node --test`）
- Vue composables 测试：`tests/composables/*.test.ts`（vitest）
- Component 测试：`tests/components/`（vitest）
- Python 集成测试：`tests/*.py`（pytest）
- 构建验证：修改后运行 `npm run build` 确保通过

## Rules
- 原型HTML UI在docs/prototypes目录生成
- 所有实现需要考虑i18n国际化

## 禁止事项

- 不要修改 `engine/` 目录下的代码（独立的 CLI 子项目）
- 不要直接修改 `dist/`、`dist-electron/`、`release/` 等构建产物
- 不要提交 `.env` 等敏感文件
- 不要使用 `any` 类型，优先使用精确的类型定义
- 不要添加未请求的额外功能、抽象、配置项或错误处理
