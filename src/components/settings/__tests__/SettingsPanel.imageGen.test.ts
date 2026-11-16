// @vitest-environment jsdom
/**
 * 生图分区在设置面板里真的进得去 —— 组件写了但菜单/挂载漏一处，用户就永远看不到它。
 * 走既有的 settings-navigate 入口，它同时校验 tab id 是否在菜单名单里。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

vi.mock('@/services/electronAPI', () => ({
  api: {
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    profilesLoad: vi.fn().mockResolvedValue({ success: true, data: null }),
    profilesSave: vi.fn().mockResolvedValue({ success: true }),
    profilesBackupCorrupt: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    onCliUpdateState: vi.fn(() => () => {}),
    getCliUpdateState: vi.fn().mockResolvedValue(null),
  },
}))

import SettingsPanel from '@/components/settings/SettingsPanel.vue'

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'en-US': enUS, 'zh-CN': zhCN } })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('设置面板的生图分区', () => {
  it('菜单里有生图模型，导航过去能看到供应商表单', async () => {
    const wrapper = mount(SettingsPanel, {
      global: { plugins: [i18n], stubs: { GeneralSettings: true } },
    })

    const navItem = wrapper.findAll('.nav-item').find((node) => node.text() === zhCN.settings.imageGen)
    expect(navItem).toBeDefined()

    window.dispatchEvent(new CustomEvent('settings-navigate', { detail: { tab: 'image-gen' } }))
    await vi.waitFor(() => expect(wrapper.find('#imagegen-preset').exists()).toBe(true))

    expect(wrapper.find('#imagegen-model').exists()).toBe(true)
  })
})