// @vitest-environment node
/**
 * 审查结论的纯函数：合并资格只读投影，意见的接受/忽略与未决判定共用一份口径。
 * 「未决」包含待处理与已加入修复清单两种状态；忽略与已解决都不再拦合并。
 */
import { describe, it, expect } from 'vitest'
import { mergeEligibility, pendingComments, updateReviewComment } from '../factoryReview'
import type { FactoryReview, FactoryReviewComment } from '../factory'

const AT = '2026-10-30T00:00:00.000Z'
const PASS = { status: 'pass' as const, command: 'npm test', at: AT }

function review(
  verdict: FactoryReview['verdict'],
  comments: FactoryReviewComment[] = [],
): FactoryReview {
  return { verdict, summary: '', comments, at: AT }
}

function comment(
  id: string,
  status: FactoryReviewComment['status'],
  severity: FactoryReviewComment['severity'] = 'blocker',
): FactoryReviewComment {
  return { id, body: id, severity, status }
}

describe('mergeEligibility', () => {
  it('allows merge when tests pass, the review approved and nothing is pending', () => {
    expect(mergeEligibility({ tests: PASS, review: review('approved') })).toEqual({ ok: true })
  })

  it('lists every unmet precondition so the UI can explain the gate', () => {
    expect(mergeEligibility({})).toEqual({
      ok: false,
      reasons: ['tests-missing', 'review-missing'],
    })
    expect(
      mergeEligibility({
        tests: { ...PASS, status: 'fail' },
        review: review('needs_changes'),
      }),
    ).toEqual({ ok: false, reasons: ['tests-failed', 'review-needs-changes'] })
  })

  it('blocks on a blocker comment that is still open', () => {
    expect(mergeEligibility({ tests: PASS, review: review('approved', [comment('c1', 'open')]) })).toEqual({
      ok: false,
      reasons: ['open-blockers'],
    })
  })

  it('blocks on an accepted blocker until a later review resolves it', () => {
    expect(mergeEligibility({ tests: PASS, review: review('approved', [comment('c1', 'accepted')]) })).toEqual({
      ok: false,
      reasons: ['open-blockers'],
    })
  })

  it('does not block on suggestions or settled comments', () => {
    const settled = [
      comment('c1', 'open', 'suggestion'),
      comment('c2', 'ignored'),
      comment('c3', 'resolved'),
    ]
    expect(mergeEligibility({ tests: PASS, review: review('approved', settled) })).toEqual({ ok: true })
  })
})

describe('pendingComments', () => {
  it('counts open and accepted comments only', () => {
    const all = [
      comment('open', 'open'),
      comment('accepted', 'accepted'),
      comment('ignored', 'ignored'),
      comment('resolved', 'resolved'),
    ]
    expect(pendingComments(review('needs_changes', all)).map((item) => item.id)).toEqual([
      'open',
      'accepted',
    ])
    expect(pendingComments(undefined)).toEqual([])
  })
})

describe('updateReviewComment', () => {
  const base = review('needs_changes', [comment('c1', 'open'), comment('c2', 'open')])

  it('accepts and ignores a single comment without touching the others', () => {
    const accepted = updateReviewComment(base, 'c1', 'accept')
    expect(accepted?.comments.map((item) => item.status)).toEqual(['accepted', 'open'])
    const ignored = updateReviewComment(base, 'c2', 'ignore')
    expect(ignored?.comments.map((item) => item.status)).toEqual(['open', 'ignored'])
  })

  it('returns null for an unknown comment id', () => {
    expect(updateReviewComment(base, 'c9', 'accept')).toBeNull()
  })
})
