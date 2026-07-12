# IPC handler 工厂函数抽取——消除 claudeCodeIPC.ts 内联逻辑

## Context

`electron/claudeCodeIPC.ts` 是 Electron 主进程的 IPC handler 集合，注册了 50+ 个 `ipcMain.handle` 调用。架构审查（`improve-codebase-architecture` skill）识别出两个深化候选：

### #5 — MCP 探测配置解析（~60 行内联）

`mcp:probeServer` handler 和 `mcpConfigStore.ts` 的 `buildEnabledMcpConfig` 各自维护一份 cua-driver / browser-use 路径解析逻辑，靠注释提醒"与对方保持一致"（口头契约）。两份代码存在微妙差异：

- **env 合并方式不同**：probe handler 执行 `{ ...config.env, ...resolved.env }`（合并），mcpConfigStore 执行 `cliConfig.env = resolved.env`（覆盖）
- **telemetry 设置不一致**：probe handler 为 cua-driver 设置 `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`，mcpConfigStore 不设置
- **检测方式不同**：probe handler 通过 command/args 模式检测，mcpConfigStore 通过 server key 检测

### #6 — Pi SDK 安装（~70 行内联）

`claude-code:installPiSdk` handler 内联了完整的进程管理逻辑：npm/bun spawn、平台检测、bundled-binary 路径解析、120s 超时、候选迭代回退。使用 `require()` 懒加载 `child_process`，且 handler 无法独立测试。

## Decision

将两段内联逻辑抽取为独立的工厂模块。

### #5 — `electron/mcpConfigResolver.ts`（133 行）

**接口**：
```typescript
export type BuiltinMcpName = 'cua-driver' | 'browser-use'
export interface ResolvedMcpConfig { command: string; args?: string[]; env?: Record<string, string> }
export type BuiltinMcpResolution = { status: 'resolved'; config: ResolvedMcpConfig } | { status: 'missing'; error: string }

export function detectBuiltinFromConfig(config: Pick<McpProbeConfig, 'type' | 'command' | 'args' | 'url'>): BuiltinMcpName | null
export function builtinNameFromServerKey(key: string): BuiltinMcpName | null
export function resolveBuiltinMcp(name: BuiltinMcpName): BuiltinMcpResolution
```

**设计要点**：
1. **两个检测函数映射到规范名称**：`detectBuiltinFromConfig`（按 command/args 模式，用于 probe handler）和 `builtinNameFromServerKey`（按 server key，用于 mcpConfigStore）都返回 `BuiltinMcpName`，然后共享同一个 `resolveBuiltinMcp` 解析器。
2. **判别联合返回类型**：`BuiltinMcpResolution` 使用 `{ status: 'resolved'; config } | { status: 'missing'; error }` 让调用方类型安全地处理两种结果。
3. **调用方自行决定缺失行为**：probe handler 缺失时返回失败，mcpConfigStore 缺失时保留原始命令让 CLI 自行失败（不影响其他服务器）。

**行为对齐**：两处调用方现在都执行 `{ ...cliConfig.env, ...resolution.config.env }`（合并 env），且都为 cua-driver 设置 `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`。这是一个微小的行为改进——对齐了原本发散的两条代码路径。

### #6 — `electron/piInstaller.ts`（153 行）

**接口**：
```typescript
export interface InstallResult { success: boolean; error?: string }
export async function installPiSdk(onProgress?: (msg: string) => void): Promise<InstallResult>
```

**设计要点**：
1. **候选迭代模式**：`buildInstallerCandidates()` 返回 `[npm, bundled-bun, global-bun]` 三个候选安装器，`tryInstall()` 依次尝试直到成功或耗尽。
2. **进程管理内聚**：`tryInstall()` 封装了 spawn + stdout/stderr 收集 + exit code 检查 + 120s 超时，对外只暴露成功/失败。
3. **ES import 替代 require**：使用 `import { spawn } from 'child_process'` 而非原来的 `require('child_process')`，符合 ESM 规范。

## Rationale

- **消除口头契约**（#5）：两份解析逻辑现在共享同一个深模块，修改一处即可同步两处行为，无需靠注释提醒。
- **可测试性**（#5 + #6）：`mcpConfigResolver` 的检测函数是纯函数，`piInstaller` 的 `installPiSdk` 可通过 mock `spawn` 测试。17 个 mcpConfigResolver 测试全部通过。
- **IPC handler 瘦身**：`mcp:probeServer` handler 从 ~55 行降至 ~15 行，`installPiSdk` handler 从 ~70 行降至 3 行。
- **行为不变**：除了 #5 的 env 合并对齐外，所有外部可观察行为不变。

## Consequences

- `claudeCodeIPC.ts` 减少约 125 行内联逻辑。
- 新增两个独立模块，各有清晰的单一职责。
- `mcpConfigStore.ts` 的 import 从 `findCuaDriverBinary` + `getBrowserUseMcpServerConfig` 改为 `builtinNameFromServerKey` + `resolveBuiltinMcp`，依赖更加语义化。
- `mcpConfigResolver.test.ts`（183 行，17 个测试）覆盖了检测函数的边界情况和解析器的成功/失败路径。
