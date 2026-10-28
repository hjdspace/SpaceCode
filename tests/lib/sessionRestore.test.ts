import { describe, expect, it } from 'vitest'
import { buildMessagesFromHistory, parseSubagentTranscript } from '@/utils/sessionRestore'

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

describe('buildMessagesFromHistory — timestamp preservation', () => {
  it('carries the raw JSONL timestamp into restored messages', () => {
    const rawMessages = [
      {
        type: 'user',
        uuid: 'ts-user-1',
        timestamp: '2026-08-20T11:33:53.117Z',
        message: { role: 'user', content: '你好' },
      },
      {
        type: 'assistant',
        uuid: 'ts-assistant-1',
        timestamp: '2026-08-20T11:36:22.870Z',
        message: { role: 'assistant', content: [{ type: 'text', text: '回复' }] },
      },
    ]

    const messages = buildMessagesFromHistory(rawMessages)

    expect(messages).toHaveLength(2)
    expect(messages[0].timestamp).toBe(Date.parse('2026-08-20T11:33:53.117Z'))
    expect(messages[1].timestamp).toBe(Date.parse('2026-08-20T11:36:22.870Z'))
  })

  it('accepts numeric timestamps and falls back to now for unparseable ones', () => {
    const before = Date.now()
    const rawMessages = [
      {
        type: 'user',
        uuid: 'ts-num-1',
        timestamp: 123456789,
        message: { role: 'user', content: 'numeric' },
      },
      {
        type: 'user',
        uuid: 'ts-bad-1',
        timestamp: 'not-a-date',
        message: { role: 'user', content: 'bad' },
      },
      { type: 'user', uuid: 'ts-none-1', message: { role: 'user', content: 'none' } },
    ]

    const messages = buildMessagesFromHistory(rawMessages)
    const after = Date.now()

    expect(messages).toHaveLength(3)
    expect(messages[0].timestamp).toBe(123456789)
    expect(messages[1].timestamp).toBeGreaterThanOrEqual(before)
    expect(messages[1].timestamp).toBeLessThanOrEqual(after)
    expect(messages[2].timestamp).toBeGreaterThanOrEqual(before)
    expect(messages[2].timestamp).toBeLessThanOrEqual(after)
  })
})

describe('buildMessagesFromHistory — record filtering', () => {
  it('skips non-object and non-conversation records', () => {
    const messages = buildMessagesFromHistory([
      null,
      42,
      'string',
      { type: 'queue-operation', uuid: 'q1' },
      { type: 'file-history-snapshot', uuid: 'f1' },
      { type: 'permission-mode', uuid: 'p1' },
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'hello' },
      },
    ] as unknown as any[])

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('hello')
  })

  it('skips engine meta messages and transcript-only records', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'user',
        uuid: 'm1',
        isMeta: true,
        message: { role: 'user', content: 'Base directory for this skill: …' },
      },
      {
        type: 'assistant',
        uuid: 'm2',
        isVisibleInTranscriptOnly: true,
        message: { role: 'assistant', content: [{ type: 'text', text: 'invisible' }] },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'hello' },
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('hello')
  })

  it('drops placeholder / interrupted synthetic user messages', () => {
    const messages = buildMessagesFromHistory([
      { type: 'user', uuid: 'x1', message: { role: 'user', content: '[Request interrupted by user]' } },
      { type: 'user', uuid: 'x2', message: { role: 'user', content: '[Request interrupted by user for tool use]' } },
      { type: 'user', uuid: 'x3', message: { role: 'user', content: '(no content)' } },
      { type: 'user', uuid: 'x4', message: { role: 'user', content: 'real message' } },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('real message')
  })
})

describe('buildMessagesFromHistory — message id resolution', () => {
  it('prefers raw.uuid, falls back to message.id, then generates an id', () => {
    const messages = buildMessagesFromHistory([
      { type: 'user', uuid: 'from-uuid', message: { role: 'user', content: 'a' } },
      { type: 'user', message: { id: 'from-mid', content: 'b' } },
      { type: 'user', message: { content: 'c' } },
    ])

    expect(messages).toHaveLength(3)
    expect(messages[0].id).toBe('from-uuid')
    expect(messages[1].id).toBe('from-mid')
    expect(messages[2].id).toBeDefined()
    expect(messages[2].id).toHaveLength(36)
  })
})

