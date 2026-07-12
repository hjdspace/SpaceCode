# ADR-0004: Engine Gateway 作为 IPC / H5 / IM 三路接缝背后的深模块

Date: 2026-07-12

## Status

Accepted

## Context

ADR-0001 决定 H5 Server 直连 Engine（不经渲染进程转发），并指出："Engine call logic currently embedded in `ipcMain.handle()` callbacks in `claudeCodeIPC.ts` needs to be extracted into reusable functions that both IPC handlers and H5 Server can call."

`h5EngineService.ts` 被抽出来给 H5 Server 用，但 IPC 层没有被收编到它背后。现状：

- `findEngineForSession` 在 `claudeCodeIPC.ts:626` 和 `h5EngineService.ts:9` 各存一份，后者注释直接写着"复制自 claudeCodeIPC.ts"。
- 约 22 个 IPC handler 重复同一段样板："查引擎 → 检查方法是否存在 → 派发 → warn if not implemented → 日志"。
- `imServer.ts` 是第三个消费者，也调 `h5EngineService`——三个 adapter 共享一个接缝，但接缝背后没有深模块。
- `h5EngineService.ts` 本身混了三个关注点：引擎派发、会话历史（`listProjectSessions` / `restoreSession`）、事件路由（`onRouteEvent`）。

## Decision

创建 **Engine Gateway**（`electron/engineGateway.ts`）作为调用侧到 Engine 的统一深模块。三个 adapter（`claudeCodeIPC.ts`、`h5Server.ts`、`imServer.ts`）的引擎派发调用全部委托给它。

### 范围

**在 Gateway 内**：
- 引擎查找（`findEngineForSession`）
- 核心生命周期：startSession / sendMessage / abort / stop / suspendSession / resumeSession
- 查询：getSessionStatus / getActiveSessions / isSessionActive
- 能力方法：allowPermission / denyPermission / respondPermission / setPermissionMode / submitToolAnswer / skipToolAnswer / listAgents / setModel / getMcpStatus / getContextUsage / getSettings / stopEngineTask / getPendingPermissionRequestIds / updateThinkingLevel / isEngineAvailable

**不在 Gateway 内**：
- `setMainWindow` / `onRouteEvent` — 引擎内部接线，留在 IEngine / EngineFactory
- `listProjectSessions` / `restoreSession` — 会话历史，走 SessionHistoryManager
- `installPiSdk` — 进程管理，单独抽 `piInstaller.ts`（候选 #6）
- MCP 配置 CRUD / probe — 走 mcpConfigStore / 单独抽（候选 #5）
- CLI 检测 / 代理状态 — 已有独立模块

### 深度来源

Gateway 在接缝背后加三样行为（h5EngineService 现在全缺）：

1. **结构化日志** — 通用包装器 `withLogging(methodName, fn)` 包住所有方法。每方法体 1 行，日志格式统一（`→ methodName | sid=... | elapsed=...ms`）。IPC / H5 / IM 三路获得一致遥测。
2. **能力检查** — 可选方法（Pi 引擎缺 allowPermission 等）缺失时抛 `NotImplementedError`，不再 warn + 静默 no-op。调用方明确知道操作未生效。
3. **错误包装** — try/catch + 结构化 error 日志 + rethrow。bug 定位只需看一处日志。

### 命名

采用 `engineGateway`，已加入 `CONTEXT.md` 词汇表。避免 `engineService`（与 legacy `h5EngineService` 冲突）、`engineManager`、`dispatcher`（太窄，不含日志/错误）。

## Consequences

### 正面

- `findEngineForSession` 单一来源，消除字面复制。
- 三个 adapter 的引擎派发调用退化成 1 行转发，IPC handler 文件大幅瘦身。
- 新增引擎方法时，IPC / H5 / IM 三路同时获得能力，无需在三处加 handler。
- Gateway 接口即测试面——构造 fake IEngine 即可驱动完整流程，不必 mock 30 个 IPC handler。
- H5 / IM 路径获得与 IPC 一致的日志，运维遥测完整。

### 负面

- H5 / IM 路径行为变化：新增日志输出；可选方法缺失从静默 no-op 变为抛错。需排查既有调用方是否依赖静默行为。
- `h5EngineService.ts` 将被删除，`onRouteEvent` 移到 EngineFactory 直连——3 个文件需改导入。
- `NotImplementedError` 调用方需处理（try/catch 或先检查 engine.type）。

### 迁移

分批进行，每批可独立验证：
1. 简单 1 参 async（abort / stop / suspend / resume）
2. 查询（getSessionStatus / getActiveSessions / isSessionActive）
3. 权限（allow / deny / respond / setMode）
4. 工具答复（submit / skip）
5. 核心（startSession / sendMessage）
6. 可选能力（listAgents / setModel / ... 9 个）

## Related

- ADR-0001 — H5 Server 直连 Engine；本 ADR 落实其"后果"节未完成的抽取工作。
- ADR-0002 — H5 模式在 API 层适配；Engine Gateway 是 `api.claudeCode` 接缝背后的实现侧。
- ADR-0003 — Turn store 拥有事件订阅；Gateway 不触碰事件路由，与 Turn 正交。
- `CONTEXT.md` — "Engine Gateway" 词汇条目。
