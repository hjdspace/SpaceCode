// @vitest-environment node
/**
 * promptOptimizerIPC — 设置读取、provider 分发与项目上下文注入。
 *
 * 三个 provider caller 都是模块私有函数，公开入口只有 optimizePrompt 与
 * 注册的 IPC handler，因此统一经公开入口驱动：
 *  - gui-settings.json 走真实临时目录（mock app.getPath('home')）
 *  - 网络统一 mock electron 的 net.fetch，按 authMethod 断言 URL/Header/Body
 *  - 项目上下文走真实临时项目目录，钉住树过滤 / 信号文件 / 截断等 fs 行为
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn((_name: string) => ''),
}))

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: electronMock.getPath },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, handler)
    }),
  },
  net: { fetch: fetchMock },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { optimizePrompt, registerPromptOptimizerIPC } from '../promptOptimizerIPC'

let home = ''

function writeSettings(settings: unknown): void {
  writeRawSettings(JSON.stringify(settings))
}

function writeRawSettings(raw: string): void {
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', 'gui-settings.json'), raw, 'utf-8')
}

function fetchResponse(body: unknown, ok = true, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok, status, text: async () => text }
}

function lastFetchUrl(): string {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string
}

function lastFetchBody(): Record<string, any> {
  const init = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as { body: string }
  return JSON.parse(init.body)
}

const OPENAI_OK = { choices: [{ message: { content: '  OPTIMIZED  ' } }] }

function openaiSettings(): void {
  writeSettings({ authMethod: 'openai_compatible', openaiConfig: { apiKey: 'k' } })
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-prompt-optimizer-'))
  electronMock.getPath.mockReturnValue(home)
  fetchMock.mockReset()
  electronMock.handlers.clear()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('optimizePrompt — 入参与设置读取', () => {
  it.each(['', '   '])('rejects a blank prompt (%j)', async (prompt) => {
    await expect(optimizePrompt(prompt)).resolves.toEqual({
      success: false,
      error: 'Prompt cannot be empty',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
    ['invalid JSON', '{ oops'],
  ])('treats a $label gui-settings.json as no settings', async (_label, raw) => {
    if (raw !== undefined) writeRawSettings(raw)
    await expect(optimizePrompt('hello')).resolves.toEqual({
      success: false,
      error: 'No GUI settings found. Please configure your LLM provider first.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to openai_compatible when authMethod is absent', async () => {
    writeSettings({ openaiConfig: { apiKey: 'k' } })
    fetchMock.mockResolvedValue(fetchResponse(OPENAI_OK))

    await optimizePrompt('hello')

    expect(lastFetchUrl()).toBe('https://api.openai.com/v1/chat/completions')
    expect(lastFetchBody().model).toBe('gpt-4o-mini')
  })

  it('rejects unsupported auth methods', async () => {
    writeSettings({ authMethod: 'azure' })

    await expect(optimizePrompt('hello')).resolves.toEqual({
      success: false,
      error: 'Unsupported auth method: azure',
    })
  })

  it('rejects each provider when its API key is missing', async () => {
    writeSettings({ authMethod: 'openai_compatible' })
    await expect(optimizePrompt('x')).resolves.toEqual({
      success: false,
      error: 'OpenAI API key is not configured',
    })

    writeSettings({ authMethod: 'anthropic_compatible' })
    await expect(optimizePrompt('x')).resolves.toEqual({
      success: false,
      error: 'Anthropic API key is not configured',
    })

    writeSettings({ authMethod: 'gemini_api', geminiConfig: {} })
    await expect(optimizePrompt('x')).resolves.toEqual({
      success: false,
      error: 'Gemini API key is not configured',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('optimizePrompt — openai_compatible', () => {
  it('posts to the configured base URL with Bearer auth and trims the reply', async () => {
    writeSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { baseUrl: 'https://llm.example.com/v1///', apiKey: 'sk-oai', sonnetModel: 'my-oai-model' },
    })
    fetchMock.mockResolvedValue(fetchResponse(OPENAI_OK))

    const result = await optimizePrompt('请优化这段话')

    expect(result).toEqual({ success: true, result: 'OPTIMIZED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastFetchUrl()).toBe('https://llm.example.com/v1/chat/completions')

    const init = fetchMock.mock.calls[0][1] as { method: string; headers: Record<string, string> }
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers['Authorization']).toBe('Bearer sk-oai')

    const body = lastFetchBody()
    expect(body.model).toBe('my-oai-model')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('Prompt Optimization Expert')
    expect(body.messages[1]).toEqual({ role: 'user', content: '请优化这段话' })
  })

  it('surfaces HTTP errors, empty replies, malformed JSON and network failures', async () => {
    openaiSettings()

    fetchMock.mockResolvedValue(fetchResponse('boom', false, 500))
    await expect(optimizePrompt('x')).resolves.toEqual({ success: false, error: 'HTTP 500: boom' })

    fetchMock.mockResolvedValue(fetchResponse({ choices: [{ message: { content: '   ' } }] }))
    await expect(optimizePrompt('x')).resolves.toEqual({
      success: false,
      error: 'Empty response from OpenAI-compatible endpoint',
    })

    fetchMock.mockResolvedValue(fetchResponse('{ not json'))
    const broken = await optimizePrompt('x')
    expect(broken.success).toBe(false)
    expect((broken as { success: false; error: string }).error).toBeTruthy()

    fetchMock.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(optimizePrompt('x')).resolves.toEqual({ success: false, error: 'ENOTFOUND' })
  })
})

describe('optimizePrompt — anthropic 系（anthropic_compatible / claudeai / console）', () => {
  it('claudeai posts to the configured relay with anthropic headers and picks the text block', async () => {
    writeSettings({
      authMethod: 'claudeai',
      anthropicConfig: { baseUrl: 'https://relay.example.com/', apiKey: 'sk-an' },
    })
    fetchMock.mockResolvedValue(
      fetchResponse({ content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '  polished  ' }] }),
    )

    const result = await optimizePrompt('polish this')

    expect(result).toEqual({ success: true, result: 'polished' })
    expect(lastFetchUrl()).toBe('https://relay.example.com/v1/messages')

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers['x-api-key']).toBe('sk-an')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')

    const body = lastFetchBody()
    expect(body.model).toBe('claude-3-5-sonnet-latest')
    expect(body.system).toContain('Prompt Optimization Expert')
    expect(body.messages).toEqual([{ role: 'user', content: 'polish this' }])
  })

  it('routes console auth to the default anthropic endpoint', async () => {
    writeSettings({ authMethod: 'console', anthropicConfig: { apiKey: 'k' } })
    fetchMock.mockResolvedValue(fetchResponse({ content: [{ type: 'text', text: 'ok' }] }))

    await optimizePrompt('x')

    expect(lastFetchUrl()).toBe('https://api.anthropic.com/v1/messages')
  })

  it('treats missing or non-text content as empty replies and HTTP failures as errors', async () => {
    writeSettings({ authMethod: 'anthropic_compatible', anthropicConfig: { apiKey: 'k' } })

    fetchMock.mockResolvedValue(fetchResponse({ content: [] }))
    await expect(optimizePrompt('x')).resolves.toEqual({
      success: false,
      error: 'Empty response from Anthropic endpoint',
    })

    fetchMock.mockResolvedValue(fetchResponse({ content: 'plain string' }))
    await expect(optimizePrompt('x')).resolves.toEqual({
      success: false,
      error: 'Empty response from Anthropic endpoint',
    })

    fetchMock.mockResolvedValue(fetchResponse('nope', false, 429))
    await expect(optimizePrompt('x')).resolves.toEqual({ success: false, error: 'HTTP 429: nope' })
  })
})

describe('optimizePrompt — gemini_api', () => {
  it('posts to the model endpoint with the key in the query and joins text parts', async () => {
    writeSettings({
      authMethod: 'gemini_api',
      geminiConfig: { apiKey: 'secret key', sonnetModel: 'gemini-2.0-flash' },
    })
    fetchMock.mockResolvedValue(
      fetchResponse({ candidates: [{ content: { parts: [{ text: 'a' }, { noText: true }, { text: 'b' }] } }] }),
    )

    const result = await optimizePrompt('优化')

    expect(result).toEqual({ success: true, result: 'ab' })
    expect(lastFetchUrl()).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=secret%20key',
    )

    const body = lastFetchBody()
    expect(body.systemInstruction.parts[0].text).toContain('Prompt Optimization Expert')
    expect(body.contents[0].parts[0].text).toBe('优化')
    expect(body.generationConfig.maxOutputTokens).toBe(4096)
  })

  it('uses the default model and reports empty or HTTP failures', async () => {
    writeSettings({ authMethod: 'gemini_api', geminiConfig: { apiKey: 'k' } })

    fetchMock.mockResolvedValue(fetchResponse({ candidates: [{ content: { parts: [{}] } }] }))
    await expect(optimizePrompt('x')).resolves.toEqual({
      success: false,
      error: 'Empty response from Gemini endpoint',
    })
    expect(lastFetchUrl()).toContain('/models/gemini-1.5-flash-latest:')

    fetchMock.mockResolvedValue(fetchResponse('blocked', false, 403))
    await expect(optimizePrompt('x')).resolves.toEqual({ success: false, error: 'HTTP 403: blocked' })
  })
})

describe('optimizePrompt — 项目上下文注入', () => {
  function systemPromptOf(): string {
    return lastFetchBody().messages[0].content as string
  }

  it('omits the context block when workingDirectory is absent, blank or nonexistent', async () => {
    openaiSettings()
    fetchMock.mockResolvedValue(fetchResponse(OPENAI_OK))

    await optimizePrompt('x')
    expect(systemPromptOf()).toMatch(/^You are a Prompt Optimization Expert/)
    expect(systemPromptOf()).not.toContain('## Project Context')

    await optimizePrompt('x', { workingDirectory: '   ' })
    expect(systemPromptOf()).not.toContain('## Project Context')

    await optimizePrompt('x', { workingDirectory: join(home, 'missing') })
    expect(systemPromptOf()).not.toContain('## Project Context')
  })

  it('injects name, stack, scripts, deps, filtered tree and truncated signal files', async () => {
    openaiSettings()
    fetchMock.mockResolvedValue(fetchResponse(OPENAI_OK))

    const proj = join(home, 'demo-app')
    mkdirSync(join(proj, 'src'), { recursive: true })
    mkdirSync(join(proj, 'docs'))
    mkdirSync(join(proj, '.github', 'workflows'), { recursive: true })
    mkdirSync(join(proj, '.hidden'))
    mkdirSync(join(proj, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(proj, 'dist'))
    writeFileSync(
      join(proj, 'package.json'),
      JSON.stringify({
        name: 'demo-app',
        description: 'A demo project',
        scripts: { build: 'vite build', test: 'vitest run' },
        dependencies: { vue: '^3.5.0' },
        devDependencies: { electron: '^33.0.0', vite: '^6.0.0' },
      }),
      'utf-8',
    )
    writeFileSync(join(proj, 'tsconfig.json'), '{}', 'utf-8')
    writeFileSync(join(proj, 'CLAUDE.md'), 'A'.repeat(1600), 'utf-8')
    writeFileSync(join(proj, 'README.md'), '# Demo', 'utf-8')
    writeFileSync(join(proj, 'src', 'main.ts'), 'export {}', 'utf-8')

    await optimizePrompt('x', { workingDirectory: proj })

    const sys = systemPromptOf()
    expect(sys).toContain('## Project Context')
    expect(sys).toContain(`- Project root: ${proj}`)
    expect(sys).toContain('- Project name: demo-app')
    expect(sys).toContain('- Description: A demo project')
    expect(sys).toContain('- Likely stack: Vue 3, Electron, Vite, TypeScript')
    expect(sys).toContain('- npm scripts: build, test')
    expect(sys).toContain('- Key dependencies: vue, electron, vite')
    expect(sys).toContain('src/')
    expect(sys).toContain('.github/')
    expect(sys).not.toContain('node_modules')
    expect(sys).not.toContain('.hidden')
    expect(sys).not.toContain('dist/')
    expect(sys).toContain('### CLAUDE.md')
    expect(sys).toContain('…(truncated)')
    expect(sys).toContain('### README.md')
    expect(sys).toContain('Use the above context to ground the rewrite.')
  })

  it('includes at most the first two signal files in priority order', async () => {
    openaiSettings()
    fetchMock.mockResolvedValue(fetchResponse(OPENAI_OK))

    const proj = join(home, 'prio')
    mkdirSync(proj)
    writeFileSync(join(proj, 'AGENTS.md'), 'agents rules', 'utf-8')
    writeFileSync(join(proj, '.cursorrules'), 'cursor rules', 'utf-8')
    writeFileSync(join(proj, 'README.md'), 'readme', 'utf-8')

    await optimizePrompt('x', { workingDirectory: proj })

    const sys = systemPromptOf()
    expect(sys).toContain('### AGENTS.md')
    expect(sys).toContain('### .cursorrules')
    expect(sys).not.toContain('### README.md')
  })

  it('caps the top-level tree at 40 entries', async () => {
    openaiSettings()
    fetchMock.mockResolvedValue(fetchResponse(OPENAI_OK))

    const proj = join(home, 'capped')
    mkdirSync(proj)
    for (let i = 0; i < 45; i++) {
      writeFileSync(join(proj, `f${String(i).padStart(2, '0')}.md`), 'x', 'utf-8')
    }

    await optimizePrompt('x', { workingDirectory: proj })

    const sys = systemPromptOf()
    expect(sys).toContain('f39.md')
    expect(sys).not.toContain('f40.md')
  })

  it('falls back to the directory name when package.json is broken or nameless', async () => {
    openaiSettings()
    fetchMock.mockResolvedValue(fetchResponse(OPENAI_OK))

    const projA = join(home, 'proj-a')
    mkdirSync(projA)
    writeFileSync(join(projA, 'package.json'), '{ broken', 'utf-8')
    await optimizePrompt('x', { workingDirectory: projA })
    expect(systemPromptOf()).toContain('- Project name: proj-a')
    expect(systemPromptOf()).not.toContain('npm scripts')

    const projB = join(home, 'proj-b')
    mkdirSync(projB)
    writeFileSync(join(projB, 'package.json'), JSON.stringify({ name: 42 }), 'utf-8')
    await optimizePrompt('x', { workingDirectory: projB })
    expect(systemPromptOf()).toContain('- Project name: proj-b')
  })
})

describe('registerPromptOptimizerIPC', () => {
  it('registers the IPC channel and delegates to optimizePrompt', async () => {
    registerPromptOptimizerIPC()
    const handler = electronMock.handlers.get('prompt-optimizer:optimize')
    expect(handler).toBeDefined()

    openaiSettings()
    fetchMock.mockResolvedValue(fetchResponse(OPENAI_OK))

    await expect(handler!({}, 'hello')).resolves.toEqual({ success: true, result: 'OPTIMIZED' })
    await expect(handler!({}, '')).resolves.toEqual({ success: false, error: 'Prompt cannot be empty' })
    await expect(handler!({}, undefined)).resolves.toEqual({ success: false, error: 'Prompt cannot be empty' })
  })

  it('passes the working directory option through to the optimizer', async () => {
    registerPromptOptimizerIPC()
    const handler = electronMock.handlers.get('prompt-optimizer:optimize')!

    openaiSettings()
    fetchMock.mockResolvedValue(fetchResponse(OPENAI_OK))

    const proj = join(home, 'proj')
    mkdirSync(proj)
    await handler({}, 'hello', { workingDirectory: proj })

    expect(lastFetchBody().messages[0].content).toContain('## Project Context')
  })
})
