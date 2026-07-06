import { describe, it, expect, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import MessageItem from '../MessageItem.vue'
import type { Message } from '@/types'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

// vue-i18n 9.x 的 useI18n() 需要 app.use(i18n) 安装，否则抛错。
// 通过 @vue/test-utils 的全局 plugins 注入 i18n 实例，加载真实 locale messages，
// 便于断言翻译文案并避免 missing-key 警告。
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
})
config.global.plugins = [i18n, createPinia()]

describe('MessageItem events 模式', () => {
  beforeEach(() => {
    // MessageItem 内部使用 useAppStore()，每次测试使用全新的 pinia 实例避免状态串扰。
    setActivePinia(createPinia())
  })

  it('助手消息走扁平渲染（design 模式已统一到 AgentTimeline，MessageItem 不再有 design 分支）', () => {
    const msg: Message = {
      id: 'm1', role: 'assistant', content: '你好', timestamp: Date.now(),
    }
    const w = mount(MessageItem, {
      props: { message: msg },
      global: {
        stubs: ['MarkdownRenderer', 'ReasoningCard', 'ToolCallList', 'MessageMetadata'],
      },
    })
    // design 模式的 buildBlocks 渲染已移除，不再产生 .block-text
    expect(w.find('.block-text').exists()).toBe(false)
    expect(w.find('.message-content').exists()).toBe(true)
  })

  it('助手消息含 reasoning 时渲染 ReasoningCard', () => {
    const msg: Message = {
      id: 'm1', role: 'assistant', content: '结果', timestamp: Date.now(),
      reasoning: { content: '我在思考', startTime: 1000, endTime: 2000 },
    }
    const w = mount(MessageItem, {
      props: { message: msg },
      global: {
        stubs: ['MarkdownRenderer', 'ReasoningCard', 'ToolCallList', 'MessageMetadata'],
      },
    })
    const rc = w.findComponent({ name: 'ReasoningCard' })
    expect(rc.exists()).toBe(true)
    expect(rc.props('reasoning').endTime).toBe(2000)
  })

  it('非 design 模式走原扁平渲染（回归保护）', () => {
    const msg: Message = {
      id: 'm1', role: 'assistant', content: '你好', timestamp: Date.now(),
    }
    const w = mount(MessageItem, {
      props: { message: msg },
      global: {
        stubs: ['MarkdownRenderer', 'ReasoningCard', 'ToolCallList', 'MessageMetadata'],
      },
    })
    expect(w.find('.block-text').exists()).toBe(false)
    expect(w.find('.message-content').exists()).toBe(true)
  })
})
