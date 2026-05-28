# 桌面应用完全复用 Engine Token 计数和上下文用量统计的实现方案

## 一、核心发现

经过深入代码分析，我们发现桌面应用的 `claude-code` 引擎**已经完全实现了 Token 计数和上下文用量统计的复用**！本方案将详细说明现有架构、如何使用它、以及如何进一步完善。

---

## 二、现有架构分析

### 2.1 完整的实现链路

```
前端 UI 组件
    ↓
contextUsage.ts (Store)
    ↓ (IPC)
ClaudeCodeIPC.ts
    ↓
ClaudeCodeEngine.ts
    ↓
ClaudeCodeProcessPool.ts
    ↓
SessionProcess.ts
    ↓
ControlProtocol.ts
    ↓
Engine 子进程 (stdio JSON 协议)
    ↓
engine/src/cli/print.ts (get_context_usage handler)
    ↓
engine/src/commands/context/context-noninteractive.ts (collectContextData)
    ↓
engine/src/utils/analyzeContext.ts (analyzeContextUsage)
    ↓
engine/src/services/tokenEstimation.ts (countMessagesTokensWithAPI)
```

### 2.2 各层关键实现

#### 2.2.1 Engine 层 (engine/src/)

**Token 计数核心逻辑** ([tokenEstimation.ts](file:///workspace/engine/src/services/tokenEstimation.ts)):
- `countMessagesTokensWithAPI()`: 通过 Anthropic API 的 countTokens 端点进行精确计数
- `countTokensViaHaikuFallback()`: API 失败时的 Haiku 降级方案
- `roughTokenCountEstimation()`: 最底层的字符估算

**上下文分析核心** ([analyzeContext.ts](file:///workspace/engine/src/utils/analyzeContext.ts)):
- `analyzeContextUsage()`: 核心函数，并行计算各分类的 Token 使用
- 包含 System Prompt、Built-in Tools、MCP Tools、Agents、Memory Files、Messages 等分类
- 支持自动压缩阈值分析

**控制协议处理** ([print.ts:2976](file:///workspace/engine/src/cli/print.ts#L2976)):
```typescript
} else if (msg.request.subtype === 'get_context_usage') {
  try {
    const appState = getAppState()
    const data = await collectContextData({
      messages: mutableMessages,
      getAppState,
      fast: true,
      options: {
        mainLoopModel: getMainLoopModel(),
        tools: buildAllTools(appState),
        agentDefinitions: appState.agentDefinitions,
        customSystemPrompt: options.systemPrompt,
        appendSystemPrompt: options.appendSystemPrompt,
      },
    })
    sendControlResponseSuccess(msg, { ...data })
  } catch (error) {
    sendControlResponseError(msg, errorMessage(error))
  }
```

#### 2.2.2 Electron 层 (electron/)

**控制协议封装** ([controlProtocol.ts:730](file:///workspace/electron/controlProtocol.ts#L730)):
```typescript
getContextUsage(requestId: string = randomUUIDFn(), timeoutMs: number = 5_000) {
  return this.sendControlRequest(
    buildGetContextUsageRequest(requestId) as { request_id: string } & Record<string, unknown>,
    timeoutMs,
  )
}
```

**SessionProcess 实现** ([sessionProcess.ts:567](file:///workspace/electron/sessionProcess.ts#L567)):
```typescript
getContextUsage(): Promise<Record<string, unknown> | undefined> {
  if (!this.process?.stdin?.writable) {
    return Promise.reject(new Error('No active process'))
  }
  return this.controlProtocol.getContextUsage()
}
```

**IPC 接口** ([preload.ts:368](file:///workspace/electron/preload.ts#L368)):
```typescript
getContextUsage: (sessionId: string) =>
  ipcRenderer.invoke('claude-code:getContextUsage', sessionId),
```

#### 2.2.3 前端层 (src/)

**Store 实现** ([contextUsage.ts](file:///workspace/src/stores/contextUsage.ts)):
- `refresh()`: 获取 Engine 精确数据
- `applyFallback()`: 用于流式响应期间的轻量级更新
- 关键判断：第 92 行 `if (settingsStore.engineType === 'claude-code')`

**数据转换流程**:
1. `fetchEngineContextUsage()` → 获取 Engine 原始数据
2. `parseEngineContextData()` → 解析为前端类型
3. `enrichContextDataFromClient()` → 补充客户端数据
4. `buildSnapshotFromEngineData()` → 构建 UI 快照

**UI 组件**:
- [ContextUsageChip.vue](file:///workspace/src/components/chat/ContextUsageChip.vue): 显示百分比和 Token 数
- [ContextUsageModal.vue](file:///workspace/src/components/chat/ContextUsageModal.vue): 显示详细分类

---

## 三、如何启用 Engine 精确 Token 计数

### 3.1 前提条件

确保使用的是 `claude-code` 引擎，而不是 `pi` 引擎：

```typescript
// 在 src/stores/settings.ts 中确认
config.engineType === 'claude-code'  // true
```

### 3.2 当前默认行为

桌面应用对于 `claude-code` 引擎：
1. **首次打开上下文模态框时**：立即显示 client 端估算值，然后在后台获取 Engine 精确值
2. **后续打开**：直接使用上次缓存的 Engine 数据（除非强制刷新）
3. **流式响应期间**：使用 `applyFallback()` 做轻量级更新，不调用 Engine IPC

---

## 四、完善方案建议

### 4.1 方案一：为 Pi 引擎添加 Token 计数支持（如果需要）

由于 `pi` 引擎是独立项目，但我们可以通过以下方式添加支持：

1. **在 PiEngine 中实现 getContextUsage**
   ```typescript
   // electron/engines/PiEngine.ts
   async getContextUsage(sessionId: string) {
     return this.pool.getContextUsage(sessionId)
   }
   ```

2. **在 PiSessionProcess 中添加 RPC 支持**
   ```typescript
   async getContextUsage(): Promise<Record<string, unknown> | undefined> {
     const id = ++this._requestId
     const command = { id, type: 'get_context_usage' }
     
     const responsePromise = new Promise<any>((resolve, reject) => {
       const timeout = setTimeout(() => {
         this._pendingRequests.delete(id)
         reject(new Error('Timeout waiting for context usage'))
       }, 5000)
       
       this._pendingRequests.set(id, {
         resolve: (response) => {
           clearTimeout(timeout)
           resolve(response)
         },
         reject: (error) => {
           clearTimeout(timeout)
           reject(error)
         }
       })
     })
     
     const message = JSON.stringify(command) + '\n'
     this._process.stdin?.write(message)
     
     return responsePromise
   }
   ```

3. **修改前端 Store**
   ```typescript
   // src/stores/contextUsage.ts:92
   // if (settingsStore.engineType === 'claude-code' || settingsStore.engineType === 'pi') {
   if (settingsStore.engineType === 'claude-code') {  // 保持原样
     // 当 pi 引擎支持后可以去掉条件
     const raw = await fetchEngineContextUsage(sid)
     // ...
   }
   ```

### 4.2 方案二：优化现有实现的用户体验

#### 4.2.1 增加自动刷新时机

在关键用户操作后自动刷新：
- 新消息发送后
- 模型切换后
- 打开 MCP 服务器后

```typescript
// 在 src/stores/chat.ts 的 sendMessage 完成后
// 调用 contextUsageStore.refresh(force=true)
```

#### 4.2.2 优化流式响应期间的 Token 更新

当前流式期间只使用 client 估算，可以考虑在停顿间隙（比如 500ms 没有新内容）时调用一次 Engine 获取精确值。

#### 4.2.3 增加 Cache Token 显示

Engine 返回的 `apiUsage` 包含了 `cache_read_input_tokens` 和 `cache_creation_input_tokens`，当前 UI 没有专门展示这些可以帮助用户理解缓存效果的数据。

---

## 五、完全复用 Engine 代码的技术方案

### 5.1 最佳实践：当前架构已经是最佳状态

当前架构已经做到了：
1. ✅ **计算完全在 Engine 端**：前端不做任何精确计算
2. ✅ **复用同一个算法**：TUI 和桌面用相同的 `analyzeContextUsage`
3. ✅ **保持类型安全**：通过 Zod schema ([controlSchemas.ts](file:///workspace/engine/src/entrypoints/sdk/controlSchemas.ts))
4. ✅ **容错降级**：Engine 不可用时，前端自动回退到估算
5. ✅ **乐观更新**：先显示估算值，有了精确值再更新

### 5.2 唯一可以改进的：共享类型定义

当前前端和后端的类型是重复定义的，可以考虑：

1. **创建共享类型包**
   ```
   packages/shared-types/
     ├── context-usage.ts
     └── index.ts
   ```

2. **在 engine/src/entrypoints/sdk/controlSchemas.ts 中导出类型**
   ```typescript
   // 已有 SDKControlGetContextUsageResponseSchema
   // 可以同时导出 TypeScript 类型
   export type SDKControlGetContextUsageResponse = z.infer<typeof SDKControlGetContextUsageResponseSchema>
   ```

3. **前端直接导入**
   ```typescript
   import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-code/sdk'
   ```

---

## 六、实现总结

### 6.1 现有功能已支持

桌面应用对于 `claude-code` 引擎：
- ✅ **完全复用 Engine 的 Token 计数算法**（API 调用、Haiku 降级、估算）
- ✅ **完全复用 Engine 的上下文分类逻辑**
- ✅ **通过 stdio JSON 协议获取结构化数据**
- ✅ **前端负责 UI 渲染，不做业务计算**

### 6.2 使用方式

无需任何额外配置，只要使用 `claude-code` 引擎，打开 ContextUsage 模态框就能看到 Engine 精确计算的数据。

### 6.3 未来改进建议

1. 为 `pi` 引擎添加相同支持（如果需要）
2. 优化刷新时机，减少用户等待
3. 增加 Cache Token 可视化
4. 共享类型定义，减少重复代码

---

## 七、关键代码索引

| 功能 | 文件位置 |
|------|----------|
| Engine get_context_usage 处理 | [engine/src/cli/print.ts:2976](file:///workspace/engine/src/cli/print.ts#L2976) |
| 上下文分析核心 | [engine/src/utils/analyzeContext.ts](file:///workspace/engine/src/utils/analyzeContext.ts) |
| Token 计数服务 | [engine/src/services/tokenEstimation.ts](file:///workspace/engine/src/services/tokenEstimation.ts) |
| Control Protocol 实现 | [electron/controlProtocol.ts:730](file:///workspace/electron/controlProtocol.ts#L730) |
| 前端 Store | [src/stores/contextUsage.ts](file:///workspace/src/stores/contextUsage.ts) |
| 前端 IPC 调用 | [src/services/electronAPI.ts](file:///workspace/src/services/electronAPI.ts) |
| 芯片组件 | [src/components/chat/ContextUsageChip.vue](file:///workspace/src/components/chat/ContextUsageChip.vue) |
| 模态框组件 | [src/components/chat/ContextUsageModal.vue](file:///workspace/src/components/chat/ContextUsageModal.vue) |
