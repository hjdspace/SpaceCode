// @vitest-environment jsdom
/**
 * classifyError 对 400 的判定。
 *
 * 背景：内网 OpenAI 兼容网关拒绝含 tool_calls 的历史消息（其 chat template 对
 * arguments 调 .items()），返回 400 BadRequestError。这类错误是确定性的 —— 出错的
 * 消息留在会话历史里，每次重发都原样复现。此前它落到 UNKNOWN 且 retryable:true，
 * 于是桌面端自动重发 5 次（退避累计约 1 分钟）再挂出带"重试"按钮的错误卡片，
 * 用户点一次又是一轮，全部无效。
 */
import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert/strict'

import { errorHandler } from '../errorHandler.ts'
import { extractErrorCode } from '@/composables/useAutoRetry'
import { i18n } from '@/i18n'
import { ErrorCategory } from '@/types'

const GATEWAY_400 = 'API Error: 400 {"error":{"message":"Can only get item pairs from a mapping.",'
  + '"type":"BadRequestError","param":"","code":400}}'

function classify(message: string, extra?: Record<string, unknown>) {
  return errorHandler.classifyError(Object.assign(new Error(message), extra))
}

describe('classifyError 400', () => {
  it('网关拒绝请求体的 400 不可重试', () => {
    const classified = classify(GATEWAY_400)

    assert.equal(classified.retryable, false)
    assert.equal(classified.category, ErrorCategory.DATA_ERROR)
    assert.equal(classified.technicalDetail, GATEWAY_400)
  })

  it('Anthropic 线格式的 invalid_request_error 同样不可重试', () => {
    assert.equal(
      classify('400 {"type":"error","error":{"type":"invalid_request_error","message":"messages: content must be string"}}').retryable,
      false,
    )
  })

  it('上下文超限的 400 保持可重试（重发会触发引擎自动压缩）', () => {
    const classified = classify('API Error: 400 {"error":{"type":"invalid_request_error","message":"prompt is too long: 137500 tokens > 135000 maximum"}}')

    assert.equal(classified.retryable, true)
  })

  it('429 与 5xx 仍走可重试分支', () => {
    assert.equal(classify('API Error: 429 rate limit exceeded on dimension: tpm').retryable, true)
    assert.equal(classify('API Error: 502 Bad Gateway').retryable, true)
    assert.equal(classify('API Error: 429 rate limit exceeded').category, ErrorCategory.RATE_LIMIT)
  })

  it('不含状态码的陌生错误仍是可重试的 UNKNOWN', () => {
    const classified = classify('Something the classifier has never seen')

    assert.equal(classified.category, ErrorCategory.UNKNOWN)
    assert.equal(classified.retryable, true)
  })
})

describe('classifyError 网关拒绝参数（issue #40 问题 2）', () => {
  it('LiteLLM 原文的 UnsupportedParamsError 不可重试', () => {
    const classified = classify(
      'API Error: 400 litellm.UnsupportedParamsError: openai does not support parameters: '
        + "['thinking'], for model=qwen3.8-27b",
    )

    assert.equal(classified.retryable, false)
    assert.equal(classified.category, ErrorCategory.DATA_ERROR)
    assert.match(classified.message, /「thinking」/)
  })

  it('提示里点出被拒绝的多个参数名', () => {
    const classified = classify(
      'litellm.UnsupportedParamsError: openai does not support parameters: ["thinking", "chat_template_kwargs"], for model=qwen3.8-27b',
    )

    assert.equal(classified.retryable, false)
    assert.match(classified.message, /「thinking」/)
    assert.match(classified.message, /「chat_template_kwargs」/)
  })

  it('正文里的数字不会被当成 5xx 服务器错误', () => {
    // 旧规则裸 /5\d{2}/ 会命中 "15000"，把确定性的失败判成可重试。
    const classified = classify('Upstream replied 15000 for a field we never expected')

    assert.equal(classified.category, ErrorCategory.UNKNOWN)
  })

  it('5xx 带状态码上下文时仍可重试', () => {
    assert.equal(classify('API Error: 503 Service Unavailable').retryable, true)
    assert.equal(classify('status code: 500').retryable, true)
    assert.equal(classify('API Error: 503 Service Unavailable').category, ErrorCategory.SERVER_ERROR)
  })

  it('调用方标了 retryable 就按标记走，不再猜文本', () => {
    const flagged = Object.assign(
      new Error('LLM returned an empty response after the upstream request failed.'),
      { retryable: false },
    )
    const classified = errorHandler.classifyError(flagged)

    assert.equal(classified.category, ErrorCategory.UNKNOWN)
    assert.equal(classified.retryable, false)
  })
})

