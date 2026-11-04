/**
 * GitHub PR Source（T19 #89，PRD 用户故事 32「PR 评审闭环」）。
 *
 * PR 审批与评论成为 Trigger 唤醒对应工单（设计 §6.4 / Phase 2 增量）：
 *  - 审批（approved / changes_requested）与评审、会话评论 → 人消息事件，
 *    经 Ingestor fan-out 唤醒订阅该 PR Thread 的开放工单；
 *  - 已解决（resolved）线程里的评论静默：human=false 只作上下文，不重复
 *    唤醒（修好的评论不再打扰 Worker）；
 *  - 自动评审器（团队配置的 automationAccounts，身份只在本 Source 内
 *    有效，不做跨 Source 映射）每 PR 最多唤醒三轮：第 4 轮起 human=false
 *    只作上下文；其单独评论一律只作上下文；
 *  - 外部自动化账号不产生额外授权：事件永不 addressed，审批/评论只能唤醒
 *    既有工单，经 Gate 最多 inferred（团队还可用 Policy bots 名单封顶）；
 *  - PR 合并/关闭 → threadDone 终止信号，由 Ingestor 调 domain.followsDone
 *    按 merged/closed 结束工单（不压成 completed，follows 保留审计）。
 *
 * 生产环境用 createGithubPrHttpClient：GraphQL 单查询取 reviews /
 * reviewThreads（含 isResolved）/ 会话评论与 PR 状态；REST 无线程解决状态，
 * 故走 GraphQL。游标为复合水位（时间 + 事件 ID），精确续读不重取不漏取。
 */
import type { ExternalSource, SourceEvent, SourcePollPage, SourceThreadDone } from './types'
import { isNonEmptyString } from './types'

export const GITHUB_PR_SOURCE_ID = 'github-pr'

/** 自动评审器每 PR 最多唤醒轮数（缺省三轮）。 */
export const DEFAULT_MAX_AUTOMATION_ROUNDS = 3

/** PR 标识形如 `owner/repo#42`。 */
export const PR_PATTERN = /^[\w.-]+\/[\w.-]+#\d+$/

/** Thread / channel：`github:pr:{owner}/{repo}:{number}`。 */
export function githubPrThreadId(pr: string): string {
  return `github:pr:${pr.replace('#', ':')}`
}

export type GithubPrReviewState = 'approved' | 'changes_requested' | 'commented'

/** PR 评审（一轮提交 = 一条 item；actorRound 为该作者在此 PR 的第几轮）。 */
export interface GithubPrReviewItem {
  kind: 'review'
  id: string
  pr: string
  actor: string
  state: GithubPrReviewState
  body: string | null
  submittedAt: string
  url: string | null
  /** 该 actor 在此 PR 的评审轮次（1 起，全量历史序）。 */
  actorRound: number
}

/** PR 评论（评审线程内的行内评论与会话评论；线程已解决则静默）。 */
export interface GithubPrCommentItem {
  kind: 'comment'
  id: string
  pr: string
  actor: string
  body: string | null
  /** 评审线程内回复的首条评论 ID；会话评论为 null。 */
  inReplyTo: string | null
  createdAt: string
  url: string | null
  /** 所在线程是否已解决（resolved → 静默，不重复唤醒）。 */
  resolved: boolean
}

export type GithubPrItem = GithubPrReviewItem | GithubPrCommentItem

/** PR 终止：合并 → merged；关闭未合并 → closed。 */
export interface GithubPrDone {
  pr: string
  outcome: 'merged' | 'closed'
  actor: string | null
  at: string
  url: string | null
}

/** 一页读取结果；游标语义由 client 自解释（生产实现见 createGithubPrHttpClient）。 */
export interface GithubPrPage {
  items: GithubPrItem[]
  prDone: GithubPrDone[]
  nextCursor: string | null
  hasMore: boolean
  gap: boolean
}

/** 可注入的 GitHub client；测试用假实现，不发真实请求。 */
export interface GithubPrClient {
  listItems(cursor: string | null, limit: number): Promise<GithubPrPage>
}

export interface GithubPrEventOptions {
  /** 团队配置的自动化账号（如 copilot-pull-request-reviewer[bot]）；只在本 Source 内有效。 */
  automationAccounts?: string[]
  /** 自动评审器每 PR 最多唤醒轮数；缺省三轮。 */
  maxAutomationRounds?: number
}

export type GithubPrMapResult =
  | { kind: 'event'; event: SourceEvent }
  | { kind: 'dropped' }
  | { kind: 'bad' }

