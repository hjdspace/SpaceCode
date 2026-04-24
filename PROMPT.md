# AI Agent Desktop Application - 开发提示词

## 项目概述
基于现有的 TypeScript AI Agent CLI 代码，开发一个 Electron + Vue 3 + Vite 桌面应用程序。

## 现有代码位置
- **CLI 代码**: d:\AI\claude-code-python\claude-code
- **核心源码**: d:\AI\claude-code-python\claude-code\src
- **CLI 入口**: d:\AI\claude-code-python\claude-code\src\main.tsx
- **CLI 查询引擎**: d:\AI\claude-code-python\claude-code\src\QueryEngine.ts
- **CLI REPL 启动器**: d:\AI\claude-code-python\claude-code\src\replLauncher.tsx

## 技术栈
- **前端框架**: Vue 3 (Composition API) + Vite 3
- **桌面框架**: Electron (latest)
- **语言**: TypeScript
- **构建工具**: electron-builder
- **样式**: SCSS + CSS Variables (现代化桌面应用风格)

## UI 设计规范

### 设计风格
- **整体风格**: 现代化桌面应用，参考 VSCode + Codex Desktop + Linear 的设计语言
- **窗口模型**: 原生窗口边框 + 自定义内容区
- **主题系统**: 支持深色/浅色主题，使用 CSS Variables 实现
- **动效**: 简洁克制，参考 VSCode 的动画风格 (150-200ms)

### 色彩系统
\\\scss
// 浅色主题
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f3f3f3;
  --bg-tertiary: #e8e8e8;
  --bg-hover: #e5e5e5;
  --text-primary: #333333;
  --text-secondary: #666666;
  --text-muted: #999999;
  --border-color: #d4d4d4;
  --accent-color: #0066cc;
  --accent-hover: #0052a3;
  --success: #28a745;
  --warning: #ffc107;
  --error: #dc3545;
}

// 深色主题
[data-theme='dark'] {
  --bg-primary: #1e1e1e;
  --bg-secondary: #252526;
  --bg-tertiary: #2d2d2d;
  --bg-hover: #3c3c3c;
  --text-primary: #cccccc;
  --text-secondary: #858585;
  --text-muted: #6e6e6e;
  --border-color: #404040;
  --accent-color: #4da6ff;
  --accent-hover: #66b3ff;
}
\\\

### 字体系统
\\\scss
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', 'Consolas', monospace;
  --font-size-xs: 11px;
  --font-size-sm: 12px;
  --font-size-base: 13px;
  --font-size-lg: 14px;
  --font-size-xl: 16px;
  --line-height-tight: 1.3;
  --line-height-normal: 1.5;
}
\\\

### 间距系统
\\\scss
:root {
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-xxl: 32px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}
\\\

### 组件样式指南
- **按钮**: 圆角 6px，padding 8px 16px，hover 时轻微变亮/变暗
- **输入框**: 圆角 6px，border 1px solid，focus 时 accent color 边框
- **面板**: 圆角 8px，subtle shadow (0 2px 8px rgba(0,0,0,0.1))
- **图标**: 16x16 或 20x20，使用 Lucide Icons 或 Heroicons
- **滚动条**: 细窄风格，8px 宽，hover 时显示

## CLI 核心架构解析

### 1. 入口流程 (main.tsx)
\\\
main.tsx 
   初始化配置 (init())
   启动 REPL (launchRepl)
   渲染 App + REPL 组件
\\\

### 2. 核心模块依赖关系
\\\
main.tsx
 init()                    # 初始化 telemetry、认证、配置
 launchRepl()              # 启动 REPL 界面
    App.tsx              # 根组件
    REPL.tsx            # REPL 屏幕组件
        AppStateStore   # 应用状态管理
        QueryEngine.ts  # 查询引擎 (核心编排)
            query.ts    # 查询执行逻辑
               构建消息
               调用 API
               处理工具执行
            toolOrchestration.ts  # 工具编排
 getTools()               # 获取可用工具
 getCommands()            # 获取 CLI 命令
 history.ts              # 会话历史管理
\\\

### 3. 关键模块说明

| 模块 | 文件路径 | 功能说明 |
|------|----------|----------|
| **入口** | src/main.tsx | CLI 主入口，处理初始化、认证、启动 |
| **REPL** | src/replLauncher.tsx | 启动 REPL 界面的工厂函数 |
| **屏幕** | src/screens/REPL.tsx | REPL 交互界面组件 |
| **查询引擎** | src/QueryEngine.ts | SDK 用的查询引擎封装 |
| **查询执行** | src/query.ts | 核心查询逻辑，消息构建/API调用/工具执行 |
| **工具编排** | src/services/tools/toolOrchestration.ts | 工具执行编排 |
| **状态管理** | src/state/AppStateStore.ts | 应用状态 (Zustand store) |
| **消息类型** | src/types/message.ts | 消息类型定义 |
| **工具定义** | src/Tool.ts | 工具接口定义 |
| **历史记录** | src/history.ts | 会话历史管理 |

