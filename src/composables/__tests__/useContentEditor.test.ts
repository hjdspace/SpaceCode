/**
 * useContentEditor composable 测试（真实 import 被测模块）。
 *
 * 取代 tests/composables/useContentEditor.test.ts：旧文件手抄了纯函数实现，
 * 对模块是否可导入零敏感（AGENTS.md 明令禁止），且 composable 的 DOM 逻辑
 * （文本提取 / chip 插入 / 触发文本删除 / 退格删除 / 粘贴 / 光标管理）此前完全未覆盖。
 *
 * DOM 相关测试在 jsdom 下运行。document.execCommand 在 jsdom 中不存在，
 * 粘贴测试用 stub 替身并断言调用参数（真实行为：纯文本段交给浏览器默认插入）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import {
  useContentEditor,
  getMimeTypeFromFileName,
  parseMentionMarkers,
  serializeMentionChip,
  serializeImageChip,
  serializeCommandChip,
  serializeQuoteAttachments,
  hasMeaningfulContent,
  extractDisplayName,
  buildRelativePath,
  mergeComposerFiles,
} from '@/composables/useContentEditor'
import type { ImageAttachment } from '@/composables/types'

// ── 工具 ─────────────────────────────────────────────────────────

/** 挂一个编辑器到 body 并接到 composable 上。 */
function mountEditor(options?: { disabled?: () => boolean }) {
  const editor = document.createElement('div')
  editor.setAttribute('contenteditable', 'true')
  document.body.appendChild(editor)
  const c = useContentEditor(options)
  c.editorRef.value = editor
  return { editor, ...c }
}

/** 造一个 mention chip 元素（模拟 insertMentionChip 的产物结构）。 */
function makeMentionChip(opts: { path?: string; isFolder?: boolean; imageId?: string; text?: string } = {}) {
  const chip = document.createElement('span')
  chip.className = 'mention-chip'
  if (opts.imageId) chip.setAttribute('data-image-id', opts.imageId)
  if (opts.path) chip.setAttribute('data-path', opts.path)
  chip.setAttribute('data-is-folder', String(!!opts.isFolder))
  const name = document.createElement('span')
  name.className = 'chip-name'
  name.textContent = opts.text ?? ''
  chip.appendChild(name)
  return chip
}

