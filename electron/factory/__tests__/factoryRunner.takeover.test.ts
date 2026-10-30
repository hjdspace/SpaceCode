// @vitest-environment node
/**
 * 接管、交回与从当前阶段重试（issue 09）。
 *
 * 假会话覆盖：推送接管会话、接管占槽不派发、双驱动等待、交回验证分支、
 * 停止强制结束接管、重试复用工作树与跳过已完成阶段。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createBacklogItem } from '../backlog'
import { createFactoryRun, readRunSnapshot } from '../runs'
import { transitionTask } from '../runtime'
import { createFactoryRunner, type FactoryRunner, type FactoryRunnerDeps } from '../factoryRunner'
import { factorySessionId } from '../sessionId'
import { worktreeAbsolutePath, type GitRunner } from '../worktree'
import type { AgentPort } from '../agentEngineGateway'
import type { ImplementInput, ImplementationResult } from '../implementer'
import type { ReviewInput } from '../reviewer'
import type { BuildPromptInput } from '../prompt'
import type { FactoryTakeoverSession, FactoryTestRun } from '@/shared/factory'
import type { VerifyInput, VerifyResult } from '../verify'

let dir: string
let runId: string
const runners: FactoryRunner[] = []

function fakeGit(failures: Record<string, string> = {}): GitRunner {
  return async (args) => {
    const key = args.slice(0, 3).join(' ')
    const failure = failures[key] ?? failures[args.slice(0, 2).join(' ')]
    if (failure) return { ok: false, stdout: '', stderr: failure }
    if (args[0] === 'worktree' && args[1] === 'list') return { ok: true, stdout: '', stderr: '' }
    if (args[0] === 'status') return { ok: true, stdout: '', stderr: '' }
    if (args[0] === 'rev-parse') return { ok: true, stdout: 'abc\n', stderr: '' }
    return { ok: true, stdout: '', stderr: '' }
  }
}

/** 记录引擎回合的假 AgentPort；接管会话要真的跑在引擎上才算能对话。 */
interface AgentCalls {
  runs: Array<{ sessionId: string; prompt: string; cwd: string; permissionMode: string }>
  stops: string[]
}

function agent(calls: AgentCalls = { runs: [], stops: [] }): AgentPort {
  return {
    run: async (sessionId, prompt, options) => {
      calls.runs.push({
        sessionId,
        prompt,
        cwd: options.cwd,
        permissionMode: String(options.permissionMode),
      })
      return { text: '', isError: false, inputTokens: 0, outputTokens: 0 }
    },
    stop: async (sessionId) => {
      calls.stops.push(sessionId)
    },
    onEvent: () => () => {},
  }
}

function writeConfig(): void {
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
}

function seed(count = 1, concurrency = 4): string[] {
  writeConfig()
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const item = createBacklogItem(dir, { title: `任务 ${i + 1}`, goal: `目标 ${i + 1}` }, { genId: () => `bl-${i + 1}` })
    if (!item.ok) throw new Error('fixture backlog invalid')
    ids.push(`bl-${i + 1}`)
  }
  const created = createFactoryRun(dir, { taskIds: ids, concurrency }, { genId: () => 'run-1' })
  if (!created.ok) throw new Error('fixture run invalid')
  runId = created.snapshot.run.id
  return ids
}

interface Executed {
  inputs: ImplementInput[]
  reviews: ReviewInput[]
  prompts: BuildPromptInput[]
  pushes: FactoryTakeoverSession[]
}

function makeRunner(
  overrides: Partial<FactoryRunnerDeps> = {},
  executed: Executed = { inputs: [], reviews: [], prompts: [], pushes: [] },
): FactoryRunner {
  const deps: FactoryRunnerDeps = {
    git: fakeGit(),
    agentFactory: async () => agent(),
    buildPrompt: async (input) => {
      executed.prompts.push(input)
      return { ok: true, text: 'rendered prompt', blocked: [] }
    },
    buildReviewPrompt: async () => ({ ok: true, text: 'review prompt', blocked: [] }),
    runImplementation: async (input) => {
      executed.inputs.push(input)
      return { outcome: 'completed', iterations: 1, inputTokens: 1, outputTokens: 1 }
    },
    runReview: async (input) => {
      executed.reviews.push(input)
      return { outcome: 'approved' }
    },
    pushSession: (session) => {
      executed.pushes.push(session)
    },
    ...overrides,
  }
  const runner = createFactoryRunner(deps)
  runners.push(runner)
  return runner
}

