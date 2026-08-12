import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import AgentTimeline from '@/components/chat/AgentTimeline.vue'
import ToolCallList from '@/components/chat/ToolCallList.vue'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'
import type { ToolCall } from '@/types'

const toolCalls: ToolCall[] = [
  {
    id: 'todo-1',
    name: 'TodoWrite',
    input: {
      todos: [
        { content: 'Implement the fix', status: 'in_progress' },
        { content: 'Run the tests', status: 'pending' },
      ],
    },
    status: 'completed',
  },
  {
    id: 'task-list-1',
    name: 'TaskList',
    input: {},
    output: '#1 [in_progress] Implement the fix\n#2 [pending] Run the tests',
    status: 'completed',
  },
]

describe('ToolCallList', () => {
  it('does not render task list cards in the chat timeline', () => {
    const wrapper = mount(ToolCallList, { props: { toolCalls } })

    expect(wrapper.find('.task-list-card').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Implement the fix')
    expect(wrapper.text()).not.toContain('Run the tests')
    expect(wrapper.text()).toContain('Update tasks')
    expect(wrapper.findAll('.timeline-item')).toHaveLength(1)
  })
})

describe('AgentTimeline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps task details out of the primary chat timeline', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const i18n = createI18n({
      legacy: false,
      locale: 'en-US',
      messages: { 'en-US': enUS, 'zh-CN': zhCN },
    })

    const wrapper = mount(AgentTimeline, {
      props: {
        messages: [{
          id: 'message-1',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          toolCalls,
        }],
      },
      global: {
        plugins: [pinia, i18n],
        stubs: ['MarkdownRenderer', 'PermissionRequestCard', 'RetryIndicator', 'TurnSummaryBar'],
      },
    })

    expect(wrapper.find('.task-list-card').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Implement the fix')
    expect(wrapper.text()).not.toContain('Run the tests')
    expect(wrapper.findAll('.timeline-event')).toHaveLength(1)
  })
})
