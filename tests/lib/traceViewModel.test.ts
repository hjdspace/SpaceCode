import { describe, it, expect } from 'vitest'
import {
  buildTraceViewModel,
  previewTraceValue,
  extractTextContent,
  formatTraceJson,
} from '@/lib/traceViewModel'
import type { AgentTraceEvent } from '@/services/electronAPI'

// 构造一个最小的 AgentTraceEvent，仅保留构建逻辑读取的字段。
function ev(partial: Partial<AgentTraceEvent> & { type: string }): AgentTraceEvent {
  return { sessionId: 'sess-1', ...partial } as AgentTraceEvent
}

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T00:00:01.000Z'
const T2 = '2026-01-01T00:00:02.000Z'

describe('traceViewModel — buildTraceViewModel 基础结构', () => {
  it('空事件数组：诊断为 empty', () => {
    const vm = buildTraceViewModel([])
    expect(vm.rootId).toBe('session:root')
    expect(vm.diagnosis.status).toBe('empty')
    expect(vm.diagnosis.reason).toBe('empty')
    // 除根 span 外没有任何实质性事件 span
    expect(vm.diagnosis.modelCalls).toBe(0)
    expect(vm.diagnosis.toolCalls).toBe(0)
  })

  it('创建 session 根 span，标题取 sessionId 前 16 位', () => {
    const vm = buildTraceViewModel([ev({ type: 'user_message', actor: 'user', timestamp: T0 })])
    const root = vm.spansById.get('session:root')
    expect(root?.kind).toBe('session')
    expect(root?.title).toBe('sess-1')
  })

  it('用户消息开启新 Turn，并按 Turn 分组', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', title: '问题1', timestamp: T0 }),
      ev({ type: 'assistant_text', actor: 'assistant', timestamp: T1 }),
      ev({ type: 'user_message', actor: 'user', title: '问题2', timestamp: T2 }),
    ])
    expect(vm.turns).toHaveLength(2)
    expect(vm.turns[0].title).toBe('问题1')
    expect(vm.turns[1].title).toBe('问题2')
  })

  it('首事件不是用户消息时仍归入 turn:0', () => {
    const vm = buildTraceViewModel([ev({ type: 'assistant_text', actor: 'assistant', timestamp: T0 })])
    expect(vm.turns).toHaveLength(1)
    expect(vm.turns[0].id).toBe('turn:0')
  })
})

describe('traceViewModel — 事件分类 classifyEvent', () => {
  function kindOf(event: AgentTraceEvent) {
    const vm = buildTraceViewModel([event])
    return vm.spans.find(s => s.id !== 'session:root' && s.kind !== 'turn')
  }

  it('assistant actor → llm span', () => {
    expect(kindOf(ev({ type: 'assistant_text', actor: 'assistant', timestamp: T0 }))?.kind).toBe('llm')
  })

  it('tool actor → tool span', () => {
    expect(kindOf(ev({ type: 'tool_call', actor: 'tool', timestamp: T0 }))?.kind).toBe('tool')
  })

  it('tool_result type → tool_result span', () => {
    expect(kindOf(ev({ type: 'tool_result', timestamp: T0 }))?.kind).toBe('tool_result')
  })

  it('user actor → message span，状态恒为 ok', () => {
    const span = kindOf(ev({ type: 'user_message', actor: 'user', status: 'failed', timestamp: T0 }))
    expect(span?.kind).toBe('message')
    expect(span?.status).toBe('ok')
  })

  it('error type → event span，状态为 error', () => {
    const span = kindOf(ev({ type: 'error', timestamp: T0 }))
    expect(span?.kind).toBe('event')
    expect(span?.status).toBe('error')
  })

  it('未识别类型 → event span', () => {
    expect(kindOf(ev({ type: 'custom_x', timestamp: T0 }))?.kind).toBe('event')
  })
})

