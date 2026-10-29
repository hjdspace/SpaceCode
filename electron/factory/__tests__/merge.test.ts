// @vitest-environment node
/**
 * 合并闸门：真实临时仓库覆盖三种合并方式、基础分支前进、冲突、
 * 复跑验证失败、脏工作树、未确认拦截与清理/回写钩子。
 *
 * 这些用例刻意跨真实 Git 与真实 tasks.json：假 Git 无法证明
 * 「冲突检测不改工作区」「合并后分支/目录按规则清理」这类事实。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createBacklogItem } from '../backlog'
import { createFactoryRun, readRunSnapshot } from '../runs'
import { transitionTask } from '../runtime'
import { readEvents } from '../events'
import { executeMerge, runMergePreflight, type MergeWriteBackPayload } from '../merge'
import type { FactoryMergeExecuteInput, FactoryReview, FactoryTestRun } from '@/shared/factory'
import type { VerifyResult } from '../verify'

/** 真实 Git 调用在并行 worker 下会排队，放宽单用例超时避免误报。 */
vi.setConfig({ testTimeout: 30_000 })

let dir: string
let runId: string
const taskId = 'bl-1'
const branch = 'agent/task-bl-1'
const worktree = '.spacecode/worktrees/bl-1'

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
  return join(dir, '.spacecode', 'worktrees', 'bl-1')
}

function commitInWorktree(file: string, content: string, message: string): void {
  writeFileSync(join(worktreePath(), file), content)
  git(worktreePath(), ['add', '.'])
  git(worktreePath(), ['commit', '-m', message])
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

function failVerify(): Promise<VerifyResult> {
  return Promise.resolve({ ...passed, status: 'fail', exitCode: 1, detail: '1 failing test' })
}

function seed(): void {
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'worktree' },
      tracker: { type: 'local', mergeMode: 'local' },
      commands: { verify: 'npm run test:changed' },
    },
    { baseBranch: 'main' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  writeFactoryConfigAtomic(dir, built.config)

  const backlog = createBacklogItem(dir, { title: '合并任务', goal: '目标' }, { genId: () => taskId })
  if (!backlog.ok) throw new Error('fixture backlog invalid')
  const created = createFactoryRun(dir, { taskIds: [taskId] }, { genId: () => 'run-1' })
  if (!created.ok) throw new Error('fixture run invalid')
  runId = created.snapshot.run.id

  git(dir, ['worktree', 'add', '-b', branch, worktreePath(), 'main'])
  commitInWorktree('feature.txt', 'feature\n', 'feat: add feature')

  transitionTask(
    dir,
    runId,
    taskId,
    { lane: 'implementing', stageIdx: 2 },
    'worktree.ready',
    { worktree, branch },
  )
  transitionTask(
    dir,
    runId,
    taskId,
    { lane: 'reviewing', stageIdx: 4 },
    'tests.passed',
    { tests: passed, review: approved },
  )
  const approvedMove = transitionTask(
    dir,
    runId,
    taskId,
    { lane: 'mergeable', stageIdx: 5 },
    'task.approved',
  )
  if (!approvedMove.ok) throw new Error('fixture transition invalid')
}

function snapshotTask() {
  return readRunSnapshot(dir, runId)?.tasks.find((task) => task.id === taskId) ?? null
}

