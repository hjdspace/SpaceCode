// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { detectImageFormat } from '../imageSignatures'

/** 独立构造的已知良好字节头，不复用被测实现的判定逻辑。 */
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // 完整 8 字节魔数
  0x00, 0x00, 0x00, 0x0d, // IHDR 块长度 = 13
  0x49, 0x48, 0x44, 0x52, // 'IHDR'
  0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00, // 1024x1024
  0x08, 0x06, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, // CRC 占位
])

describe('detectImageFormat — PNG', () => {
  it('完整魔数 + IHDR 首块标识 → png', () => {
    expect(detectImageFormat(PNG_HEADER)).toBe('png')
  })

  it('只有 4 字节魔数（旧实现会放行）→ 拒绝', () => {
    expect(detectImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })

  it('魔数完整但首块不是 IHDR → 拒绝', () => {
    const notIhdr = Buffer.concat([
      PNG_HEADER.subarray(0, 12),
      Buffer.from('TEXT', 'ascii'),
      PNG_HEADER.subarray(16),
    ])
    expect(detectImageFormat(notIhdr)).toBeNull()
  })

  it('魔数完整但在 IHDR 标识前被截断 → 拒绝', () => {
    expect(detectImageFormat(PNG_HEADER.subarray(0, 12))).toBeNull()
  })
})

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, // SOI + APP0 标记起始
  0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, // JFIF 头片段
  0x01, 0x02, 0x03,
  0xff, 0xd9, // EOI 结束标记
])

describe('detectImageFormat — JPEG', () => {
  it('起始 FFD8FF + 结束 FFD9 → jpg', () => {
    expect(detectImageFormat(JPEG)).toBe('jpg')
  })

  it('起始正确但缺结束标记（半张图）→ 拒绝', () => {
    expect(detectImageFormat(JPEG.subarray(0, JPEG.length - 2))).toBeNull()
  })

  it('只有起始标记被截断 → 拒绝', () => {
    expect(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull()
  })

  it('有结束标记但起始不是 FFD8FF → 拒绝', () => {
    const badStart = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e]), JPEG.subarray(3)])
    expect(detectImageFormat(badStart)).toBeNull()
  })
})

const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]), // 容器长度占位
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00]),
])

describe('detectImageFormat — WebP / 拒绝项', () => {
  it('RIFF 容器 + WEBP 标识 → webp', () => {
    expect(detectImageFormat(WEBP)).toBe('webp')
  })

  it('RIFF 容器但不是 WEBP（如 WAVE）→ 拒绝', () => {
    const wave = Buffer.concat([WEBP.subarray(0, 8), Buffer.from('WAVE', 'ascii'), WEBP.subarray(12)])
    expect(detectImageFormat(wave)).toBeNull()
  })

  it('GIF89a 头 → 拒绝（本期不收 GIF）', () => {
    const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([0x01, 0x00, 0x01, 0x00])])
    expect(detectImageFormat(gif)).toBeNull()
  })

  it('HTML 错误页 → 拒绝', () => {
    expect(detectImageFormat(Buffer.from('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>'))).toBeNull()
  })

  it('空字节与过短输入 → 拒绝', () => {
    expect(detectImageFormat(Buffer.alloc(0))).toBeNull()
    expect(detectImageFormat(Buffer.from([0x89]))).toBeNull()
  })
})