/** 手动把任务推进到实现中/审查中并创建对应工作树目录。 */
function withWorktree(lane: 'implementing' | 'reviewing', stageIdx = 2): void {
  transitionTask(dir, runId, 'bl-1', { lane: 'implementing', stageIdx }, 'worktree.ready', {
    worktree: '.spacecode/worktrees/bl-1',
  })
  if (lane === 'reviewing') {
    transitionTask(dir, runId, 'bl-1', { lane: 'reviewing', stageIdx: 4 }, 'tests.passed', {})
  }
  mkdirSync(join(dir, '.spacecode', 'worktrees', 'bl-1'), { recursive: true })
}

function testRun(status: FactoryTestRun['status']): VerifyResult {
  return { status, command: 'npm run test', at: '2026-10-29T10:00:00.000Z', detail: '', ...(status === 'pass' ? { exitCode: 0 } : {}) }
}

function verifyWith(result: VerifyResult) {
  return async (_input: VerifyInput): Promise<VerifyResult> => result
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-takeover-'))
})
afterEach(async () => {
  while (runners.length > 0) await runners.pop()?.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('takeover', () => {
  it('pushes the takeover session for the board panel and marks the task', async () => {
    seed()
    withWorktree('implementing')
    const executed = { inputs: [], reviews: [], prompts: [], pushes: [] as FactoryTakeoverSession[] }
    const runner = makeRunner({}, executed)

    const result = await runner.takeoverTask(dir, runId, 'bl-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.session).toMatchObject({
      sessionId: factorySessionId('fac-run-1-bl-1-takeover'),
      taskId: 'bl-1',
      projectPath: worktreeAbsolutePath(dir, 'bl-1'),
      // 接管会话在看板面板里对话：不能把主聊天切到前台抢走用户视图。
      activate: false,
    })
    expect(result.session.title).toContain('任务 1')
    expect(result.session.content).toContain('目标 1')
    expect(result.session.content).toContain('.spacecode/worktrees/bl-1')
    expect(executed.pushes).toHaveLength(1)
    expect(result.snapshot.tasks[0]).toMatchObject({
      lane: 'implementing',
      takeover: { sessionId: factorySessionId('fac-run-1-bl-1-takeover') },
    })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('task.takeover')
  })

  it('keeps one slot occupied: a taken-over task blocks further dispatch', async () => {
    seed(2, 1)
    withWorktree('implementing')
    const runner = makeRunner()

    expect((await runner.takeoverTask(dir, runId, 'bl-1')).ok).toBe(true)
    await runner.resumeRun(dir, runId)
    await sleep(150)

    const snapshot = readRunSnapshot(dir, runId)!
    expect(snapshot.tasks.find((task) => task.id === 'bl-2')).toMatchObject({ lane: 'queued' })
    expect(runner.readEvents(dir, runId).some((event) => event.code === 'scheduler.claimed')).toBe(false)
  })

  it('only allows implementing or reviewing tasks', async () => {
    seed()
    const runner = makeRunner()
    expect(await runner.takeoverTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'not-takeover' })

    transitionTask(dir, runId, 'bl-1', { lane: 'implementing', stageIdx: 2 }, 'worktree.ready', {})
    expect(await runner.takeoverTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'no-worktree' })
  })

  it('waits for a running background turn before handing over (single driver)', async () => {
    seed()
    const executed: Executed = { inputs: [], reviews: [], prompts: [], pushes: [] }
    let release: (() => void) | null = null
    const runner = makeRunner(
      {
        runImplementation: async (input): Promise<ImplementationResult> => {
          executed.inputs.push(input)
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return { outcome: 'completed', iterations: 1, inputTokens: 1, outputTokens: 1 }
        },
      },
      executed,
    )
    await runner.startTask(dir, runId, 'bl-1', {})
    mkdirSync(join(dir, '.spacecode', 'worktrees', 'bl-1'), { recursive: true })

    const takeover = runner.takeoverTask(dir, runId, 'bl-1')
    await sleep(50)
    expect(executed.pushes).toHaveLength(0)

    ;(release as (() => void) | null)?.()
    const result = await takeover
    expect(result.ok).toBe(true)
    expect(executed.inputs).toHaveLength(1)
    expect(executed.pushes).toHaveLength(1)
  })

  it('hands the briefing to the takeover session engine so the panel can reply', async () => {
    seed()
    withWorktree('implementing')
    const calls: AgentCalls = { runs: [], stops: [] }
    const runner = makeRunner({ agentFactory: async () => agent(calls) })

    await runner.takeoverTask(dir, runId, 'bl-1')
    // 接管回合是后台起的，等它落到假 AgentPort 上。
    await sleep(20)

    expect(calls.runs).toHaveLength(1)
    expect(calls.runs[0]).toMatchObject({
      sessionId: factorySessionId('fac-run-1-bl-1-takeover'),
      cwd: worktreeAbsolutePath(dir, 'bl-1'),
      // 权限模式沿用领取时固化的实现阶段配置（该夹具的默认档）。
      permissionMode: 'acceptEdits',
    })
    expect(calls.runs[0].prompt).toContain('任务 1')
    expect(calls.runs[0].prompt).toContain('目标 1')
  })

  it('repeated takeover starts only one engine turn', async () => {
    seed()
    withWorktree('implementing')
    const calls: AgentCalls = { runs: [], stops: [] }
    const runner = makeRunner({ agentFactory: async () => agent(calls) })

    await runner.takeoverTask(dir, runId, 'bl-1')
    await runner.takeoverTask(dir, runId, 'bl-1')
    await sleep(20)

    expect(calls.runs).toHaveLength(1)
  })

  it('交回前先收口接管会话的引擎进程', async () => {
    seed()
    withWorktree('implementing')
    const calls: AgentCalls = { runs: [], stops: [] }
    const runner = makeRunner({ agentFactory: async () => agent(calls), verify: verifyWith(testRun('pass')) })

    await runner.takeoverTask(dir, runId, 'bl-1')
    await sleep(20)
    await runner.returnTask(dir, runId, 'bl-1')

    // 接管会话与工作树同路：交回时不留第二个驱动。
    expect(calls.stops).toContain(factorySessionId('fac-run-1-bl-1-takeover'))
  })
})

