// @vitest-environment jsdom
/**
 * 助手路由分区必须真的进得去 —— 组件写了但菜单/挂载漏一处，用户就永远看不到它。
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

describe('设置面板的助手路由分区', () => {
  it('菜单里有助手路由，导航过去能看到开关与模型来源', async () => {
    const wrapper = mount(SettingsPanel, {
      global: { plugins: [i18n], stubs: { GeneralSettings: true } },
    })

    const navItem = wrapper.findAll('.nav-item').find((node) => node.text() === zhCN.settings.assistantRouting.nav)
    expect(navItem).toBeDefined()

    window.dispatchEvent(new CustomEvent('settings-navigate', { detail: { tab: 'assistant-routing' } }))
    await vi.waitFor(() => expect(wrapper.find('#routing-enabled').exists()).toBe(true))

    expect(wrapper.find('#routing-model-source').exists()).toBe(true)
  })
})
