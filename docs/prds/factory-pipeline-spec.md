# SpaceCode 桌面端「AI 流水线」实现方案

> 目标：把 sandcastle 的「Agent 自己领任务 → 写代码 → 审查 → 合并」工作流做成 SpaceCode 桌面端的一等功能。
> UI 基线：`docs/prototypes/factory-board.html`（流水线看板 / 配置向导 / 合并弹窗 / 接管会话）。
> 参考实现：`mattpocock/sandcastle`（TypeScript 编排库，`sandcastle.run()` + 沙箱 + 分支策略 + 合并回主干）。

---

## 0. 结论先行

1. **不把 `@ai-hero/sandcastle` 当成桌面端运行时直接嵌入**。它是给「脚本/CI 里自己写 `main.ts`」的人用的库，自带 agent 启动、`.sandcastle/.env` 凭据、Docker 生命周期。SpaceCode 已经有 `engineGateway`、会话事件、模型 profile、进程池和权限往返，再引入一套会形成两条并行的 Agent 执行链路。
2. **用 sandcastle 的语义与契约，在 Electron 主进程实现原生编排器**（下称 Factory Runtime）：复用 `engineGateway` 跑实现/审查，复用 `EngineFactory.onRouteEvent` 收流，复用现有 git 能力扩展出 worktree 管理。
3. **P0 只做本地 worktree 隔离**（等价 sandcastle 的 `noSandbox()` + `branchStrategy: { type: 'branch' }`）。Docker / Podman 作为 `SandboxPort` 的第二个实现，放到 M6；容器内跑 Agent 时再选择「委托 sandcastle CLI」或「容器内 CLI」。
4. **初始化向导 4 步**对应 `sandcastle init` 的必答项 + 预检：运行引擎 → 隔离方式 → 任务来源 → 预检与确认。配置写到 `.spacecode/factory/config.json`，密钥只进系统凭据库（Electron `safeStorage`）。
5. **流水线拓扑固定为 `parallel-planner-with-review`**：规划 → N 个并行实现 → 逐分支审查 → 合并。配置只开放阶段开关、模型、权限模式、人工闸门，不做通用 DAG 编辑器（与原型文案一致）。

---

## 1. 资源整合

### 1.1 sandcastle 的关键事实（来自官方 README）

| 能力 | 事实 | 对本方案的约束 |
| --- | --- | --- |
| 入口 | `run({ agent, sandbox, promptFile/prompt, branchStrategy, maxIterations })` | 阶段执行器按同样字段建模 |
| Agent | `claudeCode(model)` / `pi` / `codex` / `cursor` / `opencode` / `copilot` | P0 只暴露 Claude Code 与 Pi，其余注册表预留 |
| 沙箱 | Docker / Podman / Vercel / `noSandbox`，或自定义 Provider | P0 worktree；Docker/Podman 走 `SandboxPort` |
| 分支策略 | `head` / `merge-to-head` / `branch` | P0 `branch`（`agent/issue-<n>-<slug>`） |
| 初始化 | `sandcastle init` 交互选 sandbox / issue tracker / template；`--agent`、`--model` 等旗标可非交互 | 向导 4 步 + 可脚本化参数 |
| 模板 | `blank` / `simple-loop` / `sequential-reviewer` / `parallel-planner` / `parallel-planner-with-review` | 固定最后一个；配置里保留 `template` 字段 |
| Prompt | `promptFile`、`{{KEY}}`、`` !`command` ``、内置 `SOURCE_BRANCH`/`TARGET_BRANCH`、`<promise>COMPLETE</promise>` | 原样移植这套提示词协议 |
| 结构化输出 | `Output.object({ tag, schema })`，要求 `maxIterations === 1`，失败可 `maxRetries` 续跑同一会话 | 规划 `<plan>`、审查 `<review>` 用同一思路 |
| 生命周期 | `createSandbox()` / `createWorktree()`、`wt.run()`、`sandbox.exec()`、`AbortSignal` | `SandboxPort` 对齐这些能力 |
| 清理 | worktree 有未提交改动则保留，干净才删除 | 停止/失败一律保留 worktree |
| 日志 | `.sandcastle/logs/`，`onAgentStreamEvent` 可转发 | `.spacecode/factory/logs/` + 事件日志 |

第三方解读里最有用的两条：

- **三/四段式角色**：Planner 选 N 个可并行 issue → N 个 Implementer（各自 worktree + 沙箱）→ Reviewer（每个 diff 独立上下文）→ Merger（解冲突、修类型/测试）。
- **合并资格保守**：implementer 必须「正常结束 + 发出完成信号 + 产生 commit」；reviewer 必须「正常结束 + 发出完成信号」，reviewer 自己的 commit 可选。

### 1.2 SpaceCode 现有能力（可直接复用）

