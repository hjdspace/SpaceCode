// @vitest-environment node
/**
 * 实现阶段跨真实 Git：临时仓库 + 真实工作树 + 真实提示词渲染 + 真实实现循环，
 * 只把 Agent 换成假端口。验证「一个任务一个工作树、提交留在分支上、基础仓库不动」。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '@electron/factory/config'
import { createBacklogItem } from '@electron/factory/backlog'
import { ensureFactoryGitignore, ensureFactoryLayout, promptRelativePath, writePromptSkeletons } from '@electron/factory/init'
import { createFactoryRun, readRunSnapshot } from '@electron/factory/runs'
import { createFactoryRunner } from '@electron/factory/factoryRunner'
import type { AgentPort } from '@electron/factory/agentEngineGateway'

let repo: string

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

function commitAll(message: string, cwd = repo): void {
  git(['add', '-A'], cwd)
  git(['-c', 'user.name=Factory Test', '-c', 'user.email=factory@test.local', 'commit', '-m', message], cwd)
}

/** 假 Agent：在工作树里改文件、提交，再以完成信号收尾。 */
function fakeAgent(): AgentPort {
  return {
    async run(_sessionId, _prompt, options) {
      writeFileSync(join(options.cwd, 'implemented.txt'), 'done\n', 'utf-8')
      git(['add', 'implemented.txt'], options.cwd)
      git(
        ['-c', 'user.name=Factory Test', '-c', 'user.email=factory@test.local', 'commit', '-m', 'feat: implement task'],
        options.cwd,
      )
      return { text: 'done\n<promise>COMPLETE</promise>', isError: false, inputTokens: 12, outputTokens: 4 }
    },
    async stop() {},
    onEvent: () => () => {},
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'factory-integration-'))
  git(['init', '-b', 'main'])
  writeFileSync(join(repo, 'README.md'), '# fixture\n', 'utf-8')
  commitAll('chore: initial commit')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('factory implementation over a real repository', () => {
  it('creates an isolated worktree, commits there and leaves the base branch untouched', async () => {
    const built = buildFactoryConfig(
      {
        agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
        sandbox: { type: 'worktree' },
        tracker: { type: 'local', mergeMode: 'local' },
        commands: { verify: 'node --version' },
      },
      { baseBranch: 'main' },
    )
    if (!built.ok) throw new Error('fixture config invalid')
    writeFactoryConfigAtomic(repo, built.config)
    ensureFactoryLayout(repo, { tracker: 'local' })
    writePromptSkeletons(repo)
    ensureFactoryGitignore(repo)
    // 用可断言的最短模板覆盖骨架：变量展开与命令白名单在 prompt 单测覆盖。
    writeFileSync(
      join(repo, promptRelativePath('implement')),
      '# {{TASK_TITLE}}\nGoal: {{TASK_GOAL}}\n{{SOURCE_BRANCH}} -> {{TARGET_BRANCH}}\n',
      'utf-8',
    )
    commitAll('chore: factory fixtures')

    const item = createBacklogItem(repo, { title: '实现夹具', goal: '写一个文件' }, { genId: () => 'bl-1' })
    if (!item.ok) throw new Error('fixture backlog invalid')
    const created = createFactoryRun(repo, { taskIds: ['bl-1'] }, { genId: () => 'run-1' })
    if (!created.ok) throw new Error('fixture run invalid')

    const prompts: string[] = []
    const runner = createFactoryRunner({
      agentFactory: async () => {
        const agent = fakeAgent()
        return {
          ...agent,
          run: (sessionId, prompt, options) => {
            prompts.push(prompt)
            return agent.run(sessionId, prompt, options)
          },
        }
      },
      runReview: async () => ({ outcome: 'approved' }),
    })

    const result = await runner.startTask(repo, 'run-1', 'bl-1', {})
    expect(result.ok).toBe(true)
    await runner.whenIdle('run-1')

    const worktree = join(repo, '.spacecode', 'worktrees', 'bl-1')
    expect(existsSync(join(worktree, 'implemented.txt'))).toBe(true)
    expect(git(['branch', '--show-current'], worktree)).toBe('agent/task-bl-1')
    // 基础分支仍是初始提交状态，没有被实现阶段污染
    expect(existsSync(join(repo, 'implemented.txt'))).toBe(false)
    expect(git(['log', '--format=%s', '-1'])).toBe('chore: factory fixtures')

    const snapshot = readRunSnapshot(repo, 'run-1')
    const task = snapshot?.tasks[0]
    expect(task).toMatchObject({
      lane: 'reviewing',
      stageIdx: 4,
      branch: 'agent/task-bl-1',
      worktree: '.spacecode/worktrees/bl-1',
      iteration: 1,
    })
    expect(task?.tests?.status).toBe('pass')
    expect(task?.commits?.[0]?.message).toBe('feat: implement task')
    expect(task?.diff.additions).toBeGreaterThan(0)
    expect(task?.diff.files?.some((file) => file.path === 'implemented.txt')).toBe(true)
    expect(task?.usage).toEqual({ inputTokens: 12, outputTokens: 4 })

    expect(prompts[0]).toContain('实现夹具')
    expect(prompts[0]).toContain('agent/task-bl-1 -> main')

    const codes = runner.readEvents(repo, 'run-1', 'bl-1').map((event) => event.code)
    expect(codes).toContain('task.started')
    expect(codes).toContain('worktree.created')
    expect(codes).toContain('task.implementation.completed')
    expect(codes).toContain('tests.passed')

    await runner.dispose()
    // 事件日志落在运行目录，可跨进程重放
    const events = readFileSync(join(repo, '.spacecode', 'factory', 'runs', 'run-1', 'events.jsonl'), 'utf-8')
    expect(events.trim().split('\n').length).toBeGreaterThan(0)
  })
})