### 4. 与 CLI 集成的关键入口

#### 方式 A: 直接模块集成 (推荐)
\\\	ypescript
// 在 Electron 主进程中
import { init } from './entrypoints/init.js';
import { launchRepl } from './replLauncher.js';
import { createStore } from './state/store.js';
import { getDefaultAppState } from './state/AppStateStore.js';
import { query } from './query.js';
import type { Message } from './types/message.js';

// 初始化
await init(options);

// 创建状态
const store = createStore();
const appState = getDefaultAppState();

// 获取 REPL props
const replProps = { /* ... */ };

// 启动 REPL
await launchRepl(root, appProps, replProps, renderAndRun);
\\\

#### 方式 B: IPC 通信 (进程分离)
\\\	ypescript
// 主进程: 创建 CLI 子进程
const cliProcess = spawn('node', ['cli.js'], {
  cwd: cliPath,
  stdio: ['pipe', 'pipe', 'pipe']
});

// 通过 stdin/stdout 通信
cliProcess.stdin.write(JSON.stringify({ type: 'user_message', content: '...' }));
cliProcess.stdout.on('data', (data) => handleMessage(JSON.parse(data)));
\\\

---

## UI 布局要求 (三栏布局，类似 VSCode + Codex Desktop)

### 1. 左侧边栏 (可折叠/展开)
- **折叠状态**: 显示图标缩略图模式 (类似 VSCode 活动栏，48px 宽)
- **展开状态**: 显示完整历史会话列表和文件树 (280px 宽)
- **功能**:
  - 历史会话列表 (可搜索、筛选)
  - 文件树浏览器 (与 AI Agent 工作目录同步)
  - 可拖拽调整宽度
  - 折叠/展开动画 (200ms ease)

### 2. 中间聊天区域 (Codex Desktop 风格)
- **核心功能**:
  - 类似 Claude Code CLI 的消息渲染
  - Markdown 渲染支持
  - 代码高亮 (使用 marked + syntax highlighter)
  - 消息输入框 (支持多行、快捷键)
  - 流式响应渲染
  - 消息时间戳显示
  - 工具使用进度指示器
- **布局**: 标题区 + 消息列表 + 输入区
- **参考组件**:
  - src/components/Message.tsx - 单条消息渲染逻辑
  - src/components/Markdown.tsx - Markdown 渲染逻辑 (复用其 marked 配置)

### 3. 右侧信息面板 (默认隐藏)
- **触发条件**:
  - AI Agent 修改代码时  自动展示代码 Diff
  - 用户选择文件时  展示选中文件内容
  - 用户选择 Markdown 文档时  渲染并展示 Markdown
- **功能模式**:
  - **Diff 模式**: 双栏 Diff 展示 (参考 src/commands/diff/diff.tsx 的逻辑)
  - **文件查看模式**: 带语法高亮的代码阅读器
  - **Markdown 渲染模式**: 渲染后的 Markdown 文档
- **交互**: 可拖拽调整宽度，点击切换模式，ESC 关闭

---

## 重要组件参考 (从 CLI 源码复用)

| 功能 | CLI 参考文件 | 桌面端实现提示 |
|------|-------------|----------------|
| 消息渲染逻辑 | src/components/Message.tsx | 复用其消息解析和渲染逻辑，样式重新设计 |
| Markdown 渲染 | src/components/Markdown.tsx | 直接复用 marked 配置和 token 处理逻辑 |
| Diff 逻辑 | src/commands/diff/diff.tsx, src/components/StructuredDiff.tsx | 复用 Diff 算法和 UI 布局逻辑 |
| 消息类型定义 | src/types/message.ts | 直接复用 TypeScript 类型 |
| 状态管理接口 | src/state/AppStateStore.ts | 参考其状态结构和更新模式，使用 Pinia 重写 |
| 会话历史接口 | src/history.ts | 直接复用历史记录CRUD接口 |

**注意**: CLI 的 Ink 组件 (src/ink/) 是终端 UI 渲染引擎，仅供理解消息渲染逻辑，不应复用其样式代码。

---

## IPC 通信设计

