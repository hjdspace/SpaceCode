// @vitest-environment node
/**
 * 编排：启动前校验（不落目录）、工作树创建/复用、提示词渲染、后台实现、
 * 停止与事件推送。Agent 与实现循环用假的，Git 也注入，只跨真实文件系统。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createBacklogItem } from '../backlog'
import { createFactoryRun, createGithubRun, readRunSnapshot } from '../runs'
import { transitionTask } from '../runtime'
import { createFactoryRunner, type FactoryRunnerDeps, type SandboxSession } from '../factoryRunner'
import { factorySessionId } from '../sessionId'
import type { GitRunner } from '../worktree'
import type { AgentPort } from '../agentEngineGateway'
import type { ImplementInput, ImplementationResult } from '../implementer'
import type { ReviewInput, ReviewResult } from '../reviewer'
import type { BuildPromptInput } from '../prompt'
import type { FactoryReview, FactorySetupDraft } from '@/shared/factory'
import { FACTORY_SANDBOX_WORKTREE_ROOT } from '@/shared/factory'

let dir: string
let runId: string

function fakeGit(failures: Record<string, string> = {}): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  const git: GitRunner = async (args) => {
    calls.push(args)
    const key = args.slice(0, 3).join(' ')
    const failure = failures[key] ?? failures[args.slice(0, 2).join(' ')]
    if (failure) return { ok: false, stdout: '', stderr: failure }
    if (args[0] === 'worktree' && args[1] === 'list') return { ok: true, stdout: '', stderr: '' }
    if (args[0] === 'status') return { ok: true, stdout: '', stderr: '' }
    if (args[0] === 'rev-parse') return { ok: true, stdout: 'abc\n', stderr: '' }
    return { ok: true, stdout: '', stderr: '' }
  }
  return { git, calls }
}

function seed(
  tasks = 1,
  sandbox: NonNullable<FactorySetupDraft['sandbox']> = { type: 'worktree' },
): string[] {
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
      sandbox,
      tracker: { type: 'local', mergeMode: 'local' },
      commands: { verify: 'npm run test' },
    },
    { baseBranch: 'main' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  writeFactoryConfigAtomic(dir, built.config)

  const ids: string[] = []
  let counter = 0
  for (let i = 0; i < tasks; i++) {
    const item = createBacklogItem(
      dir,
      { title: `任务 ${i + 1}`, goal: '目标' },
      { genId: () => `bl-${++counter}` },
    )
    if (!item.ok) throw new Error('fixture backlog invalid')
    ids.push(`bl-${counter}`)
  }
  const created = createFactoryRun(dir, { taskIds: ids }, { genId: () => 'run-1' })
  if (!created.ok) throw new Error('fixture run invalid')
  runId = created.snapshot.run.id
  return ids
}

function agent(): AgentPort {
  return {
    run: async () => ({ text: '<promise>COMPLETE</promise>', isError: false, inputTokens: 1, outputTokens: 1 }),
    stop: async () => {},
    onEvent: () => () => {},
  }
}

function deps(overrides: Partial<FactoryRunnerDeps> = {}): FactoryRunnerDeps {
  const { git } = fakeGit()
  return {
    git,
    agentFactory: async () => agent(),
    buildPrompt: async () => ({ ok: true, text: 'rendered prompt', blocked: [] }),
    runImplementation: async (input: ImplementInput): Promise<ImplementationResult> => ({
      outcome: 'completed',
      iterations: 1,
      inputTokens: input.task.id === '' ? 0 : 1,
      outputTokens: 1,
    }),
    ...overrides,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-runner-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('startTask validation', () => {
  it('refuses tasks that are not queued without creating a worktree', async () => {
    seed()
    transitionTask(dir, runId, 'bl-1', { lane: 'implementing', stageIdx: 2 }, 'worktree.ready', {})
    const { git, calls } = fakeGit()
    const runner = createFactoryRunner(deps({ git }))
    const result = await runner.startTask(dir, runId, 'bl-1', {})
    expect(result).toEqual({ ok: false, error: 'not-queued' })
    expect(existsSync(join(dir, '.spacecode/worktrees'))).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('blocks a dirty repository unless the user confirmed it', async () => {
    seed()
    const dirty = fakeGit()
    dirty.git = async (args) => {
      if (args[0] === 'status') return { ok: true, stdout: ' M src/a.ts\n', stderr: '' }
      return { ok: true, stdout: '', stderr: '' }
    }
    const runner = createFactoryRunner(deps({ git: dirty.git }))
    expect(await runner.startTask(dir, runId, 'bl-1', {})).toEqual({
      ok: false,
      error: 'dirty-worktree',
      detail: '1',
    })
    expect(existsSync(join(dir, '.spacecode/worktrees'))).toBe(false)

    const confirmed = await runner.startTask(dir, runId, 'bl-1', { confirmDirty: true })
    expect(confirmed.ok).toBe(true)
    await runner.whenIdle(runId)
  })

  it('reports missing base branches before adding a worktree', async () => {
    seed()
    const { git, calls } = fakeGit({ 'rev-parse --verify': 'fatal: Needed a single revision' })
    const runner = createFactoryRunner(deps({ git }))
    const result = await runner.startTask(dir, runId, 'bl-1', {})
    expect(result).toMatchObject({ ok: false, error: 'base-branch-missing' })
    expect(calls.some((args) => args[0] === 'worktree' && args[1] === 'add')).toBe(false)
    expect(existsSync(join(dir, '.spacecode/worktrees'))).toBe(false)
  })

  it('reports a missing config before touching the repository', async () => {
    seed()
    rmSync(join(dir, '.spacecode/factory/config.json'))
    const { git, calls } = fakeGit()
    const runner = createFactoryRunner(deps({ git }))
    expect(await runner.startTask(dir, runId, 'bl-1', {})).toEqual({ ok: false, error: 'config-missing' })
    expect(calls).toHaveLength(0)
  })

  it('reports unknown tasks and runs', async () => {
    seed()
    const runner = createFactoryRunner(deps())
    expect(await runner.startTask(dir, runId, 'bl-404', {})).toEqual({ ok: false, error: 'task-not-found' })
    expect(await runner.startTask(dir, 'run-404', 'bl-1', {})).toEqual({ ok: false, error: 'task-not-found' })
  })

  it('turns a prompt failure into a blocked task without starting the agent', async () => {
    seed()
    let agentCreated = 0
    const runner = createFactoryRunner(
      deps({
        agentFactory: async () => {
          agentCreated++
          return agent()
        },
        buildPrompt: async () => ({ ok: false, error: 'prompt-error' }),
      }),
    )
    const result = await runner.startTask(dir, runId, 'bl-1', {})
    expect(result).toMatchObject({ ok: false, error: 'prompt-error' })
    expect(agentCreated).toBe(0)
    expect(readRunSnapshot(dir, runId)!.tasks[0]).toMatchObject({
      lane: 'blocked',
      attention: { reason: 'prompt.error' },
    })
  })
})

describe('startTask happy path', () => {
  it('creates the worktree, records projection and runs the implementer', async () => {
    seed()
    const { git, calls } = fakeGit()
    const seen: ImplementInput[] = []
    const runner = createFactoryRunner(
      deps({
        git,
        runImplementation: async (input) => {
          seen.push(input)
          return { outcome: 'completed', iterations: 2, inputTokens: 9, outputTokens: 3 }
        },
      }),
    )

    const result = await runner.startTask(dir, runId, 'bl-1', {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.tasks[0]).toMatchObject({
      lane: 'implementing',
      stageIdx: 2,
      worktree: '.spacecode/worktrees/bl-1',
      branch: 'agent/task-bl-1',
    })
    expect(result.snapshot.run).toMatchObject({ status: 'running' })

    await runner.whenIdle(runId)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      sessionId: factorySessionId('fac-run-1-bl-1-impl'),
      worktreeAbsolute: join(dir, '.spacecode', 'worktrees', 'bl-1'),
      baseBranch: 'main',
      permissionMode: 'acceptEdits',
      prompt: 'rendered prompt',
    })
    expect(calls.some((args) => args[0] === 'worktree' && args[1] === 'add')).toBe(true)

    const events = runner.readEvents(dir, runId)
    expect(events.map((event) => event.code)).toEqual(
      expect.arrayContaining(['task.started', 'worktree.created']),
    )
    expect(events[0].runId).toBe('run-1')
  })

  it('reuses an existing worktree on retry and emits worktree.reused', async () => {
    seed()
    const calls: string[][] = []
    const listPath = join(dir, '.spacecode', 'worktrees', 'bl-1')
    const retryGit: GitRunner = async (args) => {
      calls.push(args)
      if (args[0] === 'worktree' && args[1] === 'list') {
        return { ok: true, stdout: `worktree ${listPath}\nHEAD abc\nbranch refs/heads/agent/task-bl-1\n\n`, stderr: '' }
      }
      if (args[0] === 'status') return { ok: true, stdout: '', stderr: '' }
      if (args[0] === 'rev-parse') return { ok: true, stdout: 'abc\n', stderr: '' }
      return { ok: true, stdout: '', stderr: '' }
    }
    const runner = createFactoryRunner(deps({ git: retryGit }))

    await runner.startTask(dir, runId, 'bl-1', {})
    await runner.whenIdle(runId)
    transitionTask(dir, runId, 'bl-1', { lane: 'blocked' }, 'stopped', {})
    mkdirSync(listPath, { recursive: true })

    const again = await runner.startTask(dir, runId, 'bl-1', {})
    expect(again.ok).toBe(true)
    await runner.whenIdle(runId)
    expect(calls.some((args) => args[0] === 'worktree' && args[1] === 'add')).toBe(false)
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('worktree.reused')
  })
})

describe('stop', () => {
  it('stopTask aborts the run, blocks the task and keeps the worktree', async () => {
    seed()
    let aborted = false
    const runner = createFactoryRunner(
      deps({
        runImplementation: async (input) => {
          await new Promise<void>((resolve) => {
            input.signal.addEventListener('abort', () => {
              aborted = true
              resolve()
            })
          })
          return { outcome: 'stopped', iterations: 1, inputTokens: 0, outputTokens: 0 }
        },
      }),
    )
    await runner.startTask(dir, runId, 'bl-1', {})
    const stopped = await runner.stopTask(dir, runId, 'bl-1')
    expect(aborted).toBe(true)
    expect(stopped.ok).toBe(true)
    if (!stopped.ok) return
    expect(stopped.snapshot.tasks[0]).toMatchObject({
      lane: 'blocked',
      worktree: '.spacecode/worktrees/bl-1',
      attention: { reason: 'stopped' },
    })
    expect(await runner.stopTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'not-running' })
  })

  it('stopRun aborts every running task and marks the run stopped', async () => {
    const ids = seed(2)
    const runner = createFactoryRunner(
      deps({
        runImplementation: async (input) => {
          await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve()))
          return { outcome: 'stopped', iterations: 1, inputTokens: 0, outputTokens: 0 }
        },
      }),
    )
    await runner.startTask(dir, runId, ids[0], {})
    await runner.startTask(dir, runId, ids[1], {})
    const result = await runner.stopRun(dir, runId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.run.status).toBe('stopped')
    expect(result.snapshot.tasks.map((task) => task.lane)).toEqual(['blocked', 'blocked'])
    expect(runner.readEvents(dir, runId).some((event) => event.code === 'run.stopped')).toBe(true)
  })

  it('rejects stop for unknown runs and tasks', async () => {
    seed()
    const runner = createFactoryRunner(deps())
    expect(await runner.stopRun(dir, 'run-404')).toEqual({ ok: false, error: 'run-not-found' })
    expect(await runner.stopTask(dir, runId, 'bl-404')).toEqual({ ok: false, error: 'not-running' })
  })
})

describe('revealWorktree', () => {
  it('reveals an existing worktree through the injected revealer', async () => {
    seed()
    let revealed: string | null = null
    const runner = createFactoryRunner(deps({ revealPath: (path) => { revealed = path } }))
    await runner.startTask(dir, runId, 'bl-1', {})
    await runner.whenIdle(runId)
    mkdirSync(join(dir, '.spacecode', 'worktrees', 'bl-1'), { recursive: true })
    expect(await runner.revealWorktree(dir, runId, 'bl-1')).toEqual({ ok: true })
    expect(revealed).toBe(join(dir, '.spacecode', 'worktrees', 'bl-1'))
  })

  it('reports tasks without a worktree', async () => {
    seed()
    const runner = createFactoryRunner(deps())
    expect(await runner.revealWorktree(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'no-worktree' })
    expect(await runner.revealWorktree(dir, runId, 'bl-404')).toEqual({ ok: false, error: 'task-not-found' })
  })
})

/** 把任务推进到审查泳道，并可附带验证与审查投影。 */
function toReviewing(review?: FactoryReview, tests: 'pass' | 'fail' = 'pass'): void {
  transitionTask(dir, runId, 'bl-1', { lane: 'implementing', stageIdx: 2 }, 'worktree.ready', {
    worktree: '.spacecode/worktrees/bl-1',
  })
  transitionTask(
    dir,
    runId,
    'bl-1',
    { lane: 'reviewing', stageIdx: 4 },
    'tests.passed',
    {
      tests: { status: tests, command: 'npm run test', at: '2026-10-28T10:00:00.000Z' },
      ...(review ? { review } : {}),
    },
  )
}

