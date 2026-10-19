import { describe, it, expect } from 'vitest'

import { resolveModelAliasForEngine, type ProviderModelSlots } from '../engineModel'

const slots: ProviderModelSlots = {
  haikuModel: 'glm-5.2',
  sonnetModel: 'kimi-k3',
  opusModel: 'deepseek-v4-flash',
}

describe('resolveModelAliasForEngine', () => {
  it('claude-code：槽位实际名反查成别名，代理才按它挑路由', () => {
    expect(resolveModelAliasForEngine('glm-5.2', slots, 'claude-code')).toBe('haiku')
    expect(resolveModelAliasForEngine('kimi-k3', slots, 'claude-code')).toBe('sonnet')
    expect(resolveModelAliasForEngine('deepseek-v4-flash', slots, 'claude-code')).toBe('opus')
  })

  it('claude-code：槽位之外的模型原样交给引擎', () => {
    expect(resolveModelAliasForEngine('qwen-model', slots, 'claude-code')).toBe('qwen-model')
  })

  it('claude-code：同一模型配进多个槽位时按 haiku > sonnet > opus', () => {
    expect(resolveModelAliasForEngine('same', { haikuModel: 'same', sonnetModel: 'same', opusModel: 'same' }, 'claude-code'))
      .toBe('haiku')
  })

  it('pi：保留真实模型 id —— Pi 的 --model 直接给上游，别名在它眼里是个不存在的模型', () => {
    expect(resolveModelAliasForEngine('kimi-k3', slots, 'pi')).toBe('kimi-k3')
    expect(resolveModelAliasForEngine('deepseek-v4-flash', slots, 'pi')).toBe('deepseek-v4-flash')
  })

  it('engineType 未落定时按 claude-code 处理（网关的默认引擎）', () => {
    expect(resolveModelAliasForEngine('kimi-k3', slots, undefined)).toBe('sonnet')
  })

  it('订阅登录等没有槽位的场合一律原样返回', () => {
    expect(resolveModelAliasForEngine('kimi-k3', null, 'claude-code')).toBe('kimi-k3')
    expect(resolveModelAliasForEngine('kimi-k3', undefined, 'pi')).toBe('kimi-k3')
  })
})
