import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Message, Session, ToolCall } from '@/types'

const apiMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  claudeCode: { resolveAgentTranscriptPath: vi.fn(), findAgentTranscriptByToolUse: vi.fn() },
}))
const parseTranscriptMock = vi.hoisted(() => vi.fn())
const syncTaskMock = vi.hoisted(() => vi.fn())
const taskManagerStub = vi.hoisted(() => ({ stub: true }))

vi.mock('@/services/electronAPI', () => ({ api: apiMock }))
vi.mock('@/utils/sessionRestore', () => ({ parseSubagentTranscript: parseTranscriptMock }))
vi.mock('@/utils/taskToolSync', () => ({ syncTaskStateFromToolCall: syncTaskMock }))
vi.mock('@/composables/useTaskManager', () => ({ useTaskManager: () => taskManagerStub }))

import {
  AGENT_COLORS,
  stableTeammateId,
  getRawTeammateName,
  getRawTeamName,
  isTeammateRawMessage,
  isSidechainMessage,
  normalizeTeammateId,
  registerTeammateForToolUse,
  teammateIdForParentToolUse,
  clearSessionToolUseMappings,
  resolveTeammateId,
  inferTeammateStatus,
  stringifyRawContent,
  parseAgentToolOutput,
  stripAgentResultMetadata,
  isAgentLaunchResult,
  extractAgentDisplayText,
  getAgentOutputSummary,
  formatToolCallSummary,
  ensureTeamContext,
  ensureSubagentTranscripts,
  recordAgentToolCall,
  isFileBackedTeammate,
  rekickAgentTranscriptPoll,
} from '../teamTranscriptService'

// ── Fixtures ───────────────────────────────────────────────────────

type Raw = Record<string, unknown>

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    messages: [],
    workingDirectory: '/work/proj',
    ...overrides,
  } as unknown as Session
}

function agentToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: 'toolu-1', name: 'Agent', input: {}, status: 'running', ...overrides } as ToolCall
}

function msg(m: Partial<Message>): Message {
  return { id: 'm1', role: 'assistant', content: '', timestamp: 1, ...m } as Message
}

// 每次跑完把模块级 Map/Set 清空，避免用例间串味。
function resetSessionMappings(sessionId: string): void {
  clearSessionToolUseMappings(sessionId)
}

// ── Tests ──────────────────────────────────────────────────────────

