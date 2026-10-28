/**
 * useModelSelector 的真实模块测试。
 *
 * 这份以前把 composable 里的逻辑手抄成 8 个本地函数再测副本：副本改了 composable 不会失败，
 * composable 坏了副本照样绿 —— 对模块是否可用零敏感。现在全部改成驱动真 composable、
 * 断言它返回的 computed 与方法。
 *
 * 档位（推理深度）部分同时钉住本次修正的口径：可用档位由**两维**决定 —— 模型能力与引擎
 * 自己的 `--effort` 词汇表，两维都参与呈现；换模型时向下降档并回写 store，界面显示的必须
 * 就是引擎会发出的那一档。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useModelSelector, type ModelOption } from '@/composables/useModelSelector'
import { useSettingsStore } from '@/stores/settings'

const mockState = vi.hoisted(() => ({
  httpFetch: vi.fn(),
}))

vi.mock('@/services/h5ApiClient', () => ({
  isH5Mode: () => false,
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    httpFetch: mockState.httpFetch,
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(''),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
    trace: { event: vi.fn() },
  },
}))

type SlotConfig = { haikuModel?: string; sonnetModel?: string; opusModel?: string }

/**
 * 一个 store 上只挂一个 selector：两个实例会各自 watch 同一份 availableModes，
 * 回写和 emit 都会双份发生，测试结论就不再代表真实界面。
 *
 * `engineSource` 缺 'bundled'、`engineType` 缺 'claude-code'，都跟真 store 的默认一致 ——
 * 档位有三维（模型能力 + 引擎族 + 该族里哪个二进制），不写出来的用例就等于默认在测
 * 内部 Claude 引擎那一套。
 */
function setupSelector(
  slots: SlotConfig = {},
  emitted: string[] = [],
  engineSource: 'bundled' | 'installed' = 'bundled',
  engineType: 'claude-code' | 'pi' = 'claude-code',
) {
  const settingsStore = useSettingsStore()
  settingsStore.authMethod = 'anthropic_compatible'
  settingsStore.engineSource = engineSource
  settingsStore.engineType = engineType
  settingsStore.anthropicConfig = { ...settingsStore.anthropicConfig, apiKey: '', baseUrl: '', ...slots }
  const selector = useModelSelector({ onUpdateEffort: (e) => emitted.push(e) })
  return { selector, settingsStore, emitted }
}

function selectorFor(
  slots: SlotConfig = {},
  engineSource: 'bundled' | 'installed' = 'bundled',
  engineType: 'claude-code' | 'pi' = 'claude-code',
) {
  return setupSelector(slots, [], engineSource, engineType)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  mockState.httpFetch.mockReset()
  mockState.httpFetch.mockResolvedValue({ ok: false, status: 0, error: 'not allowed' })
})

describe('模型列表取用优先级', () => {
  it('配置了槽位模型时只用它，不用 API 拉回来的列表', async () => {
    const { selector } = selectorFor({ sonnetModel: 'my-sonnet' })
    selector.fetchedModels.value = [{ label: 'Claude 4', value: 'claude-4' }]

    expect(selector.availableModels.value).toEqual([{ label: 'my-sonnet', value: 'my-sonnet' }])
  })

  it('没配槽位但拉到过列表时，退回那批拉回来的模型', () => {
    const { selector } = setupSelector()
    selector.fetchedModels.value = [{ label: 'Claude 4', value: 'claude-4' }]

    expect(selector.availableModels.value).toEqual([{ label: 'Claude 4', value: 'claude-4' }])
  })

  it('两边都没有时返回空列表，不再用硬编码默认模型兜底', () => {
    const { selector } = setupSelector()

    expect(selector.availableModels.value).toEqual([])
    expect(selector.hasConfiguredModels.value).toBe(false)
  })

  it('默认列表仍按认证方式给出（仅作展示用途的后备）', () => {
    const { selector } = setupSelector()

    expect(selector.getDefaultModels().map((m: ModelOption) => m.value)).toContain('claude-3-5-sonnet-20241022')
  })
})

