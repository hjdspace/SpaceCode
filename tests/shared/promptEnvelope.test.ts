import { describe, expect, it } from 'vitest'
import { parseEngineUserPrompt } from '@/shared/promptEnvelope'

describe('parseEngineUserPrompt', () => {
  it('剥掉 @"路径" 引用与末尾 Attachments 块，路径按出现顺序返回', () => {
    const raw = '@"C:\\Temp\\SpaceCode\\pasted\\pasted-1.txt" @"C:\\docs\\a.md" 这个是什么场景\n\nAttachments: [File: pasted-1.txt], [File: a.md]'
    const parsed = parseEngineUserPrompt(raw)

    expect(parsed.text).toBe('这个是什么场景')
    expect(parsed.fileRefs).toEqual([
      'C:\\Temp\\SpaceCode\\pasted\\pasted-1.txt',
      'C:\\docs\\a.md',
    ])
  })

  it('只有引用没有正文时返回空文本，但保留引用', () => {
    const parsed = parseEngineUserPrompt('@"C:\\Temp\\pasted-1.txt"\n\nAttachments: [File: pasted-1.txt]')

    expect(parsed.text).toBe('')
    expect(parsed.fileRefs).toEqual(['C:\\Temp\\pasted-1.txt'])
  })

  it('Images 块同样剥离，且不误删正文里的 Attachments 字样', () => {
    const parsed = parseEngineUserPrompt('说说 Attachments: 这个词\n\nImages: [Image: shot.png]')

    expect(parsed.text).toBe('说说 Attachments: 这个词')
    expect(parsed.fileRefs).toEqual([])
  })

  it('重复引用只保留一次', () => {
    const parsed = parseEngineUserPrompt('@"C:\\a.txt" @"C:\\a.txt" hi\n\nAttachments: [File: a.txt]')

    expect(parsed.fileRefs).toEqual(['C:\\a.txt'])
    expect(parsed.text).toBe('hi')
  })

  it('没有信封痕迹的普通文本原样返回', () => {
    const parsed = parseEngineUserPrompt('  普通问题 @file:"x"  ')

    expect(parsed.text).toBe('普通问题 @file:"x"')
    expect(parsed.fileRefs).toEqual([])
  })
})
