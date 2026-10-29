// @vitest-environment node
/**
 * PR 模式：真实临时仓库 + 本地裸远端覆盖推送成功、远端拒绝、重复 PR 复用、
 * 权限/创建失败转阻塞与 force 拦截。只有 gh 是假的，Git 与 tasks.json 都是真的，
 * 这样才能证明「只推任务分支」「失败保留工作树」「不落 merge commit」。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createGithubRun, readRunSnapshot } from '../runs'
import { transitionTask } from '../runtime'
import { readEvents } from '../events'
import { executeMerge } from '../merge'
import { buildPullRequestBody, buildPushArgs, assertPushSafe, executePullRequestDelivery } from '../prMode'
import type { GhRunner } from '../githubClient'
import type { FactoryMergeExecuteInput, FactoryReview, FactoryTestRun } from '@/shared/factory'
import type { VerifyResult } from '../verify'

vi.setConfig({ testTimeout: 30_000 })

let dir: string
let remoteDir: string
let runId: string
let taskId: string
let branch: string
let worktree: string
let baseTip: string

const GIT = process.platform === 'win32' ? 'git.exe' : 'git'

function git(cwd: string, args: string[]): string {
  return execFileSync(GIT, args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function gitOk(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args)
    return true
  } catch {
    return false
  }
}

function worktreePath(): string {
  return join(dir, '.spacecode', 'worktrees', taskId)
}

const passed: FactoryTestRun = {
  status: 'pass',
  command: 'npm run test:changed',
  at: '2026-10-28T10:00:00.000Z',
  exitCode: 0,
}

const approved: FactoryReview = {
  verdict: 'approved',
  summary: 'looks good',
  comments: [],
  at: '2026-10-28T10:05:00.000Z',
}

function passVerify(): Promise<VerifyResult> {
  return Promise.resolve({ ...passed, detail: '' })
}

function seed(): void {
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'worktree' },
      tracker: {
        type: 'github-issues',
        repo: 'owner/repo',
        label: 'ready-for-agent',
        auth: 'gh',
        mergeMode: 'pr',
        commentIssue: true,
        closeIssue: true,
      },
      commands: { verify: 'npm run test:changed' },
    },
    { baseBranch: 'main', remote: 'git@github.com:owner/repo.git' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  writeFactoryConfigAtomic(dir, built.config)

  const created = createGithubRun(
    dir,
    { runId: 'run-1', tasks: [{ issueNumber: 42, title: 'PR 模式任务', goal: '把结果交付到远端' }] },
    { genId: () => 'run-1' },
  )
  if (!created.ok) throw new Error('fixture run invalid')
  runId = created.snapshot.run.id
  const task = created.snapshot.tasks[0]
  taskId = task.id
  branch = task.branch
  worktree = `.spacecode/worktrees/${taskId}`

  git(dir, ['worktree', 'add', '-b', branch, worktreePath(), 'main'])
  writeFileSync(join(worktreePath(), 'feature.txt'), 'feature\n')
  git(worktreePath(), ['add', '.'])
  git(worktreePath(), ['commit', '-m', 'feat: add feature'])

  transitionTask(dir, runId, taskId, { lane: 'implementing', stageIdx: 2 }, 'worktree.ready', {
    worktree,
    branch,
  })
  transitionTask(dir, runId, taskId, { lane: 'reviewing', stageIdx: 4 }, 'tests.passed', {
    tests: passed,
    review: approved,
  })
  const approvedMove = transitionTask(dir, runId, taskId, { lane: 'mergeable', stageIdx: 5 }, 'task.approved')
  if (!approvedMove.ok) throw new Error('fixture transition invalid')
}

function snapshotTask() {
  return readRunSnapshot(dir, runId)?.tasks.find((task) => task.id === taskId) ?? null
}

function mergeInput(overrides: Partial<FactoryMergeExecuteInput> = {}): FactoryMergeExecuteInput {
  return { mode: 'merge', confirmed: true, ...overrides }
}

interface GhHarness {
  run: GhRunner
  calls: string[][]
}

function fakeGh(handler: (args: string[]) => { code: number | string; stdout: string }): GhHarness {
  const calls: string[][] = []
  return {
    calls,
    run: async (args) => {
      calls.push(args)
      return handler(args)
    },
  }
}

function listCalls(calls: string[][], command: string, action: string): string[][] {
  return calls.filter((args) => args[0] === command && args[1] === action)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-pr-'))
  remoteDir = mkdtempSync(join(tmpdir(), 'factory-pr-remote-'))

  git(remoteDir, ['init', '--bare', '-b', 'main'])
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(join(dir, '.gitignore'), '.spacecode/\n')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-m', 'base'])
  git(dir, ['remote', 'add', 'origin', remoteDir])
  git(dir, ['push', '-u', 'origin', 'main'])
  baseTip = git(dir, ['rev-parse', 'main']).trim()

  seed()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(remoteDir, { recursive: true, force: true })
})

describe('pull request body and push safety', () => {
  it('builds a body with source issue, verification, review and commit count', () => {
    const task = snapshotTask()
    if (!task) throw new Error('missing task')
    const body = buildPullRequestBody({
      task,
      targetBranch: 'main',
      commits: 2,
      tests: passed,
      review: approved,
    })

    expect(body).toContain('#42')
    expect(body).toContain('npm run test:changed')
    expect(body).toContain('通过')
    expect(body).toContain('提交数：2')
    expect(body).not.toMatch(/ghp_|github_pat_|sk-/)
  })

  it('redacts token-looking text from task content', () => {
    const task = snapshotTask()
    if (!task) throw new Error('missing task')
    const body = buildPullRequestBody({
      task: { ...task, goal: 'token ghp_abcdefgh1234 leaked' },
      targetBranch: 'main',
      commits: 1,
      tests: passed,
      review: approved,
    })
    expect(body).not.toContain('ghp_abcdefgh1234')
  })

  it('builds a push command for the task branch only', () => {
    expect(buildPushArgs('agent/task-1', 'origin')).toEqual([
      'push',
      'origin',
      'agent/task-1:refs/heads/agent/task-1',
    ])
  })

  it('refuses any force-push intent', () => {
    expect(() => assertPushSafe(['push', 'origin', '+agent/task-1:refs/heads/agent/task-1'])).toThrow()
    expect(() => assertPushSafe(['push', '--force', 'origin', 'agent/task-1'])).toThrow()
    expect(() => assertPushSafe(['push', 'origin', 'agent/task-1', '-f'])).toThrow()
    expect(() => assertPushSafe(buildPushArgs('agent/task-1', 'origin'))).not.toThrow()
  })
})

describe('execute merge in PR mode', () => {
  it('pushes the task branch and creates a pull request without merging locally', async () => {
    const gh = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'list') return { code: 0, stdout: '[]' }
      if (args[0] === 'pr' && args[1] === 'create') {
        return { code: 0, stdout: 'https://github.com/owner/repo/pull/12\n' }
      }
      return { code: 0, stdout: '' }
    })

    const result = await executeMerge(dir, runId, taskId, mergeInput(), {
      runVerify: passVerify,
      gh: gh.run,
      checkPrReady: () => Promise.resolve({ ok: true }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pullRequest).toMatchObject({ number: 12, url: 'https://github.com/owner/repo/pull/12' })
    expect(result.targetBranch).toBe('main')

    const task = snapshotTask()
    expect(task?.lane).toBe('done')
    expect(task?.pullRequest?.number).toBe(12)
    expect(task?.mergedCommits).toBe(1)
    expect(task?.worktree).toBeNull()
    expect(existsSync(worktreePath())).toBe(false)

    // 只推了任务分支：远端 main 未前进，本地也没有产生 merge commit。
    expect(git(dir, ['rev-parse', 'main']).trim()).toBe(baseTip)
    expect(git(remoteDir, ['rev-parse', 'refs/heads/main']).trim()).toBe(baseTip)
    expect(gitOk(remoteDir, ['rev-parse', '--verify', `refs/heads/${branch}`])).toBe(true)
    expect(gitOk(dir, ['show', 'main:feature.txt'])).toBe(false)
    expect(git(dir, ['log', '--merges', '--format=%H', 'main']).trim()).toBe('')

    // gh 调用不含任何 force 标记。
    expect(gh.calls.some((args) => args.some((arg) => arg.includes('force') || arg.startsWith('+')))).toBe(false)

    const codes = readEvents(join(dir, '.spacecode', 'factory', 'runs', runId, 'events.jsonl'), {
      taskId,
    }).map((event) => event.code)
    expect(codes).toEqual(expect.arrayContaining(['pr.push.started', 'pr.created', 'pr.completed']))
  })

  it('reuses an existing pull request and updates its body instead of creating another', async () => {
    const gh = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'list') {
        return {
          code: 0,
          stdout: JSON.stringify([
            { number: 7, url: 'https://github.com/owner/repo/pull/7', state: 'OPEN' },
          ]),
        }
      }
      return { code: 0, stdout: '' }
    })

    const result = await executeMerge(dir, runId, taskId, mergeInput(), {
      runVerify: passVerify,
      gh: gh.run,
      checkPrReady: () => Promise.resolve({ ok: true }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pullRequest).toMatchObject({
      number: 7,
      url: 'https://github.com/owner/repo/pull/7',
      reused: true,
    })
    expect(listCalls(gh.calls, 'pr', 'create')).toHaveLength(0)
    expect(listCalls(gh.calls, 'pr', 'edit')).toHaveLength(1)

    const codes = readEvents(join(dir, '.spacecode', 'factory', 'runs', runId, 'events.jsonl'), {
      taskId,
    }).map((event) => event.code)
    expect(codes).toContain('pr.reused')
  })

  it('blocks when GitHub write permission is missing and keeps the worktree', async () => {
    const result = await executeMerge(dir, runId, taskId, mergeInput(), {
      runVerify: passVerify,
      checkPrReady: () => Promise.resolve({ ok: false, reason: 'repo-permission' }),
      gh: fakeGh(() => ({ code: 0, stdout: '' })).run,
    })

    expect(result).toMatchObject({ ok: false, error: 'pr-auth' })
    expect(snapshotTask()?.lane).toBe('blocked')
    expect(existsSync(worktreePath())).toBe(true)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.preflight?.blockers).toContain('pr-auth')
  })

  it('blocks when the remote rejects a non-fast-forward push and never force-pushes', async () => {
    // 远端同名分支先有另一条历史，本地推送必然被拒绝。
    git(dir, ['checkout', '-b', 'remote-side', 'main'])
    writeFileSync(join(dir, 'remote.txt'), 'remote\n')
    git(dir, ['add', 'remote.txt'])
    git(dir, ['commit', '-m', 'remote side'])
    git(dir, ['push', 'origin', `remote-side:refs/heads/${branch}`])
    git(dir, ['checkout', 'main'])
    git(dir, ['branch', '-D', 'remote-side'])

    const gh = fakeGh(() => ({ code: 0, stdout: '' }))
    const result = await executeMerge(dir, runId, taskId, mergeInput(), {
      runVerify: passVerify,
      gh: gh.run,
      checkPrReady: () => Promise.resolve({ ok: true }),
    })

    expect(result).toMatchObject({ ok: false, error: 'push-failed' })
    expect(snapshotTask()?.lane).toBe('blocked')
    expect(existsSync(worktreePath())).toBe(true)
    expect(listCalls(gh.calls, 'pr', 'create')).toHaveLength(0)
    const codes = readEvents(join(dir, '.spacecode', 'factory', 'runs', runId, 'events.jsonl'), {
      taskId,
    }).map((event) => event.code)
    expect(codes).toContain('pr.push.failed')
  })

  it('blocks when gh fails to create the pull request and keeps the worktree', async () => {
    const gh = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'list') return { code: 0, stdout: '[]' }
      if (args[0] === 'pr' && args[1] === 'create') {
        return { code: 1, stdout: 'HTTP 403: Resource not accessible by integration' }
      }
      return { code: 0, stdout: '' }
    })

    const result = await executeMerge(dir, runId, taskId, mergeInput(), {
      runVerify: passVerify,
      gh: gh.run,
      checkPrReady: () => Promise.resolve({ ok: true }),
    })

    expect(result).toMatchObject({ ok: false, error: 'pr-create-failed' })
    expect(snapshotTask()?.lane).toBe('blocked')
    expect(existsSync(worktreePath())).toBe(true)

    const codes = readEvents(join(dir, '.spacecode', 'factory', 'runs', runId, 'events.jsonl'), {
      taskId,
    }).map((event) => event.code)
    expect(codes).toContain('pr.create.failed')
  })

  it('delivers a pull request directly through the module seam', async () => {
    const gh = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'list') return { code: 0, stdout: '[]' }
      if (args[0] === 'pr' && args[1] === 'create') {
        return { code: 0, stdout: 'https://github.com/owner/repo/pull/3' }
      }
      return { code: 0, stdout: '' }
    })
    const task = snapshotTask()
    if (!task) throw new Error('missing task')

    const result = await executePullRequestDelivery({
      repoRoot: dir,
      runId,
      taskId,
      task,
      targetBranch: 'main',
      commits: 1,
      tests: passed,
      review: approved,
      preflight: {
        taskId,
        branch,
        targetBranch: 'main',
        commits: 1,
        diff: task.diff,
        worktreeClean: true,
        workspaceClean: true,
        baseAdvanced: false,
        conflicts: false,
        conflictFiles: [],
        blockers: [],
        checkedAt: '2026-10-28T10:10:00.000Z',
      },
      deps: { gh: gh.run },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pullRequest?.number).toBe(3)
  })
})
