/**
 * buildOutgoingMessage 契约（T04 #74）：
 * 把「编辑器正文 + 附件 + displayLabel」映射成「引擎正文 / 气泡正文」。
 * 这份逻辑从 ChatPanel.handleSend 原样抽出 —— Super Agent Router 宿主复用同一份，
 * 保证 @ chip 序列化 marker 与附件引用格式和主聊天逐字一致（零副本）。
 */
import { describe, expect, it } from 'vitest'
import { buildOutgoingMessage } from '../composer-outgoing'
import type { AllAttachments } from '@/composables/types'

function files(source?: AllAttachments['files'][number]['source']): AllAttachments {
  return {
    files: [
      { path: 'D:/repo/a.png', name: 'a.png', isFolder: false, source },
      { path: 'D:/repo/src', name: 'src', isFolder: true },
    ],
    images: [],
  }
}

describe('buildOutgoingMessage', () => {
  it('纯文本：引擎正文与气泡正文一致，userContent 为 undefined', () => {
    const result = buildOutgoingMessage('你好', { files: [], images: [] })

    expect(result.messageContent).toBe('你好')
    expect(result.userContent).toBeUndefined()
  })

  it('upload/paste 附件在正文前追加 @"绝对路径" 引用，其余来源不追加', () => {
    const result = buildOutgoingMessage('看下这个', files('upload'))

    expect(result.messageContent.startsWith('@"D:/repo/a.png"')).toBe(true)
    expect(result.messageContent).toContain('看下这个')
    // 工作区内联 chip（无 source）不应产生 @"..." 引用
    expect(buildOutgoingMessage('x', files()).messageContent).not.toContain('@"')
  })

  it('文件与文件夹以 [File:...] / [Folder:...] 摘要块附在正文后', () => {
    const result = buildOutgoingMessage('Hi', files())

    expect(result.messageContent).toContain('[File: a.png]')
    expect(result.messageContent).toContain('[Folder: src]')
    expect(result.messageContent).toContain('Attachments:')
  })

  it('图片以 [Image:...] 摘要块附在正文后', () => {
    const attachments: AllAttachments = {
      files: [],
      images: [{ id: 'i1', name: 'shot.png', type: 'image', mimeType: 'image/png', previewUrl: '', data: '' }],
    }

    const result = buildOutgoingMessage('Hi', attachments)

    expect(result.messageContent).toContain('Images: [Image: shot.png]')
  })

  it('displayLabel 与引擎正文不同时作为气泡正文（userContent）', () => {
    const result = buildOutgoingMessage('展开后的长提示词', { files: [], images: [] }, {
      displayLabel: '/review',
    })

    expect(result.messageContent).toBe('展开后的长提示词')
    expect(result.userContent).toBe('/review')
  })

  it('有附件时气泡正文回退为用户原文，摘要块只进引擎正文', () => {
    const attachments: AllAttachments = {
      files: [{ path: 'D:/repo/a.png', name: 'a.png', isFolder: false }],
      images: [],
    }

    // displayLabel 恰好等于用户输入（常见于直接发送）：气泡显示干净的 "Hi"
    const result = buildOutgoingMessage('Hi', attachments, { displayLabel: 'Hi' })

    expect(result.messageContent).toContain('Attachments: [File: a.png]')
    expect(result.userContent).toBe('Hi')
  })

  it('只有附件没有文字时，摘要块成为正文主体', () => {
    const attachments: AllAttachments = {
      files: [{ path: 'D:/repo/a.png', name: 'a.png', isFolder: false, source: 'upload' }],
      images: [],
    }

    const result = buildOutgoingMessage('', attachments)

    expect(result.messageContent.startsWith('@"D:/repo/a.png"')).toBe(true)
    expect(result.messageContent).toContain('Attachments: [File: a.png]')
    expect(result.userContent).toBe('')
  })
})