const APPROVED_REVIEW: FactoryReview = {
  verdict: 'approved',
  summary: 'Looks good',
  comments: [],
  at: '2026-10-28T10:00:00.000Z',
}

describe('review orchestration', () => {
  it('starts a fresh review session after a verified implementation', async () => {
    seed()
    let reviewInput: ReviewInput | null = null
    const runner = createFactoryRunner(
      deps({
        runImplementation: async () => ({
          outcome: 'completed',
          verified: true,
          iterations: 1,
          inputTokens: 1,
          outputTokens: 1,
        }),
        buildReviewPrompt: async () => ({ ok: true, text: 'review prompt', blocked: [] }),
        runReview: async (input): Promise<ReviewResult> => {
          reviewInput = input
          return { outcome: 'approved' }
        },
      }),
    )

    await runner.startTask(dir, runId, 'bl-1', {})
    await runner.whenIdle(runId)

    expect(reviewInput).toMatchObject({
      sessionId: factorySessionId('fac-run-1-bl-1-review-1'),
      prompt: 'review prompt',
      permissionMode: 'acceptEdits',
      worktreeAbsolute: join(dir, '.spacecode', 'worktrees', 'bl-1'),
    })
  })

  it('does not review when the implementation only reached verification failure', async () => {
    seed()
    let reviews = 0
    const runner = createFactoryRunner(
      deps({
        runImplementation: async () => ({
          outcome: 'tests-failed',
          iterations: 2,
          inputTokens: 1,
          outputTokens: 1,
        }),
        runReview: async () => {
          reviews++
          return { outcome: 'approved' }
        },
      }),
    )

    await runner.startTask(dir, runId, 'bl-1', {})
    await runner.whenIdle(runId)
    expect(reviews).toBe(0)
  })
})