function mergeInput(overrides: Partial<FactoryMergeExecuteInput> = {}): FactoryMergeExecuteInput {
  return { mode: 'merge', confirmed: true, ...overrides }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-merge-'))
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(join(dir, '.gitignore'), '.spacecode/\n')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-m', 'base'])
  seed()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('merge preflight', () => {
  it('reports a clean, conflict-free and up-to-date mergeable task', async () => {
    const result = await runMergePreflight(dir, runId, taskId, { runVerify: passVerify })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preflight).toMatchObject({
      branch,
      targetBranch: 'main',
      commits: 1,
      worktreeClean: true,
      baseAdvanced: false,
      conflicts: false,
      blockers: [],
    })
    expect(result.preflight.verify?.status).toBe('pass')
  })

  it('blocks when the base branch has advanced', async () => {
    writeFileSync(join(dir, 'main-only.txt'), 'moved\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'main moved'])

    const result = await runMergePreflight(dir, runId, taskId, { runVerify: passVerify })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preflight.baseAdvanced).toBe(true)
    expect(result.preflight.blockers).toContain('base-advanced')
  })

  it('detects conflicts without touching the main working tree', async () => {
    commitInWorktree('README.md', 'feature side\n', 'feat: clash')
    writeFileSync(join(dir, 'README.md'), 'main side\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'main clash'])

    const result = await runMergePreflight(dir, runId, taskId, { runVerify: passVerify })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preflight.conflicts).toBe(true)
    expect(result.preflight.conflictFiles).toContain('README.md')
    expect(result.preflight.blockers).toContain('conflict')
    expect(git(dir, ['status', '--porcelain']).trim()).toBe('')
    expect(git(dir, ['rev-parse', 'HEAD']).trim()).toBe(git(dir, ['rev-parse', 'main']).trim())
  })

  it('blocks on a failed verification rerun', async () => {
    const result = await runMergePreflight(dir, runId, taskId, { runVerify: failVerify })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preflight.verify?.status).toBe('fail')
    expect(result.preflight.blockers).toContain('verify-failed')
  })

  it('blocks a dirty worktree and keeps the changes', async () => {
    writeFileSync(join(worktreePath(), 'scratch.txt'), 'wip\n')
    const result = await runMergePreflight(dir, runId, taskId, { runVerify: passVerify })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preflight.worktreeClean).toBe(false)
    expect(result.preflight.blockers).toContain('worktree-dirty')
    expect(existsSync(join(worktreePath(), 'scratch.txt'))).toBe(true)
  })

  it('refuses a task that is not mergeable', async () => {
    transitionTask(dir, runId, taskId, { lane: 'blocked' }, 'review.changes_requested')
    const result = await runMergePreflight(dir, runId, taskId, { runVerify: passVerify })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preflight.blockers).toContain('not-mergeable')
  })

  it('blocks when the current workspace has uncommitted changes', async () => {
    writeFileSync(join(dir, 'dirty.txt'), 'wip\n')
    const result = await runMergePreflight(dir, runId, taskId, { runVerify: passVerify })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preflight.workspaceClean).toBe(false)
    expect(result.preflight.blockers).toContain('workspace-dirty')
  })
})

