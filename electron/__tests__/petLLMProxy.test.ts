// electron/__tests__/petLLMProxy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
  },
}))

vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

import { buildSystemPrompt, isSimilar, truncate, TRIGGER_DESCRIPTION, loadLLMConfig } from '../petLLMProxy'
import { app } from 'electron'

describe('petLLMProxy', () => {
  describe('buildSystemPrompt', () => {
    it('包含宠物名和性格', () => {
      const prompt = buildSystemPrompt({
        petName: 'Waddles',
        personality: '古怪又容易开心',
        recentMessages: [],
        trigger: 'idle'
      })
      expect(prompt).toContain('Waddles')
      expect(prompt).toContain('古怪又容易开心')
    })

    it('包含触发场景描述', () => {
      const prompt = buildSystemPrompt({
        petName: 'Test',
        personality: 'test',
        recentMessages: [],
        trigger: 'error'
      })
      expect(prompt).toContain('错误')
    })

    it('包含最近消息上下文', () => {
      const prompt = buildSystemPrompt({
        petName: 'Test',
        personality: 'test',
        recentMessages: [
          { role: 'user', content: '帮我写个函数' },
          { role: 'assistant', content: '好的' }
        ],
        trigger: 'success'
      })
      expect(prompt).toContain('帮我写个函数')
      expect(prompt).toContain('好的')
    })
  })

  describe('TRIGGER_DESCRIPTION', () => {
    it('包含所有 5 种触发场景', () => {
      expect(TRIGGER_DESCRIPTION.idle).toBeDefined()
      expect(TRIGGER_DESCRIPTION.typing).toBeDefined()
      expect(TRIGGER_DESCRIPTION.error).toBeDefined()
      expect(TRIGGER_DESCRIPTION.success).toBeDefined()
      expect(TRIGGER_DESCRIPTION.petted).toBeDefined()
    })
  })

  describe('isSimilar', () => {
    it('相同字符串相似度为 1', () => {
      expect(isSimilar('你好世界', '你好世界', 0.7)).toBe(true)
    })

    it('完全不同字符串不相似', () => {
      expect(isSimilar('abcdef', 'uvwxyz', 0.7)).toBe(false)
    })

    it('部分重叠字符串按阈值判定', () => {
      expect(isSimilar('今天天气真好', '今天天气不错', 0.4)).toBe(true)
    })
  })

  describe('truncate', () => {
    it('短字符串不截断', () => {
      expect(truncate('hello', 100)).toBe('hello')
    })

    it('长字符串截断到指定长度', () => {
      const long = 'a'.repeat(150)
      expect(truncate(long, 100)).toHaveLength(100)
    })
  })
})

describe('loadLLMConfig', () => {
  let tempDir: string
  const mockGetPath = vi.mocked(app.getPath)

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pet-llm-test-'))
    mkdirSync(join(tempDir, '.claude'))
    mockGetPath.mockImplementation((name: string) => join(tempDir, name === 'home' ? '' : name))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function writeSettings(gui: object, pet: object = {}) {
    writeFileSync(join(tempDir, '.claude', 'gui-settings.json'), JSON.stringify(gui))
    writeFileSync(join(tempDir, '.claude', 'buddy-pets.json'), JSON.stringify({ settings: pet }))
  }

  it('openai_compatible 从 openaiConfig 提取模型', async () => {
    writeSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { baseUrl: 'http://openai', apiKey: 'key', sonnetModel: '', haikuModel: 'gpt-4o-mini', opusModel: '' },
      anthropicConfig: { baseUrl: 'http://anthropic', apiKey: 'key', sonnetModel: 'claude-sonnet', haikuModel: '', opusModel: '' },
      geminiConfig: { baseUrl: 'http://gemini', apiKey: 'key', sonnetModel: '', haikuModel: '', opusModel: '' }
    })
    const config = await loadLLMConfig()
    expect(config?.model).toBe('gpt-4o-mini')
    expect(config?.baseUrl).toBe('http://openai')
  })

  it('gemini_api 从 geminiConfig 提取模型', async () => {
    writeSettings({
      authMethod: 'gemini_api',
      openaiConfig: { baseUrl: 'http://openai', apiKey: 'key', sonnetModel: '', haikuModel: '', opusModel: '' },
      anthropicConfig: { baseUrl: 'http://anthropic', apiKey: 'key', sonnetModel: 'claude-sonnet', haikuModel: '', opusModel: '' },
      geminiConfig: { baseUrl: 'http://gemini', apiKey: 'key', sonnetModel: 'gemini-pro', haikuModel: '', opusModel: '' }
    })
    const config = await loadLLMConfig()
    expect(config?.model).toBe('gemini-pro')
    expect(config?.baseUrl).toBe('http://gemini')
  })

  it('anthropic_compatible 从 anthropicConfig 提取模型', async () => {
    writeSettings({
      authMethod: 'anthropic_compatible',
      openaiConfig: { baseUrl: 'http://openai', apiKey: 'key', sonnetModel: '', haikuModel: '', opusModel: '' },
      anthropicConfig: { baseUrl: 'http://anthropic', apiKey: 'key', sonnetModel: 'claude-sonnet', haikuModel: '', opusModel: '' },
      geminiConfig: { baseUrl: 'http://gemini', apiKey: 'key', sonnetModel: '', haikuModel: '', opusModel: '' }
    })
    const config = await loadLLMConfig()
    expect(config?.model).toBe('claude-sonnet')
    expect(config?.baseUrl).toBe('http://anthropic')
  })

  it('未配置 apiKey 或 baseUrl 返回 null', async () => {
    writeSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { baseUrl: 'http://openai', apiKey: '', sonnetModel: 'gpt-4o', haikuModel: '', opusModel: '' }
    })
    const config = await loadLLMConfig()
    expect(config).toBeNull()
  })

  it('buddy-pets 中 aiModel 优先于 provider 槽位', async () => {
    writeSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { baseUrl: 'http://openai', apiKey: 'key', sonnetModel: 'gpt-4o', haikuModel: '', opusModel: '' }
    }, { aiModel: 'custom-pet-model' })
    const config = await loadLLMConfig()
    expect(config?.model).toBe('custom-pet-model')
  })
})
