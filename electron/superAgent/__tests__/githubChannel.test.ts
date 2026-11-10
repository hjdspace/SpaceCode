// @vitest-environment node
/**
 * #103：GitHub Outbox 通道适配器契约。
 *
 *  - result 回到 PR 会话评论；评审线程回复在目标评论存在时用线程回复；
 *  - 目标评论被删除 → 降级到会话评论（不丢消息）；
 *  - 评论正文带稳定 marker，重投按 marker 对账，不重复评论；
 *  - 仓库被删除/锁定 → gone；凭据/网络失败 → waiting。
 */
import { describe, expect, it } from 'vitest'
import { GithubApiError } from '../githubChannel'
import {
  createSuperAgentGithubOutboxChannel,
  githubPrOutboxChannel,
  parseGithubOutboxChannel,
  type GithubOutboxComment,
  type GithubOutboxCreateInput,
  type GithubOutboxTransport,
} from '../githubChannel'
import type { SuperAgentOutboxMessage } from '../model'

function replyMessage(
  replyType: 'acknowledgement' | 'answer' | 'result' | 'attention',
  overrides: Partial<SuperAgentOutboxMessage> = {},
): SuperAgentOutboxMessage {
  return {
    messageId: `reply:${replyType}:ref-1`,
    ticketId: 'ticket-1',
    channel: 'github:pr:acme/app:42',
    kind: 'reply',
    ordinal: 1,
    status: 'pending',
    createdAt: '2026-11-06T00:00:00.000Z',
    payload: {
      kind: 'reply',
      replyType,
      text: '处理结果',
      inReplyTo: replyType === 'result' ? null : 'input-1',
      attentionId: null,
      reportId: replyType === 'result' ? 'report-1' : null,
    },
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    sentAt: null,
    receipt: null,
    withdrawnAt: null,
    ...overrides,
  }
}

interface FakeTransport extends GithubOutboxTransport {
  listed: Array<{ repo: string; number: number }>
  created: GithubOutboxCreateInput[]
  lookedUp: string[]
  comments: GithubOutboxComment[]
  reviewComment: GithubOutboxComment | null
  createError: Error | null
}

function fakeTransport(): FakeTransport {
  const fake: FakeTransport = {
    listed: [],
    created: [],
    lookedUp: [],
    comments: [],
    reviewComment: null,
    createError: null,
    async listComments(input) {
      fake.listed.push(input)
      return [...fake.comments]
    },
    async getReviewComment(input) {
      fake.lookedUp.push(input.commentId)
      return fake.reviewComment
    },
    async createComment(input) {
      if (fake.createError) throw fake.createError
      fake.created.push(input)
      return { commentId: '9001' }
    },
  }
  return fake
}

describe('github outbox channel address', () => {
  it('parses PR conversation and review reply addresses', () => {
    expect(parseGithubOutboxChannel('github:pr:acme/app:42')).toEqual({
      repo: 'acme/app',
      number: 42,
      replyToCommentId: null,
    })
    expect(parseGithubOutboxChannel('github:pr:acme/app:42:reply:17')).toEqual({
      repo: 'acme/app',
      number: 42,
      replyToCommentId: '17',
    })
  })

  it('composes the channel address used by reply target resolution', () => {
    expect(githubPrOutboxChannel('acme/app', 42)).toBe('github:pr:acme/app:42')
    expect(githubPrOutboxChannel('acme/app', 42, '17')).toBe('github:pr:acme/app:42:reply:17')
  })

  it('rejects malformed channels', () => {
    expect(parseGithubOutboxChannel('desktop')).toBeNull()
    expect(parseGithubOutboxChannel('github:pr:acme/app')).toBeNull()
  })
})

describe('github outbox channel delivery', () => {
  it('posts a result as a PR conversation comment with an idempotency marker', async () => {
    const transport = fakeTransport()
    const channel = createSuperAgentGithubOutboxChannel({ transport })

    const outcome = await channel(replyMessage('result'))

    expect(outcome).toEqual({ outcome: 'sent', receipt: '9001' })
    expect(transport.lookedUp).toEqual([])
    expect(transport.created).toHaveLength(1)
    expect(transport.created[0]).toMatchObject({
      repo: 'acme/app',
      number: 42,
      replyToCommentId: null,
    })
    expect(transport.created[0]!.body).toContain('<!-- spacecode-superagent:reply:result:ref-1 -->')
  })

  it('replies inside the review thread when the root comment exists', async () => {
    const transport = fakeTransport()
    transport.reviewComment = { id: '17', body: '', inReplyToId: null, review: true }
    const channel = createSuperAgentGithubOutboxChannel({ transport })

    const outcome = await channel(
      replyMessage('answer', { channel: 'github:pr:acme/app:42:reply:17' }),
    )

    expect(outcome).toEqual({ outcome: 'sent', receipt: '9001' })
    expect(transport.lookedUp).toEqual(['17'])
    expect(transport.created[0]).toMatchObject({ replyToCommentId: '17' })
  })

  it('falls back to a conversation comment when the review comment is gone', async () => {
    const transport = fakeTransport()
    transport.reviewComment = null
    const channel = createSuperAgentGithubOutboxChannel({ transport })

    const outcome = await channel(
      replyMessage('acknowledgement', { channel: 'github:pr:acme/app:42:reply:17' }),
    )

    expect(outcome).toEqual({ outcome: 'sent', receipt: '9001' })
    expect(transport.created[0]).toMatchObject({ replyToCommentId: null })
  })

  it('does not duplicate a comment when the marker is already present', async () => {
    const transport = fakeTransport()
    transport.comments = [
      {
        id: '9001',
        body: '处理结果\n\n<!-- spacecode-superagent:reply:result:ref-1 -->',
        inReplyToId: null,
        review: false,
      },
    ]
    const channel = createSuperAgentGithubOutboxChannel({ transport })
    const message = replyMessage('result')

    const first = await channel(message)
    const second = await channel(message)

    expect(first).toEqual({ outcome: 'sent', receipt: '9001' })
    expect(second).toEqual(first)
    expect(transport.created).toHaveLength(0)
  })

  it('treats deleted or locked repositories as gone', async () => {
    const transport = fakeTransport()
    transport.createError = new GithubApiError('gone', 410, 'repository deleted')
    const channel = createSuperAgentGithubOutboxChannel({ transport })

    const outcome = await channel(replyMessage('result'))

    expect(outcome).toEqual({ outcome: 'gone', error: 'repository deleted' })
  })

  it('treats credentials and server failures as waiting', async () => {
    const transport = fakeTransport()
    transport.createError = new GithubApiError('bad credentials', 401, 'Bad credentials')
    const channel = createSuperAgentGithubOutboxChannel({ transport })

    const outcome = await channel(replyMessage('result'))

    expect(outcome).toEqual({ outcome: 'waiting', error: 'Bad credentials' })
  })

  it('refuses non-reply payloads', async () => {
    const transport = fakeTransport()
    const channel = createSuperAgentGithubOutboxChannel({ transport })
    const message = replyMessage('result', {
      messageId: 'launch:assignment-1',
      kind: 'launch',
      channel: 'github:pr:acme/app:42',
      payload: { kind: 'launch', assignmentId: 'assignment-1' },
    })

    const outcome = await channel(message)

    expect(outcome).toEqual({ outcome: 'gone', error: 'githubChannelReplyOnly' })
    expect(transport.created).toHaveLength(0)
  })
})