describe('return to pipeline', () => {
  it('re-runs verification and enters review when it passes', async () => {
    seed()
    withWorktree('implementing')
    const executed = { inputs: [], reviews: [], prompts: [], pushes: [] as FactoryTakeoverSession[] }
    const runner = makeRunner({ verify: verifyWith(testRun('pass')) }, executed)

    await runner.takeoverTask(dir, runId, 'bl-1')
    const result = await runner.returnTask(dir, runId, 'bl-1')
    expect(result).toMatchObject({ ok: true, verified: true })
    if (!result.ok) return
    expect(result.snapshot.tasks[0]).toMatchObject({
      lane: 'reviewing',
      stageIdx: 4,
      tests: { status: 'pass' },
    })
    expect(result.snapshot.tasks[0].takeover).toBeUndefined()

    await runner.whenIdle(runId)
    expect(executed.reviews).toHaveLength(1)
    expect(executed.reviews[0]).toMatchObject({
      sessionId: factorySessionId('fac-run-1-bl-1-review-1'),
    })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('task.returned.verified')

    // 重复交回不改动状态。
    const again = await runner.returnTask(dir, runId, 'bl-1')
    expect(again).toMatchObject({ ok: true, verified: true })
  })

  it('keeps the task taken over when the return verification fails', async () => {
    seed()
    withWorktree('implementing')
    const executed = { inputs: [], reviews: [], prompts: [], pushes: [] as FactoryTakeoverSession[] }
    const runner = makeRunner({ verify: verifyWith(testRun('fail')) }, executed)

    await runner.takeoverTask(dir, runId, 'bl-1')
    const result = await runner.returnTask(dir, runId, 'bl-1')
    expect(result).toMatchObject({ ok: true, verified: false })

    const task = readRunSnapshot(dir, runId)!.tasks[0]
    expect(task.tests).toMatchObject({ status: 'fail' })
    // 验证没过就不恢复调度：任务仍是接管中，由面板提示用户继续处理。
    expect(task.takeover).toMatchObject({ sessionId: factorySessionId('fac-run-1-bl-1-takeover') })
    expect(task.lane).toBe('implementing')
    await runner.whenIdle(runId)
    expect(executed.inputs).toHaveLength(0)
    expect(executed.reviews).toHaveLength(0)
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('task.returned.failed')
  })

  it('requires an active takeover to return', async () => {
    seed()
    withWorktree('implementing')
    const runner = makeRunner()
    expect(await runner.returnTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'not-takeover' })
  })
})

