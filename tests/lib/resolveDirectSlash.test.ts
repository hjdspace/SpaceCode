import { describe, it, expect } from 'vitest'
import { resolveDirectSlash } from '@/lib/message-input-logic'

describe('resolveDirectSlash — 直接输入斜杠命令解析', () => {
  it('非斜杠开头的输入不处理', () => {
    expect(resolveDirectSlash('普通消息').action).toBe('not_slash')
  })

  it('immediate 命令（如 /clear）返回 immediate_command', () => {
    const result = resolveDirectSlash('/clear')
    expect(result.action).toBe('immediate_command')
  })

  it('sdk 命令 /goal 识别为 insert_chip 且 chip 信息完整', () => {
    const result = resolveDirectSlash('/goal fix all tests')

    expect(result.action).toBe('insert_chip')
    expect(result.chip).toMatchObject({
      command: '/goal',
      label: 'goal',
      kind: 'sdk_command',
    })
  })

  it('未知命令（技能名）也生成 chip，由上层决定路由', () => {
    const result = resolveDirectSlash('/some-skill arg')

    expect(result.action).toBe('insert_chip')
    expect(result.chip!.label).toBe('some-skill')
  })

  it('chip.label 与命令首 token 一致 — 参数提取的基础', () => {
    // ChatInput.handleSend 依赖 `content.slice(1 + chip.label.length)` 提取参数，
    // 此测试锁定 label 与首 token 长度一致的约定。
    for (const input of ['/goal fix all tests', '/some-skill arg']) {
      const result = resolveDirectSlash(input)!
      const firstToken = input.slice(1).split(/\s+/)[0]
      expect(result.chip!.label).toBe(firstToken)
      expect(input.slice(1 + result.chip!.label.length).trim()).toBe(
        input.slice(1 + firstToken.length).trim()
      )
    }
  })

  it('/goal fix all tests 的参数提取结果为 "fix all tests"', () => {
    const result = resolveDirectSlash('/goal fix all tests')!
    const commandName = result.chip!.label
    const commandArgs = '/goal fix all tests'.slice(1 + commandName.length).trim()
    expect(commandArgs).toBe('fix all tests')
  })
})
