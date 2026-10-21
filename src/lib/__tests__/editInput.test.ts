import { describe, expect, it } from 'vitest'
import { extractEditParts, hasEditableParts } from '../editInput'

describe('extractEditParts', () => {
  it('Claude Code Edit：顶层 old_string/new_string 提取为一段', () => {
    const parts = extractEditParts({
      file_path: 'D:/repo/a.ts',
      old_string: 'const a = 1',
      new_string: 'const a = 2',
    })
    expect(parts).toEqual([{ old: 'const a = 1', new: 'const a = 2' }])
  })

  it('pi edit：edits[].oldText/newText 提取为一段（根治 +0 与"无变更可显示"）', () => {
    const parts = extractEditParts({
      path: 'D:/repo/tmp-cov-report.cjs',
      edits: [{ oldText: 'let x = 1', newText: 'let x = 2' }],
    })
    expect(parts).toEqual([{ old: 'let x = 1', new: 'let x = 2' }])
  })

  it('pi 多段编辑：edits[] 顺序保留', () => {
    const parts = extractEditParts({
      path: 'D:/repo/b.ts',
      edits: [
        { oldText: 'alpha', newText: 'ALPHA' },
        { oldText: 'beta', newText: 'BETA' },
      ],
    })
    expect(parts).toEqual([
      { old: 'alpha', new: 'ALPHA' },
      { old: 'beta', new: 'BETA' },
    ])
  })

  it('Claude MultiEdit：edits[].old_string/new_string 同样识别', () => {
    const parts = extractEditParts({
      file_path: 'D:/repo/c.ts',
      edits: [
        { old_string: 'a', new_string: 'A' },
        { old_string: 'b', new_string: 'B' },
      ],
    })
    expect(parts).toEqual([
      { old: 'a', new: 'A' },
      { old: 'b', new: 'B' },
    ])
  })

  it('同一段同时带驼峰与下划线别名时，pi 的 oldText/newText 优先', () => {
    const parts = extractEditParts({
      edits: [{ oldText: 'pi-old', old_string: 'cc-old', newText: 'pi-new', new_string: 'cc-new' }],
    })
    expect(parts).toEqual([{ old: 'pi-old', new: 'pi-new' }])
  })

  it('old_string 为空串（新建文件形态）保留为空 old', () => {
    const parts = extractEditParts({ file_path: 'd.ts', old_string: '', new_string: 'whole file' })
    expect(parts).toEqual([{ old: '', new: 'whole file' }])
    expect(hasEditableParts(parts)).toBe(true)
  })

  it('无编辑字段时返回空数组', () => {
    expect(extractEditParts(undefined)).toEqual([])
    expect(extractEditParts(null)).toEqual([])
    expect(extractEditParts({ path: 'D:/repo/a.ts' })).toEqual([])
    expect(extractEditParts({ edits: [] })).toEqual([])
    expect(extractEditParts({ edits: ['not-an-object', null, 42] })).toEqual([])
  })

  it('字段类型不是字符串时按缺失处理（一侧缺失补空串，两侧缺失整段跳过）', () => {
    expect(extractEditParts({ old_string: 123, new_string: 'x' })).toEqual([{ old: '', new: 'x' }])
    expect(extractEditParts({ old_string: 123, new_string: 456 })).toEqual([])
    expect(extractEditParts({ edits: [{ oldText: true, newText: 'x' }] })).toEqual([{ old: '', new: 'x' }])
  })

  it('只带一侧字段时另一侧补空串', () => {
    expect(extractEditParts({ old_string: 'only-old' })).toEqual([{ old: 'only-old', new: '' }])
    expect(extractEditParts({ edits: [{ newText: 'only-new' }] })).toEqual([{ old: '', new: 'only-new' }])
  })
})

describe('hasEditableParts', () => {
  it('两端都是空串不算可渲染内容', () => {
    expect(hasEditableParts([])).toBe(false)
    expect(hasEditableParts([{ old: '', new: '' }])).toBe(false)
    expect(hasEditableParts([{ old: '', new: 'x' }])).toBe(true)
    expect(hasEditableParts([{ old: 'x', new: '' }])).toBe(true)
  })
})