| 能力 | 位置 | 用法 |
| --- | --- | --- |
| 统一引擎入口 | `electron/engine/engineGateway.ts` | `startSession` / `sendMessage` / `abort` / `stop` / `setPermissionMode` |
| 后台会话配置 | `electron/engine/engineSessionConfig.ts` | `loadEngineSessionConfig(cwd)`、`resolveEngineModelAlias(model, engineType)` |
| 无渲染端执行范式 | `electron/cron/cronSessionRunner.ts` | 订阅 `result` / `error` / `exit` 收口一次 Agent 回合 |
| 引擎事件路由 | `electron/engine/engines/EngineFactory.ts` `onRouteEvent` | 主进程直接收所有 session 的流事件 |
| 会话推送到渲染端 | `electron/cron/cronSessionRunner.ts:75` `pushSessionToRenderer` | 接管任务时把 session 挂进侧边栏 |
| 并发上限 | `docs/adr/0010-session-orchestration-one-shot-dag.md` | 引擎池 20；编排层自己再设闸门 |
| 编排 UI 范式 | `src/stores/orchestration/`、`src/components/orchestration/` | 中置标签页、节点抽屉、运行门控可借鉴 |
| Git 执行 | `electron/git/gitService.ts` 的 `gitExec` 模式 | Factory 另建 `gitOps.ts`，不改原文件 |
| IPC 规范 | `src/shared/channelMap.ts`、`handlerRegistry.ts`、`src/shared/channels/git.ts` | `defineChannels` + `registerHandlers` |
| 事件通道 | `src/shared/channels/claudeCode.ts` | `claude-code:*` 事件已覆盖流式输出 |
| i18n | `src/i18n/locales/{zh-CN,en-US}/` | 新增 `factory.ts` 域模块 |

### 1.3 缺口（本方案要新建的）

- 没有 worktree 创建/复用/清理服务（现有只有 watcher）。
- 没有 GitHub Issue 读写（现有 GitHub 调用只用于 marketplace / 更新）。
- 没有结构化输出解析与重试。
- 没有阶段状态机、任务持久化、崩溃恢复。
- 没有系统凭据库封装（仓库内未使用 `safeStorage`）。
- 没有容器内 Agent 执行路径。

---

## 2. 架构决策

### 2.1 为什么 P0 原生实现，而不是直接跑 sandcastle

1. **凭据链路**：sandcastle 需要 `.sandcastle/.env`（`CLAUDE_CODE_OAUTH_TOKEN` 或 `ANTHROPIC_API_KEY`），而桌面端模型/代理配置在 `~/.claude/gui-settings.json` 与 `~/.spacecode/profiles.json`。原生实现直接复用 `loadEngineSessionConfig`，不产生第二份密钥。
2. **事件与权限**：`engineGateway` 才有 `can_use_tool` 权限往返、会话池、`--resume`、模型别名解析。sandcastle 自己 spawn CLI，桌面端看不到过程，也就无法做「接管」。
3. **打包**：Electron 里再带一份 `tsx` + sandcastle + Docker 生命周期，安装包与升级面都会变大；`engine/` 又是只读子项目。
4. **产品形态**：原型要的是「看板 + 阶段 + 人工闸门 + 接管」，这层状态机 sandcastle 不提供，必须自己写。

### 2.2 保留兼容缝

- `SandboxPort` / `AgentPort` 的字段命名对齐 sandcastle（`worktreePath`、`branchStrategy`、`exec`、`close`、`preserve`）。
- M6 的 Docker/Podman 适配器可以内部委托 `@ai-hero/sandcastle`（生成临时 `.sandcastle/main.ts` 与 `.env`），也可以自己 `docker exec`；上层状态机不变。
- 可选导出「`.sandcastle/` 兼容包」，让用户仍能用 sandcastle CLI 跑同一套 prompt（P2，不在首版）。

### 2.3 运行时放主进程

Factory Runtime 必须活在 Electron main：

- 窗口刷新、切项目、关闭标签页不能中断运行；
- 任务与事件要落盘；
- GitHub token 不能进渲染进程；
- 定时/无人值守运行（未来接 cron）天然在主进程。

渲染层只拿投影后的任务快照与事件流。

### 2.4 模块图

