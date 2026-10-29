// @vitest-environment node
/**
 * 审查输出解析：只认 `<review>` 包裹的 JSON，容忍代码围栏与前后说明；
 * 坏路径 / 越界行号降级为纯文本意见，schema 不合法交给上层重试一次。
 */
import { describe, it, expect } from 'vitest'
import {
  parseReviewOutput,
  mergeReviewComments,
  REVIEW_RETRY_PROMPT,
  type ParsedReviewJson,
} from '../reviewParse'
import type { FactoryReviewComment } from '@/shared/factory'

function body(json: string): string {
  return `<review>\n${json}\n</review>`
}

describe('parseReviewOutput', () => {
  it('accepts a fenced JSON block surrounded by prose', () => {
    const text = `Here is my review.\n\`\`\`json\n${body(
      '{"verdict":"needs_changes","summary":"方向正确","comments":[{"file":"src/a.ts","line":12,"body":"空指针","severity":"blocker"},{"body":"补测试"}]}',
    )}\n\`\`\`\nThanks.`
    const result = parseReviewOutput(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.review.verdict).toBe('needs_changes')
    expect(result.review.summary).toBe('方向正确')
    expect(result.review.comments).toEqual([
      { id: 'c1', file: 'src/a.ts', line: 12, body: '空指针', severity: 'blocker', status: 'open' },
      { id: 'c2', body: '补测试', severity: 'suggestion', status: 'open' },
    ])
  })

  it('requires the review tag', () => {
    expect(parseReviewOutput('{"verdict":"approved","summary":"ok","comments":[]}')).toEqual({
      ok: false,
      error: 'missing-tag',
    })
  })

  it('reports invalid JSON and invalid schema separately', () => {
    expect(parseReviewOutput(body('{not json'))).toMatchObject({ ok: false, error: 'invalid-json' })
    expect(parseReviewOutput(body('{"verdict":"maybe","summary":"x","comments":[]}'))).toMatchObject({
      ok: false,
      error: 'invalid-schema',
    })
    expect(parseReviewOutput(body('{"verdict":"approved","summary":"x","comments":"nope"}'))).toMatchObject({
      ok: false,
      error: 'invalid-schema',
    })
    expect(parseReviewOutput(body('{"verdict":"approved","summary":"x","comments":[{"file":"a.ts"}]}'))).toMatchObject({
      ok: false,
      error: 'invalid-schema',
    })
  })

  it('downgrades unsafe paths and bad line numbers to plain comments', () => {
    const result = parseReviewOutput(
      body(
        '{"verdict":"approved","summary":"ok","comments":[{"file":"../../etc/passwd","line":3,"body":"a"},{"file":"C:\\\\x.ts","line":2,"body":"b"},{"file":"src/x.ts","line":0,"body":"c"},{"file":"src/y.ts","line":"7","body":"d"}]}',
      ),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.review.comments).toEqual([
      { id: 'c1', body: 'a', severity: 'suggestion', status: 'open' },
      { id: 'c2', body: 'b', severity: 'suggestion', status: 'open' },
      { id: 'c3', file: 'src/x.ts', body: 'c', severity: 'suggestion', status: 'open' },
      { id: 'c4', file: 'src/y.ts', body: 'd', severity: 'suggestion', status: 'open' },
    ])
  })

  it('accepts an approved review without comments', () => {
    expect(parseReviewOutput(body('{"verdict":"approved","summary":"没问题"}'))).toEqual({
      ok: true,
      review: { verdict: 'approved', summary: '没问题', comments: [] },
    })
  })
})

describe('mergeReviewComments', () => {
  const previous: FactoryReviewComment[] = [
    { id: 'c1', file: 'src/a.ts', line: 1, body: '旧问题', severity: 'blocker', status: 'open' },
    { id: 'c2', body: '已忽略', severity: 'suggestion', status: 'ignored' },
    { id: 'c3', file: 'src/b.ts', line: 2, body: '已修复', severity: 'blocker', status: 'accepted' },
  ]

  it('resolves pending previous comments when the new verdict approves', () => {
    const merged = mergeReviewComments(previous, [], 'approved')
    expect(merged).toEqual([
      { id: 'c1', file: 'src/a.ts', line: 1, body: '旧问题', severity: 'blocker', status: 'resolved' },
      { id: 'c2', body: '已忽略', severity: 'suggestion', status: 'ignored' },
      { id: 'c3', file: 'src/b.ts', line: 2, body: '已修复', severity: 'blocker', status: 'resolved' },
    ])
  })

  it('keeps matching comments and appends new ones with fresh ids', () => {
    const next: ParsedReviewJson['comments'] = [
      { id: 'c1', file: 'src/a.ts', line: 1, body: '旧问题', severity: 'blocker', status: 'open' },
      { id: 'c2', file: 'src/c.ts', line: 9, body: '新问题', severity: 'suggestion', status: 'open' },
    ]
    const merged = mergeReviewComments(previous, next, 'needs_changes')
    expect(merged.map((comment) => `${comment.id}:${comment.status}`)).toEqual([
      'c1:open',
      'c2:ignored',
      'c3:accepted',
      'c4:open',
    ])
  })
})

describe('retry prompt', () => {
  it('asks for exactly one review block', () => {
    expect(REVIEW_RETRY_PROMPT).toContain('<review>')
    expect(REVIEW_RETRY_PROMPT).toContain('JSON')
  })
})
