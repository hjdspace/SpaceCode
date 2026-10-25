// @vitest-environment jsdom
/**
 * 卡片外壳的生命周期降级（票 05 第 2、3、6 条）。
 *
 * 断言的都是外部可见结果：滚出视口后还剩什么、滚回来是否重新按 schema 起卡、
 * payload 被驱逐或 metadata 损坏时用户看到什么。真实交叉面积与滚动流畅度归手工验收。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, config, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import {
  GENUI_MSG_READY,
  GENUI_MSG_SIZE,
  GENUI_SANDBOX_DOC_PATH,
  GENUI_SANDBOX_PROTOCOL_VERSION,
} from '@/shared/genuiSandbox'
import GenuiCardFrame from '../GenuiCardFrame.vue'
import { createIntersectionObserverStub } from './intersectionObserverStub'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

const SOURCE = { baseUrl: 'http://localhost:5174', docUrl: `http://localhost:5174${GENUI_SANDBOX_DOC_PATH}`, kind: 'dev' as const }
const NONCE = '11111111-2222-3333-4444-555555555555'

const SCHEMA = { componentName: 'TinyForm', props: { title: '报名表' } }

function cardRecord(overrides: Record<string, unknown> = {}) {
  return { id: 'm1:card:0', schema: SCHEMA, protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION, ...overrides }
}

function mountFrame(props: Record<string, unknown> = {}) {
  return mount(GenuiCardFrame, {
    props: { card: cardRecord(), source: SOURCE, theme: 'dark' as const, locale: 'zh-CN', ...props },
  })
}

function ready(frame: HTMLIFrameElement) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: GENUI_MSG_READY, nonce: NONCE, protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION },
      source: frame.contentWindow,
    }),
  )
}

function reportSize(frame: HTMLIFrameElement, height: number) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: GENUI_MSG_SIZE, nonce: NONCE, height },
      source: frame.contentWindow,
    }),
  )
}

const observers = createIntersectionObserverStub()

beforeEach(() => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(NONCE)
  observers.install()
})

afterEach(() => {
  observers.uninstall()
  vi.restoreAllMocks()
})

describe('离开视口卸载 iframe', () => {
  it('滚出视口后只剩占位，占位高度就是最后测到的内容高度', async () => {
    const wrapper = mountFrame()
    const first = wrapper.find('iframe').element as HTMLIFrameElement
    ready(first)
    await nextTick()
    reportSize(first, 320)
    await nextTick()

    observers.trigger(wrapper.element, false)
    await nextTick()

    expect(wrapper.find('iframe').exists()).toBe(false)
    const placeholder = wrapper.find('.genui-card-offscreen')
    expect(placeholder.exists()).toBe(true)
    expect(placeholder.attributes('style')).toContain('height: 320px')
    wrapper.unmount()
  })

  it('离屏只换掉画面那一格，摘要带与动作行照旧在位（滚回来不跳布局）', async () => {
    const wrapper = mountFrame({
      card: cardRecord({ submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 3 } }),
    })
    const first = wrapper.find('iframe').element as HTMLIFrameElement
    ready(first)
    await nextTick()
    reportSize(first, 320)
    await nextTick()
    const mountedRows = wrapper.findAll('.genui-card > *').length

    observers.trigger(wrapper.element, false)
    await nextTick()

    expect(wrapper.find('iframe').exists()).toBe(false)
    // 块内行数一致：占位只顶替 iframe，摘要与展开入口不属于「画面」
    expect(wrapper.findAll('.genui-card > *').length).toBe(mountedRows)
    expect(wrapper.find('.genui-card-submitted').text()).toContain('已提交卡片「报名表」')
    expect(wrapper.find('.genui-card-expand').exists()).toBe(true)
    wrapper.unmount()
  })

  it('滚回视口后重新起卡：新沙箱实例重新走一遍握手', async () => {
    const wrapper = mountFrame()
    const first = wrapper.find('iframe').element as HTMLIFrameElement
    ready(first)
    await nextTick()
    expect(wrapper.find('.genui-card-expand').exists()).toBe(true)

    observers.trigger(wrapper.element, false)
    await nextTick()
    expect(wrapper.find('iframe').exists()).toBe(false)
    // 随卸载断开的旧桥：旧 frame 的回信不再能把状态改回 ready
    ready(first)
    await nextTick()

    observers.trigger(wrapper.element, true)
    await nextTick()
    const rebuilt = wrapper.find('iframe').element as HTMLIFrameElement
    expect(rebuilt).not.toBe(first)
    // 沙箱实例是新的：卡片内的临时输入不承诺跨卸载保留，一切从 schema 初始状态重新起
    expect(wrapper.find('.genui-card-expand').exists()).toBe(false)

    // 重建的那次 attach 排在 same-tick 微任务队列末尾，握手要等它把新桥挂上
    await flushPromises()
    ready(rebuilt)
    await nextTick()
    expect(wrapper.find('.genui-card-expand').exists()).toBe(true)
    wrapper.unmount()
  })

  it('已提交的卡片滚回来仍然只读，摘要还在', async () => {
    const wrapper = mountFrame({
      card: cardRecord({ submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 3 } }),
    })
    observers.trigger(wrapper.element, false)
    await nextTick()
    observers.trigger(wrapper.element, true)
    await nextTick()

    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.attributes('data-submitted')).toBe('true')
    expect(wrapper.find('.genui-card-submitted').text()).toContain('已提交卡片「报名表」')
    wrapper.unmount()
  })

  it('没有 IntersectionObserver 的宿主照常渲染，不会因为记账而白屏', async () => {
    observers.uninstall()
    const wrapper = mountFrame()
    expect(wrapper.find('iframe').exists()).toBe(true)
    wrapper.unmount()
  })

  it('卸载时停止观察，离开消息流的卡片不再被记账', () => {
    const wrapper = mountFrame()
    expect(observers.observedCount()).toBe(1)
    wrapper.unmount()
    expect(observers.observedCount()).toBe(0)
  })

  it('弹窗里的实例不参与离屏卸载（弹窗本来就是给全貌看的）', () => {
    const wrapper = mountFrame({ expandable: false })
    expect(observers.observedCount()).toBe(0)
    wrapper.unmount()
  })
})

describe('内容不可用时的可见占位', () => {
  it('payload 被会话预算丢弃后不开 iframe，给出过期说明并保留提交摘要', () => {
    const wrapper = mountFrame({
      card: cardRecord({
        schema: null,
        expired: true,
        submitted: { summary: '已提交卡片「报名表」，共 2 个字段', submittedAt: 8 },
      }),
    })

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('卡片内容已过期')
    expect(wrapper.text()).toContain('已提交卡片「报名表」，共 2 个字段')
    wrapper.unmount()
  })

  it('schema 缺失但没标过期（metadata 损坏）时给出不可用占位，不静默消失', () => {
    const wrapper = mountFrame({ card: cardRecord({ schema: null }) })

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('卡片内容已不可用')
    wrapper.unmount()
  })

  it('协议版本对不上当前渲染器时降级为说明，不去起一个注定失败的沙箱', () => {
    const wrapper = mountFrame({ card: cardRecord({ protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION + 1 }) })

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('卡片协议版本')
    wrapper.unmount()
  })
})