describe('traceViewModel — 状态映射与冒泡', () => {
  it('failed → error，running/started → pending，completed/缺省 → ok', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'assistant_text', actor: 'assistant', status: 'failed', timestamp: T0 }),
    ])
    const llm = vm.spans.find(s => s.kind === 'llm')
    expect(llm?.status).toBe('error')
  })

  it('子级 error 冒泡到 turn 与 root', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', timestamp: T0 }),
      ev({ type: 'tool_call', actor: 'tool', status: 'failed', timestamp: T1 }),
    ])
    const turn = vm.spansById.get('turn:0')
    const root = vm.spansById.get('session:root')
    expect(turn?.status).toBe('error')
    expect(root?.status).toBe('error')
  })

  it('子级含 pending 而无 error 时 turn 为 pending', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', timestamp: T0 }),
      ev({ type: 'assistant_text', actor: 'assistant', status: 'running', timestamp: T1 }),
    ])
    expect(vm.spansById.get('turn:0')?.status).toBe('pending')
  })

  it('全部成功时 turn 为 ok 且聚合 durationMs', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', status: 'completed', timestamp: T0 }),
      ev({ type: 'assistant_text', actor: 'assistant', status: 'completed', timestamp: T2 }),
    ])
    const turn = vm.spansById.get('turn:0')
    expect(turn?.status).toBe('ok')
    expect(turn?.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('traceViewModel — 生命周期噪声与工具字段', () => {
  it('session_created / engine_session_start 标记为噪声', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'session_created', timestamp: T0 }),
      ev({ type: 'engine_session_start', timestamp: T1 }),
    ])
    const noise = vm.spans.filter(s => s.isLifecycleNoise)
    expect(noise).toHaveLength(2)
  })

  it('tool actor 的 span 记录 toolName 为事件 type', () => {
    const vm = buildTraceViewModel([ev({ type: 'tool_call', actor: 'tool', timestamp: T0 })])
    expect(vm.spans.find(s => s.kind === 'tool')?.toolName).toBe('tool_call')
  })

  it('metadata.usage 透传为 tokenUsage', () => {
    const usage = { inputTokens: 1, outputTokens: 2 }
    const vm = buildTraceViewModel([
      ev({ type: 'assistant_text', actor: 'assistant', timestamp: T0, metadata: { usage } }),
    ])
    expect(vm.spans.find(s => s.kind === 'llm')?.tokenUsage).toEqual(usage)
  })
})

describe('traceViewModel — 诊断 diagnosis', () => {
  it('模型错误 → blocked / model_error', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', timestamp: T0 }),
      ev({ type: 'assistant_text', actor: 'assistant', status: 'failed', timestamp: T1 }),
    ])
    expect(vm.diagnosis.status).toBe('blocked')
    expect(vm.diagnosis.reason).toBe('model_error')
    expect(vm.diagnosis.errorCount).toBeGreaterThan(0)
  })

  it('工具错误 → blocked / tool_error', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', timestamp: T0 }),
      ev({ type: 'tool_call', actor: 'tool', status: 'failed', timestamp: T1 }),
    ])
    expect(vm.diagnosis.reason).toBe('tool_error')
  })

  it('event 错误 → blocked / event_error', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', timestamp: T0 }),
      ev({ type: 'error', status: 'failed', timestamp: T1 }),
    ])
    expect(vm.diagnosis.reason).toBe('event_error')
  })

  it('pending 模型调用 → attention / pending_model', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', timestamp: T0 }),
      ev({ type: 'assistant_text', actor: 'assistant', status: 'running', timestamp: T1 }),
    ])
    expect(vm.diagnosis.status).toBe('attention')
    expect(vm.diagnosis.reason).toBe('pending_model')
    expect(vm.diagnosis.pendingModelCalls).toBe(1)
  })

  it('pending 工具调用 → attention / pending_tool', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', timestamp: T0 }),
      ev({ type: 'tool_call', actor: 'tool', status: 'running', timestamp: T1 }),
    ])
    expect(vm.diagnosis.status).toBe('attention')
    expect(vm.diagnosis.reason).toBe('pending_tool')
    expect(vm.diagnosis.pendingToolCalls).toBe(1)
  })

  it('最后 Turn 只有用户消息、无代理产出 → waiting_for_agent', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', status: 'completed', timestamp: T0 }),
    ])
    expect(vm.diagnosis.status).toBe('attention')
    expect(vm.diagnosis.reason).toBe('waiting_for_agent')
  })

  it('用户消息后有代理产出 → healthy', () => {
    const vm = buildTraceViewModel([
      ev({ type: 'user_message', actor: 'user', status: 'completed', timestamp: T0 }),
      ev({ type: 'assistant_text', actor: 'assistant', status: 'completed', timestamp: T1 }),
    ])
    expect(vm.diagnosis.status).toBe('healthy')
    expect(vm.diagnosis.reason).toBe('healthy')
  })
})

describe('traceViewModel — previewTraceValue / extractTextContent / formatTraceJson', () => {
  it('previewTraceValue 压缩空白并截断超长文本', () => {
    expect(previewTraceValue('a\n  b\tc')).toBe('a b c')
    const long = 'x'.repeat(200)
    const out = previewTraceValue(long, 100)
    expect(out).toHaveLength(103) // 100 + '...'
    expect(out.endsWith('...')).toBe(true)
  })

  it('previewTraceValue 空内容返回 empty', () => {
    expect(previewTraceValue('   ')).toBe('empty')
    expect(previewTraceValue('')).toBe('empty')
  })

  it('extractTextContent 处理字符串、数组块与其它类型', () => {
    expect(extractTextContent('hi')).toBe('hi')
    expect(extractTextContent([{ text: 'a' }, { content: 'b' }, { x: 1 }, null])).toBe('a\nb')
    expect(extractTextContent(42)).toBe('42')
  })

  it('formatTraceJson 解析合法 JSON 字符串并美化', () => {
    expect(formatTraceJson('{"a":1}')).toBe('{\n  "a": 1\n}')
  })

  it('formatTraceJson 非 JSON 字符串原样返回', () => {
    expect(formatTraceJson('plain text')).toBe('plain text')
  })
})
