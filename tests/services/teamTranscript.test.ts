import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ── Types ────────────────────────────────────────────────────────────────────
type AgentColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan'
type TeammateStatus = 'running' | 'completed' | 'failed' | 'idle'

const AGENT_COLORS: AgentColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']

// ── Function implementations (copied from chat.ts) ──────────────────────────

function stableTeammateId(raw: any): string {
  const value = raw?.agentTaskId || raw?.taskId || raw?.agentId || raw?.agentName || raw?.subagent_type || raw?.name || 'teammate'
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, '-') || 'teammate'
}

function getRawTeammateName(raw: any): string {
  return String(raw?.agentName || raw?.name || raw?.subagent_type || raw?.agentType || 'teammate')
}

function getRawTeamName(raw: any): string {
  return String(raw?.teamName || raw?.team_name || raw?.team || 'Agent Team')
}

function isTeammateRawMessage(raw: any): boolean {
  return !!raw && typeof raw === 'object' && (raw.type === 'teammate' || raw.isSidechain || raw.agentName || raw.subagent_type)
}

function inferTeammateStatus(raw: any): TeammateStatus {
  const value = String(raw?.status || raw?.state || raw?.event || raw?.subtype || '').toLowerCase()
  if (/fail|error|reject|cancel/.test(value)) return 'failed'
  if (/complete|done|finish|success|result/.test(value)) return 'completed'
  if (/idle|wait/.test(value)) return 'idle'
  return 'running'
}

