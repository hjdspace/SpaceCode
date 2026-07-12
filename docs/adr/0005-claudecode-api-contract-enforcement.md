# ADR-0005: ElectronClaudeCodeAPI 作为 preload 与 h5Adapter 之间的编译期契约

Date: 2026-07-13

## Status

Accepted

## Context

`ElectronClaudeCodeAPI` 接口已存在于 `src/types/electron.d.ts`（52 个方法），描述 preload.ts 通过 `contextBridge.exposeInMainWorld` 暴露给渲染进程的 `claudeCode` 表面。但该接口从未被强制执行：

- `preload.ts` 的 `claudeCode` 对象内联在 `contextBridge.exposeInMainWorld(...)` 调用中，参数大量使用 `any`，无类型约束。
- `h5Adapter.ts` 的 `createH5Adapter()` 返回一个结构相似的对象字面量，但既不导入也不 `satisfies` 接口——两个实现各自演化，接口形同虚设。
- `h5Adapter.ts` 还携带 2 个接口外的方法（`onCompact`、`onApiRetry`），无任何消费者通过 `api.claudeCode` 调用——死代码污染契约表面。
- `src/services/electronAPI.ts` 的 `api.claudeCode` getter 返回类型被推断为 `ReturnType<typeof createH5Adapter> | ElectronClaudeCodeAPI | null`，消费者看到的是实现特定类型而非契约类型。
- `h5Adapter` 变量类型为 `ReturnType<typeof createH5Adapter> | null`，同样暴露实现细节。

## Decision

将已有的 `ElectronClaudeCodeAPI` 接口作为 preload 与 h5Adapter 之间的编译期契约，用 `satisfies` 强制执行，而非另建新接口。

### 变更

1. **接口修正** — `onError?` → `onError`（必需）。preload 与 h5Adapter 两端都实现了此回调，可选性是笔误。

2. **h5Adapter.ts** — `createH5Adapter()` 返回值加 `satisfies ElectronClaudeCodeAPI`。删除死代码 `onCompact` / `onApiRetry`（grep 确认无消费者）。

3. **preload.ts** — `claudeCode` 对象字面量末尾加 `satisfies ElectronClaudeCodeAPI`。inline 写法，无需抽取为独立 const。

4. **electronAPI.ts** — `h5Adapter` 变量类型从 `ReturnType<typeof createH5Adapter> | null` 收窄为 `ElectronClaudeCodeAPI | null`；`api.claudeCode` getter 加显式返回类型 `ElectronClaudeCodeAPI | null`。

### 为什么用 `satisfies` 而非类型标注

- `satisfies` 在不改变推断类型的前提下检查可赋值性——对象内部各方法仍保留最具体的返回类型，避免向 `unknown` 退化。
- 对对象字面量触发 excess property check——h5Adapter 的 `onCompact` / `onApiRetry` 因此被暴露为多余属性，驱动删除。
- preload.ts 内联对象同样受益：缺失方法或签名偏移立即报错。

### 为什么不另建 `ClaudeCodeApi` 接口

`ElectronClaudeCodeAPI` 已是事实契约（`ElectronAPI.claudeCode: ElectronClaudeCodeAPI` 在 `electron.d.ts:486`）。另建只会制造两个并行接口，增加同步成本。直接强制执行现有接口，churn 最小。

## Consequences

### 正面

- preload 与 h5Adapter 必须同时满足同一接口——新增方法时，缺一即编译失败。
- `api.claudeCode` 返回类型为 `ElectronClaudeCodeAPI | null`，消费者只看到契约表面，不依赖实现特定类型。
- 死代码 `onCompact` / `onApiRetry` 已清除。
- 未来可渐进收紧接口中的 `unknown` / `any` 为精确类型，每收紧一处编译器即指出两端差异。

### 负面

- 接口仍大量使用 `unknown` / `any`（事件回调 `data: any`、返回值 `Promise<unknown>`），类型安全性有限。这是历史债务，需后续渐进收紧。
- `satisfies` 对对象字面量触发 excess property check——未来 h5Adapter 若需添加接口外方法，必须同时更新接口或改用类型标注。这反而是约束力的体现。

## Related

- ADR-0002 — H5 模式在 API 层适配；本 ADR 为 `api.claudeCode` 接缝提供编译期保证。
- ADR-0004 — Engine Gateway 是 preload → IPC → engine 路径上的深模块；本 ADR 是 preload ↔ h5Adapter 对等路径上的契约。
