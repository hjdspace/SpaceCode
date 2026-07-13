// electron/__tests__/petLLMProxy.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/tmp/mock-${name}`),
  },
}))

vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

import { buildSystemPrompt, isSimilar, truncate, TRIGGER_DESCRIPTION } from '../petLLMProxy'

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
