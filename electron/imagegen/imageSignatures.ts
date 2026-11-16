/**
 * 图片字节签名校验 —— 客户端（下载/解码后的产物）与落盘层共用同一套判定。
 *
 * 供应商响应一律按不受信输入处理：扩展名不可信，只看完整签名。
 *  - PNG：完整 8 字节魔数 + 首块标识 IHDR（只验 4 字节魔数会把截断/伪造头放行）。
 *  - JPEG：起始标记 FFD8FF + 结束标记 FFD9（缺尾的半张图不算 JPEG）。
 *  - WebP：RIFF 容器 + WEBP 标识。
 *  - GIF 刻意不收（ADR 0019）：不在本期支持的产物格式里。
 *
 * 零 fs、零 electron：纯字节判定，可独立测试。
 */

export type ImageFormat = 'png' | 'jpg' | 'webp'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function detectImageFormat(bytes: Buffer): ImageFormat | null {
  if (
    bytes.length >= 16 &&
    bytes.subarray(0, 8).equals(PNG_MAGIC) &&
    bytes.subarray(12, 16).toString('ascii') === 'IHDR'
  ) {
    return 'png'
  }
  if (
    bytes.length >= 5 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  ) {
    return 'jpg'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}