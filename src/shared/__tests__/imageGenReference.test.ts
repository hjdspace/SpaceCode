import { describe, it, expect } from 'vitest'
import { IMAGEGEN_PRESETS } from '../imageGenReference'

describe('IMAGEGEN_PRESETS', () => {
  it('火山方舟落到 seedream 方言，不是 openai —— 这是它与「OpenAI 兼容」宣传语的实际差异', () => {
    expect(IMAGEGEN_PRESETS.ark.dialect).toBe('seedream')
  })

  it('OpenAI 与智谱各自锁定自己的方言', () => {
    expect(IMAGEGEN_PRESETS.openai.dialect).toBe('openai')
    expect(IMAGEGEN_PRESETS.zhipu.dialect).toBe('zhipu')
  })

  it('三家预置填的是各自的真实端点与默认模型', () => {
    expect(IMAGEGEN_PRESETS.openai.baseUrl).toBe('https://api.openai.com/v1')
    expect(IMAGEGEN_PRESETS.openai.model).toBe('gpt-image-1')
    expect(IMAGEGEN_PRESETS.zhipu.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(IMAGEGEN_PRESETS.zhipu.model).toBe('cogview-4')
    expect(IMAGEGEN_PRESETS.ark.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3')
    expect(IMAGEGEN_PRESETS.ark.model).toBe('doubao-seedream-4-0-250828')
  })

  it('baseUrl 不带尾斜杠 —— 客户端拼路径时不必再去重', () => {
    for (const preset of Object.values(IMAGEGEN_PRESETS)) {
      expect(preset.baseUrl.endsWith('/')).toBe(false)
    }
  })

  it('自定义不在预置表里：它没有端点也没有默认模型可填', () => {
    expect(Object.keys(IMAGEGEN_PRESETS).sort()).toEqual(['ark', 'openai', 'zhipu'])
  })
})