```
┌──────────────────────── Electron main ────────────────────────┐
│ factoryIpc  ← defineChannels(factory:*)                        │
│      │                                                         │
│ factoryRuntime ── scheduler ── persistence(events/tasks.json) │
│      │                │                                        │
│      ├── stages/plan | implement | verify | review | merge     │
│      ├── ports: AgentPort / SandboxPort / TrackerPort          │
│      └── adapters:                                             │
│            agentEngineGateway ── engineGateway                 │
│            sandboxWorktree ──── gitOps                         │
│            sandboxDocker ────── docker / sandcastle CLI (M6)   │
│            trackerGithub ────── gh CLI / REST                  │
│            trackerLocal ─────── backlog.json                   │
│ secrets(safeStorage)  events(i18n code)                        │
└────────────────────────────────────────────────────────────────┘
                │ factory:event (webContents.send)
┌───────────────▼──────────── Renderer ──────────────────────────┐
│ src/stores/factory  →  FactoryBoard / Inspector / Wizard / ... │
│ 接管：复用 chatSession 渲染链路（main 推 session 到侧边栏）      │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. 文件与职责

```
electron/factory/
├── factoryIpc.ts              # factory:* handler 注册
├── factoryRuntime.ts          # 单例：run/task 生命周期、session→task 映射、事件广播
├── factoryScheduler.ts        # 并发闸门、队列、领取、暂停/继续/停止
├── factoryConfig.ts           # 读取/校验/迁移 .spacecode/factory/config.json
├── factoryPersistence.ts      # 原子写、事件 JSONL、崩溃恢复、目录清理
├── factoryEvents.ts           # 事件码 + 参数 + 级别；不存本地化文案
├── factoryPrompts.ts          # 默认 prompt 模板 + {{VAR}} / !`cmd` 渲染
├── gitOps.ts                  # worktree/list/diff/log/merge/preflight/cleanup
├── secrets.ts                 # safeStorage 封装（GitHub token）
├── ports.ts                   # AgentPort / SandboxPort / TrackerPort / Verifier
├── adapters/
│   ├── agentEngineGateway.ts  # engineGateway 实现 AgentPort
│   ├── sandboxWorktree.ts     # P0
│   ├── sandboxDocker.ts       # M6
│   ├── trackerGithub.ts       # gh CLI 或 REST
│   └── trackerLocal.ts        # backlog.json
├── stages/
│   ├── plan.ts
│   ├── implement.ts
│   ├── verify.ts
│   ├── review.ts
│   └── merge.ts
└── __tests__/                 # 与源码同处，主进程测试首行 node 环境声明

src/shared/channels/factory.ts          # channel 单一真相源
src/stores/factory/{index.ts,types.ts}  # 渲染层状态
src/components/factory/
├── FactoryView.vue                     # 中置标签页壳（run header + pipeline + board + inspector）
├── FactoryBoard.vue / FactoryCard.vue
├── FactoryInspector.vue                # 概览/事件流/Diff/审查
├── FactorySetupWizard.vue              # 4 步
├── FactoryConfigModal.vue
├── FactoryPlanModal.vue
├── FactoryMergeModal.vue
└── FactoryTakeoverModal.vue
src/i18n/locales/zh-CN/factory.ts
src/i18n/locales/en-US/factory.ts
```

不改 `electron/git/gitService.ts`；`gitOps.ts` 复用它的 `execFile('git')` 写法（含超时、`GIT_OPTIONAL_LOCKS=0`、错误码归一）。

---

## 4. 领域模型

### 4.1 配置

```ts
export type StageKey = 'plan' | 'implement' | 'verify' | 'review' | 'merge'
export type Lane = 'queued' | 'implementing' | 'reviewing' | 'mergeable' | 'blocked' | 'done'

export interface FactoryConfig {
  version: 1
  repo: { root: string; remote?: string; baseBranch: string }
  template: 'parallel-planner-with-review'
  agent: {
    engineType: 'claude-code' | 'pi'
    model?: string                 // 实际模型名，执行前走 resolveEngineModelAlias
    maxIterations: number          // 默认 5
    maxConcurrency: number         // 默认 4，上限 20（见 ADR-0010）
  }
  sandbox:
    | { type: 'worktree'; root: '.spacecode/worktrees' }
    | { type: 'docker'; imageName: string; worktreeRoot: '.spacecode/worktrees'; mounts?: MountSpec[] }
    | { type: 'podman'; imageName: string; worktreeRoot: '.spacecode/worktrees' }
  tracker:
    | { type: 'github-issues'; repo: string; label: string; auth: 'gh' | 'token'; mergeMode: 'local' | 'pr'; commentIssue: boolean; closeIssue: boolean }
    | { type: 'local'; backlogPath: '.spacecode/factory/backlog.json'; mergeMode: 'local' }
  stages: Record<StageKey, {
    enabled: boolean
    model?: string
    permissionMode: 'default' | 'plan' | 'acceptEdits'
    humanGate: boolean
    maxIterations?: number
  }>
  commands: { verify: string; install?: string }
  prompts: Record<StageKey, string>   // 相对仓库根的路径
  limits: { taskTimeoutSec: number; idleTimeoutSec: number; keepDoneRuns: number }
}
```

**不写入配置**：GitHub token、模型 API key、代理地址。

### 4.2 任务

```ts
export interface FactoryTask {
  id: string                       // 本地 uuid；GitHub 任务用 `gh-412`
  runId: string
  source: 'github-issues' | 'local'
  issueNumber?: number
  title: string
  goal: string                     // issue body 或本地任务描述
  lane: Lane
  stageIdx: number                 // 0 领取 … 6 完成，对应 STEPS
  branch: string                   // agent/issue-412-session-refresh
  worktree: string | null
  sessionIds: Partial<Record<StageKey, string>>
  model: string
  iteration: number
  maxIterations: number
  diff: { additions: number; deletions: number; files: DiffFile[] }
  tests?: { status: 'pass' | 'fail'; command: string; detail: string; at: string }
  commits: Array<{ sha: string; message: string }>
  review?: {
    verdict: 'approved' | 'needs_changes'
    summary: string
    comments: Array<{ file: string; line: number; body: string; status: 'open' | 'accepted' | 'dismissed'; severity?: 'blocker' | 'suggestion' }>
  }
  attention?: { reason: string; action: 'fix' | 'merge' | 'retry' }
  timestamps: { claimedAt?: string; startedAt?: string; endedAt?: string; mergedAt?: string }
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
  cancelled?: boolean
  mergedCommits?: number
}
```

### 4.3 事件

事件只存「码 + 参数」，渲染层用 `t('factory.events.<code>', params)` 格式化。这样日志可跨语言重放，也避免主进程里散落中文字符串。

```ts
export interface FactoryEvent {
  seq: number
  at: string
  runId: string
  taskId: string | null
  stage?: StageKey
  code: string        // 'task.claimed' | 'worktree.created' | 'tests.failed' | 'review.comment' …
  level: 'info' | 'ok' | 'warn' | 'error'
  params?: Record<string, string | number>
}
```

原始 Agent 输出另存 `.spacecode/factory/logs/<taskId>.log`（滚动，默认保留最近 5 个任务），事件流只保留结构化摘要。

### 4.4 阶段与泳道

| stageIdx | STEP（检查器阶段条） | Lane |
| --- | --- | --- |
| 0 | 领取 | queued |
| 1 | 工作树 | implementing |
| 2 | 实现 | implementing |
| 3 | 验证 | implementing |
| 4 | 审查 | reviewing |
| 5 | 合并 | mergeable |
| 6 | 完成 | done |

`blocked` 是横向异常态，保留 `stageIdx` 指向卡住的位置（原型 `stepState` 依赖它）。

### 4.5 状态迁移（唯一真相源）

```text
queued ──slot──▶ implementing(1) ──▶ implementing(2) ──▶ implementing(3)
   │                   │  ▲                │                │
   │                   │  └── fix ─────────┘                │
   │                   ▼                                   ▼
   │                blocked ◀── verify fail ────────────────┤
   │                   │                                   │
   │                   └── fix ──▶ implementing(2)         │
   │                                                       ▼
   │                                              reviewing(4)
   │                                                 │      │
   │                                        approve ─┘      └─ needs_changes ─▶ blocked
   │                                                 ▼
   │                                           mergeable(5)
   │                                            │        │
   │                                  merge ok ─┘        └─ conflict ─▶ blocked
   │                                            ▼
   └── cancel ─────────────────────────────▶ done(6, cancelled)
                                                done(6)
