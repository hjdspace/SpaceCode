/**
 * resolveComposerSubmission 单元测试 —— 提交分支的完整矩阵。
 *
 * 这些分支抽取前只存在于 ChatInput.handleSend 里，必须挂载整个组件才够得着；
 * 下沉成纯函数后，每条分支在这里直接断言。ChatInput 侧的行为等价由
 * src/components/chat/__tests__/ChatInput.send.test.ts 兜住。
 */
import { describe, expect, it } from 'vitest'
import {
  composeSendContent,
  resolveComposerSubmission,
  stripChipMarkers,
  type ComposerSubmissionInput,
} from '@/lib/composer-submission'
import type { CommandChipData } from '@/lib/message-input-logic'
import type { AllAttachments } from '@/composables/types'

const noAttachments: AllAttachments = { files: [], images: [] }

function chip(command: string, kind: CommandChipData['kind'], source = 'builtin'): CommandChipData {
  return { command, label: command.replace(/^\//, ''), kind, source }
}

function input(overrides: Partial<ComposerSubmissionInput> = {}): ComposerSubmissionInput {
  return {
    content: 'hello',
    quoteBlock: '',
    attachments: noAttachments,
    chips: [],
    isSending: false,
    steerMode: false,
    disabled: false,
    menuOpen: false,
    hasContent: true,
    sessionId: 's1',
    ...overrides,
  }
}

describe('composeSendContent / stripChipMarkers', () => {
  it('引用块只在有正文时补一个空行', () => {
    expect(composeSendContent('note', '> a\n> b')).toBe('> a\n> b\n\nnote')
    expect(composeSendContent('', '> a')).toBe('> a')
    expect(composeSendContent('note', '')).toBe('note')
  })

  it('剥掉 chip marker 只留正文，多个 chip 全剥', () => {
    expect(stripChipMarkers('/cmd:"review":sdk_command:builtin fix tests')).toBe('fix tests')
    expect(stripChipMarkers('/cmd:"init":codepilot_command:builtin /cmd:"memory":codepilot_command:builtin extra')).toBe('extra')
    expect(stripChipMarkers('plain text')).toBe('plain text')
  })
})

describe('普通提交分支', () => {
  it('无 chip 无斜杠 → send，正文带引用前缀', () => {
    expect(resolveComposerSubmission(input({ quoteBlock: '> ctx' }))).toEqual({
      kind: 'send',
      content: '> ctx\n\nhello',
      attachments: noAttachments,
    })
  })

  it('disabled / 菜单开着 / 没有内容 → none', () => {
    expect(resolveComposerSubmission(input({ disabled: true }))).toEqual({ kind: 'none' })
    expect(resolveComposerSubmission(input({ menuOpen: true }))).toEqual({ kind: 'none' })
    expect(resolveComposerSubmission(input({ hasContent: false }))).toEqual({ kind: 'none' })
  })

  it('直接输入 immediate 命令 → slash，不带 displayLabel', () => {
    expect(resolveComposerSubmission(input({ content: '/help' }))).toEqual({
      kind: 'slash',
      command: 'help',
      args: '',
      attachments: noAttachments,
    })
  })

  it('直接输入 sdk 命令 → slash 带参数，不带 displayLabel', () => {
    expect(resolveComposerSubmission(input({ content: '/review fix tests' }))).toEqual({
      kind: 'slash',
      command: 'review',
      args: 'fix tests',
      attachments: noAttachments,
    })
  })

  it('直接输入未知命令 → 按 slash_command 展开后 send', () => {
    expect(resolveComposerSubmission(input({ content: '/not-a-command do it' }))).toEqual({
      kind: 'send',
      content: '/not-a-command do it',
      attachments: noAttachments,
      options: { displayLabel: '/cmd:"not-a-command":slash_command:builtin do it' },
    })
  })
})

describe('command chip 分支', () => {
  it('单枚 sdk chip → slash，displayLabel 是 marker + 正文', () => {
    expect(resolveComposerSubmission(input({
      content: '/cmd:"review":sdk_command:builtin fix tests',
      chips: [chip('/review', 'sdk_command')],
    }))).toEqual({
      kind: 'slash',
      command: 'review',
      args: 'fix tests',
      attachments: noAttachments,
      displayLabel: '/cmd:"review":sdk_command:builtin fix tests',
    })
  })

  it('单枚 immediate chip 且无正文 → displayLabel 只有 marker', () => {
    expect(resolveComposerSubmission(input({
      content: '/cmd:"help":immediate:builtin ',
      chips: [chip('/help', 'immediate')],
    }))).toEqual({
      kind: 'slash',
      command: 'help',
      args: '',
      attachments: noAttachments,
      displayLabel: '/cmd:"help":immediate:builtin',
    })
  })

  it('多枚 chip → 交给 dispatchCommandChip 展开成 send', () => {
    const decision = resolveComposerSubmission(input({
      content: '/cmd:"init":codepilot_command:builtin /cmd:"memory":codepilot_command:builtin extra ask',
      chips: [chip('/init', 'codepilot_command'), chip('/memory', 'codepilot_command')],
    }))

    expect(decision.kind).toBe('send')
    if (decision.kind !== 'send') return
    expect(decision.content).toContain('User context: extra ask')
    expect(decision.options).toEqual({ displayLabel: '/cmd:"init":codepilot_command:builtin extra ask' })
  })

  it('agent_skill chip 走 send，不当斜杠命令派发', () => {
    expect(resolveComposerSubmission(input({
      content: '/cmd:"tdd":agent_skill:user ',
      chips: [chip('/tdd', 'agent_skill', 'user')],
    }))).toEqual({
      kind: 'send',
      content: '/tdd',
      attachments: noAttachments,
      options: { displayLabel: '/cmd:"tdd":agent_skill:user' },
    })
  })
})

describe('AI 回复期间分支', () => {
  it('默认排队：priority 由调用方补，这里给出去重后的正文与摘要', () => {
    expect(resolveComposerSubmission(input({ isSending: true, content: 'queued' }))).toEqual({
      kind: 'queue',
      content: 'queued',
      attachments: noAttachments,
      displayLabel: 'queued',
    })
  })

  it('steerMode → 立即 send，不带 options', () => {
    expect(resolveComposerSubmission(input({ isSending: true, steerMode: true }))).toEqual({
      kind: 'send',
      content: 'hello',
      attachments: noAttachments,
    })
  })

  it('displayLabel 截断到 80 字符', () => {
    const long = 'x'.repeat(120)
    const decision = resolveComposerSubmission(input({ isSending: true, content: long }))
    expect(decision.kind === 'queue' && decision.displayLabel).toBe('x'.repeat(80))
  })

  it('空正文但有图片附件 → 仍然排队', () => {
    const images = [{ id: 'i1', name: 'a.png', type: 'image' as const, mimeType: 'image/png', previewUrl: '', data: '' }]
    expect(resolveComposerSubmission(input({ isSending: true, content: '', attachments: { files: [], images } }))).toEqual({
      kind: 'queue',
      content: '',
      attachments: { files: [], images },
      displayLabel: '',
    })
  })

  it('什么都没有 / 没有会话 id → none', () => {
    expect(resolveComposerSubmission(input({ isSending: true, content: '' }))).toEqual({ kind: 'none' })
    expect(resolveComposerSubmission(input({ isSending: true, sessionId: null }))).toEqual({ kind: 'none' })
  })

  it('回复期间不受 disabled 约束（仍可插话）', () => {
    expect(resolveComposerSubmission(input({ isSending: true, disabled: true, steerMode: true })).kind).toBe('send')
  })
})
