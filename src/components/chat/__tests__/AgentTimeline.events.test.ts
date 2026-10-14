import { describe, it, expect, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import AgentTimeline from '../AgentTimeline.vue'
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

const STUBS = ['MarkdownRenderer', 'ReasoningCard', 'TurnSummaryBar', 'ThinkingState', 'ErrorCard']

function mountTimeline(messages: Message[], mode?: 'design') {
  return mount(AgentTimeline, {
    props: { messages, loading: false, ...(mode ? { mode } : {}) },
    global: { stubs: STUBS },
  })
}

function textContents(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents({ name: 'MarkdownRenderer' }).map(c => c.props('content'))
}

describe('AgentTimeline timelineEvents 归一化', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('把兼容层按帧切碎的相邻 text 事件合并成一个 Markdown 文档', () => {
    // 复现网关每个 content 分片都回传 reasoning_content:"" 时的形状：
    // 一段答复被切成 3 个 text 块，块之间夹着 2 个空 thinking 块。
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '"做一个考勤表" 有几种可能的理解',
      timestamp: Date.now(),
      reasoning: { content: 'The user says 做一个考勤表', startTime: 1000, endTime: 2000 },
      timelineEvents: [
        { id: 'r0', type: 'reasoning', timestamp: 1, status: 'completed', content: 'The user says 做一个考勤表' },
        { id: 't1', type: 'text', timestamp: 2, status: 'completed', content: '"做一个' },
        { id: 'r1', type: 'reasoning', timestamp: 3, status: 'completed', content: '' },
        { id: 't2', type: 'text', timestamp: 4, status: 'completed', content: '考勤表"' },
        { id: 'r2', type: 'reasoning', timestamp: 5, status: 'completed', content: '' },
        { id: 't3', type: 'text', timestamp: 6, status: 'completed', content: ' 有几种可能的理解' },
      ],
    }

    const wrapper = mountTimeline([msg])

    expect(textContents(wrapper)).toEqual(['"做一个考勤表" 有几种可能的理解'])
    // 空白 reasoning 占位块不再渲染成夹在答复中间的折叠卡片
    expect(wrapper.findAllComponents({ name: 'ReasoningCard' })).toHaveLength(1)
  })

  it('保留运行中的空 reasoning 事件（思考中动画的首帧）', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      timelineEvents: [
        { id: 'r0', type: 'reasoning', timestamp: 1, status: 'running', content: '' },
      ],
    }

    expect(mountTimeline([msg]).findAllComponents({ name: 'ReasoningCard' })).toHaveLength(1)
  })

  it('工具调用前后的 text 块不跨工具合并', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [{ id: 'tool-1', name: 'Read', input: { file_path: 'a.ts' }, status: 'completed', startTime: 1, endTime: 2 }],
      timelineEvents: [
        { id: 't1', type: 'text', timestamp: 1, status: 'completed', content: '先看一眼' },
        { id: 'tool-tool-1', type: 'tool_call', timestamp: 2, status: 'completed', toolCallId: 'tool-1' },
        { id: 't2', type: 'text', timestamp: 3, status: 'completed', content: '然后改好了' },
      ],
    }

    expect(textContents(mountTimeline([msg]))).toEqual(['先看一眼', '然后改好了'])
  })

  it('design 模式：跨帧切断的设计标签在合并后整体剥离', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      timelineEvents: [
        { id: 't1', type: 'text', timestamp: 1, status: 'completed', content: '给你 <od-card type="file" title="考勤表' },
        { id: 't2', type: 'text', timestamp: 2, status: 'completed', content: '.html">attendance.html</od-card> 看看' },
      ],
    }

    const contents = textContents(mountTimeline([msg], 'design'))
    expect(contents).toHaveLength(1)
    expect(contents[0]).not.toContain('od-card')
    expect(contents[0]).toContain('看看')
  })

  it('design 模式：只含设计标签的文本块不渲染空 Markdown 容器', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      timelineEvents: [
        { id: 't1', type: 'text', timestamp: 1, status: 'completed', content: '<next-steps><action label="继续" prompt="go"/></next-steps>' },
      ],
    }

    expect(mountTimeline([msg], 'design').findAllComponents({ name: 'MarkdownRenderer' })).toHaveLength(0)
  })
})
