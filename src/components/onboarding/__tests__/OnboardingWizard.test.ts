import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import OnboardingWizard from '../OnboardingWizard.vue'
import SearchableSelect from '@/components/settings/SearchableSelect.vue'
import { useOnboardingStore } from '@/stores/onboarding'
import { useSettingsStore } from '@/stores/settings'
import { i18n } from '@/i18n'
import { api } from '@/services/electronAPI'
import { isH5Mode } from '@/services/h5ApiClient'

vi.mock('@/services/electronAPI', () => ({
  api: {
    loadGuiSettings: vi.fn(),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    profilesLoad: vi.fn().mockResolvedValue({ success: true, data: null }),
    profilesSave: vi.fn().mockResolvedValue({ success: true }),
    profilesBackupCorrupt: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
    httpFetch: vi.fn(),
    ensureDefaultWorkspace: vi.fn().mockResolvedValue('D:/Documents/SpaceCode'),
    ensureDir: vi.fn().mockResolvedValue(true),
  },
}))

vi.mock('@/services/h5ApiClient', () => ({
  isH5Mode: vi.fn(() => false),
}))

const SETTINGS_KEY = 'claude_desktop_settings'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

async function mountWizard() {
  localStorage.clear()
  // 组件挂全局 i18n 实例：语言切换由 settings store 的 watcher 同步到它，
  // 用测试自己造的新实例会绕过这条真实路径。
  i18n.global.locale.value = 'zh-CN'
  const pinia: Pinia = createPinia()
  setActivePinia(pinia)
  // 已完成首启动标记：这些用例考的是卡片内部行为，不是自动弹出。
  // language 也要钉住 —— jsdom 的 navigator.language 是 en-US，
  // 不写死的话 store 初始就认为用户选过英文，点中文/英文卡片会被"同值早退"吃掉。
  vi.mocked(api.loadGuiSettings).mockResolvedValue({
    success: true,
    data: JSON.stringify({ hasCompletedOnboarding: true, language: 'zh-CN' }),
  })
  const settings = useSettingsStore()
  const onboarding = useOnboardingStore()
  await tick()
  onboarding.start()

  const wrapper = mount(OnboardingWizard, { global: { plugins: [pinia, i18n] } })
  await nextTick()
  return { wrapper, settings, onboarding, i18n, pinia }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isH5Mode).mockReturnValue(false)
  vi.mocked(api.saveGuiSettings).mockResolvedValue({ success: true })
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  document.documentElement.style.removeProperty('--accent-primary')
})

