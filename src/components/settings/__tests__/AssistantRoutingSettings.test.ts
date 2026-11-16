// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

const apiMocks = vi.hoisted(() => ({
  loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
  saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
  profilesLoad: vi.fn().mockResolvedValue({ success: true, data: null }),
  profilesSave: vi.fn().mockResolvedValue({ success: true }),
  profilesBackupCorrupt: vi.fn().mockResolvedValue({ success: true }),
  getEnv: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))

import AssistantRoutingSettings from '@/components/settings/AssistantRoutingSettings.vue'
import { useSettingsStore } from '@/stores/settings'

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'en-US': enUS, 'zh-CN': zhCN } })
const zh = zhCN.settings.assistantRouting

function mountPanel() {
  return mount(AssistantRoutingSettings, { global: { plugins: [i18n] } })
}

function savedRouterConfig() {
  const calls = apiMocks.saveGuiSettings.mock.calls
  return JSON.parse(calls[calls.length - 1][0] as string).routerConfig
}

function inputValue(wrapper: ReturnType<typeof mountPanel>, selector: string): string {
  return (wrapper.find(selector).element as HTMLInputElement | HTMLSelectElement).value
}

function withChatKey(haikuModel = '', sonnetModel = 'main-model') {
  const settings = useSettingsStore()
  settings.authMethod = 'anthropic_compatible'
  settings.anthropicConfig = {
    baseUrl: 'https://chat.test',
    apiKey: 'sk-chat',
    haikuModel,
    sonnetModel,
    opusModel: '',
  }
  return settings
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.loadGuiSettings.mockResolvedValue({ success: true, data: null })
  apiMocks.saveGuiSettings.mockResolvedValue({ success: true })
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('AssistantRoutingSettings', () => {
  it('默认开启并跟随快速模型', () => {
    const wrapper = mountPanel()
    expect((wrapper.find('[data-test="routing-enabled"]').element as HTMLInputElement).checked).toBe(true)
    expect(inputValue(wrapper, '#routing-model-source')).toBe('follow-fast')
    expect(wrapper.find('[data-test="fast-summary"]').exists()).toBe(true)
    expect(wrapper.find('#routing-api-key').exists()).toBe(false)
  })

  it('follow-fast 展示当前生效的 haiku 槽位', async () => {
    withChatKey('claude-haiku-4-5')
    const wrapper = mountPanel()
    await nextTick()

    expect(wrapper.find('[data-test="fast-model"]').text()).toBe('claude-haiku-4-5')
    expect(wrapper.text()).toContain(zh.followFastHint)
  })

  it('haiku 未配置时回退主模型', async () => {
    withChatKey('', 'claude-sonnet-4-5')
    const wrapper = mountPanel()
    await nextTick()

    expect(wrapper.find('[data-test="fast-model"]').text()).toBe('claude-sonnet-4-5')
  })

  it('OAuth 无 key 时明确告知路由不可用', async () => {
    const settings = useSettingsStore()
    settings.authMethod = 'claudeai'
    const wrapper = mountPanel()
    await nextTick()

    expect(wrapper.find('[data-test="fast-model"]').exists()).toBe(false)
    expect(wrapper.text()).toContain(zh.followFastUnavailable)
  })

  it('关闭开关立即落盘，重新开启后恢复', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-test="routing-enabled"]').setValue(false)

    await vi.waitFor(() => expect(apiMocks.saveGuiSettings).toHaveBeenCalled())
    expect(savedRouterConfig()).toEqual({ enabled: false, modelSource: 'follow-fast' })
    expect(useSettingsStore().routerConfig.enabled).toBe(false)
    expect(wrapper.text()).toContain(zh.disabledHint)

    await wrapper.find('[data-test="routing-enabled"]').setValue(true)
    await vi.waitFor(() => expect(savedRouterConfig().enabled).toBe(true))
    expect(useSettingsStore().routerConfig.enabled).toBe(true)
    expect(wrapper.text()).toContain(zh.enabledHint)
  })

  it('切到自定义只展开表单，不提前把 modelSource 落盘', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#routing-model-source').setValue('custom')
    await nextTick()

    expect(wrapper.find('#routing-provider').exists()).toBe(true)
    expect(wrapper.find('#routing-base-url').exists()).toBe(true)
    expect(wrapper.find('#routing-api-key').exists()).toBe(true)
    expect(wrapper.find('#routing-model').exists()).toBe(true)
    expect(useSettingsStore().routerConfig.modelSource).toBe('follow-fast')
    expect(apiMocks.saveGuiSettings).not.toHaveBeenCalled()
  })

  it('切回 follow-fast 立即落盘', async () => {
    const settings = useSettingsStore()
    settings.routerConfig = {
      enabled: true,
      modelSource: 'custom',
      provider: 'openai',
      apiKey: 'sk-router',
      model: 'cheap-router',
    }
    const wrapper = mountPanel()
    await nextTick()
    expect(inputValue(wrapper, '#routing-model-source')).toBe('custom')

    await wrapper.find('#routing-model-source').setValue('follow-fast')

    await vi.waitFor(() => expect(savedRouterConfig().modelSource).toBe('follow-fast'))
    expect(savedRouterConfig()).toMatchObject({ provider: 'openai', apiKey: 'sk-router', model: 'cheap-router' })
  })

  it('保存 custom 连接：provider/baseUrl/key/model 全部持久化', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#routing-model-source').setValue('custom')
    await wrapper.find('#routing-provider').setValue('openai')
    await wrapper.find('#routing-base-url').setValue('https://router.test/v1/')
    await wrapper.find('#routing-api-key').setValue('sk-router')
    await wrapper.find('#routing-model').setValue('cheap-router')
    await wrapper.find('[data-test="save"]').trigger('click')

    await vi.waitFor(() => expect(wrapper.find('[data-test="save-status"]').exists()).toBe(true))
    expect(savedRouterConfig()).toEqual({
      enabled: true,
      modelSource: 'custom',
      provider: 'openai',
      baseUrl: 'https://router.test/v1',
      apiKey: 'sk-router',
      model: 'cheap-router',
    })
    expect(useSettingsStore().routerConfig).toEqual(savedRouterConfig())
    expect(wrapper.text()).toContain(zh.saved)
  })

  it('custom 缺 key 时仍可保存，但提示路由不可用', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#routing-model-source').setValue('custom')
    await wrapper.find('#routing-model').setValue('cheap-router')
    expect(wrapper.text()).toContain(zh.customUnavailableHint)
    await wrapper.find('[data-test="save"]').trigger('click')

    await vi.waitFor(() => expect(apiMocks.saveGuiSettings).toHaveBeenCalledTimes(1))
    expect(savedRouterConfig()).toEqual({ enabled: true, modelSource: 'custom', provider: 'anthropic', model: 'cheap-router' })
  })

  it('custom 填了 key 后不再显示不可用警告', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#routing-model-source').setValue('custom')
    await wrapper.find('#routing-api-key').setValue('sk-router')
    await nextTick()

    expect(wrapper.text()).not.toContain(zh.customUnavailableHint)
  })

  it('Base URL 非法时阻止保存', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#routing-model-source').setValue('custom')
    await wrapper.find('#routing-base-url').setValue('not-a-url')
    await wrapper.find('[data-test="save"]').trigger('click')

    expect(apiMocks.saveGuiSettings).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain(zh.invalidBaseUrl)
  })

  it('配置晚到且用户没改表单时回灌 custom 表单', async () => {
    const wrapper = mountPanel()
    const settings = useSettingsStore()
    settings.routerConfig = {
      enabled: true,
      modelSource: 'custom',
      provider: 'openai',
      baseUrl: 'https://late.test/v1',
      apiKey: 'sk-late',
      model: 'late-model',
    }
    await nextTick()

    expect(inputValue(wrapper, '#routing-model-source')).toBe('custom')
    expect(inputValue(wrapper, '#routing-base-url')).toBe('https://late.test/v1')
    expect(inputValue(wrapper, '#routing-api-key')).toBe('sk-late')
    expect(inputValue(wrapper, '#routing-model')).toBe('late-model')
  })

  it('用户正在改表单时，迟到的配置不覆盖他的输入', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#routing-model-source').setValue('custom')
    await wrapper.find('#routing-model').setValue('my-model')

    useSettingsStore().routerConfig = {
      enabled: true,
      modelSource: 'custom',
      provider: 'openai',
      baseUrl: 'https://late.test/v1',
      apiKey: 'sk-late',
      model: 'late-model',
    }
    await nextTick()

    expect(inputValue(wrapper, '#routing-model')).toBe('my-model')
    expect(inputValue(wrapper, '#routing-base-url')).toBe('')
  })

  it('保存失败时不谎报已保存', async () => {
    apiMocks.saveGuiSettings.mockResolvedValue({ success: false, error: 'disk full' })
    const wrapper = mountPanel()
    await wrapper.find('#routing-model-source').setValue('custom')
    await wrapper.find('#routing-api-key').setValue('sk-router')
    await wrapper.find('[data-test="save"]').trigger('click')

    await vi.waitFor(() => expect(wrapper.text()).toContain(zh.saveFailed))
    expect(wrapper.text()).not.toContain(zh.saved)
  })
})
