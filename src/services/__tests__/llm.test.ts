/**
 * llm.ts 直连 LLM 服务的契约。
 *
 * 该模块供 AI commit message / 会话标题 / 技能翻译 / 选区 AI 等非 Agent
 * 功能直接调用 LLM API。Base URL 拼装错误、认证头缺失、错误提示不明确
 * 都是用户侧高频踩坑点（错误信息直接展示在 UI 上），在此钉住：
 *   • buildApiUrl 四种 baseUrl 形态的归一化
 *   • 官方/第三方网关的认证头差异（官方仅 x-api-key，第三方需 Bearer）
 *   • classifyAnthropicError 各错误分支的中文提示文案
 *   • anthropic / OpenAI 兼容两条请求路径的请求体与响应解析
 *
 * 模块级 currentConfig/llmState 状态要求动态 import 取新鲜模块（与
 * electronAPI.facade.test.ts 的模式一致）。retry 用真实实现，统一传
 * maxRetries: 0 避免重试延迟（retry 自身已在 tests/utils/retry.test.ts 覆盖）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMConfig } from '@/services/llm'

const mocks = vi.hoisted(() => ({
  httpFetch: vi.fn(),
  handleError: vi.fn(),
  settingsConfig: { provider: '', apiKey: '', baseUrl: '', model: '' } as Record<string, string>,
  settingsThrows: false,
}))

vi.mock('@/services/electronAPI', () => ({
  api: { httpFetch: mocks.httpFetch },
}))
vi.mock('@/services/errorHandler', () => ({
  errorHandler: { handleError: mocks.handleError },
}))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => {
    if (mocks.settingsThrows) throw new Error('pinia not active')
    return { config: mocks.settingsConfig }
  },
}))

let llm: typeof import('@/services/llm')

beforeEach(async () => {
  vi.resetModules()
  mocks.httpFetch.mockReset()
  mocks.handleError.mockReset()
  mocks.handleError.mockImplementation((error: Error) => ({ message: error.message }))
  Object.assign(mocks.settingsConfig, { provider: '', apiKey: '', baseUrl: '', model: '' })
  mocks.settingsThrows = false
  llm = await import('@/services/llm')
})

function okResponse(data: unknown) {
  return { ok: true, status: 200, data: JSON.stringify(data) }
}

function errResponse(status: number, text: string) {
  return { ok: false, status, data: text }
}

function configureAnthropic(overrides: Partial<LLMConfig> = {}) {
  llm.updateConfig({ provider: 'anthropic', apiKey: 'sk-test', ...overrides })
}

function send(options: { maxTokens?: number; system?: string; timeoutMs?: number; maxRetries?: number; model?: string } = {}) {
  return llm.sendMessage([{ role: 'user', content: 'hi' }], { maxRetries: 0, ...options })
}

type HttpFetchCall = [string, { body: string; headers: Record<string, string>; timeoutMs?: number }]

function lastCall(): HttpFetchCall {
  return mocks.httpFetch.mock.calls[mocks.httpFetch.mock.calls.length - 1] as HttpFetchCall
}

describe('initLLMService / 配置管理', () => {
  it('传入 config 时直接设置 provider 与 isConfigured', () => {
    llm.initLLMService({ provider: 'anthropic', apiKey: 'k1' })

    expect(llm.llmState.provider.value).toBe('anthropic')
    expect(llm.llmState.isConfigured.value).toBe(true)
    expect(llm.isLLMConfigured()).toBe(true)
  })

  it('apiKey 为空时 isConfigured 与 isLLMConfigured 均为 false', () => {
    llm.initLLMService({ provider: 'anthropic', apiKey: '' })

    expect(llm.llmState.isConfigured.value).toBe(false)
    expect(llm.isLLMConfigured()).toBe(false)
  })

  it('无 config 时从 settings store 读取有效配置', async () => {
    mocks.settingsConfig.provider = 'anthropic'
    mocks.settingsConfig.apiKey = 'sk-settings'

    await llm.initLLMService()

    expect(llm.llmState.provider.value).toBe('anthropic')
    expect(llm.llmState.isConfigured.value).toBe(true)
  })

  it('无 config 且 settings 无 apiKey 时保持未配置', async () => {
    await llm.initLLMService()

    expect(llm.llmState.isConfigured.value).toBe(false)
    expect(llm.isLLMConfigured()).toBe(false)
  })

  it('settings store 抛出异常时被吞掉且保持未配置', async () => {
    mocks.settingsThrows = true

    await expect(llm.initLLMService()).resolves.toBeUndefined()
    expect(llm.isLLMConfigured()).toBe(false)
  })

  it('updateConfig 覆盖当前配置', () => {
    llm.initLLMService({ provider: 'anthropic', apiKey: 'k1' })
    llm.updateConfig({ provider: 'openai', apiKey: 'k2' })

    expect(llm.llmState.provider.value).toBe('openai')
    expect(llm.isLLMConfigured()).toBe(true)
  })

  it('updateConfig 的 apiKey 为空时 isConfigured 为 false', () => {
    llm.initLLMService({ provider: 'anthropic', apiKey: 'k1' })
    llm.updateConfig({ provider: 'openai', apiKey: '' })

    expect(llm.isLLMConfigured()).toBe(false)
  })
})

describe('buildApiUrl — 经 sendMessage 捕获 httpFetch 入参验证', () => {
  it('无 baseUrl 时使用官方默认地址', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    expect(lastCall()[0]).toBe('https://api.anthropic.com/v1/messages')
  })

  it('baseUrl 尾斜杠被归一化后拼接 endpoint', async () => {
    configureAnthropic({ baseUrl: 'https://proxy.example.com/' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    expect(lastCall()[0]).toBe('https://proxy.example.com/v1/messages')
  })

  it('baseUrl 已含完整 endpoint 时原样使用', async () => {
    configureAnthropic({ baseUrl: 'https://proxy.example.com/v1/messages' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    expect(lastCall()[0]).toBe('https://proxy.example.com/v1/messages')
  })

  it('baseUrl 以 /v1 结尾时仅追加 /messages', async () => {
    configureAnthropic({ baseUrl: 'https://proxy.example.com/v1' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    expect(lastCall()[0]).toBe('https://proxy.example.com/v1/messages')
  })

  it('普通 baseUrl 直接拼接完整 endpoint', async () => {
    configureAnthropic({ baseUrl: 'https://proxy.example.com/api' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    expect(lastCall()[0]).toBe('https://proxy.example.com/api/v1/messages')
  })
})

describe('buildAnthropicHeaders — 认证头', () => {
  it('官方地址仅携带 x-api-key，无 Authorization', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    const headers = lastCall()[1].headers
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['Authorization']).toBeUndefined()
  })

  it('官方地址大小写与尾斜杠不敏感', async () => {
    configureAnthropic({ baseUrl: 'HTTPS://API.Anthropic.COM/' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    expect(lastCall()[1].headers['Authorization']).toBeUndefined()
  })

  it('api.anthropic.com/v1 同样视为官方地址', async () => {
    configureAnthropic({ baseUrl: 'https://api.anthropic.com/v1' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    expect(lastCall()[1].headers['Authorization']).toBeUndefined()
  })

  it('第三方中转同时携带 Authorization Bearer 与 x-api-key', async () => {
    configureAnthropic({ baseUrl: 'https://proxy.example.com' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    const headers = lastCall()[1].headers
    expect(headers['Authorization']).toBe('Bearer sk-test')
    expect(headers['x-api-key']).toBe('sk-test')
  })
})

describe('sendMessage — anthropic 分支', () => {
  it('未配置 apiKey 时抛出 LLM not configured', async () => {
    await expect(send()).rejects.toThrow('LLM not configured')
    expect(mocks.httpFetch).not.toHaveBeenCalled()
  })

  it('成功响应返回 content[0].text', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'hello' }] }))

    await expect(send()).resolves.toBe('hello')
  })

  it('content 为空数组时返回空字符串', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [] }))

    await expect(send()).resolves.toBe('')
  })

  it('响应体非 JSON 时抛出 Invalid JSON 提示', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue({ ok: true, status: 200, data: '<html>Bad Gateway</html>' })

    await expect(send()).rejects.toThrow('Invalid JSON response from API')
  })

  it('默认 model 与 max_tokens，system 缺省时不出现在请求体', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    const body = JSON.parse(lastCall()[1].body)
    expect(body.model).toBe('claude-3-sonnet-20240229')
    expect(body.max_tokens).toBe(1024)
    expect('system' in body).toBe(false)
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('options 的 model/maxTokens/system 覆盖默认值且 timeoutMs 透传', async () => {
    configureAnthropic({ model: 'claude-sonnet-4-5' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send({ system: '你是提交信息助手', maxTokens: 55, timeoutMs: 1234 })

    const [, init] = lastCall()
    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-sonnet-4-5')
    expect(body.max_tokens).toBe(55)
    expect(body.system).toBe('你是提交信息助手')
    expect(init.timeoutMs).toBe(1234)
  })

  it('options.model 单次覆盖请求模型，且不改动后续调用的共享配置', async () => {
    configureAnthropic({ model: 'claude-sonnet-4-5' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send({ model: 'claude-haiku-4-5' })
    expect(JSON.parse(lastCall()[1].body).model).toBe('claude-haiku-4-5')

    await send()
    expect(JSON.parse(lastCall()[1].body).model).toBe('claude-sonnet-4-5')
  })

  it('401 且响应含 invalid 时提示 API Key 无效', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(errResponse(401, 'Invalid API key provided'))

    await expect(send()).rejects.toThrow('API Key 无效，请检查设置中的 API Key 配置。')
  })

  it('401 非 invalid 时提示认证失败', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(errResponse(401, 'unauthorized'))

    await expect(send()).rejects.toThrow('认证失败，请检查 API Key 和 Base URL 配置。')
  })

  it('网关拒绝直接调用时提示认证方式不支持', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(errResponse(400, 'Please use Claude Code in your terminal'))

    await expect(send()).rejects.toThrow('认证方式不支持直接调用 API')
  })

  it('httpFetch 返回 null 时提示网络连接错误', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(null)

    await expect(send()).rejects.toThrow('无法连接到 API 服务器，请检查网络连接。')
  })

  it('500 等其余错误走 errorHandler 分类', async () => {
    configureAnthropic({ baseUrl: 'https://proxy.example.com' })
    mocks.httpFetch.mockResolvedValue(errResponse(500, 'internal error'))

    await expect(send()).rejects.toThrow('API error: 500 - internal error')
    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ provider: 'anthropic', baseUrl: 'https://proxy.example.com', phase: 'send' }),
    )
  })

  it('anthropic_compatible 同样走 /v1/messages', async () => {
    llm.updateConfig({ provider: 'anthropic_compatible', apiKey: 'sk-test' })
    mocks.httpFetch.mockResolvedValue(okResponse({ content: [{ text: 'ok' }] }))

    await send()

    expect(lastCall()[0]).toBe('https://api.anthropic.com/v1/messages')
  })
})

describe('sendMessage — OpenAI 兼容分支', () => {
  function configureOpenAI(overrides: Partial<LLMConfig> = {}) {
    llm.updateConfig({ provider: 'openai', apiKey: 'sk-test', ...overrides })
  }

  it('无 baseUrl 时默认 https://api.openai.com 且使用 Bearer 认证头', async () => {
    configureOpenAI()
    mocks.httpFetch.mockResolvedValue(okResponse({ choices: [{ message: { content: 'pong' } }] }))

    await send()

    const [url, init] = lastCall()
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers['Authorization']).toBe('Bearer sk-test')
  })

  it('system 作为首条 system 消息，缺省时请求体只含用户消息', async () => {
    configureOpenAI()
    mocks.httpFetch.mockResolvedValue(okResponse({ choices: [{ message: { content: 'pong' } }] }))

    await send({ system: 'sys prompt' })
    expect(JSON.parse(lastCall()[1].body).messages).toEqual([
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'hi' },
    ])

    await send()
    expect(JSON.parse(lastCall()[1].body).messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('成功响应返回 choices[0].message.content', async () => {
    configureOpenAI()
    mocks.httpFetch.mockResolvedValue(okResponse({ choices: [{ message: { content: 'pong' } }] }))

    await expect(send()).resolves.toBe('pong')
  })

  it('响应体非 JSON 时抛出 Invalid JSON 提示', async () => {
    configureOpenAI()
    mocks.httpFetch.mockResolvedValue({ ok: true, status: 200, data: 'not-json' })

    await expect(send()).rejects.toThrow('Invalid JSON response from API')
  })

  it('!ok 响应走 errorHandler 分类', async () => {
    configureOpenAI()
    mocks.httpFetch.mockResolvedValue(errResponse(500, 'server exploded'))

    await expect(send()).rejects.toThrow('API error: 500 - server exploded')
    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ provider: 'openai', phase: 'send' }),
    )
  })
})

describe('sendMessage — 重试', () => {
  it('maxRetries 为 0 时失败不重试，httpFetch 仅调用一次', async () => {
    configureAnthropic()
    mocks.httpFetch.mockResolvedValue(errResponse(500, 'internal error'))

    await expect(send({ maxRetries: 0 })).rejects.toThrow('API error: 500')
    expect(mocks.httpFetch).toHaveBeenCalledTimes(1)
  })
})