/**
 * 状态码识别只走「结构化字段 + 带 HTTP 上下文的文本」。审计（issue #41 第 14 项）在
 * v0.8.8 复现的两类误判里，5xx 与 400 已各自修好，429/401/403 仍是整段子串 includes，
 * 于是 "model foo-429 not found" 被判成可重试限流、正文里的 401/403 数字被判成鉴权失败。
 */
describe('classifyError 状态码识别（issue #41 第 14 项）', () => {
  it('标准 API Error: 400 正文里的 foo-429 不再抢到限流', () => {
    // 旧顺序里 400 已前置，这条是防回归锚点。
    const classified = classify(
      'API Error: 400 {"error":{"message":"model foo-429 not found","type":"invalid_request_error","param":null}}',
    )

    assert.equal(classified.category, ErrorCategory.DATA_ERROR)
    assert.equal(classified.retryable, false)
  })

  it('网关 JSON 里只有正文的 foo-429 不再判成限流', () => {
    assert.equal(classify('model foo-429 not found').category, ErrorCategory.UNKNOWN)
  })

  it('网关 JSON 的 code:400 判为不可重试的拒绝，不被 foo-429 带偏', () => {
    const classified = classify(
      '{"error":{"message":"model foo-429 not found","type":"model_not_found","code":400}}',
    )

    assert.equal(classified.category, ErrorCategory.DATA_ERROR)
    assert.equal(classified.retryable, false)
  })

  it('模型名/URL/token 数里的 401、403、429 不再判成鉴权错误或限流', () => {
    for (const message of [
      'Request failed for model qwen-401b on topic 403 with 4290 tokens',
      'Retrying upload of chunk 401 to https://files.example.com:403/media',
      '{"error":{"message":"quota sample","usage":{"prompt_tokens":401,"completion_tokens":403}}}',
    ]) {
      const classified = classify(message)

      assert.equal(classified.category, ErrorCategory.UNKNOWN, message)
    }
  })

  it('审计原例 401 + model=qwen-500b 判鉴权失败而非服务器错误', () => {
    const classified = classify('401 Unauthorized: model=qwen-500b is not available')

    assert.equal(classified.category, ErrorCategory.AUTH_ERROR)
    assert.equal(classified.retryable, false)
  })

  it('结构化 status/statusCode 优先于正文里有没有数字', () => {
    assert.equal(classify('upstream throttled the account', { status: 429 }).category, ErrorCategory.RATE_LIMIT)
    assert.equal(classify('token rejected by gateway', { statusCode: '401' }).category, ErrorCategory.AUTH_ERROR)
    assert.equal(classify('upstream exploded', { status: 503 }).category, ErrorCategory.SERVER_ERROR)
    assert.equal(classify('body rejected by gateway', { status: 400 }).retryable, false)
  })

  it('不在 HTTP 范围内的 status 字段不参与判定', () => {
    assert.equal(classify('upstream said 4290 is not a status code', { status: 4290 }).category, ErrorCategory.UNKNOWN)
  })

  it('带 HTTP 上下文的 429/403 仍然正常分类', () => {
    const rateLimited = classify('{"error":{"message":"Too many requests","type":"too_many_requests","code":429}}')
    assert.equal(rateLimited.category, ErrorCategory.RATE_LIMIT)
    assert.equal(rateLimited.retryable, true)
    assert.match(rateLimited.technicalDetail, /^429 Rate Limit · Too many requests/)
    assert.equal(rateLimited.retryDelay, undefined)

    assert.equal(classify('API Error: 429 rate limit exceeded, retry-after: 12').retryDelay, 12000)
    assert.equal(classify('403 Forbidden: this account cannot use the model').category, ErrorCategory.AUTH_ERROR)
    assert.equal(classify('API error: 401 - {"error":{"message":"Invalid API key"}}').category, ErrorCategory.AUTH_ERROR)
  })

  /**
   * 引擎侧的真实上游文本常以裸状态码开头（Pi 的 errorMessage、Bedrock、Anthropic SDK 的
   * makeMessage 都会 prepend "429 "），见 electron/engine/engines/__tests__/piEventMapper.mapping.test.ts:90,118
   * 与 src/stores/__tests__/turn.test.ts:228。收窄匹配时如果把这种形状漏掉，确定性的 403
   * 会退回可重试的 UNKNOWN，又是 5 次自动重发。
   */
  it('行首裸状态码（Pi/Bedrock/SDK 形状）按状态分类', () => {
    assert.equal(classify('429 slow down').category, ErrorCategory.RATE_LIMIT)
    assert.equal(classify('429 rate limited').category, ErrorCategory.RATE_LIMIT)
    assert.equal(classify('401 invalid token').category, ErrorCategory.AUTH_ERROR)

    const forbidden = classify('403 model is not available in the current token plan')
    assert.equal(forbidden.category, ErrorCategory.AUTH_ERROR)
    assert.equal(forbidden.retryable, false)
  })

  it('正文里同时出现两个状态码时取最靠前的（引擎写在开头）', () => {
    assert.equal(
      classify('API Error: 400 {"error":{"message":"Too many requests","code":429}}').category,
      ErrorCategory.DATA_ERROR,
    )
    assert.equal(
      classify('{"error":{"message":"Too many requests","code":429}} but HTTP 400 on the sub-batch').category,
      ErrorCategory.RATE_LIMIT,
    )
  })

  // DEFECT: 本票范围外，留给 #41 后续拍板 —— 完全没有状态上下文的确定性失败
  // （网关只回了正文 "model foo-429 not found"）现在落到 UNKNOWN 且 retryable:true，
  // 自动重发照旧跑 5 轮；重试卡片上的错误码也仍由 useAutoRetry 的裸 /\b([45]\d{2})\b/
  // 从正文里抓出 "429"。分类不再被数字带偏了，但"少发一次无效请求"没解决。
  it('DEFECT: 无状态上下文的 foo-429 正文仍是可重试 UNKNOWN，标签仍写 429', () => {
    const classified = classify('model foo-429 not found')

    assert.equal(classified.category, ErrorCategory.UNKNOWN)
    assert.equal(classified.retryable, true)
    assert.equal(extractErrorCode(classified.technicalDetail, classified.category), '429')
  })
})

