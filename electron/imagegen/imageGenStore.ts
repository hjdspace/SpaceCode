/**
 * 生图产物落盘。写进工作区的 outputs/imagegen/ —— artifactsService 已在扫 outputs/，
 * 且该目录下的文件不受交付物扩展名过滤，所以图片会自动出现在产物面板。
 */
import { mkdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

/**
 * 扩展名由字节头判定：供应商默认格式各不相同，写死一种会名不副实。
 * GIF 刻意不收（ADR 0019）：它不在本期支持的产物格式里。
 */
function imageExtension(bytes: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(PNG_MAGIC)) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

/**
 * 宽高从字节里读，不信供应商的应答：OpenAI 的 /images/generations 根本不回尺寸，
 * 而报「请求的尺寸」会在供应商忽略请求时说谎。读不出来返回 null，不编一个。
 */
export function imageDimensions(bytes: Buffer): string | null {
  if (bytes.length >= 24 && bytes.subarray(0, 4).equals(PNG_MAGIC)) {
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDimensions(bytes)
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return webpDimensions(bytes)
  }
  return null
}

/** WebP 把宽高按子编码放在三个不同位置，认不出来就返回 null。 */
function webpDimensions(bytes: Buffer): string | null {
  if (bytes.length < 30) return null
  const chunk = bytes.subarray(12, 16).toString('ascii')
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    return `${bytes.readUInt16LE(26) & 0x3fff}x${bytes.readUInt16LE(28) & 0x3fff}`
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21)
    return `${(bits & 0x3fff) + 1}x${((bits >> 14) & 0x3fff) + 1}`
  }
  if (chunk === 'VP8X') {
    return `${bytes.readUIntLE(24, 3) + 1}x${bytes.readUIntLE(27, 3) + 1}`
  }
  return null
}

/** JPEG 的宽高在 SOF 段里，前面可能垫着任意多个 APPn/COM 段，只能顺着段链走。 */
function jpegDimensions(bytes: Buffer): string | null {
  let pos = 2
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null
    const marker = bytes[pos + 1]
    if (marker === 0xff) {
      pos += 1
      continue
    }
    // 无载荷标记；SOS 之后是压缩数据，再走下去只会读到垃圾
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null
    const length = bytes.readUInt16BE(pos + 2)
    // SOF0..SOF15 里 C4(DHT)/C8(JPG)/CC(DAC) 不是帧头
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (pos + 9 > bytes.length) return null
      return `${bytes.readUInt16BE(pos + 7)}x${bytes.readUInt16BE(pos + 5)}`
    }
    if (length < 2) return null
    pos += 2 + length
  }
  return null
}

/** 提示来自模型，可能带路径分隔符或 ..：一律折成连字符，落点只由 root 决定。 */
function sanitizeImageName(hint: string | undefined): string {
  return (hint ?? '')
    .trim()
    .replace(/\.\./g, '-')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
}

/** index 是同一批里的序号（0 起）；文件名撞车再追加 -v2/-v3，绝不覆盖既有文件。 */
export async function saveImage(root: string, bytes: Buffer, nameHint?: string, index = 0): Promise<string> {
  const ext = imageExtension(bytes)
  if (!ext) throw new Error('Unsupported image format: expected PNG, JPEG or WebP bytes.')

  const dir = resolve(root, 'outputs', 'imagegen')
  await mkdir(dir, { recursive: true })
  const stem = sanitizeImageName(nameHint) || 'image'
  const base = index > 0 ? `${stem}-${index + 1}` : stem

  // 用 wx 而不是「先查存在再写」：查与写之间的窗口里另一个调用可能刚好落下同名文件。
  for (let version = 1; ; version += 1) {
    const target = join(dir, version === 1 ? `${base}.${ext}` : `${base}-v${version}.${ext}`)
    try {
      await writeFile(target, bytes, { flag: 'wx' })
      return target
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}