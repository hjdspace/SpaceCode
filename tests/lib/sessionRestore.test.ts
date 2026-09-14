import { describe, expect, it } from 'vitest'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'

/**
 * 验证从 JSONL 历史重建消息时，技能/斜杠命令的用户消息气泡不被丢失。
 *
 * 引擎在处理技能调用时，将用户消息以 XML 标签格式写入 JSONL：
 *   <command-message>skill-name</command-message>
 *   <command-name>/skill-name</command-name>
 *   <command-args>user message</command-args>
 * 旧实现在 buildMessagesFromHistory 中将以 '<' 开头的用户消息全部跳过，
 * 导致重开 GUI 后带技能的消息气泡消失。修复后应提取命令名和参数，
 * 恢复为可读的 "/skill-name args" 格式。
 */
describe('buildMessagesFromHistory — skill/slash command message restoration', () => {
  it('restores user-invocable skill message as readable text', () => {
    const rawMessages = [
      {
        type: 'user',
        uuid: 'test-uuid-1',
        message: {
          role: 'user',
          content: `<command-message>grill-with-docs</command-message>
<command-name>/grill-with-docs</command-name>
<command-args>讨论会话编排功能</command-args>`,
        },
      },
      {
        type: 'assistant',
        uuid: 'test-uuid-2',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '好的，让我来帮你分析会话编排功能。' }],
        },
      },
    ]

    const messages = buildMessagesFromHistory(rawMessages)

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('/grill-with-docs 讨论会话编排功能')
  })

  it('restores skill with no args as just the command', () => {
    const rawMessages = [
      {
        type: 'user',
        uuid: 'test-uuid-3',
        message: {
          role: 'user',
          content: `<command-message>help</command-message>
<command-name>/help</command-name>`,
        },
      },
      {
        type: 'assistant',
        uuid: 'test-uuid-4',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is the help info.' }],
        },
      },
    ]

    const messages = buildMessagesFromHistory(rawMessages)

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('/help')
  })

  it('restores model-only skill with skill-format tag', () => {
    const rawMessages = [
      {
        type: 'user',
        uuid: 'test-uuid-5',
        message: {
          role: 'user',
          content: `<command-message>code-review</command-message>
<command-name>code-review</command-name>
<skill-format>true</skill-format>`,
        },
      },
      {
        type: 'assistant',
        uuid: 'test-uuid-6',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Running code review...' }],
        },
      },
    ]

    const messages = buildMessagesFromHistory(rawMessages)

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    // model-only skill 的 command-name 不含 / 前缀
    expect(messages[0].content).toBe('code-review')
    expect(messages[0].metadata?.kind).toBe('skill-invocation')
    expect(messages[0].metadata?.skillName).toBe('code-review')
  })

  it('still filters non-command XML messages (task-notification, bash-stdout, etc.)', () => {
    const rawMessages = [
      {
        type: 'user',
        uuid: 'test-uuid-7',
        message: {
          role: 'user',
          content: '<task-notification>Agent completed</task-notification>',
        },
      },
      {
        type: 'user',
        uuid: 'test-uuid-8',
        message: {
          role: 'user',
          content: '<bash-stdout>some output</bash-stdout>',
        },
      },
      {
        type: 'user',
        uuid: 'test-uuid-9',
        message: {
          role: 'user',
          content: '<local-command-stdout>Settings opened</local-command-stdout>',
        },
      },
      {
        type: 'user',
        uuid: 'test-uuid-10',
        message: {
          role: 'user',
          content: 'Hello, can you help me?',
        },
      },
      {
        type: 'assistant',
        uuid: 'test-uuid-11',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Sure!' }],
        },
      },
    ]

    const messages = buildMessagesFromHistory(rawMessages)

    // 只保留真正的用户消息和助手回复
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('Hello, can you help me?')
  })

  it('preserves normal (non-skill) user messages alongside skill messages', () => {
    const rawMessages = [
      {
        type: 'user',
        uuid: 'test-uuid-12',
        message: {
          role: 'user',
          content: `<command-message>commit</command-message>
<command-name>/commit</command-name>`,
        },
      },
      {
        type: 'assistant',
        uuid: 'test-uuid-13',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Committing...' }],
        },
      },
      {
        type: 'user',
        uuid: 'test-uuid-14',
        message: {
          role: 'user',
          content: 'Now push the changes',
        },
      },
      {
        type: 'assistant',
        uuid: 'test-uuid-15',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Pushing...' }],
        },
      },
    ]

    const messages = buildMessagesFromHistory(rawMessages)

    expect(messages).toHaveLength(4)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('/commit')
    expect(messages[1].role).toBe('assistant')
    expect(messages[2].role).toBe('user')
    expect(messages[2].content).toBe('Now push the changes')
  })
})
