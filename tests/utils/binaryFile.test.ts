/**
 * binaryFile util 测试 — 二进制文件扩展名判断。
 */
import { describe, it, expect } from 'vitest'
import { isBinaryFilePath } from '@/utils/binaryFile'

describe('isBinaryFilePath', () => {
  it('识别常见二进制扩展名', () => {
    expect(isBinaryFilePath('logo.png')).toBe(true)
    expect(isBinaryFilePath('archive.zip')).toBe(true)
    expect(isBinaryFilePath('doc.pdf')).toBe(true)
    expect(isBinaryFilePath('font.woff2')).toBe(true)
    expect(isBinaryFilePath('video.mp4')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(isBinaryFilePath('LOGO.PNG')).toBe(true)
    expect(isBinaryFilePath('Archive.ZIP')).toBe(true)
  })

  it('文本文件返回 false', () => {
    expect(isBinaryFilePath('src/app.ts')).toBe(false)
    expect(isBinaryFilePath('README.md')).toBe(false)
    expect(isBinaryFilePath('main.py')).toBe(false)
    expect(isBinaryFilePath('style.scss')).toBe(false)
  })

  it('Windows 反斜杠路径正常解析', () => {
    expect(isBinaryFilePath('C:\\project\\assets\\icon.ico')).toBe(true)
    expect(isBinaryFilePath('C:\\project\\src\\app.ts')).toBe(false)
  })

  it('无扩展名或点开头文件返回 false', () => {
    expect(isBinaryFilePath('Makefile')).toBe(false)
    expect(isBinaryFilePath('.gitignore')).toBe(false)
  })
})
