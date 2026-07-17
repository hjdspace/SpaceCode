import { describe, it, expect } from 'vitest'
import {
  resolveImagePath,
  getImageMimeType,
  toDataUrl,
  isRemoteUrl
} from '@/utils/markdownImagePath'

describe('markdownImagePath', () => {
  describe('isRemoteUrl', () => {
    it('识别 http/https/ftp/data/blob/file 协议为远程/内联 URL', () => {
      expect(isRemoteUrl('https://example.com/a.png')).toBe(true)
      expect(isRemoteUrl('http://example.com/a.png')).toBe(true)
      expect(isRemoteUrl('data:image/png;base64,xxxx')).toBe(true)
      expect(isRemoteUrl('blob:https://example.com/abc')).toBe(true)
      expect(isRemoteUrl('ftp://example.com/a.png')).toBe(true)
      expect(isRemoteUrl('file:///D:/a.png')).toBe(true)
    })

    it('相对路径与绝对路径返回 false', () => {
      expect(isRemoteUrl('./docs/a.png')).toBe(false)
      expect(isRemoteUrl('images/a.png')).toBe(false)
      expect(isRemoteUrl('D:/AI/a.png')).toBe(false)
      expect(isRemoteUrl('/home/user/a.png')).toBe(false)
      expect(isRemoteUrl('../a.png')).toBe(false)
    })

    it('空字符串与锚点返回 false', () => {
      expect(isRemoteUrl('')).toBe(false)
      expect(isRemoteUrl('#anchor')).toBe(false)
    })
  })

  describe('resolveImagePath', () => {
    it('远程/内联 URL 返回 null（无需处理）', () => {
      expect(resolveImagePath('D:/proj/README.md', 'https://a.com/b.png')).toBeNull()
      expect(resolveImagePath('D:/proj/README.md', 'data:image/png;base64,xx')).toBeNull()
      expect(resolveImagePath('D:/proj/README.md', 'blob:https://a.com/x')).toBeNull()
    })

    it('空 src 返回 null', () => {
      expect(resolveImagePath('D:/proj/README.md', '')).toBeNull()
      expect(resolveImagePath('D:/proj/README.md', '   ')).toBeNull()
    })

    it('锚点 src 返回 null', () => {
      expect(resolveImagePath('D:/proj/README.md', '#anchor')).toBeNull()
    })

    it('Windows 绝对路径直接返回（反斜杠）', () => {
      expect(resolveImagePath('D:/proj/README.md', 'D:\\proj\\docs\\a.png')).toBe('D:\\proj\\docs\\a.png')
    })

    it('Windows 绝对路径直接返回（正斜杠）', () => {
      expect(resolveImagePath('D:/proj/README.md', 'D:/proj/docs/a.png')).toBe('D:/proj/docs/a.png')
    })

    it('Unix 绝对路径直接返回', () => {
      expect(resolveImagePath('/home/user/README.md', '/home/user/docs/a.png')).toBe('/home/user/docs/a.png')
    })

    it('相对路径基于 markdown 文件目录解析（./ 前缀）', () => {
      expect(resolveImagePath('D:/proj/README.md', './docs/a.png')).toBe('D:/proj/docs/a.png')
    })

    it('相对路径基于 markdown 文件目录解析（无前缀）', () => {
      expect(resolveImagePath('D:/proj/README.md', 'docs/a.png')).toBe('D:/proj/docs/a.png')
    })

    it('相对路径基于 markdown 文件目录解析（Windows 反斜杠路径）', () => {
      expect(resolveImagePath('D:\\proj\\README.md', 'docs/a.png')).toBe('D:/proj/docs/a.png')
    })

    it('正确处理 ../ 上级目录引用', () => {
      expect(resolveImagePath('D:/proj/sub/README.md', '../images/a.png')).toBe('D:/proj/images/a.png')
    })

    it('正确处理多级 ../ 上级目录引用', () => {
      expect(resolveImagePath('D:/proj/a/b/README.md', '../../img/a.png')).toBe('D:/proj/img/a.png')
    })

    it('../ 不会越过根目录', () => {
      expect(resolveImagePath('D:/README.md', '../../a.png')).toBe('D:/a.png')
    })

    it('markdown 文件位于根目录时（无目录段）', () => {
      expect(resolveImagePath('README.md', './a.png')).toBe('a.png')
    })

    it('无 markdownFilePath 时相对路径返回 null', () => {
      expect(resolveImagePath(undefined, './docs/a.png')).toBeNull()
      expect(resolveImagePath('', 'docs/a.png')).toBeNull()
    })

    it('无 markdownFilePath 时绝对路径仍可返回', () => {
      expect(resolveImagePath(undefined, 'D:/proj/a.png')).toBe('D:/proj/a.png')
      expect(resolveImagePath(undefined, '/home/user/a.png')).toBe('/home/user/a.png')
    })
  })

  describe('getImageMimeType', () => {
    it('识别常见图片格式', () => {
      expect(getImageMimeType('a.png')).toBe('image/png')
      expect(getImageMimeType('a.jpg')).toBe('image/jpeg')
      expect(getImageMimeType('a.jpeg')).toBe('image/jpeg')
      expect(getImageMimeType('a.gif')).toBe('image/gif')
      expect(getImageMimeType('a.webp')).toBe('image/webp')
      expect(getImageMimeType('a.svg')).toBe('image/svg+xml')
      expect(getImageMimeType('a.bmp')).toBe('image/bmp')
      expect(getImageMimeType('a.ico')).toBe('image/x-icon')
      expect(getImageMimeType('a.avif')).toBe('image/avif')
    })

    it('大小写不敏感', () => {
      expect(getImageMimeType('a.PNG')).toBe('image/png')
      expect(getImageMimeType('a.Jpg')).toBe('image/jpeg')
    })

    it('未知扩展名回退到 image/png', () => {
      expect(getImageMimeType('a.xyz')).toBe('image/png')
      expect(getImageMimeType('a')).toBe('image/png')
    })

    it('带查询参数的路径', () => {
      expect(getImageMimeType('a.png?v=1')).toBe('image/png')
    })
  })

  describe('toDataUrl', () => {
    it('拼装 data URL', () => {
      expect(toDataUrl('image/png', 'abc123')).toBe('data:image/png;base64,abc123')
    })

    it('SVG mime 类型', () => {
      expect(toDataUrl('image/svg+xml', 'abc')).toBe('data:image/svg+xml;base64,abc')
    })
  })
})
