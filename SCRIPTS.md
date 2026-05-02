# Scripts 命令参考指南

> 本文档详细说明 SpaceCode 项目中所有可用的 npm/bun 脚本命令，包括开发、构建、测试、部署等关键流程。

## 目录

- [Desktop 应用脚本（根目录）](#desktop-应用脚本根目录)
- [CLI 引擎脚本（engine/）](#cli-引擎脚本engine)
- [技术栈总览](#技术栈总览)
- [常用开发流程](#常用开发流程)

---

## Desktop 应用脚本（根目录）

### 开发相关

| 命令 | 说明 | 使用场景 |
|------|------|----------|
| `npm run dev` | 启动 Vite 开发服务器 | 前端单独开发调试（不含 Electron） |
| `npm run electron:dev` | 启动 Electron + Vite 完整开发环境 | Desktop 应用全栈开发（推荐） |

**`electron:dev` 工作流程**：
1. 启动 Vite 前端 dev server（端口 5173，支持 HMR 热更新）
2. 启动 Electron 主进程（加载 `electron/main.ts`）
3. 建立 IPC 通信桥接层（通过 `preload.ts`）
4. 自动打开应用窗口

### 构建相关

| 命令 | 说明 | 输出产物 | 使用场景 |
|------|------|----------|----------|
| `npm run build` | TypeScript 类型检查 + Vite 构建 | `dist/` 目录 | 生产环境打包前的必要步骤 |
| `npm run preview` | 预览构建产物 | 本地服务器 | 验证构建结果是否正常 |
| `npm run electron:build` | 完整的 Electron 应用打包 | `release/` 目录 | 发布安装包、分发应用 |

**`electron:build` 详细流程**：
```bash
# 1. 执行 build（类型检查 + Vite 构建）
# 2. 调用 electron-builder 打包
#    - Windows: NSIS 安装包 + Portable 便携版
#    - macOS: DMG 磁盘镜像 + ZIP 压缩包
#    - Linux: AppImage + DEB + RPM
# 3. 输出到 release/ 目录
```

### 代码质量

| 命令 | 说明 | 使用场景 |
|------|------|----------|
| `npm run typecheck` | Vue TypeScript 类型检查（不生成输出） | CI 流水线、提交前验证 |

### 版本管理

| 命令 | 说明 | 使用场景 |
|------|------|----------|
| `npm run changelog` | 根据 Git 提交记录生成更新日志（仅最新版本） | 版本发布时自动更新 CHANGELOG.md |
| `npm run changelog:all` | 生成完整的更新日志（包含所有历史版本） | 首次初始化或重建日志 |
| `npm run version` | 执行 changelog 并暂存文件 | 配合 `npm version` 使用 |
| `postversion` (钩子) | 自动推送到远程仓库（代码 + 标签） | 发布后自动触发 |

**Changelog 生成规范**：
- 基于 Conventional Commits 规范（feat/fix/docs/refactor 等）
- 输出格式遵循 Keep a Changelog 标准
- 自动分类：Features / Bug Fixes / Documentation / etc.

---

## CLI 引擎脚本（engine/）

### 开发相关

| 命令 | 说明 | 使用场景 |
|------|------|----------|
| `bun run dev` | 启动 Bun 开发模式（热重载） | CLI 功能开发、调试交互逻辑 |
| `bun run dev:inspect` | 启动带 Inspector 的开发模式 | 性能分析、断点调试 |

**`dev` 工作流程**：
1. 加载 `scripts/dev.ts` 入口
2. 启动 Bun 文件监听器（chokidar）
3. 源码变更时自动重新编译
4. 在终端中启动 REPL 交互界面

### 构建相关

| 命令 | 说明 | 输出产物 | 使用场景 |
|------|------|----------|----------|
| `bun run build` | 执行自定义构建脚本（`build.ts`） | `dist/cli.js` + ~450 chunks | 生产环境部署、发布到 npm |
| `prepublishOnly` (钩子) | 发布到 npm 前自动构建 | 同上 | 确保 npm 包包含最新代码 |

**Build 特性**：
- 使用 Bun 原生 bundler（非 esbuild/webpack）
- 代码分割：~450 个 chunk，优化加载性能
- Tree-shaking：移除未使用的代码
- Source Map 支持：便于调试生产问题

### 代码质量

| 命令 | 说明 | 使用场景 |
|------|------|----------|
| `bun run lint` | Biome Lint 检查 | CI 流水线、提交前验证 |
| `bun run lint:fix` | Biome Lint 自动修复 | 快速修复常见问题 |
| `bun run format` | Biome 格式化（写入模式） | 统一代码风格 |

**Biome 配置**（`biome.json`）：
- 替代 ESLint + Prettier 组合
- 更快的执行速度（Rust 编写）
- 内置 import sorting、unused imports 检测等

### 测试相关

| 命令 | 说明 | 使用场景 |
|------|------|----------|
| `bun test` | 运行全部测试用例 | CI 流水线、本地验证 |
| （无独立 test script，直接使用 bun test） | | |

**测试框架**：Bun 内置测试 runner
- 无需额外安装 Jest/Vitest
- 支持 describe/test/expect 语法
- 内置 mock/spy 功能
- 并行执行提升速度

### 维护工具

| 命令 | 说明 | 使用场景 |
|------|------|----------|
| `bun run health` | 运行健康检查脚本 | 排查环境问题、依赖冲突 |
| `bun run check:unused` | Knip 未使用依赖检测 | 清理冗余依赖、减小包体积 |
| `bun run rcs` | 运行 RCS 脚本（Release Candidate Check） | 发布前最终验证 |
| `bun run prepare` | 配置 Git hooks 路径 | 初始化开发环境（首次克隆后） |
| `bun run postinstall` | 安装后处理脚本（下载 ripgrep 二进制） | 依赖安装后自动执行 |
| `bun run docs:dev` | 启动 Mintlify 文档开发服务器 | 编写/预览 API 文档 |

**Git Hooks 配置**：
```
.githooks/
└── pre-commit    # 提交前自动运行 lint + format
```

---

## 技术栈总览

### 前端框架与库

| 类别 | 技术 | 版本 | 应用位置 | 用途 |
|------|------|------|----------|------|
| **桌面框架** | Electron | 29.x | 根目录 | 跨平台桌面应用壳 |
| **前端框架** | Vue 3 | 3.4.x | 根目录/src | 渲染进程 UI |
| **终端 UI** | React + Ink | workspace:* | engine/src | CLI 交互式界面 |
| **构建工具** | Vite | 5.x | 根目录 | 前端快速构建 |
| **构建工具** | Bun Bundler | 内置 | engine/ | CLI 高效打包 |
| **语言** | TypeScript | 5.x / 6.x | 全局 | 类型安全 |

### 后端服务与运行时

| 类别 | 技术 | 版本 | 应用位置 | 用途 |
|------|------|------|----------|------|
| **运行时** | Bun | >= 1.2.0 | engine/ | JavaScript 运行时 |
| **运行时** | Node.js | >= 18 | 根目录 | Electron 依赖 |
| **终端模拟** | xterm.js | 6.x | 根目录 | 终端渲染引擎 |
| **伪终端** | node-pty | 1.x | 根目录 | PTY 进程管理 |

### 数据存储与缓存

| 类别 | 技术 | 版本 | 应用位置 | 用途 |
|------|------|------|----------|------|
| **文件系统缓存** | cacache | 20.x | engine/ | 高效内容寻址缓存 |
| **内存缓存** | lru-cache | 11.x | engine/ | LRU 缓存策略 |
| **状态管理** | Pinia | 2.x | 根目录/src | Vue 全局状态 |
| **状态管理** | Zustand | - | engine/src | React 终端状态 |

### AI 与 API 服务

| 类别 | 技术 | 版本 | 应用位置 | 用途 |
|------|------|------|----------|------|
| **Anthropic SDK** | @anthropic-ai/sdk | 0.27.x / 0.80.x | 全局 | Claude API 客户端 |
| **OpenAI SDK** | openai | 4.x / 6.x | 全局 | OpenAI 兼容接口 |
| **MCP SDK** | @modelcontextprotocol/sdk | 1.29.x | engine/ | Model Context Protocol |
| **AWS SDK** | @aws-sdk/* | 3.x | engine/ | Bedrock 服务接入 |
| **Google Auth** | google-auth-library | 10.x | engine/ | Vertex AI 认证 |

### UI 渲染与样式

| 类别 | 技术 | 版本 | 应用位置 | 用途 |
|------|------|------|----------|------|
| **Markdown** | marked | 12.x / 17.x | 全局 | Markdown → HTML |
| **语法高亮** | highlight.js | 11.x | 全局 | 代码块着色 |
| **图标库** | lucide-vue-next | 0.344.x | 根目录 | SVG 图标组件 |
| **CSS 预处理** | Sass (SCSS) | 1.7.x | 根目录 | 样式编写 |
| **差异对比** | diff | 5.x / 8.x | 全局 | 文本 Diff 算法 |

### 开发工具链

| 类别 | 技术 | 版本 | 应用位置 | 用途 |
|------|------|------|----------|------|
| **Linter** | Biome | 2.x | engine/ | 代码质量检查 |
| **类型检查** | vue-tsc | 2.x | 根目录 | Vue TypeScript 检查 |
| **未使用检测** | knip | 6.x | engine/ | 依赖清理 |
| **打包工具** | electron-builder | 24.x | 根目录 | 应用分发打包 |
| **日志管理** | conventional-changelog-cli | 5.x | 根目录 | 自动生成 Changelog |

### 测试与监控

| 类别 | 技术 | 版本 | 应用位置 | 用途 |
|------|------|------|----------|------|
| **测试运行器** | Bun Test | 内置 | engine/ | 单元/集成测试 |
| **遥测追踪** | Langfuse | 5.x | engine/ | LLM 调用追踪 |
| **OpenTelemetry** | @opentelemetry/* | 2.x | engine/ | 可观测性平台 |
| **错误监控** | Sentry | 10.x | engine/ | 异常捕获与告警 |

---

## 常用开发流程

### 场景一：首次设置开发环境

```bash
# 1. 克隆仓库
git clone https://github.com/hjdspace/claude-code-gui.git
cd claude-code-gui

# 2. 安装 Desktop 依赖
npm install

# 3. 安装 CLI 引擎依赖
cd engine && bun install && cd ..

# 4. 初始化 Git hooks
cd engine && bun run prepare && cd ..

# 5. 验证环境健康
cd engine && bun run health && cd ..
```

### 场景二：日常开发循环

```bash
# Terminal 1: 启动 CLI 开发模式
cd engine
bun run dev

# Terminal 2: 启动 Desktop 开发模式（另一个终端窗口）
cd ..
npm run electron:dev
```

### 场景三：提交前检查

```bash
# CLI 引擎
cd engine
bun run lint          # Lint 检查
bun run format        # 格式化代码
bun test              # 运行测试
cd ..

# Desktop 应用
npm run typecheck     # TypeScript 类型检查
```

### 场景四：构建发布版本

```bash
# 1. 构建 CLI
cd engine
bun run build
cd ..

# 2. 构建 Desktop
npm run build

# 3. 打包 Electron 应用
npm run electron:build

# 4. 产物位于 release/ 目录
ls release/
```

### 场景五：版本发布流程

```bash
# 1. 确保所有更改已提交
git status

# 2. 更新版本号（会触发 changelog 生成 + git push）
npm version patch   # 或 minor / major

# 3. 自动执行的流程：
#    - npm run changelog（生成更新日志）
#    - git add CHANGELOG.md（暂存日志）
#    - git push（推送代码）
#    - git push --tags（推送标签）
```

### 场景六：排查问题

```bash
# 检查依赖完整性
cd engine
bun run health

# 检查未使用的依赖
bun run check:unused

# 启用详细日志
DEBUG=* bun run dev

# Inspector 调试
bun run dev:inspect
# 然后在 Chrome DevTools 中打开 chrome://inspect
```

---

## 命令速查卡

### Desktop（根目录）

```bash
npm run dev             # 开发模式（纯前端）
npm run electron:dev    # 开发模式（完整 Electron）
npm run build           # 构建生产版本
npm run preview         # 预览构建结果
npm run electron:build  # 打包安装包
npm run typecheck       # TypeScript 检查
npm run changelog       # 生成更新日志
```

### CLI Engine（engine/）

```bash
bun run dev             # 开发模式
bun run dev:inspect     # 调试模式
bun run build           # 构建生产版本
bun test                # 运行测试
bun run lint            # Lint 检查
bun run lint:fix        # 自动修复
bun run format          # 格式化代码
bun run health          # 健康检查
bun run check:unused    # 未使用依赖检测
```

---

**提示**：所有命令均可在 package.json 的 `scripts` 字段中找到定义。如需自定义命令，请编辑对应目录下的 `package.json` 文件。
