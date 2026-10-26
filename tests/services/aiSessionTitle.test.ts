import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initLLMService: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn(),
  config: {
    provider: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: undefined as string | undefined,
    model: 'claude-sonnet-4-5',
  },
  haikuModel: 'claude-haiku-4-5' as string | undefined,
}))

vi.mock('@/services/llm', () => ({
  initLLMService: mocks.initLLMService,
  sendMessage: mocks.sendMessage,
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ config: mocks.config, getHaikuModel: () => mocks.haikuModel }),
}))

import {
  buildSessionTitlePrompt,
  generateSessionTitle,
  isLowSignalInput,
  normalizeGeneratedTitle,
  stripCodeBlocks,
} from '@/services/aiSessionTitle'

describe('AI session title prompt building', () => {
  it('builds a Chinese prompt that asks for a title-only answer', () => {
    const prompt = buildSessionTitlePrompt('帮我重构 GUI 目录结构', true)

    expect(prompt.system).toContain('会话标题生成器')
    expect(prompt.user).toContain('帮我重构 GUI 目录结构')
  })

  it('builds an English prompt when the locale is not zh-CN', () => {
    const prompt = buildSessionTitlePrompt('refactor the GUI directory', false)

    expect(prompt.system).toContain('session title generator')
    expect(prompt.user).toContain('refactor the GUI directory')
  })

  it('drops fenced code blocks from the message sent to the model', () => {
    const message = '请把下面的函数改成异步\n```js\nfunction load() { return fetch(url) }\n```'
    const stripped = stripCodeBlocks(message)

    expect(stripped).not.toContain('fetch(url)')
    expect(buildSessionTitlePrompt(message, true).user).toContain('请把下面的函数改成异步')
  })

  it('keeps the original message when stripping would erase most of it', () => {
    const message = '```js\nconst a = 1\n```'

    expect(stripCodeBlocks(message)).toBe(message)
  })

  it('caps the message forwarded to the model at 2000 characters', () => {
    const prompt = buildSessionTitlePrompt('x'.repeat(3000), true)

    expect(prompt.user).toContain('x'.repeat(2000) + '…')
    expect(prompt.user).not.toContain('x'.repeat(2001))
  })
})

describe('AI session title low-signal filtering', () => {
  it('treats greetings, confirmations and bare numbers as low signal', () => {
    for (const message of ['你好', 'hello', 'thanks!', '好的', '123', '   ', '？？？']) {
      expect(isLowSignalInput(message)).toBe(true)
    }
  })

  it('treats a substantive first message as worth generating for', () => {
    expect(isLowSignalInput('帮我重构 GUI 目录结构')).toBe(false)
  })
})

describe('AI session title response normalization', () => {
  it('takes only the first line and strips quotes and trailing punctuation', () => {
    expect(normalizeGeneratedTitle('“GUI 目录重构”。\n第二行说明')).toBe('GUI 目录重构')
  })

  it('drops label prefixes and list markers the model may prepend', () => {
    expect(normalizeGeneratedTitle('标题：GUI 目录重构')).toBe('GUI 目录重构')
    expect(normalizeGeneratedTitle('- GUI 目录重构')).toBe('GUI 目录重构')
  })

  it('rejects the placeholder answers that mean "no title"', () => {
    for (const value of ['none', 'NONE', '无', '', '   ', null, undefined]) {
      expect(normalizeGeneratedTitle(value)).toBeNull()
    }
  })

  it('truncates an over-long title to 40 characters with an ellipsis', () => {
    const title = normalizeGeneratedTitle('x'.repeat(60))!

    expect(title).toBe(`${'x'.repeat(40)}...`)
  })
})

describe('AI session title generation', () => {
  beforeEach(() => {
    mocks.config.apiKey = 'sk-test'
    mocks.config.provider = 'anthropic'
    mocks.haikuModel = 'claude-haiku-4-5'
    mocks.initLLMService.mockClear()
    mocks.sendMessage.mockReset()
  })

  it('titles with the fast (haiku) slot instead of the session model', async () => {
    mocks.sendMessage.mockResolvedValueOnce('GUI 目录重构')

    await generateSessionTitle('帮我重构 GUI 目录结构', true)

    // 只覆盖本次请求；initLLMService 写的是模块级共享配置，动它会连带降级提交信息、划词 AI
    expect(mocks.sendMessage.mock.calls[0][1]).toMatchObject({ model: 'claude-haiku-4-5' })
    expect(mocks.initLLMService).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-5' }))
  })

  it('falls back to the session model when the fast slot is empty', async () => {
    mocks.haikuModel = undefined
    mocks.sendMessage.mockResolvedValueOnce('GUI 目录重构')

    await generateSessionTitle('帮我重构 GUI 目录结构', true)

    expect(mocks.sendMessage.mock.calls[0][1]).toMatchObject({ model: 'claude-sonnet-4-5' })
  })

  it('returns an AI title for a substantive first message', async () => {
    mocks.sendMessage.mockResolvedValueOnce('“GUI 目录重构”')

    await expect(generateSessionTitle('帮我重构 GUI 目录结构', true)).resolves.toBe('GUI 目录重构')
    expect(mocks.sendMessage).toHaveBeenCalledOnce()
  })

  it('gives reasoning gateways enough completion budget to answer after thinking', async () => {
    mocks.sendMessage.mockResolvedValueOnce('GUI 目录重构')

    await generateSessionTitle('帮我重构 GUI 目录结构', true)

    // 推理模型先把预算花在 reasoning_content 上，预算小了正文永远是空的
    expect(mocks.sendMessage.mock.calls[0][1]).toMatchObject({
      maxTokens: 1024,
      timeoutMs: 30000,
      maxRetries: 1,
    })
  })

  it('gives up quietly when the gateway answers with an empty body', async () => {
    // glm-5.2 等推理网关的实测形状：content 为空、finish_reason=length
    mocks.sendMessage.mockResolvedValueOnce('')

    await expect(generateSessionTitle('帮我重构 GUI 目录结构', true)).resolves.toBeNull()
  })

  it('skips the API call for low-signal input so greetings cost nothing', async () => {
    await expect(generateSessionTitle('你好', true)).resolves.toBeNull()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('skips the API call when no API key is available (OAuth login modes)', async () => {
    mocks.config.apiKey = ''

    await expect(generateSessionTitle('帮我重构 GUI 目录结构', true)).resolves.toBeNull()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('swallows API failures instead of surfacing an error for a title', async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error('API Key 无效'))

    await expect(generateSessionTitle('帮我重构 GUI 目录结构', true)).resolves.toBeNull()
  })
})
