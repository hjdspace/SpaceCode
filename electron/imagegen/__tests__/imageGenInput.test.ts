// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, parse } from 'path'
import { readInputImages, resolveWorkspaceInput } from '../imageGenInput'
import { MAX_IMAGE_BYTES } from '../imageGenDownload'

/** 完整签名的最小 PNG（8 字节魔数 + IHDR 首块），独立构造的已知良好字节。 */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x04, 0x00,
])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(8)])

let base: string
let root: string
let outside: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'spacecode-imagegen-input-'))
  root = join(base, 'workspace')
  outside = join(base, 'outside')
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

/** 探测本机能否创建符号链接（Windows 默认无权限）。不能则显式 skip，而非静默空跑假绿。 */
function detectSymlinkSupport(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'spacecode-symlink-probe-'))
  try {
    symlinkSync(join(probe, 'target'), join(probe, 'link'), 'file')
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}
const canSymlink = detectSymlinkSupport()

describe('resolveWorkspaceInput — 词法归属', () => {
  it('工作区内相对路径 → 返回真实路径', () => {
    writeFileSync(join(root, 'a.png'), 'x')
    expect(resolveWorkspaceInput(root, 'a.png')).toBe(join(root, 'a.png'))
  })

  it('工作区内绝对路径与嵌套子目录 → 放行', () => {
    mkdirSync(join(root, 'sub'), { recursive: true })
    writeFileSync(join(root, 'sub', 'b.png'), 'x')
    expect(resolveWorkspaceInput(root, join(root, 'sub', 'b.png'))).toBe(join(root, 'sub', 'b.png'))
    expect(resolveWorkspaceInput(root, 'sub/b.png')).toBe(join(root, 'sub', 'b.png'))
  })

  it('../ 越界 → 拒绝（仅规范化也不放行）', () => {
    writeFileSync(join(outside, 'secret.png'), 'x')
    expect(() => resolveWorkspaceInput(root, '../outside/secret.png')).toThrow(/outside/i)
  })

  it('工作区外的绝对路径 → 拒绝', () => {
    writeFileSync(join(outside, 'secret.png'), 'x')
    expect(() => resolveWorkspaceInput(root, join(outside, 'secret.png'))).toThrow(/outside/i)
  })

  it('不存在但位于工作区内的路径 → 归属放行（存在性由调用方读取时判定）', () => {
    expect(resolveWorkspaceInput(root, 'missing.png')).toBe(join(root, 'missing.png'))
  })

  it('工作区根是文件系统根（C:\ 或 /）→ 拒绝，等于放开整盘', () => {
    const fsRoot = parse(root).root
    expect(() => resolveWorkspaceInput(fsRoot, 'anything.png')).toThrow(/root/i)
  })
})

describe('resolveWorkspaceInput — 软链接逃逸', () => {
  it.skipIf(!canSymlink)('软链接指向工作区外文件 → 拒绝', () => {
    writeFileSync(join(outside, 'secret.png'), 'x')
    const link = join(root, 'link.png')
    symlinkSync(join(outside, 'secret.png'), link, 'file')
    expect(() => resolveWorkspaceInput(root, 'link.png')).toThrow(/outside/i)
  })

  it.skipIf(!canSymlink)('软链接指向工作区外目录，读取其中文件 → 拒绝', () => {
    writeFileSync(join(outside, 'secret.png'), 'x')
    const link = join(root, 'linkdir')
    symlinkSync(outside, link, 'dir')
    expect(() => resolveWorkspaceInput(root, 'linkdir/secret.png')).toThrow(/outside/i)
  })

  it.skipIf(!canSymlink)('软链接指向工作区内目标 → 放行并返回真实目标', () => {
    writeFileSync(join(root, 'real.png'), 'x')
    const link = join(root, 'link.png')
    symlinkSync(join(root, 'real.png'), link, 'file')
    expect(resolveWorkspaceInput(root, 'link.png')).toBe(join(root, 'real.png'))
  })
})

describe('readInputImages — 参考图字节与类型', () => {
  it('mime 由签名判定，扩展名撒谎也不影响；多张按输入顺序返回', async () => {
    // 故意把 PNG 字节命名成 .jpg：按扩展名判类型会把 mime 报错给供应商
    writeFileSync(join(root, 'liar.jpg'), PNG)
    writeFileSync(join(root, 'real.jpg'), JPEG)

    const images = await readInputImages(root, ['liar.jpg', 'real.jpg'])

    expect(images).toHaveLength(2)
    expect(images[0].mime).toBe('image/png')
    expect(images[0].bytes.equals(PNG)).toBe(true)
    expect(images[1].mime).toBe('image/jpeg')
    expect(images[1].bytes.equals(JPEG)).toBe(true)
  })

  it('WebP 收，GIF 与不是图片的字节一律拒', async () => {
    writeFileSync(join(root, 'ok.webp'), WEBP)
    expect((await readInputImages(root, ['ok.webp']))[0].mime).toBe('image/webp')

    writeFileSync(join(root, 'anim.gif'), GIF)
    writeFileSync(join(root, 'notes.png'), Buffer.from('just text, not an image'))
    writeFileSync(join(root, 'truncated.png'), PNG.subarray(0, 4))
    for (const name of ['anim.gif', 'notes.png', 'truncated.png']) {
      await expect(readInputImages(root, [name])).rejects.toThrow(/PNG, JPEG or WebP/i)
    }
  })

  it('一张不合格就整次拒绝，不悄悄少送一张', async () => {
    writeFileSync(join(root, 'good.png'), PNG)
    writeFileSync(join(root, 'bad.gif'), GIF)
    await expect(readInputImages(root, ['good.png', 'bad.gif'])).rejects.toThrow(/bad\.gif/)
  })

  it('文件不存在或指向目录 → 拒绝', async () => {
    await expect(readInputImages(root, ['ghost.png'])).rejects.toThrow(/ghost\.png/)
    mkdirSync(join(root, 'adir'), { recursive: true })
    await expect(readInputImages(root, ['adir'])).rejects.toThrow(/adir/)
  })

  it('越界路径 → 拒绝，不读工作区外的字节', async () => {
    writeFileSync(join(outside, 'secret.png'), PNG)
    await expect(readInputImages(root, ['../outside/secret.png'])).rejects.toThrow(/outside/i)
    await expect(readInputImages(root, [join(outside, 'secret.png')])).rejects.toThrow(/outside/i)
  })

  it.skipIf(!canSymlink)('软链接逃逸 → 拒绝，不读工作区外的字节', async () => {
    writeFileSync(join(outside, 'secret.png'), PNG)
    const link = join(root, 'link.png')
    symlinkSync(join(outside, 'secret.png'), link, 'file')
    await expect(readInputImages(root, ['link.png'])).rejects.toThrow(/outside/i)
  })

  it('超过单张字节上限 → 先量大小再拒绝，不整块读进内存', async () => {
    writeFileSync(join(root, 'huge.png'), Buffer.alloc(MAX_IMAGE_BYTES + 1))
    await expect(readInputImages(root, ['huge.png'])).rejects.toThrow(/limit/i)
  })
})