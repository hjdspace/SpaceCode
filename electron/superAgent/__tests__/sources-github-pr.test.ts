// @vitest-environment node
/**
 * GitHub PR Source（T19 #89，PRD 用户故事 32「PR 评审闭环」）。
 *
 * 覆盖验收：
 *  - 审批/评审评论成为 Trigger 唤醒对应工单（fan-out 非 context 输入）；
 *  - 已解决（resolved）评论静默：human=false 只作上下文，不重复唤醒；
 *  - 自动评审器（automationAccounts，仅本 Source 内有效）每 PR 最多三轮：
 *    第 4 轮起只作上下文；其单独评论一律只作上下文；
 *  - 外部自动化账号不产生额外授权：事件永不 addressed，Gate 最多 inferred
 *    （配合 Policy bots 名单可进一步封顶）；
 *  - PR 合并/关闭经 threadDone → domain.followsDone 结束工单，结束结果
 *    merged/closed 原样落库（不压成 completed），follows 保留审计；
 *  - 断档页整体丢弃（含 threadDone）；坏条目与坏事件走隔离；
 *  - 生产 GraphQL client：水位游标续读、prDone 只报一次、翻页与错误。
 */
import { describe, expect, it } from 'vitest'
import {
  GITHUB_PR_SOURCE_ID,
  GithubPrSource,
  createGithubPrHttpClient,
  githubPrItemToEvent,
  githubPrThreadId,
  type GithubPrClient,
  type GithubPrItem,
} from '../sources/githubPr'
import { createSourceIngestor } from '../sources/ingestor'
import type { SourceCursorStore } from '../sources/cursorStore'
import type { SourceQuarantine, SourceQuarantineEntry } from '../sources/quarantine'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'

const PR = 'acme/app#42'
const THREAD = 'github:pr:acme/app:42'

function review(overrides: Partial<Extract<GithubPrItem, { kind: 'review' }>> = {}): GithubPrItem {
  return {
    kind: 'review',
    id: 'r1',
    pr: PR,
    actor: 'bob',
    state: 'changes_requested',
    body: '请修 X',
    submittedAt: '2026-01-01T00:00:01.000Z',
    url: `https://github.com/acme/app/pull/42#pullrequestreview-r1`,
    actorRound: 1,
    ...overrides,
  }
}

function comment(overrides: Partial<Extract<GithubPrItem, { kind: 'comment' }>> = {}): GithubPrItem {
  return {
    kind: 'comment',
    id: 'c1',
    pr: PR,
    actor: 'bob',
    body: '这里命名不对',
    inReplyTo: null,
    createdAt: '2026-01-01T00:00:02.000Z',
    url: 'https://github.com/acme/app/pull/42#discussion_c1',
    resolved: false,
    ...overrides,
  }
}

