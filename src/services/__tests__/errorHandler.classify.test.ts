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
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { errorHandler } from '../errorHandler.ts'
import { ErrorCategory } from '@/types'

const GATEWAY_400 = 'API Error: 400 {"error":{"message":"Can only get item pairs from a mapping.",'
  + '"type":"BadRequestError","param":"","code":400}}'

function classify(message: string) {
  return errorHandler.classifyError(new Error(message))
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
