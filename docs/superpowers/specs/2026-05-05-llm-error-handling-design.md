# LLM Agent 交互错误处理设计

**日期:** 2026-05-05
**状态:** 已批准

## 问题

前端与 LLM Agent 交互发生异常（如 429 速率限制、500 服务器错误、网络连接失败等）时，界面仅显示加载转圈状态而无任何错误提示，导致用户无法知晓具体问题所在。

## 目标

1. 建立完整的错误捕获机制，覆盖网络请求、API 响应、数据处理等环节
2. 针对常见异常设计明确的错误分类体系
3. 实现即时、清晰的错误提示（内联错误卡片 + Toast 通知）
4. 错误提示包含技术细节辅助排查，同时保持用户友好性
5. 错误状态下界面可交互，提供重试、取消等操作
6. 实现错误日志记录功能

## 架构方案：集中式错误处理器

```
┌─────────────────────────────────────────────────────┐
│                   ErrorHandler                       │
│  (src/services/errorHandler.ts)                      │
│                                                      │
│  classifyError(raw) → ClassifiedError                │
│  handleError(raw, context?) → void                   │
│                                                      │
│  ┌─ toasts: ref<ToastItem[]>     ──→ Toast 组件      │
│  └─ inlineErrors: Map<sid, err>  ──→ ErrorCard 组件   │
└──────────────┬──────────────────────────────────────┘
               │
    ┌──────────┼──────────────────┐
    ▼          ▼                  ▼
 chat.ts    llm.ts          electronAPI
(handleError) (fetch errors)  (IPC errors)
```

## 错误分类体系

### ErrorCategory 枚举

```typescript
enum ErrorCategory {
  RATE_LIMIT = 'rate_limit',
  SERVER_ERROR = 'server_error',
  AUTH_ERROR = 'auth_error',
  NETWORK_ERROR = 'network_error',
  TIMEOUT = 'timeout',
  PROCESS_ERROR = 'process_error',
  DATA_ERROR = 'data_error',
  CONFIG_ERROR = 'config_error',
  BASE_URL_ERROR = 'base_url_error',
  UNKNOWN = 'unknown',
}
```

### ClassifiedError 接口

```typescript
interface ClassifiedError {
  category: ErrorCategory
  title: string
  message: string
  technicalDetail: string
  retryable: boolean
  retryDelay?: number
  originalError: any
  timestamp: number
}
```

### 分类规则

| 输入模式 | 分类 | retryable | 用户提示 |
|---------|------|-----------|---------|
| HTTP 429 / `rate_limit` | RATE_LIMIT | 是 | 请求过于频繁，请稍后重试 |
| HTTP 5xx | SERVER_ERROR | 是 | 服务器暂时不可用 |
| HTTP 401/403 | AUTH_ERROR | 否 | API Key 无效或无权限 |
| `fetch` 异常 / `ECONNREFUSED` | NETWORK_ERROR | 是 | 网络连接失败 |
| 超时无响应 | TIMEOUT | 是 | 请求超时 |
| `Process exited with code` | PROCESS_ERROR | 是 | 引擎进程异常退出 |
| JSON 解析失败 | DATA_ERROR | 否 | 响应数据格式异常 |
| API Key 为空 | CONFIG_ERROR | 否 | 请先配置 API Key |
| Base URL 无法连接 / DNS 失败 | BASE_URL_ERROR | 否 | API Base URL 无法访问 |
| 其他 | UNKNOWN | 是 | 发生未知错误 |

### 分类逻辑

```typescript
function classifyError(error: unknown, context?: ErrorContext): ClassifiedError {
  const msg = error instanceof Error ? error.message : String(error)
  const lowerMsg = msg.toLowerCase()

  if (lowerMsg.includes('429') || lowerMsg.includes('rate_limit') || lowerMsg.includes('rate limit')) {
    const retryAfter = extractRetryAfter(msg, error)
    return makeClassified(ErrorCategory.RATE_LIMIT, retryAfter: retryAfter, retryable: true)
  }
  if (lowerMsg.match(/5\d{2}/) || lowerMsg.includes('server error') || lowerMsg.includes('internal server')) {
    return makeClassified(ErrorCategory.SERVER_ERROR, retryable: true)
  }
  if (lowerMsg.includes('401') || lowerMsg.includes('403') || lowerMsg.includes('unauthorized') || lowerMsg.includes('forbidden') || lowerMsg.includes('invalid api key') || lowerMsg.includes('authentication')) {
    return makeClassified(ErrorCategory.AUTH_ERROR, retryable: false)
  }
  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('network error') || lowerMsg.includes('fetch failed') || lowerMsg.includes('net::err')) {
    return makeClassified(ErrorCategory.NETWORK_ERROR, retryable: true)
  }
  if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out') || lowerMsg.includes('超时')) {
    return makeClassified(ErrorCategory.TIMEOUT, retryable: true)
  }
  if (lowerMsg.includes('process exited') || lowerMsg.includes('exit code')) {
    return makeClassified(ErrorCategory.PROCESS_ERROR, retryable: true)
  }
  if (lowerMsg.includes('json') || lowerMsg.includes('parse') || lowerMsg.includes('invalid response')) {
    return makeClassified(ErrorCategory.DATA_ERROR, retryable: false)
  }
  if (lowerMsg.includes('api key') || lowerMsg.includes('not configured') || lowerMsg.includes('未配置')) {
    return makeClassified(ErrorCategory.CONFIG_ERROR, retryable: false)
  }
  if (lowerMsg.includes('base url') || lowerMsg.includes('dns') || lowerMsg.includes('getaddrinfo')) {
    return makeClassified(ErrorCategory.BASE_URL_ERROR, retryable: false)
  }
  return makeClassified(ErrorCategory.UNKNOWN, retryable: true)
}
```

