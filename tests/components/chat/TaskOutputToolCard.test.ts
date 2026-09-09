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
      stubs: {
        MarkdownRenderer: {
          props: { content: { type: String, default: '' } },
          template: '<div>{{ content }}</div>',
        },
      },
    },
  })
}

describe('TaskOutputToolCard', () => {
  it('renders collapsed header with Task Output label', () => {
    const wrapper = mountCard(makeToolCall())
    expect(wrapper.find('.tool-header').exists()).toBe(true)
    expect(wrapper.text()).toContain('Task Output')
  })

  it('shows task_type label (not raw hex task_id) in collapsed header when output is parsed', () => {
    const output = [
      '<retrieval_status>success</retrieval_status>',
      '<task_id>task_abc123def456789</task_id>',
      '<task_type>local_bash</task_type>',
      '<status>completed</status>',
      '<exit_code>0</exit_code>',
      '<output>Build successful</output>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ input: { task_id: 'task_abc123def456789', block: true, timeout: 30000 }, output }))
    const header = wrapper.find('.tool-header')
    expect(header.text()).toContain('Bash')
    // Raw hex task_id should NOT appear in collapsed header
    expect(header.text()).not.toContain('task_abc123def456789')
  })

  it('shows truncated task_id in collapsed header when no output parsed', () => {
    const longTaskId = 'task_0123456789abcdef0123456789abcdef'
    const wrapper = mountCard(makeToolCall({
      input: { task_id: longTaskId, block: true, timeout: 30000 },
    }))
    const header = wrapper.find('.tool-header')
    // Long ID should be truncated
    expect(header.text()).toContain('…')
    // Full ID should NOT be in header
    expect(header.text()).not.toContain(longTaskId)
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

  it('renders agent result from output field when prompt/result tags are absent', async () => {
    // Engine's mapToolResultToToolResultBlockParam does NOT include <prompt> or <result> tags.
    // The <output> field contains the agent's response text.
    const output = [
      '<retrieval_status>success</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_agent</task_type>',
      '<status>completed</status>',
      '<output>The agent analysis result text</output>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ output }))
    await wrapper.find('.tool-header').trigger('click')
    // Should render the output section (agent-result-content uses MarkdownRenderer stub)
    expect(wrapper.find('.agent-result-content').exists()).toBe(true)
    // The section header should be the agent result label
    expect(wrapper.text()).toContain('Sub-agent output')
  })

  it('renders waiting spinner and terminal output for timeout status when expanded', async () => {
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
    // waiting state should NOT short-circuit terminal output
    expect(wrapper.find('.terminal-window').exists()).toBe(true)
    expect(wrapper.text()).toContain('Partial')
  })

  it('renders waiting state and description for not_ready local_agent when expanded', async () => {
    const output = [
      '<retrieval_status>not_ready</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_agent</task_type>',
      '<status>running</status>',
      '<description>Running analysis</description>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ status: 'running', output }))
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.waiting-spinner').exists()).toBe(true)
    expect(wrapper.text()).toContain('Running analysis')
  })

  it('renders no-task message when output is empty', async () => {
    const wrapper = mountCard(makeToolCall({ output: '' }))
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.no-task').exists()).toBe(true)
  })

  it('renders raw output text when parsedTask is null but output has content (evicted task)', async () => {
    // When the task has been evicted, the engine returns an error message
    // (not XML format), so parsedTask will be null.
    const errorOutput = 'Error: No task found with ID: task_001. The task may have been evicted.'

    const wrapper = mountCard(makeToolCall({ status: 'error', output: errorOutput }))
    await wrapper.find('.tool-header').trigger('click')
    // Should show the raw error text, not "no task output available"
    expect(wrapper.find('.raw-output-text').exists()).toBe(true)
    expect(wrapper.text()).toContain('No task found with ID')
    // Should NOT show the "no task" message
    expect(wrapper.find('.no-task').exists()).toBe(false)
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

  it('shows full task_id in meta bar when expanded', async () => {
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
    // Full task_id should be visible in the expanded meta bar
    expect(wrapper.find('.task-meta-bar').text()).toContain('task_001')
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

  it('shows timeout icon class when retrieval_status is timeout', () => {
    const output = [
      '<retrieval_status>timeout</retrieval_status>',
      '<task_id>task_001</task_id>',
      '<task_type>local_bash</task_type>',
      '<status>running</status>',
      '<output>Partial</output>',
    ].join('\n\n')

    const wrapper = mountCard(makeToolCall({ status: 'running', output }))
    expect(wrapper.find('.tool-icon.status-timeout').exists()).toBe(true)
    expect(wrapper.find('.tool-icon.status-running').exists()).toBe(false)
  })

  it('hides input params section when no task_id or timeout in input', async () => {
    const wrapper = mountCard(makeToolCall({ input: { block: false } }))
    await wrapper.find('.tool-header').trigger('click')
    expect(wrapper.find('.input-params').exists()).toBe(false)
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