describe('teamTranscriptService', () => {
  beforeEach(() => {
    apiMock.readFile.mockReset()
    apiMock.claudeCode.resolveAgentTranscriptPath.mockReset()
    apiMock.claudeCode.findAgentTranscriptByToolUse.mockReset()
    parseTranscriptMock.mockReset()
    syncTaskMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('AGENT_COLORS', () => {
    it('提供 8 种配色供 teammate 轮转', () => {
      expect(AGENT_COLORS).toHaveLength(8)
      expect(new Set(AGENT_COLORS).size).toBe(8)
    })
  })

  describe('stableTeammateId', () => {
    it('按 agentTaskId > taskId > agentId > agentName > subagent_type > name 取第一个非空值', () => {
      expect(stableTeammateId({ agentTaskId: 'A1', taskId: 'B', agentId: 'C' } as Raw)).toBe('a1')
      expect(stableTeammateId({ taskId: 'B', agentId: 'C' } as Raw)).toBe('b')
      expect(stableTeammateId({ agentId: 'C', agentName: 'D' } as Raw)).toBe('c')
      expect(stableTeammateId({ agentName: 'D', subagent_type: 'E' } as Raw)).toBe('d')
      expect(stableTeammateId({ subagent_type: 'E', name: 'F' } as Raw)).toBe('e')
      expect(stableTeammateId({ name: 'F' } as Raw)).toBe('f')
    })

    it('全为空时回退 teammate', () => {
      expect(stableTeammateId({} as Raw)).toBe('teammate')
      expect(stableTeammateId(null as unknown as Raw)).toBe('teammate')
    })

    it('小写化并把非法字符折叠成 -（首尾非法字符也留下一个 -）', () => {
      expect(stableTeammateId({ agentId: '  Agent One!!  ' } as Raw)).toBe('agent-one-')
      expect(stableTeammateId({ agentId: 'a_b-c9' } as Raw)).toBe('a_b-c9')
    })

    it('整串都是非法字符时留下单个 -，仅空白时归零后回退 teammate', () => {
      expect(stableTeammateId({ agentId: '！！' } as Raw)).toBe('-')
      expect(stableTeammateId({ agentId: '   ' } as Raw)).toBe('teammate')
    })
  })

  describe('名称与团队名读取', () => {
    it('getRawTeammateName 按 agentName > name > subagent_type > agentType 回退', () => {
      expect(getRawTeammateName({ agentName: 'a', name: 'n' } as Raw)).toBe('a')
      expect(getRawTeammateName({ name: 'n', subagent_type: 's' } as Raw)).toBe('n')
      expect(getRawTeammateName({ subagent_type: 's', agentType: 't' } as Raw)).toBe('s')
      expect(getRawTeammateName({ agentType: 't' } as Raw)).toBe('t')
      expect(getRawTeammateName({} as Raw)).toBe('teammate')
    })

    it('getRawTeamName 按 teamName > team_name > team 回退，默认 Agent Team', () => {
      expect(getRawTeamName({ teamName: 'a', team_name: 'b' } as Raw)).toBe('a')
      expect(getRawTeamName({ team_name: 'b', team: 'c' } as Raw)).toBe('b')
      expect(getRawTeamName({ team: 'c' } as Raw)).toBe('c')
      expect(getRawTeamName({} as Raw)).toBe('Agent Team')
    })
  })

  describe('teammate 与 sidechain 判定', () => {
    it('只有 type=teammate 或带 team 字段的消息算 teammate', () => {
      expect(isTeammateRawMessage({ type: 'teammate' } as Raw)).toBe(true)
      expect(isTeammateRawMessage({ teamName: 'T' } as Raw)).toBe(true)
      expect(isTeammateRawMessage({ team_name: 'T' } as Raw)).toBe(true)
      expect(isTeammateRawMessage({ team: 'T' } as Raw)).toBe(true)
      expect(isTeammateRawMessage({ type: 'assistant' } as Raw)).toBe(false)
      expect(isTeammateRawMessage(null as unknown as Raw)).toBe(false)
      expect(isTeammateRawMessage('str' as unknown as Raw)).toBe(false)
    })

    it('isSidechainMessage 认五个标志位之一', () => {
      for (const key of ['isSidechain', 'parent_tool_use_id', 'parentToolUseId', 'subagent_type', 'agentName']) {
        expect(isSidechainMessage({ [key]: 'x' })).toBe(true)
      }
      expect(isSidechainMessage({ type: 'user' })).toBe(false)
      expect(isSidechainMessage(null)).toBe(false)
      expect(isSidechainMessage('str')).toBe(false)
    })
  })

  describe('normalizeTeammateId', () => {
    it('数字转字符串、大小写与非法字符归一', () => {
      expect(normalizeTeammateId(' A B ')).toBe('a-b')
      expect(normalizeTeammateId(42)).toBe('42')
    })

    it('null / undefined / 空串都回退 teammate', () => {
      expect(normalizeTeammateId(null)).toBe('teammate')
      expect(normalizeTeammateId(undefined)).toBe('teammate')
      expect(normalizeTeammateId('')).toBe('teammate')
    })
  })

  describe('parent tool use 映射表', () => {
    it('空 toolUseId 不注册；空 parentToolUseId 查不到', () => {
      registerTeammateForToolUse('s', '', 'tm')
      expect(teammateIdForParentToolUse('s', '')).toBeUndefined()
      expect(teammateIdForParentToolUse('s', 'unknown')).toBeUndefined()
    })

    it('注册后可按会话隔离查询', () => {
      registerTeammateForToolUse('sA', 't1', 'tmA')
      expect(teammateIdForParentToolUse('sA', 't1')).toBe('tmA')
      expect(teammateIdForParentToolUse('sB', 't1')).toBeUndefined()
    })

    it('clearSessionToolUseMappings 只清本会话，空 sessionId 不动', () => {
      registerTeammateForToolUse('sA', 't1', 'tmA')
      registerTeammateForToolUse('sB', 't2', 'tmB')
      clearSessionToolUseMappings('')
      expect(teammateIdForParentToolUse('sA', 't1')).toBe('tmA')
      clearSessionToolUseMappings('sA')
      expect(teammateIdForParentToolUse('sA', 't1')).toBeUndefined()
      expect(teammateIdForParentToolUse('sB', 't2')).toBe('tmB')
    })
  })

  describe('resolveTeammateId', () => {
    it('优先用映射表归并实时子代理消息', () => {
      registerTeammateForToolUse('sA', 'toolu-9', 'canonical')
      expect(resolveTeammateId('sA', { parent_tool_use_id: 'toolu-9', agentId: 'ignored' } as Raw)).toBe('canonical')
      expect(resolveTeammateId('sA', { parentToolUseId: 'toolu-9' } as Raw)).toBe('canonical')
    })

    it('映射缺失时回退为归一化的 parentToolUseId（与工具卡片同 id）', () => {
      expect(resolveTeammateId('sZ', { parent_tool_use_id: 'Toolu-9' } as Raw)).toBe('toolu-9')
    })

    it('无 parent 时用 stableTeammateId', () => {
      expect(resolveTeammateId('sZ', { agentId: 'A1' } as Raw)).toBe('a1')
    })
  })

  describe('inferTeammateStatus', () => {
    it('status/state/event/subtype 关键词决定终态', () => {
      for (const v of ['Failed', 'some error here', 'rejected', 'cancelled']) {
        expect(inferTeammateStatus({ status: v } as Raw)).toBe('failed')
      }
      for (const v of ['completed', 'DONE', 'finished', 'success', 'result']) {
        expect(inferTeammateStatus({ state: v } as Raw)).toBe('completed')
      }
      for (const v of ['idle', 'waiting']) {
        expect(inferTeammateStatus({ event: v } as Raw)).toBe('idle')
      }
      expect(inferTeammateStatus({ subtype: 'failed' } as Raw)).toBe('failed')
    })

    it('按 status > state > event > subtype 的字段顺序取第一个非空值', () => {
      expect(inferTeammateStatus({ status: 'completed', state: 'failed' } as Raw)).toBe('completed')
      expect(inferTeammateStatus({ status: '', state: 'idle', event: 'done' } as Raw)).toBe('idle')
      expect(inferTeammateStatus({ event: 'failed', subtype: 'done' } as Raw)).toBe('failed')
    })

    it('同一字段内关键词按失败 > 完成 > 空闲匹配', () => {
      expect(inferTeammateStatus({ status: 'completed but error' } as Raw)).toBe('failed')
      expect(inferTeammateStatus({ status: 'idle, then done' } as Raw)).toBe('completed')
    })

    it('idle_notification JSON 正文区分 idle 与 failed', () => {
      expect(inferTeammateStatus({ message: { content: [{ type: 'text', text: '{"type":"idle_notification"}' }] } } as Raw)).toBe('idle')
      expect(inferTeammateStatus({ message: { content: [{ type: 'text', text: '{"type":"idle_notification","idleReason":"failed"}' }] } } as Raw)).toBe('failed')
    })

    it('普通文本正文算运行中', () => {
      expect(inferTeammateStatus({ message: { content: 'working on it' } } as Raw)).toBe('running')
      expect(inferTeammateStatus({} as Raw)).toBe('running')
    })

    it('非 idle_notification 的 JSON 正文不误判为空闲', () => {
      expect(inferTeammateStatus({ message: { content: '{"type":"other"}' } } as Raw)).toBe('running')
    })
  })

  describe('stringifyRawContent', () => {
    it('null 输入返回空串', () => {
      expect(stringifyRawContent(null as unknown as Raw)).toBe('')
    })

    it('message 是被二次序列化的 JSON 字符串时先解析', () => {
      const raw = { message: JSON.stringify({ content: 'inner text' }) } as Raw
      expect(stringifyRawContent(raw)).toBe('inner text')
    })

    it('content 是 JSON 数组字符串时抽出文本块', () => {
      const raw = { content: JSON.stringify([{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }]) } as Raw
      expect(stringifyRawContent(raw)).toBe('a\nb')
    })

    it('content 是普通字符串时原样返回', () => {
      expect(stringifyRawContent({ content: 'plain {not json' } as Raw)).toBe('plain {not json')
    })

    it('content 为数组时按文本块拼接，忽略非文本块', () => {
      const raw = { content: ['str part', { type: 'text', text: 'text part' }, { type: 'other', text: 'fallback' }, { type: 'tool_use' }] } as Raw
      expect(stringifyRawContent(raw)).toBe('str part\ntext part\nfallback')
    })

    it('content 缺失时按 content > text > output > result 取值', () => {
      expect(stringifyRawContent({ text: 'from text' } as Raw)).toBe('from text')
      expect(stringifyRawContent({ output: 'from output' } as Raw)).toBe('from output')
      expect(stringifyRawContent({ result: 'from result' } as Raw)).toBe('from result')
      expect(stringifyRawContent({} as Raw)).toBe('')
    })

    it('content 是对象时优先 text / result / 嵌套 content 数组', () => {
      expect(stringifyRawContent({ content: { text: 'obj text' } } as Raw)).toBe('obj text')
      expect(stringifyRawContent({ content: { result: 'obj result' } } as Raw)).toBe('obj result')
      expect(stringifyRawContent({ content: { content: [{ type: 'text', text: 'nested' }] } } as Raw)).toBe('nested')
    })

    it('普通对象回退 JSON.stringify，循环引用回退 String()', () => {
      expect(stringifyRawContent({ content: { a: 1 } } as Raw)).toBe('{"a":1}')
      const circular: Record<string, unknown> = { b: 2 }
      circular.self = circular
      expect(stringifyRawContent({ content: circular } as Raw)).toBe('[object Object]')
    })

    it('message 为非 JSON 字符串时继续按 raw 字段取值', () => {
      expect(stringifyRawContent({ message: 'not json', text: 't' } as Raw)).toBe('t')
    })
  })

  describe('parseAgentToolOutput', () => {
    it('JSON 数组输出拼接文本块', () => {
      expect(parseAgentToolOutput(JSON.stringify([{ text: 'x' }, 'y'])).displayText).toBe('x\ny')
    })

    it('JSON 对象带 text 时直接取 text', () => {
      expect(parseAgentToolOutput(JSON.stringify({ text: 'hello' }))).toEqual({ displayText: 'hello', outputFile: undefined, agentId: undefined })
    })

    it('引擎内部消息格式走 stringifyRawContent', () => {
      const out = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'deep' }] } })
      expect(parseAgentToolOutput(out).displayText).toBe('deep')
    })

    it('抽不出文本时回退原始输出', () => {
      const out = JSON.stringify({ type: 'assistant' })
      expect(parseAgentToolOutput(out).displayText).toBe(out)
    })

    it('识别 agentId 与 output_file 并重排 displayText', () => {
      const out = JSON.stringify({ text: 'Spawned ok\nagentId: ag-77 output_file: /tmp/x.output' })
      const result = parseAgentToolOutput(out)
      expect(result.agentId).toBe('ag-77')
      expect(result.outputFile).toBe('/tmp/x.output')
      expect(result.displayText).toBe('Agent launched successfully.\n\nAgent ID: ag-77\nOutput file: /tmp/x.output')
    })

    it('只有 agentId 时不输出 Output file 行', () => {
      const out = JSON.stringify({ text: 'agentId: ag-77 tail' })
      expect(parseAgentToolOutput(out).displayText).toBe('Agent launched successfully.\n\nAgent ID: ag-77')
    })

    it('非 JSON 输出走 catch 分支：保留原文并仍能抽 id', () => {
      const out = 'raw text\nagentId: ag-1\noutput_file: /tmp/a'
      expect(parseAgentToolOutput(out)).toEqual({ displayText: out, agentId: 'ag-1', outputFile: '/tmp/a' })
    })
  })

  describe('stripAgentResultMetadata', () => {
    it('剥掉 agentId 行、usage 块与 token 统计行', () => {
      const text = [
        'agentId: abc123',
        'real content here',
        '<usage>',
        '  <total_tokens>42</total_tokens>',
        '</usage>',
        'total_tokens: 42',
        'tool_uses: 3',
        'duration_ms: 1500',
      ].join('\n')
      expect(stripAgentResultMetadata(text)).toBe('real content here')
    })

    it('折叠三行以上空行为一行空行并 trim', () => {
      expect(stripAgentResultMetadata('a\n\n\n\nb\n\n\n')).toBe('a\n\nb')
    })
  })

  describe('isAgentLaunchResult', () => {
    it('五种启动占位文案都识别', () => {
      for (const text of [
        'Agent launched successfully. ...',
        'Async agent launched successfully. ...',
        'Spawned successfully. ...',
        'Remote agent launched in CCR. ...',
      ]) {
        expect(isAgentLaunchResult(text)).toBe(true)
      }
    })

    it('含后台运行提示语也算启动结果', () => {
      expect(isAgentLaunchResult('blah The agent is now running and will receive instructions via mailbox.')).toBe(true)
      expect(isAgentLaunchResult('blah The agent is working in the background. You will be notified automatically when it completes.')).toBe(true)
      expect(isAgentLaunchResult('blah The agent is running remotely. You will be notified automatically when it completes.')).toBe(true)
    })

    it('非字符串、空串、普通结果都返回 false', () => {
      expect(isAgentLaunchResult('real answer')).toBe(false)
      expect(isAgentLaunchResult('')).toBe(false)
      expect(isAgentLaunchResult('   ')).toBe(false)
      expect(isAgentLaunchResult({ text: 'Agent launched successfully.' })).toBe(false)
      expect(isAgentLaunchResult(null)).toBe(false)
    })
  })

  describe('extractAgentDisplayText', () => {
    it('假值返回空串', () => {
      expect(extractAgentDisplayText('')).toBe('')
      expect(extractAgentDisplayText(null)).toBe('')
    })

    it('字符串去元数据', () => {
      expect(extractAgentDisplayText('agentId: a1\nbody')).toBe('body')
    })

    it('对象先抽文本再去元数据', () => {
      expect(extractAgentDisplayText({ content: 'agentId: a1\nbody' })).toBe('body')
    })
  })

  describe('getAgentOutputSummary', () => {
    it('折叠行尾空白，空文本返回空串', () => {
      expect(getAgentOutputSummary('   \n \n')).toBe('')
      expect(getAgentOutputSummary('a   \nb')).toBe('a   \nb'.replace('   \n', '\n'))
    })

    it('超过 220 字符截断并加省略号', () => {
      const long = 'x'.repeat(230)
      expect(getAgentOutputSummary(long)).toBe(`${'x'.repeat(220)}...`)
      expect(getAgentOutputSummary('short')).toBe('short')
    })
  })

  describe('formatToolCallSummary', () => {
    it('各工具挑对应的详情字段', () => {
      expect(formatToolCallSummary({ name: 'Bash', input: { command: 'npm test' }, status: 'running' })).toBe('Bash · npm test • running')
      for (const name of ['Read', 'FileRead', 'Write', 'FileWrite', 'Edit', 'FileEdit']) {
        expect(formatToolCallSummary({ name, input: { file_path: 'src/deep/a.ts' }, status: 'completed' })).toBe(`${name} · a.ts • done`)
      }
      expect(formatToolCallSummary({ name: 'Glob', input: { pattern: '**/*.ts' }, status: 'completed' })).toBe('Glob · **/*.ts • done')
      expect(formatToolCallSummary({ name: 'Grep', input: { pattern: 'foo' }, status: 'error' })).toBe('Grep · foo • failed')
      expect(formatToolCallSummary({ name: 'Agent', input: { description: 'scan repo' }, status: 'pending' })).toBe('Agent · scan repo')
      expect(formatToolCallSummary({ name: 'WebSearch', input: { query: 'q' }, status: 'completed' })).toBe('WebSearch · q • done')
      expect(formatToolCallSummary({ name: 'WebFetch', input: { url: 'https://x' }, status: 'completed' })).toBe('WebFetch · https://x • done')
    })

    it('字段类型不对时用兜底值', () => {
      expect(formatToolCallSummary({ name: 'Read', input: { file_path: 1 }, status: 'completed' })).toBe('Read · file • done')
      expect(formatToolCallSummary({ name: 'Read', input: {}, status: 'completed' })).toBe('Read · file • done')
      expect(formatToolCallSummary({ name: 'Bash', input: { command: 2 }, status: 'completed' })).toBe('Bash • done')
      expect(formatToolCallSummary({ name: 'Read', input: { file_path: 'nodir/' }, status: 'completed' })).toBe('Read · file • done')
    })

    it('未知工具与未知状态只留名字', () => {
      expect(formatToolCallSummary({ name: 'Custom', input: {}, status: 'skipped' })).toBe('Custom')
      expect(formatToolCallSummary({ name: 'Custom', input: undefined as unknown as Record<string, unknown>, status: 'running' })).toBe('Custom • running')
    })
  })

  describe('ensureTeamContext / ensureSubagentTranscripts', () => {
    it('首次调用创建 teamContext 并展开默认视图与转录', () => {
      const session = makeSession()
      ensureTeamContext(session, 'My Team')
      expect(session.teamContext).toEqual({ teamName: 'My Team', isLeader: true, teammates: {} })
      expect(session.expandedView).toBe('none')
      expect(session.teammateTranscripts).toEqual({})
    })

    it('已有 teamName 时不覆盖，只补空的那个', () => {
      const session = makeSession({ teamContext: { teamName: '', isLeader: false, teammates: {} } as Session['teamContext'] })
      ensureTeamContext(session, 'Fallback')
      expect(session.teamContext!.teamName).toBe('Fallback')
      ensureTeamContext(session, 'Ignored')
      expect(session.teamContext!.teamName).toBe('Fallback')
    })

    it('expandedView 已有值时保留', () => {
      const session = makeSession({ expandedView: 'teammates' })
      ensureTeamContext(session, 'T')
      expect(session.expandedView).toBe('teammates')
    })

    it('ensureSubagentTranscripts 只补转录不建 teamContext', () => {
      const session = makeSession()
      ensureSubagentTranscripts(session)
      expect(session.teammateTranscripts).toEqual({})
      expect(session.teamContext).toBeUndefined()
      session.teammateTranscripts = { keep: [] }
      ensureSubagentTranscripts(session)
      expect(session.teammateTranscripts).toEqual({ keep: [] })
    })
  })

  describe('recordAgentToolCall', () => {
    // 每次 recordAgentToolCall 都可能起一条 sidechain 文件轮询链；用假定时器
    // 保证用例结束后不会留下真实 setTimeout 继续跑。
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => {
      resetSessionMappings('sess-1')
      vi.useRealTimers()
    })

    it('非 Agent 工具直接忽略，不初始化转录', () => {
      const session = makeSession()
      recordAgentToolCall(session, { id: 't', name: 'Bash', input: {}, status: 'running' } as ToolCall)
      expect(session.teammateTranscripts).toBeUndefined()
    })

    it('无输出时用归一化的 toolCall.id 建映射并注册父工具 id', () => {
      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 'Toolu-9', input: { agentType: 'Explore', name: 'Scout' } }))
      expect(teammateIdForParentToolUse(session.id, 'Toolu-9')).toBe('toolu-9')
      resetSessionMappings(session.id)
    })

    it('无 agentId 且转录为空时写入一条占位结果消息', () => {
      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 't1', output: JSON.stringify({ text: 'partial result' }), endTime: 123 }))
      const transcript = session.teammateTranscripts!['t1']
      expect(transcript).toHaveLength(1)
      expect(transcript[0]).toMatchObject({
        id: 't1-result',
        content: 'partial result',
        timestamp: 123,
        metadata: { agentTaskId: 't1', agentName: 'Agent', teamName: 'Agent Team', status: 'running' },
      })
      resetSessionMappings(session.id)
    })

    it('输出带 agentId 时以 agentId 归并，并把占位转录迁移过去', () => {
      const session = makeSession()
      const ghost = msg({ id: 'ghost', content: 'early sidechain' })
      session.teammateTranscripts = { 't-ghost': [ghost] }
      registerTeammateForToolUse(session.id, 't-ghost', 't-ghost')

      recordAgentToolCall(session, agentToolCall({ id: 't-ghost', input: {} }))
      // 先用不带 agentId 的一次建立映射，再用带 agentId 的调用迁移
      const existing = session.teammateTranscripts!['t-ghost']
      expect(existing).toEqual([ghost])

      recordAgentToolCall(session, agentToolCall({ id: 't-ghost', output: JSON.stringify({ text: 'agentId: ag-5 done' }) }))
      expect(session.teammateTranscripts!['t-ghost']).toBeUndefined()
      expect(session.teammateTranscripts!['ag-5'].map((m) => m.id)).toContain('ghost')
      expect(teammateIdForParentToolUse(session.id, 't-ghost')).toBe('ag-5')
      resetSessionMappings(session.id)
    })

    it('转录已有子代理正文时不重复写占位消息', () => {
      const session = makeSession()
      session.teammateTranscripts = { t1: [msg({ id: 'live', content: 'sidechain 已收到的正文' })] }
      recordAgentToolCall(session, agentToolCall({ id: 't1', output: JSON.stringify({ text: 'some output' }) }))
      expect(session.teammateTranscripts!['t1'].map((m) => m.id)).toEqual(['live'])
    })

    it('转录里只有主 Agent 下发的任务提示词时，仍补写最终结果', () => {
      // 前台子代理只会收到一条 sidechain 任务提示词；若以"转录非空"为由跳过兜底，
      // 已完成的卡片点开后就只剩这段提示词，最终报告无处显示。
      const session = makeSession()
      session.teammateTranscripts = { t1: [msg({ id: 'prompt', role: 'user', content: '请分析 X 模块' })] }
      recordAgentToolCall(session, agentToolCall({ id: 't1', output: JSON.stringify({ text: '最终报告' }) }))
      expect(session.teammateTranscripts!['t1'].map(m => m.id)).toEqual(['prompt', 't1-result'])
      expect(session.teammateTranscripts!['t1'][1].content).toBe('最终报告')
    })

    it('input 里缺 name/agentType 时用 general-purpose 默认名 Agent', () => {
      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 't1', output: JSON.stringify({ text: 'x' }) }))
      expect(session.teammateTranscripts!['t1'][0].metadata?.agentName).toBe('Agent')
      resetSessionMappings(session.id)
    })
  })

  describe('输出文件轮询（经 recordAgentToolCall 触发）', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      apiMock.readFile.mockResolvedValue('')
    })

    afterEach(() => {
      resetSessionMappings('sess-1')
      vi.useRealTimers()
    })

    it('带 output_file 时登记为文件托管 teammate 并用 IPC 解析真实转录路径', async () => {
      apiMock.claudeCode.resolveAgentTranscriptPath.mockResolvedValue('/real/agent-1.jsonl')
      parseTranscriptMock.mockReturnValue([{ role: 'assistant', content: 'from file', timestamp: 0 } as unknown as Message])

      const session = makeSession()
      recordAgentToolCall(
        session,
        agentToolCall({ id: 't1', output: JSON.stringify({ text: 'agentId: agent-1 output_file: /link/t1.output' }) }),
        'running'
      )

      await vi.advanceTimersByTimeAsync(10)
      expect(isFileBackedTeammate(session.id, 'agent-1')).toBe(true)
      expect(apiMock.claudeCode.resolveAgentTranscriptPath).toHaveBeenCalledWith('/work/proj', session.id, 'agent-1')
      expect(parseTranscriptMock).not.toHaveBeenCalled() // 首次读到空文件，不解析

      apiMock.readFile.mockResolvedValue('{"type":"assistant"}\n')
      await vi.advanceTimersByTimeAsync(1500)
      expect(parseTranscriptMock).toHaveBeenCalledWith('{"type":"assistant"}\n')
      expect(session.teammateTranscripts!['agent-1'][0]).toMatchObject({
        id: 'agent-1-file-0',
        metadata: { agentTaskId: 'agent-1', agentName: 'Agent', teamName: 'Agent Team', status: 'running' },
      })

      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('IPC 解析失败时回退到 .output 路径', async () => {
      apiMock.claudeCode.resolveAgentTranscriptPath.mockRejectedValue(new Error('no link'))
      parseTranscriptMock.mockReturnValue([msg({ content: 'fallback' })])

      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 't2', output: JSON.stringify({ text: 'agentId: a2 output_file: /link/t2.output' }) }))

      apiMock.readFile.mockResolvedValue('line\n')
      await vi.advanceTimersByTimeAsync(3000)
      expect(apiMock.readFile).toHaveBeenCalledWith('/link/t2.output')

      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('转录里出现 result 记录时把 Agent 工具调用判终态并回写输出文本', async () => {
      parseTranscriptMock.mockReturnValue([msg({ content: 'final answer' })])
      const session = makeSession({
        messages: [msg({ role: 'user', toolCalls: [agentToolCall({ id: 't3', name: 'Agent', output: 'agentId: a3' })] })],
      })

      recordAgentToolCall(session, agentToolCall({ id: 't3', output: JSON.stringify({ text: 'agentId: a3 output_file: /link/t3.output' }) }))

      apiMock.readFile.mockResolvedValue(JSON.stringify({ type: 'result', is_error: false }) + '\n')
      await vi.advanceTimersByTimeAsync(1600)

      const tc = session.messages[0].toolCalls![0]
      expect(tc.status).toBe('completed')
      expect(tc.output).toBe('final answer')
      expect(tc.endTime).toBeDefined()

      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('result 带 is_error 时工具调用置为 error 且 teammate 状态为 failed', async () => {
      parseTranscriptMock.mockReturnValue([msg({ content: 'boom' })])
      const session = makeSession({
        messages: [msg({ role: 'user', toolCalls: [agentToolCall({ id: 't4', name: 'Task' })] })],
      })
      recordAgentToolCall(session, agentToolCall({ id: 't4', output: JSON.stringify({ text: 'agentId: a4 output_file: /link/t4.output' }) }))

      apiMock.readFile.mockResolvedValue(JSON.stringify({ type: 'result', is_error: true }) + '\n')
      await vi.advanceTimersByTimeAsync(1600)

      expect(session.messages[0].toolCalls![0].status).toBe('error')
      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('最后一条 assistant 停在 tool_use 时不判终态', async () => {
      parseTranscriptMock.mockReturnValue([msg({ content: 'thinking' })])
      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 't5', output: JSON.stringify({ text: 'agentId: a5 output_file: /link/t5.output' }) }))

      apiMock.readFile.mockResolvedValue(JSON.stringify({ type: 'assistant', message: { stop_reason: 'tool_use' } }) + '\n')
      await vi.advanceTimersByTimeAsync(1600)
      expect(session.teammateTranscripts!['a5'][0].metadata?.status).toBe('running')
      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('内容停止增长后靠稳定态判定完成，且轮询自动退出', async () => {
      parseTranscriptMock.mockReturnValue([msg({ content: 'done text' })])
      const session = makeSession({
        messages: [msg({ role: 'user', toolCalls: [agentToolCall({ id: 't6', name: 'Agent', status: 'running' })] })],
      })
      recordAgentToolCall(session, agentToolCall({ id: 't6', output: JSON.stringify({ text: 'agentId: a6 output_file: /link/t6.output' }) }))

      apiMock.readFile.mockResolvedValue('{"type":"assistant","message":{"content":[{"type":"text","text":"x"}]}}\n')
      await vi.advanceTimersByTimeAsync(1600)
      // 仍有 running 的 Agent 工具 → 稳定态不判完成
      const beforeStable = parseTranscriptMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(50_000)
      expect(parseTranscriptMock.mock.calls.length).toBeGreaterThan(beforeStable)
      // 最后一轮 allowStableCompletion=true，工具已被回写为 completed
      expect(session.messages[0].toolCalls![0].status).toBe('completed')
      // 退出后同一文件可再次起链（activeAgentFilePolls 已清理）
      expect(isFileBackedTeammate(session.id, 'a6')).toBe(true)
    })

    it('解析结果为空且判到终态时只回写状态不写转录', async () => {
      parseTranscriptMock.mockReturnValue([])
      const session = makeSession({
        messages: [msg({ role: 'user', toolCalls: [agentToolCall({ id: 't7', name: 'Agent' })] })],
      })
      recordAgentToolCall(session, agentToolCall({ id: 't7', output: JSON.stringify({ text: 'agentId: a7 output_file: /link/t7.output' }) }))

      apiMock.readFile.mockResolvedValue(JSON.stringify({ type: 'result', is_error: false }) + '\n')
      await vi.advanceTimersByTimeAsync(1600)

      expect(session.messages[0].toolCalls![0].status).toBe('completed')
      expect(session.teammateTranscripts!['a7']).toBeUndefined()
      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('已完成/出错的子工具调用会同步任务状态，未完成的不触发同步', async () => {
      parseTranscriptMock.mockReturnValue([
        msg({
          toolCalls: [
            { id: 'b1', name: 'Bash', status: 'completed', output: 'out' } as ToolCall,
            { id: 'b2', name: 'Bash', status: 'running' } as ToolCall,
            { id: 'b3', name: 'TodoWrite', status: 'running' } as ToolCall,
          ],
        }),
      ])
      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 't8', output: JSON.stringify({ text: 'agentId: a8 output_file: /link/t8.output' }) }))
      apiMock.readFile.mockResolvedValue('x\n')
      await vi.advanceTimersByTimeAsync(1600)

      const synced = syncTaskMock.mock.calls.map((c) => (c[1] as ToolCall).id)
      expect(synced).toContain('b1')
      expect(synced).toContain('b3')
      expect(synced).not.toContain('b2')
      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('文件读失败时静默重试并保留旧转录', async () => {
      parseTranscriptMock.mockReturnValue([msg({ content: 'first' })])
      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 't9', output: JSON.stringify({ text: 'agentId: a9 output_file: /link/t9.output' }) }))
      apiMock.readFile.mockResolvedValue('some text\n')
      await vi.advanceTimersByTimeAsync(1600)
      expect(session.teammateTranscripts!['a9']).toHaveLength(1)

      apiMock.readFile.mockRejectedValue(new Error('EACCES'))
      await vi.advanceTimersByTimeAsync(1600)
      expect(session.teammateTranscripts!['a9']).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('有 teamContext 条目时同步 messageCount 与状态', async () => {
      parseTranscriptMock.mockReturnValue([msg({ content: 'a' }), msg({ id: 'm2', content: 'b' })])
      const session = makeSession({
        teamContext: { teamName: 'T', isLeader: true, teammates: { 'a10': { id: 'a10', status: 'running' } } } as unknown as Session['teamContext'],
      })
      recordAgentToolCall(session, agentToolCall({ id: 't10', output: JSON.stringify({ text: 'agentId: a10 output_file: /link/t10.output' }) }))
      apiMock.readFile.mockResolvedValue('x\n')
      await vi.advanceTimersByTimeAsync(1600)

      expect(session.teamContext!.teammates['a10']).toMatchObject({ messageCount: 2, status: 'running' })
      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('rekickAgentTranscriptPoll 对未登记的 teammate 无操作', () => {
      const session = makeSession()
      expect(() => rekickAgentTranscriptPoll(session, session.id, 'nobody')).not.toThrow()
    })

    // ── 前台（同步）子代理：没有 agentId / output_file，只能按 toolUseId 反查 ──

    const assistantRecord = '{"type":"assistant","message":{"content":[{"type":"text","text":"x"}]}}\n'

    it('无 output_file 时按 toolUseId 反查 sidechain JSONL 并轮询补全转录', async () => {
      apiMock.claudeCode.findAgentTranscriptByToolUse.mockResolvedValue('/proj/subagents/agent-f1.jsonl')
      parseTranscriptMock.mockReturnValue([msg({ content: '来自 sidechain 文件的过程' })])

      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 'f1', input: { agentType: 'Explore' } }), 'running')
      // 起链即登记为文件托管：实时 sidechain 事件不再另写转录，避免与文件内容重复
      expect(isFileBackedTeammate(session.id, 'f1')).toBe(true)

      apiMock.readFile.mockResolvedValue(assistantRecord)
      await vi.advanceTimersByTimeAsync(1600)

      expect(apiMock.claudeCode.findAgentTranscriptByToolUse).toHaveBeenCalledWith('/work/proj', session.id, 'f1')
      expect(apiMock.readFile).toHaveBeenCalledWith('/proj/subagents/agent-f1.jsonl')
      expect(session.teammateTranscripts!['f1'][0].content).toBe('来自 sidechain 文件的过程')
      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('meta.json 晚于首轮出现时后续轮询补上路径', async () => {
      apiMock.claudeCode.findAgentTranscriptByToolUse
        .mockResolvedValueOnce(null)
        .mockResolvedValue('/proj/subagents/agent-f2.jsonl')
      parseTranscriptMock.mockReturnValue([msg({ content: 'late' })])
      apiMock.readFile.mockResolvedValue(assistantRecord)

      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 'f2' }), 'running')

      await vi.advanceTimersByTimeAsync(0)
      expect(apiMock.claudeCode.findAgentTranscriptByToolUse).toHaveBeenCalledTimes(1)
      expect(apiMock.readFile).not.toHaveBeenCalled() // 首轮还没解析出路径

      await vi.advanceTimersByTimeAsync(1600)
      expect(apiMock.readFile).toHaveBeenCalledWith('/proj/subagents/agent-f2.jsonl')
      await vi.advanceTimersByTimeAsync(60_000)
    })

    it('始终反查不到 sidechain 文件时撤销文件托管，让实时事件重新写入', async () => {
      apiMock.claudeCode.findAgentTranscriptByToolUse.mockResolvedValue(null)
      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 'f3' }), 'running')
      expect(isFileBackedTeammate(session.id, 'f3')).toBe(true)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(isFileBackedTeammate(session.id, 'f3')).toBe(false)
    })

    it('rekickAgentTranscriptPoll 对已登记但仍在轮询的 teammate 不重复起链', async () => {
      parseTranscriptMock.mockReturnValue([msg({ content: 'x' })])
      const session = makeSession()
      recordAgentToolCall(session, agentToolCall({ id: 't11', output: JSON.stringify({ text: 'agentId: a11 output_file: /link/t11.output' }) }))
      apiMock.readFile.mockResolvedValue('x\n')
      await vi.advanceTimersByTimeAsync(1600)
      const calls = apiMock.readFile.mock.calls.length

      rekickAgentTranscriptPoll(session, session.id, 'a11')
      await vi.advanceTimersByTimeAsync(0)
      expect(apiMock.readFile.mock.calls.length).toBe(calls)
      await vi.advanceTimersByTimeAsync(60_000)
    })
  })
})