## ErrorHandler 服务

### 接口

```typescript
export const errorHandler = {
  classifyError(error: unknown, context?: ErrorContext): ClassifiedError,
  handleError(error: unknown, context?: ErrorContext): ClassifiedError,
  toasts: ref<ToastItem[]>,
  pushToast(item: ToastItem): void,
  dismissToast(id: string): void,
  inlineErrors: ref<Map<string, ClassifiedError>>,
  setInlineError(sessionId: string, error: ClassifiedError): void,
  clearInlineError(sessionId: string): void,
  errorLog: ref<ErrorLogEntry[]>,
  logError(classified: ClassifiedError): void,
}
```

### ErrorContext

```typescript
interface ErrorContext {
  sessionId?: string
  provider?: string
  model?: string
  baseUrl?: string
  phase?: 'init' | 'send' | 'stream' | 'tool'
}
```

### ToastItem

```typescript
interface ToastItem {
  id: string
  category: ErrorCategory
  title: string
  message: string
  autoDismiss: boolean
  dismissAfter: number
  createdAt: number
}
```

### ErrorLogEntry

```typescript
interface ErrorLogEntry {
  id: string
  category: ErrorCategory
  title: string
  technicalDetail: string
  timestamp: number
  sessionId?: string
  resolved: boolean
}
```

## 超时机制

在 `chat.ts` 的 `sendMessage` Promise 中新增超时检测：

- 默认超时时间：5 分钟（考虑 Agent 多轮工具调用场景）
- 收到任何 stream_event 时重置超时计时器
- 超时后自动终止 loading 状态并触发 TIMEOUT 错误

```typescript
const REQUEST_TIMEOUT = 5 * 60 * 1000

let timeoutId = setTimeout(() => {
  if (!isCompleted) {
    handleError(new Error(`请求超时（${REQUEST_TIMEOUT / 1000}秒无响应）`))
  }
}, REQUEST_TIMEOUT)

// 在 handleStreamEvent 中重置
clearTimeout(timeoutId)
timeoutId = setTimeout(() => { /* 同上 */ }, REQUEST_TIMEOUT)

// 在 cleanup 中清除
const cleanup = () => {
  clearTimeout(timeoutId)
  // ... 现有清理逻辑
}
```

## UI 组件

### ErrorCard（内联错误卡片）

嵌入在 AgentTimeline 中，替代现有的纯文本错误消息。

布局：
```
┌──────────────────────────────────────────────┐
│  ⚠ 请求过于频繁                              │  ← 标题（按分类着色）
│  API 返回 429 速率限制错误，请稍后重试。       │  ← 用户友好描述
│                                               │
│  ▸ 技术详情                                   │  ← 折叠区域
│    HTTP 429 | anthropic.com | Retry-After: 30s│
│                                               │
│  [🔄 重试]  [✕ 关闭]                          │  ← 操作按钮
└──────────────────────────────────────────────┘
```

样式规则：
- RATE_LIMIT: 黄色边框 + 浅黄背景
- AUTH_ERROR / CONFIG_ERROR / BASE_URL_ERROR: 橙色边框 + 浅橙背景
- 其他错误: 红色边框 + 浅红背景

交互：
- 重试按钮：调用 `chatStore.sendMessage` 重新发送最后一条用户消息
- 关闭按钮：清除 inlineError，恢复可交互状态
- 技术详情默认折叠，点击展开

### ToastNotification

固定在 ChatPanel 右上角。

布局：
```
┌──────────────────────────────┐
│ ⚠ 网络连接失败               │  ← 简短标题
│ 请检查网络连接后重试          │  ← 一行描述
│                    [✕]       │  ← 手动关闭
└──────────────────────────────┘
```

