# Token计数与上下文用量统计架构文档

## 一、架构概述

桌面应用的Token计数和上下文用量统计涉及三个主要层级：

1. **Engine层 (engine/)**: Claude Code核心引擎，负责实际的Token计数和上下文分析
2. **Electron层 (electron/)**: 桌面应用的后端，负责进程管理、IPC通信和协议处理
3. **前端层 (src/)**: Vue 3前端应用，负责展示Token统计和上下文用量

### 1.1 核心数据流

```
用户输入消息
    ↓
前端 → Electron (IPC) → Engine
    ↓                    ↓
前端显示 ← Electron ← Engine响应
```

---

## 二、Engine层 (后端核心)

Engine层是Token计数和上下文分析的核心实现所在。

### 2.1 Token计数机制

#### 2.1.1 主要文件

| 文件 | 职责 |
|------|------|
| `engine/src/services/tokenEstimation.ts` | Token计数服务核心实现 |
| `engine/src/utils/tokens.ts` | Token相关工具函数 |
| `engine/src/utils/analyzeContext.ts` | 上下文分析核心逻辑 |
| `engine/src/cost-tracker.ts` | 成本和Token累积追踪 |

#### 2.1.2 Token计数方法

Engine支持三种Token计数方法，按优先级依次尝试：

```typescript
// 优先级1: Anthropic API计数 (最准确)
countMessagesTokensWithAPI()

// 优先级2: Haiku降级方案 (API失败时使用)
countTokensViaHaikuFallback()

// 优先级3: 粗略估算 (字符/4)
roughTokenCountEstimation()
```

