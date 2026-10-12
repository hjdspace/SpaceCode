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
