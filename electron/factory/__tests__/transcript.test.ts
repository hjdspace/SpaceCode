// @vitest-environment node
/**
 * 观察视图的数据源：候选会话按 mtime 取最新一份；mtime 没变不重复解析。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readTranscript, resetTranscriptCache, transcriptSessionIds } from '../transcript'
import { factorySessionId } from '../sessionId'

const RUN = 'run-1'
const TASK = 'bl-1'
const worktree = 'D:/repo/.spacecode/worktrees/bl-1'

function input(overrides: { stat?: any; read?: any; takeover?: string } = {}) {
  return {
    task: {
      id: TASK,
      runId: RUN,
      ...(overrides.takeover ? { takeover: { at: '2026-11-01T00:00:00Z', sessionId: overrides.takeover } } : {}),
    },
    worktreeAbsolute: worktree,
    engineType: 'claude-code' as const,
    deps: {
      stat: overrides.stat ?? (() => null),
      read: overrides.read ?? (async () => ({ messages: [] })),
    },
  }
}

beforeEach(() => {
  resetTranscriptCache()
})

describe('transcriptSessionIds', () => {
  it('derives one id per stage and puts the takeover session first', () => {
    const ids = transcriptSessionIds(RUN, TASK)
    expect(ids[0]).toBe(factorySessionId(`fac-${RUN}-${TASK}-impl`))
    expect(ids).toContain(factorySessionId(`fac-${RUN}-${TASK}-fix`))
    expect(ids).toContain(factorySessionId(`fac-${RUN}-${TASK}-review-3`))

    const withTakeover = transcriptSessionIds(RUN, TASK, 'takeover-1')
    expect(withTakeover[0]).toBe('takeover-1')
    expect(withTakeover).toHaveLength(ids.length + 1)
  })
})

describe('readTranscript', () => {
  it('picks the newest stage session and returns its messages', async () => {
    const impl = factorySessionId(`fac-${RUN}-${TASK}-impl`)
    const fix = factorySessionId(`fac-${RUN}-${TASK}-fix`)
    const read = vi.fn(async (_p: string, sessionId: string) => ({
      messages: [{ type: 'assistant', sessionId }],
    }))
    const result = await readTranscript(
      input({
        stat: (_p: string, sessionId: string) => (sessionId === impl ? 100 : sessionId === fix ? 200 : null),
        read,
      }),
    )
    expect(result).toMatchObject({ ok: true, sessionId: fix })
    expect(read).toHaveBeenCalledTimes(1)
    if (result.ok) expect(result.messages).toEqual([{ type: 'assistant', sessionId: fix }])
  })

  it('reports no-session when no stage transcript exists yet', async () => {
    await expect(readTranscript(input())).resolves.toEqual({ ok: false, error: 'no-session' })
  })

  it('skips re-parsing while the transcript mtime is unchanged', async () => {
    const read = vi.fn(async () => ({ messages: [{ type: 'assistant' }] }))
    const deps = { stat: () => 42, read }
    await readTranscript(input({ ...deps }))
    await readTranscript(input({ ...deps }))
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('treats a missing transcript body as an empty message list', async () => {
    const impl = factorySessionId(`fac-${RUN}-${TASK}-impl`)
    const result = await readTranscript(
      input({ stat: () => 1, read: async () => null }),
    )
    expect(result).toEqual({ ok: true, sessionId: impl, engineType: 'claude-code', messages: [] })
  })

  it('reports read-failed when the transcript cannot be parsed', async () => {
    const result = await readTranscript(
      input({
        stat: () => 1,
        read: async () => {
          throw new Error('boom')
        },
      }),
    )
    expect(result).toEqual({ ok: false, error: 'read-failed' })
  })
})
