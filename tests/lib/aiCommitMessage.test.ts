/**
 * Tests for AI commit message generation (src/services/aiCommitMessage.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScmFile, ScmLogEntry } from '@/stores/scm'

const mocks = vi.hoisted(() => ({
  isLLMConfigured: vi.fn(),
  initLLMService: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn(),
  getStagedDiff: vi.fn(),
  getLog: vi.fn(),
  config: {
    provider: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: undefined as string | undefined,
    model: 'claude-sonnet-4-5',
  },
  authMethod: 'anthropic' as string,
}))

vi.mock('@/services/llm', () => ({
  isLLMConfigured: mocks.isLLMConfigured,
  initLLMService: mocks.initLLMService,
  sendMessage: mocks.sendMessage,
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    git: {
      getStagedDiff: mocks.getStagedDiff,
      getLog: mocks.getLog,
    },
  },
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ config: mocks.config, authMethod: mocks.authMethod }),
}))

import { buildCommitMessagePrompt, generateAiCommitMessage } from '@/services/aiCommitMessage'

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

describe('generateAiCommitMessage', () => {
  const staged: ScmFile[] = [
    { path: 'src/a.ts', status: 'modified', statusCode: 'M', staged: true, isTracked: true },
    { path: 'src/b.ts', status: 'added', statusCode: 'A', staged: true, isTracked: false },
  ]
  const log: ScmLogEntry[] = [
    { hash: 'abc1234', shortHash: 'abc1234', subject: 'feat: previous', author: 'dev', date: '2026-01-01', refs: '' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.config.apiKey = 'sk-test'
    mocks.config.provider = 'anthropic'
    mocks.authMethod = 'anthropic'
    mocks.isLLMConfigured.mockReturnValue(true)
    mocks.getStagedDiff.mockResolvedValue('@@ -1,1 +1,1 @@\n-old\n+new')
    mocks.getLog.mockResolvedValue(log)
    mocks.sendMessage.mockResolvedValue('  feat(scm): add tests  ')
  })

  it('rejects before touching the LLM when there is no project root', async () => {
    await expect(generateAiCommitMessage('', staged, 'zh-CN')).rejects.toThrow('No project root')
    expect(mocks.getStagedDiff).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects when nothing is staged', async () => {
    await expect(generateAiCommitMessage('/repo', [], 'zh-CN')).rejects.toThrow('No staged changes')
    expect(mocks.getStagedDiff).not.toHaveBeenCalled()
  })

  it('returns the trimmed LLM output for the staged diff', async () => {
    await expect(generateAiCommitMessage('/repo', staged, 'zh-CN')).resolves.toBe('feat(scm): add tests')

    expect(mocks.getStagedDiff).toHaveBeenCalledWith('/repo')
    expect(mocks.getLog).toHaveBeenCalledWith('/repo', 10)
    expect(mocks.sendMessage).toHaveBeenCalledOnce()
  })

  it('passes a zh prompt with recent subjects and uppercased file statuses to the LLM', async () => {
    await generateAiCommitMessage('/repo', staged, 'zh-CN')

    const [messages, options] = mocks.sendMessage.mock.calls[0]
    expect(options.system).toContain('中文提交信息')
    expect(messages[0].content).toContain('feat: previous')
    expect(messages[0].content).toContain('MODIFIED src/a.ts')
    expect(messages[0].content).toContain('ADDED src/b.ts')
  })

  it('uses the English prompt for non-zh locales', async () => {
    await generateAiCommitMessage('/repo', staged, 'en-US')

    const [, options] = mocks.sendMessage.mock.calls[0]
    expect(options.system).toContain('expert Git commit message writer')
  })

  it('tolerates a null log result (fresh repo with no commits)', async () => {
    mocks.getLog.mockResolvedValue(null)

    await expect(generateAiCommitMessage('/repo', staged, 'zh-CN')).resolves.toBe('feat(scm): add tests')
    const [messages] = mocks.sendMessage.mock.calls[0]
    expect(messages[0].content).toContain('（暂无提交记录）')
  })

  it('skips LLM initialization when already configured', async () => {
    await generateAiCommitMessage('/repo', staged, 'zh-CN')

    expect(mocks.initLLMService).not.toHaveBeenCalled()
  })

  it('initializes the LLM from settings when not yet configured', async () => {
    mocks.isLLMConfigured.mockReturnValue(false)

    await generateAiCommitMessage('/repo', staged, 'zh-CN')

    expect(mocks.initLLMService).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: undefined,
      model: 'claude-sonnet-4-5',
    })
    expect(mocks.sendMessage).toHaveBeenCalledOnce()
  })

  it('rejects with an actionable message for OAuth-only auth without an API key', async () => {
    mocks.isLLMConfigured.mockReturnValue(false)
    mocks.config.apiKey = ''
    mocks.authMethod = 'claudeai'

    await expect(generateAiCommitMessage('/repo', staged, 'zh-CN')).rejects.toThrow('OAuth')
    expect(mocks.initLLMService).not.toHaveBeenCalled()
    expect(mocks.getStagedDiff).not.toHaveBeenCalled()
  })

  it('rejects with a generic message when no API key is configured at all', async () => {
    mocks.isLLMConfigured.mockReturnValue(false)
    mocks.config.apiKey = ''
    mocks.authMethod = 'anthropic'

    await expect(generateAiCommitMessage('/repo', staged, 'zh-CN')).rejects.toThrow('LLM not configured')
    expect(mocks.initLLMService).not.toHaveBeenCalled()
  })
})
