// @vitest-environment node
/**
 * 推理深度的单一口径。
 *
 * 桌面原来各处手抄 4 档 union，既少了运行时 CLI 支持的 xhigh，又把 max 标成 "Extra High"
 * （那个名字属于 xhigh）。能力表里的每一行都来自探针捕获的真实请求体，不是推测：
 * `--effort xhigh` 在 sonnet-4-6 上被引擎降成 high，sonnet-4-5 / haiku 则整个丢弃 effort
 * —— 给一档都不可用的模型渲染可点档位就是装饰品。
 *
 * 可用档位有**两维**：模型维（上面那张表）和引擎维（内部引擎压根不认 xhigh）。两维都得
 * 参与呈现与下发 —— 只按模型过滤时，任何网关/未知模型名都会拿到桌面全集，于是内部引擎
 * 会话带着 `--effort xhigh` 起来，commander 抛 InvalidArgumentError，进程 exit 1。
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  BUNDLED_ENGINE_EFFORT_LEVELS,
  EFFORT_LEVELS,
  INSTALLED_ENGINE_EFFORT_LEVELS,
  clampEffortLevel,
  getEngineEffortLevels,
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

describe('getSupportedEffortLevels — 模型维', () => {
  // 这一组固定传安装版 CLI 的全集，单独测模型表；引擎维在下面一组。
  const ALL = INSTALLED_ENGINE_EFFORT_LEVELS

  it('sonnet-4-6 没有 xhigh，其余 4 档可用', () => {
    assert.deepEqual([...getSupportedEffortLevels('claude-sonnet-4-6', ALL)], ['low', 'medium', 'high', 'max'])
  })

  it('sonnet-4-5 与 haiku 一档都没有', () => {
    assert.deepEqual([...getSupportedEffortLevels('claude-sonnet-4-5-20250929', ALL)], [])
    assert.deepEqual([...getSupportedEffortLevels('claude-haiku-4-5', ALL)], [])
    assert.deepEqual([...getSupportedEffortLevels('claude-3-5-sonnet-20241022', ALL)], [])
  })

  it('opus-4-7 与未知名按全档处理（实测 CLI 对未知模型名默认透传）', () => {
    assert.deepEqual([...getSupportedEffortLevels('claude-opus-4-7', ALL)], [...EFFORT_LEVELS])
    assert.deepEqual([...getSupportedEffortLevels('deepseek-v4-pro', ALL)], [...EFFORT_LEVELS])
    assert.deepEqual([...getSupportedEffortLevels('foo-bar-9', ALL)], [...EFFORT_LEVELS])
    assert.deepEqual([...getSupportedEffortLevels(undefined, ALL)], [...EFFORT_LEVELS])
  })

  it('匹配忽略大小写', () => {
    assert.deepEqual([...getSupportedEffortLevels('Claude-Sonnet-4-6', ALL)], ['low', 'medium', 'high', 'max'])
  })

  it('用户覆盖优先于内置表', () => {
    const overrides: Record<string, EffortLevel[]> = { 'claude-haiku-4-5': ['low', 'high'] }
    assert.deepEqual([...getSupportedEffortLevels('claude-haiku-4-5', ALL, overrides)], ['low', 'high'])
  })
})

describe('getSupportedEffortLevels — 引擎维', () => {
  /** 复现用户那条崩溃：网关模型名走"全档透传"分支，引擎维是唯一还拦得住它的一层。 */
  it('内部引擎下即便模型未识别也不呈现 xhigh', () => {
    assert.deepEqual(
      [...getSupportedEffortLevels('gpt-6.1-turbo', BUNDLED_ENGINE_EFFORT_LEVELS)],
      ['low', 'medium', 'high', 'max'],
    )
  })

  it('引擎维只会收窄，不会给模型表凭空加档', () => {
    assert.deepEqual(
      [...getSupportedEffortLevels('claude-sonnet-4-6', BUNDLED_ENGINE_EFFORT_LEVELS)],
      [...getSupportedEffortLevels('claude-sonnet-4-6', INSTALLED_ENGINE_EFFORT_LEVELS)],
    )
    assert.deepEqual([...getSupportedEffortLevels('claude-haiku-4-5', BUNDLED_ENGINE_EFFORT_LEVELS)], [])
  })

  it('xhigh 在内部引擎上被向下钳到 high，而不是递给 spawn 当致命参数', () => {
    const supported = getSupportedEffortLevels('gpt-6.1-turbo', getEngineEffortLevels('bundled'))
    assert.equal(clampEffortLevel('xhigh', supported), 'high')
    assert.equal(clampEffortLevel('xhigh', getEngineEffortLevels('installed')), 'xhigh')
  })
})

describe('getEngineEffortLevels', () => {
  it('engineSource 缺省按 bundled 算 —— 少一档只是选项变少，多一档是会话起不来', () => {
    assert.deepEqual([...getEngineEffortLevels(undefined)], [...BUNDLED_ENGINE_EFFORT_LEVELS])
    assert.deepEqual([...getEngineEffortLevels('bundled')], [...BUNDLED_ENGINE_EFFORT_LEVELS])
    assert.deepEqual([...getEngineEffortLevels('installed')], [...INSTALLED_ENGINE_EFFORT_LEVELS])
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
