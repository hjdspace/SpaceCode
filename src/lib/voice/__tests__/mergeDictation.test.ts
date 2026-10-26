import { describe, expect, it } from 'vitest'
import { buildDictationAppend, mergeDictationText } from '../mergeDictation'

describe('mergeDictationText', () => {
  it('空快照直接写入终稿', () => {
    expect(mergeDictationText('', '你好')).toBe('你好')
    expect(buildDictationAppend('', '你好')).toBe('你好')
  })

  it('已有草稿后换行追加，不覆盖原内容', () => {
    expect(mergeDictationText('draft', 'final')).toBe('draft\nfinal')
    expect(mergeDictationText('你好', '世界')).toBe('你好\n世界')
  })

  it('草稿已以换行结尾时不再补额外空行', () => {
    expect(mergeDictationText('draft\n', 'final')).toBe('draft\nfinal')
    expect(mergeDictationText('draft\n\n', 'final')).toBe('draft\n\nfinal')
  })

  it('草稿已以空格结尾时直接接上', () => {
    expect(mergeDictationText('draft ', 'final')).toBe('draft final')
  })

  it('终稿首尾空白被裁掉', () => {
    expect(mergeDictationText('draft', '  final  ')).toBe('draft\nfinal')
    expect(buildDictationAppend('draft', '  final  ')).toBe('\nfinal')
  })

  it('终稿为空时原样保留草稿', () => {
    expect(mergeDictationText('draft', '')).toBe('draft')
    expect(mergeDictationText('draft', '   ')).toBe('draft')
    expect(buildDictationAppend('draft', '   ')).toBe('')
  })

  it('追加片段与合并结果一致', () => {
    const cases: Array<[string, string]> = [
      ['', 'hello'],
      ['draft', 'hello'],
      ['draft\n', 'hello'],
      ['draft ', 'hello'],
      ['draft', '   '],
    ]
    for (const [snapshot, final] of cases) {
      expect(snapshot + buildDictationAppend(snapshot, final)).toBe(
        mergeDictationText(snapshot, final),
      )
    }
  })
})
