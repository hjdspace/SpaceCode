/**
 * 斜杠命令的回复文案生成器（T04 #74）—— 从 ChatPanel 原样抽出，
 * 主聊天与 Super Agent Router 宿主共用同一份，保证 /help、/cost、/keybindings
 * 在两个宿主的输出逐字一致（零副本）。
 */
import { describe, expect, it } from 'vitest'
import { generateCostMessage, generateHelpMessage, generateKeybindingsMessage } from '../slashCommandMessages'

const t = (key: string) => `t(${key})`

describe('generateHelpMessage', () => {
  it('按 immediate / sdk / codepilot / 自定义技能四段组织，命令名带斜杠', () => {
    const message = generateHelpMessage(t)

    expect(message).toContain(`## t(chatPanel.helpTitle)`)
    expect(message).toContain('- **/help** — Show available commands and tips')
    expect(message).toContain('### t(chatPanel.helpSdk)')
    expect(message).toContain('### t(chatPanel.helpCodepilot)')
    expect(message).toContain('### t(chatPanel.helpCustomSkills)')
  })
})

describe('generateCostMessage', () => {
  it('无消息时给出空态文案', () => {
    const message = generateCostMessage([], t)

    expect(message).toContain('t(chatPanel.costTitle)')
    expect(message).toContain('t(chatPanel.costNoMessages)')
  })

  it('按 user/assistant 估算 token 并输出汇总表格', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(40) },      // 10 tokens
      { role: 'assistant', content: 'b'.repeat(80) }, // 20 tokens
    ]

    const message = generateCostMessage(messages as never, t)

    expect(message).toContain('| 10 |')
    expect(message).toContain('| 20 |')
    expect(message).toContain('**30**')
    expect(message).toContain('| 1 |')
  })
})

describe('generateKeybindingsMessage', () => {
  it('输出快捷键表格', () => {
    const message = generateKeybindingsMessage(t)

    expect(message).toContain('## t(chatPanel.keybindingsTitle)')
    expect(message).toContain('| Enter | t(chatPanel.keybindingsSendMessage) |')
  })
})