function itemAt(item: GithubPrItem): string {
  return item.kind === 'review' ? item.submittedAt : item.createdAt
}

function validBase(item: GithubPrItem): boolean {
  if (!isNonEmptyString(item.id)) return false
  if (typeof item.pr !== 'string' || !PR_PATTERN.test(item.pr)) return false
  if (!isNonEmptyString(item.actor)) return false
  return typeof itemAt(item) === 'string' && !Number.isNaN(Date.parse(itemAt(item)))
}

/**
 * 单条 item → SourceEvent 映射（纯函数）：
 *  - 人评审/评论 → human=true 唤醒；resolved 或自动化账号的评论 → human=false
 *    只作上下文；自动化评审第 4 轮起 → human=false；
 *  - 空的 commented 评审（无正文、行内评论单独成条）无唤醒价值 → dropped；
 *  - 结构坏条目原样透传（passthrough），由 Ingestor 统一校验并隔离报告。
 */
export function githubPrItemToEvent(
  item: GithubPrItem,
  options: GithubPrEventOptions = {},
): GithubPrMapResult {
  if (item.kind !== 'review' && item.kind !== 'comment') return { kind: 'bad' }
  if (!validBase(item)) return { kind: 'bad' }
  const automationAccounts = options.automationAccounts ?? []
  const maxAutomationRounds = options.maxAutomationRounds ?? DEFAULT_MAX_AUTOMATION_ROUNDS
  const automation = automationAccounts.includes(item.actor)
  const at = itemAt(item)
  const body = typeof item.body === 'string' ? item.body.trim() : ''
  const threadId = githubPrThreadId(item.pr)

  if (item.kind === 'review') {
    if (
      item.state !== 'approved' &&
      item.state !== 'changes_requested' &&
      item.state !== 'commented'
    ) {
      return { kind: 'bad' }
    }
    if (!Number.isInteger(item.actorRound) || item.actorRound < 1) return { kind: 'bad' }
    // 空 commented 评审：行内评论单独成条，评审本身无唤醒价值。
    if (item.state === 'commented' && body === '') return { kind: 'dropped' }
    // 自动评审器每 PR 最多唤醒三轮；超出后只作上下文（有记录、不重复唤醒）。
    const overRound = automation && item.actorRound > maxAutomationRounds
    const event: SourceEvent = {
      key: `github-pr:review:${item.pr}:${item.id}`,
      source: GITHUB_PR_SOURCE_ID,
      threadIds: [threadId],
      actor: `github:user:${item.actor}`,
      human: !overRound,
      addressed: null,
      channel: threadId,
      url: item.url ?? null,
      text: body !== '' ? body : `[pr-review:${item.state}]`,
      at,
      meta: { pr: item.pr, reviewState: item.state, actorRound: item.actorRound, automation },
    }
    return { kind: 'event', event }
  }

  if (typeof item.resolved !== 'boolean') return { kind: 'bad' }
  // 已解决线程静默；自动化账号的评论一律只作上下文。
  const silent = item.resolved || automation
  const event: SourceEvent = {
    key: `github-pr:comment:${item.pr}:${item.id}`,
    source: GITHUB_PR_SOURCE_ID,
    threadIds: [threadId],
    actor: `github:user:${item.actor}`,
    human: !silent,
    addressed: null,
    channel: threadId,
    url: item.url ?? null,
    text: body,
    at,
    meta: {
      pr: item.pr,
      resolved: item.resolved,
      automation,
      ...(item.inReplyTo !== null ? { inReplyTo: item.inReplyTo } : {}),
    },
  }
  return { kind: 'event', event }
}

/** GitHub PR Source：client 页 → SourcePollPage（映射 + threadDone 透传）。 */
export class GithubPrSource implements ExternalSource {
  readonly id = GITHUB_PR_SOURCE_ID

  constructor(
    private readonly client: GithubPrClient,
    private readonly options: GithubPrEventOptions = {},
  ) {}