```

所有迁移由 `factoryRuntime.transition(task, to, reason)` 一处写入，禁止各阶段直接改 `lane`。

---

## 5. 初始化向导（对应 `sandcastle init`）

### 5.1 四步与旗标映射

| 步骤 | 原型内容 | sandcastle 对应 | 写入配置 |
| --- | --- | --- | --- |
| 1 运行引擎 | Claude Code（默认）/ Pi；模型复用桌面配置；Codex/Cursor/OpenCode/Copilot 预留 | `--agent`、`--model` | `agent.engineType/model` |
| 2 隔离方式 | 本地 worktree（推荐）/ Docker（检测）/ Podman（禁用） | `--sandbox docker|podman`；P0 等价 `noSandbox` | `sandbox.type` |
| 3 任务来源 | GitHub Issues / 本地 backlog / 自定义（禁用）；auth token 或 gh CLI；领取标签；合并方式；评论/关闭 | `--issue-tracker github-issues|beads|custom`、`--create-label` | `tracker.*` |
| 4 预检与确认 | 检查项 + 摘要 + 将写入文件 | `--build-image`、`--install-template-deps` | 预检通过才落盘 |

`sandcastle init` 本身交互的是 sandbox / issue tracker / template，Agent 用 `--agent` 传入；桌面向导把 Agent 提为第一步、把 template 固定为 `parallel-planner-with-review`，语义等价。与 sandcastle 的一个差异：`init` 遇到已存在的 `.sandcastle/` 会报错，桌面端向导必须**可重复进入**（原型的「配置」按钮 / 「重新初始化」），保存时原子覆盖。

### 5.2 预检项（第 4 步，阻塞 = 有 err）

- Git 仓库、工作区干净（脏工作区给 warn + 允许继续，但合并前会再拦一次）。
- Git ≥ 2.40（worktree 稳定）。
- `.spacecode/` 可写。
- 引擎可用：`EngineFactory.getEngineAvailability(engineType)`。
- 模型 profile 已配置（从 `~/.claude/gui-settings.json` 读到 model/apiKey/baseUrl）。
- 任务源：`gh auth status` 或 token `GET /user` + 仓库可读 + label 存在；本地 backlog 无需凭据。
- 验证命令可在仓库根执行（`npm run test:changed`）。
- 选择 Docker 时：`docker version` 可用，且提示容器内凭据/代理需要另行打通。

### 5.3 初始化落盘

```
.spacecode/factory/
├── config.json
├── backlog.json                 # tracker=local 时才有
├── prompts/
│   ├── plan.md
│   ├── implement.md
│   ├── review.md
│   ├── fix.md
│   └── merge-conflict.md
├── runs/                        # 运行事件与快照
└── logs/                        # Agent 原始输出
```

同时在仓库 `.gitignore` 幂等追加 `.spacecode/worktrees/`、`.spacecode/factory/runs/`、`.spacecode/factory/logs/`。配置里只存相对路径。

### 5.4 密钥

- token 由渲染层通过 `factory:secretsSaveGithub` 交给主进程，主进程用 `safeStorage.encryptString` 后写 `<userData>/factory-secrets.json`（`fs.chmod 0o600`）。
- `safeStorage.isEncryptionAvailable() === false` 时只允许「使用 gh CLI」，不落明文。
- token 只用于主进程的 Tracker 调用，**永不注入 Agent 的 env**。

---

## 6. 执行流水线

### 6.1 规划（新运行 / 领取）

`stages/plan.ts`：

- 输入：本地 backlog 或 GitHub open issues（label 过滤）。
- 输出：`<plan>{ "tasks": [{ "issueNumber": 412, "title": "...", "parallelizable": true, "branchSlug": "session-refresh", "dependsOn": [] }] }</plan>`。
- 校验：issue 必须存在；同一依赖链不允许并行；已经 `done/cancelled` 的跳过；最多 `maxTasksPerRun`。
- 失败：`maxRetries: 1`，续跑同一 session 让它只重发 `<plan>` 标签（对齐 sandcastle 的 `StructuredOutputError` 重试思路）。
- UI：原型的新建运行弹窗展示可勾选任务、并发上限、验证命令；用户确认后才入队。

### 6.2 工作树

`gitOps.ts` 的固定序列（全部 `execFile('git', args, { cwd })`，超时 10s，输出上限 10MB）：

```text
git rev-parse --show-toplevel
git remote get-url origin                     # 识别 owner/repo
git worktree list --porcelain                 # 复用同分支 worktree
git worktree add -b agent/issue-412-session-refresh \
    .spacecode/worktrees/412 <baseBranch>
