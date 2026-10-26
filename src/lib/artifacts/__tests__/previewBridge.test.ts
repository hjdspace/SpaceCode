/**
 * 预览桥的宿主侧闸门（Issue #62）：密钥 → 动作白名单 → payload/协议。
 * 纯函数用例不碰 DOM，拒绝路径在这里钉死。
 */
import { describe, it, expect } from 'vitest'
import {
  PREVIEW_MAX_TEXT_CHARS,
  createPreviewNonce,
  parsePreviewOutbound,
} from '../previewBridge'

const NONCE = 'nonce-1'

describe('密钥闸门', () => {
  it('缺少 nonce 或 nonce 不匹配一律丢弃', () => {
    expect(parsePreviewOutbound({ type: 'od:sandbox:ready' }, NONCE)).toBeNull()
    expect(parsePreviewOutbound({ type: 'od:sandbox:ready', nonce: 'other' }, NONCE)).toBeNull()
    expect(parsePreviewOutbound({ type: 'od:sandbox:alert', nonce: 'other', message: 'x' }, NONCE)).toBeNull()
  })

  it('每次创建的密钥都不同', () => {
    expect(createPreviewNonce()).not.toBe(createPreviewNonce())
  })
})

describe('动作白名单', () => {
  it('ready / alert / confirm / open / error 被放行', () => {
    expect(parsePreviewOutbound({ type: 'od:sandbox:ready', nonce: NONCE }, NONCE)).toEqual({ type: 'ready' })
    expect(parsePreviewOutbound({ type: 'od:sandbox:alert', nonce: NONCE, message: 'hi' }, NONCE))
      .toEqual({ type: 'alert', message: 'hi' })
    expect(parsePreviewOutbound({ type: 'od:sandbox:confirm', nonce: NONCE, message: 'ok?' }, NONCE))
      .toEqual({ type: 'confirm', message: 'ok?' })
    expect(parsePreviewOutbound({ type: 'od:sandbox:open', nonce: NONCE, url: 'https://a.dev' }, NONCE))
      .toEqual({ type: 'open', url: 'https://a.dev' })
  })

  it('未知 type 与非对象一律丢弃', () => {
    for (const data of [
      { type: 'od:unknown', nonce: NONCE },
      { type: 'genui:action', nonce: NONCE },
      { nonce: NONCE },
      null,
      'text',
      [1, 2, 3],
    ]) {
      expect(parsePreviewOutbound(data, NONCE)).toBeNull()
    }
  })

  it('alert / confirm 只接受限长字符串', () => {
    expect(parsePreviewOutbound({ type: 'od:sandbox:alert', nonce: NONCE, message: 42 }, NONCE)).toBeNull()
    const tooLong = 'x'.repeat(PREVIEW_MAX_TEXT_CHARS + 1)
    expect(parsePreviewOutbound({ type: 'od:sandbox:alert', nonce: NONCE, message: tooLong }, NONCE)).toBeNull()
  })

  it('error 归一化消息、文件与行号', () => {
    expect(parsePreviewOutbound({
      type: 'od:sandbox:error',
      nonce: NONCE,
      message: 'boom',
      filename: 'app.js',
      lineno: 12,
    }, NONCE)).toEqual({ type: 'error', message: 'boom', filename: 'app.js', lineno: 12 })

    expect(parsePreviewOutbound({ type: 'od:sandbox:error', nonce: NONCE, message: 'boom' }, NONCE))
      .toEqual({ type: 'error', message: 'boom', filename: '', lineno: 0 })
  })
})

describe('外链协议', () => {
  it('只放行绝对 http / https', () => {
    expect(parsePreviewOutbound({ type: 'od:sandbox:open', nonce: NONCE, url: 'https://a.dev/x' }, NONCE))
      .toEqual({ type: 'open', url: 'https://a.dev/x' })

    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ms-settings:',
      '/relative',
      '',
    ]) {
      expect(parsePreviewOutbound({ type: 'od:sandbox:open', nonce: NONCE, url }, NONCE)).toBeNull()
    }
  })
})