/** 把光标收拢到 el 内容末尾。 */
function selectEnd(el: Node) {
  const sel = window.getSelection()!
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

function clearSelection() {
  window.getSelection()?.removeAllRanges()
}

/** stub 掉 jsdom 不存在的 document.execCommand，记录调用参数。 */
function stubExecCommand() {
  const calls: Array<{ cmd: string; value?: string }> = []
  ;(document as any).execCommand = vi.fn((cmd: string, _ui: boolean, value?: string) => {
    calls.push({ cmd, value })
    return true
  })
  return calls
}

function image(id = 'img-1'): ImageAttachment {
  return { id, name: `${id}.png`, type: 'image', mimeType: 'image/png', previewUrl: `blob:${id}`, data: 'base64data' }
}

beforeEach(() => {
  document.body.innerHTML = ''
  clearSelection()
})

afterEach(() => {
  delete (document as any).execCommand
  document.body.innerHTML = ''
  clearSelection()
})

// ── 纯函数 ───────────────────────────────────────────────────────

describe('纯函数：getMimeTypeFromFileName', () => {
  it.each([
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.gif', 'image/gif'],
    ['a.bmp', 'image/bmp'],
    ['a.webp', 'image/webp'],
    ['a.svg', 'image/svg+xml'],
    ['a.PNG', 'image/png'],
    ['a.JPg', 'image/jpeg'],
  ])('%s → %s', (file, expected) => {
    expect(getMimeTypeFromFileName(file)).toBe(expected)
  })

  it('未知扩展名与无扩展名都落到 png 兜底', () => {
    expect(getMimeTypeFromFileName('a.txt')).toBe('image/png')
    expect(getMimeTypeFromFileName('README')).toBe('image/png')
  })
})

describe('纯函数：parseMentionMarkers', () => {
  it('解析 file / folder / image 三种 marker', () => {
    const text = '@file:"src/a.ts" 前后文 @folder:"docs" @image:"img-1"'
    const markers = parseMentionMarkers(text)
    expect(markers.map(m => m.kind)).toEqual(['file', 'folder', 'image'])
    expect(markers.map(m => m.value)).toEqual(['src/a.ts', 'docs', 'img-1'])
    expect(markers[1].index).toBe(text.indexOf('@folder:'))
  })

  it('没有 marker 时返回空数组', () => {
    expect(parseMentionMarkers('no markers here')).toEqual([])
  })

  it('连续 marker 都能拿到', () => {
    expect(parseMentionMarkers('@file:"a" @file:"b"')).toHaveLength(2)
  })
})

describe('纯函数：序列化', () => {
  it('serializeMentionChip 区分文件与目录', () => {
    expect(serializeMentionChip('src/a.ts', false)).toBe('@file:"src/a.ts" ')
    expect(serializeMentionChip('docs', true)).toBe('@folder:"docs" ')
  })

  it('serializeImageChip', () => {
    expect(serializeImageChip('img-1')).toBe('@image:"img-1" ')
  })

  it('serializeCommandChip 剥掉前导斜杠', () => {
    expect(serializeCommandChip('deploy', 'slash_command', 'builtin')).toBe('/cmd:"deploy":slash_command:builtin ')
    expect(serializeCommandChip('/deploy', 'slash_command', 'builtin')).toBe('/cmd:"deploy":slash_command:builtin ')
    expect(serializeCommandChip('run', 'agent_skill', 'mcp')).toBe('/cmd:"run":agent_skill:mcp ')
  })

  it('serializeQuoteAttachments：逐行加 > 前缀，多条引用空行分隔', () => {
    expect(serializeQuoteAttachments([{ text: 'line1\nline2' }, { text: 'q2' }]))
      .toBe('> line1\n> line2\n\n> q2')
    expect(serializeQuoteAttachments([])).toBe('')
  })

  it('hasMeaningfulContent 只看 trim 后长度', () => {
    expect(hasMeaningfulContent(' x ')).toBe(true)
    expect(hasMeaningfulContent('   ')).toBe(false)
    expect(hasMeaningfulContent('')).toBe(false)
  })
})

describe('纯函数：路径处理', () => {
  it('extractDisplayName 取最后一段（Unix / Windows）', () => {
    expect(extractDisplayName('src/components/Foo.vue')).toBe('Foo.vue')
    expect(extractDisplayName('src\\components\\Foo.vue')).toBe('Foo.vue')
  })

  it('extractDisplayName：无分隔符与空串', () => {
    expect(extractDisplayName('a.ts')).toBe('a.ts')
    expect(extractDisplayName('')).toBe('')
  })

  it('buildRelativePath：无工作目录时退回 basename', () => {
    expect(buildRelativePath(undefined, '/repo/src/a.ts')).toBe('a.ts')
    expect(buildRelativePath(undefined, 'C:\\repo\\a.ts')).toBe('a.ts')
  })

  it('buildRelativePath：剥掉工作目录前缀', () => {
    expect(buildRelativePath('/repo', '/repo/src/a.ts')).toBe('src/a.ts')
    expect(buildRelativePath('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src\\a.ts')
  })

  it('buildRelativePath：路径不含工作目录时剥掉首部分隔符（现状行为）', () => {
    expect(buildRelativePath('/other', '/repo/a.ts')).toBe('repo/a.ts')
  })
})

// ── getEditorPlainText：编辑器文本提取 ──────────────────────────

describe('getEditorPlainText', () => {
  it('未挂载编辑器时返回空串', () => {
    const c = useContentEditor()
    expect(c.getEditorPlainText()).toBe('')
  })

  it('纯文本原样提取', () => {
    const h = mountEditor()
    h.editor.textContent = 'hello world'
    expect(h.getEditorPlainText()).toBe('hello world')
  })

  it('mention chip 还原为 marker（文件 / 目录 / 图片）', () => {
    const h = mountEditor()
    h.editor.appendChild(makeMentionChip({ path: 'src/a.ts', text: 'a.ts' }))
    h.editor.appendChild(makeMentionChip({ path: 'docs', isFolder: true, text: 'docs' }))
    h.editor.appendChild(makeMentionChip({ imageId: 'img-1', text: 'x.png' }))
    expect(h.getEditorPlainText())
      .toBe('@file:"src/a.ts" @folder:"docs" @image:"img-1" ')
  })

  it('既无 data-path 也无 data-image-id 的 chip 不产出内容', () => {
    const h = mountEditor()
    h.editor.appendChild(makeMentionChip({}))
    expect(h.getEditorPlainText()).toBe('')
  })

  it('command chip 还原为 /cmd marker，缺失属性落到默认值', () => {
    const h = mountEditor()

    const full = document.createElement('span')
    full.className = 'command-chip'
    full.setAttribute('data-command', '/deploy')
    full.setAttribute('data-kind', 'slash_command')
    full.setAttribute('data-source', 'builtin')

    const bare = document.createElement('span')
    bare.className = 'command-chip'
    bare.setAttribute('data-command', '')

    h.editor.appendChild(full)
    h.editor.appendChild(bare)
    expect(h.getEditorPlainText()).toBe('/cmd:"deploy":slash_command:builtin /cmd:"":slash_command:builtin ')
  })

  it('BR 转换行；嵌套 DIV 之间补换行（末尾不补）', () => {
    const h = mountEditor()
    h.editor.innerHTML = 'a<br>b'
    expect(h.getEditorPlainText()).toBe('a\nb')

    h.editor.innerHTML = '<div>one</div><div>two</div>'
    expect(h.getEditorPlainText()).toBe('one\ntwo')

    h.editor.innerHTML = '<div>solo</div>'
    expect(h.getEditorPlainText()).toBe('solo')
  })
})

// ── 编辑器内容管理 ───────────────────────────────────────────────

describe('setEditorContent / clearEditor', () => {
  it('setEditorContent 同步编辑器与 inputText', () => {
    const h = mountEditor()
    h.setEditorContent('hi')
    expect(h.editor.textContent).toBe('hi')
    expect(h.inputText.value).toBe('hi')
  })

  it('clearEditor 清空内容、重置高度并清 inputText', () => {
    const h = mountEditor()
    h.setEditorContent('hi')
    h.editor.style.height = '120px'

    h.clearEditor()

    expect(h.editor.innerHTML).toBe('')
    expect(h.editor.style.height).toBe('')
    expect(h.inputText.value).toBe('')
  })

  it('未挂载编辑器时两个方法都是 no-op', () => {
    const c = useContentEditor()
    expect(() => { c.setEditorContent('x'); c.clearEditor() }).not.toThrow()
    expect(c.inputText.value).toBe('')
  })
})

// ── chip 插入 ────────────────────────────────────────────────────

describe('insertMentionChip', () => {
  it('在光标处插入文件 chip，尾随空格，并同步 inputText', () => {
    const h = mountEditor()
    h.editor.textContent = 'hi '
    selectEnd(h.editor)

    h.insertMentionChip('a.ts', 'src/a.ts', false)

    const chip = h.editor.querySelector('.mention-chip')!
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('data-path')).toBe('src/a.ts')
    expect(chip.getAttribute('data-is-folder')).toBe('false')
    expect(chip.classList.contains('is-folder')).toBe(false)
    // chip 之后有一个 nbsp 文本节点；marker 序列化自带一个普通空格，加上 nbsp 共两个
    expect(chip.nextSibling?.nodeType).toBe(Node.TEXT_NODE)
    expect(chip.nextSibling?.textContent).toBe('\u00A0')
    expect(h.inputText.value).toBe('hi @file:"src/a.ts" \u00A0')
  })

  it('目录 chip 带 is-folder 类', () => {
    const h = mountEditor()
    selectEnd(h.editor)

    h.insertMentionChip('docs', 'docs', true)

    const chip = h.editor.querySelector('.mention-chip')!
    expect(chip.classList.contains('is-folder')).toBe(true)
    expect(chip.getAttribute('data-is-folder')).toBe('true')
    expect(h.inputText.value).toBe('@folder:"docs" \u00A0')
  })

  it('chip 的删除按钮点击后移除 chip 与尾随空格并回写 inputText', () => {
    const h = mountEditor()
    selectEnd(h.editor)
    h.insertMentionChip('a.ts', 'src/a.ts', false)

    const btn = h.editor.querySelector('.chip-delete-btn') as HTMLElement
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(h.editor.querySelector('.mention-chip')).toBeNull()
    expect(h.inputText.value).toBe('')
  })

  it('未挂载编辑器时 no-op', () => {
    const c = useContentEditor()
    expect(() => c.insertMentionChip('a.ts', 'src/a.ts', false)).not.toThrow()
    expect(c.inputText.value).toBe('')
  })
})

describe('insertCommandChip', () => {
  it('默认 kind/source，data-command 补前导斜杠', () => {
    const h = mountEditor()
    selectEnd(h.editor)

    h.insertCommandChip({ name: 'deploy' })

    const chip = h.editor.querySelector('.command-chip')!
    expect(chip.getAttribute('data-command')).toBe('/deploy')
    expect(chip.getAttribute('data-kind')).toBe('slash_command')
    expect(chip.getAttribute('data-source')).toBe('builtin')
    expect(chip.className).toBe('command-chip kind-slash_command source-builtin')
    expect(h.inputText.value).toBe('/cmd:"deploy":slash_command:builtin \u00A0')
  })

  it('显式 kind/source 决定类名与 marker', () => {
    const h = mountEditor()
    selectEnd(h.editor)

    h.insertCommandChip({ name: 'run', kind: 'agent_skill', source: 'mcp' })

    const chip = h.editor.querySelector('.command-chip')!
    expect(chip.className).toBe('command-chip kind-agent_skill source-mcp')
    expect(h.inputText.value).toBe('/cmd:"run":agent_skill:mcp \u00A0')
  })

  it('goal 命令带 is-goal 类；未知 source 回落到 builtin 图标', () => {
    const h = mountEditor()
    selectEnd(h.editor)

    h.insertCommandChip({ name: 'goal', source: 'weird' })

    const chip = h.editor.querySelector('.command-chip')!
    expect(chip.classList.contains('is-goal')).toBe(true)
    expect(chip.querySelector('.chip-source-icon')?.textContent).toBe('◎')
  })

  it('未挂载编辑器时 no-op', () => {
    const c = useContentEditor()
    expect(() => c.insertCommandChip({ name: 'x' })).not.toThrow()
  })
})

describe('insertImageChip', () => {
  it('有光标时在光标处插入，含缩略图与 data-image-id', () => {
    const h = mountEditor()
    selectEnd(h.editor)

    h.insertImageChip(image())

    const chip = h.editor.querySelector('.mention-chip.is-image')!
    expect(chip.getAttribute('data-image-id')).toBe('img-1')
    expect((chip.querySelector('img.chip-thumb') as HTMLImageElement).src).toBe('blob:img-1')
    expect(chip.querySelector('.chip-name')?.textContent).toBe('img-1.png')
    expect(h.inputText.value).toBe('@image:"img-1" \u00A0')
  })

  it('无光标时直接追加到编辑器末尾', () => {
    const h = mountEditor()
    clearSelection()

    h.insertImageChip(image())

    expect(h.editor.querySelectorAll('.mention-chip.is-image')).toHaveLength(1)
    expect(h.inputText.value).toBe('@image:"img-1" \u00A0')
  })

  it('缩略图点击派发 chip-image-preview 预览事件', () => {
    const h = mountEditor()
    selectEnd(h.editor)
    h.insertImageChip(image())

    const seen: any[] = []
    window.addEventListener('chip-image-preview', (e) => seen.push((e as CustomEvent).detail), { once: true })
    ;(h.editor.querySelector('img.chip-thumb') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(seen).toEqual([{ url: 'blob:img-1', name: 'img-1.png' }])
  })

  it('未挂载编辑器时 no-op', () => {
    const c = useContentEditor()
    expect(() => c.insertImageChip(image())).not.toThrow()
  })
})

// ── 触发文本删除 ─────────────────────────────────────────────────

describe('removeTriggerText', () => {
  it('删除单个文本节点内的触发词并把光标收拢到删除起点', () => {
    const h = mountEditor()
    h.editor.textContent = 'hello @fil'
    selectEnd(h.editor)

    h.removeTriggerText(6, 4) // '@fil'

    expect(h.editor.textContent).toBe('hello ')
    const sel = window.getSelection()!
    expect(sel.isCollapsed).toBe(true)
    expect(sel.getRangeAt(0).startOffset).toBe(6)
  })

  it('删除范围跨两个文本节点时逐段裁剪', () => {
    const h = mountEditor()
    const t1 = document.createTextNode('ab')
    const t2 = document.createTextNode('cd')
    h.editor.appendChild(t1)
    h.editor.appendChild(t2)
    selectEnd(h.editor)

    h.removeTriggerText(1, 2) // 'b' + 'c'

    expect(t1.textContent).toBe('a')
    expect(t2.textContent).toBe('d')
    const sel = window.getSelection()!
    expect(sel.getRangeAt(0).startContainer).toBe(t1)
    expect(sel.getRangeAt(0).startOffset).toBe(1)
  })

  it('length 超出剩余文本时删到节点末尾为止', () => {
    const h = mountEditor()
    h.editor.textContent = 'abc'
    selectEnd(h.editor)

    h.removeTriggerText(0, 100)

    expect(h.editor.textContent).toBe('')
  })

  it('triggerOffset 越界时不删除、不动光标', () => {
    const h = mountEditor()
    h.editor.textContent = 'abc'
    selectEnd(h.editor) // 元素级选区：(editor, childCount)

    h.removeTriggerText(50, 2)

    expect(h.editor.textContent).toBe('abc')
    const range = window.getSelection()!.getRangeAt(0)
    expect(range.startContainer).toBe(h.editor)
    expect(range.startOffset).toBe(1)
  })

  it('length 为 0 时无事发生', () => {
    const h = mountEditor()
    h.editor.textContent = 'abc'
    selectEnd(h.editor)

    h.removeTriggerText(0, 0)

    expect(h.editor.textContent).toBe('abc')
  })

  it('未挂载编辑器时 no-op', () => {
    const c = useContentEditor()
    expect(() => c.removeTriggerText(0, 3)).not.toThrow()
  })
})

// ── 退格删除 chip ────────────────────────────────────────────────

describe('handleBackspaceChip', () => {
  /** 组装 [chip, 尾随 nbsp] 并把光标放在 nbsp 偏移 0（即紧贴 chip 之后）。 */
  function editorWithChipBeforeCursor(h: ReturnType<typeof mountEditor>, chip: HTMLElement) {
    h.editor.appendChild(chip)
    h.editor.appendChild(document.createTextNode('\u00A0'))
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(h.editor.lastChild!, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  it('光标紧跟 mention chip：删掉 chip 与尾随空格，回报 path', () => {
    const h = mountEditor()
    editorWithChipBeforeCursor(h, makeMentionChip({ path: 'src/a.ts', text: 'a.ts' }))

    const ev = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true })
    const result = h.handleBackspaceChip(ev)

    expect(ev.defaultPrevented).toBe(true)
    expect(result).toEqual({ deleted: true, type: 'mention', path: 'src/a.ts', imageId: undefined })
    expect(h.editor.querySelector('.mention-chip')).toBeNull()
    expect(h.inputText.value).toBe('')
  })

  it('光标紧跟图片 chip：回报 imageId 而非 path', () => {
    const h = mountEditor()
    editorWithChipBeforeCursor(h, makeMentionChip({ imageId: 'img-1', text: 'x.png' }))

    const result = h.handleBackspaceChip(new KeyboardEvent('keydown', { cancelable: true }))

    expect(result).toEqual({ deleted: true, type: 'mention', path: undefined, imageId: 'img-1' })
  })

  it('光标紧跟 command chip：回报 type=command', () => {
    const h = mountEditor()
    const chip = document.createElement('span')
    chip.className = 'command-chip'
    chip.setAttribute('data-command', '/deploy')
    editorWithChipBeforeCursor(h, chip)

    const result = h.handleBackspaceChip(new KeyboardEvent('keydown', { cancelable: true }))

    expect(result).toEqual({ deleted: true, type: 'command' })
    expect(h.editor.querySelector('.command-chip')).toBeNull()
  })

  it('光标不在 chip 之后（普通文本中间）不拦截退格', () => {
    const h = mountEditor()
    h.editor.textContent = 'ab'
    selectEnd(h.editor)
    window.getSelection()!.getRangeAt(0).setStart(h.editor.firstChild!, 1)

    const ev = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true })
    expect(h.handleBackspaceChip(ev)).toEqual({ deleted: false })
    expect(ev.defaultPrevented).toBe(false)
  })

  it('选区未收拢时不拦截', () => {
    const h = mountEditor()
    editorWithChipBeforeCursor(h, makeMentionChip({ path: 'a.ts', text: 'a.ts' }))
    const sel = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(h.editor)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(h.handleBackspaceChip(new KeyboardEvent('keydown', { cancelable: true })))
      .toEqual({ deleted: false })
  })

  it('没有选区时不拦截', () => {
    const h = mountEditor()
    editorWithChipBeforeCursor(h, makeMentionChip({ path: 'a.ts', text: 'a.ts' }))
    clearSelection()

    expect(h.handleBackspaceChip(new KeyboardEvent('keydown', { cancelable: true })))
      .toEqual({ deleted: false })
  })

  it('chip 前面的节点是普通文本时不拦截', () => {
    const h = mountEditor()
    h.editor.appendChild(document.createTextNode('x'))
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(h.editor, 1)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(h.handleBackspaceChip(new KeyboardEvent('keydown', { cancelable: true })))
      .toEqual({ deleted: false })
  })

  it('chip 后面的兄弟不是 nbsp 时只删 chip 本身', () => {
    const h = mountEditor()
    h.editor.appendChild(makeMentionChip({ path: 'a.ts', text: 'a.ts' }))
    const keep = document.createTextNode('keep')
    h.editor.appendChild(keep)
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(h.editor, 1)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    const result = h.handleBackspaceChip(new KeyboardEvent('keydown', { cancelable: true }))

    expect(result).toMatchObject({ deleted: true, type: 'mention' })
    expect(keep.textContent).toBe('keep')
  })
})