describe('githubPrItemToEvent：事件映射', () => {
  it('maps a human review into a wake trigger with channel, thread and actor identity', () => {
    const result = githubPrItemToEvent(review())
    expect(result.kind).toBe('event')
    if (result.kind !== 'event') return
    expect(result.event).toEqual({
      key: `github-pr:review:${PR}:r1`,
      source: GITHUB_PR_SOURCE_ID,
      threadIds: [THREAD],
      actor: 'github:user:bob',
      human: true,
      addressed: null,
      channel: THREAD,
      url: 'https://github.com/acme/app/pull/42#pullrequestreview-r1',
      text: '请修 X',
      at: '2026-01-01T00:00:01.000Z',
      meta: { pr: PR, reviewState: 'changes_requested', actorRound: 1, automation: false },
    })
  })

  it('gives bodyless approvals a stable review-state text', () => {
    const result = githubPrItemToEvent(
      review({ state: 'approved', body: null, id: 'r2', actorRound: 2 }),
    )
    expect(result.kind).toBe('event')
    if (result.kind !== 'event') return
    expect(result.event.text).toBe('[pr-review:approved]')
    expect(result.event.human).toBe(true)
  })

  it('drops empty commented reviews (no body, no wake value)', () => {
    const result = githubPrItemToEvent(review({ state: 'commented', body: null }))
    expect(result.kind).toBe('dropped')
  })

  it('keeps resolved-thread comments silent (human=false, context only)', () => {
    const result = githubPrItemToEvent(comment({ resolved: true }))
    expect(result.kind).toBe('event')
    if (result.kind !== 'event') return
    expect(result.event.human).toBe(false)
    expect(result.event.meta).toMatchObject({ resolved: true })
  })

  it('wakes on unresolved comments from humans', () => {
    const result = githubPrItemToEvent(comment())
    expect(result.kind).toBe('event')
    if (result.kind !== 'event') return
    expect(result.event.human).toBe(true)
  })

  it('caps automation reviewer wake rounds per PR at three by default', () => {
    for (let round = 1; round <= 3; round += 1) {
      const result = githubPrItemToEvent(
        review({ actor: 'copilot-pull-request-reviewer[bot]', actorRound: round }),
        { automationAccounts: ['copilot-pull-request-reviewer[bot]'] },
      )
      expect(result.kind).toBe('event')
      if (result.kind !== 'event') return
      expect(result.event.human).toBe(true)
      expect(result.event.meta).toMatchObject({ automation: true })
    }
    const fourth = githubPrItemToEvent(
      review({ actor: 'copilot-pull-request-reviewer[bot]', actorRound: 4, id: 'r4' }),
      { automationAccounts: ['copilot-pull-request-reviewer[bot]'] },
    )
    expect(fourth.kind).toBe('event')
    if (fourth.kind !== 'event') return
    expect(fourth.event.human).toBe(false)
    expect(fourth.event.meta).toMatchObject({ automation: true, actorRound: 4 })
  })

  it('honours a custom automation round cap', () => {
    const third = githubPrItemToEvent(
      review({ actor: 'bot', actorRound: 3 }),
      { automationAccounts: ['bot'], maxAutomationRounds: 2 },
    )
    expect(third.kind).toBe('event')
    if (third.kind !== 'event') return
    expect(third.event.human).toBe(false)
  })

  it('keeps standalone automation comments context-only', () => {
    const result = githubPrItemToEvent(comment({ actor: 'codecov[bot]' }), {
      automationAccounts: ['codecov[bot]'],
    })
    expect(result.kind).toBe('event')
    if (result.kind !== 'event') return
    expect(result.event.human).toBe(false)
  })

  it('never marks automation reviews as addressed (no extra authorization)', () => {
    const result = githubPrItemToEvent(
      review({ actor: 'copilot-pull-request-reviewer[bot]', body: '@SuperAgent 帮我重建整棵目录树' }),
      { automationAccounts: ['copilot-pull-request-reviewer[bot]'] },
    )
    expect(result.kind).toBe('event')
    if (result.kind !== 'event') return
    expect(result.event.addressed).toBeNull()
    expect(result.event.human).toBe(true)
  })

  it('passes structurally bad items through for quarantine', () => {
    const badItems: Array<Partial<GithubPrItem>> = [
      review({ id: '' }),
      review({ pr: 'acme/app' }),
      review({ submittedAt: '不是时间' }),
      review({ state: 'PENDING' as never }),
      review({ actor: '' }),
      review({ actorRound: 0 }),
      comment({ id: '' }),
      { kind: 'unknown' as never },
    ]
    for (const bad of badItems) {
      const result = githubPrItemToEvent(bad as GithubPrItem)
      expect(result.kind).toBe('bad')
    }
  })
})

