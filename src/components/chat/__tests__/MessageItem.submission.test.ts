/**
 * 卡片提交消息在气泡里的折叠展示（票 04「重载后的展示」）。
 *
 * 提交消息的正文带着完整围栏 JSON（引擎靠它拿到 payload），气泡只应显示摘要；
 * metadata 丢失（旧数据、被裁剪）时必须退回原文，内容不能被静默吞掉。
 */
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

const SUMMARY = '已提交卡片「报名表」，共 1 个字段'
const CONTENT = `${SUMMARY}\n\n\`\`\`json\n{\n  "name": "张三"\n}\n\`\`\``

function mountUser(message: Message) {
  return mount(MessageItem, {
    props: { message },
    global: {
      stubs: ['MarkdownRenderer', 'ReasoningCard', 'ToolCallList', 'MessageMetadata'],
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('提交消息的气泡展示', () => {
  it('metadata 存在时只渲染摘要，围栏 JSON 不进入气泡', () => {
    const message: Message = {
      id: 'u1',
      role: 'user',
      content: CONTENT,
      timestamp: 1,
      metadata: {
        genUiSubmission: {
          cardId: 'm1:card:0',
          summary: SUMMARY,
          payload: { name: '张三' },
          collapsed: true,
        },
      },
    }
    const wrapper = mountUser(message)

    expect(wrapper.find('.user-text').text()).toBe(SUMMARY)
    expect(wrapper.find('.user-text').text()).not.toContain('```json')
    expect(wrapper.find('.user-text').text()).not.toContain('"name"')
    wrapper.unmount()
  })

  it('metadata 丢失时退回原文，围栏 JSON 仍然可读', () => {
    const message: Message = { id: 'u1', role: 'user', content: CONTENT, timestamp: 1 }
    const wrapper = mountUser(message)

    expect(wrapper.find('.user-text').text()).toContain(SUMMARY)
    expect(wrapper.find('.user-text').text()).toContain('```json')
    expect(wrapper.find('.user-text').text()).toContain('"name": "张三"')
    wrapper.unmount()
  })
})