describe('buildMessagesFromHistory — assistant tool_use + tool_result backfill', () => {
  it('backfills a completed tool call with output and endTime', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tc1', name: 'Bash', input: { command: 'ls' } }] },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'total 3', is_error: false }] },
      },
    ])

    // tool_result-only user messages are backfilled but not rendered as a bubble
    expect(messages).toHaveLength(1)
    expect(messages[0].toolCalls).toHaveLength(1)
    const toolCall = messages[0].toolCalls![0]
    expect(toolCall.id).toBe('tc1')
    expect(toolCall.name).toBe('Bash')
    expect(toolCall.input).toEqual({ command: 'ls' })
    expect(toolCall.status).toBe('completed')
    expect(toolCall.output).toBe('total 3')
    // startTime comes from the assistant record, endTime from the later tool_result record
    expect(toolCall.startTime).toBeDefined()
    expect(toolCall.endTime).toBeGreaterThanOrEqual(toolCall.startTime!)
  })

  it('replays a later <task-notification> onto the TaskOutput snapshot that preceded it', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'tc-out',
            name: 'TaskOutput',
            input: { task_id: 'af01ed6b30395409b', block: true, timeout: 120000 },
          }],
        },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tc-out',
            is_error: false,
            content: [
              '<retrieval_status>timeout</retrieval_status>',
              '<task_id>af01ed6b30395409b</task_id>',
              '<task_type>local_agent</task_type>',
              '<status>running</status>',
            ].join('\n\n'),
          }],
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        message: {
          role: 'user',
          content: '<task-notification>\n<task-id>af01ed6b30395409b</task-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>',
        },
      },
    ])

    const toolCall = messages[0].toolCalls![0]
    // 快照原样保留 —— 那是模型当时看到的内容
    expect(toolCall.output).toContain('<status>running</status>')
    // 后到的终态走旁挂字段，供卡片把徽章从"运行中"收敛成"已完成"
    expect(toolCall.taskFinalStatus).toBe('completed')
    // 通知本身依旧不渲染成用户气泡
    expect(messages).toHaveLength(1)
  })

  it('marks a failed tool call with error status', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tc2', name: 'Read', input: {} }] },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc2', content: 'ENOENT', is_error: true }] },
      },
    ])

    const failedCall = messages[0].toolCalls![0]
    expect(failedCall.status).toBe('error')
    expect(failedCall.output).toBe('ENOENT')
  })

  it('ignores tool_results with no matching tool_use id', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'x', is_error: false }] },
      },
    ])
    expect(messages).toHaveLength(0)
  })

  it('stringifies array tool_result content into newline-joined text', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tc3', name: 'Bash', input: {} }] },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tc3', content: [{ type: 'text', text: 'out1' }, 'raw', { code: 1 }], is_error: false }],
        },
      },
    ])

    const arrayResultCall = messages[0].toolCalls![0]
    expect(arrayResultCall.output).toBe('out1\nraw\n{"code":1}')
  })

  it('stringifies object tool_result content as JSON', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tc4', name: 'Bash', input: {} }] },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc4', content: { rows: [1, 2] }, is_error: false }] },
      },
    ])

    const objectResultCall = messages[0].toolCalls![0]
    expect(objectResultCall.output).toBe('{"rows":[1,2]}')
  })

  it('keeps a user message that carries both text and tool_result rendered as a bubble', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tc5', name: 'Bash', input: {} }] },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'task output below' }, { type: 'tool_result', tool_use_id: 'tc5', content: 'ok', is_error: false }],
        },
      },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toBe('task output below')
    expect(messages[0].toolCalls![0].output).toBe('ok')
  })
})

