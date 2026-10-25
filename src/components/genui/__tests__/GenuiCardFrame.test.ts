import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import { GENUI_MSG_READY, GENUI_SANDBOX_DOC_PATH, GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import GenuiCardFrame from '../GenuiCardFrame.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

const SOURCE = { baseUrl: 'http://localhost:5174', docUrl: `http://localhost:5174${GENUI_SANDBOX_DOC_PATH}` }

const CARD = {
  id: 'm1:card:0',
  protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
  schema: { componentName: 'FixtureCard', title: 'fixture', rows: [] },
}

function mountFrame(props: Record<string, unknown> = {}) {
  return mount(GenuiCardFrame, {
    props: { card: CARD, source: SOURCE, theme: 'dark' as const, locale: 'zh-CN', ...props },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('卡片 iframe 的授权面', () => {
  it('只授予 allow-scripts，文档来自独立源的固定入口', () => {
    const wrapper = mountFrame()
    const frame = wrapper.find('iframe').element

    // 多一个 allow-same-origin 就等于把 app 的 origin 交给卡片；
    // allow-popups / allow-top-navigation / allow-forms 同理，一个都不给。
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('src')).toBe(SOURCE.docUrl)
    expect(frame.getAttribute('title')).toBe('生成式 UI 卡片')
    wrapper.unmount()
  })

  it('卡片外壳不撑破消息宽度（jsdom 量不了布局，钉住样式规则）', () => {
    const sfc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'GenuiCardFrame.vue'), 'utf-8')
    const style = sfc.slice(sfc.indexOf('<style'))
    expect(style).toContain('max-width: 100%')
    expect(style).toContain('min-width: 0')
  })
})

describe('握手失败收口到该卡的错误占位', () => {
  it('超时后换成占位并提供重试', async () => {
    const wrapper = mountFrame()
    vi.advanceTimersByTime(5_000)
    await nextTick()

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('卡片未能与宿主完成握手')
    expect(wrapper.find('button').text()).toBe('重试')
    wrapper.unmount()
  })

  it('伪造的回信不会把卡片骗成 ready', async () => {
    const wrapper = mountFrame()
    const frame = wrapper.find('iframe').element
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_READY, nonce: 'guessed', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION },
        source: frame.contentWindow,
      }),
    )
    vi.advanceTimersByTime(5_000)
    await nextTick()

    expect(wrapper.text()).toContain('卡片未能与宿主完成握手')
    wrapper.unmount()
  })

  it('重试重建 iframe 重新握手，失败仍然只影响这一张卡', async () => {
    const wrapper = mountFrame()
    vi.advanceTimersByTime(5_000)
    await nextTick()
    await wrapper.find('button').trigger('click')

    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.attributes('data-state')).toBe('connecting')

    vi.advanceTimersByTime(5_000)
    await nextTick()
    expect(wrapper.attributes('data-state')).toBe('error')
    wrapper.unmount()
  })

  it('宿主没有沙箱源时直接给部署错误，不给重试', () => {
    const wrapper = mountFrame({ source: null })
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('当前宿主未接入卡片沙箱')
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('外壳跟随应用主题', () => {
  it('主题变化写进 data-theme，占位文案也跟着明暗', async () => {
    const wrapper = mountFrame()
    expect(wrapper.attributes('data-theme')).toBe('dark')
    await wrapper.setProps({ theme: 'light' })
    expect(wrapper.attributes('data-theme')).toBe('light')
    wrapper.unmount()
  })
})