describe('approve and change requests', () => {
  it('moves an eligible task to mergeable when approved', async () => {
    seed()
    toReviewing(APPROVED_REVIEW)
    const runner = createFactoryRunner(deps())

    const result = await runner.approveTask(dir, runId, 'bl-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.tasks[0]).toMatchObject({ lane: 'mergeable', stageIdx: 5 })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('task.approved')
  })

  it('refuses to approve without a passing verification', async () => {
    seed()
    toReviewing(APPROVED_REVIEW, 'fail')
    const runner = createFactoryRunner(deps())
    expect(await runner.approveTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'not-eligible' })
  })

  it('refuses to approve while blocker comments are open', async () => {
    seed()
    toReviewing({
      ...APPROVED_REVIEW,
      comments: [{ id: 'c1', body: 'needs a guard', severity: 'blocker', status: 'open' }],
    })
    const runner = createFactoryRunner(deps())
    expect(await runner.approveTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'not-eligible' })
  })

  it('blocks the task when the user requests changes', async () => {
    seed()
    toReviewing(APPROVED_REVIEW)
    const runner = createFactoryRunner(deps())

    const result = await runner.requestChanges(dir, runId, 'bl-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.tasks[0]).toMatchObject({
      lane: 'blocked',
      attention: { reason: 'review.changes_requested', action: 'fix' },
    })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('task.changes_requested')
  })
})

