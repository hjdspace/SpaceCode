/**
 * Tests for AI commit message prompt builder (src/services/aiCommitMessage.ts).
 */
import { describe, it, expect } from 'vitest'
import { buildCommitMessagePrompt } from '@/services/aiCommitMessage'

describe('buildCommitMessagePrompt', () => {
  const base = {
    diff: '@@ -1,1 +1,1 @@\n-old\n+new',
    recentSubjects: ['feat: previous commit', 'fix: another'],
    changedFiles: ['M src/a.ts', 'A src/b.ts'],
  }

  it('builds a Chinese system prompt for zh-CN', () => {
    const { system } = buildCommitMessagePrompt({ ...base, isZh: true })
    expect(system).toContain('Conventional Commits')
    expect(system).toContain('中文提交信息')
  })

  it('builds an English system prompt for non-zh locales', () => {
    const { system } = buildCommitMessagePrompt({ ...base, isZh: false })
    expect(system).toContain('Conventional Commits')
    expect(system).toContain('expert Git commit message writer')
  })

  it('includes diff, recent subjects, and changed files in the user prompt', () => {
    const { user } = buildCommitMessagePrompt({ ...base, isZh: true })
    expect(user).toContain('feat: previous commit')
    expect(user).toContain('M src/a.ts')
    expect(user).toContain('@@ -1,1 +1,1 @@')
  })

  it('handles empty recent subjects', () => {
    const { user } = buildCommitMessagePrompt({ ...base, recentSubjects: [], isZh: true })
    expect(user).toContain('（暂无提交记录）')
  })

  it('truncates long diffs', () => {
    const longDiff = 'x'.repeat(20000)
    const { user } = buildCommitMessagePrompt({ ...base, diff: longDiff, isZh: false })
    expect(user).toContain('(truncated)')
    expect(user.length).toBeLessThan(longDiff.length)
  })
})
