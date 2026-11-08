import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, config, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import MessageList from '../MessageList.vue'
import AgentTimeline from '../AgentTimeline.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import type { Message } from '@/types'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
const rootPinia = createPinia()
config.global.plugins = [i18n, rootPinia]

const MessageItemStub = defineComponent({
  name: 'MessageItem',
  props: {
    message: { type: Object, required: true },
    presentation: String,
  },
  template: '<div class="message-item-stub" />',
})

const AgentTimelineStub = defineComponent({
  name: 'AgentTimeline',
  props: {
    messages: { type: Array, required: true },
    presentation: String,
  },
  template: '<div class="agent-timeline-stub" />',
})

const ArtifactSummaryCardStub = defineComponent({
  name: 'ArtifactSummaryCard',
  props: { artifacts: { type: Array, required: true } },
  template: '<div class="artifact-card-stub" />',
})

const STUBS = {
  MessageItem: MessageItemStub,
  AgentTimeline: AgentTimelineStub,
  ArtifactSummaryCard: ArtifactSummaryCardStub,
  ExtensionDialogCard: true,
  DesignBlocks: true,
  CurrentTurnChangeCard: true,
  GenuiCardGroup: true,
  ConversationMinimap: true,
  LoadingState: true,
}

function assistantWithArtifact(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: id,
    timestamp: 1,
    metadata: {
      artifacts: [{ name: '考勤表.xlsx', path: '/tmp/考勤表.xlsx', ext: 'xlsx', size: 1, mtime: 1 }],
    },
  }
}

function mountList(messages: Message[], presentation?: 'im') {
  return mount(MessageList, {
    props: { messages, loading: false, sessionId: 'sid-a', ...(presentation ? { presentation } : {}) },
    global: { stubs: STUBS },
  })
}

describe('MessageList IM 展示模式', () => {
  beforeEach(() => {
    setActivePinia(rootPinia)
    ;(HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = vi.fn()
  })

  it('把 presentation 透传给气泡与时间线，而不是另起一套渲染器', () => {
    const wrapper = mountList([assistantWithArtifact('m1')], 'im')

    expect(wrapper.findComponent({ name: 'AgentTimeline' }).props('presentation')).toBe('im')
  })

  it('用户消息同样走 IM 展示模式', () => {
    const user: Message = { id: 'u1', role: 'user', content: '做一个考勤表', timestamp: 1 }

    const wrapper = mountList([user], 'im')

    expect(wrapper.findComponent({ name: 'MessageItem' }).props('presentation')).toBe('im')
  })

  it('不传 presentation 时原样渲染', () => {
    const wrapper = mountList([assistantWithArtifact('m1')])

    expect(wrapper.findComponent({ name: 'AgentTimeline' }).props('presentation')).toBeUndefined()
    expect(wrapper.findAllComponents({ name: 'ArtifactSummaryCard' })).toHaveLength(1)
  })

  it('IM 模式收起本轮产物清单卡片：气泡流里不插交付物大卡', () => {
    const wrapper = mountList([assistantWithArtifact('m1')], 'im')

    expect(wrapper.findAllComponents({ name: 'ArtifactSummaryCard' })).toHaveLength(0)
    // 时间线本身仍然渲染 —— 只是剥掉了围绕它的卡片
    expect(wrapper.findAllComponents({ name: 'AgentTimeline' })).toHaveLength(1)
  })

  it('IM 的 assistant-message slot 挂在每条消息后，普通模式和未使用 slot 的 IM 仍合并连续回复', async () => {
    const messages: Message[] = [
      { id: 'a1', role: 'assistant', content: '派工', timestamp: 1 },
      { id: 'a2', role: 'assistant', content: '完成', timestamp: 2 },
    ]
    const withoutSlot = mountList(messages, 'im')
    expect(withoutSlot.findAllComponents(AgentTimelineStub)).toHaveLength(1)
    withoutSlot.unmount()

    const wrapper = mount(MessageList, {
      props: { messages, loading: false },
      global: { stubs: STUBS },
      slots: {
        'assistant-message': ({ message }: { message: Message }) => h('aside', { class: 'message-attachment' }, message.content),
      },
    })
    // A message slot must not change ordinary conversation grouping.
    expect(wrapper.findAllComponents(AgentTimelineStub)).toHaveLength(1)
    expect(wrapper.findAll('.message-attachment')).toHaveLength(0)

    // The same array must be regrouped when presentation changes (cache invalidation).
    await wrapper.setProps({ presentation: 'im' })
    const timelines = wrapper.findAllComponents(AgentTimelineStub)
    expect(timelines).toHaveLength(2)
    expect(timelines.map(timeline => timeline.props('messages'))).toEqual([[messages[0]], [messages[1]]])
    expect(wrapper.findAll('.agent-timeline-stub, .message-attachment').map(node =>
      node.classes().includes('agent-timeline-stub') ? 'timeline' : node.text(),
    )).toEqual(['timeline', '派工', 'timeline', '完成'])

    await wrapper.setProps({ presentation: undefined })
    expect(wrapper.findAllComponents(AgentTimelineStub)).toHaveLength(1)
    expect(wrapper.findAll('.message-attachment')).toHaveLength(0)
    wrapper.unmount()
  })

  it('真实 IM 时间线在附件前后保留 Markdown 的 strong、列表与链接', async () => {
    const messages: Message[] = [
      { id: 'dispatch', role: 'assistant', content: '**已派工**\n\n```super-agent:route\n{"version":1,"tickets":[]}\n```', timestamp: 1 },
      { id: 'summary', role: 'assistant', content: '- **验证通过**\n- [查看结果](https://example.com/result)', timestamp: 2 },
    ]
    const wrapper = mount(MessageList, {
      props: { messages, loading: false, presentation: 'im' },
      global: { stubs: { ...STUBS, AgentTimeline: false } },
      slots: {
        'assistant-message': ({ message }: { message: Message }) => message.id === 'dispatch'
          ? h('aside', { class: 'message-attachment' }, '工单')
          : [],
      },
    })
    await flushPromises()
    try {
      expect(wrapper.findAllComponents(AgentTimeline)).toHaveLength(2)
      expect(wrapper.findAllComponents(MarkdownRenderer)).toHaveLength(2)
      expect(wrapper.findAll('.markdown-renderer strong').map(node => node.text())).toEqual(['已派工', '验证通过'])
      expect(wrapper.findAll('.markdown-renderer ul li').map(node => node.text())).toEqual(['验证通过', '查看结果'])
      expect(wrapper.get('.markdown-renderer a').attributes('href')).toBe('https://example.com/result')
      expect(wrapper.text()).not.toContain('super-agent:route')
      const order = wrapper.findAll('.markdown-renderer, .message-attachment')
      expect(order).toHaveLength(3)
      expect(order[0].text()).toBe('已派工')
      expect(order[1].text()).toBe('工单')
      expect(order[2].find('ul').exists()).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })

  it('IM 模式用更窄的单列容器（原型 720px），默认模式不变', () => {
    const im = mountList([assistantWithArtifact('m1')], 'im')
    const plain = mountList([assistantWithArtifact('m1')])

    expect(im.find('.messages-container').classes()).toContain('im')
    expect(plain.find('.messages-container').classes()).not.toContain('im')
  })
})
