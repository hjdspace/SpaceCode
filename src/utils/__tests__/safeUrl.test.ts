import { describe, it, expect } from 'vitest'
import { isSafeExternalUrl } from '../safeUrl'

describe('isSafeExternalUrl — 外链协议闸门', () => {
  it('放行绝对 http / https', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://127.0.0.1:8080/x')).toBe(true)
  })

  it('拒绝 javascript / file / data / 相对地址与其他协议', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///C:/Windows/system32',
      'data:text/html,<script>alert(1)</script>',
      '/relative/path',
      '//example.com',
      'ftp://example.com',
      'mailto:a@b.c',
      '',
      42,
    ]) {
      expect(isSafeExternalUrl(url)).toBe(false)
    }
  })
})
