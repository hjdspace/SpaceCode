// @vitest-environment node
/**
 * GitHub 任务源：列表过滤/去重、幂等领取评论、合并回写与失败降级。
 * 通过注入的 GithubApi 覆盖所有分支，不触网。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  buildMergeComment,
  claimMarker,
  createGithubTracker,
  parseClaimMarkers,
  type GithubTrackerApi,
} from '../githubTracker'
import type { FactoryGithubFailureReason, FactoryReview, FactoryTestRun } from '@/shared/factory'
import type { GithubRawIssue, GithubResult } from '../githubClient'

function ok<T>(value: T): Promise<GithubResult<T>> {
  return Promise.resolve({ ok: true, value })
}

function fail(reason: FactoryGithubFailureReason): Promise<GithubResult<never>> {
  return Promise.resolve({ ok: false, reason })
}

function fakeApi(overrides: Partial<GithubTrackerApi> = {}): GithubTrackerApi {
  return {
    listIssues: vi.fn(async () => ok<GithubRawIssue[]>([])),
    listComments: vi.fn(async () => ok<Array<{ body: string }>>([])),
    createComment: vi.fn(async () => ok<{ id?: number }>({})),
    closeIssue: vi.fn(async () => ok({ closed: true })),
    ...overrides,
  }
}

const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `issue ${number}`,
  body: 'body',
  labels: ['ready-for-agent'],
  state: 'open' as const,
  ...extra,
})

describe('createGithubTracker.list', () => {
  it('filters to open issues carrying the label and dedupes by number', async () => {
    const api = fakeApi({
      listIssues: vi.fn(async () =>
        ok<GithubRawIssue[]>([
          issue(1),
          issue(1),
          issue(2, { labels: ['other'] }),
          issue(3, { state: 'closed' }),
          issue(4),
        ]),
      ),
    })
    const tracker = createGithubTracker({ api, label: 'ready-for-agent' })
    const result = await tracker.list()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.map((item) => item.number)).toEqual([1, 4])
    expect(result.issues[0].claimed).toBe(false)
  })

  it('marks issues claimed by a claim comment or a local unfinished run', async () => {
    const api = fakeApi({
      listIssues: vi.fn(async () =>
        ok<GithubRawIssue[]>([
          issue(1, { comments: [{ body: claimMarker('run-a', 'issue-1') }] }),
          issue(2),
          issue(3),
        ]),
      ),
    })
    const tracker = createGithubTracker({ api, label: 'ready-for-agent', locallyClaimed: [2] })
    const result = await tracker.list()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.map((item) => [item.number, item.claimed])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ])
  })

  it('treats claim comments from finished, cancelled or unknown runs as stale', async () => {
    const api = fakeApi({
      listIssues: vi.fn(async () =>
        ok<GithubRawIssue[]>([
          issue(1, { comments: [{ body: claimMarker('run-gone', 'issue-1') }] }),
          issue(2, { comments: [{ body: claimMarker('run-live', 'issue-2') }] }),
          issue(3, { comments: [{ body: claimMarker('run-ended-task', 'issue-3') }] }),
        ]),
      ),
    })
    const tracker = createGithubTracker({
      api,
      label: 'ready-for-agent',
      holdsClaim: (_issueNumber, runId) => runId === 'run-live',
    })
    const result = await tracker.list()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.map((item) => [item.number, item.claimed])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ])
  })

  it('passes the failure reason through untouched', async () => {
    const api = fakeApi({ listIssues: vi.fn(async () => fail('rate-limit')) })
    const tracker = createGithubTracker({ api })
    expect(await tracker.list()).toMatchObject({ ok: false, reason: 'rate-limit' })
  })
})

describe('createGithubTracker.claim', () => {
  it('posts one claim comment including the run marker and is idempotent for the same run', async () => {
    const api = fakeApi()
    const tracker = createGithubTracker({ api })
    const first = await tracker.claim({ issueNumber: 7, runId: 'run-1', taskId: 'issue-7' })
    expect(first).toMatchObject({ ok: true, idempotent: false })
    expect(api.createComment).toHaveBeenCalledTimes(1)
    const body = vi.mocked(api.createComment).mock.calls[0][1]
    expect(body).toContain('<!-- spacecode-factory:claim run=run-1 task=issue-7 -->')

    vi.mocked(api.listComments).mockResolvedValueOnce({ ok: true, value: [{ body }] })
    const again = await tracker.claim({ issueNumber: 7, runId: 'run-1', taskId: 'issue-7' })
    expect(again).toMatchObject({ ok: true, idempotent: true })
    expect(api.createComment).toHaveBeenCalledTimes(1)
  })

  it('rejects an issue already claimed by another run', async () => {
    const api = fakeApi({
      listComments: vi.fn(async () => ok([{ body: claimMarker('run-0', 'issue-7') }])),
    })
    const tracker = createGithubTracker({ api })
    expect(await tracker.claim({ issueNumber: 7, runId: 'run-1', taskId: 'issue-7' })).toMatchObject({
      ok: false,
      reason: 'already-claimed',
      byRun: 'run-0',
    })
    expect(api.createComment).not.toHaveBeenCalled()
  })

  it('lets a new run reclaim an issue whose previous claim run has ended', async () => {
    const api = fakeApi({
      listComments: vi.fn(async () => ok([{ body: claimMarker('run-gone', 'issue-7') }])),
    })
    const tracker = createGithubTracker({ api, holdsClaim: (_issueNumber, runId) => runId === 'run-live' })
    expect(await tracker.claim({ issueNumber: 7, runId: 'run-1', taskId: 'issue-7' })).toMatchObject({
      ok: true,
      idempotent: false,
    })
    expect(api.createComment).toHaveBeenCalledTimes(1)
  })

  it('still rejects an issue claimed by a run that is still active', async () => {
    const api = fakeApi({
      listComments: vi.fn(async () => ok([{ body: claimMarker('run-live', 'issue-7') }])),
    })
    const tracker = createGithubTracker({ api, holdsClaim: (_issueNumber, runId) => runId === 'run-live' })
    expect(await tracker.claim({ issueNumber: 7, runId: 'run-1', taskId: 'issue-7' })).toMatchObject({
      ok: false,
      reason: 'already-claimed',
      byRun: 'run-live',
    })
    expect(api.createComment).not.toHaveBeenCalled()
  })

  it('refuses to enter the run when the comment fails', async () => {
    const api = fakeApi({ createComment: vi.fn(async () => fail('invalid-token')) })
    const tracker = createGithubTracker({ api })
    expect(await tracker.claim({ issueNumber: 7, runId: 'run-1', taskId: 'issue-7' })).toMatchObject({
      ok: false,
      reason: 'invalid-token',
    })
  })
})

describe('createGithubTracker.writeBack', () => {
  it('comments and closes according to the two independent switches', async () => {
    const api = fakeApi()
    const tracker = createGithubTracker({ api })
    const result = await tracker.writeBack({ issueNumber: 7, body: 'summary', comment: true, close: true })
    expect(result).toMatchObject({ ok: true, commented: true, closed: true })
    expect(api.createComment).toHaveBeenCalledWith(7, 'summary')
    expect(api.closeIssue).toHaveBeenCalledWith(7)

    const commentOnly = fakeApi()
    await createGithubTracker({ api: commentOnly }).writeBack({
      issueNumber: 8,
      body: 's',
      comment: true,
      close: false,
    })
    expect(commentOnly.createComment).toHaveBeenCalledTimes(1)
    expect(commentOnly.closeIssue).not.toHaveBeenCalled()
  })

  it('reports failure without pretending the close happened', async () => {
    const api = fakeApi({ createComment: vi.fn(async () => fail('rate-limit')) })
    const tracker = createGithubTracker({ api })
    expect(await tracker.writeBack({ issueNumber: 7, body: 's', comment: true, close: true })).toMatchObject({
      ok: false,
      reason: 'rate-limit',
      commented: false,
      closed: false,
    })
    expect(api.closeIssue).not.toHaveBeenCalled()
  })
})

describe('claim markers and merge summary', () => {
  it('parses markers defensively', () => {
    expect(parseClaimMarkers(['plain', claimMarker('r1', 'issue-1')])).toEqual([{ runId: 'r1', taskId: 'issue-1' }])
    expect(parseClaimMarkers(['<!-- spacecode-factory:claim -->'])).toEqual([])
  })

  it('builds a summary with branch, commits, verification and review', () => {
    const tests: FactoryTestRun = { status: 'pass', command: 'npm run test', at: '2026-10-29T10:00:00Z' }
    const review: FactoryReview = {
      verdict: 'approved',
      summary: 'looks good',
      comments: [],
      at: '2026-10-29T10:01:00Z',
    }
    const body = buildMergeComment({
      branch: 'agent/issue-12-session',
      targetBranch: 'main',
      mergedCommits: 3,
      mergedAt: '2026-10-29T10:02:00Z',
      mode: 'merge',
      tests,
      review,
    })
    expect(body).toContain('agent/issue-12-session')
    expect(body).toContain('main')
    expect(body).toContain('3')
    expect(body).toContain('npm run test')
    expect(body).toContain('通过')
  })
})
