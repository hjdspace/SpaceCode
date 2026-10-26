// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { composeTranscript } from '../transcriptAssembler'

/**
 * Endpoint handling turns one long recording into several recognizer segments.
 * The live transcript must always read as "every committed segment, then the
 * segment still being decoded", and the final transcript is the committed
 * segments alone. Both are the same string at the moment an endpoint commits.
 */
describe('composeTranscript', () => {
  it('returns the live partial while nothing has been committed', () => {
    expect(composeTranscript([], '你好 world')).toBe('你好 world')
  })

  it('joins committed segments with the live partial by a space', () => {
    expect(composeTranscript(['第一段。', 'second part'], '第三段')).toBe(
      '第一段。 second part 第三段',
    )
  })

  it('collapses the endpoint moment to the same string before and after the reset', () => {
    const beforeEndpoint = composeTranscript(['第一段。'], '第二段')
    const afterEndpoint = composeTranscript(['第一段。', '第二段'], '')
    expect(afterEndpoint).toBe(beforeEndpoint)
  })

  it('trims the partial and ignores empty segments', () => {
    expect(composeTranscript(['', '  '], '  hello  ')).toBe('hello')
    expect(composeTranscript(['a', '', 'b'], '')).toBe('a b')
  })
})
