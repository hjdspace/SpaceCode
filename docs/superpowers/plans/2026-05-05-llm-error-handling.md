# LLM Agent 交互错误处理 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为前端与 LLM Agent 交互建立完整的错误捕获、分类和展示机制，消除"一直转圈圈"的无提示卡死状态。

**架构：** 集中式 ErrorHandler 服务统一拦截所有错误源，分类后分发到 UI 层（内联 ErrorCard + Toast 通知）。在 chat.ts sendMessage 中增加超时检测，收到 stream_event 时重置计时器。

**技术栈：** Vue 3 Composition API、Pinia、TypeScript、vue-i18n、lucide-vue-next

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/services/errorHandler.ts` | 错误分类引擎、Toast/InlineError/ErrorLog 状态管理 |
| `src/components/common/ErrorCard.vue` | 内联错误卡片组件（嵌入 AgentTimeline） |
| `src/components/common/ToastNotification.vue` | Toast 通知组件（挂载在 ChatPanel） |
| `src/types/index.ts` | 扩展 MessageMetadata 增加 error 字段 |
| `src/stores/chat.ts` | 替换 handleError、增加超时检测、集成 errorHandler |
| `src/services/llm.ts` | 集成 errorHandler 到 API 错误处理 |
| `src/components/chat/AgentTimeline.vue` | 渲染 ErrorCard |
| `src/components/layout/ChatPanel.vue` | 挂载 ToastNotification |
| `src/i18n/locales/zh-CN.ts` | 新增 errors 命名空间 |
| `src/i18n/locales/en-US.ts` | 新增 errors 命名空间 |

---

### 任务 1：扩展类型定义

**文件：**
- 修改：`src/types/index.ts:40-46`（MessageMetadata 接口）

- [ ] **步骤 1：在 MessageMetadata 中增加 error 字段**

在 `src/types/index.ts` 的 `MessageMetadata` 接口中增加 `error` 字段：

```typescript
export interface MessageMetadata {
  model?: string
  inputTokens?: number
  outputTokens?: number
  duration?: number
  warning?: string
  error?: ClassifiedError
}
```

同时在文件顶部（`Message` 接口之前）新增错误相关类型：

```typescript
export enum ErrorCategory {
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

export interface ClassifiedError {
  category: ErrorCategory
  title: string
  message: string
  technicalDetail: string
  retryable: boolean
  retryDelay?: number
  originalError: any
  timestamp: number
}

export interface ErrorContext {
  sessionId?: string
  provider?: string
  model?: string
  baseUrl?: string
  phase?: 'init' | 'send' | 'stream' | 'tool'
}

export interface ToastItem {
  id: string
  category: ErrorCategory
  title: string
  message: string
  autoDismiss: boolean
  dismissAfter: number
  createdAt: number
}

export interface ErrorLogEntry {
  id: string
  category: ErrorCategory
  title: string
  technicalDetail: string
  timestamp: number
  sessionId?: string
  resolved: boolean
}
```

- [ ] **步骤 2：验证 TypeScript 编译通过**

运行：`npx vue-tsc --noEmit`（在项目根目录）
预期：无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add error handling type definitions"
```

---

### 任务 2：创建 ErrorHandler 服务

**文件：**
- 创建：`src/services/errorHandler.ts`

- [ ] **步骤 1：编写 errorHandler.ts 完整实现**

```typescript
import { ref } from 'vue'
import { ErrorCategory, type ClassifiedError, type ErrorContext, type ToastItem, type ErrorLogEntry } from '@/types'

const electronAPI = (window as any).electronAPI

const MAX_TOASTS = 3
const MAX_ERROR_LOG = 100
const DEFAULT_TOAST_DISMISS = 4000

const CATEGORY_TITLES: Record<ErrorCategory, string> = {
  [ErrorCategory.RATE_LIMIT]: '请求过于频繁',
  [ErrorCategory.SERVER_ERROR]: '服务器暂时不可用',
  [ErrorCategory.AUTH_ERROR]: '认证失败',
  [ErrorCategory.NETWORK_ERROR]: '网络连接失败',
  [ErrorCategory.TIMEOUT]: '请求超时',
  [ErrorCategory.PROCESS_ERROR]: '引擎进程异常',
  [ErrorCategory.DATA_ERROR]: '数据格式异常',
  [ErrorCategory.CONFIG_ERROR]: '配置错误',
  [ErrorCategory.BASE_URL_ERROR]: 'API 地址错误',
  [ErrorCategory.UNKNOWN]: '未知错误',
}

const CATEGORY_MESSAGES: Record<ErrorCategory, string> = {
  [ErrorCategory.RATE_LIMIT]: 'API 返回 429 速率限制错误，请稍后重试。',
  [ErrorCategory.SERVER_ERROR]: 'API 服务器返回错误，请稍后重试。',
  [ErrorCategory.AUTH_ERROR]: 'API Key 无效或无权限，请检查设置。',
  [ErrorCategory.NETWORK_ERROR]: '无法连接到 API 服务器，请检查网络连接。',
  [ErrorCategory.TIMEOUT]: '等待响应超时，请检查网络或重试。',
  [ErrorCategory.PROCESS_ERROR]: 'Agent 引擎意外退出，请检查配置或重试。',
  [ErrorCategory.DATA_ERROR]: 'API 返回了无法解析的数据，请检查 Base URL 配置。',
  [ErrorCategory.CONFIG_ERROR]: '请先在设置中配置 API Key。',
  [ErrorCategory.BASE_URL_ERROR]: 'API Base URL 无法访问，请检查配置。',
  [ErrorCategory.UNKNOWN]: '发生意外错误，请重试或联系支持。',
}

function extractRetryAfter(msg: string, error: unknown): number | undefined {
  const match = msg.match(/retry[_-]?after[:\s]+(\d+)/i)
  if (match) return parseInt(match[1], 10) * 1000
  if (error && typeof error === 'object' && 'headers' in error) {
    const headers = (error as any).headers
    if (headers?.get) {
      const val = headers.get('retry-after')
      if (val) return parseInt(val, 10) * 1000
    }
  }
  return undefined
}

function classifyError(error: unknown, context?: ErrorContext): ClassifiedError {
  const msg = error instanceof Error ? error.message : String(error)
  const lowerMsg = msg.toLowerCase()
  const timestamp = Date.now()

  const make = (category: ErrorCategory, overrides?: Partial<ClassifiedError>): ClassifiedError => ({
    category,
    title: CATEGORY_TITLES[category],
    message: CATEGORY_MESSAGES[category],
    technicalDetail: msg,
    retryable: category !== ErrorCategory.AUTH_ERROR
      && category !== ErrorCategory.CONFIG_ERROR
      && category !== ErrorCategory.BASE_URL_ERROR
      && category !== ErrorCategory.DATA_ERROR,
    originalError: error,
    timestamp,
    ...overrides,
  })

  if (lowerMsg.includes('429') || lowerMsg.includes('rate_limit') || lowerMsg.includes('rate limit')) {
    return make(ErrorCategory.RATE_LIMIT, { retryDelay: extractRetryAfter(msg, error), retryable: true })
  }
  if (/5\d{2}/.test(lowerMsg) || lowerMsg.includes('server error') || lowerMsg.includes('internal server')) {
    return make(ErrorCategory.SERVER_ERROR, { retryable: true })
  }
  if (lowerMsg.includes('401') || lowerMsg.includes('403') || lowerMsg.includes('unauthorized') || lowerMsg.includes('forbidden') || lowerMsg.includes('invalid api key') || lowerMsg.includes('authentication')) {
    return make(ErrorCategory.AUTH_ERROR)
  }
  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('network error') || lowerMsg.includes('fetch failed') || lowerMsg.includes('net::err') || lowerMsg.includes('网络连接')) {
    return make(ErrorCategory.NETWORK_ERROR, { retryable: true })
  }
  if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out') || lowerMsg.includes('超时')) {
    return make(ErrorCategory.TIMEOUT, { retryable: true })
  }
  if (lowerMsg.includes('process exited') || lowerMsg.includes('exit code')) {
    return make(ErrorCategory.PROCESS_ERROR, { retryable: true })
  }
  if (lowerMsg.includes('json') || lowerMsg.includes('parse') || lowerMsg.includes('invalid response') || lowerMsg.includes('invalid json')) {
    return make(ErrorCategory.DATA_ERROR)
  }
  if (lowerMsg.includes('api key') || lowerMsg.includes('not configured') || lowerMsg.includes('未配置') || lowerMsg.includes('llm not configured')) {
    return make(ErrorCategory.CONFIG_ERROR)
  }
  if (lowerMsg.includes('base url') || lowerMsg.includes('dns') || lowerMsg.includes('getaddrinfo') || lowerMsg.includes('无法访问')) {
    return make(ErrorCategory.BASE_URL_ERROR)
  }
  return make(ErrorCategory.UNKNOWN, { retryable: true })
}

export const errorHandler = {
  toasts: ref<ToastItem[]>([]),
  inlineErrors: ref<Map<string, ClassifiedError>>(new Map()),
  errorLog: ref<ErrorLogEntry[]>([]),

  classifyError(error: unknown, context?: ErrorContext): ClassifiedError {
    return classifyError(error, context)
  },

  handleError(error: unknown, context?: ErrorContext): ClassifiedError {
    const classified = classifyError(error, context)

    this.pushToast({
      id: crypto.randomUUID(),
      category: classified.category,
      title: classified.title,
      message: classified.message,
      autoDismiss: classified.category !== ErrorCategory.RATE_LIMIT,
      dismissAfter: DEFAULT_TOAST_DISMISS,
      createdAt: Date.now(),
    })

    if (context?.sessionId) {
      this.setInlineError(context.sessionId, classified)
    }

    this.logError(classified)

    if (electronAPI?.logger?.error) {
      electronAPI.logger.error('ErrorHandler', `[${classified.category}] ${classified.title}`, {
        technicalDetail: classified.technicalDetail,
        sessionId: context?.sessionId,
        phase: context?.phase,
      })
    }

    return classified
  },

  pushToast(item: ToastItem): void {
    this.toasts.value = [item, ...this.toasts.value].slice(0, MAX_TOASTS)
    if (item.autoDismiss) {
      setTimeout(() => {
        this.dismissToast(item.id)
      }, item.dismissAfter)
    }
  },

  dismissToast(id: string): void {
    this.toasts.value = this.toasts.value.filter(t => t.id !== id)
  },

  setInlineError(sessionId: string, error: ClassifiedError): void {
    this.inlineErrors.value.set(sessionId, error)
  },

  clearInlineError(sessionId: string): void {
    this.inlineErrors.value.delete(sessionId)
  },

  logError(classified: ClassifiedError): void {
    const entry: ErrorLogEntry = {
      id: crypto.randomUUID(),
      category: classified.category,
      title: classified.title,
      technicalDetail: classified.technicalDetail,
      timestamp: classified.timestamp,
      resolved: false,
    }
    this.errorLog.value = [entry, ...this.errorLog.value].slice(0, MAX_ERROR_LOG)
  },
}
```

- [ ] **步骤 2：验证 TypeScript 编译通过**

运行：`npx vue-tsc --noEmit`
预期：无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/services/errorHandler.ts
git commit -m "feat: add centralized ErrorHandler service"
```

---

### 任务 3：添加 i18n 错误翻译

**文件：**
- 修改：`src/i18n/locales/zh-CN.ts`
- 修改：`src/i18n/locales/en-US.ts`

- [ ] **步骤 1：在 zh-CN.ts 中添加 errors 命名空间**

在 `src/i18n/locales/zh-CN.ts` 的 `export default {` 对象中，在 `chatInput` 之后添加：

```typescript
  errors: {
    rateLimit: '请求过于频繁',
    rateLimitDesc: 'API 返回 429 速率限制错误，请稍后重试。',
    serverError: '服务器暂时不可用',
    serverErrorDesc: 'API 服务器返回错误，请稍后重试。',
    authError: '认证失败',
    authErrorDesc: 'API Key 无效或无权限，请检查设置。',
    networkError: '网络连接失败',
    networkErrorDesc: '无法连接到 API 服务器，请检查网络连接。',
    timeout: '请求超时',
    timeoutDesc: '等待响应超时，请检查网络或重试。',
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
  },
```

- [ ] **步骤 2：在 en-US.ts 中添加 errors 命名空间**

在 `src/i18n/locales/en-US.ts` 的 `export default {` 对象中，在 `chatInput` 之后添加：

```typescript
  errors: {
    rateLimit: 'Rate Limited',
    rateLimitDesc: 'API returned 429 rate limit error. Please retry later.',
    serverError: 'Server Unavailable',
    serverErrorDesc: 'API server returned an error. Please retry later.',
    authError: 'Authentication Failed',
    authErrorDesc: 'API Key is invalid or unauthorized. Please check settings.',
    networkError: 'Network Error',
    networkErrorDesc: 'Cannot connect to API server. Please check your network.',
    timeout: 'Request Timeout',
    timeoutDesc: 'Response timed out. Please check your network or retry.',
    processError: 'Engine Process Error',
    processErrorDesc: 'Agent engine exited unexpectedly. Please check config or retry.',
    dataError: 'Data Format Error',
    dataErrorDesc: 'API returned unparseable data. Please check Base URL config.',
    configError: 'Configuration Error',
    configErrorDesc: 'Please configure API Key in settings first.',
    baseUrlError: 'API URL Error',
    baseUrlErrorDesc: 'API Base URL is unreachable. Please check config.',
    unknownError: 'Unknown Error',
    unknownErrorDesc: 'An unexpected error occurred. Please retry or contact support.',
    retry: 'Retry',
    dismiss: 'Dismiss',
    technicalDetail: 'Technical Details',
  },
```

- [ ] **步骤 3：Commit**

```bash
git add src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat: add error i18n translations for zh-CN and en-US"
```

---

### 任务 4：创建 ErrorCard 组件

**文件：**
- 创建：`src/components/common/ErrorCard.vue`

- [ ] **步骤 1：编写 ErrorCard.vue 完整实现**

```vue
<template>
  <div class="error-card" :class="severityClass">
    <div class="error-header">
      <component :is="headerIcon" :size="16" class="error-icon" />
      <span class="error-title">{{ error.title }}</span>
    </div>
    <p class="error-message">{{ error.message }}</p>
    <button
      v-if="error.technicalDetail"
      class="detail-toggle"
      @click="showDetail = !showDetail"
    >
      <ChevronDown :size="12" class="toggle-chevron" :class="{ expanded: showDetail }" />
      <span>{{ t('errors.technicalDetail') }}</span>
    </button>
    <div v-if="showDetail" class="error-detail">
      <pre>{{ error.technicalDetail }}</pre>
    </div>
    <div class="error-actions">
      <button v-if="error.retryable" class="action-btn retry-btn" @click="$emit('retry')">
        <RefreshCw :size="12" />
        <span>{{ t('errors.retry') }}</span>
      </button>
      <button class="action-btn dismiss-btn" @click="$emit('dismiss')">
        <X :size="12" />
        <span>{{ t('errors.dismiss') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ClassifiedError } from '@/types'
import { ErrorCategory } from '@/types'
import { AlertTriangle, AlertCircle, X, RefreshCw, ChevronDown } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps<{
  error: ClassifiedError
}>()

defineEmits<{
  retry: []
  dismiss: []
}>()

const showDetail = ref(false)

const severityClass = computed(() => {
  if (props.error.category === ErrorCategory.RATE_LIMIT) return 'severity-warning'
  if (
    props.error.category === ErrorCategory.AUTH_ERROR ||
    props.error.category === ErrorCategory.CONFIG_ERROR ||
    props.error.category === ErrorCategory.BASE_URL_ERROR
  ) return 'severity-caution'
  return 'severity-error'
})

const headerIcon = computed(() => {
  if (props.error.category === ErrorCategory.RATE_LIMIT) return AlertTriangle
  return AlertCircle
})
</script>

<style lang="scss" scoped>
.error-card {
  margin: 8px 0;
  padding: 12px 14px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid;
}

.severity-error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.06);
  .error-icon { color: #ef4444; }
}

.severity-warning {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.06);
  .error-icon { color: #f59e0b; }
}

.severity-caution {
  border-color: rgba(249, 115, 22, 0.4);
  background: rgba(249, 115, 22, 0.06);
  .error-icon { color: #f97316; }
}

.error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.error-icon {
  flex-shrink: 0;
}

.error-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.error-message {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin: 0 0 8px;
}

.detail-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
  margin-bottom: 6px;

  &:hover { color: var(--text-secondary); }
}

.toggle-chevron {
  transition: transform 0.15s ease;
  &.expanded { transform: rotate(180deg); }
}

.error-detail {
  margin-bottom: 8px;
  pre {
    margin: 0;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-family: var(--font-mono);
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--bg-secondary);
    color: var(--text-muted);
    border: 1px solid var(--surface-border);
    max-height: 150px;
    overflow-y: auto;
  }
}

.error-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-sm, 4px);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--surface-border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  transition: all 0.15s ease;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.retry-btn {
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--accent-primary);

