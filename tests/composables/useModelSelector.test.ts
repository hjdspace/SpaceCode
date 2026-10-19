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
 * `engineSource` 缺 'bundled'，跟真 store 的默认一致 —— 档位有两维（模型能力 + 引擎词汇），
 * 不写出来的用例就等于默认在测内部引擎那一套。
 */
function setupSelector(slots: SlotConfig = {}, emitted: string[] = [], engineSource: 'bundled' | 'installed' = 'bundled') {
  const settingsStore = useSettingsStore()
  settingsStore.authMethod = 'anthropic_compatible'
  settingsStore.engineSource = engineSource
  settingsStore.anthropicConfig = { ...settingsStore.anthropicConfig, apiKey: '', baseUrl: '', ...slots }
  const selector = useModelSelector({ onUpdateEffort: (e) => emitted.push(e) })
  return { selector, settingsStore, emitted }
}

function selectorFor(slots: SlotConfig = {}, engineSource: 'bundled' | 'installed' = 'bundled') {
  return setupSelector(slots, [], engineSource)
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

describe('搜索过滤', () => {
  const configured = {
    haikuModel: 'claude-3-5-haiku-20241022',
    sonnetModel: 'claude-3-5-sonnet-20241022',
    opusModel: 'claude-3-opus-20240229',
  }

  it('空查询保留全部', () => {
    const { selector } = selectorFor(configured)
    expect(selector.filteredModels.value).toHaveLength(3)
  })

  it('按 label/value 命中（列表以模型名为 label）', () => {
    const { selector } = selectorFor(configured)
    selector.modelSearchQuery.value = 'haiku'
    expect(selector.filteredModels.value.map((m) => m.value)).toEqual(['claude-3-5-haiku-20241022'])
  })

  it('大小写不敏感', () => {
    const { selector } = selectorFor({ sonnetModel: 'GPT-4', opusModel: 'gpt-4-turbo' })
    selector.modelSearchQuery.value = 'gpt-4'
    expect(selector.filteredModels.value).toHaveLength(2)
  })

  it('无命中返回空', () => {
    const { selector } = selectorFor(configured)
    selector.modelSearchQuery.value = 'nonexistent'
    expect(selector.filteredModels.value).toHaveLength(0)
  })

  it('关闭下拉会清空查询词', async () => {
    const { selector } = selectorFor(configured)
    selector.toggleModelDropdown()
    selector.modelSearchQuery.value = 'haiku'
    expect(selector.filteredModels.value).toHaveLength(1)

    selector.closeModelDropdown()
    await nextTick()
    expect(selector.modelSearchQuery.value).toBe('')
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
