import { describe, expect, it } from 'vitest'
import { nextRevealedLength } from '../textReveal'

function runFrames(revealed: number, total: number, ms: number, frameMs = 16): number {
  let r = revealed
  for (let elapsed = 0; elapsed < ms; elapsed += frameMs) r = nextRevealedLength(r, total, frameMs)
  return r
}

describe('nextRevealedLength', () => {
  it('keeps the cursor at the end once everything is revealed', () => {
    expect(nextRevealedLength(100, 100, 16)).toBe(100)
    expect(nextRevealedLength(120, 100, 16)).toBe(100)
  })

  it('does not advance without elapsed time', () => {
    expect(nextRevealedLength(10, 100, 0)).toBe(10)
  })

  it('never overshoots the target', () => {
    expect(nextRevealedLength(0, 5, 1000)).toBeLessThanOrEqual(5)
    expect(runFrames(0, 100, 10_000)).toBe(100)
  })

  it('advances monotonically while a burst drains', () => {
    let prev = 0
    for (let i = 0; i < 40; i++) {
      const next = nextRevealedLength(prev, 100, 16)
      expect(next).toBeGreaterThan(prev)
      prev = next
    }
  })

  it('reveals most of a 100-char burst within one drain window', () => {
    const after = runFrames(0, 100, 450)
    expect(after).toBeGreaterThan(50)
    expect(after).toBeLessThan(100)
  })

  it('paces a single trailing character at the floor rate instead of instantly', () => {
    // 20 chars/s 的下限：25ms 只放出半个字符
    expect(nextRevealedLength(0, 1, 25)).toBeCloseTo(0.5)
    expect(nextRevealedLength(0, 1, 50)).toBeLessThanOrEqual(1)
  })

  it('drains a large jump from the non-streaming fallback quickly', () => {
    expect(runFrames(0, 3000, 500)).toBeGreaterThan(1800)
  })
})