/**
 * 放弃：把队列/阻塞任务直接落到已完成泳道并标记取消。
 * 分支与工作树必须原样保留，GitHub 来源也不能被顺手评论或关闭。
 */
describe('abandon', () => {
  it('moves a queued task to done marked cancelled and records the event', async () => {
    seed()
    const runner = createFactoryRunner(deps())

    const result = await runner.cancelTask(dir, runId, 'bl-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.tasks[0]).toMatchObject({
      lane: 'done',
      stageIdx: 6,
      cancelled: true,
    })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('task.cancelled')
  })

  it('keeps the branch and worktree of a blocked task on disk', async () => {
    seed()
    const worktreeDir = join(dir, '.spacecode', 'worktrees', 'bl-1')
    mkdirSync(worktreeDir, { recursive: true })
    writeFileSync(join(worktreeDir, 'keep-me.txt'), '产出还在\n')
    transitionTask(dir, runId, 'bl-1', { lane: 'implementing', stageIdx: 2 }, 'worktree.ready', {
      worktree: '.spacecode/worktrees/bl-1',
    })
    transitionTask(dir, runId, 'bl-1', { lane: 'blocked' }, 'tests.failed', {})

    const runner = createFactoryRunner(deps())
    expect((await runner.cancelTask(dir, runId, 'bl-1')).ok).toBe(true)

    const task = readRunSnapshot(dir, runId)!.tasks[0]
    expect(task).toMatchObject({
      lane: 'done',
      cancelled: true,
      worktree: '.spacecode/worktrees/bl-1',
      branch: 'agent/task-bl-1',
    })
    expect(task.attention).toBeUndefined()
    expect(existsSync(join(worktreeDir, 'keep-me.txt'))).toBe(true)
  })

  it('refuses a second abandon', async () => {
    seed()
    const runner = createFactoryRunner(deps())
    expect((await runner.cancelTask(dir, runId, 'bl-1')).ok).toBe(true)
    expect(await runner.cancelTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'not-cancellable' })
  })

  it('refuses lanes the run is still advancing', async () => {
    seed()
    toReviewing(APPROVED_REVIEW)
    const runner = createFactoryRunner(deps())
    expect(await runner.cancelTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'not-cancellable' })
  })

  it('refuses to abandon while a background round is still running', async () => {
    seed()
    const runner = createFactoryRunner(
      deps({
        runImplementation: async (input) => {
          await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve()))
          return { outcome: 'stopped', iterations: 1, inputTokens: 0, outputTokens: 0 }
        },
      }),
    )
    await runner.startTask(dir, runId, 'bl-1', {})
    expect(await runner.cancelTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'already-running' })

    await runner.stopTask(dir, runId, 'bl-1')
    expect(await runner.cancelTask(dir, runId, 'bl-1')).toMatchObject({ ok: true })
  })

  it('reports a missing task without touching the run', async () => {
    seed()
    const runner = createFactoryRunner(deps())
    expect(await runner.cancelTask(dir, runId, 'bl-404')).toEqual({ ok: false, error: 'task-not-found' })
    expect(readRunSnapshot(dir, runId)!.tasks[0].lane).toBe('queued')
  })

  it('comments and closes nothing for a GitHub-sourced task', async () => {
    seed()
    let writeBackCalls = 0
    const created = createGithubRun(dir, {
      runId: 'run-2',
      tasks: [{ issueNumber: 42, title: '线上回归', goal: '放弃它' }],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const runner = createFactoryRunner(deps({ mergeWriteBack: () => { writeBackCalls += 1 } }))
    const result = await runner.cancelTask(dir, 'run-2', created.snapshot.tasks[0].id)
    expect(result.ok).toBe(true)

    const task = readRunSnapshot(dir, 'run-2')!.tasks[0]
    expect(task).toMatchObject({ source: 'github-issues', issueNumber: 42, cancelled: true })
    expect(task.writeback).toBeUndefined()
    expect(task.pullRequest).toBeUndefined()
    expect(writeBackCalls).toBe(0)
    expect(
      runner.readEvents(dir, 'run-2').some((event) => event.code.startsWith('github.writeback')),
    ).toBe(false)
  })
})

