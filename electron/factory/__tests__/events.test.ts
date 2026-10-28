// @vitest-environment node
/**
 * 事件流：JSONL 序号单调、渲染层可格式化的码 + 参数、落盘前脱敏，
 * 以及引擎原始事件只投影成「读/改/跑」摘要而不是逐 token。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendRawLog,
  openEventLog,
  projectAgentEvent,
  pruneRawLogs,
  readEvents,
  redactSecrets,
} from '../events'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-events-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('event log', () => {
  it('appends JSONL with a monotonic sequence that survives reopening', () => {
    const path = join(dir, 'events.jsonl')
    const first = openEventLog(path, { now: () => new Date('2026-10-28T10:00:00Z') })
    const a = first.append({ taskId: 'bl-1', stage: 'implement', code: 'task.started', level: 'info' })
    const b = first.append({ taskId: 'bl-1', code: 'agent.turn', level: 'ok', params: { outputTokens: 12 } })
    expect([a.seq, b.seq]).toEqual([1, 2])

    const second = openEventLog(path, { now: () => new Date('2026-10-28T10:01:00Z') })
    const c = second.append({ taskId: null, code: 'run.stopped', level: 'warn' })
    expect(c.seq).toBe(3)

    expect(readEvents(path).map((event) => event.code)).toEqual(['task.started', 'agent.turn', 'run.stopped'])
    expect(readEvents(path, { taskId: 'bl-1' })).toHaveLength(2)

    const lines = readFileSync(path, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0])).toMatchObject({
      seq: 1,
      at: '2026-10-28T10:00:00.000Z',
      taskId: 'bl-1',
      stage: 'implement',
      code: 'task.started',
      level: 'info',
    })
  })

  it('redacts credentials in event params before writing', () => {
    const path = join(dir, 'events.jsonl')
    const log = openEventLog(path)
    log.append({
      taskId: 'bl-1',
      code: 'agent.exec',
      level: 'info',
      params: { command: 'curl -H "Authorization: token ghp_abcdefghijklmnopqrstuvwxyz1234"' },
    })
    const raw = readFileSync(path, 'utf-8')
    expect(raw).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234')
    expect(raw).toContain('ghp_***')
  })

  it('ignores malformed lines when reading back', () => {
    const path = join(dir, 'events.jsonl')
    const log = openEventLog(path)
    log.append({ taskId: null, code: 'task.started', level: 'info' })
    writeFileSync(path, `${readFileSync(path, 'utf-8')}not-json\n`, 'utf-8')
    expect(readEvents(path)).toHaveLength(1)
  })
})

describe('redaction', () => {
  it('covers ghp_, github_pat_ and sk- tokens', () => {
    const text = 'a ghp_123456789012345678901234 b github_pat_11ABCDEFG0123456789 c sk-ant-api03-xyz123456789'
    const redacted = redactSecrets(text)
    expect(redacted).not.toMatch(/ghp_1|github_pat_1|sk-ant-/)
    expect(redacted).toContain('ghp_***')
    expect(redacted).toContain('github_pat_***')
    expect(redacted).toContain('sk-***')
  })
})

describe('raw log', () => {
  it('writes a redacted per-task log and prunes older files', () => {
    const logs = join(dir, 'logs')
    appendRawLog(logs, 'bl-1', 'token ghp_123456789012345678901234\n')
    const content = readFileSync(join(logs, 'bl-1.log'), 'utf-8')
    expect(content).toContain('ghp_***')
    expect(content).not.toContain('123456789012345678901234')

    for (const id of ['bl-2', 'bl-3', 'bl-4', 'bl-5']) appendRawLog(logs, id, 'x\n')
    pruneRawLogs(logs, 3)
    expect(existsSync(join(logs, 'bl-1.log'))).toBe(false)
    expect(existsSync(join(logs, 'bl-5.log'))).toBe(true)
  })
})

describe('projectAgentEvent', () => {
  it('summarises tool usage as read/edit/exec instead of raw messages', () => {
    expect(projectAgentEvent('tool_use', { name: 'Read', input: { file_path: '/x/a.ts' } })).toMatchObject({
      code: 'agent.read',
      params: { target: '/x/a.ts' },
    })
    expect(projectAgentEvent('tool_use', { name: 'Edit', input: { file_path: '/x/b.ts' } })).toMatchObject({
      code: 'agent.edit',
      params: { target: '/x/b.ts' },
    })
    expect(projectAgentEvent('tool_use', { name: 'Bash', input: { command: 'npm run test' } })).toMatchObject({
      code: 'agent.exec',
      params: { command: 'npm run test' },
    })
    expect(projectAgentEvent('tool_use', { name: 'WebFetch', input: { url: 'https://x' } })).toMatchObject({
      code: 'agent.tool',
      params: { tool: 'WebFetch' },
    })
  })

  it('never projects per-token deltas', () => {
    expect(projectAgentEvent('assistant', { message: { content: [{ type: 'text', text: 'hi' }] } })).toBeNull()
    expect(projectAgentEvent('stream_event', { event: { type: 'content_block_delta' } })).toBeNull()
    expect(projectAgentEvent('log', 'line')).toBeNull()
  })

  it('projects result with usage and errors with redacted messages', () => {
    expect(
      projectAgentEvent('result', {
        result: 'done',
        usage: { input_tokens: 10, output_tokens: 4 },
      }),
    ).toMatchObject({
      code: 'agent.turn',
      level: 'ok',
      params: { inputTokens: 10, outputTokens: 4 },
    })
    expect(projectAgentEvent('error', { message: 'boom ghp_123456789012345678901234' })).toMatchObject({
      code: 'agent.error',
      level: 'error',
      params: { message: 'boom ghp_***' },
    })
  })
})
