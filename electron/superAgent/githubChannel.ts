/**
 * #103：GitHub Outbox 通道。
 *
 * 复用既有 `gh auth token` 登录态与 REST API，不新增凭据文件。
 *
 * 地址格式：`github:pr:<owner>/<repo>:<number>[:reply:<commentId>]`。
 *  - result 回到 PR 会话评论；
 *  - ack/answer/attention 在评审线程内回复（目标评论已删除时降级到会话评论）；
 *  - 评论正文带 `<!-- spacecode-superagent:<messageId> -->` 稳定 marker：
 *    重投时先按 marker 对账，命中即返回原 comment id，绝不重复评论。
 */
import { loadGithubCliToken } from './sources/assembly'
import type { SuperAgentOutboxChannel, SuperAgentOutboxSendOutcome } from './outbox'

export const GITHUB_OUTBOX_CHANNEL_PREFIX = 'github:'

export interface GithubOutboxAddress {
  repo: string
  number: number
  /** `null` 表示发到 PR 会话评论；否则为要回复的 review comment id。 */
  replyToCommentId: string | null
}

const GITHUB_PR_CHANNEL_PATTERN = /^github:pr:([\w.-]+\/[\w.-]+):(\d+)(?::reply:([^:]+))?$/

export function parseGithubOutboxChannel(channel: string): GithubOutboxAddress | null {
  const match = GITHUB_PR_CHANNEL_PATTERN.exec(channel)
  if (!match?.[1] || !match[2]) return null
  return {
    repo: match[1],
    number: Number(match[2]),
    replyToCommentId: match[3] ?? null,
  }
}

export function githubPrOutboxChannel(
  repo: string,
  number: number,
  replyToCommentId: string | null = null,
): string {
  return replyToCommentId
    ? `github:pr:${repo}:${number}:reply:${replyToCommentId}`
    : `github:pr:${repo}:${number}`
}

export interface GithubOutboxComment {
  id: string
  body: string
  inReplyToId: string | null
  /** true = review comment（pulls/comments）；false = PR 会话评论（issues/comments）。 */
  review: boolean
}

export interface GithubOutboxCreateInput {
  repo: string
  number: number
  body: string
  replyToCommentId: string | null
}

export interface GithubOutboxTransport {
  listComments(input: { repo: string; number: number }): Promise<GithubOutboxComment[]>
  getReviewComment(input: { repo: string; commentId: string }): Promise<GithubOutboxComment | null>
  createComment(input: GithubOutboxCreateInput): Promise<{ commentId: string }>
}

export class GithubApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message)
    this.name = 'GithubApiError'
  }
}

export interface SuperAgentGithubOutboxChannelOptions {
  transport: GithubOutboxTransport
  /** messageId → comment id；同进程重复投递短路。 */
  receipts?: Map<string, string>
}

function markerOf(messageId: string): string {
  return `<!-- spacecode-superagent:${messageId} -->`
}

function errorTextOf(error: unknown): string {
  if (error instanceof GithubApiError) return error.body || error.message
  if (error instanceof Error) return error.message
  return 'githubChannelError'
}

/** 仓库删除（410）与锁定（403 locked）是永久失败；404 可能是临时权限，仍重试。 */
export function isGithubGoneError(error: unknown): boolean {
  return error instanceof GithubApiError &&
    (error.status === 410 || (error.status === 403 && /locked/i.test(error.body)))
}

export function createSuperAgentGithubOutboxChannel(
  options: SuperAgentGithubOutboxChannelOptions,
): SuperAgentOutboxChannel {
  const receipts = options.receipts ?? new Map<string, string>()
  return async (message): Promise<SuperAgentOutboxSendOutcome> => {
    if (message.payload.kind !== 'reply') return gone('githubChannelReplyOnly')
    const address = parseGithubOutboxChannel(message.channel)
    if (!address) return gone('githubChannelInvalidAddress')

    const delivered = receipts.get(message.messageId)
    if (delivered !== undefined) return { outcome: 'sent', receipt: delivered }

    const marker = markerOf(message.messageId)
    const body = `${message.payload.text}\n\n${marker}`
    const wantsThread = message.payload.replyType !== 'result' && address.replyToCommentId !== null

    try {
      const comments = await options.transport.listComments(address)
      const existing = comments.find(
        (comment) => comment.body.includes(marker) && (wantsThread ? comment.review : !comment.review),
      )
      if (existing) {
        receipts.set(message.messageId, existing.id)
        return { outcome: 'sent', receipt: existing.id }
      }

      let replyTo = wantsThread ? address.replyToCommentId : null
      if (replyTo) {
        const root = await options.transport.getReviewComment({ repo: address.repo, commentId: replyTo })
        if (!root) replyTo = null
      }

      const created = await postComment(options.transport, address, body, replyTo)
      receipts.set(message.messageId, created.commentId)
      return { outcome: 'sent', receipt: created.commentId }
    } catch (error) {
      return isGithubGoneError(error)
        ? gone(errorTextOf(error))
        : { outcome: 'waiting', error: errorTextOf(error) }
    }
  }
}