规则：
- 默认 4 秒后自动消失
- RATE_LIMIT 类不自动消失（需用户确认）
- 最多同时显示 3 条
- 堆叠显示，新消息在顶部

## 集成点

### chat.ts sendMessage

替换现有 `handleError` 函数：

```typescript
// 旧代码
const handleError = (error: any) => {
  if (isCompleted) return
  isCompleted = true
  loadingSessions.value.set(targetSessionId, false)
  streamingContents.value.set(targetSessionId, '')
  const errorMsg = error instanceof Error ? error.message : String(error)
  let userMessage = `Error: ${errorMsg}`
  if (errorMsg.includes('Process exited with code 1')) {
    userMessage = `❌ 引擎启动失败...`
  }
  updateMessage(assistantMessageId, { content: userMessage }, targetSessionId)
  // ...
}

// 新代码
const handleError = (error: any) => {
  if (isCompleted) return
  isCompleted = true
  loadingSessions.value.set(targetSessionId, false)
  streamingContents.value.set(targetSessionId, '')

  const classified = errorHandler.handleError(error, {
    sessionId: targetSessionId,
    provider: settingsStore.config.provider,
    model: settingsStore.config.model,
    baseUrl: settingsStore.config.apiUrl,
    phase: 'stream',
  })

  errorHandler.setInlineError(targetSessionId, classified)
  updateMessage(assistantMessageId, {
    content: classified.message,
    metadata: {
      ...existingMetadata,
      error: classified,
    }
  }, targetSessionId)

  // ... session status update
}
```

### chat.ts initClaudeCodeSession

在 catch 中集成 errorHandler：

```typescript
catch (error) {
  const classified = errorHandler.handleError(error, {
    sessionId,
    provider: config.provider,
    phase: 'init',
  })
  errorHandler.setInlineError(sessionId, classified)
  session.processStatus = 'exited'
  saveToStorage()
}
```

### llm.ts sendMessage

在 API 错误处集成 errorHandler：

```typescript
if (!response.ok) {
  const text = await response.text()
  const classified = errorHandler.handleError(
    new Error(`API error: ${response.status} ${response.statusText} - ${text.slice(0, 200)}`),
    { provider, baseUrl, phase: 'send' }
  )
  throw classified
}
```

## i18n 扩展

在 `zh-CN.ts` 和 `en-US.ts` 中新增 `errors` 命名空间：

```typescript
errors: {
  rateLimit: '请求过于频繁',
  rateLimitDesc: 'API 返回 429 速率限制错误，请稍后重试。',
  serverError: '服务器暂时不可用',
  serverErrorDesc: 'API 服务器返回错误 ({status})，请稍后重试。',
  authError: '认证失败',
  authErrorDesc: 'API Key 无效或无权限，请检查设置。',
  networkError: '网络连接失败',
  networkErrorDesc: '无法连接到 API 服务器，请检查网络连接。',
  timeout: '请求超时',
  timeoutDesc: '等待响应超时（{seconds}秒），请检查网络或重试。',
  processError: '引擎进程异常',
  processErrorDesc: 'Agent 引擎意外退出，请检查配置或重试。',
  dataError: '数据格式异常',
  dataErrorDesc: 'API 返回了无法解析的数据，请检查 Base URL 配置。',
  configError: '配置错误',
  configErrorDesc: '请先在设置中配置 API Key。',
  baseUrlError: 'API 地址错误',
  baseUrlErrorDesc: 'API Base URL 无法访问，请检查配置。',
  unknownError: '未知错误',
  unknownErrorDesc: '发生意外错误，请重试或联系支持。',
  retry: '重试',
  dismiss: '关闭',
  technicalDetail: '技术详情',
}
```

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/services/errorHandler.ts` | 新增 | 错误分类引擎 + Toast/InlineError 管理 |
| `src/components/common/ErrorCard.vue` | 新增 | 内联错误卡片组件 |
| `src/components/common/ToastNotification.vue` | 新增 | Toast 通知组件 |
| `src/stores/chat.ts` | 修改 | 替换 handleError，增加超时检测 |
| `src/services/llm.ts` | 修改 | 集成 errorHandler |
| `src/types/index.ts` | 修改 | Message 类型增加 error 字段 |
| `src/components/chat/AgentTimeline.vue` | 修改 | 渲染 ErrorCard |
| `src/components/layout/ChatPanel.vue` | 修改 | 挂载 ToastNotification |
| `src/i18n/locales/zh-CN.ts` | 修改 | 新增 errors 命名空间 |
| `src/i18n/locales/en-US.ts` | 修改 | 新增 errors 命名空间 |