describe('hasConfiguredModels', () => {
  it('非槽位型认证方式下没有可配模型', () => {
    const settingsStore = useSettingsStore()
    settingsStore.authMethod = 'claudeai'

    expect(useModelSelector().hasConfiguredModels.value).toBe(false)
  })

  it('三个槽位都为空串时是 false', () => {
    const { selector } = selectorFor({ haikuModel: '', sonnetModel: '', opusModel: '' })
    expect(selector.hasConfiguredModels.value).toBe(false)
  })

  it('至少配了一个就是 true', () => {
    const { selector } = selectorFor({ sonnetModel: 'my-model' })
    expect(selector.hasConfiguredModels.value).toBe(true)
  })

  it('三个都配了同样是 true', () => {
    const { selector } = selectorFor({ haikuModel: 'h', sonnetModel: 's', opusModel: 'o' })
    expect(selector.hasConfiguredModels.value).toBe(true)
  })
})

describe('当前模型的显示名', () => {
  it('选中列表里的模型时显示它的 label', () => {
    const { selector } = selectorFor({ sonnetModel: 'labeled-sonnet' })
    selector.selectedModel.value = 'labeled-sonnet'
    expect(selector.selectedModelLabel.value).toBe('labeled-sonnet')
  })

  it('选中列表外的模型时原样显示那个值', () => {
    const { selector } = selectorFor({ sonnetModel: 'a-sonnet' })
    selector.selectedModel.value = 'unknown-model'
    expect(selector.selectedModelLabel.value).toBe('unknown-model')
  })

  it('什么都没选时给占位文案', () => {
    const { selector } = selectorFor({ sonnetModel: 'a-sonnet' })
    selector.selectedModel.value = ''
    expect(selector.selectedModelLabel.value).toBe('Select Model')
  })
})

describe('canRefreshModels', () => {
  it('baseUrl 与 apiKey 齐全才能刷新', () => {
    const { selector } = selectorFor({ sonnetModel: 's' })
    const settingsStore = useSettingsStore()
    settingsStore.anthropicConfig = { ...settingsStore.anthropicConfig, baseUrl: 'https://api.anthropic.com', apiKey: 'sk-xxx' }
    expect(selector.canRefreshModels.value).toBe(true)
  })

  it('缺 apiKey / 缺 baseUrl / 两者都缺都不能刷新', () => {
    const { selector } = selectorFor({ sonnetModel: 's' })
    const settingsStore = useSettingsStore()
    settingsStore.anthropicConfig = { ...settingsStore.anthropicConfig, baseUrl: 'https://api.anthropic.com', apiKey: '' }
    expect(selector.canRefreshModels.value).toBe(false)
    settingsStore.anthropicConfig = { ...settingsStore.anthropicConfig, baseUrl: '', apiKey: 'sk-xxx' }
    expect(selector.canRefreshModels.value).toBe(false)
    settingsStore.anthropicConfig = { ...settingsStore.anthropicConfig, baseUrl: '', apiKey: '' }
    expect(selector.canRefreshModels.value).toBe(false)
  })
})

describe('键盘导航在列表里循环', () => {
  const three = { haikuModel: 'm1', sonnetModel: 'm2', opusModel: 'm3' }

  it('向下逐个走，越界回到最后一个', () => {
    const { selector } = selectorFor(three)
    selector.navigateModels(1)
    expect(selector.highlightedModel.value).toBe('m1')
    selector.navigateModels(1)
    expect(selector.highlightedModel.value).toBe('m2')
    selector.navigateModels(1)
    expect(selector.highlightedModel.value).toBe('m3')
    selector.navigateModels(1)
    expect(selector.highlightedModel.value).toBe('m1')
  })

  it('向上越界回到最后一个', () => {
    const { selector } = selectorFor(three)
    selector.navigateModels(-1)
    expect(selector.highlightedModel.value).toBe('m3')
  })

  it('列表为空时不动高亮', () => {
    const { selector } = setupSelector()
    selector.navigateModels(1)
    expect(selector.highlightedModel.value).toBeNull()
  })
})

describe('getConfiguredProviderModels', () => {
  it('非槽位型认证方式返回空', () => {
    const settingsStore = useSettingsStore()
    settingsStore.authMethod = 'claudeai'

    expect(useModelSelector().getConfiguredProviderModels()).toEqual([])
  })

  it('同值槽位去重，保留首次出现的顺序', () => {
    const { selector } = selectorFor({ haikuModel: 'same', sonnetModel: 'same', opusModel: 'other' })
    expect(selector.getConfiguredProviderModels()).toEqual([
      { label: 'same', value: 'same' },
      { label: 'other', value: 'other' },
    ])
  })

  it('跳过空值', () => {
    const { selector } = selectorFor({ sonnetModel: 'sonnet' })
    expect(selector.getConfiguredProviderModels()).toEqual([{ label: 'sonnet', value: 'sonnet' }])
  })

  it('三个互不相同时全部返回', () => {
    const { selector } = selectorFor({ haikuModel: 'haiku', sonnetModel: 'sonnet', opusModel: 'opus' })
    expect(selector.getConfiguredProviderModels()).toHaveLength(3)
  })
})

