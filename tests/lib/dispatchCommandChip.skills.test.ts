import { describe, expect, it } from 'vitest'
import { dispatchCommandChip, resolveDirectSlash } from '@/lib/message-input-logic'

describe('manual skill invocation', () => {
  it.each(['', '讨论会话编排功能\n使用提问工具'])('preserves the native slash invocation with context %j', (context) => {
    const chip = {
      command: '/grill-with-docs',
      label: 'grill-with-docs',
      kind: 'agent_skill' as const,
      source: 'skill',
    }
    const result = dispatchCommandChip([chip], context)
    const direct = resolveDirectSlash(`/grill-with-docs ${context}`)

    expect(direct.chip).toBeDefined()
    expect(result.prompt).toBe(dispatchCommandChip([direct.chip!], context).prompt)
    expect(result.prompt).toBe(context ? `/grill-with-docs ${context}` : '/grill-with-docs')
    expect(result.displayLabel).toBe(`/cmd:"grill-with-docs":agent_skill:skill${context ? ` ${context}` : ''}`)
  })
})
