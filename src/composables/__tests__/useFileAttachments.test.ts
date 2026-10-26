import { beforeEach, describe, expect, it, vi } from 'vitest'

// useFileAttachments — 附件状态 / 去重 / 菜单 / 浏览文件对话框
// 纯函数直接 import 验证（与模块真实导出对齐，取代手抄实现的旧测试）

const selectFilesMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/electronAPI', () => ({
  api: { selectFiles: selectFilesMock },
}))

import { buildRelativePath, isDuplicateAttachment, useFileAttachments } from '../useFileAttachments'
import type { Attachment } from '../types'

describe('buildRelativePath — 纯函数', () => {
  it('有 workingDirectory 时剥离前缀与首部分隔符', () => {
    expect(buildRelativePath('/home/user/project', '/home/user/project/src/file.ts')).toBe('src/file.ts')
  })

  it('Windows 路径剥离前缀', () => {
    expect(buildRelativePath('C:\\project', 'C:\\project\\src\\file.ts')).toBe('src\\file.ts')
  })

  it('无 workingDirectory 时回退为 basename（POSIX）', () => {
    expect(buildRelativePath(undefined, '/some/path/file.ts')).toBe('file.ts')
  })

  it('无 workingDirectory 时回退为 basename（Windows）', () => {
    expect(buildRelativePath(undefined, 'C:\\some\\path\\file.ts')).toBe('file.ts')
  })

  it('workingDirectory 出现在路径中间时按 replace 首次出现语义处理', () => {
    // 锁定现状：替换第一个出现的片段，再剥掉开头的分隔符
    expect(buildRelativePath('/home/u', '/x/home/u/file.ts')).toBe('x/file.ts')
  })

  it('纯文件名不带 workingDirectory 时原样返回', () => {
    expect(buildRelativePath(undefined, 'file.ts')).toBe('file.ts')
  })
})

describe('isDuplicateAttachment — 纯函数', () => {
  const files: Attachment[] = [
    { name: 'a.ts', path: '/a.ts', isFolder: false },
    { name: 'b.ts', path: '/b.ts', isFolder: true },
  ]

  it('已存在路径返回 true', () => {
    expect(isDuplicateAttachment(files, '/a.ts')).toBe(true)
  })

  it('新路径返回 false', () => {
    expect(isDuplicateAttachment(files, '/c.ts')).toBe(false)
  })

  it('空列表返回 false', () => {
    expect(isDuplicateAttachment([], '/a.ts')).toBe(false)
  })
})