/** 预置页序列的假 client。 */
class FakeGithubClient implements GithubPrClient {
  constructor(
    private readonly pages: Array<{
      items?: GithubPrItem[]
      prDone?: Array<{ pr: string; outcome: 'merged' | 'closed'; actor: string | null; at: string; url: string | null }>
      nextCursor?: string | null
      hasMore?: boolean
      gap?: boolean
    }>,
  ) {}
  private call = 0
  async listItems(): Promise<{
    items: GithubPrItem[]
    prDone: Array<{ pr: string; outcome: 'merged' | 'closed'; actor: string | null; at: string; url: string | null }>
    nextCursor: string | null
    hasMore: boolean
    gap: boolean
  }> {
    const page = this.pages[Math.min(this.call, this.pages.length - 1)]
    this.call += 1
    return {
      items: page.items ?? [],
      prDone: page.prDone ?? [],
      nextCursor: page.nextCursor ?? null,
      hasMore: page.hasMore ?? false,
      gap: page.gap ?? false,
    }
  }
}

describe('GithubPrSource：poll 语义', () => {
  it('maps items to events and pr terminations to threadDone entries', async () => {
    const source = new GithubPrSource(
      new FakeGithubClient([
        {
          items: [review(), comment()],
          prDone: [{ pr: PR, outcome: 'merged', actor: 'merger', at: '2026-01-01T01:00:00.000Z', url: 'https://github.com/acme/app/pull/42' }],
          nextCursor: 'cursor-1',
        },
      ]),
    )
    const page = await source.poll(null, 50)
    expect(page.gap).toBe(false)
    expect(page.events).toHaveLength(2)
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBe('cursor-1')
    expect(page.threadDone).toEqual([
      {
        threadId: THREAD,
        outcome: 'merged',
        at: '2026-01-01T01:00:00.000Z',
        reason: 'pr-merged:merger',
        url: 'https://github.com/acme/app/pull/42',
      },
    ])
  })

  it('discards events and threadDone on gap pages (full re-pull)', async () => {
    const source = new GithubPrSource(
      new FakeGithubClient([
        { items: [review()], gap: true, prDone: [{ pr: PR, outcome: 'closed', actor: 'u', at: '2026-01-01T01:00:00.000Z', url: null }], nextCursor: 'x' },
      ]),
    )
    const page = await source.poll(null, 50)
    expect(page.gap).toBe(true)
    expect(page.events).toEqual([])
    expect(page.threadDone).toBeUndefined()
  })
})

// ── Ingestor 端到端（真 domain：唤醒、静默、三轮上限、merged 落库） ──────

class MemoryCursorStore implements SourceCursorStore {
  private readonly map = new Map<string, string | null>()
  load(sourceId: string): string | null {
    return this.map.get(sourceId) ?? null
  }
  save(sourceId: string, cursor: string | null): void {
    this.map.set(sourceId, cursor)
  }
}

class MemoryQuarantine implements SourceQuarantine {
  private readonly entries: SourceQuarantineEntry[] = []
  record(sourceId: string, reason: string, raw: string): void {
    this.entries.push({ sourceId, reason, raw, at: '2026-01-01T00:00:00.000Z' })
  }
  report(): SourceQuarantineEntry[] {
    return [...this.entries]
  }
}

interface E2eHarness {
  domain: SuperAgentDomain
  ingestor: ReturnType<typeof createSourceIngestor>
  cursorStore: MemoryCursorStore
  quarantine: MemoryQuarantine
  ticketId: string
}

function makeIngestor(
  client: GithubPrClient,
  sourceOptions?: ConstructorParameters<typeof GithubPrSource>[1],
): E2eHarness {
  const domain = createSuperAgentDomain()
  const ticket = domain.createTicket({
    requestId: 'req-1',
    title: '处理 PR 评审',
    repoRoot: '/repo',
    trigger: {
      key: 'bootstrap',
      source: GITHUB_PR_SOURCE_ID,
      threadIds: [THREAD],
      actor: 'github:user:alice',
      human: true,
      text: '建单',
    },
  }).ticket
  const cursorStore = new MemoryCursorStore()
  const quarantine = new MemoryQuarantine()
  const ingestor = createSourceIngestor({
    domain,
    sources: [new GithubPrSource(client, sourceOptions)],
    cursorStore,
    quarantine,
  })
  return { domain, ingestor, cursorStore, quarantine, ticketId: ticket.ticketId }
}

