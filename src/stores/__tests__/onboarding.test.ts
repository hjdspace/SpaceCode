import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 首次引导的状态机与启动判定。
 *
 * 两块最容易出事的地方：
 * - 启动判定时机。gui-settings.json 是异步读的，读定前 hasCompletedOnboarding 还停在
 *   默认 false，此时判定会把引导弹给所有已配置好的老用户。
 * - 步骤"算不算完成"。1/2/3/5 是用户按过下一步（保持默认也算），第 4 项必须看真配置 ——
 *   没有 Key 按一百次下一步也干不了活。
 */
vi.mock('@/services/electronAPI', () => ({
  api: {
    loadGuiSettings: vi.fn(),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    profilesLoad: vi.fn().mockResolvedValue({ success: true, data: null }),
    profilesSave: vi.fn().mockResolvedValue({ success: true }),
    profilesBackupCorrupt: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/services/h5ApiClient', () => ({
  isH5Mode: vi.fn(() => false),
}))

import { api } from '@/services/electronAPI'
import { isH5Mode } from '@/services/h5ApiClient'
import { i18n } from '@/i18n'
import { useSettingsStore } from '../settings'
import { useOnboardingStore, STEP_COUNT } from '../onboarding'

const SETTINGS_KEY = 'claude_desktop_settings'

/** gui-settings.json 读定 + 启动判定 watch 跑完 */
const settled = () => new Promise(resolve => setTimeout(resolve, 0))

function createStores(persisted: Record<string, unknown> = {}) {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.mocked(api.loadGuiSettings).mockResolvedValue({
    success: true,
    data: JSON.stringify(persisted),
  })
  return { settings: useSettingsStore(), onboarding: useOnboardingStore() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isH5Mode).mockReturnValue(false)
  vi.mocked(api.saveGuiSettings).mockResolvedValue({ success: true })
  vi.mocked(api.loadGuiSettings).mockResolvedValue({ success: true, data: null })
})

describe('启动判定', () => {
  it('配置读定后仍缺首次标记 → 弹出引导卡', async () => {
    const { onboarding } = createStores()
    expect(onboarding.visible).toBe(false)

    await settled()

    expect(onboarding.visible).toBe(true)
    expect(onboarding.view).toBe('intro')
  })

  it('gui-settings.json 已带 hasCompletedOnboarding → 不打扰', async () => {
    const { settings, onboarding } = createStores({ hasCompletedOnboarding: true })

    await settled()

    expect(settings.hasCompletedOnboarding).toBe(true)
    expect(onboarding.visible).toBe(false)
    expect(onboarding.bannerVisible).toBe(false)
  })

  it('配置还没读定时不判定 —— 否则会误弹给老用户', () => {
    const { settings, onboarding } = createStores({ hasCompletedOnboarding: true })

    expect(settings.settingsReady).toBe(false)
    expect(onboarding.visible).toBe(false)
  })

  it('H5 镜像端不弹引导', async () => {
    vi.mocked(isH5Mode).mockReturnValue(true)
    const { onboarding } = createStores()

    await settled()

    expect(onboarding.visible).toBe(false)
  })
})

describe('语言同步', () => {
  it('gui-settings.json 读定后，语言同步到 i18n 与 <html lang>', async () => {
    createStores({ language: 'zh-CN' })

    await settled()

    expect(i18n.global.locale.value).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})

describe('步骤推进', () => {
  it('按过下一步即记下该配置项，包括保持默认值', async () => {
    const { onboarding } = createStores()
    await settled()
    onboarding.beginSteps()

    onboarding.advance()

    expect(onboarding.accepted[0]).toBe(true)
    expect(onboarding.stepDone[0]).toBe(true)
    expect(onboarding.step).toBe(1)
  })

  it('模型项看真配置而不是按没按过按钮', async () => {
    const { settings, onboarding } = createStores()
    await settled()

    expect(onboarding.modelReady).toBe(false)
    expect(onboarding.stepDone[3]).toBe(false)

    settings.anthropicConfig.apiKey = 'sk-test'

    expect(onboarding.modelReady).toBe(true)
    expect(onboarding.stepDone[3]).toBe(true)
  })

  it('进度只按 5 个配置项计，完成页不占位', async () => {
    const { onboarding } = createStores()
    await settled()
    onboarding.beginSteps()

    for (let i = 0; i < STEP_COUNT; i += 1) onboarding.advance()

    expect(onboarding.step).toBe(STEP_COUNT)
    expect(onboarding.doneCount).toBe(STEP_COUNT - 1)
    expect(onboarding.progressPercent).toBe(((STEP_COUNT - 1) / STEP_COUNT) * 100)
  })

  it('回到上一步不抹掉已完成记录', async () => {
    const { onboarding } = createStores()
    await settled()
    onboarding.beginSteps()
    onboarding.advance()
    onboarding.advance()

    onboarding.back()

    expect(onboarding.step).toBe(1)
    expect(onboarding.accepted[0]).toBe(true)
  })
})

describe('跳过与完成', () => {
  it('跳过 → 收卡并留下常驻提示条', async () => {
    const { onboarding } = createStores()
    await settled()
    onboarding.beginSteps()

    onboarding.skip()

    expect(onboarding.visible).toBe(false)
    expect(onboarding.skipped).toBe(true)
    expect(onboarding.bannerVisible).toBe(true)
  })

  it('提示条上的「继续配置」直接落到第一个未完成项', async () => {
    const { settings, onboarding } = createStores()
    await settled()
    onboarding.beginSteps()
    for (let i = 0; i < 3; i += 1) onboarding.advance()
    onboarding.skip()

    expect(onboarding.firstIncomplete).toBe(3)

    onboarding.start()
    if (onboarding.firstIncomplete >= 0) onboarding.jumpTo(onboarding.firstIncomplete)

    expect(onboarding.visible).toBe(true)
    expect(onboarding.step).toBe(3)
    // start() 回到 intro 再由 jumpTo 拉回 step；banner 让位给卡片
    expect(onboarding.bannerVisible).toBe(false)
    expect(settings.hasCompletedOnboarding).toBe(false)
  })

  it('完成 → 标记落盘，提示条不再出现', async () => {
    const { settings, onboarding } = createStores()
    await settled()
    onboarding.beginSteps()

    onboarding.complete()
    await settled()

    expect(settings.hasCompletedOnboarding).toBe(true)
    expect(onboarding.visible).toBe(false)
    expect(onboarding.bannerVisible).toBe(false)
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').hasCompletedOnboarding).toBe(true)
  })

  it('提示条上的「不再提示」等同于完成', async () => {
    const { settings, onboarding } = createStores()
    await settled()
    onboarding.skip()
    expect(onboarding.bannerVisible).toBe(true)

    onboarding.complete()
    await settled()

    expect(onboarding.bannerVisible).toBe(false)
    expect(settings.hasCompletedOnboarding).toBe(true)
  })

  it('设置页重走引导 → 卡片回来且不抹掉已完成记录', async () => {
    const { onboarding } = createStores({ hasCompletedOnboarding: true })
    await settled()
    onboarding.beginSteps()
    onboarding.advance()

    onboarding.start()

    expect(onboarding.visible).toBe(true)
    expect(onboarding.view).toBe('intro')
    expect(onboarding.accepted[0]).toBe(true)
  })
})
