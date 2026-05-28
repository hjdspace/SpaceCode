# Token 计数问题深度分析报告

## 一、问题概述

用户报告：发送一条消息后，Token 占用直接达到 35%。经过深入代码分析，确认存在以下问题。

---

## 二、核心问题定位

### 问题 1：桌面应用使用 `fast: true` 导致精确计数被跳过

**文件**：[engine/src/cli/print.ts:2982](file:///workspace/engine/src/cli/print.ts#L2982)

```typescript
const data = await collectContextData({
  messages: mutableMessages,
  getAppState,
  fast: true,  // ⚠️ 这里是问题根源！
  options: {...}
})
```

**影响**：
- 当 `fast: true` 时，`collectContextData` 传入 `roughEstimatesOnly: true`
- 这导致 `analyzeContextUsage` 跳过 API 精确计数
- 直接使用粗略估算替代

**代码路径**：

1. [collectContextData](file:///workspace/engine/src/commands/context/context-noninteractive.ts#L79) → `fast ? { roughEstimatesOnly: true } : undefined`

2. [analyzeContextUsage](file:///workspace/engine/src/utils/analyzeContext.ts#L991) → `const roughEstimatesOnly = analyzeOptions?.roughEstimatesOnly ?? false`

3. [countTokensWithFallback](file:///workspace/engine/src/utils/analyzeContext.ts#L92-L100) → 直接返回粗略估算

```typescript
async function countTokensWithFallback(
  messages, tools, roughEstimatesOnly = false,
): Promise<number | null> {
  if (roughEstimatesOnly) {
    const roughEstimate = roughEstimateTokensFromPayload(messages, tools)
    return roughEstimate > 0 ? roughEstimate : null  // 直接返回估算！
  }
  // 以下代码不会执行
  try {
    const result = await countMessagesTokensWithAPI(messages, tools)
    if (result !== null) return result
  } catch {...}
  // ...
}
```

---

### 问题 2：粗略估算方法不准确

**文件**：[analyzeContext.ts:77-89](file:///workspace/engine/src/utils/analyzeContext.ts#L77-89)

```typescript
function roughEstimateTokensFromPayload(
  messages: Anthropic.Beta.Messages.BetaMessageParam[],
  tools: Anthropic.Beta.Messages.BetaToolUnion[],
): number {
  let total = 0
  for (const msg of messages) {
    total += roughTokenCountEstimation(jsonStringify(msg))  // ⚠️ JSON序列化！
  }
  for (const tool of tools) {
    total += roughTokenCountEstimation(jsonStringify(tool))
  }
  return total
}
```

**问题分析**：
1. `jsonStringify(msg)` 会为字符串添加额外的引号和转义字符
2. 估算公式是 `length / 4`，对于 JSON 格式不适用
3. 工具定义通常很大，JSON序列化后体积会显著增加
4. 没有考虑 Anthropic 的特殊 token 规则（如 `→` 等符号）

**估算偏大的原因**：
```
实际API输入:  {"role":"user","content":"Hello"}
JSON字符串:   "{\"role\":\"user\",\"content\":\"Hello\"}"
长度增加:     多了 6 个转义字符 ≈ 15% 额外开销
```

---

### 问题 3：`getCurrentUsage` 只返回最后一条消息的 usage

**文件**：[engine/src/utils/tokens.ts:140-159](file:///workspace/engine/src/utils/tokens.ts#L140-159)

```typescript
export function getCurrentUsage(messages: Message[]): {...} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (usage) {
      return {  // ⚠️ 只返回最后一条有 usage 的消息
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: ...,
        cache_read_input_tokens: ...,
      }
    }
  }
  return null
}
```

**问题**：
- 只返回最后一条 assistant 消息的 usage
- 不是整个上下文的累计 token 使用量
- 如果最后一条消息特别大，百分比会被高估

---

### 问题 4：`finalTotalTokens` 计算逻辑

**文件**：[analyzeContext.ts:1229-1240](file:///workspace/engine/src/utils/analyzeContext.ts#L1229-1240)

```typescript
// Extract API usage from original messages (if provided) to match status line
const apiUsage = getCurrentUsage(originalMessages ?? messages)

// When API usage is available, use it for total to match status line calculation
// Status line uses: input_tokens + cache_creation_input_tokens + cache_read_input_tokens
const totalFromAPI = apiUsage
  ? apiUsage.input_tokens +
    apiUsage.cache_creation_input_tokens +
    apiUsage.cache_read_input_tokens
  : null

// Use API total if available, otherwise fall back to estimated total
const finalTotalTokens = totalFromAPI ?? totalIncludingReserved
```

**逻辑分析**：
1. 优先使用 `totalFromAPI`（来自最后一条消息的 usage）
2. 如果 `totalFromAPI` 为 null，才使用粗略估算的 `totalIncludingReserved`
3. **但是**：当 `fast=true` 时，虽然有 `apiUsage`，但它只反映最后一条消息

---

## 三、前端数据处理分析

### 当前流程

1. **首次打开模态框** ([contextUsage.ts:85](file:///workspace/src/stores/contextUsage.ts#L85))：
   ```typescript
   snapshot.value = buildFallbackSnapshot(messages, model)  // 先显示估算
   ```

2. **获取 Engine 数据后** ([contextUsage.ts:96-97](file:///workspace/src/stores/contextUsage.ts#L96-97))：
   ```typescript
   const enriched = enrichContextDataFromClient(data, messages)
   snapshot.value = buildSnapshotFromEngineData(enriched, model)  // 替换为 Engine 数据
   ```

3. **流式响应期间** ([contextUsage.ts:134](file:///workspace/src/stores/contextUsage.ts#L134))：
   ```typescript
   snapshot.value = buildFallbackSnapshot(messages, model)  // 使用估算更新
   ```

### `buildSnapshotFromEngineData` 的百分比计算

[contextUsage.ts:468-470](file:///workspace/src/utils/contextUsage.ts#L468-470)：

```typescript
const { used, remaining } = calculateContextPercentages(data.apiUsage, ctxSize)
const { percentLeft, warningLevel, warningMessage } = calculateTokenWarningState(
  data.totalTokens,  // ⚠️ 使用的是 totalTokens，不是 apiUsage
  model,
  data.isAutoCompactEnabled,
)
```

**问题**：
- `usedPercentage` 来自 `apiUsage`
- `warningLevel` 来自 `data.totalTokens`
- 这两个可能不一致

---

## 四、35% 占比的可能原因

### 原因 1：JSON 序列化导致估算偏大

如果用户发送的消息包含：
- 工具定义（JSON序列化后体积大）
- 多轮对话历史
- MCP 工具配置

估算可能会显著偏大。

### 原因 2：只使用最后一条消息的 usage

如果最后一条 assistant 消息很大，`apiUsage` 会虚高。

### 原因 3：`fast=true` 时的粗略估算

即使 `apiUsage` 存在，如果 `totalFromAPI` 为 null，系统会使用粗略估算。

---

## 五、解决方案建议

### 方案 1：将 `fast` 改为 `false`（推荐）

```typescript
// engine/src/cli/print.ts:2982
const data = await collectContextData({
  messages: mutableMessages,
  getAppState,
  fast: false,  // 改这里！使用 API 精确计数
  options: {...}
})
```

**优点**：
- 使用 Anthropic API 的 `countTokens` 端点进行精确计数
- 与 TUI 的 `/context` 命令行为一致
- 计数结果更准确

**缺点**：
- 首次调用可能稍慢（需要网络请求）
- 可以通过缓存优化

### 方案 2：改进粗略估算算法

如果不方便修改 `fast` 参数，可以改进估算方法：

```typescript
function roughEstimateTokensFromPayload(messages, tools) {
  let total = 0
  for (const msg of messages) {
    // 直接估算 content，而不是整个消息对象
    if (msg.content) {
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : JSON.stringify(msg.content)
      total += roughTokenCountEstimation(content)
    }
  }
  // ... 工具估算
}
```

### 方案 3：使用累计 usage 而不是最后一条消息

修改 `getCurrentUsage` 或添加新的累计函数：

```typescript
export function getTotalUsage(messages: Message[]): {...} {
  let inputTokens = 0
  let outputTokens = 0
  let cacheCreationInputTokens = 0
  let cacheReadInputTokens = 0

  for (const msg of messages) {
    const usage = getTokenUsage(msg)
    if (usage) {
      inputTokens += usage.input_tokens
      outputTokens += usage.output_tokens
      cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0
      cacheReadInputTokens += usage.cache_read_input_tokens ?? 0
    }
  }

  return { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens }
}
```

### 方案 4：前端优先使用 `apiUsage` 计算百分比

修改 `buildSnapshotFromEngineData`：

```typescript
// 使用 apiUsage 计算总token数，而不是 totalTokens
const totalFromApiUsage = data.apiUsage 
  ? getContextFillFromApiUsage(data.apiUsage)
  : data.totalTokens

const percentage = Math.min(100, Math.round((totalFromApiUsage / ctxSize) * 100))
```

---

## 六、修复清单

| 优先级 | 问题 | 修复位置 | 修复方案 |
|--------|------|----------|----------|
| P0 | `fast=true` 导致粗略估算 | [print.ts:2982](file:///workspace/engine/src/cli/print.ts#L2982) | 改为 `fast: false` |
| P1 | `getCurrentUsage` 只返回最后一条 | [tokens.ts:140](file:///workspace/engine/src/utils/tokens.ts#L140) | 添加累计函数 |
| P2 | 粗略估算使用 JSON 序列化 | [analyzeContext.ts:77](file:///workspace/engine/src/utils/analyzeContext.ts#L77) | 改进估算方法 |
| P2 | 前端百分比计算不一致 | [contextUsage.ts:468](file:///workspace/src/utils/contextUsage.ts#L468) | 统一使用 apiUsage |

---

## 七、验证方法

修复后，可以通过以下方式验证：

1. **发送一条简单消息**
   - 预期：Token 占比应该在 5-15% 之间（取决于模型和工具配置）
   - 异常：超过 20% 说明仍有问题

2. **对比 Engine 日志**
   - 开启 debug 日志查看 `countTokensWithFallback` 的调用路径
   - 确认是否使用了 API 计数

3. **对比 TUI `/context` 命令**
   - 在同一会话中运行 TUI 和桌面应用
   - 对比两者的 Token 计数结果

---

## 八、关键代码索引

| 功能 | 文件 | 行号 |
|------|------|------|
| fast 参数传递 | [print.ts](file:///workspace/engine/src/cli/print.ts) | 2982 |
| fast 参数处理 | [context-noninteractive.ts](file:///workspace/engine/src/commands/context/context-noninteractive.ts) | 79 |
| 粗略估算逻辑 | [analyzeContext.ts](file:///workspace/engine/src/utils/analyzeContext.ts) | 77-89, 92-100 |
| getCurrentUsage | [tokens.ts](file:///workspace/engine/src/utils/tokens.ts) | 140-159 |
| 前端 refresh | [contextUsage.ts](file:///workspace/src/stores/contextUsage.ts) | 60-108 |
| 前端百分比计算 | [contextUsage.ts](file:///workspace/src/utils/contextUsage.ts) | 468-470 |