### Electron IPC 接口定义
\\\	ypescript
// preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  // 消息通信
  sendMessage: (text: string) => ipcRenderer.invoke('cli:sendMessage', text),
  onMessage: (callback: (msg: RenderableMessage) => void) => 
    ipcRenderer.on('cli:message', (_, msg) => callback(msg)),
  
  // 状态管理
  getAppState: () => ipcRenderer.invoke('cli:getAppState'),
  updateAppState: (state: Partial<AppState>) => 
    ipcRenderer.invoke('cli:updateAppState', state),
  
  // 文件操作
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string) => 
    ipcRenderer.invoke('fs:writeFile', path, content),
  
  // Diff 展示
  showDiff: (diff: DiffInfo) => ipcRenderer.send('ui:showDiff', diff),
  onDiffRequested: (callback: (diff: DiffInfo) => void) =>
    ipcRenderer.on('ui:showDiff', (_, diff) => callback(diff)),
  
  // 面板控制
  showInfoPanel: (mode: 'diff' | 'file' | 'markdown') => 
    ipcRenderer.send('ui:showInfoPanel', mode),
  hideInfoPanel: () => ipcRenderer.send('ui:hideInfoPanel'),
  
  // 工具执行回调
  onToolResult: (callback: (result: ToolResult) => void) =>
    ipcRenderer.on('cli:toolResult', (_, result) => callback(result)),
});
\\\

---

## 功能清单

### 必须实现
1.  Electron + Vue + Vite 项目脚手架
2.  三栏布局 (左侧边栏 + 中间聊天 + 右侧信息面板)
3.  左侧边栏折叠/展开 (带动画)
4.  聊天消息渲染 (复用 CLI 的 Markdown 和代码高亮)
5.  CLI 核心集成 (通过 IPC 或直接模块调用)
6.  文件树组件
7.  会话历史管理

### 重要功能
1.  Diff 展示 (AI 修改代码时自动弹出)
2.  文件查看器 (选择文件时展示)
3.  Markdown 渲染器
4.  主题切换 (深色/浅色)
5.  快捷键支持 (参考 src/keybindings/ 的功能实现)

### 优化功能
1.  流式响应优化
2.  虚拟滚动 (大消息列表)
3.  性能监控

---

## 代码风格
- 使用 Vue 3 Composition API + script setup 语法
- TypeScript 严格模式
- 组件文件使用 .vue，单文件组件
- 样式使用 SCSS + CSS Variables (不要复用 Ink 终端样式)
- 不要添加不必要的注释 (除非复杂逻辑)
- 遵循现有 CLI 代码的命名约定

---

## 项目结构建议
\\\
electron-desktop/
 electron/
    main.ts           # Electron 主进程
    preload.ts        # 预加载脚本
    ipc/              # IPC 处理器
 src/
    App.vue            # 根组件
    components/
       layout/        # 布局组件
          Sidebar.vue
          ChatPanel.vue
          InfoPanel.vue
       chat/          # 聊天相关组件
          MessageList.vue
          MessageItem.vue
          MarkdownRenderer.vue
          ChatInput.vue
       explorer/      # 文件浏览器
          FileTree.vue
          FileTreeNode.vue
       common/        # 通用组件
          DiffViewer.vue
          CodeViewer.vue
    composables/       # Vue Composables
       useCli.ts      # CLI 集成
       useMessages.ts
       useFileTree.ts
    stores/            # 状态管理 (Pinia)
       app.ts
       chat.ts
    styles/            # 全局样式
       _variables.scss
       _mixins.scss
       global.scss
    utils/             # 工具函数
 package.json
 vite.config.ts
 electron-builder.json
 tsconfig.json
\\\

---

## 输出要求
请生成完整的、可运行的项目代码，包括：
1. 所有配置文件 (package.json, vite.config.ts, tsconfig.json, electron-builder.json)
2. Electron 主进程和预加载脚本
3. Vue 组件实现
4. 与 CLI 集成的 IPC 通信层
5. 样式文件 (使用现代化的桌面应用风格，不要 Ink 终端样式)

---

## 提示
- CLI 源码复用策略: 复用业务逻辑和渲染算法，不复用 Ink 的终端 UI 样式
- CLI 使用 Ink (React) 渲染引擎，其样式仅适用于终端；桌面端需要重新设计现代化 UI
- Markdown 渲染可直接复用 src/components/Markdown.tsx 的 marked 配置
- Diff 查看器复用 src/commands/diff/diff.tsx 的 Diff 算法逻辑
- 会话历史使用 src/history.ts 中的接口
- UI 风格参考: VSCode, Codex Desktop, Linear
