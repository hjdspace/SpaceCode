// @vitest-environment node
/**
 * 推理深度的单一口径。
 *
 * 桌面原来各处手抄 4 档 union，既少了运行时 CLI 支持的 xhigh，又把 max 标成 "Extra High"
 * （那个名字属于 xhigh）。能力表里的每一行都来自探针捕获的真实请求体，不是推测：
 * `--effort xhigh` 在 sonnet-4-6 上被引擎降成 high，sonnet-4-5 / haiku 则整个丢弃 effort
 * —— 给一档都不可用的模型渲染可点档位就是装饰品。
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  EFFORT_LEVELS,
  clampEffortLevel,
  getSupportedEffortLevels,
  isEffortLevel,
  normalizeEffortLevel,
  toPiThinkingLevel,
  type EffortLevel,
} from '../effort.ts'

describe('档位词汇', () => {
  it('覆盖运行时 CLI 认得的全部 5 档', () => {
    assert.deepEqual([...EFFORT_LEVELS], ['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('只认这 5 个值', () => {
    for (const v of EFFORT_LEVELS) assert.equal(isEffortLevel(v), true, v)
    // minimal 是 pi 侧词汇，运行时 CLI 的枚举里没有它
    for (const v of ['minimal', 'ultrathink', 'ultracode', 'AUTO', '', undefined, null, 3, {}]) {
      assert.equal(isEffortLevel(v), false, String(v))
    }
  })

  it('收敛到兜底档，用于读取历史持久化值', () => {
    assert.equal(normalizeEffortLevel('xhigh'), 'xhigh')
    assert.equal(normalizeEffortLevel('turbo'), 'high')
    assert.equal(normalizeEffortLevel(undefined, 'low'), 'low')
  })
})

describe('getSupportedEffortLevels', () => {
  it('sonnet-4-6 没有 xhigh，其余 4 档可用', () => {
    assert.deepEqual([...getSupportedEffortLevels('claude-sonnet-4-6')], ['low', 'medium', 'high', 'max'])
  })

  it('sonnet-4-5 与 haiku 一档都没有', () => {
    assert.deepEqual([...getSupportedEffortLevels('claude-sonnet-4-5-20250929')], [])
    assert.deepEqual([...getSupportedEffortLevels('claude-haiku-4-5')], [])
    assert.deepEqual([...getSupportedEffortLevels('claude-3-5-sonnet-20241022')], [])
  })

  it('opus-4-7 与未知名按全档处理（实测 CLI 对未知模型名默认透传）', () => {
    assert.deepEqual([...getSupportedEffortLevels('claude-opus-4-7')], [...EFFORT_LEVELS])
    assert.deepEqual([...getSupportedEffortLevels('deepseek-v4-pro')], [...EFFORT_LEVELS])
    assert.deepEqual([...getSupportedEffortLevels('foo-bar-9')], [...EFFORT_LEVELS])
    assert.deepEqual([...getSupportedEffortLevels(undefined)], [...EFFORT_LEVELS])
  })

  it('匹配忽略大小写', () => {
    assert.deepEqual([...getSupportedEffortLevels('Claude-Sonnet-4-6')], ['low', 'medium', 'high', 'max'])
  })

  it('用户覆盖优先于内置表', () => {
    const overrides: Record<string, EffortLevel[]> = { 'claude-haiku-4-5': ['low', 'high'] }
    assert.deepEqual([...getSupportedEffortLevels('claude-haiku-4-5', overrides)], ['low', 'high'])
  })
})

describe('clampEffortLevel', () => {
  it('可用就原样返回', () => {
    assert.equal(clampEffortLevel('high', EFFORT_LEVELS), 'high')
    assert.equal(clampEffortLevel('max', ['low', 'medium', 'high', 'max']), 'max')
  })

  it('不可用时向下取最近一档，绝不向上（引擎就是向下钳的）', () => {
    assert.equal(clampEffortLevel('xhigh', ['low', 'medium', 'high', 'max']), 'high')
    assert.equal(clampEffortLevel('high', ['low']), 'low')
  })

  it('一档都没有时返回 null，由界面收起选择区', () => {
    assert.equal(clampEffortLevel('high', []), null)
  })
})

describe('toPiThinkingLevel', () => {
  it('关掉思考就是 off，深度不参与', () => {
    assert.equal(toPiThinkingLevel(false, 'max'), 'off')
  })

  it('pi 的枚举没有 max，最深只到 xhigh', () => {
    assert.equal(toPiThinkingLevel(true, 'max'), 'xhigh')
    assert.equal(toPiThinkingLevel(true, 'xhigh'), 'xhigh')
    assert.equal(toPiThinkingLevel(true, 'low'), 'low')
  })
})