// ── 内容判定与收集 ───────────────────────────────────────────────

describe('hasContent / collectMentions / collectAllAttachments', () => {
  it('inputText 非空即有内容', () => {
    const h = mountEditor()
    h.inputText.value = 'x'
    expect(h.hasContent([], [])).toBe(true)
  })

  it('inputText 为空但 attachedFiles 非空也是 true', () => {
    const h = mountEditor()
    expect(h.hasContent([{ name: 'a', path: 'a.ts', isFolder: false }], [])).toBe(true)
  })

  it('editor 里有可见文本也是 true', () => {
    const h = mountEditor()
    h.editor.textContent = 'raw'
    expect(h.hasContent([], [])).toBe(true)
  })

  it('editor 里只有空名 chip 时靠 chip 计数判定', () => {
    const h = mountEditor()
    h.editor.appendChild(document.createElement('span')).className = 'mention-chip'
    expect(h.hasContent([], [])).toBe(true)
  })

  it('全空时 false；未挂载编辑器时同样 false', () => {
    const h = mountEditor()
    expect(h.hasContent([], [])).toBe(false)

    const bare = useContentEditor()
    expect(bare.hasContent([], [])).toBe(false)
  })

  it('collectMentions 从 chip 上收集 name/path/isFolder', () => {
    const h = mountEditor()
    h.editor.appendChild(makeMentionChip({ path: 'src/a.ts', text: 'a.ts' }))
    h.editor.appendChild(makeMentionChip({ path: 'docs', isFolder: true, text: 'docs' }))

    expect(h.collectMentions()).toEqual([
      { name: 'a.ts', path: 'src/a.ts', isFolder: false },
      { name: 'docs', path: 'docs', isFolder: true },
    ])
  })

  it('collectAllAttachments 合并 mention 与图片附件', () => {
    const h = mountEditor()
    h.editor.appendChild(makeMentionChip({ path: 'a.ts', text: 'a.ts' }))
    const imgs = [image()]

    expect(h.collectAllAttachments([], imgs)).toEqual({
      files: [{ name: 'a.ts', path: 'a.ts', isFolder: false }],
      images: imgs,
    })
  })

  it('collectAllAttachments 并入上传卡片附件，忽略残留的工作区附件', () => {
    const h = mountEditor()
    h.editor.appendChild(makeMentionChip({ path: 'a.ts', text: 'a.ts' }))
    const uploaded = { name: 'ask.md', path: '/ask.md', isFolder: false, source: 'upload' as const }
    const staleWorkspace = { name: 'legacy.ts', path: '/legacy.ts', isFolder: false }

    expect(h.collectAllAttachments([uploaded, staleWorkspace], []).files).toEqual([
      { name: 'a.ts', path: 'a.ts', isFolder: false },
      uploaded,
    ])
  })
})

