import { describe, expect, it } from 'vitest'
import {
  PASTED_TEXT_CHAR_THRESHOLD,
  PASTED_TEXT_TITLE_MAX_LENGTH,
  shouldExternalizePaste,
  summarizePastedText,
} from '../pasteText'

describe('shouldExternalizePaste', () => {
  it('阈值以内保持行内插入', () => {
    expect(shouldExternalizePaste('a'.repeat(PASTED_TEXT_CHAR_THRESHOLD))).toBe(false)
  })

  it('超过阈值落盘为附件', () => {
    expect(shouldExternalizePaste('a'.repeat(PASTED_TEXT_CHAR_THRESHOLD + 1))).toBe(true)
  })
})

describe('summarizePastedText', () => {
  it('取首个非空行作为标题', () => {
    expect(summarizePastedText('\n\n  Failed Tests 9  \n细节...\n')).toBe('Failed Tests 9')
  })

  it('单行过长时截断并加省略号', () => {
    const summary = summarizePastedText('x'.repeat(PASTED_TEXT_TITLE_MAX_LENGTH + 20))

    expect(summary).toHaveLength(PASTED_TEXT_TITLE_MAX_LENGTH + 1)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('全空白文本返回空串，调用方回退到默认标题', () => {
    expect(summarizePastedText('\n   \r\n\t')).toBe('')
  })
})