describe('getModelAlias', () => {
  const slots = {
    haikuModel: 'deepseek-v4-flash',
    sonnetModel: 'deepseek-v4-pro',
    opusModel: 'glm-5.2',
  }

  it.each([
    ['deepseek-v4-flash', 'haiku'],
    ['deepseek-v4-pro', 'sonnet'],
    ['deepseek-v5.2-miss', 'deepseek-v5.2-miss'],
  ])('%s 解析为 %s', (value, expected) => {
    const { selector } = selectorFor(slots)
    expect(selector.getModelAlias(value)).toBe(expected)
  })

  it('opus 槽位命中时回 opus', () => {
    const { selector } = selectorFor(slots)
    expect(selector.getModelAlias('glm-5.2')).toBe('opus')
  })

  it('非槽位型认证方式下原样返回', () => {
    const settingsStore = useSettingsStore()
    settingsStore.authMethod = 'claudeai'
    expect(useModelSelector().getModelAlias('any-model')).toBe('any-model')
  })

  it('同值占多个槽位时取优先级最高的那个（haiku > sonnet > opus）', () => {
    const { selector } = selectorFor({ haikuModel: 'same', sonnetModel: 'same', opusModel: 'other' })
    expect(selector.getModelAlias('same')).toBe('haiku')
  })

  it('空槽位不参与匹配', () => {
    const { selector } = selectorFor({ sonnetModel: 'sonnet-model' })
    expect(selector.getModelAlias('sonnet-model')).toBe('sonnet')
    expect(selector.getModelAlias('')).toBe('')
  })
})

