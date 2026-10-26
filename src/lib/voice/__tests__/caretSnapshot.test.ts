import { describe, expect, it } from 'vitest'
import { captureCaret, restoreCaret } from '../caretSnapshot'

function setupEditor(html: string): HTMLElement {
  const editor = document.createElement('div')
  editor.innerHTML = html
  document.body.appendChild(editor)
  return editor
}

describe('caretSnapshot', () => {
  it('捕获并恢复文本节点内的光标', () => {
    const editor = setupEditor('hello world')
    const text = editor.firstChild as Text
    const range = document.createRange()
    range.setStart(text, 5)
    range.collapse(true)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)

    const snapshot = captureCaret(editor)
    expect(snapshot).not.toBeNull()

    window.getSelection()!.removeAllRanges()
    restoreCaret(editor, snapshot!)

    const restored = window.getSelection()!
    expect(restored.rangeCount).toBe(1)
    expect(restored.getRangeAt(0).startContainer).toBe(editor.firstChild)
    expect(restored.getRangeAt(0).startOffset).toBe(5)
    editor.remove()
  })

  it('恢复嵌套元素里的光标', () => {
    const editor = setupEditor('<div>first</div><div><span>second</span></div>')
    const spanText = editor.querySelector('span')!.firstChild as Text
    const range = document.createRange()
    range.setStart(spanText, 3)
    range.collapse(true)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)

    const snapshot = captureCaret(editor)!
    expect(snapshot.path).toEqual([1, 0, 0])

    window.getSelection()!.removeAllRanges()
    restoreCaret(editor, snapshot)

    const restoredRange = window.getSelection()!.getRangeAt(0)
    expect(restoredRange.startContainer).toBe(spanText)
    expect(restoredRange.startOffset).toBe(3)
    editor.remove()
  })

  it('选区不在编辑器内时返回 null', () => {
    const editor = setupEditor('hello')
    const outside = document.createElement('div')
    outside.textContent = 'outside'
    document.body.appendChild(outside)

    const range = document.createRange()
    range.setStart(outside.firstChild as Text, 2)
    range.collapse(true)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)

    expect(captureCaret(editor)).toBeNull()
    editor.remove()
    outside.remove()
  })

  it('非法路径恢复时静默放弃', () => {
    const editor = setupEditor('hello')
    expect(() => restoreCaret(editor, { path: [9, 9], offset: 4 })).not.toThrow()
    editor.remove()
  })
})