  &:hover {
    background: rgba(99, 102, 241, 0.1);
  }
}
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/components/common/ErrorCard.vue
git commit -m "feat: add ErrorCard inline error component"
```

---

### 任务 5：创建 ToastNotification 组件

**文件：**
- 创建：`src/components/common/ToastNotification.vue`

- [ ] **步骤 1：编写 ToastNotification.vue 完整实现**

```vue
<template>
  <TransitionGroup name="toast" tag="div" class="toast-container">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast-item"
      :class="severityClass(toast.category)"
    >
      <AlertTriangle v-if="toast.category === 'rate_limit'" :size="14" class="toast-icon" />
      <AlertCircle v-else :size="14" class="toast-icon" />
      <div class="toast-body">
        <span class="toast-title">{{ toast.title }}</span>
        <span class="toast-message">{{ toast.message }}</span>
      </div>
      <button class="toast-close" @click="dismiss(toast.id)">
        <X :size="12" />
      </button>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { AlertTriangle, AlertCircle, X } from 'lucide-vue-next'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'

const toasts = errorHandler.toasts

function dismiss(id: string) {
  errorHandler.dismissToast(id)
}

function severityClass(category: ErrorCategory): string {
  if (category === ErrorCategory.RATE_LIMIT) return 'toast-warning'
  if (
    category === ErrorCategory.AUTH_ERROR ||
    category === ErrorCategory.CONFIG_ERROR ||
    category === ErrorCategory.BASE_URL_ERROR
  ) return 'toast-caution'
  return 'toast-error'
}
</script>

