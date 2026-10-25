// @vitest-environment jsdom
/**
 * 卡片分组在长会话里的表现（票 05 第 2、3、6 条）。
 *
 * 只断言分组对外可见的结果：坏记录不会带走整组卡片、被驱逐的卡片留在原位给占位、
 * 离开视口的那张换成等高占位而别的卡照常挂着。真实滚动与交叉面积归手工验收。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import GenuiCardGroup from '../GenuiCardGroup.vue'
import GenuiCardFrame from '../GenuiCardFrame.vue'
import { createIntersectionObserverStub } from './intersectionObserverStub'
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

function card(index: number, overrides: Partial<GenuiCardRecord> = {}): GenuiCardRecord {
  return {
    id: `m1:card:${index}`,
    schema: { componentName: 'TinyForm', props: { title: `卡片 ${index}` } },
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    ...overrides,
  }
}

/** `cards` 允许是坏形状：metadata 损坏时分组仍要能画出别的卡。 */
function mountGroup(cards: unknown) {
  const message: Message = {
    id: 'm1',
    role: 'assistant',
    content: '正文',
    timestamp: 1,
    metadata: { genUiCards: cards as GenuiCardRecord[] },
  }
  return mount(GenuiCardGroup, { props: { messages: [message], source: SOURCE } })
}

const observers = createIntersectionObserverStub()

beforeEach(() => {
  observers.install()
})

afterEach(() => {
  observers.uninstall()
  vi.restoreAllMocks()
})

describe('坏记录不带走整组卡片', () => {
  it('metadata 里混进坏形状时，可用卡片照常渲染，坏的那条给出可见占位', () => {
    const wrapper = mountGroup([card(0), null, { id: 'm1:card:1' }, card(2)])
    const frames = wrapper.findAllComponents(GenuiCardFrame)

    // 四条记录一条不丢地留在原来的槽位上（顺序与正文一致），读不出 id 的那条用合成 id 占位，
    // 坏的都不开 iframe
    expect(frames.map(frame => frame.props('card').id)).toEqual([
      'm1:card:0',
      'm1:damaged:1',
      'm1:card:1',
      'm1:card:2',
    ])
    expect(wrapper.findAll('iframe')).toHaveLength(2)
    expect(wrapper.text()).toContain('卡片内容已不可用')
    wrapper.unmount()
  })

  it('genUiCards 整个不是数组时不崩，也不开 iframe', () => {
    const wrapper = mountGroup('一整段坏数据')
    expect(wrapper.findAll('iframe')).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('被预算驱逐的卡片留在原位', () => {
  it('过期卡片显示可见占位，位置与顺序不变，后面的卡片不受影响', () => {
    const wrapper = mountGroup([card(0, { schema: null, expired: true }), card(1)])
    const frames = wrapper.findAllComponents(GenuiCardFrame)

    expect(frames.map(frame => frame.props('card').id)).toEqual(['m1:card:0', 'm1:card:1'])
    expect(wrapper.findAll('iframe')).toHaveLength(1)
    expect(frames[0].text()).toContain('卡片内容已过期')
    expect(frames[1].text()).not.toContain('已过期')
    wrapper.unmount()
  })

  it('已提交又被驱逐的卡片，摘要仍然读得出来', () => {
    const wrapper = mountGroup([
      card(0, {
        schema: null,
        expired: true,
        submitted: { summary: '已提交卡片「报名表」，共 3 个字段', submittedAt: 9 },
      }),
    ])

    expect(wrapper.text()).toContain('卡片内容已过期')
    expect(wrapper.text()).toContain('已提交卡片「报名表」，共 3 个字段')
    wrapper.unmount()
  })
})

describe('离开视口的卡片让位', () => {
  it('滚出视口只换掉那一张卡，同组别的卡不受牵连', async () => {
    const wrapper = mountGroup([card(0), card(1)])
    const frames = wrapper.findAllComponents(GenuiCardFrame)

    observers.trigger(frames[0].element, false)
    await nextTick()

    expect(wrapper.findAll('iframe')).toHaveLength(1)
    expect(frames[0].attributes('data-offscreen')).toBe('true')
    // 让位不等于消失：占位仍占着原来那一格
    expect(frames[0].find('.genui-card-offscreen').exists()).toBe(true)
    expect(frames[1].find('iframe').exists()).toBe(true)

    observers.trigger(frames[0].element, true)
    await nextTick()

    expect(wrapper.findAll('iframe')).toHaveLength(2)
    expect(frames[0].attributes('data-offscreen')).toBeUndefined()
    wrapper.unmount()
  })
})