**API计数实现** ([tokenEstimation.ts:L124-206](file:///workspace/engine/src/services/tokenEstimation.ts#L124-206)):
```typescript
export async function countMessagesTokensWithAPI(
  messages: Anthropic.Beta.Messages.BetaMessageParam[],
  tools: Anthropic.Beta.Messages.BetaToolUnion[],
): Promise<number | null> {
  const anthropic = await getAnthropicClient(...)
  const response = await anthropic.beta.messages.countTokens({
    model: normalizeModelStringForAPI(model),
    messages,
    tools,
    ...
  })
  return response.input_tokens
}
```

**粗略估算** ([tokenEstimation.ts:L208-213](file:///workspace/engine/src/services/tokenEstimation.ts#L208-213)):
```typescript
export function roughTokenCountEstimation(
  content: string,
  bytesPerToken: number = 4,
): number {
  return Math.round(content.length / bytesPerToken)
}
```

#### 2.1.3 Token数据结构

Engine在消息中存储的Token信息 ([tokens.ts:L7-22](file:///workspace/engine/src/utils/tokens.ts#L7-22)):

```typescript
export function getTokenUsage(message: Message): Usage | undefined {
  if (message?.type === 'assistant' && message.message && 'usage' in message.message) {
    return message.message.usage as Usage
  }
  return undefined
}
```

**API返回的Usage结构**:
```typescript
interface BetaUsage {
  input_tokens: number              // 实际输入Token数
  output_tokens: number             // 输出Token数
  cache_creation_input_tokens?: number  // 缓存创建Token数
  cache_read_input_tokens?: number      // 缓存读取Token数
}
```

### 2.2 上下文用量分析

#### 2.2.1 ContextData数据结构

Engine的上下文分析结果 ([analyzeContext.ts:L219-261](file:///workspace/engine/src/utils/analyzeContext.ts#L219-261)):

```typescript
export interface ContextData {
  readonly categories: ContextCategory[]      // 各分类Token分布
  readonly totalTokens: number               // 总Token数
  readonly maxTokens: number                 // 最大Token数(上下文窗口)
  readonly rawMaxTokens: number              // 原始最大Token数
  readonly percentage: number                // 使用百分比
  readonly gridRows: GridSquare[][]          // 可视化网格数据
  readonly model: string                     // 当前模型
  readonly memoryFiles: MemoryFile[]         // 内存文件Token详情
  readonly mcpTools: McpTool[]              // MCP工具Token详情
  readonly agents: Agent[]                  // 自定义Agent详情
  readonly messageBreakdown?: {             // 消息Token分解
    toolCallTokens: number
    toolResultTokens: number
    attachmentTokens: number
    assistantMessageTokens: number
    userMessageTokens: number
  }
  readonly apiUsage: {                      // API实际用量
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null
}
```

#### 2.2.2 上下文分类

Engine将上下文按以下分类统计 ([analyzeContext.ts:L1073-1163](file:///workspace/engine/src/utils/analyzeContext.ts#L1073-1163)):

| 分类 | 说明 | Token来源 |
|------|------|----------|
| System prompt | 系统提示词 | countSystemTokens() |
| System tools | 内置工具定义 | countBuiltInToolTokens() |
| MCP tools | MCP服务器工具 | countMcpToolTokens() |
| Custom agents | 自定义Agent | countCustomAgentTokens() |
| Memory files | CLAUDE.md等内存文件 | countMemoryFileTokens() |
| Skills | Skills定义 | countSkillTokens() |
| Messages | 对话消息 | approximateMessageTokens() |
| Autocompact buffer | 自动压缩预留空间 | getEffectiveContextWindowSize() |
| Free space | 剩余空间 | 计算得出 |

#### 2.2.3 analyzeContextUsage 函数

这是核心的上下文分析函数 ([analyzeContext.ts:L978-1448](file:///workspace/engine/src/utils/analyzeContext.ts#L978-1448)):

```typescript
export async function analyzeContextUsage(
  messages: Message[],
  model: string,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  tools: Tools,
  agentDefinitions: AgentDefinitionsResult,
  ...
): Promise<ContextData> {
  // 1. 获取上下文窗口大小
  const contextWindow = getContextWindowForModel(runtimeModel, getSdkBetas())

  // 2. 并行计算各分类Token数
  const [
    { systemPromptTokens, systemPromptSections },
    { claudeMdTokens, memoryFileDetails },
    { builtInToolTokens, ... },
    { mcpToolTokens, mcpToolDetails, ... },
    { agentTokens, agentDetails },
    messageBreakdown,
  ] = await Promise.all([
    countSystemTokens(effectiveSystemPrompt, roughEstimatesOnly),
    countMemoryFileTokens(roughEstimatesOnly),
    countBuiltInToolTokens(...),
    countMcpToolTokens(...),
    countCustomAgentTokens(...),
    approximateMessageTokens(messages, roughEstimatesOnly),
  ])

  // 3. 构建分类数组
  const cats: ContextCategory[] = []
  // ... 添加各分类

  // 4. 计算总使用量
  const actualUsage = cats.reduce((sum, cat) => sum + (cat.isDeferred ? 0 : cat.tokens), 0)

  // 5. 从消息中提取API实际用量
  const apiUsage = getCurrentUsage(originalMessages ?? messages)

  // 6. 返回完整的ContextData
  return { categories: cats, totalTokens: finalTotalTokens, ... }
}
```

### 2.3 Token追踪与累积

#### 2.3.1 全局状态管理

Engine使用bootstrap/state.ts管理全局Token统计 ([bootstrap/state.ts](file:///workspace/engine/src/bootstrap/state.ts)):

```typescript
type State = {
  totalCostUSD: number
  totalAPIDuration: number
  totalInputTokens: number
  totalOutputTokens: number
  modelUsage: { [modelName: string]: ModelUsage }
  // ...
}
```

#### 2.3.2 成本追踪

每次API响应后，Token会被累积 ([cost-tracker.ts:L278-323](file:///workspace/engine/src/cost-tracker.ts#L278-323)):

```typescript
export function addToTotalSessionCost(
  cost: number,
  usage: Usage,
  model: string,
): number {
  // 更新模型级别的Token统计
  const modelUsage = addToTotalModelUsage(cost, usage, model)
  addToTotalCostState(cost, modelUsage, model)

  // 更新Prometheus计数器
  getTokenCounter()?.add(usage.input_tokens, { ...attrs, type: 'input' })
  getTokenCounter()?.add(usage.output_tokens, { ...attrs, type: 'output' })
  getTokenCounter()?.add(usage.cache_read_input_tokens ?? 0, { type: 'cacheRead' })
  getTokenCounter()?.add(usage.cache_creation_input_tokens ?? 0, { type: 'cacheCreation' })

  // 处理Advisor Tool的Token
  for (const advisorUsage of getAdvisorUsage(usage)) {
    // ...
  }
}
```

### 2.4 Token预算管理

Engine支持Token预算管理 ([query/tokenBudget.ts](file:///workspace/engine/src/query/tokenBudget.ts)):

```typescript
export function checkTokenBudget(
  tracker: BudgetTracker,
  agentId: string | undefined,
  budget: number | null,
  globalTurnTokens: number,
): TokenBudgetDecision {
  const turnTokens = globalTurnTokens
  const pct = Math.round((turnTokens / budget) * 100)

  // 检查是否达到完成阈值
  if (turnTokens < budget * COMPLETION_THRESHOLD) {
    return { action: 'continue', ... }
  }

  return { action: 'stop', ... }
}
```

---

## 三、Electron层 (桌面应用后端)

### 3.1 架构概览

```
前端 (src/)
    ↓ IPC (preload.ts)
Electron主进程 (electron/)
    ↓ 协议通信
Engine进程池 (PiProcessPool / ClaudeCodeProcessPool)
    ↓
Engine子进程 (PiSessionProcess / ClaudeCodeSessionProcess)
```

### 3.2 核心组件

#### 3.2.1 IPC通信层

IPC处理文件: [electron/claudeCodeIPC.ts](file:///workspace/electron/claudeCodeIPC.ts)

**关键IPC处理函数**:

```typescript
// 获取上下文用量
ipcMain.handle('claude-code:getContextUsage', async (_, sessionId: string) => {
  const engine = findEngineForSession(sessionId)
  if (typeof engine.getContextUsage === 'function') {
    return await engine.getContextUsage(sessionId)
  }
  return null
})
```

#### 3.2.2 Engine工厂与多引擎支持

[electron/engines/EngineFactory.ts](file:///workspace/electron/engines/EngineFactory.ts)

```typescript
export class EngineFactory {
  private static engines: Map<EngineType, IEngine> = new Map()

  static getEngine(type: EngineType): IEngine {
    if (!this.engines.has(type)) {
      if (type === 'claude-code') {
        this.engines.set(type, new ClaudeCodeEngine())
      } else if (type === 'pi') {
        this.engines.set(type, new PiEngine())
      }
    }
    return this.engines.get(type)!
  }
}
```

#### 3.2.3 Pi Engine实现

[electron/engines/PiEngine.ts](file:///workspace/electron/engines/PiEngine.ts)

Pi Engine通过RPC与pi-coding-agent通信:

```typescript
export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'
  private pool: PiProcessPool

  async sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    await this.pool.sendMessage(sessionId, content, images)
  }

  async getContextUsage(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const proc = this.pool.getProcess(sessionId)
    if (proc) {
      return await proc.getContextUsage()
    }
  }
}
```

#### 3.2.4 进程池管理

[electron/engines/PiProcessPool.ts](file:///workspace/electron/engines/PiProcessPool.ts)

```typescript
export class PiProcessPool {
  private processes: Map<string, PiSessionProcess> = new Map()

  async sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      throw new Error(`Session ${sessionId} has no active process`)
    }
    await proc.sendMessage(content, images)
  }

  private routeEvent(sessionId: string, eventType: string, data: any): void {
    // 将Pi Engine事件映射并发送到前端
    const unifiedEvent = mapPiEvent(sessionId, { type: eventType, ...data })
    this.mainWindow!.webContents.send(
      `claude-code:${unifiedEvent.type}`,
      { sessionId, data: unifiedEvent.data }
    )
  }
}
```

#### 3.2.5 控制协议

[electron/controlProtocol.ts](file:///workspace/electron/controlProtocol.ts)

用于发送控制请求到Engine进程:

```typescript
export class ControlProtocol {
  getContextUsage(requestId: string = randomUUIDFn(), timeoutMs: number = 5_000) {
    return this.sendControlRequest(
      buildGetContextUsageRequest(requestId),
      timeoutMs,
    )
  }

  private sendControlRequest(message: unknown, timeoutMs: number = 5_000): Promise<any> {
    // 发送请求并等待响应
    return new Promise((resolve, reject) => {
      // 实现超时和响应处理
    })
  }
}
```

### 3.3 Token统计服务

[electron/tokenStatsService.ts](file:///workspace/electron/tokenStatsService.ts)

这是Electron层的历史Token统计服务:

```typescript
export interface TokenStatsResult {
  today: TokenStatsSummary
  yesterday: TokenStatsSummary
  last30Days: TokenStatsSummary
  allTime: TokenStatsSummary
  daily: TokenStatsDailyEntry[]
  modelUsage: Record<string, TokenStatsSummary>
}

export function aggregateLocalTokenStats(): TokenStatsResult {
  // 从~/.claude/projects/目录读取jsonl文件
  // 解析每行的usage信息并汇总
}
```

---

## 四、前端层 (Vue 3应用)

### 4.1 核心Store

#### 4.1.1 ContextUsage Store

[src/stores/contextUsage.ts](file:///workspace/src/stores/contextUsage.ts)

```typescript
export const useContextUsageStore = defineStore('contextUsage', () => {
  const snapshot = ref<ContextUsageSnapshot | null>(null)
  const loading = ref(false)

  async function refresh(sessionId?: string, force = false) {
    // 1. 显示乐观的fallback快照
    snapshot.value = buildFallbackSnapshot(messages, model)

    // 2. 调用Engine获取准确的上下文用量
    if (settingsStore.engineType === 'claude-code') {
      const raw = await fetchEngineContextUsage(sid)
      const data = raw ? parseEngineContextData(raw) : null
      if (data) {
        // 3. 富化数据并构建最终快照
        const enriched = enrichContextDataFromClient(data, messages)
        snapshot.value = buildSnapshotFromEngineData(enriched, model)
      }
    }
  }

  // 用于流式更新时的轻量级更新
  function applyFallback(sessionId?: string) {
    const messages = session?.messages ?? []
    snapshot.value = buildFallbackSnapshot(messages, model)
  }

  return { snapshot, loading, refresh, applyFallback, clear }
})
```

### 4.2 工具函数

[src/utils/contextUsage.ts](file:///workspace/src/utils/contextUsage.ts)

#### 4.2.1 Token估算

```typescript
// 粗略估算 (字符/4)
export function roughTokenEstimate(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

// 从消息估算Token分解
export function estimateMessageBreakdownFromMessages(messages: Message[]): MessageBreakdown {
  // 遍历消息，统计toolCall、toolResult、attachment等Token
}
```

#### 4.2.2 快照构建

```typescript
// 从Engine数据构建快照
export function buildSnapshotFromEngineData(data: ContextUsageData, model: string): ContextUsageSnapshot {
  const sessionTotals = {
    inputTokens: data.apiUsage?.input_tokens ?? 0,
    outputTokens: data.apiUsage?.output_tokens ?? 0,
    cacheReadInputTokens: data.apiUsage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: data.apiUsage?.cache_creation_input_tokens ?? 0,
  }
  // 计算百分比和警告级别
  return { data, usedPercentage, warningLevel, ... }
}

// 构建Fallback快照 (Engine未返回数据时使用)
export function buildFallbackSnapshot(messages: Message[], model: string): ContextUsageSnapshot {
  // 从消息元数据估算
  const lastUsage = getLastApiUsageFromMessages(messages)
  const sessionTotals = sumSessionTokensFromMessages(messages)
  // ...
}
```

#### 4.2.3 数据富化

```typescript
// 富化Engine数据
export function enrichContextDataFromClient(
  data: ContextUsageData,
  messages: Message[],
): ContextUsageData {
  // 如果Engine没有返回messageBreakdown，从消息估算
  if (!enriched.messageBreakdown) {
    enriched.messageBreakdown = estimateMessageBreakdownFromMessages(messages)
  }
  // 规范化分类
  enriched.categories = normalizeContextCategories(enriched, messages)
  return enriched
}
```

### 4.3 类型定义

[src/types/contextUsage.ts](file:///workspace/src/types/contextUsage.ts)

```typescript
export interface ContextUsageData {
  categories: ContextCategory[]
  totalTokens: number
  maxTokens: number
  rawMaxTokens: number
  percentage: number
  model: string
  apiUsage: ContextApiUsage | null
  messageBreakdown?: {
    toolCallTokens: number
    toolResultTokens: number
    attachmentTokens: number
    assistantMessageTokens: number
    userMessageTokens: number
  }
  // ...
}

export interface ContextUsageSnapshot {
  data: ContextUsageData | null
  usedPercentage: number | null
  remainingPercentage: number | null
  warningLevel: ContextWarningLevel  // 'ok' | 'warn' | 'error' | 'blocking'
  percentUntilAutocompact: number | null
  warningMessage: string | null
  sessionTotals: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  }
}
```

### 4.4 组件

#### 4.4.1 ContextUsageChip

[src/components/chat/ContextUsageChip.vue](file:///workspace/src/components/chat/ContextUsageChip.vue)

显示在界面上的Token用量芯片:

```vue
<template>
  <button class="context-chip" :class="[`level-${warningLevel}`]" @click="$emit('open')">
    <span class="chip-dot" />
    <span class="chip-label">Context</span>
    <span class="chip-value">{{ displayPct }}%</span>
    <span class="chip-tokens">{{ tokenPair }}</span>
  </button>
</template>
```

**警告级别样式**:
- `level-ok`: 默认状态 (绿色圆点)
- `level-warn`: 警告状态 (橙色边框和圆点)
- `level-error` / `level-blocking`: 错误状态 (红色边框和圆点)

#### 4.4.2 ContextUsageModal

[src/components/chat/ContextUsageModal.vue](file:///workspace/src/components/chat/ContextUsageModal.vue)

显示详细的上下文用量模态框:

**主要功能**:
1. 环形进度图显示整体使用率
2. 分类列表显示各部分Token分布
3. 会话统计显示累计Token
4. 缓存命中率计算
5. 自动压缩阈值指示

### 4.5 API服务

[src/services/electronAPI.ts](file:///workspace/src/services/electronAPI.ts)

```typescript
export const api = {
  getContextUsage: (sessionId: string): Promise<Record<string, unknown> | undefined> => {
    if (electronAPI?.claudeCode?.getContextUsage) {
      return electronAPI.claudeCode.getContextUsage(sessionId)
    }
    return Promise.resolve(undefined)
  },
  // ...
}
```

---

## 五、数据流详解

### 5.1 用户输入到响应完整流程

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 用户输入消息                                                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. 前端发送消息                                                       │
│    src/ → electronAPI.sendMessage()                                  │
│    → preload.ts → IPC 'claude-code:sendMessage'                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Electron转发到Engine                                               │
│    claudeCodeIPC.ts → PiEngine.sendMessage()                          │
│    → PiProcessPool.sendMessage() → PiSessionProcess.sendMessage()      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Engine处理请求并调用API                                             │
│    - 分析上下文                                                       │
│    - 构造API请求                                                      │
│    - 调用Anthropic API                                               │
│    - 获取Token计数 (usage)                                           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. Engine返回响应                                                     │
│    - 通过stdout发送JSON事件                                           │
│    - 包含message.usage (input_tokens, output_tokens等)                │
│    - 事件包含streaming数据                                            │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 6. Electron处理响应事件                                               │
│    PiSessionProcess.handleAgentEvent()                               │
│    → PiProcessPool.routeEvent()                                       │
│    → mapPiEvent() 事件映射                                           │
│    → webContents.send() 发送到前端                                    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 7. 前端接收并更新UI                                                   │
│    preload.ts 监听事件                                                │
│    → chatStore 更新消息                                               │
│    → contextUsageStore.applyFallback() 快速更新用量显示               │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 上下文用量获取流程

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 用户点击Context芯片/模态框                                          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. 前端调用getContextUsage                                            │
│    contextUsageStore.refresh()                                        │
│    → api.getContextUsage(sessionId)                                   │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Electron转发请求                                                   │
│    preload.ts → IPC 'claude-code:getContextUsage'                     │
│    → EngineFactory.getEngine().getContextUsage()                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Engine执行analyzeContextUsage                                      │
│    - 调用countMessagesTokensWithAPI()                                 │
│    - 调用countToolDefinitionTokens()                                  │
│    - 调用countSystemTokens()                                         │
│    - 调用countMemoryFileTokens()                                      │
│    - 调用approximateMessageTokens()                                   │
│    - 汇总分类数据                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. 返回ContextData                                                   │
│    → Electron → 前端                                                  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 6. 前端构建快照并显示                                                  │
│    buildSnapshotFromEngineData()                                      │
│    → ContextUsageModal 显示详情                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 六、代码复用情况

### 6.1 前端是否复用后端代码？

**答案：不是直接复用，而是重新实现。**

前端和Engine有各自独立的Token计数实现:

| 功能 | Engine实现 | 前端实现 |
|------|----------|---------|
| 粗略估算 | `roughTokenCountEstimation()` | `roughTokenEstimate()` |
| 分类统计 | `analyzeContextUsage()` | `normalizeContextCategories()` |
| 消息分解 | `approximateMessageTokens()` | `estimateMessageBreakdownFromMessages()` |

**关键差异**:
1. **Engine使用API计数**: 通过Anthropic API的countTokens端点
2. **前端使用字符估算**: 简单的`length/4`公式
3. **目的不同**: Engine用于精确分析和决策，前端用于快速显示

### 6.2 前端的"降级方案"策略

前端采用**乐观更新+降级**策略 ([contextUsage.ts:L84-108](file:///workspace/src/stores/contextUsage.ts#L84-108)):

```typescript
async function refresh(sessionId?: string, force = false) {
  // Step 1: 立即显示估算值 (乐观更新)
  snapshot.value = buildFallbackSnapshot(messages, model)

  // Step 2: 异步获取Engine精确数据
  loading.value = true
  try {
    const raw = await fetchEngineContextUsage(sid)
    if (raw) {
      // Step 3: 收到Engine数据后更新
      snapshot.value = buildSnapshotFromEngineData(enriched, model)
    }
  } catch {
    // 保持fallback快照
  } finally {
    loading.value = false
  }
}
```

---

## 七、关键设计决策

### 7.1 Token计数精度

| 场景 | 精度要求 | 实现方式 |
|------|---------|---------|
| API请求构造 | 高精度 | 使用API countTokens |
| 上下文分析 | 高精度 | API countTokens + Haiku降级 |
| UI快速更新 | 中等精度 | 字符/4估算 |
| 缓存判断 | 高精度 | API返回的真实值 |

### 7.2 性能优化

1. **并行计算**: `analyzeContextUsage`使用`Promise.all()`并行计算各分类
2. **批量API调用**: MCP工具只做一次批量计数，而不是逐个调用
3. **超时保护**: Engine的`getContextUsage`有3.5秒超时
4. **事件节流**: 流式更新时使用`applyFallback`避免频繁IPC

### 7.3 容错设计

1. **API失败降级**: countTokens API失败时降级到Haiku，再降级到估算
2. **Engine不可用**: 前端使用fallback快照
3. **IPC超时**: 3.5秒后返回undefined，前端保持旧数据

---

## 八、文件索引

### Engine层
- `engine/src/services/tokenEstimation.ts` - Token计数服务
- `engine/src/utils/tokens.ts` - Token工具函数
- `engine/src/utils/analyzeContext.ts` - 上下文分析核心
- `engine/src/cost-tracker.ts` - 成本追踪
- `engine/src/query/tokenBudget.ts` - Token预算管理
- `engine/src/utils/context.ts` - 上下文窗口计算

### Electron层
- `electron/claudeCodeIPC.ts` - IPC通信
- `electron/tokenStatsService.ts` - Token统计服务
- `electron/engines/EngineFactory.ts` - Engine工厂
- `electron/engines/PiEngine.ts` - Pi Engine
- `electron/engines/PiProcessPool.ts` - 进程池
- `electron/engines/PiSessionProcess.ts` - 会话进程
- `electron/controlProtocol.ts` - 控制协议

### 前端层
- `src/stores/contextUsage.ts` - 上下文用量Store
- `src/utils/contextUsage.ts` - 上下文用量工具
- `src/types/contextUsage.ts` - 类型定义
- `src/components/chat/ContextUsageChip.vue` - 芯片组件
- `src/components/chat/ContextUsageModal.vue` - 模态框组件
- `src/services/electronAPI.ts` - Electron API服务
