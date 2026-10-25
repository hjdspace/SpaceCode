import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import GenuiCardGroup from '../GenuiCardGroup.vue'
import GenuiCardFrame from '../GenuiCardFrame.vue'
import { GENUI_SANDBOX_DOC_PATH, GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import type { GenuiCardRecord } from '@/types/genui'
import type { Message } from '@/types'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

const SOURCE = { baseUrl: 'http://localhost:5174', docUrl: `http://localhost:5174${GENUI_SANDBOX_DOC_PATH}` }

function card(messageId: string, index: number): GenuiCardRecord {
  return {
    id: `${messageId}:card:${index}`,
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    schema: { componentName: 'FixtureCard', title: `card ${index}`, rows: [] },
  }
}

function message(id: string, cards: GenuiCardRecord[]): Message {
  return {
    id,
    role: 'assistant',
    content: '正文',
    timestamp: 1,
    metadata: cards.length ? { genUiCards: cards } : undefined,
  }
}

function mountGroup(messages: Message[], props: Record<string, unknown> = {}) {
  return mount(GenuiCardGroup, { props: { messages, source: SOURCE, ...props } })
}

beforeEach(() => {
  vi.useFakeTimers()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('消息区的卡片分组', () => {
  it('没有卡片记录时不占任何位置', () => {
    const wrapper = mountGroup([message('m1', [])])
    expect(wrapper.find('.genui-card-group').exists()).toBe(false)
    wrapper.unmount()
  })

  it('同一条消息的多张卡按记录顺序纵向排列，一卡一个 iframe', () => {
    const wrapper = mountGroup([message('m1', [card('m1', 0), card('m1', 1)])])
    const frames = wrapper.findAllComponents(GenuiCardFrame)

    expect(frames).toHaveLength(2)
    expect(frames.map((frame) => frame.props('card').id)).toEqual(['m1:card:0', 'm1:card:1'])
    expect(wrapper.findAll('iframe')).toHaveLength(2)
    wrapper.unmount()
  })

  it('跨消息的卡片依次汇总，顺序即消息顺序', () => {
    const wrapper = mountGroup([message('m1', [card('m1', 0)]), message('m2', [card('m2', 1)])])
    expect(wrapper.findAllComponents(GenuiCardFrame).map((f) => f.props('card').id)).toEqual([
      'm1:card:0',
      'm2:card:1',
    ])
    wrapper.unmount()
  })

  it('每张卡各自向沙箱源加载文档', () => {
    const wrapper = mountGroup([message('m1', [card('m1', 0), card('m1', 1)])])
    for (const frame of wrapper.findAll('iframe')) {
      expect(frame.attributes('src')).toBe(SOURCE.docUrl)
      expect(frame.attributes('sandbox')).toBe('allow-scripts')
    }
    wrapper.unmount()
  })

  it('宿主没有沙箱源时整组落错误占位', () => {
    const wrapper = mountGroup([message('m1', [card('m1', 0)])], { source: null })
    expect(wrapper.text()).toContain('当前宿主未接入卡片沙箱')
    expect(wrapper.find('iframe').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('主题跟随', () => {
  it('读应用实际生效的 data-theme，明暗切换推到卡片', async () => {
    document.documentElement.dataset.theme = 'dark'
    const wrapper = mountGroup([message('m1', [card('m1', 0)])])
    expect(wrapper.findAllComponents(GenuiCardFrame)[0].props('theme')).toBe('dark')

    document.documentElement.dataset.theme = 'anthropic'
    await Promise.resolve()
    await nextTick()
    expect(wrapper.findAllComponents(GenuiCardFrame)[0].props('theme')).toBe('light')
    wrapper.unmount()
  })

  it('卸载后不再观察主题变化', async () => {
    const wrapper = mountGroup([message('m1', [card('m1', 0)])])
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