describe('useFileAttachments — composable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('addFile：新路径返回 true、追加并触发 onInsertChip', () => {
    const onInsertChip = vi.fn()
    const { addFile, attachedFiles } = useFileAttachments({ onInsertChip })

    expect(addFile('file.ts', '/path/file.ts', false)).toBe(true)
    expect(attachedFiles.value).toEqual([{ name: 'file.ts', path: '/path/file.ts', isFolder: false }])
    expect(onInsertChip).toHaveBeenCalledWith('file.ts', '/path/file.ts', false)
  })

  it('addFile：重复路径返回 false、不追加、不触发回调', () => {
    const onInsertChip = vi.fn()
    const { addFile, attachedFiles } = useFileAttachments({ onInsertChip })

    expect(addFile('a.ts', '/a.ts', false)).toBe(true)
    expect(addFile('a2.ts', '/a.ts', false)).toBe(false)
    expect(attachedFiles.value).toHaveLength(1)
    expect(onInsertChip).toHaveBeenCalledTimes(1)
  })

  it('未提供 onInsertChip 时安全跳过回调', () => {
    const { addFile } = useFileAttachments()
    expect(addFile('a.ts', '/a.ts', false)).toBe(true)
  })

  it('addUploadedFile：以 basename 命名、标记 source=upload，且不插入内联 chip', () => {
    const onInsertChip = vi.fn()
    const { addUploadedFile, attachedFiles } = useFileAttachments({ onInsertChip })

    expect(addUploadedFile('D:\\docs\\ask-matt.md')).toBe(true)
    expect(attachedFiles.value).toEqual([
      { name: 'ask-matt.md', path: 'D:\\docs\\ask-matt.md', isFolder: false, source: 'upload' },
    ])
    expect(onInsertChip).not.toHaveBeenCalled()
  })

  it('addUploadedFile：重复路径返回 false 且不追加', () => {
    const { addUploadedFile, attachedFiles } = useFileAttachments()

    expect(addUploadedFile('/a.md')).toBe(true)
    expect(addUploadedFile('/a.md')).toBe(false)
    expect(attachedFiles.value).toHaveLength(1)
  })

  it('addUploadedFilesFromDialog：多选逐个加入，取消时无操作', async () => {
    const { addUploadedFilesFromDialog, attachedFiles } = useFileAttachments()

    selectFilesMock.mockResolvedValue({ canceled: true, filePaths: ['/a.md'] })
    await expect(addUploadedFilesFromDialog()).resolves.toBe(0)
    expect(attachedFiles.value).toEqual([])

    selectFilesMock.mockResolvedValue({ canceled: false, filePaths: ['/a.md', '/nested/b.ts'] })
    await expect(addUploadedFilesFromDialog()).resolves.toBe(2)
    expect(attachedFiles.value.map(f => f.name)).toEqual(['a.md', 'b.ts'])
  })

  it('removeFile 按路径移除附件', () => {
    const { addUploadedFile, removeFile, attachedFiles } = useFileAttachments()
    addUploadedFile('/a.md')
    addUploadedFile('/b.md')

    removeFile('/a.md')

    expect(attachedFiles.value.map(f => f.path)).toEqual(['/b.md'])
  })

  it('clearFiles 清空附件列表', () => {
    const { addFile, clearFiles, attachedFiles } = useFileAttachments()
    addFile('a.ts', '/a.ts', false)
    clearFiles()
    expect(attachedFiles.value).toEqual([])
  })

  it('handleAddClick 在开/关之间切换，closeAttachmentMenu 强制关闭', () => {
    const { handleAddClick, closeAttachmentMenu, showAttachmentMenu } = useFileAttachments()

    expect(showAttachmentMenu.value).toBe(false)
    handleAddClick()
    expect(showAttachmentMenu.value).toBe(true)
    handleAddClick()
    expect(showAttachmentMenu.value).toBe(false)

    showAttachmentMenu.value = true
    closeAttachmentMenu()
    expect(showAttachmentMenu.value).toBe(false)
  })

  it('handleBrowseFiles：取消选择时无操作', async () => {
    selectFilesMock.mockResolvedValue({ canceled: true, filePaths: ['/a.ts'] })
    const { handleBrowseFiles, attachedFiles } = useFileAttachments()

    await handleBrowseFiles()

    expect(attachedFiles.value).toEqual([])
  })

  it('handleBrowseFiles：空路径列表时无操作', async () => {
    selectFilesMock.mockResolvedValue({ canceled: false, filePaths: [] })
    const { handleBrowseFiles, attachedFiles } = useFileAttachments()

    await handleBrowseFiles()

    expect(attachedFiles.value).toEqual([])
  })

  it('handleBrowseFiles：成功时逐个添加并用 workingDirectory 派生显示名', async () => {
    selectFilesMock.mockResolvedValue({
      canceled: false,
      filePaths: ['D:/proj/src/a.ts', 'D:/proj/readme.md'],
    })
    const onInsertChip = vi.fn()
    const { handleBrowseFiles, attachedFiles } = useFileAttachments({
      workingDirectory: () => 'D:/proj',
      onInsertChip,
    })

    await handleBrowseFiles()

    expect(attachedFiles.value.map(f => f.name)).toEqual(['src/a.ts', 'readme.md'])
    expect(attachedFiles.value.every(f => !f.isFolder)).toBe(true)
    expect(onInsertChip).toHaveBeenCalledTimes(2)
  })

  it('handleBrowseFiles：无 workingDirectory 时显示名为 basename', async () => {
    selectFilesMock.mockResolvedValue({ canceled: false, filePaths: ['/x/y/deep/file.ts'] })
    const { handleBrowseFiles, attachedFiles } = useFileAttachments()

    await handleBrowseFiles()

    expect(attachedFiles.value[0].name).toBe('file.ts')
  })

  it('handleBrowseFiles：api 抛错时被捕获、不产生未处理 rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    selectFilesMock.mockRejectedValue(new Error('dialog boom'))
    const { handleBrowseFiles, attachedFiles } = useFileAttachments()

    await expect(handleBrowseFiles()).resolves.toBeUndefined()
    expect(attachedFiles.value).toEqual([])

    errorSpy.mockRestore()
  })
})