<style lang="scss" scoped>
.toast-container {
  position: absolute;
  top: 60px;
  right: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 340px;
}

.toast-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  pointer-events: auto;
  cursor: default;
}

.toast-error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.1);
  .toast-icon { color: #ef4444; }
}

.toast-warning {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.1);
  .toast-icon { color: #f59e0b; }
}

.toast-caution {
  border-color: rgba(249, 115, 22, 0.4);
  background: rgba(249, 115, 22, 0.1);
  .toast-icon { color: #f97316; }
}

.toast-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.toast-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toast-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.toast-message {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.toast-close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }
}

.toast-enter-active {
  transition: all 0.25s ease-out;
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
.toast-move {
  transition: transform 0.25s ease;
}
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/components/common/ToastNotification.vue
git commit -m "feat: add ToastNotification component"
```

---

### 任务 6：集成 errorHandler 到 chat.ts

**文件：**
- 修改：`src/stores/chat.ts`

这是最关键的任务，需要修改 `sendMessage` 中的 `handleError`、增加超时检测、修改 `initClaudeCodeSession` 的 catch 块。

- [ ] **步骤 1：在 chat.ts 顶部添加 errorHandler 导入**

在 `src/stores/chat.ts` 的导入区域添加：

```typescript
import { errorHandler } from '@/services/errorHandler'
```

- [ ] **步骤 2：替换 sendMessage 中的 handleError 函数**

找到 `src/stores/chat.ts` 中 `sendMessage` 函数内的 `const handleError = (error: any) => {` 块（约第 1011 行），替换为：

```typescript
      const handleError = (error: any) => {
        if (isCompleted) return
        isCompleted = true
        const elapsed = Date.now() - sendStartTime
        logger.error('ChatStore', `[${targetSessionId.slice(0, 8)}] error in message flow | elapsed=${elapsed}ms`, { error: String(error) })
        loadingSessions.value.set(targetSessionId, false)
        streamingContents.value.set(targetSessionId, '')

        const classified = errorHandler.handleError(error, {
          sessionId: targetSessionId,
          provider: settingsStore.config.provider,
          model: settingsStore.config.model,
          baseUrl: settingsStore.config.apiUrl,
          phase: 'stream',
        })

        traceEvent({
          sessionId: targetSessionId,
          messageId: assistantMessageId,
          actor: 'assistant',
          type: 'assistant_turn',
          status: 'failed',
          title: 'Assistant turn failed',
          error: { message: classified.technicalDetail },
        } as any)

        updateMessage(assistantMessageId, {
          content: classified.message,
          metadata: {
            model: settingsStore.config.model,
            duration: Date.now() - sendStartTime,
            error: classified,
          }
        }, targetSessionId)

        const s = sessions.value.find(s => s.id === targetSessionId)
        if (s) {
          s.processStatus = 'exited'
          saveToStorage()
        }

        cleanup()
        reject(error)
      }
```

- [ ] **步骤 3：在 sendMessage 中增加超时检测**

在 `const assistantMessageId = crypto.randomUUID()` 之后、`addMessage({` 之前，添加超时变量声明：

```typescript
    const REQUEST_TIMEOUT = 5 * 60 * 1000
    let requestTimeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (!isCompleted) {
        handleError(new Error(`请求超时（${REQUEST_TIMEOUT / 1000}秒无响应）`))
      }
    }, REQUEST_TIMEOUT)

    const resetTimeout = () => {
      if (requestTimeoutId) clearTimeout(requestTimeoutId)
      requestTimeoutId = setTimeout(() => {
        if (!isCompleted) {
          handleError(new Error(`请求超时（${REQUEST_TIMEOUT / 1000}秒无响应）`))
        }
      }, REQUEST_TIMEOUT)
    }
```

在 `handleStreamEvent` 函数体的开头（`if (event.sessionId !== targetSessionId || isCompleted) return` 之后）添加：

```typescript
        resetTimeout()
```

在 `cleanup` 函数中添加超时清理（在现有清理逻辑之前）：

```typescript
      const cleanup = () => {
        if (requestTimeoutId) clearTimeout(requestTimeoutId)
        unsubscribeAssistant?.()
        unsubscribeUser?.()
        unsubscribeStreamEvent?.()
        unsubscribeToolUse?.()
        unsubscribeToolResult?.()
        unsubscribeResult?.()
        unsubscribeExit?.()
      }
```

注意：需要删除原有的 `const cleanup = () => {` 及其内容，替换为上述新版本。

- [ ] **步骤 4：修改 initClaudeCodeSession 的 catch 块**

找到 `initClaudeCodeSession` 函数中的 `catch (error) {` 块（约第 470 行），替换为：

```typescript
    } catch (error) {
      const classified = errorHandler.handleError(error, {
        sessionId,
        provider: config.provider,
        model: config.model,
        baseUrl: config.apiUrl,
        phase: 'init',
      })
      logger.error('ChatStore', `initClaudeCodeSession: failed to start session | id=${sessionId.slice(0, 8)}`, { error: String(error), category: classified.category })
      session.processStatus = 'exited'
      saveToStorage()
    }
```

- [ ] **步骤 5：修改 claudeCode API 不可用时的错误处理**

找到 `sendMessage` 中 `if (!claudeCode) {` 块（约第 540 行），替换为：

```typescript
    if (!claudeCode) {
      logger.error('ChatStore', `sendMessage: claudeCode API not available | sessionId=${targetSessionId.slice(0, 8)}`)
      const classified = errorHandler.handleError(new Error('Claude Code CLI is not available. Please check your configuration.'), {
        sessionId: targetSessionId,
        phase: 'init',
      })
      loadingSessions.value.set(targetSessionId, true)
      setTimeout(() => {
        addMessage({
          role: 'assistant',
          content: classified.message,
          metadata: { error: classified }
        }, targetSessionId)
        loadingSessions.value.set(targetSessionId, false)
      }, 500)
      return
    }
```

- [ ] **步骤 6：在 chat store 返回对象中暴露 retryLastMessage 方法**

在 `sendMessage` 函数之后添加：

```typescript
  async function retryLastMessage(): Promise<void> {
    const sid = currentSessionId.value
    if (!sid) return
    errorHandler.clearInlineError(sid)
    const session = sessions.value.find(s => s.id === sid)
    if (!session) return
    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
    if (lastUserMsg) {
      const lastAssistantMsg = [...session.messages].reverse().find(m => m.role === 'assistant' && m.metadata?.error)
      if (lastAssistantMsg) {
        const idx = session.messages.findIndex(m => m.id === lastAssistantMsg.id)
        if (idx >= 0) session.messages.splice(idx, 1)
      }
      await sendMessage(lastUserMsg.content)
    }
  }
```

在 store 的 return 对象中添加 `retryLastMessage`：

```typescript
  return {
    // ... 现有导出
    retryLastMessage,
  }
```

- [ ] **步骤 7：验证 TypeScript 编译通过**

运行：`npx vue-tsc --noEmit`
预期：无类型错误

- [ ] **步骤 8：Commit**

```bash
git add src/stores/chat.ts
git commit -m "feat: integrate ErrorHandler into chat store with timeout detection"
```

---

### 任务 7：集成 errorHandler 到 llm.ts

**文件：**
- 修改：`src/services/llm.ts`

- [ ] **步骤 1：在 llm.ts 中导入 errorHandler**

在 `src/services/llm.ts` 顶部添加：

```typescript
import { errorHandler } from '@/services/errorHandler'
```

- [ ] **步骤 2：替换 Anthropic API 错误处理**

找到 `sendMessage` 函数中 Anthropic 分支的 `if (!response.ok) {` 块（约第 74 行），替换为：

```typescript
    if (!response.ok) {
      const text = await response.text()
      console.log('[LLM] Anthropic API error response:', text.slice(0, 500))
      const classified = errorHandler.handleError(
        new Error(`API error: ${response.status} ${response.statusText} - ${text.slice(0, 200)}`),
        { provider, baseUrl, phase: 'send' }
      )
      throw new Error(classified.technicalDetail)
    }
```

- [ ] **步骤 3：替换 OpenAI API 错误处理**

找到 `sendMessage` 函数中 OpenAI 分支的 `if (!response.ok) {` 块（约第 100 行），替换为：

```typescript
  if (!response.ok) {
    const text = await response.text()
    console.log('[LLM] OpenAI API error response:', text.slice(0, 500))
    const classified = errorHandler.handleError(
      new Error(`API error: ${response.status} ${response.statusText} - ${text.slice(0, 200)}`),
      { provider, baseUrl, phase: 'send' }
    )
    throw new Error(classified.technicalDetail)
  }
```

- [ ] **步骤 4：Commit**

```bash
git add src/services/llm.ts
git commit -m "feat: integrate ErrorHandler into LLM service"
```

---

### 任务 8：在 AgentTimeline 中渲染 ErrorCard

**文件：**
- 修改：`src/components/chat/AgentTimeline.vue`

- [ ] **步骤 1：导入 ErrorCard 组件和 errorHandler**

在 `src/components/chat/AgentTimeline.vue` 的 `<script setup>` 中添加导入：

```typescript
import ErrorCard from '../common/ErrorCard.vue'
import { errorHandler } from '@/services/errorHandler'
import { useChatStore } from '@/stores/chat'
```

- [ ] **步骤 2：在 timelineEvents computed 中增加 error 类型事件**

在 `timelineEvents` computed 函数中，在最后的 `if (msg.metadata ...)` 块之后添加：

```typescript
    if (msg.metadata?.error) {
      events.push({
        id: `${msg.id}-error`,
        type: 'error' as any,
        status: 'error',
        icon: markRaw(AlertCircle),
        label: 'Error',
        content: '',
        classifiedError: msg.metadata.error,
      })
    }
```

同时在 `TimelineEvent` interface 中添加字段：

```typescript
  classifiedError?: any
```

并在 `type` 联合类型中添加 `'error'`：

```typescript
  type: 'reasoning' | 'text' | 'tool_call' | 'metadata' | 'error'
```

- [ ] **步骤 3：在 template 中添加 ErrorCard 渲染**

在 `<template v-else-if="event.type === 'metadata'">` 块之后添加：

```html
          <template v-else-if="event.type === 'error' && event.classifiedError">
            <ErrorCard
              :error="event.classifiedError"
              @retry="handleRetry"
              @dismiss="handleDismissError"
            />
          </template>
```

- [ ] **步骤 4：添加 retry 和 dismiss 处理函数**

在 `<script setup>` 中添加：

```typescript
const chatStore = useChatStore()

function handleRetry() {
  chatStore.retryLastMessage()
}

function handleDismissError() {
  const sid = chatStore.currentSessionId
  if (sid) errorHandler.clearInlineError(sid)
}
```

- [ ] **步骤 5：在 template 中添加 AlertCircle 导入**

确认 `AlertCircle` 已在 lucide-vue-next 导入列表中。如果没有，添加：

```typescript
import { Loader2, Check, X, ChevronDown, Bot, AlertCircle, ... } from 'lucide-vue-next'
```

- [ ] **步骤 6：Commit**

```bash
git add src/components/chat/AgentTimeline.vue
git commit -m "feat: render ErrorCard in AgentTimeline for error events"
```

---

### 任务 9：在 ChatPanel 中挂载 ToastNotification

**文件：**
- 修改：`src/components/layout/ChatPanel.vue`

- [ ] **步骤 1：导入 ToastNotification 组件**

在 `src/components/layout/ChatPanel.vue` 的 `<script setup>` 中添加：

```typescript
import ToastNotification from '../common/ToastNotification.vue'
```

- [ ] **步骤 2：在 template 中挂载 ToastNotification**

在 `<main class="chat-panel">` 标签内部末尾（`</template>` 之前）添加：

```html
    <ToastNotification />
```

- [ ] **步骤 3：确保 chat-panel 有 position: relative**

确认 `ChatPanel.vue` 的 `<style>` 中 `.chat-panel` 已有 `position: relative`。查看现有样式，发现已有，无需修改。

- [ ] **步骤 4：Commit**

```bash
git add src/components/layout/ChatPanel.vue
git commit -m "feat: mount ToastNotification in ChatPanel"
```

---

### 任务 10：端到端验证

- [ ] **步骤 1：启动开发服务器**

运行：`npm run dev`（或项目对应的 dev 命令）
预期：应用正常启动，无编译错误

- [ ] **步骤 2：验证正常对话流程**

1. 打开应用，选择项目文件夹
2. 发送一条正常消息
3. 预期：Agent 正常响应，无错误提示

- [ ] **步骤 3：验证错误场景模拟**

1. 在设置中输入无效的 API Key
2. 发送消息
3. 预期：显示 ErrorCard（认证失败）+ Toast 通知
4. 点击"重试"按钮，预期：重新发送消息
5. 点击"关闭"按钮，预期：错误卡片消失

- [ ] **步骤 4：验证超时场景**

1. 使用一个极短的超时时间临时测试（修改 REQUEST_TIMEOUT 为 1000）
2. 发送消息
3. 预期：1 秒后显示超时错误

- [ ] **步骤 5：恢复超时时间并最终 Commit**

将 REQUEST_TIMEOUT 恢复为 `5 * 60 * 1000`

```bash
git add -A
git commit -m "feat: complete LLM error handling system"
```
