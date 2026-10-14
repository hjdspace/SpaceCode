// @vitest-environment node
/**
 * 思考参数按模型族分发 —— issue #40 问题 2 的根因。
 *
 * 代理过去把 `thinking` / `enable_thinking` / `chat_template_kwargs` 三套同时发给
 * 上游，指望"各家取自己认的那一套"。会校验未知参数的网关（LiteLLM）不这么干：
 * `400 UnsupportedParamsError: openai does not support parameters: ['thinking'],
 * for model=qwen3.8-27b` —— 确定性 400，重发多少次都一样。
 *
 * 契约有两个方向：认得出的族不能再带 Anthropic 式 `thinking`；认不出的族保持三套
 * 齐发，因为收窄默认分支会把历史上"忽略未知参数"的那批网关打断。
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { isChatTemplateThinkingModel, resolveThinkingParams } from '../thinkingParams.ts'

describe('isChatTemplateThinkingModel', () => {
  it('认得 vLLM/ChatML 一系的模型名', () => {
    for (const model of ['qwen3.8-27b', 'Qwen2.5-VL-72B', 'MiMo-7B', 'DeepSeek-R1', 'pangu-pro']) {
      assert.equal(isChatTemplateThinkingModel(model), true, model)
    }
  })

  it('其他模型名与缺失模型名都不算这一族', () => {
    for (const model of ['deepseek-reasoner', 'gpt-4o', 'kimi-k2', '', undefined, null, 42]) {
      assert.equal(isChatTemplateThinkingModel(model), false, String(model))
    }
  })
})

describe('resolveThinkingParams', () => {
  it('chat-template 族只发这一族认得的两种写法', () => {
    assert.deepEqual(resolveThinkingParams('qwen3.8-27b', true), {
      enable_thinking: true,
      chat_template_kwargs: { thinking: true, enable_thinking: true },
    })
  })

  it('认不出的模型保持三套齐发', () => {
    assert.deepEqual(resolveThinkingParams('deepseek-reasoner', true), {
      thinking: { type: 'enabled' },
      enable_thinking: true,
      chat_template_kwargs: { thinking: true, enable_thinking: true },
    })
  })

  it('没开思考时一个私有参数都不发', () => {
    assert.deepEqual(resolveThinkingParams('qwen3.8-27b', false), {})
    assert.deepEqual(resolveThinkingParams(undefined, false), {})
  })
})
