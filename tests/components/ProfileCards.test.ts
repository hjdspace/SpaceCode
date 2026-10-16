import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import ProfileCards from '@/components/settings/ProfileCards.vue'
import { errorHandler } from '@/services/errorHandler'
import { useSettingsStore } from '@/stores/settings'
import type { ModelProfile } from '@/types/profile'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'

// Mock ModelSettings 组件，避免渲染复杂表单
vi.mock('@/components/settings/ModelSettings.vue', () => ({
  default: {
    name: 'ModelSettings',
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template: '<div data-testid="model-settings-mock">{{ modelValue.authMethod }}</div>',
  },
}))

// Mock electronAPI
vi.mock('@/services/electronAPI', () => ({
  api: {
    saveGuiSettings: vi.fn(() => Promise.resolve({ success: true })),
    loadGuiSettings: vi.fn(() => Promise.resolve({ success: true, data: null })),
    profilesLoad: vi.fn(() => Promise.resolve({ success: true, data: null })),
    profilesSave: vi.fn(() => Promise.resolve({ success: true })),
    getEnv: vi.fn(() => Promise.resolve(undefined)),
  },
}))

// 提供独立的 i18n 实例，避免 useI18n() 报 "Need to install with app.use"
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN },
  globalInjection: true,
})

const mountOptions = {
  global: {
    plugins: [i18n],
    stubs: { ModelSettings: true },
  },
}

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'p1',
    name: '工作',
    authMethod: 'openai_compatible',
    anthropicConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    openaiConfig: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-secret123', haikuModel: '', sonnetModel: 'deepseek-chat', opusModel: '' },
    geminiConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    modelContextWindows: { 'deepseek-chat': 64000 },
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('ProfileCards', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('缩略卡渲染名称、provider 标签、模型摘要、上下文窗口', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile()]
    store.activeProfileId = 'p1'
    store.expandedProfileId = null

    const wrapper = mount(ProfileCards, mountOptions)

    await wrapper.vm.$nextTick()
    const chip = wrapper.find('[data-testid="profile-chip-p1"]')
    expect(chip.text()).toContain('工作')
    expect(chip.text()).toContain('deepseek-chat')
  })

  it('缩略态不显示 apiKey', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile()]
    store.activeProfileId = 'p1'
    store.expandedProfileId = null

    const wrapper = mount(ProfileCards, mountOptions)

    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('sk-secret123')
  })

  it('进入页面默认显示 active 配置编辑区，点击卡片保持选中', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile()]
    store.activeProfileId = 'p1'
    store.expandedProfileId = null

    const wrapper = mount(ProfileCards, mountOptions)

    await wrapper.vm.$nextTick()
    const chip = wrapper.find('[data-testid="profile-chip-p1"]')
    await chip.trigger('click')
    expect(store.expandedProfileId).toBe('p1')
    expect(wrapper.find('.profile-editor').exists()).toBe(true)
  })

  it('激活标记显示在当前 active 的卡上', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' }), makeProfile({ id: 'p2', name: '个人' })]
    store.activeProfileId = 'p2'
    store.expandedProfileId = null

    const wrapper = mount(ProfileCards, mountOptions)

    await wrapper.vm.$nextTick()
    const chip1 = wrapper.find('[data-testid="profile-chip-p1"]')
    const chip2 = wrapper.find('[data-testid="profile-chip-p2"]')
    expect(chip2.classes()).toContain('active')
    expect(chip1.classes()).not.toContain('active')
  })

  it('点击非 active 卡片立即调用 store.applyProfile', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' }), makeProfile({ id: 'p2', name: '个人' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = 'p2'
    const spy = vi.spyOn(store, 'applyProfile').mockResolvedValue(undefined)

    const wrapper = mount(ProfileCards, mountOptions)

    await wrapper.vm.$nextTick()
    const chip = wrapper.find('[data-testid="profile-chip-p2"]')
    await chip.trigger('click')
    expect(spy).toHaveBeenCalledWith('p2')
    expect(store.expandedProfileId).toBe('p2')
  })

  it('切换成功后才提示"已切换到"', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' }), makeProfile({ id: 'p2', name: '个人' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = 'p1'
    const pushToast = vi.spyOn(errorHandler, 'pushToast').mockImplementation(() => {})
    vi.spyOn(store, 'applyProfile').mockResolvedValue(undefined)

    const wrapper = mount(ProfileCards, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="profile-chip-p2"]').trigger('click')
    await new Promise(resolve => { setTimeout(resolve, 0) })

    expect(pushToast.mock.calls.map(call => call[0].message).join('\n')).toContain('已切换到「个人」')
  })

  // issue #42 第 8 项：主进程还没生效（这里代理没起来）就不能显示"切换成功"。
  it('主进程没生效时提示失败原因，不弹成功提示，选中也退回原配置', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' }), makeProfile({ id: 'p2', name: '个人' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = 'p1'
    const pushToast = vi.spyOn(errorHandler, 'pushToast').mockImplementation(() => {})
    vi.spyOn(store, 'applyProfile').mockRejectedValue(Object.assign(
      new Error('applyProfile("p2") failed: EADDRINUSE 34567'),
      { profileApplyFailure: 'proxy_not_aligned' },
    ))

    const wrapper = mount(ProfileCards, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="profile-chip-p2"]').trigger('click')
    await new Promise(resolve => { setTimeout(resolve, 0) })

    const messages = pushToast.mock.calls.map(call => call[0].message).join('\n')
    expect(messages).toContain('本地代理没能按新配置启动')
    expect(messages).not.toContain('已切换到')
    expect(store.expandedProfileId).toBe('p1')
  })

  it('只剩 1 个 Profile 时删除按钮禁用', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = 'p1'

    const wrapper = mount(ProfileCards, mountOptions)

    await wrapper.vm.$nextTick()
    const btn = wrapper.find('[data-testid="delete-btn"]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('点击名称进入就地编辑模式', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = 'p1'

    const wrapper = mount(ProfileCards, mountOptions)

    await wrapper.vm.$nextTick()
    const name = wrapper.find('[data-testid="profile-name-p1"]')
    await name.trigger('click')
    expect(wrapper.find('[data-testid="profile-name-input"]').exists()).toBe(true)
  })

  it('"新建配置"按钮调用 store.createProfile', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = null
    const spy = vi.spyOn(store, 'createProfile').mockResolvedValue('new-id')

    const wrapper = mount(ProfileCards, mountOptions)

    await wrapper.vm.$nextTick()
    const btn = wrapper.find('[data-testid="add-new-btn"]')
    await btn.trigger('click')
    expect(spy).toHaveBeenCalled()
  })
})
