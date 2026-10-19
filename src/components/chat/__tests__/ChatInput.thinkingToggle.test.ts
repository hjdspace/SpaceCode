// @vitest-environment jsdom
/**
 * ChatInput 思考开关的失败面（issue #49）。
 *
 * 一次失败曾经被三层各吞一次：IPC handler 把 reject 抹平成 resolve、`.catch(() => {})` 吃掉它、
 * `saveSettings()` 的返回值整个丢掉。结果是开关停在用户刚点的新状态、localStorage 也写进去了，
 * 而引擎进程没接到、主进程配置可能也没落地 —— 界面没有任何一处显示「没生效」。
 *
 * 这里钉的是用户可见的那两句：失败就把开关退回点击前的状态，并把原因显示出来；
 * 「本轮跑完才生效」以引擎的答复为准，不再由界面自己猜会话忙不忙。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent } from 'vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { api } from '@/services/electronAPI'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn(),
  llmState: { provider: '', isConfigured: false },
}))

const Stub = defineComponent({ render: () => '' })

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS } })
const SESSION = 'session-1'

function mountInput() {
  return mount(ChatInput, {
    props: { sessionId: SESSION },
    global: {
      plugins: [i18n],
      stubs: { Teleport: true, ChatContextToolbar: Stub, ComposerStatusBar: Stub },
    },
    attachTo: document.body,
  })
}

/** 开关当前的视觉状态：按钮上的 active class 就是用户看到的「已开 / 已关」 */
function isActive(wrapper: ReturnType<typeof mountInput>): boolean {
  return wrapper.find('.thinking-btn').classes().includes('active')
}

function hintText(wrapper: ReturnType<typeof mountInput>): string {
  const hint = wrapper.find('.steer-hint')
  return hint.exists() ? hint.text() : ''
}

/** 最近一次落到主进程的 thinkingEnabled —— 回滚到底有没有再落一次盘 */
function lastSavedThinking(): unknown {
  const calls = vi.mocked(api.saveGuiSettings).mock.calls
  const [payload] = calls[calls.length - 1]
  return JSON.parse(payload as string).thinkingEnabled
}

let settingsStore: ReturnType<typeof useSettingsStore>
let wrapper: ReturnType<typeof mountInput>

beforeEach(async () => {
  localStorage.clear()
  setActivePinia(createPinia())
  useAppStore().projectRoot = '/proj'
  settingsStore = useSettingsStore()
  settingsStore.thinkingEnabled = false
  vi.spyOn(api, 'saveGuiSettings').mockResolvedValue({ success: true })
  vi.spyOn(api, 'updateThinkingLevel').mockResolvedValue('now')
  wrapper = mountInput()
  await flushPromises()
  vi.mocked(api.saveGuiSettings).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('切换成功', () => {
  it('空闲时切换：开关落在新状态，不弹提示', async () => {
    await wrapper.find('.thinking-btn').trigger('click')
    await flushPromises()

    expect(isActive(wrapper)).toBe(true)
    expect(settingsStore.thinkingEnabled).toBe(true)
    expect(api.updateThinkingLevel).toHaveBeenCalledWith(SESSION, true)
    expect(hintText(wrapper)).toBe('')
  })

  it('引擎答"下一轮生效"时如实提示，开关保持用户点的新状态', async () => {
    vi.mocked(api.updateThinkingLevel).mockResolvedValue('next-turn')

    await wrapper.find('.thinking-btn').trigger('click')
    await flushPromises()

    expect(isActive(wrapper)).toBe(true)
    expect(hintText(wrapper)).toBe(enUS.chatInput.thinkingAppliesNextTurn)
    expect(wrapper.find('.steer-hint-error').exists()).toBe(false)
  })

  it('提示只以引擎的答复为准，不再自己猜会话是否忙', async () => {
    // 会话忙不忙不由界面判：canSafelySuspend 才是真话（本轮是否真的不能打断）。
    vi.mocked(api.updateThinkingLevel).mockResolvedValue('now')

    await wrapper.find('.thinking-btn').trigger('click')
    await flushPromises()

    expect(hintText(wrapper)).toBe('')
  })
})

describe('切换失败要把开关退回去', () => {
  it('引擎下发失败：开关回到点击前、给出可见错误、并把回退后的值再落一次盘', async () => {
    vi.mocked(api.updateThinkingLevel).mockRejectedValue(new Error('pi process gone'))

    await wrapper.find('.thinking-btn').trigger('click')
    await flushPromises()

    expect(isActive(wrapper)).toBe(false)
    expect(settingsStore.thinkingEnabled).toBe(false)
    expect(hintText(wrapper)).toBe(enUS.chatInput.thinkingApplyFailed)
    expect(wrapper.find('.steer-hint-error').exists()).toBe(true)
    // 回滚必须再同步一次主进程：localStorage 在第一次保存时已经写过新值了。
    expect(lastSavedThinking()).toBe(false)
  })

  it('主进程配置没落地：不调用引擎，开关退回并提示', async () => {
    vi.mocked(api.saveGuiSettings).mockResolvedValue({ success: false, error: 'write failed' })

    await wrapper.find('.thinking-btn').trigger('click')
    await flushPromises()

    expect(isActive(wrapper)).toBe(false)
    expect(hintText(wrapper)).toBe(enUS.chatInput.thinkingSaveFailed)
    expect(api.updateThinkingLevel).not.toHaveBeenCalled()
  })

  it('本地代理没对齐：设置本身生效了，所以只提示不回退', async () => {
    vi.mocked(api.saveGuiSettings).mockResolvedValue({ success: true, proxy: { state: 'failed' } })

    await wrapper.find('.thinking-btn').trigger('click')
    await flushPromises()

    expect(isActive(wrapper)).toBe(true)
    expect(hintText(wrapper)).toBe(enUS.chatInput.thinkingProxyFailed)
  })

  it('快速连续切换以最后一次选择为准：前一次的失败不盖掉后来的决定', async () => {
    vi.mocked(api.updateThinkingLevel).mockRejectedValue(new Error('pi process gone'))

    const click = wrapper.find('.thinking-btn').trigger('click')
    await flushPromises()
    const second = wrapper.find('.thinking-btn').trigger('click')
    await Promise.all([click, second])
    await flushPromises()

    // 两次都失败：第一次要回退（当时它仍是用户眼前的选择），第二次把它再点回去后
    // 第一次那条失败路径不该把状态改到自己点击前的样子 —— 最终停在第二次的选择上。
    expect(isActive(wrapper)).toBe(false)
    expect(settingsStore.thinkingEnabled).toBe(false)
  })
})