describe('buildMessagesFromHistory — thinking blocks', () => {
  it('restores reasoning timeline events and content', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Let me reason…' }, { type: 'text', text: 'Answer' }],
        },
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Answer')
    expect(messages[0].reasoning).toEqual({
      content: 'Let me reason…',
      startTime: messages[0].timestamp,
      endTime: messages[0].timestamp,
      isExpanded: false,
    })
    expect(messages[0].timelineEvents).toHaveLength(2)
    expect(messages[0].timelineEvents![0].type).toBe('reasoning')
    expect(messages[0].timelineEvents![0].content).toBe('Let me reason…')
    expect(messages[0].timelineEvents![1].type).toBe('text')
  })

  it('treats redacted_thinking blocks like thinking', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'redacted_thinking', text: '<redacted>' }] },
      },
    ])

    expect(messages[0].reasoning?.content).toBe('<redacted>')
    expect(messages[0].timelineEvents![0].type).toBe('reasoning')
  })

  it('skips empty thinking blocks', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Answer' }] },
      },
    ])

    expect(messages[0].reasoning).toBeUndefined()
    expect(messages[0].content).toBe('Answer')
    expect(messages[0].timelineEvents!.length).toBe(1)
  })

  it('handles string content as a single text block', () => {
    const messages = buildMessagesFromHistory([
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: 'plain text response' } },
    ])

    expect(messages[0].content).toBe('plain text response')
    expect(messages[0].timelineEvents).toHaveLength(1)
    expect(messages[0].timelineEvents![0].type).toBe('text')
  })

  it('skips assistant records with missing content but keeps present-but-empty arrays', () => {
    const messages = buildMessagesFromHistory([
      { type: 'assistant', uuid: 'a2', message: { role: 'assistant' } },
      { type: 'assistant', uuid: 'a3', message: undefined },
    ] as unknown as any[])

    expect(messages).toHaveLength(0)
  })

  it('does not emit a text timeline event for whitespace-only text blocks', () => {
    const messages = buildMessagesFromHistory([
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: '   ' }] } },
    ])

    expect(messages[0].content).toBe('   ')
    expect(messages[0].timelineEvents).toBeUndefined()
  })
})

describe('buildMessagesFromHistory — merging assistant records by message id', () => {
  it('merges text / reasoning / toolCalls split across records with the same message id', () => {
    const messages = buildMessagesFromHistory([
      { type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'T1' }] } },
      { type: 'assistant', uuid: 'a2', message: { id: 'm1', content: [{ type: 'text', text: 'Part 1' }] } },
      { type: 'assistant', uuid: 'a3', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tc1', name: 'Read', input: {} }] } },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe('m1')
    expect(messages[0].content).toBe('Part 1')
    expect(messages[0].reasoning?.content).toBe('T1')
    expect(messages[0].toolCalls).toHaveLength(1)
    expect(messages[0].timelineEvents).toHaveLength(3)
  })

  it('appends reasoning to an already-created reasoning block', () => {
    const messages = buildMessagesFromHistory([
      { type: 'assistant', uuid: 'a1', message: { id: 'm2', content: [{ type: 'thinking', thinking: 'T1' }] } },
      { type: 'assistant', uuid: 'a2', message: { id: 'm2', content: [{ type: 'thinking', thinking: 'T2' }] } },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].reasoning?.content).toBe('T1T2')
  })

  it('keeps distinct message ids as separate messages', () => {
    const messages = buildMessagesFromHistory([
      { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'first' }] } },
      { type: 'assistant', uuid: 'a2', message: { content: [{ type: 'text', text: 'second' }] } },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('first')
    expect(messages[1].content).toBe('second')
  })

  it('captures model and token usage metadata', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 10,
          },
          content: [{ type: 'text', text: 'hi' }],
        },
      },
    ])

    expect(messages[0].metadata).toEqual({
      model: 'claude-opus-4-7',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 30,
      cacheCreationInputTokens: 10,
    })
  })
})

describe('buildMessagesFromHistory — API error filtering and auto-retry dedup', () => {
  it('skips assistant records flagged isApiErrorMessage', () => {
    const messages = buildMessagesFromHistory([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } },
      {
        type: 'assistant',
        uuid: 'a1',
        isApiErrorMessage: true,
        message: { role: 'assistant', content: [{ type: 'text', text: 'API Error: 429 rate limit exceeded' }] },
      },
      { type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'real reply' }] } },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[1].content).toBe('real reply')
  })

  it('detects API errors from string content', () => {
    const messages = buildMessagesFromHistory([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: 'API Error: 429 rate limit' } },
      { type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    ])

    expect(messages).toHaveLength(2)
  })

  it('treats an API Error text prefixed assistant as a real message when tool_use is present', () => {
    const messages = buildMessagesFromHistory([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'API Error: note' }, { type: 'tool_use', id: 'tc9', name: 'Bash', input: {} }],
        },
      },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[1].toolCalls).toHaveLength(1)
    expect(messages[1].content).toBe('API Error: note')
  })

  it('dedupes a retried user message when no real assistant reply came', () => {
    const messages = buildMessagesFromHistory([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } },
      { type: 'user', uuid: 'u2', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].content).toBe('hi')
  })

  it('dedupes a retried user message that follows an API error', () => {
    const messages = buildMessagesFromHistory([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } },
      {
        type: 'assistant',
        uuid: 'a1',
        isApiErrorMessage: true,
        message: { role: 'assistant', content: [{ type: 'text', text: 'API Error: 429 rate limit' }] },
      },
      { type: 'user', uuid: 'u2', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    ])

    expect(messages).toHaveLength(2)
  })

  it('keeps an identical user message repeated after a real assistant reply', () => {
    const messages = buildMessagesFromHistory([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
      { type: 'user', uuid: 'u2', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'again' }] } },
    ])

    expect(messages).toHaveLength(4)
    expect(messages[2].role).toBe('user')
    expect(messages[2].content).toBe('hello')
  })
})

