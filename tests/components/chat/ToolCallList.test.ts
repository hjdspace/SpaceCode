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
    const pinia = createPinia()
    setActivePinia(pinia)
    const i18n = createI18n({
      legacy: false,
      locale: 'en-US',
      messages: { 'en-US': enUS, 'zh-CN': zhCN },
    })
    const wrapper = mount(ToolCallList, {
      props: { toolCalls },
      global: { plugins: [pinia, i18n] },
    })

    expect(wrapper.find('.task-list-card').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Implement the fix')
    expect(wrapper.text()).not.toContain('Run the tests')
    expect(wrapper.text()).toContain('Update tasks')
    expect(wrapper.findAll('.timeline-item')).toHaveLength(1)
  })

  function mountTools(calls: ToolCall[], locale = 'en-US') {
    const pinia = createPinia()
    setActivePinia(pinia)
    const i18n = createI18n({
      legacy: false,
      locale,
      messages: { 'en-US': enUS, 'zh-CN': zhCN },
    })
    return mount(ToolCallList, {
      props: { toolCalls: calls },
      global: { plugins: [pinia, i18n] },
    })
  }

  it('renders todo MCP tools with a localized action label and the todo title as target', () => {
    const wrapper = mountTools([
      {
        id: 'todo-create',
        name: 'mcp__spacecode-todo__create_todo',
        input: { title: 'Ship the CSV encoding fix', priority: 'high' },
        status: 'completed',
      },
    ])

    expect(wrapper.find('.timeline-tool-name').text()).toBe(enUS.todo.tools.create_todo)
    expect(wrapper.find('.timeline-target').text()).toBe('Ship the CSV encoding fix')
  })

  it('follows the active locale for todo tool labels', () => {
    const wrapper = mountTools([
      { id: 't', name: 'mcp__spacecode-todo__complete_todo', input: { id: 'abc' }, status: 'completed' },
    ], 'zh-CN')

    expect(wrapper.find('.timeline-tool-name').text()).toBe(zhCN.todo.tools.complete_todo)
    expect(wrapper.find('.timeline-target').text()).toBe('abc')
  })

  it('falls back to the group name for create_group and to no target when nothing identifying is passed', () => {
    const named = mountTools([
      { id: 'g', name: 'mcp__spacecode-todo__create_group', input: { name: '工作' }, status: 'completed' },
    ])
    expect(named.find('.timeline-tool-name').text()).toBe(enUS.todo.tools.create_group)
    expect(named.find('.timeline-target').text()).toBe('工作')

    const bare = mountTools([
      { id: 'l', name: 'mcp__spacecode-todo__list_todos', input: {}, status: 'completed' },
    ])
    expect(bare.find('.timeline-tool-name').text()).toBe(enUS.todo.tools.list_todos)
    expect(bare.find('.timeline-target').exists()).toBe(false)
  })

  it('leaves unknown todo-prefixed tools on the raw name path', () => {
    const wrapper = mountTools([
      { id: 'x', name: 'mcp__spacecode-todo__purge_everything', input: { title: 'nope' }, status: 'completed' },
    ])

    expect(wrapper.find('.timeline-tool-name').text()).toBe('mcp__spacecode-todo__purge_everything')
    expect(wrapper.find('.timeline-target').exists()).toBe(false)
  })
})

describe('AgentTimeline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function mountTimeline(toolCalls: ToolCall[]) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const i18n = createI18n({
      legacy: false,
      locale: 'en-US',
      messages: { 'en-US': enUS, 'zh-CN': zhCN },
    })

    return mount(AgentTimeline, {
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
        stubs: ['MarkdownRenderer', 'PermissionRequestCard', 'TurnSummaryBar'],
      },
    })
  }

  it('collapses a run of tool calls into a tool-chips group', async () => {
    const wrapper = mountTimeline([
      { id: 't1', name: 'Foo', input: { query: 'alpha' }, status: 'completed' },
      { id: 't2', name: 'Bar', input: { file_path: 'beta.ts' }, status: 'completed' },
    ])

    // 未在流式中且全部完成 → 默认折叠为摘要行
    const toggle = wrapper.find('.tool-group__toggle')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.tool-group__summary').exists()).toBe(true)
    expect(wrapper.text()).toContain('2 tool calls')

    // 点击展开 → 摘要隐藏，工具行出现
    await toggle.trigger('click')
    expect(wrapper.find('.tool-group__toggle--expanded').exists()).toBe(true)
    expect(wrapper.find('.tool-group__summary').exists()).toBe(false)
    expect(wrapper.find('.tool-group').findAll('.tool-row')).toHaveLength(2)
  })

  it('keeps a single generic tool as a standalone row without a group', () => {
    const wrapper = mountTimeline([
      { id: 't1', name: 'Foo', input: { query: 'alpha' }, status: 'completed' },
    ])

    expect(wrapper.find('.tool-group').exists()).toBe(false)
    expect(wrapper.findAll('.tool-row')).toHaveLength(1)
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
        stubs: ['MarkdownRenderer', 'PermissionRequestCard', 'TurnSummaryBar'],
      },
    })

    expect(wrapper.find('.task-list-card').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Implement the fix')
    expect(wrapper.text()).not.toContain('Run the tests')
    expect(wrapper.findAll('.tool-row')).toHaveLength(1)
  })
})