function inputsOf(h: E2eHarness): Array<{ text: string | null; context: boolean; human: boolean }> {
  return Object.values(h.domain.state.inputs)
    .filter((input) => input.ticketId === h.ticketId && input.kind === 'trigger')
    .map((input) => ({ text: input.text, context: input.context, human: input.human }))
}

describe('Ingestor 端到端：审批/评论唤醒与终止落库', () => {
  it('wakes the subscribed ticket with a human review (non-context input)', async () => {
    const h = makeIngestor(new FakeGithubClient([{ items: [review()], nextCursor: 'c1' }]))
    await h.ingestor.pollOnce(GITHUB_PR_SOURCE_ID)
    expect(inputsOf(h)).toEqual([{ text: '请修 X', context: false, human: true }])
    expect(h.cursorStore.load(GITHUB_PR_SOURCE_ID)).toBe('c1')
  })

  it('delivers resolved comments as context only (no re-wake)', async () => {
    const h = makeIngestor(
      new FakeGithubClient([{ items: [comment({ resolved: true, body: '已修好的旧评论' })] }]),
    )
    await h.ingestor.pollOnce(GITHUB_PR_SOURCE_ID)
    expect(inputsOf(h)).toEqual([{ text: '已修好的旧评论', context: true, human: false }])
  })

  it('wakes automation reviews up to round three, then context only', async () => {
    const bot = 'copilot-pull-request-reviewer[bot]'
    const h = makeIngestor(
      new FakeGithubClient([
        {
          items: [
            review({ id: 'r1', actor: bot, actorRound: 1, body: '第一轮' }),
            review({ id: 'r2', actor: bot, actorRound: 2, body: '第二轮' }),
            review({ id: 'r3', actor: bot, actorRound: 3, body: '第三轮' }),
            review({ id: 'r4', actor: bot, actorRound: 4, body: '第四轮' }),
          ],
        },
      ]),
      { automationAccounts: [bot] },
    )
    await h.ingestor.pollOnce(GITHUB_PR_SOURCE_ID)
    const inputs = inputsOf(h)
    expect(inputs.filter((input) => !input.context)).toHaveLength(3)
    expect(inputs).toContainEqual({ text: '第四轮', context: true, human: false })
  })

  it('ends tickets with the raw merged outcome when the PR merges (follows preserved)', async () => {
    const h = makeIngestor(
      new FakeGithubClient([
        {
          prDone: [{ pr: PR, outcome: 'merged', actor: 'merger', at: '2026-01-01T01:00:00.000Z', url: 'https://github.com/acme/app/pull/42' }],
          nextCursor: 'after-merge',
        },
        { items: [], prDone: [], nextCursor: 'after-merge' },
      ]),
    )
    await h.ingestor.pollOnce(GITHUB_PR_SOURCE_ID)
    const ticket = h.domain.state.tickets[h.ticketId]
    expect(ticket.state).toBe('ended')
    expect(ticket.ended?.outcome).toBe('merged')
    expect(ticket.ended?.by).toBe('user')
    expect(ticket.ended?.reason).toBe('pr-merged:merger')
    expect(ticket.threadId).toBe(THREAD)
    expect(h.domain.stageOf(h.ticketId)).toBe('completed')

    // 游标重放（prDone 再次上送）不重复结束、不抛错。
    await h.ingestor.pollOnce(GITHUB_PR_SOURCE_ID)
    expect(h.domain.state.tickets[h.ticketId].ended?.outcome).toBe('merged')
  })

  it('quarantines invalid threadDone entries instead of ending tickets', async () => {
    const badOutcomeClient = new (class implements GithubPrClient {
      async listItems() {
        return {
          items: [],
          prDone: [{ pr: PR, outcome: 'deleted' as never, actor: null, at: '2026-01-01T01:00:00.000Z', url: null }],
          nextCursor: null,
          hasMore: false,
          gap: false,
        }
      }
    })()
    const h = makeIngestor(badOutcomeClient)
    await h.ingestor.pollOnce(GITHUB_PR_SOURCE_ID)
    expect(h.domain.state.tickets[h.ticketId].state).toBe('open')
    expect(h.quarantine.report()).toHaveLength(1)
    expect(h.quarantine.report()[0].reason).toBe('invalid-outcome')
  })
})