describe('review comments', () => {
  const blocker: FactoryReview = {
    verdict: 'needs_changes',
    summary: 'one blocker',
    at: '2026-10-28T10:00:00.000Z',
    comments: [{ id: 'c1', file: 'src/a.ts', line: 3, body: 'missing guard', severity: 'blocker', status: 'open' }],
  }

  it('accepts a single comment and records the event', async () => {
    seed()
    toReviewing(blocker)
    const runner = createFactoryRunner(deps())

    const result = await runner.updateComment(dir, runId, 'bl-1', { commentId: 'c1', action: 'accept' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.tasks[0].review?.comments[0]).toMatchObject({ id: 'c1', status: 'accepted' })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('review.comment.accepted')
  })

  it('requires confirmation before ignoring a blocker', async () => {
    seed()
    toReviewing(blocker)
    const runner = createFactoryRunner(deps())

    expect(await runner.updateComment(dir, runId, 'bl-1', { commentId: 'c1', action: 'ignore' })).toEqual({
      ok: false,
      error: 'confirm-required',
    })
    const confirmed = await runner.updateComment(dir, runId, 'bl-1', {
      commentId: 'c1',
      action: 'ignore',
      confirm: true,
    })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.snapshot.tasks[0].review?.comments[0]).toMatchObject({ status: 'ignored' })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('review.comment.ignored')
  })

  it('reports unknown comments and tasks without a review', async () => {
    seed()
    toReviewing(blocker)
    const runner = createFactoryRunner(deps())
    expect(await runner.updateComment(dir, runId, 'bl-1', { commentId: 'c9', action: 'accept' })).toEqual({
      ok: false,
      error: 'not-fixable',
    })
  })
})

