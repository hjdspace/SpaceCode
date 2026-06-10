# Cron 定时任务系统设计规格

## 概述

为 SpaceCode 桌面应用添加 Cron 定时任务管理系统，允许用户创建、管理、监控按计划自动执行的 AI 任务。系统完全在 Electron 主进程中独立实现，不修改 Engine 代码，兼容官方 claude-code。

## 需求

- 用户可创建定时任务，指定 cron 表达式和 AI 提示词
- 任务到时自动执行，在 CLI 子进程中运行 prompt
- 支持循环任务和一次性任务
- 支持启用/禁用任务而不删除
- 任务绑定到当前项目（项目级）
- 查看任务执行历史记录
- 手动触发任务立即执行
- 桌面通知告知任务执行结果

## 架构

```
渲染进程 (Vue 3)                    主进程 (Electron)
┌──────────────────┐               ┌──────────────────────────┐
│ CronManager.vue  │  IPC  cron:*  │ cronService.ts           │
│   ├─ TaskList    │◄─────────────►│   ├─ cronParser.ts       │
│   ├─ TaskRow     │               │   ├─ cronFileStore.ts    │
│   ├─ NewTaskModal│               │   ├─ cronScheduler.ts    │
│   ├─ RunsPanel   │               │   └─ taskRunLogger.ts    │
│   └─ EmptyState  │               │                          │
│ useCronStore     │               │ 执行: claudeCodeProcess  │
│ (Pinia)          │               │ Manager spawn CLI        │
└──────────────────┘               └──────────┬───────────────┘
                                              │ 读写
                                   ┌──────────▼───────────────┐
                                   │ <project>/.claude/        │
                                   │   scheduled_tasks.json    │
                                   │   scheduled_tasks_log.json│
                                   └──────────────────────────┘
```

### 关键设计决策

1. **不修改 Engine 代码** — cron 解析和调度逻辑在 Electron 主进程中独立实现，确保官方 claude-code 兼容
2. **文件格式兼容** — 读取时兼容 Engine 的 `scheduled_tasks.json` 格式，写入时保留 Engine 字段不破坏
3. **项目级任务** — 任务存储在 `<project>/.claude/scheduled_tasks.json`，切换项目时重新加载
4. **独立调度器** — 主进程 60s 轮询，与 Engine 的 CLI 调度器互不干扰（通过 `lastFiredAt` 交叉去重）

## 数据模型

### CronTask

```typescript
interface CronTask {
  id: string              // 8位hex，crypto.randomUUID() 切片
  cron: string            // 5字段cron表达式（本地时间）
  prompt: string          // 触发时执行的提示词
  createdAt: number       // 创建时间 epoch ms
  lastFiredAt?: number    // 最近触发时间 epoch ms
  recurring?: boolean     // true=循环, false/undefined=一次性
  permanent?: boolean     // 豁免自动过期
  name?: string           // 人类可读名称
  description?: string    // 任务描述
  enabled?: boolean       // 启用/禁用（默认 true）
  frequency?: string      // UI频率: hourly|daily|weekdays|weekly|monthly|custom
  scheduledTime?: string  // UI时间: "09:00"
}
```

磁盘格式：`<project>/.claude/scheduled_tasks.json`
```json
{ "tasks": [CronTask, ...] }
```

### TaskRun

```typescript
interface TaskRun {
  id: string
  taskId: string
  taskName: string
  startedAt: string       // ISO timestamp
  completedAt?: string    // ISO timestamp
  status: 'running' | 'completed' | 'failed' | 'timeout'
  prompt: string
  output?: string         // 截断的输出摘要
  error?: string
  durationMs?: number
  sessionId?: string
}
```

磁盘格式：`<project>/.claude/scheduled_tasks_log.json`
```json
{ "runs": [TaskRun, ...] }
```
每任务最多保留 100 条记录。

## 模块设计

### 1. cronParser.ts — Cron 表达式解析

独立实现，不依赖 Engine。

