// @vitest-environment node
/**
 * 本地代理的模型映射：把 Claude Code 请求的模型名改写为上游网关可用模型。
 *
 * 背景：桌面端把 ANTHROPIC_BASE_URL 指向本地代理，代理按档位 (haiku/sonnet/opus)
 * 或默认模型改写 body.model。改写规则一旦出错（如 [1M] 后缀未剥除、子串误判），
 * 上游会因模型不存在而拒绝请求。
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { stripOneMSuffix, mapModel, applyModelMapping } from '../../../electron/proxy/modelMapper.ts'

describe('stripOneMSuffix', () => {
  it('剥除结尾的 [1M] 标记并去除残留空白', () => {
    assert.equal(stripOneMSuffix('claude-sonnet-4[1M]'), 'claude-sonnet-4')
    assert.equal(stripOneMSuffix('claude-sonnet-4 [1M] '), 'claude-sonnet-4')
  })

  it('大小写不敏感', () => {
    assert.equal(stripOneMSuffix('claude-sonnet-4[1m]'), 'claude-sonnet-4')
  })

  it('无标记时原样返回', () => {
    assert.equal(stripOneMSuffix('claude-opus-4'), 'claude-opus-4')
  })
})

describe('mapModel', () => {
  const mapping = {
    haikuModel: 'up-haiku',
    sonnetModel: 'up-sonnet',
    opusModel: 'up-opus',
    defaultModel: 'up-default',
  }

  it('无 mapping 配置时原样返回', () => {
    assert.equal(mapModel('claude-haiku-4'), 'claude-haiku-4')
  })

  it('按档位子串映射到对应上游模型', () => {
    assert.equal(mapModel('claude-haiku-4', mapping), 'up-haiku')
    assert.equal(mapModel('claude-sonnet-4', mapping), 'up-sonnet')
    assert.equal(mapModel('claude-opus-4', mapping), 'up-opus')
  })

  it('档位匹配对大小写不敏感', () => {
    assert.equal(mapModel('CLAUDE-OPUS-4', mapping), 'up-opus')
  })

  it('未命中档位时回退到 defaultModel', () => {
    assert.equal(mapModel('some-other-model', mapping), 'up-default')
  })

  it('未命中档位且无 defaultModel 时返回剥除后缀的原名', () => {
    assert.equal(mapModel('mystery[1M]', { haikuModel: 'up-haiku' }), 'mystery')
  })

  it('先剥除 [1M] 再做档位匹配', () => {
    assert.equal(mapModel('claude-sonnet-4[1M]', mapping), 'up-sonnet')
  })

  it('只配置了单个档位时其他档位走原名', () => {
    assert.equal(mapModel('claude-opus-4', { sonnetModel: 'up-sonnet' }), 'claude-opus-4')
  })
})

describe('applyModelMapping', () => {
  it('改写 body.model 并返回原值与新值', () => {
    const body: Record<string, unknown> = { model: 'claude-sonnet-4' }
    const result = applyModelMapping(body, { sonnetModel: 'up-sonnet' })
    assert.equal(body.model, 'up-sonnet')
    assert.deepEqual(result, { originalModel: 'claude-sonnet-4', mappedModel: 'up-sonnet' })
  })

  it('body.model 缺失时按空串处理', () => {
    const body: Record<string, unknown> = {}
    const result = applyModelMapping(body)
    assert.equal(body.model, '')
    assert.deepEqual(result, { originalModel: '', mappedModel: '' })
  })
})