describe('execute merge', () => {
  it('merges with a merge commit, records metadata and cleans the worktree', async () => {
    let written: MergeWriteBackPayload | null = null
    const result = await executeMerge(dir, runId, taskId, mergeInput(), {
      runVerify: passVerify,
      writeBack: (payload) => {
        written = payload
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mergedCommits).toBe(1)
    expect(result.targetBranch).toBe('main')
    expect(result.cleanup).toBe('removed')

    const task = snapshotTask()
    expect(task?.lane).toBe('done')
    expect(task?.mergedCommits).toBe(1)
    expect(task?.targetBranch).toBe('main')
    expect(task?.timestamps.mergedAt).toBeTruthy()
    expect(task?.worktree).toBeNull()

    expect(existsSync(worktreePath())).toBe(false)
    expect(gitOk(dir, ['rev-parse', '--verify', branch])).toBe(false)
    expect(git(dir, ['log', '--merges', '--format=%s', '-1', 'main']).trim()).toBe(
      `Merge branch '${branch}' into main`,
    )
    expect(git(dir, ['show', 'main:feature.txt']).trim()).toBe('feature')

    const events = readEvents(join(dir, '.spacecode', 'factory', 'runs', runId, 'events.jsonl'), {
      taskId,
    }).map((event) => event.code)
    expect(events).toEqual(
      expect.arrayContaining(['merge.preflight', 'merge.started', 'merge.completed', 'merge.cleaned']),
    )
    expect(written).toMatchObject({ mode: 'merge', targetBranch: 'main', mergedCommits: 1 })
  })

  it('squashes the branch into a single new commit', async () => {
    const result = await executeMerge(dir, runId, taskId, mergeInput({ mode: 'squash' }), {
      runVerify: passVerify,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(git(dir, ['rev-list', '--count', 'main']).trim()).toBe('2')
    expect(git(dir, ['log', '--merges', '--format=%H', 'main']).trim()).toBe('')
    expect(git(dir, ['show', 'main:feature.txt']).trim()).toBe('feature')
    expect(snapshotTask()?.lane).toBe('done')
  })

  it('rebases the branch and fast-forwards a linear history', async () => {
    const result = await executeMerge(dir, runId, taskId, mergeInput({ mode: 'rebase' }), {
      runVerify: passVerify,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(git(dir, ['rev-list', '--count', 'main']).trim()).toBe('2')
    expect(git(dir, ['log', '--merges', '--format=%H', 'main']).trim()).toBe('')
    expect(git(dir, ['show', 'main:feature.txt']).trim()).toBe('feature')
    expect(snapshotTask()?.lane).toBe('done')
  })

  it('requires the review acknowledgment checkbox', async () => {
    const result = await executeMerge(dir, runId, taskId, mergeInput({ confirmed: false }), {
      runVerify: passVerify,
    })
    expect(result).toMatchObject({ ok: false, error: 'confirm-required' })
    expect(snapshotTask()?.lane).toBe('mergeable')
  })

  it('rejects an unknown merge mode', async () => {
    const result = await executeMerge(
      dir,
      runId,
      taskId,
      mergeInput({ mode: 'force' as FactoryMergeExecuteInput['mode'] }),
      { runVerify: passVerify },
    )
    expect(result).toMatchObject({ ok: false, error: 'invalid-mode' })
  })

  it('blocks on base advance and leaves the target branch untouched', async () => {
    writeFileSync(join(dir, 'main-only.txt'), 'moved\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'main moved'])
    const before = git(dir, ['rev-parse', 'main']).trim()

    const result = await executeMerge(dir, runId, taskId, mergeInput(), { runVerify: passVerify })
    expect(result).toMatchObject({ ok: false, error: 'base-advanced' })
    expect(git(dir, ['rev-parse', 'main']).trim()).toBe(before)
    expect(snapshotTask()?.lane).toBe('blocked')
    expect(existsSync(worktreePath())).toBe(true)
  })

  it('blocks on conflict, keeps the worktree and main stays clean', async () => {
    commitInWorktree('README.md', 'feature side\n', 'feat: clash')
    writeFileSync(join(dir, 'README.md'), 'main side\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'main clash'])

    const result = await executeMerge(dir, runId, taskId, mergeInput(), { runVerify: passVerify })
    expect(result).toMatchObject({ ok: false, error: 'conflict' })
    expect(snapshotTask()?.lane).toBe('blocked')
    expect(existsSync(worktreePath())).toBe(true)
    expect(git(dir, ['status', '--porcelain']).trim()).toBe('')
    expect(git(dir, ['show', 'HEAD:README.md']).trim()).toBe('main side')
  })

  it('blocks on a failed verification rerun and keeps the worktree', async () => {
    const result = await executeMerge(dir, runId, taskId, mergeInput(), { runVerify: failVerify })
    expect(result).toMatchObject({ ok: false, error: 'verify-failed' })
    const task = snapshotTask()
    expect(task?.lane).toBe('blocked')
    expect(task?.tests?.status).toBe('fail')
    expect(existsSync(worktreePath())).toBe(true)
    expect(git(dir, ['rev-list', '--count', 'main']).trim()).toBe('1')
  })

  it('blocks on a dirty worktree without merging', async () => {
    writeFileSync(join(worktreePath(), 'scratch.txt'), 'wip\n')
    const result = await executeMerge(dir, runId, taskId, mergeInput(), { runVerify: passVerify })
    expect(result).toMatchObject({ ok: false, error: 'dirty-worktree' })
    expect(snapshotTask()?.lane).toBe('blocked')
    expect(existsSync(join(worktreePath(), 'scratch.txt'))).toBe(true)
    expect(gitOk(dir, ['cat-file', '-e', 'main:feature.txt'])).toBe(false)
  })

  it('merges through a temp worktree when the target branch is not checked out', async () => {
    git(dir, ['checkout', '-b', 'topic'])
    const before = git(dir, ['rev-parse', 'main']).trim()

    const result = await executeMerge(dir, runId, taskId, mergeInput(), { runVerify: passVerify })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(git(dir, ['rev-parse', 'main']).trim()).not.toBe(before)
    expect(git(dir, ['show', 'main:feature.txt']).trim()).toBe('feature')
    expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('topic')
    expect(git(dir, ['status', '--porcelain']).trim()).toBe('')
    expect(existsSync(join(dir, '.spacecode', 'worktrees', `merge-${taskId}`))).toBe(false)
    expect(snapshotTask()?.lane).toBe('done')
  })

  it('keeps the merge successful when the write-back hook throws', async () => {
    const result = await executeMerge(dir, runId, taskId, mergeInput(), {
      runVerify: passVerify,
      writeBack: () => {
        throw new Error('comment failed')
      },
    })
    expect(result.ok).toBe(true)
    expect(snapshotTask()?.lane).toBe('done')

    const codes = readEvents(join(dir, '.spacecode', 'factory', 'runs', runId, 'events.jsonl'), {
      taskId,
    }).map((event) => event.code)
    expect(codes).toContain('merge.writeback.error')
  })
})