- `parseCronExpression(expr: string): CronFields` — 解析5字段cron
  - 支持: `*`, `N`, `*/N`（步进）, `N-M`（范围）, `N,M,...`（列表）
  - 不支持: `L`, `W`, `?`, 名称别名
  - `dayOfWeek` 字段 `7` 作为 `0`（周日）别名
- `computeNextCronRun(fields: CronFields, from: Date): Date` — 计算下次触发时间
  - 逐分钟前进，上限 366 天
  - dayOfMonth 和 dayOfWeek 都约束时取 OR 语义
- `cronMatches(cronExpr: string, date: Date): boolean` — 检查是否匹配
- `cronToHuman(cron: string): string` — 人类可读描述
- `isValidCron(cron: string): boolean` — 验证合法性
- `frequencyToCron(frequency: string, time?: string): string` — UI频率→cron
- `cronToFrequency(cron: string): string` — cron→UI频率（最佳努力）

### 2. cronFileStore.ts — 任务文件 CRUD

- `readCronTasks(projectRoot: string): Promise<CronTask[]>` — 读取+校验，无效cron静默跳过
- `writeCronTasks(tasks: CronTask[], projectRoot: string): Promise<void>` — 原子写入（先写 `.tmp` 再 `rename`）
- `addCronTask(task: Omit<CronTask, 'id' | 'createdAt'>, projectRoot: string): Promise<CronTask>`
- `updateCronTask(id: string, updates: Partial<CronTask>, projectRoot: string): Promise<void>`
- `deleteCronTask(id: string, projectRoot: string): Promise<void>`
- `updateLastFired(id: string, firedAt: number, projectRoot: string): Promise<void>`

### 3. cronScheduler.ts — 调度引擎

- 60s 间隔轮询
- 启动时清理僵尸 `running` 记录（超时 10 分钟 + 1 分钟缓冲 → 标记 failed）
- Tick 逻辑：
  1. 读取所有任务
  2. 跳过 `enabled === false` 的任务
  3. 跳过已在运行的任务（内存 Set 去重）
  4. 跳过同一分钟内已触发的任务（`minuteKey` 去重）
  5. 跳过其他进程已触发的任务（`lastFiredAt` 交叉去重）
  6. `cronMatches(task.cron, now)` → 匹配则执行
- 任务执行：
  1. 防止并发执行同一任务
  2. 立即更新 `lastFiredAt`（跨进程去重）
  3. 持久化 "running" 状态到日志文件
  4. 通过 `claudeCodeProcessManager` spawn CLI 子进程
  5. 通过 stdin 传入 JSON 格式的 prompt
  6. 收集 stdout，10 分钟超时
  7. 更新 TaskRun 状态
  8. 一次性任务执行后 `enabled = false`
- 生命周期：Electron app `ready` 时启动，`before-quit` 时停止
- 项目切换：监听项目路径变化，重新加载任务文件

### 4. taskRunLogger.ts — 执行记录

- `appendRun(run: TaskRun, projectRoot: string): Promise<void>`
- `updateRun(runId: string, updates: Partial<TaskRun>, projectRoot: string): Promise<void>`
- `getRecentRuns(projectRoot: string, limit?: number): Promise<TaskRun[]>`
- `getTaskRuns(taskId: string, projectRoot: string): Promise<TaskRun[]>`
- `trimRuns(taskId: string, projectRoot: string, maxRuns?: number): Promise<void>` — 默认 100 条
- `cleanupStaleRuns(projectRoot: string): Promise<void>` — 启动时清理

### 5. cronService.ts — IPC Handler

注册 IPC 通道，桥接渲染进程与后端服务。

| 通道 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `cron:list` | `{ projectRoot }` | `CronTask[]` | 获取任务列表 |
| `cron:create` | `{ projectRoot, task }` | `CronTask` | 创建任务 |
| `cron:update` | `{ projectRoot, id, updates }` | `void` | 更新任务 |
| `cron:delete` | `{ projectRoot, id }` | `void` | 删除任务 |
| `cron:run` | `{ projectRoot, id }` | `TaskRun` | 立即执行（创建新 session） |
| `cron:runs` | `{ projectRoot, limit? }` | `TaskRun[]` | 最近执行记录 |
| `cron:taskRuns` | `{ projectRoot, taskId }` | `TaskRun[]` | 指定任务记录 |
| `cron:validate` | `{ cron }` | `{ valid, error? }` | 验证cron |
| `cron:describe` | `{ cron }` | `string` | 人类可读描述 |
| `cron:onTaskFired` | 主→渲染推送 | `TaskRun` | 任务触发通知 |
| `cron:onRunCompleted` | 主→渲染推送 | `TaskRun` | 执行完成通知 |

