// @vitest-environment node
/**
 * GitHub issue 领取后的运行投影：只落领取成功的 issue，任务编号与分支
 * 由 issue 编号派生，且同一 issue 不能被两个未结束的运行同时占用。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import {
  claimedGithubIssues,
  createGithubRun,
  githubTaskId,
  readRunSnapshot,
  runDir,
} from '../runs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-github-runs-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function seedGithubConfig(overrides: { commentIssue?: boolean; closeIssue?: boolean } = {}): void {
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'worktree' },
      tracker: {
        type: 'github-issues',
        repo: 'hjdspace/SpaceCode',
        label: 'ready-for-agent',
        auth: 'gh',
        mergeMode: 'local',
        commentIssue: overrides.commentIssue ?? true,
        closeIssue: overrides.closeIssue ?? true,
      },
      commands: { verify: 'npm run test' },
    },
    { baseBranch: 'main' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  writeFactoryConfigAtomic(dir, built.config)
}

function runDeps() {
  let tick = 0
  return {
    now: () => new Date(Date.parse('2026-10-28T10:00:00.000Z') + tick++ * 1000),
  }
}

function runIds(): string[] {
  const path = join(dir, '.spacecode/factory/runs')
  return existsSync(path) ? readdirSync(path) : []
}

function stopRun(runId: string): void {
  const path = join(runDir(dir, runId), 'run.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  writeFileSync(path, JSON.stringify({ ...raw, status: 'stopped' }), 'utf-8')
}

describe('createGithubRun', () => {
  beforeEach(seedGithubConfig)

  it('projects claimed issues into queued tasks keyed by issue number', () => {
    const result = createGithubRun(
      dir,
      {
        runId: 'run-gh',
        tasks: [
          { issueNumber: 42, title: '登录态刷新丢失', goal: '修复刷新时掉登录' },
          { issueNumber: 7, title: '缓存重复请求', goal: '' },
        ],
      },
      runDeps(),
    )
    if (!result.ok) throw new Error(`unexpected failure: ${result.error}`)

    const { run, tasks } = result.snapshot
    expect(run).toMatchObject({ id: 'run-gh', status: 'pending', maxConcurrency: 4 })
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({
      id: 'issue-42',
      runId: 'run-gh',
      source: 'github-issues',
      issueNumber: 42,
      title: '登录态刷新丢失',
      goal: '修复刷新时掉登录',
      lane: 'queued',
      stageIdx: 0,
      worktree: null,
      model: 'claude-sonnet-4-5',
      iteration: 0,
      maxIterations: 5,
      diff: { additions: 0, deletions: 0 },
    })
    expect(tasks[0].branch).toMatch(/^agent\/issue-42-/)
    expect(tasks[1].id).toBe('issue-7')
    expect(tasks[0].timestamps.claimedAt).toBe(run.createdAt)

    expect(readRunSnapshot(dir, 'run-gh')).toEqual(result.snapshot)
    expect(githubTaskId(42)).toBe('issue-42')
  })

  it('drops duplicate and invalid issue numbers before creating the run', () => {
    const result = createGithubRun(
      dir,
      {
        runId: 'run-dedupe',
        tasks: [
          { issueNumber: 5, title: 'A', goal: '' },
          { issueNumber: 5, title: '重复的 A', goal: '' },
          { issueNumber: 0, title: '非法', goal: '' },
          { issueNumber: -1, title: '非法', goal: '' },
        ],
      },
      runDeps(),
    )
    if (!result.ok) throw new Error('unexpected failure')
    expect(result.snapshot.tasks.map((task) => task.issueNumber)).toEqual([5])

    const empty = createGithubRun(
      dir,
      { runId: 'run-empty', tasks: [{ issueNumber: 0, title: '非法', goal: '' }] },
      runDeps(),
    )
    expect(empty).toMatchObject({ ok: false, error: 'empty-tasks' })
  })

  it('rejects an issue already owned by an unfinished run', () => {
    const first = createGithubRun(
      dir,
      { runId: 'run-1', tasks: [{ issueNumber: 42, title: '已领取', goal: '' }] },
      runDeps(),
    )
    if (!first.ok) throw new Error('fixture run invalid')
    expect(claimedGithubIssues(dir).get(42)).toEqual({ runId: 'run-1', taskId: 'issue-42' })

    const duplicate = createGithubRun(
      dir,
      { runId: 'run-2', tasks: [{ issueNumber: 42, title: '重复', goal: '' }] },
      runDeps(),
    )
    expect(duplicate).toMatchObject({ ok: false, error: 'duplicate-tasks', duplicates: ['42'] })
    expect(runIds()).toEqual(['run-1'])
  })

  it('allows reclaiming the issue once the previous run is stopped', () => {
    const first = createGithubRun(
      dir,
      { runId: 'run-1', tasks: [{ issueNumber: 42, title: '可重新领取', goal: '' }] },
      runDeps(),
    )
    if (!first.ok) throw new Error('fixture run invalid')

    stopRun('run-1')

    const retried = createGithubRun(
      dir,
      { runId: 'run-2', tasks: [{ issueNumber: 42, title: '可重新领取', goal: '' }] },
      runDeps(),
    )
    if (!retried.ok) throw new Error('unexpected failure')
    expect(retried.snapshot.tasks[0]).toMatchObject({ runId: 'run-2', issueNumber: 42 })
    expect(claimedGithubIssues(dir).get(42)?.runId).toBe('run-2')
  })
})
