// @vitest-environment node
/**
 * 运行调度：并发闸门、依赖、暂停/恢复、停止与配置快照隔离。
 *
 * 假 Agent 与假实现循环负责「占住槽位」，假 Git 只负责通过启动校验；
 * 断言全部落在真实 runner 与真实落盘投影上。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, readFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createBacklogItem } from '../backlog'
import { createFactoryRun, readRunSnapshot } from '../runs'
import { transitionTask } from '../runtime'
import { createFactoryRunner, type FactoryRunner, type FactoryRunnerDeps } from '../factoryRunner'
import type { GitRunner } from '../worktree'
import type { AgentPort } from '../agentEngineGateway'
import type { ImplementInput, ImplementationResult } from '../implementer'

let dir: string
let runId: string
const runners: FactoryRunner[] = []

interface Gate {
  started: string[]
  inputs: ImplementInput[]
  active: number
  peak: number
  pending: Array<() => void>
  release(count?: number): void
}

function createGate(): Gate {
  const gate: Gate = {
    started: [],
    inputs: [],
    active: 0,
    peak: 0,
    pending: [],
    release(count = 1) {
      const jobs = this.pending.splice(0, count)
      for (const job of jobs) job()
    },
  }
  return gate
}

function gatedImplementation(gate: Gate) {
  return async (input: ImplementInput): Promise<ImplementationResult> => {
    gate.started.push(input.task.id)
    gate.inputs.push(input)
    gate.active += 1
    gate.peak = Math.max(gate.peak, gate.active)
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      gate.pending.push(done)
      input.signal.addEventListener('abort', done, { once: true })
    })
    gate.active -= 1
    return { outcome: 'stopped', iterations: 1, inputTokens: 0, outputTokens: 0 }
  }
}

function fakeGit(): GitRunner {
  return async (args) => {
    if (args[0] === 'worktree' && args[1] === 'list') return { ok: true, stdout: '', stderr: '' }
    if (args[0] === 'status') return { ok: true, stdout: '', stderr: '' }
    if (args[0] === 'rev-parse') return { ok: true, stdout: 'abc\n', stderr: '' }
    return { ok: true, stdout: '', stderr: '' }
  }
}

function agent(): AgentPort {
  return {
    run: async () => ({ text: '', isError: false, inputTokens: 0, outputTokens: 0 }),
    stop: async () => {},
    onEvent: () => () => {},
  }
}

function writeConfig(overrides: { verify?: string; revision?: number } = {}): void {
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'worktree' },
      tracker: { type: 'local', mergeMode: 'local' },
      commands: { verify: overrides.verify ?? 'npm run test' },
    },
    { baseBranch: 'main' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  const config = { ...built.config, ...(overrides.revision ? { revision: overrides.revision } : {}) }
  writeFactoryConfigAtomic(dir, config)
}

function seedTasks(
  count: number,
  options: {
    concurrency?: number
    dependencies?: (ids: string[]) => Record<string, string[]>
  } = {},
): string[] {
  writeConfig()
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const item = createBacklogItem(
      dir,
      { title: `任务 ${i + 1}`, goal: '目标' },
      { genId: () => `bl-${i + 1}` },
    )
    if (!item.ok) throw new Error('fixture backlog invalid')
    ids.push(`bl-${i + 1}`)
  }
  const created = createFactoryRun(
    dir,
    {
      taskIds: ids,
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      ...(options.dependencies ? { dependencies: options.dependencies(ids) } : {}),
    },
    { genId: () => 'run-1' },
  )
  if (!created.ok) throw new Error('fixture run invalid')
  runId = created.snapshot.run.id
  return ids
}

function makeRunner(gate: Gate, overrides: Partial<FactoryRunnerDeps> = {}): FactoryRunner {
  const deps: FactoryRunnerDeps = {
    git: fakeGit(),
    agentFactory: async () => agent(),
    buildPrompt: async () => ({ ok: true, text: 'rendered prompt', blocked: [] }),
    buildReviewPrompt: async () => ({ ok: true, text: 'review prompt', blocked: [] }),
    runImplementation: gatedImplementation(gate),
    ...overrides,
  }
  const runner = createFactoryRunner(deps)
  runners.push(runner)
  return runner
}

async function waitFor(assertion: () => boolean, label: string, timeout = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timeout waiting for ${label}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-scheduler-'))
})
afterEach(async () => {
  while (runners.length > 0) await runners.pop()?.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('concurrency gate', () => {
  it('fills slots up to the configured limit and claims the next on release', async () => {
    const ids = seedTasks(3, { concurrency: 2 })
    const gate = createGate()
    const runner = makeRunner(gate)

    const resumed = await runner.resumeRun(dir, runId)
    expect(resumed.ok).toBe(true)
    await waitFor(() => gate.started.length === 2, 'two tasks running')
    expect(gate.peak).toBe(2)

    gate.release(1)
    await waitFor(() => gate.started.length === 3, 'third task claimed')
    expect(gate.peak).toBe(2)
    expect(new Set(gate.started)).toEqual(new Set(ids))
  })

  it('keeps one slot per task across implementation and review', async () => {
    const ids = seedTasks(2, { concurrency: 1 })
    const gate = createGate()
    let reviewActive = 0
    let peak = 0
    const runner = makeRunner(gate, {
      runImplementation: async (input): Promise<ImplementationResult> => {
        gate.started.push(input.task.id)
        gate.inputs.push(input)
        gate.active += 1
        peak = Math.max(peak, gate.active)
        gate.active -= 1
        return { outcome: 'completed', verified: true, iterations: 1, inputTokens: 1, outputTokens: 1 }
      },
      runReview: async () => {
        reviewActive += 1
        peak = Math.max(peak, gate.active + reviewActive)
        reviewActive -= 1
        return { outcome: 'approved' }
      },
    })

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.inputs.length === 2, 'both tasks claimed')
    expect(peak).toBe(1)
    expect(gate.inputs.map((input) => input.task.id)).toEqual(ids)
  })

  it('records claim and waiting-for-slot events', async () => {
    seedTasks(2, { concurrency: 1 })
    const gate = createGate()
    const runner = makeRunner(gate)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 1, 'first claim')
    await waitFor(
      () => runner.readEvents(dir, runId).some((event) => event.code === 'scheduler.waiting'),
      'waiting event',
    )

    const codes = runner.readEvents(dir, runId).map((event) => event.code)
    expect(codes).toContain('scheduler.claimed')
    expect(codes).toContain('scheduler.waiting')
  })
})

describe('dependencies', () => {
  it('does not claim a task before its dependency is done', async () => {
    const ids = seedTasks(3, {
      concurrency: 2,
      dependencies: (all) => ({ [all[1]]: [all[0]] }),
    })
    const gate = createGate()
    const runner = makeRunner(gate)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 2, 'independent tasks claimed')
    expect(gate.started).toEqual([ids[0], ids[2]])

    // 释放一个槽位：依赖尚未完成，泵不能领取 bl-2。
    gate.release(1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(gate.started).toHaveLength(2)

    transitionTask(dir, runId, ids[0], { lane: 'done' }, 'merged')

    await runner.resumeRun(dir, runId)
    await waitFor(
      () => gate.inputs.some((input) => input.task.id === ids[1]),
      'dependent task claimed',
    )
    expect(gate.inputs.map((input) => input.task.id)).toContain(ids[1])
  })
})

describe('pause and resume', () => {
  it('stops claiming new tasks while paused and resumes afterwards', async () => {
    seedTasks(3, { concurrency: 2 })
    const gate = createGate()
    const runner = makeRunner(gate)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 2, 'two tasks running')

    const paused = await runner.pauseRun(dir, runId)
    expect(paused.ok).toBe(true)
    if (!paused.ok) return
    expect(paused.snapshot.run).toMatchObject({ status: 'paused', paused: true })

    gate.release(1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(gate.started).toHaveLength(2)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 3, 'third task claimed after resume')
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toEqual(
      expect.arrayContaining(['run.paused', 'run.resumed']),
    )
  })

  it('rejects pause and resume for stopped runs', async () => {
    seedTasks(1, { concurrency: 1 })
    const gate = createGate()
    const runner = makeRunner(gate)
    await runner.stopRun(dir, runId)

    expect(await runner.pauseRun(dir, runId)).toEqual({ ok: false, error: 'run-stopped' })
    expect(await runner.resumeRun(dir, runId)).toEqual({ ok: false, error: 'run-stopped' })
    expect(await runner.resumeRun(dir, 'run-404')).toEqual({ ok: false, error: 'run-not-found' })
  })
})

describe('stop', () => {
  it('aborts running sessions, blocks tasks and refuses further claims', async () => {
    const ids = seedTasks(3, { concurrency: 2 })
    const gate = createGate()
    const runner = makeRunner(gate)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 2, 'two tasks running')

    const stopped = await runner.stopRun(dir, runId)
    expect(stopped.ok).toBe(true)
    if (!stopped.ok) return
    expect(stopped.snapshot.tasks.slice(0, 2)).toEqual([
      expect.objectContaining({ id: ids[0], lane: 'blocked', attention: expect.objectContaining({ reason: 'stopped' }) }),
      expect.objectContaining({ id: ids[1], lane: 'blocked', attention: expect.objectContaining({ reason: 'stopped' }) }),
    ])

    await waitFor(() => gate.active === 0, 'sessions aborted')
    expect(gate.started).toHaveLength(2)
    expect(await runner.resumeRun(dir, runId)).toEqual({ ok: false, error: 'run-stopped' })
    expect(await runner.startTask(dir, runId, ids[2], {})).toEqual({ ok: false, error: 'not-queued' })
  })

  it('marks the run stopped before aborting so waiting tasks are not claimed', async () => {
    seedTasks(2, { concurrency: 1 })
    const gate = createGate()
    const runner = makeRunner(gate)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 1, 'first claim')

    const stopped = await runner.stopRun(dir, runId)
    expect(stopped.ok).toBe(true)

    const snapshot = readRunSnapshot(dir, runId)!
    expect(snapshot.run.status).toBe('stopped')
    // 槽位因中止而释放时，泵不能趁机领取下一个任务。
    expect(gate.started).toHaveLength(1)
    expect(snapshot.tasks[1]).toMatchObject({ lane: 'queued' })
  })
})

describe('config snapshot', () => {
  it('pins the claim-time config and applies saved changes only to new claims', async () => {
    const ids = seedTasks(2, { concurrency: 1 })
    const gate = createGate()
    const runner = makeRunner(gate)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 1, 'first claim')

    const first = readRunSnapshot(dir, runId)!.tasks.find((task) => task.id === ids[0])
    expect(first?.configSnapshot).toMatchObject({
      revision: 1,
      verifyCommand: 'npm run test',
      maxIterations: 5,
    })
    expect(gate.inputs[0].verifyCommand).toBe('npm run test')
    expect(gate.inputs[0].maxIterations).toBe(5)

    const existing = readFactoryConfig(dir)
    if (!existing) throw new Error('fixture config missing')
    writeFactoryConfigAtomic(dir, {
      ...existing,
      revision: 2,
      commands: { verify: 'npm run build' },
    })

    // 槽位释放后调度泵自动领取下一个：它必须读到保存后的新配置。
    gate.release(1)
    await waitFor(() => gate.started.length === 2, 'second claim')
    expect(gate.inputs[1].verifyCommand).toBe('npm run build')
    const second = readRunSnapshot(dir, runId)!.tasks.find((task) => task.id === ids[1])
    expect(second?.configSnapshot).toMatchObject({ revision: 2, verifyCommand: 'npm run build' })

    const stillFirst = readRunSnapshot(dir, runId)!.tasks.find((task) => task.id === ids[0])
    expect(stillFirst?.configSnapshot).toMatchObject({ revision: 1, verifyCommand: 'npm run test' })
    expect(gate.inputs[0].verifyCommand).toBe('npm run test')
  })

  it('阶段权限模式按落盘值固化进快照，读回不被换成默认档', async () => {
    // 实现阶段默认档已改成完全信任。解析清单若漏了某一档，表现不是报错而是悄悄
    // 回落到默认值 —— 旧配置被无声提权，只在无人值守时不再弹审批，比崩掉难发现。
    const ids = seedTasks(1, { concurrency: 1 })
    const existing = readFactoryConfig(dir)
    if (!existing) throw new Error('fixture config missing')
    writeFactoryConfigAtomic(dir, {
      ...existing,
      stages: {
        ...existing.stages,
        implement: { ...existing.stages.implement, permissionMode: 'acceptEdits' },
      },
    })
    const gate = createGate()
    const runner = makeRunner(gate)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 1, 'claim')

    const claimed = readRunSnapshot(dir, runId)!.tasks.find((task) => task.id === ids[0])
    expect(claimed?.configSnapshot?.stages.implement.permissionMode).toBe('acceptEdits')
    expect(gate.inputs[0].permissionMode).toBe('acceptEdits')
  })

  it('emits a config.changed event for the current unfinished run', async () => {
    seedTasks(1, { concurrency: 1 })
    const gate = createGate()
    const runner = makeRunner(gate)

    runner.recordConfigChange(dir, 2)
    expect(runner.readEvents(dir, runId).map((event) => event.code)).toContain('config.changed')
  })
})

describe('concurrency changes', () => {
  it('applies a raised limit to the running run and claims more tasks', async () => {
    seedTasks(3, { concurrency: 1 })
    const gate = createGate()
    const runner = makeRunner(gate)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 1, 'first claim')

    runner.recordConfigChange(dir, 2, { maxConcurrency: 2 })
    await waitFor(() => gate.started.length === 2, 'second claim after raising the limit')

    expect(readRunSnapshot(dir, runId)!.run).toMatchObject({ maxConcurrency: 2 })
  })

  it('only affects later claims when the limit is lowered', async () => {
    seedTasks(3, { concurrency: 2 })
    const gate = createGate()
    const runner = makeRunner(gate)

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 2, 'two tasks running')

    runner.recordConfigChange(dir, 2, { maxConcurrency: 1 })
    await new Promise((resolve) => setTimeout(resolve, 200))
    // 在跑任务不被打断，只是槽位空出后不再补领取。
    expect(gate.active).toBe(2)
    expect(gate.started).toHaveLength(2)
    expect(readRunSnapshot(dir, runId)!.run.maxConcurrency).toBe(1)

    gate.release(1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(gate.active).toBe(1)
    expect(gate.started).toHaveLength(2)
  })
})

describe('manual claims', () => {
  it('refuses manual starts past the limit or before dependencies are met', async () => {
    const ids = seedTasks(3, {
      concurrency: 1,
      dependencies: (all) => ({ [all[1]]: [all[0]] }),
    })
    const gate = createGate()
    const runner = makeRunner(gate)

    expect(await runner.startTask(dir, runId, ids[1])).toEqual({ ok: false, error: 'dependency-unmet' })

    await runner.resumeRun(dir, runId)
    await waitFor(() => gate.started.length === 1, 'first claim')
    expect(await runner.startTask(dir, runId, ids[2])).toEqual({ ok: false, error: 'no-slot' })
  })
})