  async poll(cursor: string | null, limit: number): Promise<SourcePollPage> {
    const page = await this.client.listItems(cursor, limit)
    if (page.gap) {
      // 断档：事件与终止信号一并丢弃，由 Ingestor 从头全量重拉补偿。
      return { events: [], nextCursor: page.nextCursor, hasMore: page.hasMore, gap: true }
    }
    const events: unknown[] = []
    for (const item of page.items) {
      const mapped = githubPrItemToEvent(item, this.options)
      if (mapped.kind === 'dropped') continue
      events.push(mapped.kind === 'event' ? mapped.event : item)
    }
    const threadDone: SourceThreadDone[] = page.prDone.map((done) => ({
      threadId: githubPrThreadId(done.pr),
      outcome: done.outcome,
      at: done.at,
      reason: `${done.outcome === 'merged' ? 'pr-merged' : 'pr-closed'}:${done.actor ?? 'unknown'}`,
      url: done.url,
    }))
    return {
      events,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      gap: false,
      threadDone,
    }
  }
}

// ── 生产 GraphQL client ─────────────────────────────────────────────────

interface GithubPrCursorEntry {
  /** 复合水位：已含最后一条的时间。 */
  watermark: string | null
  /** 同时间并列时的事件 ID 兜底（数字事件 ID 升序）。 */
  lastId: string | null
  /** 已报告过的 PR 终止结果。 */
  done: 'merged' | 'closed' | null
}

interface GithubPrCursor {
  v: 1
  prs: Record<string, GithubPrCursorEntry>
}

const GRAPHQL_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      state url mergedAt mergedBy{login} closedAt
      reviews(last:100){nodes{databaseId state submittedAt body url author{login}}}
      reviewThreads(last:100){nodes{isResolved comments(last:100){nodes{databaseId body createdAt url author{login}}}}}
      comments(last:100){nodes{databaseId body createdAt url author{login}}}
    }
  }
}`

export interface GithubPrHttpClientOptions {
  token: string
  /** 监听的 PR 列表（`owner/repo#number`）。 */
  prs: string[]
  apiBase?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

const REVIEW_STATE_MAP: Record<string, GithubPrReviewState> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
}

interface GraphQlPullRequest {
  state?: string
  url?: string | null
  mergedAt?: string | null
  mergedBy?: { login?: string | null } | null
  closedAt?: string | null
  reviews?: {
    nodes?: Array<{
      databaseId?: number
      state?: string
      submittedAt?: string
      body?: string | null
      url?: string | null
      author?: { login?: string | null } | null
    }>
  }
  reviewThreads?: {
    nodes?: Array<{
      isResolved?: boolean
      comments?: {
        nodes?: Array<{
          databaseId?: number
          body?: string | null
          createdAt?: string
          url?: string | null
          author?: { login?: string | null } | null
        }>
      }
    }>
  }
  comments?: {
    nodes?: Array<{
      databaseId?: number
      body?: string | null
      createdAt?: string
      url?: string | null
      author?: { login?: string | null } | null
    }>
  }
}

interface GraphQlResponse {
  data?: {
    repository?: {
      pullRequest?: GraphQlPullRequest
    }
  }
  errors?: Array<{ message?: string }>
}

function parseCursor(cursor: string | null): GithubPrCursor {
  if (cursor === null) return { v: 1, prs: {} }
  try {
    const parsed = JSON.parse(cursor) as GithubPrCursor
    if (parsed?.v === 1 && parsed.prs && typeof parsed.prs === 'object') return parsed
  } catch {
    // 游标损坏（版本不符 / 截断）：从头全量重拉，事件键幂等兜底。
  }
  return { v: 1, prs: {} }
}

/** (时间, 事件 ID) 复合序：精确续读，既不重取也不漏取同时间并列条目。 */
function afterCursor(
  item: GithubPrItem,
  entry: GithubPrCursorEntry,
): boolean {
  const at = itemAt(item)
  if (entry.watermark === null) return true
  if (at > entry.watermark) return true
  if (at < entry.watermark || entry.lastId === null) return false
  return Number(item.id) > Number(entry.lastId)
}

/**
 * 生产 client：每 PR 一次 GraphQL 查询（reviews / reviewThreads 含
 * isResolved / 会话评论 / PR 状态），按复合水位过滤后升序成页。
 * PR 终止（merged/closed）只在状态首次出现或变化时上报一次。
 */