## 前端

### 入口集成

1. **侧边栏** — 在 Debug/Trace 和 Settings 之间添加 Clock 图标按钮
2. **App.vue** — 添加 `<CronManager v-else-if="appStore.showCronManager" />`
3. **appStore** — 添加 `showCronManager` ref 和 `toggleCronManager()` 方法
4. **electronAPI.ts** — 添加 `cron.*` API 封装
5. **preload.ts** — 暴露 cron 相关 IPC 通道

### 组件结构

```
src/components/cron/
  CronManager.vue       — 主面板入口
  CronTaskList.vue      — 任务列表 + 统计卡片 + 筛选器
  CronTaskRow.vue       — 单任务行（状态/名称/频率/cron/操作按钮）
  NewCronTaskModal.vue  — 新建/编辑任务弹窗
  CronRunsPanel.vue     — 执行记录展开面板
  CronEmptyState.vue    — 空状态引导页

src/stores/cron.ts      — useCronStore (Pinia)

src/lib/
  cronDescribe.ts       — cron → 人类可读描述（渲染进程侧，轻量版）
  cronFrequency.ts      — UI 频率 ↔ cron 转换
```

### UI 布局

已通过 HTML 原型确认（`_temp/cron-ui-prototype.html`），包含：

- **统计卡片行**：全部 / 启用 / 禁用 / 一次性 四张卡片
- **任务列表**：每行含状态点、名称、类型标签、频率描述、cron表达式、下次触发时间、操作按钮（执行/记录/编辑/启禁/删除）
- **执行记录面板**：在任务行下方展开，显示历史执行记录（状态/时间/耗时/查看输出）
- **新建弹窗**：名称、描述、频率选择（6宫格）、时间选择、类型（循环/一次性）、提示词、cron预览
- **空状态页**：图标 + 引导文案 + 创建按钮 + 示例列表

### 主题适配

全部使用项目现有 CSS 变量，自动适配 4 套主题（light / dark / anthropic / anthropic-dark），无需额外主题代码。核心变量：

- 背景：`--bg-primary/secondary/tertiary/elevated`
- 文字：`--text-primary/secondary/muted/disabled`
- 强调：`--accent-primary`（teal/coral）
- 状态：`--success/warning/error`
- 边框：`--border-subtle/default/strong`
- 圆角：`--radius-sm/md/lg`
- 阴影：`--shadow-sm/md/lg`

### 桌面通知

任务执行完成后，通过 Electron `Notification` API 发送系统通知：
- 通知标题：任务名称
- 通知内容：执行结果（成功/失败 + 耗时）
- 通知点击：导航到定时任务面板，展开对应任务的执行记录

## 错误处理

- **cron 表达式无效**：创建/更新时验证，返回具体错误信息
- **文件读写失败**：静默降级，返回空列表；写入失败时日志记录
- **任务执行超时**：10 分钟超时，标记为 `timeout` 状态
- **CLI 子进程崩溃**：捕获 exit code，标记为 `failed`，记录 stderr
- **项目路径无效**：跳过该项目的调度，不阻塞其他项目
- **并发写入**：原子写入（tmp + rename）防止数据损坏

## 测试策略

- `cronParser.ts`：单元测试覆盖所有 cron 语法、边界情况（闰年、月末、DST）
- `cronFileStore.ts`：单元测试覆盖 CRUD、原子写入、格式兼容
- `cronScheduler.ts`：集成测试覆盖调度逻辑、去重、超时、项目切换
- `taskRunLogger.ts`：单元测试覆盖记录追加/更新/裁剪/清理
- 前端组件：Vitest + Vue Test Utils 覆盖交互逻辑