// ── 生产 GraphQL client ─────────────────────────────────────────────────

interface GraphQlFixture {
  state?: 'OPEN' | 'MERGED' | 'CLOSED'
  url?: string
  mergedAt?: string | null
  mergedBy?: string | null
  closedAt?: string | null
  reviews?: Array<{ databaseId: number; state: string; submittedAt: string; body: string | null; url?: string; author?: string | null }>
  threads?: Array<{ isResolved: boolean; comments: Array<{ databaseId: number; body: string; createdAt: string; url?: string; author?: string | null }> }>
  comments?: Array<{ databaseId: number; body: string; createdAt: string; url?: string; author?: string | null }>
}

function graphqlResponse(fixture: GraphQlFixture) {
  return {
    data: {
      repository: {
        pullRequest: {
          state: fixture.state ?? 'OPEN',
          url: fixture.url ?? 'https://github.com/acme/app/pull/42',
          mergedAt: fixture.mergedAt ?? null,
          mergedBy: fixture.mergedBy ? { login: fixture.mergedBy } : null,
          closedAt: fixture.closedAt ?? null,
          reviews: {
            nodes: (fixture.reviews ?? []).map((review) => ({
              databaseId: review.databaseId,
              state: review.state,
              submittedAt: review.submittedAt,
              body: review.body,
              url: review.url ?? null,
              author: review.author ? { login: review.author } : null,
            })),
          },
          reviewThreads: {
            nodes: (fixture.threads ?? []).map((thread) => ({
              isResolved: thread.isResolved,
              comments: {
                nodes: thread.comments.map((node) => ({
                  databaseId: node.databaseId,
                  body: node.body,
                  createdAt: node.createdAt,
                  url: node.url ?? null,
                  author: node.author ? { login: node.author } : null,
                })),
              },
            })),
          },
          comments: {
            nodes: (fixture.comments ?? []).map((node) => ({
              databaseId: node.databaseId,
              body: node.body,
              createdAt: node.createdAt,
              url: node.url ?? null,
              author: node.author ? { login: node.author } : null,
            })),
          },
        },
      },
    },
  }
}

