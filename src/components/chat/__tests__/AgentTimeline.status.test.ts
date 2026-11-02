import { describe, it, expect, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import AgentTimeline from '../AgentTimeline.vue'
import type { ClassifiedError, Message } from '@/types'
import { ErrorCategory } from '@/types'
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

const STUBS = ['MarkdownRenderer', 'ReasoningCard', 'TurnSummaryBar', 'LoadingState', 'ErrorCard']

function mountTimeline(messages: Message[]) {
  return mount(AgentTimeline, {
    props: { messages, loading: false },
    global: { stubs: STUBS },
  })
}

const classifiedError: ClassifiedError = {
  category: ErrorCategory.NETWORK_ERROR,
  title: '网络错误',
  message: '无法连接到模型服务',
  technicalDetail: 'ECONNREFUSED',
  retryable: true,
  originalError: 'ECONNREFUSED',
  timestamp: Date.now(),
}

/** 一次工具调用失败、随后重试成功并正常收口的回合 —— 截图里那种「误报错误」的形状。 */
function erroredToolButSettled(): Message {
  return {
    id: 'm-recovered',
    role: 'assistant',
    content: '已按方案完成修改',
    timestamp: Date.now() - 3_431_600,
    toolCalls: [
      { id: 't-bad', name: 'Read', input: { path: 'missing.c' }, status: 'error', output: 'File does not exist', startTime: 1, endTime: 2 },
      { id: 't-good', name: 'Read', input: { path: 'main.c' }, status: 'completed', output: 'ok', startTime: 3, endTime: 4 },
    ],
    timelineEvents: [
      { id: 'tool-t-bad', type: 'tool_call', timestamp: 1, status: 'error', toolCallId: 't-bad' },
      { id: 'tool-t-good', type: 'tool_call', timestamp: 3, status: 'completed', toolCallId: 't-good' },
      { id: 'text-1', type: 'text', timestamp: 5, status: 'completed', content: '已按方案完成修改' },
    ],
    metadata: { model: 'GLM-5.3-Flash', duration: 3_431_600, inputTokens: 100, outputTokens: 200 },
  }
}

describe('AgentTimeline 状态徽标与用时', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('中途工具报错但回合成功收口：徽标是完成，不是错误', () => {
    const wrapper = mountTimeline([erroredToolButSettled()])
    const badge = wrapper.find('.timeline-status-badge')

    expect(badge.classes()).toContain('completed')
    expect(badge.text()).toBe('完成')
  })

  it('工具报错后整轮仍失败（metadata.error）：徽标保持错误', () => {
    const msg: Message = {
      id: 'm-failed',
      role: 'assistant',
      content: '无法连接到模型服务',
      timestamp: Date.now() - 5_000,
      toolCalls: [
        { id: 't-bad', name: 'Read', input: { path: 'missing.c' }, status: 'error', output: 'File does not exist', startTime: 1, endTime: 2 },
      ],
      timelineEvents: [
        { id: 'tool-t-bad', type: 'tool_call', timestamp: 1, status: 'error', toolCallId: 't-bad' },
      ],
      metadata: { model: 'GLM-5.3-Flash', duration: 5_000, error: classifiedError },
    }

    const wrapper = mountTimeline([msg])
    const badge = wrapper.find('.timeline-status-badge')

    expect(badge.classes()).toContain('error')
    expect(badge.text()).toBe('错误')
  })

  it('徽标右侧用时按分钟归一，不再堆成 3431.6s', () => {
    const wrapper = mountTimeline([erroredToolButSettled()])

    expect(wrapper.find('.timer-value').text()).toBe('57m 12s')
  })
})
