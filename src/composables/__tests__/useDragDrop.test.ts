import { describe, expect, it, vi } from 'vitest'

// useDragDrop — 拖放内容检测 / 数据提取 / 拖拽状态机
// 模块不依赖 electronAPI，纯 Vue ref + 事件对象，直接 import 验证

import { extractDropData, hasDragContent, useDragDrop } from '../useDragDrop'

describe('hasDragContent — 纯函数', () => {
  it('包含 x-claude-path 类型即判定可拖放', () => {
    expect(hasDragContent(['application/x-claude-path'], [])).toBe(true)
  })

  it('Files 类型且存在图片文件时判定可拖放', () => {
    expect(hasDragContent(['Files'], [{ type: 'image/png' }])).toBe(true)
  })

  it('Files 类型但无图片文件时不可拖放', () => {
    expect(hasDragContent(['Files'], [{ type: 'text/plain' }])).toBe(false)
  })

  it('两者皆无时不可拖放', () => {
    expect(hasDragContent([], [])).toBe(false)
    expect(hasDragContent(['text/plain'], [{ type: 'text/plain' }])).toBe(false)
  })
})

describe('extractDropData — 纯函数', () => {
  function fakeDataTransfer(map: Record<string, string>, files: Array<{ type: string; name: string }> = []) {
    return {
      getData: (type: string) => map[type] ?? '',
      files,
    }
  }

  it('claudePath 命中时返回 tree-path，name 取 basename、isFolder 由类型决定', () => {
    const out = extractDropData(fakeDataTransfer({
      'application/x-claude-path': 'D:/proj/src/components',
      'application/x-claude-type': 'directory',
    }))
    expect(out).toEqual({ type: 'tree-path', path: 'D:/proj/src/components', isFolder: true, name: 'components' })
  })

  it('tree-path：Windows 分隔符 basename 与非目录类型', () => {
    const out = extractDropData(fakeDataTransfer({
      'application/x-claude-path': 'D:\\proj\\a.ts',
      'application/x-claude-type': 'file',
    }))
    expect(out).toEqual({ type: 'tree-path', path: 'D:\\proj\\a.ts', isFolder: false, name: 'a.ts' })
  })

  it('tree-path：类型缺省时 isFolder 为 false', () => {
    const out = extractDropData(fakeDataTransfer({ 'application/x-claude-path': '/x/y' }))
    expect(out).toEqual({ type: 'tree-path', path: '/x/y', isFolder: false, name: 'y' })
  })

  it('无 claudePath 但有图片文件时返回 image-files（过滤非图片）', () => {
    const files = [
      { type: 'image/png', name: 'a.png' },
      { type: 'text/plain', name: 'b.txt' },
      { type: 'image/jpeg', name: 'c.jpg' },
    ]
    const out = extractDropData(fakeDataTransfer({}, files))
    expect(out).toEqual({ type: 'image-files', files: [files[0], files[2]] })
  })

  it('既无 claudePath 也无图片文件时返回 null', () => {
    expect(extractDropData(fakeDataTransfer({}))).toBeNull()
    expect(extractDropData(fakeDataTransfer({}, [{ type: 'text/plain', name: 'b.txt' }]))).toBeNull()
  })
})

describe('useDragDrop — 事件处理', () => {
  const RECT = { left: 10, top: 10, right: 110, bottom: 60 } as DOMRect

  function fakeDragEvent(opts: {
    types?: string[]
    files?: Array<{ type: string; name: string }>
    getData?: (type: string) => string
    clientX?: number
    clientY?: number
    withDataTransfer?: boolean
  }) {
    const withDataTransfer = opts.withDataTransfer ?? true
    return {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: opts.clientX ?? 0,
      clientY: opts.clientY ?? 0,
      dataTransfer: withDataTransfer
        ? {
            types: opts.types ?? [],
            files: opts.files ?? [],
            getData: opts.getData ?? (() => ''),
          }
        : undefined,
    } as unknown as DragEvent
  }

  it('handleDragEnter：可拖放内容时置位并阻止默认行为', () => {
    const { handleDragEnter, isDragging } = useDragDrop()
    const e = fakeDragEvent({ types: ['application/x-claude-path'] })

    handleDragEnter(e)

    expect(isDragging.value).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
  })

  it('handleDragEnter：不可拖放内容时不置位', () => {
    const { handleDragEnter, isDragging } = useDragDrop()
    const e = fakeDragEvent({ types: ['text/plain'], files: [{ type: 'text/plain', name: 'b.txt' }] })

    handleDragEnter(e)

    expect(isDragging.value).toBe(false)
  })

  it('handleDragOver：Files + 图片文件时置位', () => {
    const { handleDragOver, isDragging } = useDragDrop()
    const e = fakeDragEvent({ types: ['Files'], files: [{ type: 'image/png', name: 'a.png' }] })

    handleDragOver(e)

    expect(isDragging.value).toBe(true)
  })

  it('handleDragLeave：指针仍在容器内时保持拖拽状态', () => {
    const { handleDragEnter, handleDragLeave, isDragging } = useDragDrop()
    handleDragEnter(fakeDragEvent({ types: ['application/x-claude-path'] }))

    handleDragLeave(fakeDragEvent({ clientX: 50, clientY: 30 }), RECT)

    expect(isDragging.value).toBe(true)
  })

  it.each([
    ['left', 5, 30],
    ['right', 115, 30],
    ['top', 50, 5],
    ['bottom', 50, 65],
  ])('handleDragLeave：越过 %s 边界时清除拖拽状态', (_edge, x, y) => {
    const { handleDragEnter, handleDragLeave, isDragging } = useDragDrop()
    handleDragEnter(fakeDragEvent({ types: ['application/x-claude-path'] }))

    handleDragLeave(fakeDragEvent({ clientX: x, clientY: y }), RECT)

    expect(isDragging.value).toBe(false)
  })

  it('handleDrop：返回 tree-path 数据并复位拖拽状态', () => {
    const { handleDragOver, handleDrop, isDragging } = useDragDrop()
    handleDragOver(fakeDragEvent({ types: ['application/x-claude-path'] }))

    const e = fakeDragEvent({
      getData: (t) => (t === 'application/x-claude-path' ? 'D:/proj/file.md' : t === 'application/x-claude-type' ? 'file' : ''),
    })
    const out = handleDrop(e)

    expect(out).toEqual({ type: 'tree-path', path: 'D:/proj/file.md', isFolder: false, name: 'file.md' })
    expect(isDragging.value).toBe(false)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('handleDrop：返回 image-files 数据并复位拖拽状态', () => {
    const { handleDragOver, handleDrop, isDragging } = useDragDrop()
    handleDragOver(fakeDragEvent({ types: ['Files'], files: [{ type: 'image/png', name: 'a.png' }] }))

    const out = handleDrop(fakeDragEvent({ files: [{ type: 'image/png', name: 'a.png' }] }))

    expect(out).toEqual({ type: 'image-files', files: [{ type: 'image/png', name: 'a.png' }] })
    expect(isDragging.value).toBe(false)
  })

  it('handleDrop：无可拖放数据时返回 null', () => {
    const { handleDrop } = useDragDrop()
    expect(handleDrop(fakeDragEvent({}))).toBeNull()
  })

  it('handleDrop：dataTransfer 缺失时返回 null 且不抛错', () => {
    const { handleDragOver, handleDrop, isDragging } = useDragDrop()
    handleDragOver(fakeDragEvent({ types: ['application/x-claude-path'] }))

    expect(handleDrop(fakeDragEvent({ withDataTransfer: false }))).toBeNull()
    expect(isDragging.value).toBe(false)
  })
})