git -C <wt> status --porcelain
```

- 分支命名：`agent/issue-<num>-<slug>`；本地任务用 `agent/task-<id>`。
- 目录：`.spacecode/worktrees/<taskId>`，taskId 经过 `[A-Za-z0-9_-]` 白名单，防路径逃逸。
- 失败/停止/崩溃：**保留**目录；只有合并成功或用户显式放弃才删。
- Windows 长路径：任务目录用短 id；初始化时检测仓库路径长度并提示开启 `core.longpaths`。

### 6.3 实现

`adapters/agentEngineGateway.ts` 负责把 `AgentPort.run()` 映射到现有引擎：

```ts
const base = loadEngineSessionConfig(worktreePath)
const config = buildCronEngineConfig(base, {
  model: stage.model ?? factoryConfig.agent.model,
  permissionMode: 'acceptEdits',
}, resolveEngineModelAlias)
config.cwd = worktreePath
await engineGateway.startSession(sessionId, config)
await engineGateway.sendMessage(sessionId, renderedPrompt)
```

- 每个任务每个阶段独立 `sessionId`（`fac-<run>-<task>-impl`）。实现阶段内多次迭代复用同一 session（保留上下文），审查阶段用**新 session**（fresh context）。
- Prompt 文件遵循 sandcastle 协议：
  - `{{SOURCE_BRANCH}}` / `{{TARGET_BRANCH}}` 由运行时注入；
  - `{{ISSUE_NUMBER}}`、`{{GOAL}}`、`{{REVIEW_COMMENTS}}` 由阶段注入；
  - `` !`git log --oneline -10` `` 由主进程在 worktree 内执行后替换（命令白名单：`git`、`gh issue view`、`npm/pnpm/yarn/bun` 的只读子命令）；
  - 结束信号沿用 `<promise>COMPLETE</promise>`。
- 迭代循环：Agent 回合结束 → 跑验证 → 失败则把失败摘要作为下一条消息发回同一 session → 直到通过或达到 `maxIterations`。
- 事件：订阅 `EngineFactory.onRouteEvent`，按 `sessionId → taskId` 投影；工具调用只记「读/改/跑」摘要，原始行写日志文件。
- 中止：`AbortSignal` 映射到 `engineGateway.abort/stop`，worktree 保留。

### 6.4 验证

`stages/verify.ts` 不走 Agent：

```ts
exec(verifyCommand, { cwd: worktreePath, timeout: 10 * 60_000, env: scrubbedEnv })
```

- 只执行配置里的命令（用户自己写的），不做任意 shell 拼接。
- 输出取尾部 N 行作为 `tests.detail`；exit code 决定 `pass/fail`。
- 失败进入 fix 循环；连续失败达到上限 → `blocked`，`attention.reason = 'tests.failed'`。

### 6.5 审查

- fresh session，`permissionMode: 'plan'`（只读）或 `acceptEdits`（允许审查者顺手修；原型选后者，配置可切）。
- Prompt 要求只输出：

```xml
<review>
{ "verdict": "approved" | "needs_changes",
  "summary": "...",
  "comments": [{ "file": "src/x.ts", "line": 88, "body": "...", "severity": "blocker" }] }