describe('推理深度档位随模型能力与引擎词汇变化', () => {
  it('安装版 CLI 下 opus-4-7 有全部 5 档，sonnet-4-6 没有 xhigh', () => {
    const { selector } = selectorFor({ sonnetModel: 'claude-sonnet-4-6', opusModel: 'claude-opus-4-7' }, 'installed')

    selector.selectedModel.value = 'claude-opus-4-7'
    expect([...selector.availableModes.value]).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])

    selector.selectedModel.value = 'claude-sonnet-4-6'
    expect([...selector.availableModes.value]).toEqual(['low', 'medium', 'high', 'max'])
  })

  /**
   * 这条钉住那次"引擎进程异常"的成因：内部引擎压根不认 xhigh，把它呈现出来就等于递给
   * spawn 一颗雷（那边是 commander 的 argParser，不认的值直接 exit 1）。未识别的模型名
   * 走"全档透传"分支，所以引擎维是唯一还拦得住它的一层。
   */
  it('内部引擎下不呈现 xhigh，含未识别的网关模型名', () => {
    const { selector } = selectorFor({ opusModel: 'claude-opus-4-7' })

    selector.selectedModel.value = 'claude-opus-4-7'
    expect([...selector.availableModes.value]).toEqual(['low', 'medium', 'high', 'max'])

    selector.selectedModel.value = 'gpt-6.1-turbo'
    expect([...selector.availableModes.value]).toEqual(['low', 'medium', 'high', 'max'])
  })

  /**
   * 用户报的那条现象：反复切换模型/深度时下拉里没有 xhigh。档位以前只看 engineSource
   * （内部 bundle 还是安装版 CLI）—— 那是 Claude 那一族内部的差异，跑 pi 时套它等于
   * 拿另一台引擎的词汇表做选项，xhigh 消失、max 还在。
   */
  it('pi 引擎用 pi 的词表：xhigh 呈现，且不被内部 Claude 的 4 档收窄', () => {
    const { selector } = selectorFor({ opusModel: 'claude-opus-4-7' }, 'bundled', 'pi')

    selector.selectedModel.value = 'claude-opus-4-7'
    expect([...selector.availableModes.value]).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('pi 引擎不套 Claude 的按模型降档表 —— 那张表说的是另一台引擎', () => {
    const { selector } = selectorFor({ sonnetModel: 'claude-haiku-4-5' }, 'bundled', 'pi')

    selector.selectedModel.value = 'claude-haiku-4-5'
    expect([...selector.availableModes.value]).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('一档都不能调的模型给出空集合', () => {
    const { selector } = selectorFor({ sonnetModel: 'claude-haiku-4-5' })
    selector.selectedModel.value = 'claude-haiku-4-5'

    expect(selector.availableModes.value).toHaveLength(0)
  })

  it('换到更少档位的模型时向下降档并回写，不发一个引擎会丢弃的档位', async () => {
    const emitted: string[] = []
    const settingsStore = useSettingsStore()
    settingsStore.authMethod = 'anthropic_compatible'
    settingsStore.anthropicConfig = {
      ...settingsStore.anthropicConfig, haikuModel: '', opusModel: 'claude-opus-4-7', sonnetModel: 'claude-sonnet-4-6',
    }
    // 先播种再挂载：selectedMode 的初值就是从 store 读进来的
    settingsStore.effortLevel = 'xhigh'
    const selector = useModelSelector({ onUpdateEffort: (e) => emitted.push(e) })

    selector.selectedModel.value = 'claude-opus-4-7'
    await nextTick()
    selector.selectMode('xhigh')
    expect(selector.selectedMode.value).toBe('xhigh')

    selector.selectedModel.value = 'claude-sonnet-4-6'
    await nextTick()

    expect([...selector.availableModes.value]).toEqual(['low', 'medium', 'high', 'max'])
    expect(selector.selectedMode.value).toBe('high')
    // 用户点 xhigh 时 emit 一次，换模型被降回 high 再 emit 一次：store 最终就是引擎会用的那档
    expect(emitted).toEqual(['xhigh', 'high'])
  })

  it('模型一档都没有时收起选择区，也不回写一个发不出的档位', async () => {
    const emitted: string[] = []
    const settingsStore = useSettingsStore()
    settingsStore.authMethod = 'anthropic_compatible'
    settingsStore.anthropicConfig = { ...settingsStore.anthropicConfig, sonnetModel: 'claude-haiku-4-5' }
    const selector = useModelSelector({ onUpdateEffort: (e) => emitted.push(e) })

    selector.selectedModel.value = 'claude-haiku-4-5'
    await nextTick()

    expect(selector.availableModes.value).toHaveLength(0)
    expect(selector.selectedMode.value).toBeNull()
    expect(emitted).toEqual([])
  })

  it('用户点档位会通知调用方', () => {
    const { selector, emitted } = setupSelector({ opusModel: 'claude-opus-4-7' })
    selector.selectedModel.value = 'claude-opus-4-7'

    selector.selectMode('max')

    expect(selector.selectedMode.value).toBe('max')
    expect(emitted).toEqual(['max'])
  })

  it('store 侧改了档位会同步到界面；不在新模型可用集合里的值被降下来', async () => {
    const { selector, settingsStore } = setupSelector({ sonnetModel: 'claude-sonnet-4-6' })
    selector.selectedModel.value = 'claude-sonnet-4-6'
    await nextTick()

    settingsStore.effortLevel = 'max'
    await nextTick()
    expect(selector.selectedMode.value).toBe('max')

    settingsStore.effortLevel = 'xhigh'
    await nextTick()
    expect(selector.selectedMode.value).toBe('high')
  })
})

// ═══════════════ 以下为覆盖率补充：拉取流程 / 多认证方式 / 交互与键盘 ═══════════════

describe('openai / gemini 认证方式的槽位读取', () => {
  it('openai_compatible 读取 openai 槽位', () => {
    const { selector, settingsStore } = setupSelector()
    settingsStore.authMethod = 'openai_compatible'
    settingsStore.openaiConfig = { ...settingsStore.openaiConfig, sonnetModel: 'gpt-x', opusModel: 'gpt-big' }

    expect(selector.availableModels.value.map((m: ModelOption) => m.value)).toEqual(['gpt-x', 'gpt-big'])
    expect(selector.getModelAlias('gpt-x')).toBe('sonnet')
    expect(selector.getModelAlias('gpt-big')).toBe('opus')
  })

  it('gemini_api 读取 gemini 槽位', () => {
    const { selector, settingsStore } = setupSelector()
    settingsStore.authMethod = 'gemini_api'
    settingsStore.geminiConfig = { ...settingsStore.geminiConfig, sonnetModel: 'gemini-x' }

    expect(selector.availableModels.value.map((m: ModelOption) => m.value)).toEqual(['gemini-x'])
    expect(selector.getModelAlias('gemini-x')).toBe('sonnet')
  })

  it('默认列表后备按认证方式给出 openai / gemini 版本', () => {
    const { selector, settingsStore } = setupSelector()
    settingsStore.authMethod = 'openai_compatible'
    expect(selector.getDefaultModels().map((m: ModelOption) => m.value)).toContain('gpt-4')

    settingsStore.authMethod = 'gemini_api'
    expect(selector.getDefaultModels().map((m: ModelOption) => m.value)).toContain('gemini-pro')
  })
})

describe('canRefreshModels 的各认证方式分支', () => {
  it('openai_compatible 按自己的 baseUrl/apiKey 判断', () => {
    const { selector, settingsStore } = setupSelector()
    settingsStore.authMethod = 'openai_compatible'
    settingsStore.openaiConfig = { ...settingsStore.openaiConfig, baseUrl: 'https://api.openai.com', apiKey: 'sk-1' }
    expect(selector.canRefreshModels.value).toBe(true)

    settingsStore.openaiConfig = { ...settingsStore.openaiConfig, apiKey: '' }
    expect(selector.canRefreshModels.value).toBe(false)
  })

  it('gemini_api 按自己的 baseUrl/apiKey 判断', () => {
    const { selector, settingsStore } = setupSelector()
    settingsStore.authMethod = 'gemini_api'
    settingsStore.geminiConfig = { ...settingsStore.geminiConfig, baseUrl: 'https://g.io', apiKey: 'k' }
    expect(selector.canRefreshModels.value).toBe(true)

    settingsStore.geminiConfig = { ...settingsStore.geminiConfig, baseUrl: '' }
    expect(selector.canRefreshModels.value).toBe(false)
  })

  it('console 等非槽位方式不能刷新', () => {
    const settingsStore = useSettingsStore()
    settingsStore.authMethod = 'console'
    expect(useModelSelector().canRefreshModels.value).toBe(false)
  })
})

describe('fetchModelsFromBaseUrl 拉取流程', () => {
  function ready(slots: SlotConfig = {}) {
    const { selector, settingsStore } = setupSelector(slots)
    settingsStore.anthropicConfig = {
      ...settingsStore.anthropicConfig, baseUrl: 'https://api.anthropic.com', apiKey: 'sk-1',
    }
    return { selector, settingsStore }
  }

  it('anthropic baseUrl 缺 /v1 时补上，带 Bearer 头请求', async () => {
    const { selector } = ready()
    mockState.httpFetch.mockResolvedValue({ ok: false, status: 500, data: '' })

    await selector.fetchModelsFromBaseUrl()

    expect(mockState.httpFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer sk-1' }) }),
    )
    expect(selector.modelLoadError.value).toBe('Fetch failed (status 500)')
  })

  it('baseUrl 已带 /v1 不重复追加；非 2xx 报状态码', async () => {
    const { selector, settingsStore } = ready()
    settingsStore.anthropicConfig = { ...settingsStore.anthropicConfig, baseUrl: 'https://gw.example/v1/' }
    mockState.httpFetch.mockResolvedValue({ ok: false, status: 401, data: '' })

    await selector.fetchModelsFromBaseUrl()

    expect(mockState.httpFetch.mock.calls[0][0]).toBe('https://gw.example/v1/models')
    expect(selector.modelLoadError.value).toBe('Fetch failed (status 401)')
  })

  it('openai 认证方式下 baseUrl 缺 /v1 时补上', async () => {
    const { selector, settingsStore } = setupSelector()
    settingsStore.authMethod = 'openai_compatible'
    settingsStore.openaiConfig = { ...settingsStore.openaiConfig, baseUrl: 'https://api.openai.com', apiKey: 'sk-o' }
    mockState.httpFetch.mockResolvedValue({ ok: false, status: 500, data: '' })

    await selector.fetchModelsFromBaseUrl()
    expect(mockState.httpFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
  })

  it('gemini 认证方式不做 /v1 补全（v1beta 不受 includes(\'/v1\') 误判）', async () => {
    const { selector, settingsStore } = setupSelector()
    settingsStore.authMethod = 'gemini_api'
    settingsStore.geminiConfig = { ...settingsStore.geminiConfig, baseUrl: 'https://g.example', apiKey: 'sk-g' }
    mockState.httpFetch.mockResolvedValue({ ok: false, status: 500, data: '' })

    await selector.fetchModelsFromBaseUrl()
    expect(mockState.httpFetch.mock.calls[0][0]).toBe('https://g.example/models')
  })

  it('裸数组响应映射为选项，label 取 name、value 取 id', async () => {
    const { selector } = ready()
    mockState.httpFetch.mockResolvedValue({
      ok: true, status: 200,
      data: JSON.stringify([{ id: 'm1', name: 'M One' }, { id: 'm2' }]),
    })

    await selector.fetchModelsFromBaseUrl()

    expect(selector.fetchedModels.value).toEqual([
      { label: 'M One', value: 'm1' },
      { label: 'm2', value: 'm2' },
    ])
    expect(selector.modelLoadError.value).toBeNull()
    expect(selector.isLoadingModels.value).toBe(false)
  })

  it('{data:[]} 与 {models:[]} 包装响应同样识别', async () => {
    const { selector } = ready()
    mockState.httpFetch.mockResolvedValueOnce({
      ok: true, status: 200, data: JSON.stringify({ data: [{ id: 'd1' }] }),
    })
    await selector.fetchModelsFromBaseUrl()
    expect(selector.fetchedModels.value.map((m: ModelOption) => m.value)).toEqual(['d1'])

    mockState.httpFetch.mockResolvedValueOnce({
      ok: true, status: 200, data: JSON.stringify({ models: [{ id: 'w1', name: 'Wrapped' }] }),
    })
    await selector.fetchModelsFromBaseUrl()
    expect(selector.fetchedModels.value.map((m: ModelOption) => m.value)).toEqual(['w1'])
  })

  it('name 与 id 都缺时用 String(m) 兜底', async () => {
    const { selector } = ready()
    mockState.httpFetch.mockResolvedValue({
      ok: true, status: 200, data: JSON.stringify([{}]),
    })

    await selector.fetchModelsFromBaseUrl()
    expect(selector.fetchedModels.value).toEqual([{ label: '[object Object]', value: '[object Object]' }])
  })

  it('空模型列表不覆盖已有结果', async () => {
    const { selector } = ready()
    selector.fetchedModels.value = [{ label: 'Keep', value: 'keep' }]
    mockState.httpFetch.mockResolvedValue({ ok: true, status: 200, data: JSON.stringify({ data: [] }) })

    await selector.fetchModelsFromBaseUrl()
    expect(selector.fetchedModels.value).toEqual([{ label: 'Keep', value: 'keep' }])
  })

  it('httpFetch 返回空（代理不可用）时报 HTTP proxy unavailable', async () => {
    const { selector } = ready()
    mockState.httpFetch.mockResolvedValue(undefined)

    await selector.fetchModelsFromBaseUrl()
    expect(selector.modelLoadError.value).toBe('HTTP proxy unavailable')
    expect(selector.isLoadingModels.value).toBe(false)
  })

  it('请求抛错时报错误消息；非 Error 报 Network error', async () => {
    const { selector } = ready()
    mockState.httpFetch.mockRejectedValueOnce(new Error('boom'))
    await selector.fetchModelsFromBaseUrl()
    expect(selector.modelLoadError.value).toBe('boom')

    mockState.httpFetch.mockRejectedValueOnce('raw-string')
    await selector.fetchModelsFromBaseUrl()
    expect(selector.modelLoadError.value).toBe('Network error')
  })

  it('响应不是合法 JSON 时落入 catch，isLoading 复位', async () => {
    const { selector } = ready()
    mockState.httpFetch.mockResolvedValue({ ok: true, status: 200, data: 'not-json{' })

    await selector.fetchModelsFromBaseUrl()
    expect(selector.modelLoadError.value).toBeTruthy()
    expect(selector.isLoadingModels.value).toBe(false)
  })

  it('拉取期间 isLoadingModels 为 true，结束后复位', async () => {
    const { selector } = ready()
    let release!: (v: unknown) => void
    mockState.httpFetch.mockReturnValue(new Promise((resolve) => { release = resolve }))

    const pending = selector.fetchModelsFromBaseUrl()
    expect(selector.isLoadingModels.value).toBe(true)
    release({ ok: false, status: 500, data: '' })
    await pending
    expect(selector.isLoadingModels.value).toBe(false)
  })
})

describe('下拉、子菜单与悬停定时器', () => {
  it('selectModel 更新选中值、收起全部菜单并通知调用方', () => {
    const emitted: string[] = []
    const settingsStore = useSettingsStore()
    settingsStore.authMethod = 'anthropic_compatible'
    const selector = useModelSelector({ onUpdateModel: (m) => emitted.push(m) })
    selector.toggleModelDropdown()

    selector.selectModel('my-model')

    expect(selector.selectedModel.value).toBe('my-model')
    expect(selector.showModelDropdown.value).toBe(false)
    expect(selector.showModelSubmenu.value).toBe(false)
    expect(emitted).toEqual(['my-model'])
  })

  it('toggleModelDropdown 开→关复位子菜单；toggleModelSubmenu 开→关', () => {
    const { selector } = selectorFor({ sonnetModel: 's' })
    selector.toggleModelDropdown()
    expect(selector.showModelDropdown.value).toBe(true)
    selector.toggleModelSubmenu()
    expect(selector.showModelSubmenu.value).toBe(true)

    selector.toggleModelDropdown()
    expect(selector.showModelDropdown.value).toBe(false)
    expect(selector.showModelSubmenu.value).toBe(false)
  })

  it('closeModelDropdown 同时收起子菜单', async () => {
    const { selector } = selectorFor({ sonnetModel: 's' })
    selector.toggleModelDropdown()
    selector.toggleModelSubmenu()

    selector.closeModelDropdown()
    await nextTick()

    expect(selector.showModelDropdown.value).toBe(false)
    expect(selector.showModelSubmenu.value).toBe(false)
  })

  it('离开当前模型行 120ms 后收起子菜单；期间移入子菜单可取消', () => {
    vi.useFakeTimers()
    try {
      const { selector } = selectorFor({ sonnetModel: 's' })
      selector.toggleModelSubmenu()
      expect(selector.showModelSubmenu.value).toBe(true)

      selector.onCurrentModelRowLeave()
      expect(selector.showModelSubmenu.value).toBe(true)
      vi.advanceTimersByTime(120)
      expect(selector.showModelSubmenu.value).toBe(false)

      // 再开一次，离开后立刻移入子菜单 → 取消定时
      selector.toggleModelSubmenu()
      selector.onCurrentModelRowLeave()
      selector.onModelSubmenuEnter()
      vi.advanceTimersByTime(300)
      expect(selector.showModelSubmenu.value).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('离开子菜单 120ms 后收起；closeModelSubmenu 立即收起', () => {
    vi.useFakeTimers()
    try {
      const { selector } = selectorFor({ sonnetModel: 's' })
      selector.toggleModelSubmenu()

      selector.onModelSubmenuLeave()
      expect(selector.showModelSubmenu.value).toBe(true)
      vi.advanceTimersByTime(120)
      expect(selector.showModelSubmenu.value).toBe(false)

      selector.toggleModelSubmenu()
      selector.closeModelSubmenu()
      expect(selector.showModelSubmenu.value).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('handleModelKeydown 键盘交互', () => {
  const slots = { haikuModel: 'm1', sonnetModel: 'm2', opusModel: 'm3' }

  function keyEvent(key: string, target: HTMLElement) {
    return { key, target, preventDefault: vi.fn() } as unknown as KeyboardEvent
  }

  it('未打开时在选择器上按 Enter / 空格打开下拉并阻止默认', () => {
    const { selector } = selectorFor(slots)
    const box = document.createElement('div')
    selector.modelSelectorRef.value = box

    const enter = keyEvent('Enter', box)
    selector.handleModelKeydown(enter)
    expect(selector.showModelDropdown.value).toBe(true)
    expect(enter.preventDefault).toHaveBeenCalled()

    selector.toggleModelDropdown()
    const space = keyEvent(' ', box)
    selector.handleModelKeydown(space)
    expect(selector.showModelDropdown.value).toBe(true)
  })

  it('未打开时在无关元素上按键不打开也不阻止默认', () => {
    const { selector } = selectorFor(slots)
    const ev = keyEvent('Enter', document.createElement('span'))

    selector.handleModelKeydown(ev)

    expect(selector.showModelDropdown.value).toBe(false)
    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('打开时 Escape 收起', () => {
    const { selector } = selectorFor(slots)
    selector.toggleModelDropdown()
    selector.toggleModelSubmenu()

    selector.handleModelKeydown(keyEvent('Escape', document.createElement('div')))

    expect(selector.showModelDropdown.value).toBe(false)
    expect(selector.showModelSubmenu.value).toBe(false)
  })

  it('打开时上下键移动高亮并阻止默认，越界回绕', () => {
    const { selector } = selectorFor(slots)
    selector.toggleModelDropdown()

    const down = keyEvent('ArrowDown', document.createElement('div'))
    selector.handleModelKeydown(down)
    expect(selector.highlightedModel.value).toBe('m1')
    expect(down.preventDefault).toHaveBeenCalled()

    selector.handleModelKeydown(keyEvent('ArrowUp', document.createElement('div')))
    expect(selector.highlightedModel.value).toBe('m3') // 从 m1 向上回绕到 m3

    selector.handleModelKeydown(keyEvent('ArrowUp', document.createElement('div')))
    expect(selector.highlightedModel.value).toBe('m2')
  })

  it('打开时 Enter 选中当前高亮；无高亮时不动', () => {
    const { selector } = selectorFor(slots)
    selector.toggleModelDropdown()

    // 无高亮
    selector.handleModelKeydown(keyEvent('Enter', document.createElement('div')))
    expect(selector.selectedModel.value).toBe('')

    selector.navigateModels(1) // 高亮 m1
    selector.handleModelKeydown(keyEvent('Enter', document.createElement('div')))

    expect(selector.selectedModel.value).toBe('m1')
    expect(selector.showModelDropdown.value).toBe(false)
  })
})

describe('watcher 与 initialize', () => {
  it('authMethod 变化时清空拉取结果并按新方式重新拉取', async () => {
    const { selector, settingsStore } = setupSelector({ sonnetModel: 's' })
    settingsStore.anthropicConfig = {
      ...settingsStore.anthropicConfig, baseUrl: 'https://api.anthropic.com', apiKey: 'sk-1',
    }
    selector.fetchedModels.value = [{ label: 'Stale', value: 'stale' }]

    settingsStore.authMethod = 'openai_compatible'
    settingsStore.openaiConfig = {
      ...settingsStore.openaiConfig, baseUrl: 'https://api.openai.com', apiKey: 'sk-2',
    }
    await nextTick()
    await nextTick()

    expect(selector.fetchedModels.value).toEqual([])
    expect(mockState.httpFetch).toHaveBeenCalledOnce()
    expect(mockState.httpFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
  })

  it('store 档位与界面一致时不重复回写', async () => {
    const { selector, settingsStore, emitted } = setupSelector({ sonnetModel: 'claude-sonnet-4-6' })
    selector.selectedModel.value = 'claude-sonnet-4-6'
    selector.selectMode('high')
    expect(emitted).toEqual(['high'])

    // store 改成界面已有的同一档 → watcher 早退，不再 emit
    settingsStore.effortLevel = 'high'
    await nextTick()
    expect(emitted).toEqual(['high'])
  })

  it('initialize 优先级：显式参数 > lastSelectedModel > config.model > 首个可用', () => {
    // 四个 case 共用同一 pinia store，前序 case 写入的值必须显式清掉
    // 1. 显式参数
    const a = setupSelector({ sonnetModel: 'cfg-sonnet' })
    a.settingsStore.lastSelectedModel = 'last'
    a.selector.initialize('explicit')
    expect(a.selector.selectedModel.value).toBe('explicit')

    // 2. lastSelectedModel
    const b = setupSelector({ sonnetModel: 'cfg-sonnet' })
    b.settingsStore.lastSelectedModel = 'last'
    b.selector.initialize()
    expect(b.selector.selectedModel.value).toBe('last')

    // 3. config.model（anthropic 下即 sonnet 槽位）
    const c = setupSelector({ sonnetModel: 'cfg-sonnet' })
    c.settingsStore.lastSelectedModel = ''
    c.selector.initialize()
    expect(c.selector.selectedModel.value).toBe('cfg-sonnet')

    // 4. 首个可用模型（清空 case c 遗留的槽位，否则 priority 3 先命中）
    const d = setupSelector({ sonnetModel: '' })
    d.settingsStore.lastSelectedModel = ''
    d.selector.fetchedModels.value = [{ label: 'First', value: 'first' }]
    d.selector.initialize()
    expect(d.selector.selectedModel.value).toBe('first')
  })
})