function stringifyRawContent(raw: any): string {
  const content = raw?.message?.content ?? raw?.content ?? raw?.text ?? raw?.output ?? raw?.result
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part
        if (part?.type === 'text' && typeof part.text === 'string') return part.text
        if (part?.text) return String(part.text)
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

function parseAgentToolOutput(output: string): { displayText: string; outputFile?: string; agentId?: string } {
  try {
    const parsed = JSON.parse(output)
    const text = Array.isArray(parsed)
      ? parsed.map((part: any) => typeof part === 'string' ? part : part?.text || '').filter(Boolean).join('\n')
      : typeof parsed?.text === 'string' ? parsed.text : output
    const outputFile = text.match(/output_file:\s*([^\n]+)/)?.[1]?.trim()
    const agentId = text.match(/agentId:\s*([^\s]+)/)?.[1]?.trim()
    return {
      displayText: agentId
        ? `Agent launched successfully.\n\nAgent ID: ${agentId}\n${outputFile ? `Output file: ${outputFile}` : ''}`.trim()
        : text,
      outputFile,
      agentId,
    }
  } catch {
    const outputFile = output.match(/output_file:\s*([^\n]+)/)?.[1]?.trim()
    const agentId = output.match(/agentId:\s*([^\s]+)/)?.[1]?.trim()
    return { displayText: output, outputFile, agentId }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('stableTeammateId', () => {
  it('extracts from agentTaskId', () => {
    assert.equal(stableTeammateId({ agentTaskId: 'task-123' }), 'task-123')
  })

  it('extracts from taskId when agentTaskId is absent', () => {
    assert.equal(stableTeammateId({ taskId: 'task-456' }), 'task-456')
  })

  it('extracts from agentId when higher-priority fields are absent', () => {
    assert.equal(stableTeammateId({ agentId: 'agent-789' }), 'agent-789')
  })

  it('extracts from agentName when higher-priority fields are absent', () => {
    assert.equal(stableTeammateId({ agentName: 'CodeReviewer' }), 'codereviewer')
  })

  it('extracts from subagent_type when higher-priority fields are absent', () => {
    assert.equal(stableTeammateId({ subagent_type: 'coder' }), 'coder')
  })

  it('extracts from name when all other fields are absent', () => {
    assert.equal(stableTeammateId({ name: 'MyAgent' }), 'myagent')
  })

  it('falls back to "teammate" when nothing matches', () => {
    assert.equal(stableTeammateId({}), 'teammate')
  })

  it('normalizes to lowercase', () => {
    assert.equal(stableTeammateId({ agentTaskId: 'MyTaskID' }), 'mytaskid')
  })

  it('replaces non-alphanumeric characters with hyphens', () => {
    assert.equal(stableTeammateId({ agentTaskId: 'task 123/abc' }), 'task-123-abc')
  })

  it('handles null input', () => {
    assert.equal(stableTeammateId(null), 'teammate')
  })

  it('handles undefined input', () => {
    assert.equal(stableTeammateId(undefined), 'teammate')
  })

  it('prioritizes agentTaskId over taskId', () => {
    assert.equal(stableTeammateId({ agentTaskId: 'first', taskId: 'second' }), 'first')
  })

  it('returns hyphens for all-non-alphanumeric input after normalization', () => {
    assert.equal(stableTeammateId({ agentTaskId: '!!!' }), '-')
  })
})

describe('getRawTeammateName', () => {
  it('extracts from agentName', () => {
    assert.equal(getRawTeammateName({ agentName: 'Reviewer' }), 'Reviewer')
  })

  it('extracts from name when agentName is absent', () => {
    assert.equal(getRawTeammateName({ name: 'Builder' }), 'Builder')
  })

  it('extracts from subagent_type when higher-priority fields are absent', () => {
    assert.equal(getRawTeammateName({ subagent_type: 'coder' }), 'coder')
  })

  it('extracts from agentType when all other fields are absent', () => {
    assert.equal(getRawTeammateName({ agentType: 'planner' }), 'planner')
  })

  it('falls back to "teammate"', () => {
    assert.equal(getRawTeammateName({}), 'teammate')
  })

  it('prioritizes agentName over name', () => {
    assert.equal(getRawTeammateName({ agentName: 'first', name: 'second' }), 'first')
  })
})

describe('getRawTeamName', () => {
  it('extracts from teamName', () => {
    assert.equal(getRawTeamName({ teamName: 'Alpha Team' }), 'Alpha Team')
  })

  it('extracts from team_name when teamName is absent', () => {
    assert.equal(getRawTeamName({ team_name: 'Beta Team' }), 'Beta Team')
  })

  it('extracts from team when higher-priority fields are absent', () => {
    assert.equal(getRawTeamName({ team: 'Gamma Team' }), 'Gamma Team')
  })

  it('falls back to "Agent Team"', () => {
    assert.equal(getRawTeamName({}), 'Agent Team')
  })

  it('prioritizes teamName over team_name', () => {
    assert.equal(getRawTeamName({ teamName: 'first', team_name: 'second' }), 'first')
  })
})

describe('isTeammateRawMessage', () => {
  it('returns true for type="teammate"', () => {
    assert.equal(isTeammateRawMessage({ type: 'teammate' }), true)
  })

  it('returns true for isSidechain=true', () => {
    assert.equal(isTeammateRawMessage({ isSidechain: true }), true)
  })

  it('returns true when agentName is present', () => {
    assert.ok(isTeammateRawMessage({ agentName: 'Reviewer' }))
  })

  it('returns true when subagent_type is present', () => {
    assert.ok(isTeammateRawMessage({ subagent_type: 'coder' }))
  })

  it('returns false for null', () => {
    assert.equal(isTeammateRawMessage(null), false)
  })

  it('returns false for undefined', () => {
    assert.equal(isTeammateRawMessage(undefined), false)
  })

  it('returns false for non-objects (string)', () => {
    assert.equal(isTeammateRawMessage('teammate'), false)
  })

  it('returns false for non-objects (number)', () => {
    assert.equal(isTeammateRawMessage(42), false)
  })

  it('returns false for plain objects without teammate indicators', () => {
    assert.ok(!isTeammateRawMessage({ foo: 'bar' }))
  })

  it('returns false for isSidechain=false', () => {
    assert.ok(!isTeammateRawMessage({ isSidechain: false }))
  })
})

describe('inferTeammateStatus', () => {
  it('maps "fail" → failed', () => {
    assert.equal(inferTeammateStatus({ status: 'fail' }), 'failed')
  })

  it('maps "error" → failed', () => {
    assert.equal(inferTeammateStatus({ status: 'error' }), 'failed')
  })

  it('maps "rejected" → failed', () => {
    assert.equal(inferTeammateStatus({ status: 'rejected' }), 'failed')
  })

  it('maps "cancelled" → failed', () => {
    assert.equal(inferTeammateStatus({ status: 'cancelled' }), 'failed')
  })

  it('maps "complete" → completed', () => {
    assert.equal(inferTeammateStatus({ status: 'complete' }), 'completed')
  })

  it('maps "done" → completed', () => {
    assert.equal(inferTeammateStatus({ status: 'done' }), 'completed')
  })

  it('maps "finished" → completed', () => {
    assert.equal(inferTeammateStatus({ status: 'finished' }), 'completed')
  })

  it('maps "success" → completed', () => {
    assert.equal(inferTeammateStatus({ status: 'success' }), 'completed')
  })

  it('maps "result" → completed', () => {
    assert.equal(inferTeammateStatus({ status: 'result' }), 'completed')
  })

  it('maps "idle" → idle', () => {
    assert.equal(inferTeammateStatus({ status: 'idle' }), 'idle')
  })

  it('maps "waiting" → idle', () => {
    assert.equal(inferTeammateStatus({ status: 'waiting' }), 'idle')
  })

  it('defaults to "running" for unknown status', () => {
    assert.equal(inferTeammateStatus({ status: 'processing' }), 'running')
  })

  it('defaults to "running" for empty object', () => {
    assert.equal(inferTeammateStatus({}), 'running')
  })

  it('reads from state field', () => {
    assert.equal(inferTeammateStatus({ state: 'completed' }), 'completed')
  })

  it('reads from event field', () => {
    assert.equal(inferTeammateStatus({ event: 'failed' }), 'failed')
  })

  it('reads from subtype field', () => {
    assert.equal(inferTeammateStatus({ subtype: 'idle' }), 'idle')
  })

  it('is case-insensitive', () => {
    assert.equal(inferTeammateStatus({ status: 'FAILED' }), 'failed')
    assert.equal(inferTeammateStatus({ status: 'Completed' }), 'completed')
  })
})

describe('stringifyRawContent', () => {
  it('handles string content directly from message.content', () => {
    assert.equal(stringifyRawContent({ message: { content: 'hello' } }), 'hello')
  })

  it('handles string content from top-level content', () => {
    assert.equal(stringifyRawContent({ content: 'world' }), 'world')
  })

  it('handles string content from text field', () => {
    assert.equal(stringifyRawContent({ text: 'from text' }), 'from text')
  })

  it('handles string content from output field', () => {
    assert.equal(stringifyRawContent({ output: 'from output' }), 'from output')
  })

  it('handles string content from result field', () => {
    assert.equal(stringifyRawContent({ result: 'from result' }), 'from result')
  })

  it('handles array of text blocks with type="text"', () => {
    const raw = {
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ],
    }
    assert.equal(stringifyRawContent(raw), 'Hello\nWorld')
  })

  it('handles array of strings', () => {
    const raw = { content: ['line1', 'line2'] }
    assert.equal(stringifyRawContent(raw), 'line1\nline2')
  })

  it('handles array with mixed parts (string + text block)', () => {
    const raw = {
      content: ['plain text', { type: 'text', text: 'typed text' }],
    }
    assert.equal(stringifyRawContent(raw), 'plain text\ntyped text')
  })

  it('handles array with parts that have .text but no type', () => {
    const raw = { content: [{ text: 'fallback text' }] }
    assert.equal(stringifyRawContent(raw), 'fallback text')
  })

  it('filters empty strings from array', () => {
    const raw = { content: ['hello', '', 'world'] }
    assert.equal(stringifyRawContent(raw), 'hello\nworld')
  })

  it('returns empty string for null content', () => {
    assert.equal(stringifyRawContent({ content: null }), '')
  })

  it('returns empty string for undefined content', () => {
    assert.equal(stringifyRawContent({ content: undefined }), '')
  })

  it('returns empty string for empty object', () => {
    assert.equal(stringifyRawContent({}), '')
  })

  it('handles objects by JSON.stringify', () => {
    const raw = { content: { key: 'value' } }
    assert.equal(stringifyRawContent(raw), '{"key":"value"}')
  })

  it('prioritizes message.content over top-level content', () => {
    assert.equal(
      stringifyRawContent({ message: { content: 'first' }, content: 'second' }),
      'first',
    )
  })
})

describe('parseAgentToolOutput', () => {
  it('parses JSON output with text field', () => {
    const result = parseAgentToolOutput(JSON.stringify({ text: 'Hello world' }))
    assert.equal(result.displayText, 'Hello world')
    assert.equal(result.outputFile, undefined)
  })

  it('parses JSON array output', () => {
    const result = parseAgentToolOutput(JSON.stringify(['line1', 'line2']))
    assert.equal(result.displayText, 'line1\nline2')
  })

  it('parses JSON array with text blocks', () => {
    const result = parseAgentToolOutput(
      JSON.stringify([{ text: 'block1' }, { text: 'block2' }]),
    )
    assert.equal(result.displayText, 'block1\nblock2')
  })

  it('extracts outputFile from text in JSON output', () => {
    const result = parseAgentToolOutput(
      JSON.stringify({ text: 'Task done\noutput_file: /tmp/result.txt' }),
    )
    assert.equal(result.outputFile, '/tmp/result.txt')
  })

  it('extracts agentId and formats display text', () => {
    const result = parseAgentToolOutput(
      JSON.stringify({ text: 'agentId: abc-123\nSome details' }),
    )
    assert.equal(result.agentId, 'abc-123')
    assert.ok(result.displayText.includes('Agent launched successfully.'))
    assert.ok(result.displayText.includes('Agent ID: abc-123'))
  })

  it('extracts both agentId and outputFile', () => {
    const result = parseAgentToolOutput(
      JSON.stringify({ text: 'agentId: xyz-999\noutput_file: /out/file.txt' }),
    )
    assert.ok(result.displayText.includes('Agent ID: xyz-999'))
    assert.ok(result.displayText.includes('Output file: /out/file.txt'))
    assert.equal(result.outputFile, '/out/file.txt')
  })

  it('falls back for non-JSON output', () => {
    const result = parseAgentToolOutput('plain text output')
    assert.equal(result.displayText, 'plain text output')
    assert.equal(result.outputFile, undefined)
  })

  it('extracts outputFile from non-JSON output', () => {
    const result = parseAgentToolOutput('result here\noutput_file: /tmp/out.txt')
    assert.equal(result.displayText, 'result here\noutput_file: /tmp/out.txt')
    assert.equal(result.outputFile, '/tmp/out.txt')
  })

  it('handles JSON without text field by returning original output', () => {
    const json = JSON.stringify({ foo: 'bar' })
    const result = parseAgentToolOutput(json)
    assert.equal(result.displayText, json)
  })

  it('filters empty strings in JSON array', () => {
    const result = parseAgentToolOutput(JSON.stringify(['hello', '', 'world']))
    assert.equal(result.displayText, 'hello\nworld')
  })
})