describe('stop and retry', () => {
  it('stopRun force-ends a taken-over task and clears the marker', async () => {
    seed()
    withWorktree('implementing')
    const runner = makeRunner()
    await runner.takeoverTask(dir, runId, 'bl-1')

    const stopped = await runner.stopRun(dir, runId)
    expect(stopped.ok).toBe(true)
    if (!stopped.ok) return
    expect(stopped.snapshot.tasks[0]).toMatchObject({
      lane: 'blocked',
      attention: { reason: 'stopped' },
    })
    expect(stopped.snapshot.tasks[0].takeover).toBeUndefined()
  })

  it('retries from the current stage with the existing worktree and branch', async () => {
    seed()
    withWorktree('implementing', 2)
    transitionTask(dir, runId, 'bl-1', { lane: 'blocked' }, 'app.restarted', {})
    const executed = { inputs: [], reviews: [], prompts: [], pushes: [] as FactoryTakeoverSession[] }
    const runner = makeRunner({}, executed)

    const result = await runner.retryTask(dir, runId, 'bl-1')
    expect(result.ok).toBe(true)
    await runner.whenIdle(runId)
    expect(executed.inputs).toHaveLength(1)
    expect(executed.inputs[0]).toMatchObject({
      sessionId: factorySessionId('fac-run-1-bl-1-retry'),
    })
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('task.retry')
  })

  it('skips the implement stage when the task already reached review', async () => {
    seed()
    withWorktree('reviewing')
    transitionTask(dir, runId, 'bl-1', { lane: 'blocked' }, 'app.restarted', {})
    const executed = { inputs: [], reviews: [], prompts: [], pushes: [] as FactoryTakeoverSession[] }
    const runner = makeRunner({}, executed)

    expect((await runner.retryTask(dir, runId, 'bl-1')).ok).toBe(true)
    await runner.whenIdle(runId)
    expect(executed.inputs).toHaveLength(0)
    expect(executed.reviews).toHaveLength(1)
  })

  it('requires the worktree and branch to still exist', async () => {
    seed()
    const runner = makeRunner()
    expect(await runner.retryTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'not-queued' })

    transitionTask(dir, runId, 'bl-1', { lane: 'implementing', stageIdx: 2 }, 'worktree.ready', {
      worktree: '.spacecode/worktrees/bl-1',
    })
    transitionTask(dir, runId, 'bl-1', { lane: 'blocked' }, 'app.restarted', {})
    expect(await runner.retryTask(dir, runId, 'bl-1')).toEqual({ ok: false, error: 'worktree-missing' })

    mkdirSync(join(dir, '.spacecode', 'worktrees', 'bl-1'), { recursive: true })
    const missingBranch = makeRunner({ git: fakeGit({ 'rev-parse --verify': 'fatal: bad revision' }) })
    expect(await missingBranch.retryTask(dir, runId, 'bl-1')).toMatchObject({
      ok: false,
      error: 'branch-missing',
    })
  })
})