/**
 * 主进程拦下操作时只给 reason code + 上下文 (issue #55)。用户可见文案必须由渲染层
 * 按当前语言渲染，原始 detail 只进技术详情；测试钉住这两条，防止文案再被塞回主进程。
 */
describe('classifyError 引擎拦截原因 (issue #55)', () => {
  afterEach(() => {
    i18n.global.locale.value = 'zh-CN'
  })

  function blocked(
    reason: 'permission-mode-not-applied' | 'plan-mode-not-enforced' | 'session-not-active' | 'engine-unavailable',
    detail: string,
    context?: Record<string, unknown>,
  ) {
    return Object.assign(new Error(detail), { engineBlocked: { reason, detail, context } })
  }

  it('plan 被拦：中文界面给中文可行动提示，字段名只留在技术详情', () => {
    const classified = errorHandler.classifyError(blocked(
      'plan-mode-not-enforced',
      'plan mode is not enforced (extension loaded=false, engine=no receipt)',
      { engine: 'pi', intent: 'plan', extensionLoaded: false },
    ))

    assert.equal(classified.retryable, false)
    assert.equal(classified.title, '消息未发送')
    assert.match(classified.message, /新建会话/)
    assert.doesNotMatch(classified.message, /loaded=|no receipt|plan mode is not enforced/)
    assert.match(classified.technicalDetail, /loaded=false/)
  })

  it('英文界面给英文提示，同样不含实现字段名', () => {
    i18n.global.locale.value = 'en-US'

    const classified = errorHandler.classifyError(blocked(
      'permission-mode-not-applied',
      'permission mode not applied (intent=plan, engine=bypassPermissions)',
      { engine: 'claude-code', intent: 'plan', reported: 'bypassPermissions' },
    ))

    assert.equal(classified.title, 'Message Not Sent')
    assert.match(classified.message, /Full Trust/)
    assert.doesNotMatch(classified.message, /intent=|bypassPermissions/)
  })

  it('IPC 拒绝只保留 message：reason code 仍能从错误里解析出来', () => {
    const encoded = new Error(
      "Error invoking remote method 'claude-code:sendMessage': Error: Session s1 blocked: "
        + 'ENGINE_BLOCKED[permission-mode-not-applied] permission mode not applied (intent=plan, engine=bypassPermissions)',
    )
    const classified = errorHandler.classifyError(encoded)

    assert.equal(classified.title, '消息未发送')
    assert.match(classified.message, /没有发送/)
    assert.match(classified.technicalDetail, /intent=plan/)
  })

  it('引擎不可用按版本原因给不同建议', () => {
    const classified = errorHandler.classifyError(blocked(
      'engine-unavailable',
      'Engine "pi" is not available (version-too-old, version 0.73.0)',
      { engine: 'pi', availabilityReason: 'version-too-old', version: '0.73.0' },
    ))

    assert.match(classified.message, /0\.73\.0/)
    assert.doesNotMatch(classified.message, /is not available|version-too-old/)
  })

  it('旧版纯文本错误（如 H5 409）仍按同一套 reason 本地化', () => {
    const classified = classify('Session sess-dead has no active process')

    assert.equal(classified.retryable, false)
    assert.equal(classified.message, i18n.global.t('errors.sessionNotActive'))
  })
})