describe('fix loop', () => {
  it('reopens a fresh fix session with the pending comments, then reviews again', async () => {
    seed()
    toReviewing({
      verdict: 'needs_changes',
      summary: 'one blocker',
      at: '2026-10-28T10:00:00.000Z',
      comments: [{ id: 'c1', file: 'src/a.ts', line: 3, body: 'missing guard', severity: 'blocker', status: 'open' }],
    })
    transitionTask(dir, runId, 'bl-1', { lane: 'blocked' }, 'review.needs_changes', {})

    const prompts: BuildPromptInput[] = []
    const seen: ImplementInput[] = []
    let reviewInput: ReviewInput | null = null
    const runner = createFactoryRunner(
      deps({
        buildFixPrompt: async (input) => {
          prompts.push(input)
          return { ok: true, text: 'fix prompt', blocked: [] }
        },
        runImplementation: async (input) => {
          seen.push(input)
          return { outcome: 'completed', verified: true, iterations: 1, inputTokens: 1, outputTokens: 1 }
        },
        buildReviewPrompt: async () => ({ ok: true, text: 'review prompt', blocked: [] }),
        runReview: async (input) => {
          reviewInput = input
          return { outcome: 'approved' }
        },
      }),
    )

    const result = await runner.fixTask(dir, runId, 'bl-1')
    expect(result.ok).toBe(true)
    await runner.whenIdle(runId)

    expect(prompts).toHaveLength(1)
    expect(prompts[0].promptPath).toBe('.spacecode/factory/prompts/fix.md')
    expect(prompts[0].reviewComments).toContain('missing guard')
    expect(prompts[0].reviewComments).toContain('src/a.ts:3')

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      sessionId: factorySessionId('fac-run-1-bl-1-fix'),
      prompt: 'fix prompt',
      verifyCommand: 'npm run test',
    })
    expect(reviewInput).toMatchObject({ sessionId: factorySessionId('fac-run-1-bl-1-review-2') })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('task.fix.started')
  })

  it('refuses to fix when there is nothing actionable', async () => {
    seed()
    toReviewing(APPROVED_REVIEW)
    const runner = createFactoryRunner(deps())
    expect(await runner.fixTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'not-fixable' })
  })

  it('refuses to fix whenever the task has no worktree', async () => {
    seed()
    const runner = createFactoryRunner(deps())
    expect(await runner.fixTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'no-worktree' })
  })
})