</review>
```

- 主进程解析 + schema 校验；失败重发一次（续跑同一 session，只要求重发标签）。
- 行内意见落 `task.review.comments`；「让 Agent 修」把 open 意见拼进 `fix.md`，回到实现阶段（同一 worktree，新 session）。
- 合并资格（对齐 sandcastle 的保守策略）：`review.verdict === 'approved'` 且无 `open` 意见 且 `tests.status === 'pass'` 且 `commits.length > 0` 且 worktree 干净。

### 6.6 合并

`stages/merge.ts` + 合并弹窗：

1. 预检：目标分支仍等于领取时的 base；`git merge-tree --write-tree <base> <branch>` 判断冲突（git < 2.38 回退到临时 worktree 里 `merge --no-commit` 再 abort）。
2. 再跑一次验证命令（原型文案），失败即中止并保留 worktree。
3. 人工闸门：弹窗要求勾选「我已审查 diff」。
4. 执行：`merge commit`（默认，`--no-ff`）/ `squash` / `rebase` 三选一；**禁止 force push**。
5. 回写：`gh issue comment` / `gh issue close --comment`（按配置）；PR 模式改为 push + `gh pr create`（M7）。
6. 清理：worktree 干净 → `git worktree remove` + 删分支；脏 → 保留并标 `blocked`。
7. 完成：`lane=done`，记录 `mergedAt/mergedCommits`。

### 6.7 接管 / 暂停 / 停止

- **接管**：主进程把该任务的 implement session 通过 `pushSessionToRenderer` 挂进侧边栏（复用 cron 的做法），后台调度器跳过该任务；用户在聊天页继续。交回时：先重跑验证，通过则进审查，否则继续 fix 循环。
- **暂停**：不再领取新任务；当前 Agent 回合跑完。
- **停止**：`engineGateway.stop` 所有在跑 session，`implementing/reviewing` → `blocked`，保留 worktree 与提交。
- **崩溃**：启动时扫描 `runs/*/tasks.json`，`implementing/reviewing` 一律降级为 `blocked`（reason `app.restarted`），不自动续跑，避免不可控的重复提交。

---

## 7. 沙箱抽象

```ts
export interface SandboxHandle {
  id: string
  branch: string
  worktreePath: string
  exec(args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<ExecResult>
  runAgent(options: AgentRunOptions): Promise<AgentRunResult>
  close(opts?: { preserve?: boolean }): Promise<{ preservedPath?: string }>
}

export interface SandboxProvider {
  create(opts: { repoRoot: string; taskId: string; branch: string; baseBranch: string }): Promise<SandboxHandle>
}
```

| 实现 | Agent 执行方式 | 说明 |
| --- | --- | --- |
| `sandboxWorktree` (P0) | `engineGateway`，`cwd = worktreePath` | 等价 `noSandbox()` + `branch` 策略；无网络隔离 |
| `sandboxDocker` (M6) | 容器内 CLI，或委托 sandcastle | bind-mount worktree；`--user uid:gid`；挂 npm 缓存只读；`host.docker.internal` 代理 |
| `sandboxPodman` (M6) | 同 Docker | rootless；`Containerfile` |

Docker 的真实难点不是隔离，而是**模型凭据与代理**：容器内拿不到 `127.0.0.1` 的代理，也读不到宿主的 key。两条路径：

- **A（推荐）**：M6 用 `@ai-hero/sandcastle` 作为容器执行器，运行时把桌面 profile 转成 `.sandcastle/.env` 注入容器，事件通过 `logging.onAgentStreamEvent` 回传。
- **B**：自建镜像 + `docker exec` Claude CLI，镜像里装 CLI，env 注入 key/baseUrl，代理监听 `0.0.0.0`。

上层 `sandboxWorktree` / `sandboxDocker` 对状态机完全同构，切换只改配置。

---

## 8. 任务源

```ts
export interface TrackerPort {
  listOpen(filter: { label?: string; limit: number }): Promise<IssueSummary[]>
  get(id: string): Promise<IssueDetail>
  comment(id: string, body: string): Promise<void>
  close(id: string, body?: string): Promise<void>
}
```

- **GitHub**：优先 `gh`（`gh auth status` 通过），否则用 REST + token（`GET /repos/{owner}/{repo}/issues?labels=...`、`POST .../comments`、`PATCH ...`）。两者都只在主进程执行；`owner/repo` 从 `git remote get-url origin` 解析，支持 SSH/HTTPS。
- **本地**：`.spacecode/factory/backlog.json`，字段 `{ id, title, goal, priority, createdAt, order }`；看板可手工加/排序。
- **自定义 / Beads**：预留接口，配置里 `type: 'custom'` 时直接报「暂不可用」（与原型一致）。

领取规则：label 匹配 + 未被其他 run 占用 + 依赖满足；领取时先 `comment` 一条「已被 run #x 领取」防止重复（可配置）。

---

## 9. IPC 与渲染层

### 9.1 通道（`src/shared/channels/factory.ts`）

```
factory:configLoad        (repoRoot) -> FactoryConfig | null
factory:configSave        (repoRoot, config) -> { ok, error? }
factory:preflight         (repoRoot, draft) -> PreflightItem[]
factory:secretsTestGithub (token) -> { ok, login?, error? }
factory:secretsSaveGithub (token) -> { ok }
factory:runCreate         (repoRoot, { taskIds, concurrency }) -> { runId }
factory:runGet            (repoRoot, runId) -> RunSnapshot
factory:runPause / runResume / runStop
factory:taskList          (repoRoot, runId) -> FactoryTask[]
factory:taskStart / taskCancel / taskRetry / taskFix
factory:taskTakeover      (repoRoot, taskId) -> { sessionId }
factory:taskReturn
factory:reviewApprove     (taskId)
factory:commentResolve    (taskId, index, action)
factory:mergePreflight    (taskId) -> MergePreflight
factory:mergeCommit       (taskId, { mode, ack })
factory:worktreeReveal    (taskId)
factory:planGenerate      (repoRoot) -> PlanDraft
factory:event             # main → renderer 推送
```

注册方式照 `src/shared/handlerRegistry.ts`：`defineChannels` + `registerHandlers(ipcMain, factoryChannels, 'factory:', {...})`，preload bridge 与 `electron.d.ts` 从同一份定义派生，避免手写三处。

### 9.2 渲染层

- `src/stores/factory/`：`config`、`run`、`tasks`、`selectedId`、`tab`、`setup`、`events`；订阅 `factory:event` 增量更新（`seq` 去重）。
- 组件拆分与原型一一对应：

| 原型区域 | 组件 | 关键状态 |
| --- | --- | --- |
| 运行头部 + pipeline 分段 | `FactoryView.vue` | `run.status/paused/maxConcurrency/spend/elapsed` |
| 六列看板 + 卡片 | `FactoryBoard.vue` / `FactoryCard.vue` | `lane/stageIdx/diff/iteration` |
| 右侧检查器 | `FactoryInspector.vue` | `tab`、`stageRail`、`review` |
| 4 步向导 | `FactorySetupWizard.vue` | `setup.*` |
| 配置弹窗 | `FactoryConfigModal.vue` | `stages` 表格 |
| 新建运行 | `FactoryPlanModal.vue` | 勾选任务、并发、验证命令 |
| 合并弹窗 | `FactoryMergeModal.vue` | 预检结果、merge mode、ack |
| 接管 | `FactoryTakeoverModal.vue` | 复用 chat 渲染链路 |

- 入口：侧边栏/命令面板新增「流水线」，以**中置标签页**打开（复用 orchestration 的 tab 模式），不新造一套 rail；原型的 rail 只是独立演示壳。
- 所有文案走 `t('factory.*')`；事件码在 `factory.events.<code>`。日期、时长、金额用现有格式化工具。
- 空态、阻塞态、暂停态、无 Docker、未登录 GitHub 都要有独立文案（原型已给出）。

---

## 10. 并发、成本、持久化

- **并发**：`factoryScheduler` 自己持有闸门（默认 4，上限 20）。一个任务同时只占一个槽位；审查复用同一槽位（顺序执行）。绝不依赖引擎池的 suspend/evict 来调度（ADR-0010 的教训）。
- **成本**：从引擎 `result`/usage 事件累计 token；若有 profile 单价则估算 `costUsd`，否则只显示 token。原型里的 `$3.42` 是展示位，不参与决策。
- **持久化**：
  - `runs/<runId>/run.json`（配置快照、状态、计数）
  - `runs/<runId>/tasks.json`（任务投影，原子写：临时文件 + rename）
  - `runs/<runId>/events.jsonl`（追加）
  - `backlog.json`、`config.json`
  - 单实例文件锁（`runs/.lock`），防止两个窗口同时驱动同一 run。
- **恢复**：`app.whenReady` 后延迟加载（不阻塞启动），只恢复 UI 状态与 `blocked` 标记；不自动重放 Agent。
- **保留**：`keepDoneRuns` 默认 20；清理只删 `done` 且无 worktree 的 run 日志。

---

## 11. 安全与权限

| 项 | 规则 |
| --- | --- |
| 阶段权限 | plan=`plan`；implement=`acceptEdits`；review=配置（默认 `acceptEdits`）；merge 人工闸门 |
| push | P0 一律禁止；PR 模式需显式开启并提示 `Contents: write` |
| GitHub token | 只进主进程；safeStorage 加密；不写项目目录、不进日志、不进 Agent env |
| 验证命令 | 只执行 `config.commands.verify`；不把 issue 正文拼进 shell |
| Prompt 注入 | issue 标题/正文通过 `promptArgs` 作为纯文本注入；`` !`cmd` `` 只在 prompt 文件字面量里展开 |
| 路径 | taskId 白名单；worktree 必须位于 `.spacecode/worktrees/` 下；拒绝 symlink 逃逸 |
| 日志 | 对 `ghp_`、`github_pat_`、`sk-` 做脱敏后再落盘 |
| 停止 | 只停本 run 的 session；不 kill 用户聊天会话 |

---

## 12. 测试计划

遵循 `docs/adr/0011-tests-must-cross-the-seam.md`：测试必须 import 真实模块，外部依赖用注入的端口，不手抄实现。

| 层 | 文件 | 断言 |
| --- | --- | --- |
| 状态机 | `electron/factory/__tests__/runtime.test.ts` | 合法/非法迁移；暂停/停止/崩溃降级 |
| 调度 | `.../scheduler.test.ts` | 并发闸门、公平领取、暂停不领新任务 |
| 配置 | `.../config.test.ts` | 校验、默认值、迁移、相对路径 |
| 事件 | `.../events.test.ts` | 事件码、seq 单调、脱敏 |
| worktree | `.../sandboxWorktree.test.ts` | 真实临时 git 仓库：创建/复用/脏目录保留/合并后清理 |
| 合并预检 | `.../merge.test.ts` | base 前进、冲突、测试失败、闸门未勾选 |
| 审查解析 | `.../reviewParser.test.ts` | 合法 JSON、fence 包裹、坏 JSON 重试一次 |
| Tracker | `.../trackerGithub.test.ts` | 注入 exec：401/403/404、label 过滤、评论/关闭 |
| 集成 | `tests/integration/factoryRun.integration.test.ts` | 假 AgentPort + 真 git：两任务并行 → 审查 → 合并 |
| 渲染 | `src/stores/factory/__tests__`、`tests/components/factory*.test.ts` | 事件增量、向导阻塞、看板/检查器渲染 |

验证（每个里程碑都跑）：

```sh
npm run test:changed
npm run build
```

---

## 13. 分阶段交付

| 里程碑 | 范围 | 退出标准 |
| --- | --- | --- |
| M0 基座 | 配置/持久化/事件/状态机/IPC 骨架；看板空壳；4 步向导；本地 backlog | 向导可保存并重启恢复；手工任务能入队 |
| M1 worktree + 实现 | `gitOps`、`sandboxWorktree`、AgentPort、实现阶段、暂停/停止、Diff/事件流 | 本地任务能在 worktree 里产出 commit；停止保留目录 |
| M2 验证 + 审查 | 验证命令、审查阶段、结构化解析、修复循环、审查 UI | 审查能产出结构化意见；「让 Agent 修」回到实现 |
| M3 合并 | 预检、合并弹窗、三种合并方式、清理、GitHub 评论/关闭 | 合并后分支/目录按规则清理；失败保留 |
| M4 规划 + 并发 | Planner、新建运行弹窗、调度闸门、并发上限 | 2 个以上 issue 并行跑完并逐个合并 |
| M5 接管 + 恢复 | 接管会话、交回、崩溃恢复、配置弹窗 | 接管期间后台不推进；重启后任务变 blocked 可重试 |
| M6 Docker/Podman | `sandboxDocker`/`sandboxPodman`、镜像构建、凭据/代理 | 同一任务在容器内完成实现与审查 |
| M7 PR 模式 | push 分支、创建 PR、回复审查 | 不本地合并也能交付 |

首个可交付竖切建议：**M0 + M1**（本地 backlog → worktree → 实现 → 事件流 → 停止保留），它已经能验证「Agent 自己领任务写代码」的核心，且不依赖 GitHub 与 Docker。

---

## 14. 风险与开放问题

1. **微信文章无法抓取**：`mp.weixin.qq.com` 链接被反爬，当前环境返回空内容。本方案依据 sandcastle README + 公开解读；如文章里有额外约束（例如特定的任务标签、评审规则），请补充原文或截图再对齐。
2. **Windows worktree**：长路径、网络盘、大小写；初始化时检测并提示。
3. **引擎池**：并发 20 是池上限；Factory 默认 4，避免用户聊天被挤。
4. **审查质量**：结构化输出会偶发坏 JSON；必须有一次重试与「人工批准」兜底，不能让坏输出直接进合并。
5. **合并冲突自动修**：首版只检测、不自动解；「Opus 解冲突」列为后续开关。
6. **Docker 凭据**：容器内代理与 key 是最容易失败的一环；M6 前不建议把 Docker 作为默认选项。
7. **sandcastle 上游变化**：若 M6 委托它执行，锁版本并在适配器里隔离 API。

---

## 15. 验收清单

- [ ] 向导 4 步可重复进入，保存后重启仍能读到配置。
- [ ] GitHub token 不出现在 `.spacecode/`、日志、Agent env 中。
- [ ] 两个本地任务能并行进入不同 worktree，产生独立分支与 commit。
- [ ] 验证失败会回到实现循环；达到上限进入 blocked 且保留 worktree。
- [ ] 审查输出 `<review>` 能解析成行内意见；坏 JSON 自动重试一次。
- [ ] 合并前会重跑验证；未勾选确认无法合并；冲突会阻塞而非强推。
- [ ] 停止/崩溃后 worktree 保留，任务可从当前阶段重试。
- [ ] 接管使用同一引擎会话，交回后流水线继续。
- [ ] 所有可见文案来自 i18n；事件日志存码不存文案。
- [ ] `npm run test:changed` 与 `npm run build` 通过。