describe('buildMessagesFromHistory — user attachments', () => {
  it('restores image and file attachments with defaults', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'see this' },
        attachments: [
          { type: 'image', data: 'data:image/png;base64,xxx' },
          { type: 'image', mimeType: 'image/jpeg', name: 'shot.jpg', data: 'data:image/jpeg;base64,yyy', id: 'img-1', previewUrl: 'pv://1' },
          { name: 'a.txt', path: '/x/a.txt' },
          { isFolder: true, name: 'dir' },
          { type: 'bogus' },
        ],
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].imageAttachments).toHaveLength(2)
    expect(messages[0].imageAttachments![0]).toMatchObject({ name: 'image', type: 'image', mimeType: 'image/png', previewUrl: '' })
    expect(messages[0].imageAttachments![0].id).toHaveLength(36)
    expect(messages[0].imageAttachments![1].id).toBe('img-1')
    expect(messages[0].imageAttachments![1].name).toBe('shot.jpg')
    expect(messages[0].imageAttachments![1].previewUrl).toBe('pv://1')
    expect(messages[0].attachments).toHaveLength(2)
    expect(messages[0].attachments![0]).toEqual({ name: 'a.txt', path: '/x/a.txt', isFolder: false })
    expect(messages[0].attachments![1]).toEqual({ name: 'dir', path: '', isFolder: true })
  })

  it('renders an image-only user message as [image]', () => {
    const messages = buildMessagesFromHistory([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'image', data: 'data:image/png;base64,zzz' }] } },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('[image]')
  })
})

describe('buildMessagesFromHistory — 引擎正文里的附件信封', () => {
  const pastePath = 'C:\\Users\\me\\AppData\\Local\\Temp\\SpaceCode\\pasted\\pasted-1234.txt'

  it('剥掉 @"路径" 与 Attachments 块，并把引用还原成粘贴附件卡片', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: `@"${pastePath}" 这个是什么场景\n\nAttachments: [File: pasted-1234.txt]`,
        },
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('这个是什么场景')
    expect(messages[0].attachments).toEqual([
      { name: 'pasted-1234.txt', path: pastePath, isFolder: false, source: 'paste' },
    ])
  })

  it('上传文件引用还原为 upload 卡片，Images 说明块一并剥掉', () => {
    const uploadPath = 'D:\\docs\\spec.md'
    const messages = buildMessagesFromHistory([
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: `@"${uploadPath}" 看看这个\n\nAttachments: [File: spec.md]\n\nImages: [Image: shot.png]`,
        },
      },
    ])

    expect(messages[0].content).toBe('看看这个')
    expect(messages[0].attachments).toEqual([
      { name: 'spec.md', path: uploadPath, isFolder: false, source: 'upload' },
    ])
  })

  it('只有附件没有正文的消息也保留，正文为空、卡片仍在', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: `@"${pastePath}"\n\nAttachments: [File: pasted-1234.txt]`,
        },
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('')
    expect(messages[0].attachments).toHaveLength(1)
  })
})

