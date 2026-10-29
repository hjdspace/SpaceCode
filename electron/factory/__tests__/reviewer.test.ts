// @vitest-environment node
/**
 * 审查阶段：全新会话、结构化输出解析、重发一次、结论落库与意见合并。
 * Agent 用假的，只跨真实 tasks.json 与事件流。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createBacklogItem } from '../backlog'
import { createFactoryRun, readRunSnapshot } from '../runs'
import { transitionTask } from '../runtime'
import { runReview } from '../reviewer'
import type { AgentPort, AgentTurn } from '../agentEngineGateway'
import type { FactoryEventInput } from '../events'
import type { FactoryReview } from '@/shared/factory'

let dir: string
let runId: string

interface FakeAgent extends AgentPort {
  prompts: string[]
  stopped: string[]
  options: Array<{ permissionMode: string }>
}

function fakeAgent(script: AgentTurn[]): FakeAgent {
  const prompts: string[] = []
  const stopped: string[] = []
  const options: Array<{ permissionMode: string }> = []
  return {
    prompts,
    stopped,
    options,
    async run(_sessionId, prompt, opts) {
      prompts.push(prompt)
      options.push({ permissionMode: opts.permissionMode })
      const next = script.shift()
      if (!next) throw new Error('fake agent ran out of turns')
      return next
    },
    async stop(sessionId) {
      stopped.push(sessionId)
    },
    onEvent() {
      return () => {}
    },
  }
}

function seed(review?: FactoryReview): void {
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'worktree' },
      tracker: { type: 'local', mergeMode: 'local' },
      commands: { verify: 'npm run test' },
    },
    { baseBranch: 'main' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  writeFactoryConfigAtomic(dir, built.config)
  const backlog = createBacklogItem(dir, { title: '任务', goal: '目标' }, { genId: () => 'bl-1' })
  if (!backlog.ok) throw new Error('fixture backlog invalid')
  const created = createFactoryRun(dir, { taskIds: ['bl-1'] }, { genId: () => 'run-1' })
  if (!created.ok) throw new Error('fixture run invalid')
  runId = created.snapshot.run.id
  transitionTask(
    dir,
    runId,
    'bl-1',
    { lane: 'implementing', stageIdx: 2 },
    'worktree.ready',
    { worktree: '.spacecode/worktrees/bl-1' },
  )
  transitionTask(
    dir,
    runId,
    'bl-1',
    { lane: 'reviewing', stageIdx: 4 },
    'tests.passed',
    review ? { review } : {},
  )
}

let events: FactoryEventInput[]

function input(agent: FakeAgent, overrides: Record<string, unknown> = {}) {
  const task = readRunSnapshot(dir, runId)!.tasks[0]
  return {
    repoRoot: dir,
    runId,
    task,
    prompt: 'review this',
    worktreeAbsolute: join(dir, '.spacecode', 'worktrees', 'bl-1'),
    baseBranch: 'main',
    sessionId: 'fac-run-1-bl-1-review-1',
    permissionMode: 'acceptEdits' as const,
    signal: new AbortController().signal,
    deps: {
      agent,
      emit: (event: FactoryEventInput) => events.push(event),
    },
    ...overrides,
  }
}

function turn(text: string, isError = false): AgentTurn {
  return { text, isError, inputTokens: 1, outputTokens: 1 }
}

const APPROVED = '<review>{"verdict":"approved","summary":"Looks good","comments":[]}</review>'
const CHANGES =
  '<review>{"verdict":"needs_changes","summary":"One blocker","comments":[{"file":"src/a.ts","line":3,"severity":"blocker","body":"missing guard"}]}</review>'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-review-'))
  events = []
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runReview', () => {
  it('records an approving review without leaving the review lane', async () => {
    seed()
    const agent = fakeAgent([turn(APPROVED)])
    const result = await runReview(input(agent) as never)

    expect(result).toMatchObject({ outcome: 'approved' })
    expect(agent.options[0].permissionMode).toBe('acceptEdits')
    const task = readRunSnapshot(dir, runId)!.tasks[0]
    expect(task).toMatchObject({
      lane: 'reviewing',
      stageIdx: 4,
      review: { verdict: 'approved', summary: 'Looks good', comments: [] },
    })
    expect(events.map((event) => event.code)).toEqual(
      expect.arrayContaining(['review.started', 'review.approved']),
    )
  })

  it('blocks the task when the review asks for changes', async () => {
    seed()
    const agent = fakeAgent([turn(CHANGES)])
    const result = await runReview(input(agent) as never)

    expect(result).toMatchObject({ outcome: 'needs-changes' })
    expect(readRunSnapshot(dir, runId)!.tasks[0]).toMatchObject({
      lane: 'blocked',
      stageIdx: 4,
      attention: { reason: 'review.needs_changes', action: 'fix' },
      review: {
        verdict: 'needs_changes',
        comments: [{ id: 'c1', file: 'src/a.ts', line: 3, severity: 'blocker', status: 'open' }],
      },
    })
    expect(events).toContainEqual(expect.objectContaining({ code: 'review.needs_changes', level: 'warn' }))
  })

  it('retries the same session once when the first reply cannot be parsed', async () => {
    seed()
    const agent = fakeAgent([turn('I think it is fine'), turn(APPROVED)])
    const result = await runReview(input(agent) as never)

    expect(result).toMatchObject({ outcome: 'approved' })
    expect(agent.prompts).toHaveLength(2)
    expect(agent.prompts[1]).toContain('could not be parsed')
    expect(events.map((event) => event.code)).toContain('review.parse_failed')
  })

  it('blocks with parse_failed and keeps the raw output after a second failure', async () => {
    seed()
    const agent = fakeAgent([turn('nope'), turn('still nope')])
    const result = await runReview(input(agent) as never)

    expect(result).toMatchObject({ outcome: 'parse-failed' })
    expect(agent.prompts).toHaveLength(2)
    expect(readRunSnapshot(dir, runId)!.tasks[0]).toMatchObject({
      lane: 'blocked',
      attention: { reason: 'review.parse_failed', action: 'fix' },
      review: { raw: 'still nope' },
    })
  })

  it('blocks when the review session errors out', async () => {
    seed()
    const agent = fakeAgent([turn('boom', true)])
    const result = await runReview(input(agent) as never)

    expect(result).toMatchObject({ outcome: 'error' })
    expect(readRunSnapshot(dir, runId)!.tasks[0]).toMatchObject({
      lane: 'blocked',
      attention: { reason: 'review.error', action: 'fix' },
    })
  })

  it('resolves stale comments when the follow-up review approves', async () => {
    seed({
      verdict: 'needs_changes',
      summary: 'old',
      at: '2026-10-28T10:00:00.000Z',
      comments: [{ id: 'c1', body: 'old issue', severity: 'blocker', status: 'open' }],
    })
    const agent = fakeAgent([turn(APPROVED)])
    const result = await runReview(input(agent) as never)

    expect(result).toMatchObject({ outcome: 'approved' })
    expect(readRunSnapshot(dir, runId)!.tasks[0].review?.comments).toEqual([
      { id: 'c1', body: 'old issue', severity: 'blocker', status: 'resolved' },
    ])
  })

  it('keeps matching comments when a re-review finds the same issue again', async () => {
    seed({
      verdict: 'needs_changes',
      summary: 'old',
      at: '2026-10-28T10:00:00.000Z',
      comments: [
        { id: 'c1', file: 'src/a.ts', line: 3, body: 'missing guard', severity: 'blocker', status: 'accepted' },
      ],
    })
    const agent = fakeAgent([turn(CHANGES)])
    const result = await runReview(input(agent) as never)

    expect(result).toMatchObject({ outcome: 'needs-changes' })
    expect(readRunSnapshot(dir, runId)!.tasks[0].review?.comments).toEqual([
      { id: 'c1', file: 'src/a.ts', line: 3, body: 'missing guard', severity: 'blocker', status: 'accepted' },
    ])
  })
})
