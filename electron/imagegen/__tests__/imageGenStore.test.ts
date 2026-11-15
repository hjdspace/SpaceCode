// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, basename, dirname } from 'path'
import { imageDimensions, saveImage } from '../imageGenStore'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'spacecode-imagegen-store-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('saveImage', () => {
  it('落到 outputs/imagegen 下，返回绝对路径，字节原样', async () => {
    const saved = await saveImage(root, PNG, 'hero')

    expect(saved).toBe(resolve(root, 'outputs', 'imagegen', 'hero.png'))
    expect(readFileSync(saved).equals(PNG)).toBe(true)
  })

  it('扩展名跟着字节走：jpeg 写 .jpg、webp 写 .webp', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])

    expect((await saveImage(root, jpeg, 'photo')).endsWith('photo.jpg')).toBe(true)
    expect((await saveImage(root, webp, 'shot')).endsWith('shot.webp')).toBe(true)
  })

  it('认不出格式就抛，不写一个假产物；GIF 不收', async () => {
    for (const bytes of [Buffer.from('not an image'), Buffer.alloc(0), Buffer.from('GIF89a....')]) {
      await expect(saveImage(root, bytes, 'x')).rejects.toThrow(/Unsupported image format/)
    }
    expect(existsSync(join(root, 'outputs', 'imagegen'))).toBe(false)
  })

  it('文件名按提示 sanitize：路径分隔符与 .. 进不了文件名，空白折成连字符', async () => {
    const escaped = await saveImage(root, PNG, '../../etc/passwd')
    expect(dirname(escaped)).toBe(resolve(root, 'outputs', 'imagegen'))
    expect(basename(escaped)).not.toContain('..')
    expect(basename(escaped)).not.toContain('/')

    const backslash = await saveImage(root, PNG, 'a\\b')
    expect(dirname(backslash)).toBe(resolve(root, 'outputs', 'imagegen'))

    expect(basename(await saveImage(root, PNG, '  hero  image  '))).toBe('hero-image.png')
  })

  it('没有 nameHint 或提示全是符号时用 image 兜底', async () => {
    expect(basename(await saveImage(root, PNG))).toBe('image.png')
    expect(basename(await saveImage(join(root, 'b'), PNG, '   '))).toBe('image.png')
  })

  it('同名已存在时追加 -v2/-v3，原文件一个字节都不动', async () => {
    const other = Buffer.concat([PNG, Buffer.from([3, 4])])
    const first = await saveImage(root, PNG, 'hero')
    const second = await saveImage(root, other, 'hero')
    const third = await saveImage(root, PNG, 'hero')

    expect(basename(second)).toBe('hero-v2.png')
    expect(basename(third)).toBe('hero-v3.png')
    expect(readFileSync(first).equals(PNG)).toBe(true)
    expect(readFileSync(second).equals(other)).toBe(true)
  })

  it('同主干不同格式不算冲突，两份并存', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9])
    const png = await saveImage(root, PNG, 'hero')
    const jpg = await saveImage(root, jpeg, 'hero')

    expect(basename(jpg)).toBe('hero.jpg')
    expect(readFileSync(png).equals(PNG)).toBe(true)
  })

  it('同一批里的序号各自成名，不互相覆盖', async () => {
    const first = await saveImage(root, PNG, 'hero', 0)
    const second = await saveImage(root, PNG, 'hero', 1)

    expect(basename(first)).toBe('hero.png')
    expect(basename(second)).toBe('hero-2.png')
    expect(existsSync(first)).toBe(true)
  })
})

/** 真 PNG 头：签名 + IHDR（宽高在 16/20 偏移），够解析器读，不需要完整像素数据。 */
function pngOf(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

/** 真 JPEG 头：SOI + 一个 APP0 段 + SOF0（宽高在段内 +5/+7），逼解析器真的走段链。 */
function jpegOf(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])
  const sof = Buffer.alloc(13)
  sof.writeUInt16BE(0xffc0, 0)
  sof.writeUInt16BE(11, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 1
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof])
}

/** WebP 的宽高按子编码放在不同位置：VP8 帧头、VP8L 位打包、VP8X 画布尺寸。 */
function webpOf(kind: 'lossy' | 'lossless' | 'extended', width: number, height: number): Buffer {
  const bytes = Buffer.alloc(40)
  bytes.write('RIFF', 0, 'ascii')
  bytes.write('WEBP', 8, 'ascii')
  if (kind === 'lossy') {
    bytes.write('VP8 ', 12, 'ascii')
    bytes[23] = 0x9d
    bytes[24] = 0x01
    bytes[25] = 0x2a
    bytes.writeUInt16LE(width, 26)
    bytes.writeUInt16LE(height, 28)
  } else if (kind === 'lossless') {
    bytes.write('VP8L', 12, 'ascii')
    bytes[20] = 0x2f
    bytes.writeUInt32LE(((height - 1) << 14) | (width - 1), 21)
  } else {
    bytes.write('VP8X', 12, 'ascii')
    bytes.writeUIntLE(width - 1, 24, 3)
    bytes.writeUIntLE(height - 1, 27, 3)
  }
  return bytes
}

describe('imageDimensions', () => {
  it('PNG 的宽高从 IHDR 读出来', () => {
    expect(imageDimensions(pngOf(1024, 1536))).toBe('1024x1536')
  })

  it('JPEG 跳过 APPn 段，在 SOF 里读宽高', () => {
    expect(imageDimensions(jpegOf(800, 600))).toBe('800x600')
  })

  it('WebP 三种编码都读得出宽高', () => {
    expect(imageDimensions(webpOf('lossy', 640, 480))).toBe('640x480')
    expect(imageDimensions(webpOf('lossless', 300, 200))).toBe('300x200')
    expect(imageDimensions(webpOf('extended', 2048, 1024))).toBe('2048x1024')
  })
})