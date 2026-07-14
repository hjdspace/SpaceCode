# electronAPI.ts 按领域拆分为 thin aggregator + namespace 模块

## Context

`src/services/electronAPI.ts` 是渲染进程访问 Electron 主进程 IPC 桥接的统一入口，原本是一个 1265 行的巨型文件，包含：

- ~326 行类型定义（20+ 个 interface/type，被 `src/types/electron.d.ts` 和众多组件消费）
- H5 远程访问模式的适配器初始化逻辑
- ~50 个扁平方法（`sendMessage`、`readDir`、`readFile` 等，直接委托到 `window.electronAPI`）
- ~20 个嵌套命名空间对象（`git`、`terminal`、`mcp`、`skills`、`browserUse` 等，每个含 5-20 个方法）
- 3 个 getter（`claudeCode`、`image`、`logger`）提供对子 IPC 桥接的直接访问

架构审查（`improve-codebase-architecture` skill）将其识别为 #4 深化候选：单个文件承担了过多不相关的领域职责，难以独立测试和维护。任何想修改 git 命名空间的开发者都需要在一个 1200+ 行的文件中定位和编辑，且无法单独 import git 相关逻辑。

## Decision

将 `electronAPI.ts` 拆分为 thin aggregator + 21 个按领域拆分的 namespace 模块：

### 目录结构

```
src/services/
├── electronAPI.ts          # thin aggregator（类型定义 + 扁平方法 + 组合导入）
├── api/
│   ├── _context.ts         # 共享运行时状态（electronAPI、_isH5Mode、h5Adapter）
│   ├── agents.ts           # Agent 库/工作流管理（10 方法）
│   ├── artifacts.ts        # 产物列表/监视（6 方法）
│   ├── app.ts              # 应用路径（1 方法）
│   ├── browserUse.ts       # 浏览器自动化（10 方法）
│   ├── changelog.ts        # Release notes（1 方法）
│   ├── computerUse.ts      # cua-driver 管理（8 方法）
│   ├── cron.ts             # 定时任务（10 方法）
│   ├── debug.ts            # 调试文件/trace 会话（4 方法）
│   ├── design.ts           # 设计系统（10 方法）
│   ├── git.ts              # Git/SCM 操作（25 方法）
│   ├── h5Access.ts         # H5 远程访问控制（7 方法）
│   ├── mcp.ts              # MCP 服务器管理（13 方法）
│   ├── mobile.ts           # 移动端同步服务器（5 方法）
│   ├── officecli.ts        # Office 文档处理（10 方法）
│   ├── rtk.ts              # Rust Token Killer（8 方法）
│   ├── session.ts          # 轮次检查点/回退（4 方法）
│   ├── shell.ts            # 外部链接打开（1 方法）
│   ├── skills.ts           # 技能市场/本地库（16 方法）
│   ├── terminal.ts         # 终端会话管理（7 方法）
│   ├── trace.ts            # Trace 采集/查询（7 方法）
│   └── update.ts           # 自动更新（7 方法）
```

### 设计模式

1. **共享上下文模块**（`_context.ts`）：所有 namespace 文件通过 `import { electronAPI } from './_context'` 获取 `window.electronAPI` 引用。H5 适配器初始化（`initH5Connection()` + `createH5Adapter()`）也在此处集中执行，避免在 21 个文件中重复。

2. **`import type` 避免循环依赖**：namespace 文件使用 `import type { GitStatus } from '../electronAPI'` 导入类型定义——TypeScript 在编译时擦除类型导入，因此运行时不存在 `api/git.ts → electronAPI.ts → api/git.ts` 的循环依赖。`electronAPI.ts` 导入 namespace 对象的值（`import { git } from './api/git'`），而 namespace 文件只导入类型。

3. **Thin aggregator 组合**：`electronAPI.ts` 保留类型定义（单一真相源）和扁平方法（无子命名空间的方法），通过对象字面量 spread 组合 21 个 namespace 对象到 `api` 导出：
   ```typescript
   export const api = {
     // 扁平方法
     sendMessage, readDir, readFile, ...
     // 命名空间对象
     agents, artifacts, browserUse, changelog, ...
     // getter
     get claudeCode() { ... },
     get image() { ... },
     get logger() { ... },
   }
   ```

4. **H5 三路回退保留**：少数扁平方法（`readDir`、`readFile`、`stat`、`searchFiles`、`httpFetch`）需要三路回退（`electronAPI?.method → h5ApiClient.method → Promise.resolve(default)`），这些方法保留在 aggregator 中以访问 `_isH5Mode` 和 `h5ApiClient`。

## Rationale

- **可维护性**：每个 namespace 文件 < 100 行，开发者可以在一个屏幕内理解整个领域的 API 表面。
- **可测试性**：namespace 模块是纯函数集合（只依赖 `electronAPI` 引用），可以独立 mock 和测试。
- **类型安全**：所有类型定义集中在 `electronAPI.ts`，`src/types/electron.d.ts` 和组件文件的导入路径不变，无需修改消费方。
- **行为不变**：每个 namespace 方法的实现与原内联版本完全一致（相同的 null-check 转发模式、相同的默认值），零行为变更。

## Consequences

- `electronAPI.ts` 从 1265 行降至 683 行（46% 减少），其中 326 行是类型定义、357 行是扁平方法和 aggregator 组合。
- 新增 22 个文件（21 个 namespace + 1 个 _context），但每个文件职责单一、易于定位。
- 消费方代码（`import { api } from '@/services/electronAPI'`）无需任何修改。
- 后续新增领域只需在 `api/` 下创建新文件并在 aggregator 中 import + spread，无需修改现有 namespace。