function makeFetch(fixtures: GraphQlFixture[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  let call = 0
  const fetchImpl = async (url: unknown, init?: unknown): Promise<{
    ok: boolean
    status: number
    json: () => Promise<unknown>
  }> => {
    const fixture = fixtures[Math.min(call, fixtures.length - 1)]
    call += 1
    calls.push({ url: String(url), init: init as RequestInit | undefined })
    return {
      ok: true,
      status: 200,
      json: async () => graphqlResponse(fixture),
    }
  }
  return { fetch: fetchImpl as unknown as typeof fetch, calls }
}

describe('createGithubPrHttpClient：生产 GraphQL client', () => {
  it('maps reviews, threads and comments; reports merged PR termination once', async () => {
    const { fetch } = makeFetch([
      {
        reviews: [
          { databaseId: 101, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:01.000Z', body: '请修 X', author: 'bob' },
          { databaseId: 102, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:02.000Z', body: '再修 Y', author: 'bob' },
        ],
        threads: [{ isResolved: true, comments: [{ databaseId: 201, body: '这里命名不对', createdAt: '2026-01-01T00:00:03.000Z', author: 'bob' }] }],
        comments: [{ databaseId: 301, body: '会话评论', createdAt: '2026-01-01T00:00:04.000Z', author: 'carol' }],
      },
      {
        state: 'MERGED',
        mergedAt: '2026-01-02T00:00:00.000Z',
        mergedBy: 'merger',
        url: 'https://github.com/acme/app/pull/42',
        reviews: [
          { databaseId: 101, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:01.000Z', body: '请修 X', author: 'bob' },
          { databaseId: 102, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:02.000Z', body: '再修 Y', author: 'bob' },
        ],
      },
    ])
    const client = createGithubPrHttpClient({ token: 't', prs: [PR], fetch })
    const first = await client.listItems(null, 50)
    expect(first.items).toEqual([
      {
        kind: 'review',
        id: '101',
        pr: PR,
        actor: 'bob',
        state: 'changes_requested',
        body: '请修 X',
        submittedAt: '2026-01-01T00:00:01.000Z',
        url: null,
        actorRound: 1,
      },
      {
        kind: 'review',
        id: '102',
        pr: PR,
        actor: 'bob',
        state: 'changes_requested',
        body: '再修 Y',
        submittedAt: '2026-01-01T00:00:02.000Z',
        url: null,
        actorRound: 2,
      },
      {
        kind: 'comment',
        id: '201',
        pr: PR,
        actor: 'bob',
        body: '这里命名不对',
        inReplyTo: null,
        createdAt: '2026-01-01T00:00:03.000Z',
        url: null,
        resolved: true,
      },
      {
        kind: 'comment',
        id: '301',
        pr: PR,
        actor: 'carol',
        body: '会话评论',
        inReplyTo: null,
        createdAt: '2026-01-01T00:00:04.000Z',
        url: null,
        resolved: false,
      },
    ])
    expect(first.prDone).toEqual([])
    expect(first.gap).toBe(false)
    expect(first.hasMore).toBe(false)
    expect(first.nextCursor).not.toBeNull()

    const second = await client.listItems(first.nextCursor, 50)
    // 复合游标（时间 + 事件 ID）精确续读：不重复取回已含条目。
    expect(second.items).toEqual([])
    expect(second.prDone).toEqual([
      { pr: PR, outcome: 'merged', actor: 'merger', at: '2026-01-02T00:00:00.000Z', url: 'https://github.com/acme/app/pull/42' },
    ])

    const third = await client.listItems(second.nextCursor, 50)
    // PR 终止只报一次。
    expect(third.prDone).toEqual([])
  })

  it('paginates by the watermark cursor with hasMore', async () => {
    const { fetch } = makeFetch([
      {
        reviews: [
          { databaseId: 101, state: 'APPROVED', submittedAt: '2026-01-01T00:00:01.000Z', body: null, author: 'bob' },
          { databaseId: 102, state: 'APPROVED', submittedAt: '2026-01-01T00:00:02.000Z', body: null, author: 'carol' },
        ],
      },
    ])
    const client = createGithubPrHttpClient({ token: 't', prs: [PR], fetch })
    const first = await client.listItems(null, 1)
    expect(first.items.map((item) => item.id)).toEqual(['101'])
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).not.toBeNull()
    const second = await client.listItems(first.nextCursor, 1)
    expect(second.items.map((item) => item.id)).toEqual(['102'])
    expect(second.hasMore).toBe(false)
  })

  it('sends the token as authorization against the github api', async () => {
    const { fetch, calls } = makeFetch([{ reviews: [] }])
    const client = createGithubPrHttpClient({ token: 't', prs: [PR], fetch })
    await client.listItems(null, 50)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.github.com/graphql')
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get('authorization')).toBe('Bearer t')
  })

  it('throws on http errors and graphql-level errors', async () => {
    const httpError = ((): Promise<unknown> =>
      Promise.resolve({ ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) })) as unknown as typeof fetch
    const client = createGithubPrHttpClient({ token: 'bad', prs: [PR], fetch: httpError })
    await expect(client.listItems(null, 50)).rejects.toThrow('github api 401')

    const graphQlError = ((): Promise<unknown> =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ errors: [{ message: ' Bad or missing GraphQL query ' }] }) })) as unknown as typeof fetch
    const client2 = createGithubPrHttpClient({ token: 't', prs: [PR], fetch: graphQlError })
    await expect(client2.listItems(null, 50)).rejects.toThrow('Bad or missing GraphQL query')
  })
})