describe('buildMessagesFromHistory — teammate (sidechain) messages', () => {
  it('restores a completed teammate message as a system message', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'teammate',
        uuid: 't1',
        message: { role: 'user', content: 'I finished the research' },
        agentName: 'research',
        status: 'completed',
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toBe('[research] I finished the research')
    expect(messages[0].metadata).toMatchObject({ kind: 'teammate-message', agentName: 'research', agentTaskId: 'research' })
    expect(messages[0].metadata?.status).toBe('completed')
  })

  it('joins array content and classifies failed / running statuses', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'teammate',
        uuid: 't1',
        message: { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
        taskId: 'TASK-9',
        status: 'rejected',
      },
      {
        type: 'teammate',
        uuid: 't2',
        message: { role: 'user', content: 'queued' },
        agentName: 'coder',
      },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('[teammate] a\nb')
    expect(messages[0].metadata?.agentTaskId).toBe('task-9')
    expect(messages[0].metadata?.status).toBe('failed')
    expect(messages[0].metadata?.teamName).toBe('Agent Team')
    expect(messages[1].metadata?.status).toBe('running')
    expect(messages[1].metadata?.agentTaskId).toBe('coder')
  })

  it('skips teammate messages with only whitespace text', () => {
    const messages = buildMessagesFromHistory([
      { type: 'teammate', uuid: 't1', message: { role: 'user', content: '   ' } },
      { type: 'teammate', uuid: 't2', message: { role: 'user', content: [] } },
    ])

    expect(messages).toHaveLength(0)
  })

  it('renders sidechain user records as teammate system messages in the main timeline', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'user',
        uuid: 's1',
        isSidechain: true,
        message: { role: 'user', content: 'sub task prompt' },
        agentName: 'sub',
        status: 'success',
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toBe('[sub] sub task prompt')
    expect(messages[0].metadata?.status).toBe('completed')
  })
})

describe('buildMessagesFromHistory — subagent mode', () => {
  it('includes sidechain records and marks tool_use as running', () => {
    const messages = buildMessagesFromHistory(
      [
        { type: 'user', uuid: 's1', isSidechain: true, message: { role: 'user', content: 'prompt' } },
        {
          type: 'assistant',
          uuid: 's2',
          isSidechain: true,
          message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tc-a', name: 'Read', input: {} }] },
        },
        { type: 'assistant', uuid: 's3', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
      ],
      { subagentMode: true },
    )

    expect(messages).toHaveLength(3)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('prompt')
    const runningCall = messages[1].toolCalls![0]
    expect(runningCall.status).toBe('running')
    expect(runningCall.endTime).toBeUndefined()
    expect(messages[2].content).toBe('done')
  })
})

describe('buildMessagesFromHistory — skill command reconstruction', () => {
  it('reconstructs a command from command-message alone, prefixing with /', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: '<command-message>cite</command-message>' },
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('/cite')
  })

  it('strips leading system-reminder blocks before XML detection', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content:
            '<system-reminder>Context note</system-reminder>\n<command-name>/docs</command-name>\n<command-args>how do I test</command-args>',
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        message: { role: 'user', content: 'normal hello' },
      },
    ])

    expect(messages[0].content).toBe('/docs how do I test')
    expect(messages[1].content).toBe('normal hello')
  })
})

describe('parseSubagentTranscript', () => {
  it('returns an empty array for empty or invalid content', () => {
    expect(parseSubagentTranscript('')).toEqual([])
    expect(parseSubagentTranscript('not json\nstill not json')).toEqual([])
  })

  it('skips malformed JSON lines and parses valid ones', () => {
    const messages = parseSubagentTranscript(
      [
        '{ broken json',
        '{"type":"user","uuid":"u1","message":{"content":"prompt"}}',
        '{"type":"assistant","uuid":"a1","message":{"content":[{"type":"text","text":"reply"}]}}',
      ].join('\n'),
    )

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('prompt')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('reply')
  })

  it('keeps only the last subagent run when a prompt uuid repeats', () => {
    const transcript = [
      '{"type":"user","uuid":"p1","message":{"content":"task A"}}',
      '{"type":"assistant","message":{"content":"resp 1"}}',
      '{"type":"user","uuid":"p1","message":{"content":"task A"}}',
      '{"type":"assistant","message":{"content":"resp 2"}}',
    ].join('\n')

    const messages = parseSubagentTranscript(transcript)

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('task A')
    expect(messages[1].content).toBe('resp 2')
  })

  it('does not treat tool_result-only user records as run boundaries', () => {
    const transcript = [
      '{"type":"user","uuid":"p1","message":{"content":"task B"}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}',
      '{"type":"user","uuid":"tr1","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}',
      '{"type":"assistant","message":{"content":"resp B"}}',
      '{"type":"user","uuid":"p1","message":{"content":"task B"}}',
      '{"type":"assistant","message":{"content":"resp B2"}}',
    ].join('\n')

    const messages = parseSubagentTranscript(transcript)

    // last run starts at the second p1 → only its own records remain
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('task B')
    expect(messages[1].content).toBe('resp B2')
  })
})