describe('docker sandbox execution', () => {
  function containerSession(calls: string[]): SandboxSession {
    return {
      agent: agent(),
      verify: async () => {
        calls.push('verify')
        return { status: 'pass', command: 'npm run test', at: '2026-10-29T10:00:00.000Z', detail: '' }
      },
      close: async () => {
        calls.push('close')
      },
    }
  }

  it('runs implementation and review in the container, never the host agent, then closes it', async () => {
    seed(1, { type: 'docker', imageName: 'spacecode-factory:latest' })
    const calls: string[] = []
    const session = containerSession(calls)
    let hostAgents = 0
    let seenAgent: AgentPort | null = null
    let seenVerify = false
    let sandboxInputs = 0

    const runner = createFactoryRunner(
      deps({
        agentFactory: async () => {
          hostAgents++
          return agent()
        },
        sandboxFactory: async (input) => {
          sandboxInputs++
          expect(input.sandbox.imageName).toBe('spacecode-factory:latest')
          return { ok: true, session }
        },
        runImplementation: async (input) => {
          seenAgent = input.deps.agent
          seenVerify = typeof input.deps.verify === 'function'
          return { outcome: 'completed', verified: true, iterations: 1, inputTokens: 1, outputTokens: 1 }
        },
        buildReviewPrompt: async () => ({ ok: true, text: 'review prompt', blocked: [] }),
        runReview: async () => ({ outcome: 'approved' }),
      }),
    )

    const result = await runner.startTask(dir, runId, 'bl-1', {})
    expect(result.ok).toBe(true)
    await runner.whenIdle(runId)

    expect(hostAgents).toBe(0)
    expect(seenAgent).toBe(session.agent)
    expect(seenVerify).toBe(true)
    expect(sandboxInputs).toBeGreaterThanOrEqual(1)
    expect(calls).toContain('close')
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('sandbox.started')
  })

  it('blocks without falling back to the host when the sandbox cannot start', async () => {
    seed(1, { type: 'docker', imageName: 'spacecode-factory:latest' })
    let hostAgents = 0
    const runner = createFactoryRunner(
      deps({
        agentFactory: async () => {
          hostAgents++
          return agent()
        },
        sandboxFactory: async () => ({
          ok: false,
          error: 'sandbox-unavailable',
          detail: 'docker daemon down',
        }),
      }),
    )

    const result = await runner.startTask(dir, runId, 'bl-1', {})
    expect(result).toMatchObject({
      ok: false,
      error: 'sandbox-unavailable',
      detail: 'docker daemon down',
    })
    expect(hostAgents).toBe(0)
    expect(readRunSnapshot(dir, runId)!.tasks[0]).toMatchObject({
      lane: 'blocked',
      attention: { reason: 'sandbox.unavailable' },
    })
    const codes = runner.readEvents(dir, runId).map((event) => event.code)
    expect(codes).toContain('sandbox.unavailable')
    expect(codes).not.toContain('sandbox.fallback')
  })

  it('falls back to the local worktree only when the retry explicitly asks', async () => {
    seed(1, { type: 'docker', imageName: 'spacecode-factory:latest' })
    const runner = createFactoryRunner(
      deps({
        sandboxFactory: async () => ({ ok: false, error: 'sandbox-unavailable' }),
      }),
    )
    await runner.startTask(dir, runId, 'bl-1', {})
    mkdirSync(join(dir, '.spacecode', 'worktrees', 'bl-1'), { recursive: true })

    const retried = await runner.retryTask(dir, runId, 'bl-1', { sandbox: 'worktree' })
    expect(retried.ok).toBe(true)
    expect(readRunSnapshot(dir, runId)!.tasks[0].configSnapshot?.sandbox).toEqual({
      type: 'worktree',
      root: FACTORY_SANDBOX_WORKTREE_ROOT,
    })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('sandbox.fallback')
    await runner.whenIdle(runId)
  })
})
