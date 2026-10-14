import { ref } from 'vue'
import { ErrorCategory, type ClassifiedError, type ErrorContext, type ToastItem, type ErrorLogEntry } from '@/types'

const electronAPI = window.electronAPI

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

/**
 * 网关报"不支持某参数"时，把参数名原样挑出来告诉用户 —— 否则用户只看到一句
 * 400，不知道该去关哪个开关（思考模式就是最常见的那个）。
 */
function extractUnsupportedParamsHint(msg: string): string {
  const match = msg.match(/does not support parameters?:\s*\[([^\]]*)\]/i)
  if (!match) return ''
  const names = match[1]
    .split(',')
    .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  if (names.length === 0) return ''
  return ` 该服务不接受参数 ${names.map(n => `「${n}」`).join('、')}，请在设置里关闭对应能力或换一个支持它的接口。`
}

function classifyError(error: unknown, context?: ErrorContext): ClassifiedError {
  const msg = error instanceof Error ? error.message : String(error)
  const lowerMsg = msg.toLowerCase()
  const timestamp = Date.now()
  // 调用方已经判过可否重试的错误（例如上游失败后回空时合成的那条）带着标记，
  // 不要再靠文本猜一遍。
  const flaggedRetryable = (error as { retryable?: boolean } | null | undefined)?.retryable

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
    // 调用方判定过就以此为准 —— 它比任何按文本猜出来的分支都清楚这次失败能不能靠重发恢复。
    ...(flaggedRetryable !== undefined ? { retryable: flaggedRetryable } : {}),
  })

  // 400 = 服务端拒绝了请求体，重发同一份历史必然复现（例如含 tool_calls 的消息格式
  // 不被网关接受），所以既不能自动重发 5 次，也不给"重试"入口。放在 429/5xx 的松散
  // 子串匹配之前 —— 否则 body 里出现 "15000"、"137500" 这类数字就会被误判成可重试。
  // 例外：上下文超限类 400 保持可重试，重发会让引擎先跑一轮自动压缩，确实能恢复。
  const isContextOverflow = /prompt is too long|prompt_too_long|exceed context limit/i.test(msg)
  const isRequestRejected = !isContextOverflow && (
    /\bAPI Error: 400\b/i.test(msg) ||
    /\b400 Bad Request\b/i.test(msg) ||
    lowerMsg.includes('invalid_request_error') ||
    lowerMsg.includes('badrequesterror') ||
    // 网关拒绝某个参数（LiteLLM: UnsupportedParamsError: openai does not support
    // parameters: ['thinking']）—— 参数是谁发出去的很清楚，重发只会再吃一次 400。
    lowerMsg.includes('unsupportedparamserror') ||
    lowerMsg.includes('does not support parameters') ||
    lowerMsg.includes('unsupported_params')
  )
  if (isRequestRejected) {
    return make(ErrorCategory.DATA_ERROR, {
      retryable: false,
      message: `服务端拒绝了本次请求的数据格式（400），重发无法恢复，请联系网关/模型服务确认对该请求的兼容性。${extractUnsupportedParamsHint(msg)}`,
    })
  }

  if (lowerMsg.includes('429') || lowerMsg.includes('rate_limit') || lowerMsg.includes('rate limit')) {
    // 从 "API Error: 429 {\"error\":{\"message\":\"...\",...}}" 格式中提取友好信息
    const jsonMatch = msg.match(/\{[\s\S]*\}/)
    let friendlyDetail: string | undefined
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed?.error?.message) {
          friendlyDetail = parsed.error.message
        } else if (parsed?.message) {
          friendlyDetail = parsed.message
        }
      } catch { /* not valid JSON, fall through */ }
    }
    const technicalDetail = friendlyDetail
      ? `429 Rate Limit · ${friendlyDetail}`
      : msg
    return make(ErrorCategory.RATE_LIMIT, {
      retryDelay: extractRetryAfter(msg, error),
      retryable: true,
      technicalDetail,
    })
  }
  // 只认带上下文的 5xx：裸 /5\d{2}/ 会把 token 数（15000）、模型名里的数字之类
  // 判成服务器错误，于是确定性的失败被自动重发 5 次。
  const isServerErrorStatus = /\b(?:api error|status(?: code)?|http(?: error)?|error code)[\s:=]*['"]?5\d{2}\b/i.test(msg)
  if (isServerErrorStatus || lowerMsg.includes('server error') || lowerMsg.includes('internal server')) {
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