describe('引导卡', () => {
  it('先落在欢迎页，列出这次要定的五项', async () => {
    const { wrapper } = await mountWizard()

    expect(wrapper.text()).toContain('欢迎使用 SpaceCode')
    const prep = wrapper.findAll('.ob-prep-item').map(el => el.text())
    expect(prep).toEqual(['语言', '外观', '引擎', '模型', '工作区'])
  })

  it('开始设置后出现步骤栏，进度按已完成项走', async () => {
    const { wrapper, onboarding } = await mountWizard()
    await wrapper.find('.ob-btn--primary').trigger('click')

    expect(wrapper.findAll('.ob-overlay .step')).toHaveLength(5)
    expect(onboarding.doneCount).toBe(0)

    await wrapper.find('.ob-btn--primary').trigger('click')

    expect(onboarding.doneCount).toBe(1)
    await nextTick()
    expect(wrapper.find('.bar i').attributes('style')).toContain('width: 20%')
  })

  it('Enter 进下一步，Esc 跳过并留下提示条', async () => {
    const { wrapper, onboarding } = await mountWizard()
    onboarding.beginSteps()
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await nextTick()
    expect(onboarding.step).toBe(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(onboarding.visible).toBe(false)
    expect(onboarding.skipped).toBe(true)

    wrapper.unmount()
  })

  it('步骤栏点哪一步就跳到哪一步', async () => {
    const { wrapper, onboarding } = await mountWizard()
    onboarding.beginSteps()
    await nextTick()

    await wrapper.findAll('.ob-overlay .step')[3].trigger('click')

    expect(onboarding.step).toBe(3)
    expect(wrapper.find('.ob-head h1').text()).toBe('接一个大模型')
  })

  it('欢迎页就能切语言，不必先点开始设置', async () => {
    const { wrapper, settings, i18n } = await mountWizard()

    const toggles = wrapper.findAll('.ob-intro-lang button')
    expect(toggles.map(el => el.text())).toEqual(['中文', 'EN'])

    await toggles[1].trigger('click')
    await tick()

    expect(settings.language).toBe('en-US')
    expect(i18n.global.locale.value).toBe('en-US')
    expect(wrapper.text()).toContain('Welcome to SpaceCode')
    expect(wrapper.find('.ob-intro-lang .is-active').text()).toBe('EN')
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').language).toBe('en-US')
  })

  it('切语言即时改文案并落盘，不需要重启', async () => {
    const { wrapper, settings, i18n } = await mountWizard()
    await wrapper.find('.ob-btn--primary').trigger('click')
    const english = wrapper.findAll('.ob-opt')[1]
    await english.trigger('click')
    await tick()

    expect(settings.language).toBe('en-US')
    expect(i18n.global.locale.value).toBe('en-US')
    expect(wrapper.find('.ob-head h1').text()).toBe('Which language?')
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').language).toBe('en-US')
  })
})

describe('外观步骤', () => {
  it('选主题与密度立刻打到 documentElement，卡片背后跟着变', async () => {
    const { wrapper, settings } = await mountWizard()
    await wrapper.find('.ob-btn--primary').trigger('click')
    await wrapper.find('.ob-btn--primary').trigger('click')
    await nextTick()

    const dark = wrapper.findAll('.ob-theme')[2]
    expect(dark.text()).toContain('深色')
    await dark.trigger('click')

    expect(settings.appearance.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    const comfortable = wrapper.findAll('.ob-seg')[0].findAll('button')[2]
    await comfortable.trigger('click')
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable')

    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').appearance.density).toBe('comfortable')
  })
})

describe('模型步骤', () => {
  it('填了 Key 即视为已配置，进度补上模型这一项', async () => {
    const { wrapper, onboarding, settings } = await mountWizard()
    await wrapper.find('.ob-btn--primary').trigger('click')
    for (let i = 0; i < 3; i += 1) {
      await wrapper.find('.ob-btn--primary').trigger('click')
    }
    await nextTick()

    expect(onboarding.stepDone[3]).toBe(false)

    const keyInput = wrapper.findAll('.ob-input.is-mono')[1]
    await keyInput.setValue('sk-ant-abc')
    await tick()

    expect(settings.anthropicConfig.apiKey).toBe('sk-ant-abc')
    expect(onboarding.modelReady).toBe(true)
    expect(onboarding.stepDone[3]).toBe(true)
  })

  it('未接通的两条 OAuth 接入方式置灰不可选', async () => {
    const { wrapper, onboarding } = await mountWizard()
    onboarding.beginSteps()
    onboarding.jumpTo(3)
    await nextTick()

    const chips = wrapper.findAll('.ob-chip')
    expect(chips.filter(c => c.attributes('disabled') !== undefined)).toHaveLength(2)
    expect(wrapper.find('.ob-hint--warn').text()).toContain('还没接通')
  })

  it('三个档位复用设置页的可搜索下拉，选中即写入对应槽位', async () => {
    const { wrapper, settings } = await mountWizard()
    await wrapper.find('.ob-btn--primary').trigger('click')
    for (let i = 0; i < 3; i += 1) {
      await wrapper.find('.ob-btn--primary').trigger('click')
    }
    await tick()

    expect(wrapper.findAll('.ob-slot .searchable-select')).toHaveLength(3)

    const balanced = wrapper.findAllComponents(SearchableSelect)[0]
    balanced.vm.$emit('update:modelValue', 'claude-sonnet-4-5')
    await tick()

    expect(settings.anthropicConfig.sonnetModel).toBe('claude-sonnet-4-5')
  })

  it('端点拉不通时下拉仍有兜底候选，不至于空着选不了', async () => {
    const { wrapper } = await mountWizard()
    await wrapper.find('.ob-btn--primary').trigger('click')
    for (let i = 0; i < 3; i += 1) {
      await wrapper.find('.ob-btn--primary').trigger('click')
    }
    await tick()

    const options = wrapper.findAllComponents(SearchableSelect)[0].props('options')
    expect(options.length).toBeGreaterThan(0)
    expect(options.some(o => o.id === 'claude-3-5-sonnet-20241022')).toBe(true)
  })
})
