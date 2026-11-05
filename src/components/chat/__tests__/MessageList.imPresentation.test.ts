import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import MessageList from '../MessageList.vue'
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

  it('IM 模式用更窄的单列容器（原型 720px），默认模式不变', () => {
    const im = mountList([assistantWithArtifact('m1')], 'im')
    const plain = mountList([assistantWithArtifact('m1')])

    expect(im.find('.messages-container').classes()).toContain('im')
    expect(plain.find('.messages-container').classes()).not.toContain('im')
  })
})