/** 评论目标在发布瞬间被删除时降级到会话评论；其他错误照常上抛。 */
async function postComment(
  transport: GithubOutboxTransport,
  address: GithubOutboxAddress,
  body: string,
  replyToCommentId: string | null,
): Promise<{ commentId: string }> {
  if (!replyToCommentId) {
    return transport.createComment({ ...address, body, replyToCommentId: null })
  }
  try {
    return await transport.createComment({ ...address, body, replyToCommentId })
  } catch (error) {
    if (error instanceof GithubApiError && (error.status === 404 || error.status === 410)) {
      return transport.createComment({ ...address, body, replyToCommentId: null })
    }
    throw error
  }
}

function gone(error: string): SuperAgentOutboxSendOutcome {
  return { outcome: 'gone', error }
}

export interface GithubApiOutboxTransportOptions {
  /** 缺省复用 gh CLI 登录态；空 token 会让请求进入 waiting 退避。 */
  loadToken?: () => string | null
  fetch?: typeof fetch
  apiBase?: string
  timeoutMs?: number
}

interface GithubCommentPayload {
  id: number
  body?: string | null
  in_reply_to_id?: number | null
}

/** REST 传输：评论分页对账 + 会话评论 / review 线程回复。 */
export function createGithubApiOutboxTransport(
  options: GithubApiOutboxTransportOptions = {},
): GithubOutboxTransport {
  const apiBase = options.apiBase ?? 'https://api.github.com'
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = (options.loadToken ?? loadGithubCliToken)()
    if (!token) throw new GithubApiError('githubCredentialsMissing', 401, 'githubCredentialsMissing')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await doFetch(`${apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await res.text()
      if (!res.ok) {
        throw new GithubApiError(`GitHub API ${method} ${path} failed: HTTP ${res.status}`, res.status, text)
      }
      return (text === '' ? undefined : JSON.parse(text)) as T
    } finally {
      clearTimeout(timer)
    }
  }

  async function listAll<T>(path: string): Promise<T[]> {
    const items: T[] = []
    for (let page = 1; page <= 10; page += 1) {
      const batch = await request<T[]>(
        'GET',
        `${path}?per_page=100&page=${page}`,
      )
      items.push(...batch)
      if (batch.length < 100) break
    }
    return items
  }

  return {
    async listComments({ repo, number }) {
      const [issueComments, reviewComments] = await Promise.all([
        listAll<GithubCommentPayload>(`/repos/${repo}/issues/${number}/comments`),
        listAll<GithubCommentPayload>(`/repos/${repo}/pulls/${number}/comments`),
      ])
      return [
        ...issueComments.map((comment) => ({
          id: String(comment.id),
          body: comment.body ?? '',
          inReplyToId: null,
          review: false,
        })),
        ...reviewComments.map((comment) => ({
          id: String(comment.id),
          body: comment.body ?? '',
          inReplyToId: comment.in_reply_to_id === null || comment.in_reply_to_id === undefined
            ? null
            : String(comment.in_reply_to_id),
          review: true,
        })),
      ]
    },
    async getReviewComment({ repo, commentId }) {
      try {
        const comment = await request<GithubCommentPayload>(
          'GET',
          `/repos/${repo}/pulls/comments/${commentId}`,
        )
        return {
          id: String(comment.id),
          body: comment.body ?? '',
          inReplyToId: comment.in_reply_to_id === null || comment.in_reply_to_id === undefined
            ? null
            : String(comment.in_reply_to_id),
          review: true,
        }
      } catch (error) {
        if (error instanceof GithubApiError && error.status === 404) return null
        throw error
      }
    },
    async createComment({ repo, number, body, replyToCommentId }) {
      const path = replyToCommentId
        ? `/repos/${repo}/pulls/${number}/comments/${replyToCommentId}/replies`
        : `/repos/${repo}/issues/${number}/comments`
      const created = await request<GithubCommentPayload>('POST', path, { body })
      if (created?.id === undefined) {
        throw new GithubApiError('githubChannelMissingReceipt', 502, 'githubChannelMissingReceipt')
      }
      return { commentId: String(created.id) }
    },
  }
}
