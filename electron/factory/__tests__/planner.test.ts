// @vitest-environment node
/**
 * 规划阶段：候选注入、单步只读会话、`<plan>` 提取/校验、失败一次续跑、
 * 依赖与环检查、产出上限，以及禁用/缺失提示词的早退路径。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig } from '../config'
import { parsePlanOutput, runPlanner } from '../planner'
import type { AgentPort, AgentRunOptions, AgentTurn } from '../agentEngineGateway'
import type { FactoryConfig, FactoryPlanCandidate } from '@/shared/factory'

let dir: string
let config: FactoryConfig

interface FakeAgent extends AgentPort {
  prompts: string[]
  options: AgentRunOptions[]
  stopped: string[]
}

function fakeAgent(script: AgentTurn[]): FakeAgent {
  const prompts: string[] = []
  const options: AgentRunOptions[] = []
  const stopped: string[] = []
  return {
    prompts,
    options,
    stopped,
    async run(_sessionId, prompt, runOptions) {
      prompts.push(prompt)
      options.push(runOptions)
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

function turn(text: string): AgentTurn {
  return { text, isError: false, inputTokens: 10, outputTokens: 20 }
}

const candidates: FactoryPlanCandidate[] = [
  { id: 'bl-1', title: '刷新后登录态丢失', goal: '修复会话恢复' },
  { id: 'bl-2', title: '合并预检失败', goal: '修复预检' },
]

function writePrompt(content: string): void {
  const prompts = join(dir, '.spacecode', 'factory', 'prompts')
  mkdirSync(prompts, { recursive: true })
  writeFileSync(join(prompts, 'plan.md'), content, 'utf-8')
}

function planOf(tasks: unknown): string {
  return `Done.\n<plan>\n${JSON.stringify({ tasks })}\n</plan>\n<promise>COMPLETE</promise>`
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-plan-'))
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
  config = built.config
  writePrompt('# Plan\n\n{{TASK_CANDIDATES}}\n\nAt most {{MAX_TASKS}}.\n\n<plan></plan>\n')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runPlanner', () => {
  it('runs a single read-only session and returns validated tasks', async () => {
    const agent = fakeAgent([
      turn(planOf([
        { id: 'bl-1', dependsOn: [] },
        { id: 'bl-2', dependsOn: ['bl-1'] },
      ])),
    ])

    const result = await runPlanner({
      repoRoot: dir,
      config,
      candidates,
      deps: { agent, now: () => new Date('2026-10-30T00:00:00Z') },
    })

    expect(result).toMatchObject({
      ok: true,
      tasks: [
        { id: 'bl-1', title: '刷新后登录态丢失', dependsOn: [], parallelizable: true },
        { id: 'bl-2', title: '合并预检失败', dependsOn: ['bl-1'], parallelizable: true },
      ],
      usage: { inputTokens: 10, outputTokens: 20 },
      warnings: [],
    })
    expect(agent.prompts).toHaveLength(1)
    expect(agent.prompts[0]).toContain('"id": "bl-1"')
    expect(agent.prompts[0]).toContain('At most 10.')
    expect(agent.options[0]).toMatchObject({ cwd: dir, permissionMode: 'plan', model: 'claude-sonnet-4-5' })
    expect(agent.stopped).toHaveLength(1)
  })

  it('retries once in the same session with token-efficient feedback', async () => {
    const agent = fakeAgent([turn('I forgot the tag'), turn(planOf([{ id: 'bl-1' }]))])

    const result = await runPlanner({
      repoRoot: dir,
      config,
      candidates,
      deps: { agent },
    })

    expect(result).toMatchObject({ ok: true, tasks: [{ id: 'bl-1' }] })
    expect(agent.prompts).toHaveLength(2)
    expect(agent.prompts[1]).toContain('did not produce a valid <plan> block')
    expect(agent.prompts[1]).toContain('Emit only a corrected <plan> block')
  })

  it('fails after one retry when the plan references an unknown task', async () => {
    const agent = fakeAgent([turn(planOf([{ id: 'bl-9' }])), turn(planOf([{ id: 'bl-9' }]))])

    const result = await runPlanner({ repoRoot: dir, config, candidates, deps: { agent } })

    expect(result).toMatchObject({ ok: false, error: 'plan-invalid' })
    expect(result.ok === false && result.detail).toContain('unknown task: bl-9')
    expect(agent.prompts).toHaveLength(2)
  })

  it('rejects dependency cycles before they reach the scheduler', async () => {
    const cycle = planOf([
      { id: 'bl-1', dependsOn: ['bl-2'] },
      { id: 'bl-2', dependsOn: ['bl-1'] },
    ])
    const agent = fakeAgent([turn(cycle), turn(cycle)])

    const result = await runPlanner({ repoRoot: dir, config, candidates, deps: { agent } })

    expect(result).toMatchObject({ ok: false, error: 'plan-invalid' })
    expect(result.ok === false && result.detail).toContain('dependency cycle')
  })

  it('caps the plan at maxTasksPerRun and reports a warning', async () => {
    config.limits.maxTasksPerRun = 1
    const agent = fakeAgent([turn(planOf([{ id: 'bl-1' }, { id: 'bl-2' }]))])

    const result = await runPlanner({ repoRoot: dir, config, candidates, deps: { agent } })

    expect(result).toMatchObject({
      ok: true,
      tasks: [{ id: 'bl-1' }],
      warnings: [{ code: 'truncated', max: 1 }],
    })
  })

  it('returns early when the stage is disabled or there is nothing to plan', async () => {
    const agent = fakeAgent([])
    config.stages.plan.enabled = false
    expect(await runPlanner({ repoRoot: dir, config, candidates, deps: { agent } })).toEqual({
      ok: false,
      error: 'plan-disabled',
    })

    config.stages.plan.enabled = true
    expect(await runPlanner({ repoRoot: dir, config, candidates: [], deps: { agent } })).toEqual({
      ok: false,
      error: 'no-candidates',
    })
    expect(agent.prompts).toHaveLength(0)
  })

  it('fails fast when the prompt is missing or does not describe the tag', async () => {
    const agent = fakeAgent([])
    config.prompts.plan = '.spacecode/factory/prompts/missing.md'
    expect(await runPlanner({ repoRoot: dir, config, candidates, deps: { agent } })).toMatchObject({
      ok: false,
      error: 'prompt-missing',
    })

    config.prompts.plan = '.spacecode/factory/prompts/plan.md'
    writePrompt('# Plan\n\n{{TASK_CANDIDATES}}\n')
    expect(await runPlanner({ repoRoot: dir, config, candidates, deps: { agent } })).toMatchObject({
      ok: false,
      error: 'prompt-error',
      detail: 'plan-tag-missing',
    })
    expect(agent.prompts).toHaveLength(0)
  })

  it('times out a hung planner and stops the session', async () => {
    const stopped: string[] = []
    const agent: AgentPort = {
      run: () => new Promise<AgentTurn>(() => {}),
      stop: async (sessionId) => {
        stopped.push(sessionId)
      },
      onEvent: () => () => {},
    }

    const result = await runPlanner({
      repoRoot: dir,
      config,
      candidates,
      deps: { agent, timeoutMs: 10 },
    })

    expect(result).toMatchObject({ ok: false, error: 'plan-timeout' })
    expect(stopped).toHaveLength(1)
  })
})

describe('parsePlanOutput', () => {
  it('uses the last plan block and accepts fenced JSON', () => {
    const text = [
      '<plan>{"tasks":[{"id":"bl-9"}]}</plan>',
      '<plan>```json',
      '{"tasks":[{"id":"bl-1","dependsOn":[]}]}',
      '```</plan>',
    ].join('\n')

    expect(parsePlanOutput(text, candidates, 10)).toMatchObject({
      ok: true,
      tasks: [{ id: 'bl-1', dependsOn: [] }],
    })
  })

  it('resolves issueNumber output back to the stable task id', () => {
    const issues: FactoryPlanCandidate[] = [
      { id: 'issue-12', issueNumber: 12, title: 'Fix login', goal: '' },
    ]

    expect(
      parsePlanOutput(planOf([{ issueNumber: 12, dependsOn: [] }]), issues, 10),
    ).toMatchObject({
      ok: true,
      tasks: [{ id: 'issue-12', issueNumber: 12 }],
    })
  })
})