describe('mergeComposerFiles — 纯函数', () => {
  const upload = { name: 'ask.md', path: '/ask.md', isFolder: false, source: 'upload' as const }

  it('同路径的 chip 与上传卡片只保留一份（chip 优先）', () => {
    const mention = { name: 'ask.md', path: '/ask.md', isFolder: false }
    expect(mergeComposerFiles([mention], [upload])).toEqual([mention])
  })

  it('工作区来源的附件不并进结果', () => {
    const workspace = { name: 'w.ts', path: '/w.ts', isFolder: false, source: 'workspace' as const }
    expect(mergeComposerFiles([], [workspace])).toEqual([])
  })

  it('粘贴落盘的附件随消息提交，标题与大小一并保留', () => {
    const pasted = {
      name: 'pasted-1.txt',
      path: '/tmp/SpaceCode/pasted/pasted-1.txt',
      isFolder: false,
      source: 'paste' as const,
      title: 'Failed Tests 9',
      sizeBytes: 14438,
    }
    expect(mergeComposerFiles([], [pasted])).toEqual([pasted])
  })
})

// ── 粘贴处理 ─────────────────────────────────────────────────────

describe('insertPastedTextWithMarkers / buildChipElementFromMarker', () => {
  it('纯 marker 文本逐个还原成 chip，并同步 inputText', () => {
    const calls = stubExecCommand()
    const h = mountEditor()
    selectEnd(h.editor)

    h.insertPastedTextWithMarkers('@file:"src/a.ts" @folder:"docs" ')

    const chips = h.editor.querySelectorAll('.mention-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0].getAttribute('data-path')).toBe('src/a.ts')
    expect(chips[1].classList.contains('is-folder')).toBe(true)
    expect(h.inputText.value).toBe('@file:"src/a.ts" @folder:"docs" ')
    // marker 正则不吞尾随空格：两个 marker 之间的空格与末尾空格都走 execCommand
    expect(calls.map(c => c.value)).toEqual([' ', ' '])
  })

  it('image marker 还原成 is-image chip（data-image-id + 缩略图）', () => {
    stubExecCommand()
    const h = mountEditor()
    selectEnd(h.editor)

    h.insertPastedTextWithMarkers('@image:"blob:img-9" ')

    const chip = h.editor.querySelector('.mention-chip.is-image')!
    expect(chip.getAttribute('data-image-id')).toBe('blob:img-9')
    expect((chip.querySelector('img.chip-thumb') as HTMLImageElement).src).toBe('blob:img-9')
  })

  it('带前后缀文本：纯文本段走 execCommand，marker 变 chip', () => {
    const calls = stubExecCommand()
    const h = mountEditor()
    selectEnd(h.editor)

    h.insertPastedTextWithMarkers('see @file:"a.ts" now')

    expect(calls.map(c => c.value)).toEqual(['see ', ' now'])
    expect(h.editor.querySelector('.mention-chip')).toBeTruthy()
    // execCommand 被 stub，纯文本没有真正进编辑器 —— inputText 只含 chip marker
    expect(h.inputText.value).toBe('@file:"a.ts" ')
  })

  it('无 marker 的纯文本只走 execCommand，不碰 inputText', () => {
    const calls = stubExecCommand()
    const h = mountEditor()
    selectEnd(h.editor)

    h.insertPastedTextWithMarkers('plain')

    expect(calls.map(c => c.value)).toEqual(['plain'])
    expect(h.inputText.value).toBe('')
  })

  it('空文本 no-op', () => {
    const calls = stubExecCommand()
    const h = mountEditor()
    h.insertPastedTextWithMarkers('')
    expect(calls).toHaveLength(0)
  })

  it('buildChipElementFromMarker：file / folder / image 三态', () => {
    const h = mountEditor()

    const fileChip = h.buildChipElementFromMarker('file', '/x/y/a.ts')
    expect(fileChip.className).toBe('mention-chip')
    expect(fileChip.getAttribute('data-path')).toBe('/x/y/a.ts')
    expect(fileChip.querySelector('.chip-name')?.textContent).toBe('a.ts')

    const folderChip = h.buildChipElementFromMarker('folder', 'docs')
    expect(folderChip.classList.contains('is-folder')).toBe(true)
    expect(folderChip.getAttribute('data-is-folder')).toBe('true')

    const imgChip = h.buildChipElementFromMarker('image', 'blob:img-1')
    expect(imgChip.className).toBe('mention-chip is-image')
    expect(imgChip.getAttribute('data-image-id')).toBe('blob:img-1')
    expect((imgChip.querySelector('img.chip-thumb') as HTMLImageElement).src).toBe('blob:img-1')
    expect(imgChip.querySelector('.chip-name')?.textContent).toBe('blob:img-1')

    expect(fileChip.querySelector('.chip-delete-btn')).toBeTruthy()
  })
})

// ── 光标与焦点 ───────────────────────────────────────────────────

describe('光标与焦点', () => {
  it('getCursorOffset / getTextBeforeCursor 报告光标前的文本长度', () => {
    const h = mountEditor()
    h.editor.textContent = 'hello'
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(h.editor.firstChild!, 3)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(h.getTextBeforeCursor()).toBe('hel')
    expect(h.getCursorOffset()).toBe(3)
  })

  it('没有选区时 getTextBeforeCursor 返回空串', () => {
    const h = mountEditor()
    h.editor.textContent = 'hello'
    clearSelection()

    expect(h.getTextBeforeCursor()).toBe('')
    expect(h.getCursorOffset()).toBe(0)
  })

  it('setCursorToEnd 把光标挪到内容末尾', () => {
    const h = mountEditor()
    h.editor.textContent = 'hello'
    clearSelection()

    h.setCursorToEnd()

    expect(h.getCursorOffset()).toBe(5)
  })

  it('focusEditor 默认聚焦并确保存在光标', async () => {
    const h = mountEditor()
    h.editor.textContent = 'hi'
    clearSelection()

    h.focusEditor()
    await nextTick()

    expect(document.activeElement).toBe(h.editor)
    // jsdom 的 focus() 会自己在开头放一个收拢选区；真实浏览器里则是
    // setCursorToEnd 补一个 —— 两者共同契约是"有光标"，偏移位置因环境而异。
    expect(window.getSelection()!.rangeCount).toBeGreaterThanOrEqual(1)
  })

  it('disabled() 为 true 时不抢焦点', async () => {
    const h = mountEditor({ disabled: () => true })

    h.focusEditor()
    await nextTick()

    expect(document.activeElement).not.toBe(h.editor)
  })
})

// ── 自适应高度 ───────────────────────────────────────────────────

describe('autoResize', () => {
  it('高度跟随内容并在 200px 封顶', () => {
    const h = mountEditor()

    Object.defineProperty(h.editor, 'scrollHeight', { value: 100, configurable: true })
    h.autoResize()
    expect(h.editor.style.height).toBe('100px')

    Object.defineProperty(h.editor, 'scrollHeight', { value: 300, configurable: true })
    h.autoResize()
    expect(h.editor.style.height).toBe('200px')
  })

  it('未挂载编辑器时 no-op', () => {
    const c = useContentEditor()
    expect(() => c.autoResize()).not.toThrow()
  })
})
