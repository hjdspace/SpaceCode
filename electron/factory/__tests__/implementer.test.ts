// @vitest-environment node
/**
 * 实现循环：完成信号、同会话续跑、迭代上限转阻塞、停止保留现场，
 * 以及事件投影、token 累计与每轮 diff/commits 写回。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createBacklogItem } from '../backlog'
import { createFactoryRun, readRunSnapshot } from '../runs'
import { transitionTask } from '../runtime'
import { runImplementation } from '../implementer'
import type { AgentPort, AgentTurn } from '../agentEngineGateway'
import type { FactoryEventInput } from '../events'

let dir: string
let runId: string

interface FakeAgent extends AgentPort {
  prompts: string[]
  stopped: string[]
  emit: (sessionId: string, eventType: string, data: unknown) => void
}

function fakeAgent(script: AgentTurn[] | ((sessionId: string) => Promise<AgentTurn>)): FakeAgent {
  const prompts: string[] = []
  const stopped: string[] = []
  let listener: ((sessionId: string, eventType: string, data: unknown) => void) | null = null
  return {
    prompts,
    stopped,
    emit: (sessionId, eventType, data) => listener?.(sessionId, eventType, data),
    async run(sessionId, prompt) {
      prompts.push(prompt)
      if (typeof script === 'function') return script(sessionId)
      const next = script.shift()
      if (!next) throw new Error('fake agent ran out of turns')
      return next
    },
    async stop(sessionId) {
      stopped.push(sessionId)
    },
    onEvent(next) {
      listener = next
      return () => {
        listener = null
      }
    },
  }
}

function seed(): { taskSnapshot: ReturnType<typeof readRunSnapshot> } {
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
  return { taskSnapshot: readRunSnapshot(dir, runId) }
}

function input(agent: FakeAgent, overrides: Record<string, unknown> = {}) {
  const task = readRunSnapshot(dir, runId)!.tasks[0]
  return {
    repoRoot: dir,
    runId,
    task,
    prompt: 'implement the task',
    worktreeAbsolute: join(dir, '.spacecode', 'worktrees', 'bl-1'),
    baseBranch: 'main',
    sessionId: 'fac-run-1-bl-1-impl',
    permissionMode: 'acceptEdits' as const,
    signal: new AbortController().signal,
    deps: {
      agent,
      collectState: async () => ({
        diff: { additions: 4, deletions: 1, files: [{ path: 'a.ts', additions: 4, deletions: 1 }] },
        commits: [{ sha: 'abc', message: 'feat: a' }],
        clean: true,
      }),
      emit: (event: FactoryEventInput) => events.push(event),
    },
    ...overrides,
  }
}

let events: FactoryEventInput[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-impl-'))
  events = []
  seed()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runImplementation', () => {
  it('continues the same session until the completion promise arrives', async () => {
    const agent = fakeAgent([
      { text: 'still working', isError: false, inputTokens: 10, outputTokens: 2 },
      { text: 'done <promise>COMPLETE</promise>', isError: false, inputTokens: 5, outputTokens: 1 },
    ])
    const result = await runImplementation(input(agent) as never)

    expect(result).toMatchObject({ outcome: 'completed', iterations: 2, inputTokens: 15, outputTokens: 3 })
    expect(agent.prompts).toHaveLength(2)
    expect(agent.prompts[1]).toContain('<promise>COMPLETE</promise>')

    const task = readRunSnapshot(dir, runId)!.tasks[0]
    expect(task).toMatchObject({
      lane: 'implementing',
      stageIdx: 2,
      iteration: 2,
      usage: { inputTokens: 15, outputTokens: 3 },
      diff: { additions: 4, deletions: 1 },
      commits: [{ sha: 'abc', message: 'feat: a' }],
    })
    expect(events.map((event) => event.code)).toEqual(
      expect.arrayContaining(['task.implementation.started', 'task.implementation.completed']),
    )
  })

  it('blocks with iteration.limit when the promise never arrives', async () => {
    const agent = fakeAgent([
      { text: 'a', isError: false, inputTokens: 0, outputTokens: 0 },
      { text: 'b', isError: false, inputTokens: 0, outputTokens: 0 },
    ])
    const result = await runImplementation(input(agent, { maxIterations: 2 }) as never)

    expect(result).toMatchObject({ outcome: 'limit', iterations: 2 })
    expect(agent.prompts).toHaveLength(2)
    const task = readRunSnapshot(dir, runId)!.tasks[0]
    expect(task).toMatchObject({
      lane: 'blocked',
      stageIdx: 2,
      attention: { reason: 'iteration.limit', action: 'retry' },
      worktree: '.spacecode/worktrees/bl-1',
    })
    expect(events).toContainEqual(expect.objectContaining({ code: 'task.iteration.limit', level: 'warn' }))
  })

  it('stops the agent session and blocks the task while keeping the worktree', async () => {
    let resolveTurn: ((turn: AgentTurn) => void) | null = null
    const agent = fakeAgent(
      () =>
        new Promise<AgentTurn>((resolve) => {
          resolveTurn = resolve
        }),
    )
    agent.stop = async (sessionId) => {
      agent.stopped.push(sessionId)
      resolveTurn?.({ text: 'stopped', isError: true, inputTokens: 3, outputTokens: 0 })
    }
    const controller = new AbortController()
    const running = runImplementation(input(agent, { signal: controller.signal }) as never)
    await Promise.resolve()
    controller.abort()
    const result = await running

    expect(result).toMatchObject({ outcome: 'stopped' })
    expect(agent.stopped).toEqual(['fac-run-1-bl-1-impl'])
    const task = readRunSnapshot(dir, runId)!.tasks[0]
    expect(task).toMatchObject({
      lane: 'blocked',
      worktree: '.spacecode/worktrees/bl-1',
      attention: { reason: 'stopped', action: 'retry' },
    })
  })

  it('projects agent events and writes raw output to the log', async () => {
    const agent = fakeAgent([
      { text: '<promise>COMPLETE</promise>', isError: false, inputTokens: 1, outputTokens: 1 },
    ])
    const logs: string[] = []
    const runInput = input(agent) as Record<string, unknown> & { deps: Record<string, unknown> }
    runInput.deps.appendLog = (taskId: string, text: string) => logs.push(`${taskId}:${text}`)

    const originalRun = agent.run.bind(agent)
    agent.run = async (sessionId, prompt, options) => {
      agent.emit(sessionId, 'tool_use', { name: 'Edit', input: { file_path: 'src/a.ts' } })
      agent.emit(sessionId, 'log', 'raw line\n')
      return originalRun(sessionId, prompt, options)
    }

    await runImplementation(runInput as never)
    expect(events).toContainEqual(
      expect.objectContaining({ code: 'agent.edit', params: { target: 'src/a.ts' } }),
    )
    expect(logs).toEqual(['bl-1:raw line\n'])
  })

  it('blocks on an agent error instead of retrying silently', async () => {
    const agent = fakeAgent([{ text: 'boom', isError: true, inputTokens: 0, outputTokens: 0 }])
    const result = await runImplementation(input(agent) as never)
    expect(result).toMatchObject({ outcome: 'error' })
    expect(readRunSnapshot(dir, runId)!.tasks[0]).toMatchObject({
      lane: 'blocked',
      attention: { reason: 'agent.error', action: 'fix' },
    })
  })
})
