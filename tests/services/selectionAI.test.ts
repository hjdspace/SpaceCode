/**
 * selectionAI 服务测试 — prompt 构建、stripCodeFence、maxTokens 边界。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const llmMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  isLLMConfigured: vi.fn(),
  initLLMService: vi.fn(),
}))

vi.mock('@/services/llm', () => ({
  sendMessage: llmMocks.sendMessage,
  isLLMConfigured: llmMocks.isLLMConfigured,
  initLLMService: llmMocks.initLLMService,
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    config: { apiKey: 'sk-test', provider: 'anthropic', baseUrl: '', model: 'claude-3' },
    authMethod: 'apikey',
  }),
}))

import { buildSelectionMessages, stripCodeFence, runSelectionAction } from '@/services/selectionAI'

describe('stripCodeFence', () => {
  it('剥离带语言标注的围栏', () => {
    expect(stripCodeFence('```ts\nconst a = 1\n```')).toBe('const a = 1')
  })

  it('剥离无语言标注的围栏', () => {
    expect(stripCodeFence('```\nplain code\n```')).toBe('plain code')
  })

  it('无围栏文本原样返回(仅 trim)', () => {
    expect(stripCodeFence('  just text  ')).toBe('just text')
  })

  it('正文中的反引号不受影响', () => {
    const text = 'use `foo()` here'
    expect(stripCodeFence(text)).toBe(text)
  })
})

describe('buildSelectionMessages', () => {
  it('explain 使用解释 system prompt', () => {
    const msgs = buildSelectionMessages({ type: 'explain', selectedText: 'foo', isCode: false, locale: 'zh-CN' })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toContain('foo')
  })

  it('improve 的用户消息包含选区', () => {
    const msgs = buildSelectionMessages({ type: 'improve', selectedText: 'some text', isCode: false, locale: 'en-US' })
    expect(msgs[0].content).toContain('some text')
  })

  it('custom 嵌入用户指令', () => {
    const msgs = buildSelectionMessages({ type: 'custom', selectedText: 'text', customInstruction: 'make it bold', isCode: false, locale: 'zh-CN' })
    expect(msgs[0].content).toContain('make it bold')
  })

  it('isCode 时选区被围栏包裹', () => {
    const msgs = buildSelectionMessages({ type: 'improve', selectedText: 'const x = 1', isCode: true, locale: 'zh-CN' })
    expect(msgs[0].content).toContain('```\nconst x = 1\n```')
  })

  it('fileName 附加文件提示', () => {
    const msgs = buildSelectionMessages({ type: 'explain', selectedText: 'foo', isCode: true, locale: 'zh-CN', fileName: 'a.ts' })
    expect(msgs[0].content).toContain('a.ts')
  })
})

describe('runSelectionAction', () => {
  beforeEach(() => {
    llmMocks.sendMessage.mockReset()
    llmMocks.isLLMConfigured.mockReturnValue(true)
  })

  it('调用 sendMessage 并返回结果', async () => {
    llmMocks.sendMessage.mockResolvedValue('rewritten text')
    const result = await runSelectionAction({ type: 'improve', selectedText: 'original', isCode: false, locale: 'zh-CN' })
    expect(result).toBe('rewritten text')
    expect(llmMocks.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('代码改写结果剥围栏', async () => {
    llmMocks.sendMessage.mockResolvedValue('```\nconst x = 2\n```')
    const result = await runSelectionAction({ type: 'improve', selectedText: 'const x = 1', isCode: true, locale: 'zh-CN' })
    expect(result).toBe('const x = 2')
  })

  it('explain 结果不剥围栏', async () => {
    llmMocks.sendMessage.mockResolvedValue('```\nexample\n```')
    const result = await runSelectionAction({ type: 'explain', selectedText: 'foo', isCode: true, locale: 'zh-CN' })
    expect(result).toBe('```\nexample\n```')
  })

  it('maxTokens 随选区长度缩放且有上下限', async () => {
    llmMocks.sendMessage.mockResolvedValue('ok')
    await runSelectionAction({ type: 'improve', selectedText: 'hi', isCode: false, locale: 'zh-CN' })
    expect(llmMocks.sendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxTokens: 1024 }))

    llmMocks.sendMessage.mockClear()
    await runSelectionAction({ type: 'improve', selectedText: 'x'.repeat(20000), isCode: false, locale: 'zh-CN' })
    expect(llmMocks.sendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxTokens: 4096 }))
  })

  it('LLM 抛错时向上传播', async () => {
    llmMocks.sendMessage.mockRejectedValue(new Error('API failed'))
    await expect(
      runSelectionAction({ type: 'improve', selectedText: 'x', isCode: false, locale: 'zh-CN' })
    ).rejects.toThrow('API failed')
  })
})
