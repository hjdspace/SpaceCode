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

import { isChatTemplateThinkingModel, readRequestedEffort, resolveThinkingParams } from '../thinkingParams.ts'

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

/**
 * 推理深度到 OpenAI 兼容侧的传递。
 *
 * CLI 的 `--effort` 落到 Anthropic 请求体是 `output_config.effort`，代理此前完全没读它，
 * 所以档位走兼容网关时整条丢失。上游对 reasoning_effort 做的是枚举严格校验（实测
 * `400 'reasoning_effort' must be one of: 'low','medium','high','xhigh','max'`），
 * 因此认不出的值必须宁可不发 —— 发一个非法值会把整条请求打成 400。
 */
describe('readRequestedEffort', () => {
  it('从 output_config.effort 读出档位', () => {
    assert.equal(readRequestedEffort({ output_config: { effort: 'xhigh' } }), 'xhigh')
    assert.equal(readRequestedEffort({ output_config: { effort: 'max' } }), 'max')
  })

  it('缺失或不在 CLI 有效档位内都不返回', () => {
    for (const body of [
      undefined,
      null,
      {},
      { output_config: {} },
      { output_config: { effort: 'minimal' } },
      { output_config: { effort: 'turbo' } },
      { output_config: { effort: 3 } },
    ]) {
      assert.equal(readRequestedEffort(body), undefined, JSON.stringify(body))
    }
  })
})

describe('resolveThinkingParams 的档位维度', () => {
  it('两族都带上 reasoning_effort', () => {
    assert.deepEqual(
      resolveThinkingParams('qwen3.8-27b', true, 'high'),
      {
        enable_thinking: true,
        chat_template_kwargs: { thinking: true, enable_thinking: true },
        reasoning_effort: 'high',
      },
    )
    assert.deepEqual(
      resolveThinkingParams('deepseek-reasoner', true, 'max'),
      {
        thinking: { type: 'enabled' },
        enable_thinking: true,
        chat_template_kwargs: { thinking: true, enable_thinking: true },
        reasoning_effort: 'max',
      },
    )
  })

  it('不传档位时保持原形状，不凭空加 reasoning_effort', () => {
    assert.deepEqual(resolveThinkingParams('deepseek-reasoner', true, undefined), {
      thinking: { type: 'enabled' },
      enable_thinking: true,
      chat_template_kwargs: { thinking: true, enable_thinking: true },
    })
  })

  it('思考关着时深度也不发', () => {
    assert.deepEqual(resolveThinkingParams('deepseek-reasoner', false, 'max'), {})
  })
})
