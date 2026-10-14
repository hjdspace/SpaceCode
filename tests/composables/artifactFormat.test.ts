import { describe, it, expect } from 'vitest'
import { iconFor, formatSize, isOfficePreviewPath, isHtmlPreviewPath } from '@/utils/artifactFormat'

describe('iconFor', () => {
  it('maps known extensions to emoji', () => {
    expect(iconFor('pptx')).toBe('📊')
    expect(iconFor('docx')).toBe('📝')
    expect(iconFor('xlsx')).toBe('📈')
    expect(iconFor('html')).toBe('🌐')
    expect(iconFor('pdf')).toBe('📄')
  })

  it('falls back to a generic icon for unknown extensions', () => {
    expect(iconFor('xyz')).toBe('📁')
    expect(iconFor('')).toBe('📁')
  })
})

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(512)).toBe('512 B')
  })
  it('formats kilobytes', () => {
    expect(formatSize(2048)).toBe('2.0 KB')
  })
  it('formats megabytes', () => {
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

// 这三个入口（聊天文件链接、产物汇总卡片、Artifacts 面板）靠这两个判断把
// 二进制办公文档送去 officecli 渲染，而不是按文本读进右侧面板显示乱码。
describe('isOfficePreviewPath', () => {
  it('recognises every office deliverable', () => {
    expect(isOfficePreviewPath('C:\\ws\\outputs\\考勤表.xlsx')).toBe(true)
    expect(isOfficePreviewPath('/ws/outputs/deck.pptx')).toBe(true)
    expect(isOfficePreviewPath('/ws/outputs/report.docx')).toBe(true)
    expect(isOfficePreviewPath('/ws/outputs/report.pdf')).toBe(true)
  })

  it('is case insensitive and works on bare filenames', () => {
    expect(isOfficePreviewPath('ATTENDANCE.XLSX')).toBe(true)
  })

  it('leaves text and web deliverables to other viewers', () => {
    expect(isOfficePreviewPath('/ws/index.html')).toBe(false)
    expect(isOfficePreviewPath('/ws/main.ts')).toBe(false)
    expect(isOfficePreviewPath('/ws/data.csv')).toBe(false)
    expect(isOfficePreviewPath('/ws/LICENSE')).toBe(false)
    expect(isOfficePreviewPath('')).toBe(false)
  })
})

describe('isHtmlPreviewPath', () => {
  it('recognises html and htm', () => {
    expect(isHtmlPreviewPath('/ws/outputs/page.html')).toBe(true)
    expect(isHtmlPreviewPath('C:\\ws\\PAGE.HTM')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isHtmlPreviewPath('/ws/outputs/考勤表.xlsx')).toBe(false)
    expect(isHtmlPreviewPath('/ws/page.tsx')).toBe(false)
  })
})
