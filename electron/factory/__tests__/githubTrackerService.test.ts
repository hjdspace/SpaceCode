// @vitest-environment node
/**
 * GitHub Issues 任务源编排：领取前先写幂等评论、只有成功的 issue 进入运行、
 * 合并回写失败只标记待重试，以及 gh 不可用时回退 REST。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createGithubTrackerService, type GithubTrackerServiceDeps } from '../githubTrackerService'
import { createFactorySecretStore, type FactorySecretStore } from '../secrets'
import { createGithubRun, readRunSnapshot, runDir, tasksFilePath } from '../runs'
import { readEvents } from '../events'
import type { FactoryGithubIssue, FactoryTask } from '@/shared/factory'
import type { GithubTracker } from '../githubTracker'
import type { GithubFetch } from '../githubClient'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-github-service-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function seedConfig(options: { auth?: 'gh' | 'token'; commentIssue?: boolean; closeIssue?: boolean } = {}): void {
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'worktree' },
      tracker: {
        type: 'github-issues',
        repo: 'hjdspace/SpaceCode',
        label: 'ready-for-agent',
        auth: options.auth ?? 'gh',
        mergeMode: 'local',
        commentIssue: options.commentIssue ?? true,
        closeIssue: options.closeIssue ?? true,
      },
      commands: { verify: 'npm run test' },
    },
    { baseBranch: 'main' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  writeFactoryConfigAtomic(dir, built.config)
}

function makeSecrets(token?: string): FactorySecretStore {
  const store = createFactorySecretStore({
    filePath: join(dir, 'userData', 'factory-secrets.json'),
    crypto: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`enc:${value}`),
      decryptString: (buffer) => buffer.toString().replace(/^enc:/, ''),
    },
  })
  if (token) store.saveGithubToken(token)
  return store
}

function issue(number: number, overrides: Partial<FactoryGithubIssue> = {}): FactoryGithubIssue {
  return {
    number,
    title: `issue ${number}`,
    body: `body ${number}`,
    labels: ['ready-for-agent'],
    state: 'open',
    claimed: false,
    ...overrides,
  }
}

function makeTracker(overrides: Partial<GithubTracker> = {}): GithubTracker {
  return {
    list: vi.fn(async () => ({ ok: true, issues: [] })),
    claim: vi.fn(async () => ({ ok: true, idempotent: false })),
    writeBack: vi.fn(async () => ({ ok: true, commented: true, closed: true })),
    ...overrides,
  } as unknown as GithubTracker
}

function makeService(
  tracker: GithubTracker,
  overrides: Partial<GithubTrackerServiceDeps> = {},
): ReturnType<typeof createGithubTrackerService> {
  return createGithubTrackerService({
    secrets: makeSecrets(),
    resolveTracker: async () => ({ ok: true, tracker }),
    now: () => new Date('2026-10-28T10:00:00.000Z'),
    genId: () => 'run-gh-1',
    ...overrides,
  })
}

function seedClaimedRun(issueNumber: number, runId = 'run-gh-1'): FactoryTask {
  const created = createGithubRun(
    dir,
    { runId, tasks: [{ issueNumber, title: `issue ${issueNumber}`, goal: `body ${issueNumber}` }] },
    { now: () => new Date('2026-10-28T09:00:00.000Z') },
  )
  if (!created.ok) throw new Error('fixture run invalid')
  return created.snapshot.tasks[0]
}

function mergePayload(task: FactoryTask) {
  return {
    repoRoot: dir,
    runId: task.runId,
    task,
    mode: 'merge' as const,
    targetBranch: 'main',
    mergedCommits: 2,
    mergedAt: '2026-10-28T11:00:00.000Z',
  }
}

function eventsOf(runId: string) {
  return readEvents(join(runDir(dir, runId), 'events.jsonl'))
}

describe('claimIssues', () => {
  beforeEach(() => seedConfig())

  it('only turns successfully claimed issues into queued tasks', async () => {
    const tracker = makeTracker({
      list: async () => ({ ok: true, issues: [issue(1), issue(2)] }),
      claim: async (input) =>
        input.issueNumber === 1
          ? { ok: true, idempotent: false }
          : { ok: false, reason: 'already-claimed', byRun: 'run-old' },
    })
    const service = makeService(tracker)

    const result = await service.claimIssues(dir, { issueNumbers: [1, 2] })
    if (!result.ok) throw new Error(`unexpected failure: ${result.reason}`)

    expect(result.claimed).toEqual([1])
    expect(result.failed).toEqual([{ number: 2, reason: 'already-claimed' }])
    expect(result.snapshot.tasks).toHaveLength(1)
    expect(result.snapshot.tasks[0]).toMatchObject({
      id: 'issue-1',
      source: 'github-issues',
      issueNumber: 1,
      title: 'issue 1',
      goal: 'body 1',
      lane: 'queued',
    })

    const codes = eventsOf('run-gh-1').map((event) => event.code)
    expect(codes).toContain('github.imported')
    expect(codes).toContain('github.claimed')
    expect(codes).toContain('github.claim.failed')
  })

  it('does not create a run when every claim fails', async () => {
    const tracker = makeTracker({
      list: async () => ({ ok: true, issues: [issue(3)] }),
      claim: async () => ({ ok: false, reason: 'repo-permission' }),
    })
    const service = makeService(tracker)

    const result = await service.claimIssues(dir, { issueNumbers: [3] })
    expect(result).toMatchObject({
      ok: false,
      reason: 'all-failed',
      failed: [{ number: 3, reason: 'repo-permission' }],
    })
    expect(existsSync(join(dir, '.spacecode/factory/runs'))).toBe(false)
  })

  it('rejects a locally claimed issue before writing any comment', async () => {
    seedClaimedRun(7, 'run-existing')
    const tracker = makeTracker()
    const service = makeService(tracker, { genId: () => 'run-gh-2' })

    const result = await service.claimIssues(dir, { issueNumbers: [7] })
    expect(result).toMatchObject({
      ok: false,
      reason: 'duplicate-issues',
      failed: [{ number: 7, reason: 'already-claimed' }],
    })
    expect(tracker.claim).not.toHaveBeenCalled()
  })

  it('surfaces list failures without creating a run', async () => {
    const tracker = makeTracker({ list: async () => ({ ok: false, reason: 'rate-limit' }) })
    const service = makeService(tracker)

    const result = await service.claimIssues(dir, { issueNumbers: [4] })
    expect(result).toMatchObject({ ok: false, reason: 'rate-limit' })
    expect(existsSync(runDir(dir, 'run-gh-1'))).toBe(false)
  })

  it('rejects an empty selection', async () => {
    const service = makeService(makeTracker())
    expect(await service.claimIssues(dir, { issueNumbers: [] })).toEqual({
      ok: false,
      reason: 'no-selection',
    })
  })
})

describe('writeBackMerge', () => {
  beforeEach(() => seedConfig())

  it('records a successful comment and close on the task', async () => {
    const task = seedClaimedRun(9)
    const tracker = makeTracker()
    const service = makeService(tracker)

    await service.writeBackMerge(mergePayload(task))

    const written = readRunSnapshot(dir, 'run-gh-1')?.tasks[0]
    expect(written?.writeback).toMatchObject({
      status: 'done',
      attempts: 1,
      commented: true,
      closed: true,
    })
    expect(tracker.writeBack).toHaveBeenCalledTimes(1)
    const body = (tracker.writeBack as ReturnType<typeof vi.fn>).mock.calls[0][0].body as string
    expect(body).toContain('agent/issue-9')
    expect(body).toContain('main')
    expect(body).toContain('2 个')

    const codes = eventsOf('run-gh-1').map((event) => event.code)
    expect(codes).toContain('github.writeback.done')
  })

  it('marks the task failed without undoing the merge when writing back fails', async () => {
    const task = seedClaimedRun(10)
    const tracker = makeTracker({
      writeBack: async () => ({
        ok: false,
        reason: 'repo-permission',
        commented: false,
        closed: false,
      }),
    })
    const service = makeService(tracker)

    await expect(service.writeBackMerge(mergePayload(task))).rejects.toThrow('repo-permission')

    const written = readRunSnapshot(dir, 'run-gh-1')?.tasks[0]
    expect(written?.writeback).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: 'repo-permission',
    })
    const codes = eventsOf('run-gh-1').map((event) => event.code)
    expect(codes).toContain('github.writeback.failed')
  })

  it('skips local tasks that have no issue to write back', async () => {
    const tracker = makeTracker()
    const service = makeService(tracker)
    await service.writeBackMerge({
      repoRoot: dir,
      runId: 'run-local',
      task: { ...seedClaimedRun(11), source: 'local', issueNumber: undefined },
      mode: 'merge',
      targetBranch: 'main',
      mergedCommits: 1,
      mergedAt: '2026-10-28T11:00:00.000Z',
    })
    expect(tracker.writeBack).not.toHaveBeenCalled()
  })
})

describe('retryWriteback', () => {
  beforeEach(() => seedConfig())

  it('retries only the missing half and records the new attempt', async () => {
    const task = seedClaimedRun(12)
    const path = tasksFilePath(dir, 'run-gh-1')
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Array<Record<string, unknown>>
    raw[0].lane = 'done'
    raw[0].timestamps = { mergedAt: '2026-10-28T11:00:00.000Z' }
    raw[0].writeback = {
      status: 'failed',
      at: '2026-10-28T11:01:00.000Z',
      attempts: 1,
      commented: true,
    }
    writeFileSync(path, JSON.stringify(raw), 'utf-8')

    const tracker = makeTracker({
      writeBack: vi.fn(async () => ({ ok: true, commented: false, closed: true })),
    })
    const service = makeService(tracker)

    const result = await service.retryWriteback(dir, 'run-gh-1', task.id)
    expect(result.ok).toBe(true)

    const input = (tracker.writeBack as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      comment: boolean
      close: boolean
    }
    expect(input.comment).toBe(false)
    expect(input.close).toBe(true)

    const written = readRunSnapshot(dir, 'run-gh-1')?.tasks[0]
    expect(written?.writeback).toMatchObject({
      status: 'done',
      attempts: 2,
      commented: true,
      closed: true,
    })
  })

  it('refuses tasks that are not merged or have nothing to retry', async () => {
    const task = seedClaimedRun(13)
    const tracker = makeTracker()
    const service = makeService(tracker)

    expect(await service.retryWriteback(dir, 'run-gh-1', 'missing')).toMatchObject({
      ok: false,
      reason: 'task-not-found',
    })
    expect(await service.retryWriteback(dir, 'run-gh-1', task.id)).toMatchObject({
      ok: false,
      reason: 'not-merged',
    })
  })
})

describe('auth resolution', () => {
  it('falls back to the REST token when gh is not logged in', async () => {
    seedConfig({ auth: 'gh' })
    const fetchImpl = vi.fn<GithubFetch>(async () => ({
      status: 200,
      text: async () =>
        JSON.stringify([
          {
            number: 5,
            title: 'REST issue',
            body: 'from rest',
            labels: ['ready-for-agent'],
            state: 'open',
          },
        ]),
      headers: { get: () => null },
    }))
    const service = createGithubTrackerService({
      secrets: makeSecrets('ghp_test_token'),
      checkGh: async () => ({ ok: false, reason: 'gh-not-logged-in' }),
      fetchImpl,
      now: () => new Date('2026-10-28T10:00:00.000Z'),
    })

    const result = await service.listIssues(dir)
    if (!result.ok) throw new Error(`unexpected failure: ${result.reason}`)
    expect(result.issues.map((item) => item.number)).toEqual([5])
    expect(fetchImpl).toHaveBeenCalled()
    const [, init] = fetchImpl.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_test_token')
  })

  it('prefers gh when it is authenticated', async () => {
    seedConfig({ auth: 'gh' })
    const runGh = vi.fn(async (args: string[]) => ({
      code: 0,
      stdout: args.includes('list')
        ? JSON.stringify([
            {
              number: 6,
              title: 'gh issue',
              body: 'from gh',
              labels: ['ready-for-agent'],
              state: 'OPEN',
              comments: [],
            },
          ])
        : '',
    }))
    const service = createGithubTrackerService({
      secrets: makeSecrets(),
      checkGh: async () => ({ ok: true, reason: 'ok' }),
      runGh,
      now: () => new Date('2026-10-28T10:00:00.000Z'),
    })

    const result = await service.listIssues(dir)
    if (!result.ok) throw new Error('unexpected failure')
    expect(result.issues.map((item) => item.number)).toEqual([6])
    expect(runGh).toHaveBeenCalled()
  })

  it('reports invalid-token when token auth has no stored secret', async () => {
    seedConfig({ auth: 'token' })
    const service = createGithubTrackerService({
      secrets: makeSecrets(),
      checkGh: async () => ({ ok: false, reason: 'gh-not-logged-in' }),
    })
    expect(await service.listIssues(dir)).toMatchObject({ ok: false, reason: 'invalid-token' })
  })
})
