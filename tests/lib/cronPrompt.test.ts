import { describe, it, expect } from 'vitest'
import { buildExecutionPrompt } from '@/lib/cronPrompt'

describe('buildExecutionPrompt', () => {
  it('图片标记还原成落盘路径引用', () => {
    const out = buildExecutionPrompt('看这张图 @image:"a1" 有什么问题', [
      { id: 'a1', name: 'shot.png', path: 'D:/proj/.claude/cron-attachments/a1.png' },
    ])
    expect(out).toBe('看这张图 @"D:/proj/.claude/cron-attachments/a1.png" 有什么问题')
  })

  it('清单里没有的图片标记直接丢掉', () => {
    expect(buildExecutionPrompt('前 @image:"gone" 后')).toBe('前  后')
  })

  it('技能标记还原成原生斜杠命令', () => {
    expect(buildExecutionPrompt('/cmd:"review":slash_command:builtin 最近的改动')).toBe(
      '/review 最近的改动',
    )
  })

  it('@file 与 @folder 标记保持原样（与主聊天一致）', () => {
    const text = '@file:"src/a.ts" @folder:"src" 说明'
    expect(buildExecutionPrompt(text)).toBe(text)
  })

  it('无附件时不报错并去掉首尾空白', () => {
    expect(buildExecutionPrompt('  纯文本提示词  ')).toBe('纯文本提示词')
  })
})
