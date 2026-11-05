import { describe, it, expect, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import MessageItem from '../MessageItem.vue'
import type { Message } from '@/types'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n, createPinia()]

const STUBS = ['MarkdownRenderer', 'ReasoningCard', 'ToolCallList', 'MessageMetadata']

function richMessage(): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: '收到，这就安排。',
    timestamp: Date.now(),
    reasoning: { content: '用户想派活', startTime: 1000, endTime: 2000 },
    toolCalls: [{ id: 't1', name: 'Bash', input: { command: 'ls' }, status: 'completed' }],
    metadata: { model: 'glm-5-3-flash', inputTokens: 21005, outputTokens: 67 },
  }
}

function mountItem(message: Message, presentation?: 'im') {
  return mount(MessageItem, {
    props: { message, ...(presentation ? { presentation } : {}) },
    global: { stubs: STUBS },
  })
}

describe('MessageItem IM 展示模式', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('只留正文：推理折叠、工具列表与 token/模型统计都不出现', () => {
    const wrapper = mountItem(richMessage(), 'im')

    expect(wrapper.findAllComponents({ name: 'ReasoningCard' })).toHaveLength(0)
    expect(wrapper.findAllComponents({ name: 'ToolCallList' })).toHaveLength(0)
    expect(wrapper.findAllComponents({ name: 'MessageMetadata' })).toHaveLength(0)
    expect(wrapper.text()).not.toContain('glm-5-3-flash')
    // 正文仍走同一套 Markdown 渲染，只是周围的东西被收走了
    const renderers = wrapper.findAllComponents({ name: 'MarkdownRenderer' })
    expect(renderers.map(c => String(c.props('content') ?? ''))).toContain('收到，这就安排。')
  })

  it('默认模式三者照旧渲染（回归保护）', () => {
    const wrapper = mountItem(richMessage())

    expect(wrapper.findAllComponents({ name: 'ReasoningCard' })).toHaveLength(1)
    expect(wrapper.findAllComponents({ name: 'ToolCallList' })).toHaveLength(1)
    expect(wrapper.findAllComponents({ name: 'MessageMetadata' })).toHaveLength(1)
  })

  it('气泡流：assistant 不挂角色头', () => {
    const wrapper = mountItem(richMessage(), 'im')

    expect(wrapper.classes()).toContain('im')
    // 「Agent」+ 时间戳是文档流的头部，IM 单列气泡不需要
    expect(wrapper.find('.message-header').exists()).toBe(false)
  })

  it('用户气泡：靠右排版、没有角色头，只留复制 —— 回滚/编辑在 Router 通路没接线', () => {
    const user: Message = {
      id: 'u1',
      role: 'user',
      content: '帮我把登录页修好',
      timestamp: Date.now(),
    }
    const imWrapper = mountItem(user, 'im')
    const plain = mountItem(user)

    expect(imWrapper.classes()).toContain('im')
    expect(imWrapper.classes()).toContain('user')
    expect(imWrapper.find('.message-header').exists()).toBe(false)
    expect(imWrapper.find('.message-content').exists()).toBe(true)
    // 回滚/编辑依赖主聊天的 turnStore 通路，出现在这里就是死按钮
    expect(imWrapper.findAll('.action-button')).toHaveLength(1)
    expect(plain.findAll('.action-button')).toHaveLength(2)
  })
})