export function createGithubPrHttpClient(options: GithubPrHttpClientOptions): GithubPrClient {
  const token = options.token
  const prs = [...options.prs]
  const apiBase = options.apiBase ?? 'https://api.github.com'
  const fetchFn = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000

  async function fetchPr(pr: string): Promise<GraphQlPullRequest> {
    const match = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(pr)
    if (!match) throw new Error(`invalid github pr: ${pr}`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchFn(`${apiBase}/graphql`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: GRAPHQL_QUERY,
          variables: { owner: match[1], name: match[2], number: Number(match[3]) },
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`github api ${response.status}`)
      const body = (await response.json()) as GraphQlResponse
      if (body.errors && body.errors.length > 0) {
        throw new Error(body.errors[0]?.message ?? 'github graphql error')
      }
      const pullRequest = body.data?.repository?.pullRequest
      if (!pullRequest) throw new Error(`github pull request not found: ${pr}`)
      return pullRequest
    } finally {
      clearTimeout(timer)
    }
  }

  function collectItems(pr: string, pull: GraphQlPullRequest): GithubPrItem[] {
    const items: GithubPrItem[] = []
    const rounds = new Map<string, number>()
    for (const node of pull.reviews?.nodes ?? []) {
      const actor = node.author?.login ?? null
      const state = node.state !== undefined ? REVIEW_STATE_MAP[node.state] : undefined
      if (!actor || !state || node.databaseId === undefined || !node.submittedAt) continue
      const actorRound = (rounds.get(actor) ?? 0) + 1
      rounds.set(actor, actorRound)
      items.push({
        kind: 'review',
        id: String(node.databaseId),
        pr,
        actor,
        state,
        body: node.body ?? null,
        submittedAt: node.submittedAt,
        url: node.url ?? null,
        actorRound,
      })
    }
    for (const thread of pull.reviewThreads?.nodes ?? []) {
      const nodes = thread.comments?.nodes ?? []
      const firstId = nodes.find((node) => node.databaseId !== undefined)?.databaseId ?? null
      for (const node of nodes) {
        const actor = node.author?.login ?? null
        if (!actor || node.databaseId === undefined || !node.createdAt) continue
        items.push({
          kind: 'comment',
          id: String(node.databaseId),
          pr,
          actor,
          body: node.body ?? null,
          inReplyTo: firstId !== null && node.databaseId !== firstId ? String(firstId) : null,
          createdAt: node.createdAt,
          url: node.url ?? null,
          resolved: thread.isResolved === true,
        })
      }
    }
    for (const node of pull.comments?.nodes ?? []) {
      const actor = node.author?.login ?? null
      if (!actor || node.databaseId === undefined || !node.createdAt) continue
      items.push({
        kind: 'comment',
        id: String(node.databaseId),
        pr,
        actor,
        body: node.body ?? null,
        inReplyTo: null,
        createdAt: node.createdAt,
        url: node.url ?? null,
        resolved: false,
      })
    }
    return items
  }

  return {
    async listItems(cursor: string | null, limit: number): Promise<GithubPrPage> {
      const state = parseCursor(cursor)
      const nextEntries: Record<string, GithubPrCursorEntry> = { ...state.prs }
      const prDone: GithubPrDone[] = []
      const fresh: Array<{ item: GithubPrItem; at: string }> = []

      for (const pr of prs) {
        const entry: GithubPrCursorEntry =
          state.prs[pr] ?? { watermark: null, lastId: null, done: null }
        const pull = await fetchPr(pr)
        const doneOutcome = pull.state === 'MERGED' ? 'merged' : pull.state === 'CLOSED' ? 'closed' : null
        if (doneOutcome !== null && entry.done !== doneOutcome) {
          nextEntries[pr] = { ...entry, done: doneOutcome }
          prDone.push({
            pr,
            outcome: doneOutcome,
            actor: pull.mergedBy?.login ?? null,
            at: pull.mergedAt ?? pull.closedAt ?? new Date().toISOString(),
            url: pull.url ?? null,
          })
        }
        for (const item of collectItems(pr, pull).filter((candidate) => afterCursor(candidate, entry))) {
          fresh.push({ item, at: itemAt(item) })
        }
      }

      fresh.sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : Number(a.item.id) - Number(b.item.id)))
      const included = fresh.slice(0, limit)
      // 只有本页真正返回的条目推进水位 —— 被页大小截断的留在下一页续读。
      const lastIncludedByPr = new Map<string, GithubPrItem>()
      for (const { item } of included) lastIncludedByPr.set(item.pr, item)
      for (const [pr, item] of lastIncludedByPr) {
        nextEntries[pr] = {
          ...nextEntries[pr],
          watermark: itemAt(item),
          lastId: item.id,
        }
      }
      return {
        items: included.map((entry) => entry.item),
        prDone,
        nextCursor: JSON.stringify({ v: 1, prs: nextEntries } satisfies GithubPrCursor),
        hasMore: fresh.length > limit,
        gap: false,
      }
    },
  }
}
