import { createI18n } from 'vue-i18n'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TaskOutputToolCard from '@/components/chat/tools/TaskOutputToolCard.vue'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'
import type { ToolCall } from '@/types'

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': enUS, 'zh-CN': zhCN },
})

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tool-1',
    name: 'TaskOutput',
    input: { task_id: 'task_001', block: true, timeout: 30000 },
    status: 'completed',
    ...overrides,
  }
}

function mountCard(toolCall: ToolCall) {
  return mount(TaskOutputToolCard, {
    props: { toolCall },
    global: {
      plugins: [i18n],
      stubs: ['MarkdownRenderer'],
    },
  })
}

describe('TaskOutputToolCard', () => {
  it('renders collapsed header with task_id and label', () => {
    const wrapper = mountCard(makeToolCall())
    expect(wrapper.find('.tool-header').exists()).toBe(true)
    expect(wrapper.text()).toContain('Task Output')
    expect(wrapper.text()).toContain('task_001')
  })

  it('shows badge "Done" for completed local_bash task', () => {
    const output = [
      '<retrieval_status>success</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_bash</task_type>',
      '<status>completed</status>',
      '<exit_code>0</exit_code>',
      '<output>Build successful</output>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ output }))
    expect(wrapper.text()).toContain('Done')
  })

  it('shows badge "Failed" for error task', () => {
    const output = [
      '<retrieval_status>success</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_bash</task_type>',
      '<status>failed</status>',
      '<exit_code>1</exit_code>',
      '<error>Build failed</error>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ status: 'error', output }))
    expect(wrapper.text()).toContain('Failed')
  })

  it('shows badge "Timeout" when retrieval_status is timeout', () => {
    const output = [
      '<retrieval_status>timeout</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_bash</task_type>',
      '<status>running</status>',
      '<output>Partial output...</output>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ status: 'running', output }))
    expect(wrapper.text()).toContain('Timeout')
  })

  it('shows badge "Not Ready" when retrieval_status is not_ready', () => {
    const output = [
      '<retrieval_status>not_ready</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_agent</task_type>',
      '<status>running</status>',
      '<description>Running analysis</description>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ status: 'running', output }))
    expect(wrapper.text()).toContain('Not Ready')
  })

  it('renders terminal window when expanded for local_bash', async () => {
    const output = [
      '<retrieval_status>success</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_bash</task_type>',
      '<status>completed</status>',
      '<exit_code>0</exit_code>',
      '<output>Build successful</output>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ output }))
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.terminal-window').exists()).toBe(true)
    expect(wrapper.text()).toContain('Build successful')
  })

  it('renders agent prompt and result for local_agent', async () => {
    const output = [
      '<retrieval_status>success</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_agent</task_type>',
      '<status>completed</status>',
      '<prompt>Review the code</prompt>',
      '<result>Code looks good</result>',
      '<output>Code looks good</output>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ output }))
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.text()).toContain('Review the code')
    expect(wrapper.find('.agent-result-content').exists()).toBe(true)
  })

  it('renders waiting spinner for timeout status when expanded', async () => {
    const output = [
      '<retrieval_status>timeout</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_bash</task_type>',
      '<status>running</status>',
      '<output>Partial</output>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ status: 'running', output }))
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.waiting-spinner').exists()).toBe(true)
    expect(wrapper.text()).toContain('Task is still running')
  })

  it('renders no-task message when output is empty', async () => {
    const wrapper = mountCard(makeToolCall({ output: '' }))
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.no-task').exists()).toBe(true)
  })

  it('renders error block when error field is present', async () => {
    const output = [
      '<retrieval_status>success</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_bash</task_type>',
      '<status>failed</status>',
      '<exit_code>1</exit_code>',
      '<output>Some output</output>',
      '<error>Command not found</error>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ status: 'error', output }))
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.error-block').exists()).toBe(true)
    expect(wrapper.text()).toContain('Command not found')
  })

  it('renders input params section when expanded', async () => {
    const wrapper = mountCard(makeToolCall())
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.input-params').exists()).toBe(true)
    expect(wrapper.text()).toContain('task_001')
    expect(wrapper.text()).toContain('true')
    expect(wrapper.text()).toContain('30000ms')
  })

  it('renders meta bar with task type tag when expanded', async () => {
    const output = [
      '<retrieval_status>success</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_bash</task_type>',
      '<status>completed</status>',
      '<exit_code>0</exit_code>',
      '<output>OK</output>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ output }))
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.task-type-tag.type-bash').exists()).toBe(true)
    expect(wrapper.text()).toContain('local_bash')
  })

  it('toggles expansion on header click', async () => {
    const wrapper = mountCard(makeToolCall())
    expect(wrapper.find('.tool-body').exists()).toBe(false)
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.tool-body').exists()).toBe(true)
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.tool-body').exists()).toBe(false)
  })
})
