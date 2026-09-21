import { describe, it, expect } from 'vitest'
import {
  enrichModels,
  formatTokenCount,
  parseEndpointCapabilities,
  parseModelsDevCatalog,
  providerKeyFromBaseUrl,
} from '@/lib/modelCatalog'
import type { Catalog } from '@/lib/modelCatalog'

// 模拟 models.dev 目录数据
const mockCatalog: Catalog = {
  anthropic: {
    name: 'Anthropic',
    baseUrl: null,
    models: {
      'claude-haiku-4-5': { context: 200_000, output: 64_000, image: true },
      'claude-sonnet-4-6': { context: 1_000_000, output: 128_000, image: true },
      'claude-haiku-4-5-20251001': { context: 200_000, output: 64_000, image: true },
    },
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: {
      'deepseek-v4-pro': { context: 128_000, output: 8_000, image: false },
    },
  },
}

describe('parseEndpointCapabilities', () => {
  it('解析端点自述上下文字段（各家命名）', () => {
    expect(parseEndpointCapabilities({ id: 'a', context_length: 131072 }).contextWindow).toBe(131072)
    expect(parseEndpointCapabilities({ id: 'a', max_model_len: 8192 }).contextWindow).toBe(8192)
    expect(parseEndpointCapabilities({ id: 'a', context_window: '4096' }).contextWindow).toBe(4096)
  })

  it('解析端点自述输出字段', () => {
    expect(parseEndpointCapabilities({ id: 'a', max_output_tokens: 4096 }).maxTokens).toBe(4096)
    expect(parseEndpointCapabilities({ id: 'a', max_completion_tokens: 2048 }).maxTokens).toBe(2048)
  })

  it('解析端点自述图片支持', () => {
    expect(parseEndpointCapabilities({ id: 'a', modalities: ['text', 'image'] }).supportsImages).toBe(true)
    expect(parseEndpointCapabilities({ id: 'a', input_modalities: ['text'] }).supportsImages).toBe(false)
  })

  it('无自述字段时返回空对象', () => {
    expect(parseEndpointCapabilities({ id: 'a' })).toEqual({})
    expect(parseEndpointCapabilities({ id: 'a', context_length: -1 })).toEqual({})
    expect(parseEndpointCapabilities({ id: 'a', context_length: 1.5 })).toEqual({})
  })
})

describe('parseModelsDevCatalog', () => {
  it('解析 models.dev api.json 结构', () => {
    const catalog = parseModelsDevCatalog({
      anthropic: {
        name: 'Anthropic',
        models: {
          'claude-sonnet-4-6': {
            id: 'claude-sonnet-4-6',
            limit: { context: 1_000_000, output: 128_000 },
            modalities: { input: ['text', 'image', 'pdf'] },
          },
        },
      },
    })
    expect(catalog.anthropic.models['claude-sonnet-4-6']).toEqual({
      context: 1_000_000,
      output: 128_000,
      image: true,
    })
  })

  it('非法输入返回空目录', () => {
    expect(parseModelsDevCatalog(null)).toEqual({})
    expect(parseModelsDevCatalog('x')).toEqual({})
  })
})

describe('providerKeyFromBaseUrl', () => {
  it('内置 baseUrl 精确匹配', () => {
    expect(providerKeyFromBaseUrl('https://api.anthropic.com', mockCatalog)).toBe('anthropic')
    expect(providerKeyFromBaseUrl('https://api.openai.com/v1', mockCatalog)).toBe('openai')
  })

  it('目录中的 baseUrl 匹配', () => {
    expect(providerKeyFromBaseUrl('https://api.deepseek.com', mockCatalog)).toBe('deepseek')
  })

  it('host 包含匹配（带路径后缀）', () => {
    expect(providerKeyFromBaseUrl('https://api.deepseek.com/v1', mockCatalog)).toBe('deepseek')
  })

  it('未知 baseUrl 返回 null', () => {
    expect(providerKeyFromBaseUrl('https://unknown.example.com', mockCatalog)).toBeNull()
  })
})

describe('enrichModels', () => {
  it('端点自述字段优先于目录', () => {
    const rawById = new Map([['claude-haiku-4-5', { id: 'claude-haiku-4-5', context_length: 999_999 }]])
    const result = enrichModels(
      [{ id: 'claude-haiku-4-5' }],
      'https://api.anthropic.com',
      mockCatalog,
      rawById,
    )
    expect(result[0].contextWindow).toBe(999_999)
    expect(result[0].supportsImages).toBe(true) // 目录补全图片
  })

  it('按 baseUrl 匹配 provider 并补全元数据', () => {
    const result = enrichModels(
      [{ id: 'claude-haiku-4-5' }],
      'https://api.anthropic.com',
      mockCatalog,
    )
    expect(result[0].contextWindow).toBe(200_000)
    expect(result[0].maxTokens).toBe(64_000)
    expect(result[0].supportsImages).toBe(true)
  })

  it('baseUrl 未收录时按 modelId 前缀跨 provider 匹配', () => {
    const result = enrichModels(
      [{ id: 'claude-sonnet-4-6' }],
      'https://my-proxy.example.com/v1',
      mockCatalog,
    )
    expect(result[0].contextWindow).toBe(1_000_000)
    expect(result[0].supportsImages).toBe(true)
  })

  it('目录带日期后缀而请求 id 无后缀时仍匹配', () => {
    const result = enrichModels(
      [{ id: 'claude-haiku-4-5-20251001' }],
      'https://api.anthropic.com',
      mockCatalog,
    )
    expect(result[0].contextWindow).toBe(200_000)
  })

  it('完全未收录的模型元数据留空', () => {
    const result = enrichModels(
      [{ id: 'totally-unknown-model' }],
      'https://my-proxy.example.com/v1',
      mockCatalog,
    )
    expect(result[0].contextWindow).toBeUndefined()
    expect(result[0].maxTokens).toBeUndefined()
    expect(result[0].supportsImages).toBeUndefined()
  })

  it('空目录时端点自述字段仍然生效', () => {
    const rawById = new Map([['m1', { id: 'm1', context_length: 4096, modalities: ['text', 'image'] }]])
    const result = enrichModels([{ id: 'm1' }], '', {}, rawById)
    expect(result[0].contextWindow).toBe(4096)
    expect(result[0].supportsImages).toBe(true)
  })

  it('保留原始 id 与 name', () => {
    const result = enrichModels([{ id: 'm1', name: 'My Model' }], 'https://api.anthropic.com', mockCatalog)
    expect(result[0]).toMatchObject({ id: 'm1', name: 'My Model' })
  })
})

describe('formatTokenCount', () => {
  it('格式化百万级', () => {
    expect(formatTokenCount(1_000_000)).toBe('1M')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
  })
  it('格式化千级', () => {
    expect(formatTokenCount(200_000)).toBe('200K')
    expect(formatTokenCount(128_000)).toBe('128K')
  })
  it('小数值原样返回', () => {
    expect(formatTokenCount(500)).toBe('500')
  })
})
