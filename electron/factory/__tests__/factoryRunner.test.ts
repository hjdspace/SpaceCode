// @vitest-environment node
/**
 * 编排：启动前校验（不落目录）、工作树创建/复用、提示词渲染、后台实现、
 * 停止与事件推送。Agent 与实现循环用假的，Git 也注入，只跨真实文件系统。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createBacklogItem } from '../backlog'
import { createFactoryRun, readRunSnapshot } from '../runs'
import { transitionTask } from '../runtime'
import { createFactoryRunner, type FactoryRunnerDeps } from '../factoryRunner'
import type { GitRunner } from '../worktree'
import type { AgentPort } from '../agentEngineGateway'
import type { ImplementInput, ImplementationResult } from '../implementer'

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

function seed(tasks = 1): string[] {
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
      sessionId: 'fac-run-1-bl-1-impl',
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
