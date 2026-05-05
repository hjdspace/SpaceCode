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
