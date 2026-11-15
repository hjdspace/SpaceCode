// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'
import type { ImageGenConfig } from '@/shared/imageGenReference'

const apiMocks = vi.hoisted(() => ({
  loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
  saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
  profilesLoad: vi.fn().mockResolvedValue({ success: true, data: null }),
  profilesSave: vi.fn().mockResolvedValue({ success: true }),
  profilesBackupCorrupt: vi.fn().mockResolvedValue({ success: true }),
  getEnv: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))

import ImageGenSettings from '@/components/settings/ImageGenSettings.vue'
import { useSettingsStore } from '@/stores/settings'

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'en-US': enUS, 'zh-CN': zhCN } })

const ARK_CONFIG: ImageGenConfig = {
  presetId: 'ark',
  dialect: 'seedream',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: '',
  model: 'doubao-seedream-4-0-250828',
  disableWatermark: false,
  hasApiKey: true,
}

function mountPanel() {
  return mount(ImageGenSettings, { global: { plugins: [i18n] } })
}

function value(wrapper: ReturnType<typeof mountPanel>, selector: string): string {
  return (wrapper.find(selector).element as HTMLInputElement | HTMLSelectElement).value
}

function savedConfig(): ImageGenConfig {
  return JSON.parse(apiMocks.saveGuiSettings.mock.calls[0][0] as string).imageGenConfig
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.loadGuiSettings.mockResolvedValue({ success: true, data: null })
  apiMocks.saveGuiSettings.mockResolvedValue({ success: true })
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('ImageGenSettings', () => {
  it('默认展示 OpenAI 预置，Key 输入框是密码态', () => {
    const wrapper = mountPanel()
    expect(value(wrapper, '#imagegen-base-url')).toBe('https://api.openai.com/v1')
    expect(value(wrapper, '#imagegen-model')).toBe('gpt-image-1')
    expect((wrapper.find('#imagegen-api-key').element as HTMLInputElement).type).toBe('password')
    expect(wrapper.find('.s-masthead-eyebrow').text()).toBe(zhCN.settings.title)
  })

  it('挂载早于配置落地时，落地后回灌表单', async () => {
    let release!: (result: { success: boolean; data: string }) => void
    apiMocks.loadGuiSettings.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const wrapper = mountPanel()
    expect(value(wrapper, '#imagegen-model')).toBe('gpt-image-1')

    release({ success: true, data: JSON.stringify({ imageGenConfig: ARK_CONFIG }) })

    await vi.waitFor(() => expect(value(wrapper, '#imagegen-model')).toBe(ARK_CONFIG.model))
    expect(value(wrapper, '#imagegen-base-url')).toBe(ARK_CONFIG.baseUrl)
    expect(value(wrapper, '#imagegen-preset')).toBe('ark')
    expect(wrapper.find('#imagegen-api-key').attributes('placeholder')).toBe(zhCN.imageGen.apiKeyConfiguredPlaceholder)
  })

  it('用户已经改过表单时，迟到的配置不覆盖他的输入', async () => {
    let release!: (result: { success: boolean; data: string }) => void
    apiMocks.loadGuiSettings.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const wrapper = mountPanel()
    await wrapper.find('#imagegen-model').setValue('my-own-model')

    release({ success: true, data: JSON.stringify({ imageGenConfig: ARK_CONFIG }) })

    await vi.waitFor(() => expect(useSettingsStore().imageGenConfig).toEqual(ARK_CONFIG))
    expect(value(wrapper, '#imagegen-model')).toBe('my-own-model')
  })

  it('切换预置会换掉地址、模型与方言，且方言下拉被锁住', async () => {
    const wrapper = mountPanel()
    expect((wrapper.find('#imagegen-dialect').element as HTMLSelectElement).disabled).toBe(true)

    await wrapper.find('#imagegen-preset').setValue('zhipu')

    expect(value(wrapper, '#imagegen-base-url')).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(value(wrapper, '#imagegen-model')).toBe('cogview-4')
    expect(value(wrapper, '#imagegen-dialect')).toBe('zhipu')
  })

  it('火山方舟预置落到 seedream 方言，不是 openai', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#imagegen-preset').setValue('ark')
    expect(value(wrapper, '#imagegen-dialect')).toBe('seedream')
  })

  it('自定义供应商时方言可选', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#imagegen-preset').setValue('custom')
    expect((wrapper.find('#imagegen-dialect').element as HTMLSelectElement).disabled).toBe(false)
  })

  it('选过预置后模型名仍可编辑', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#imagegen-preset').setValue('zhipu')
    const model = wrapper.find('#imagegen-model')
    expect((model.element as HTMLInputElement).readOnly).toBe(false)
    expect((model.element as HTMLInputElement).disabled).toBe(false)

    await model.setValue('cogview-4-flash')
    expect(value(wrapper, '#imagegen-model')).toBe('cogview-4-flash')
  })

  it('去水印开关默认关闭 —— 智谱未签免责声明时开启会直接报错', () => {
    const wrapper = mountPanel()
    expect((wrapper.find('#imagegen-watermark').element as HTMLInputElement).checked).toBe(false)
  })

  it('显示切换把密码态改成明文再改回来', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-test="toggle-key"]').trigger('click')
    expect((wrapper.find('#imagegen-api-key').element as HTMLInputElement).type).toBe('text')
    await wrapper.find('[data-test="toggle-key"]').trigger('click')
    expect((wrapper.find('#imagegen-api-key').element as HTMLInputElement).type).toBe('password')
  })

  it('缺 Key 时不保存，给出可读校验提示', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-test="save"]').trigger('click')
    expect(apiMocks.saveGuiSettings).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('API Key')
  })

  it('填好 Key 后保存，落盘的配置带正确方言', async () => {
    const wrapper = mountPanel()
    await wrapper.find('#imagegen-preset').setValue('ark')
    await wrapper.find('#imagegen-api-key').setValue('ark-key')
    await wrapper.find('[data-test="save"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('已保存'))

    expect(savedConfig()).toEqual({
      presetId: 'ark',
      dialect: 'seedream',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'ark-key',
      model: 'doubao-seedream-4-0-250828',
      disableWatermark: false,
      hasApiKey: true,
    })
    expect(wrapper.text()).toContain('已保存')
  })

  it('保存失败时显示失败，不谎报已保存', async () => {
    apiMocks.saveGuiSettings.mockResolvedValueOnce({ success: false, error: 'disk full' })
    const wrapper = mountPanel()
    await wrapper.find('#imagegen-api-key').setValue('k')
    await wrapper.find('[data-test="save"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('保存失败'))
  })

  it('已配置时不预填明文 Key，留空也能保存改动的模型名', async () => {
    apiMocks.loadGuiSettings.mockResolvedValue({ success: true, data: JSON.stringify({ imageGenConfig: ARK_CONFIG }) })
    const settings = useSettingsStore()
    await vi.waitFor(() => expect(settings.imageGenConfig).toEqual(ARK_CONFIG))

    const wrapper = mountPanel()
    expect(value(wrapper, '#imagegen-api-key')).toBe('')
    expect(wrapper.find('#imagegen-api-key').attributes('placeholder')).toBe(zhCN.imageGen.apiKeyConfiguredPlaceholder)

    await wrapper.find('#imagegen-model').setValue('doubao-seedream-4-5')
    await wrapper.find('[data-test="save"]').trigger('click')
    await vi.waitFor(() => expect(apiMocks.saveGuiSettings).toHaveBeenCalled())

    expect(savedConfig()).toEqual({ ...ARK_CONFIG, model: 'doubao-seedream-4-5' })
  })
})