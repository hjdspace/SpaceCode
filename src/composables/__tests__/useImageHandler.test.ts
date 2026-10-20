import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// useImageHandler — 图片检测 / dataUrl 读取 / 本地路径图片 / 去重

const readFileAsBase64Mock = vi.hoisted(() => vi.fn())

vi.mock('@/services/electronAPI', () => ({
  api: { readFileAsBase64: readFileAsBase64Mock },
}))

import {
  createImageAttachment,
  isDuplicateFile,
  isDuplicateImage,
  isImageFile,
  useImageHandler,
} from '../useImageHandler'
import type { ImageAttachment } from '../types'

// 可控的假 FileReader，用于驱动 onload / onerror 两条路径
class StubFileReader {
  onload: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  result: string | null = null
  private fail = false
  constructor(fail = false) {
    this.fail = fail
  }
  readAsDataURL(): void {
    queueMicrotask(() => {
      if (this.fail) {
        this.onerror?.(new Error('stub read error'))
      } else {
        this.result = 'data:image/png;base64,STUB='
        this.onload?.(null)
      }
    })
  }
}

describe('纯函数', () => {
  it('isImageFile：image/* 为 true，其余与空串为 false', () => {
    expect(isImageFile('image/png')).toBe(true)
    expect(isImageFile('image/svg+xml')).toBe(true)
    expect(isImageFile('application/pdf')).toBe(false)
    expect(isImageFile('')).toBe(false)
  })

  it('createImageAttachment：字段形状正确', () => {
    const att = createImageAttachment({ name: 'a.png', type: 'image/png' }, 'data:...', 'id-1')
    expect(att).toEqual({
      id: 'id-1',
      name: 'a.png',
      type: 'image',
      mimeType: 'image/png',
      previewUrl: 'data:...',
      data: 'data:...',
    })
  })

  it('isDuplicateImage / isDuplicateFile 按标识判重', () => {
    const img: ImageAttachment = {
      id: 'i1', name: 'a.png', type: 'image', mimeType: 'image/png', previewUrl: '', data: '',
    }
    expect(isDuplicateImage([img], 'i1')).toBe(true)
    expect(isDuplicateImage([img], 'i2')).toBe(false)
    expect(isDuplicateFile([{ name: 'a.ts', path: '/a.ts', isFolder: false }], '/a.ts')).toBe(true)
    expect(isDuplicateFile([], '/a.ts')).toBe(false)
  })
})

describe('useImageHandler — composable', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'fixed-uuid') })
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('readImageAsDataUrl：真实 FileReader 成功解析 File 为 dataUrl', async () => {
    const { readImageAsDataUrl } = useImageHandler()
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'photo.png', { type: 'image/png' })

    const dataUrl = await readImageAsDataUrl(file)

    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('readImageAsDataUrl：FileReader 出错时 reject', async () => {
    vi.stubGlobal('FileReader', class extends StubFileReader {
      constructor() { super(true) }
    })
    const { readImageAsDataUrl } = useImageHandler()
    const file = new File([new Uint8Array([1])], 'broken.png', { type: 'image/png' })

    await expect(readImageAsDataUrl(file)).rejects.toThrow('stub read error')
  })

  it('handleImageFile：非图片文件 early-return，不读文件不回调', async () => {
    const onInsertChip = vi.fn()
    const { handleImageFile, attachedImages } = useImageHandler()
    const file = new File(['x'], 'doc.txt', { type: 'text/plain' })

    await handleImageFile(file, onInsertChip)

    expect(attachedImages.value).toEqual([])
    expect(onInsertChip).not.toHaveBeenCalled()
  })

  it('handleImageFile：成功推送附件并触发 chip 回调', async () => {
    const onInsertChip = vi.fn()
    const { handleImageFile, attachedImages } = useImageHandler()
    const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' })

    await handleImageFile(file, onInsertChip)

    expect(attachedImages.value).toHaveLength(1)
    const att = attachedImages.value[0]
    expect(att.id).toBe('fixed-uuid')
    expect(att.name).toBe('pic.png')
    expect(att.mimeType).toBe('image/png')
    expect(att.data).toMatch(/^data:/)
    expect(onInsertChip).toHaveBeenCalledWith(att)
  })

  it('handleImageFile：读取失败时被捕获，列表与回调不受影响', async () => {
    vi.stubGlobal('FileReader', class extends StubFileReader {
      constructor() { super(true) }
    })
    const onInsertChip = vi.fn()
    const { handleImageFile, attachedImages } = useImageHandler()
    const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' })

    await handleImageFile(file, onInsertChip)

    expect(attachedImages.value).toEqual([])
    expect(onInsertChip).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('readLocalImageAsDataUrl：api 返回数据时拼接 mime 前缀', async () => {
    readFileAsBase64Mock.mockResolvedValue('QmFzZTY0')
    const { readLocalImageAsDataUrl } = useImageHandler()

    await expect(readLocalImageAsDataUrl('D:/pics/photo.png')).resolves.toBe('data:image/png;base64,QmFzZTY0')
    expect(readFileAsBase64Mock).toHaveBeenCalledWith('D:/pics/photo.png')
  })

  it('readLocalImageAsDataUrl：api 返回 null 时抛 Need File object', async () => {
    readFileAsBase64Mock.mockResolvedValue(null)
    const { readLocalImageAsDataUrl } = useImageHandler()

    await expect(readLocalImageAsDataUrl('D:/pics/photo.png')).rejects.toThrow('Need File object')
  })

  it('readLocalImageAsDataUrl：api 抛错时同样抛 Need File object', async () => {
    readFileAsBase64Mock.mockRejectedValue(new Error('ipc gone'))
    const { readLocalImageAsDataUrl } = useImageHandler()

    await expect(readLocalImageAsDataUrl('D:/pics/photo.png')).rejects.toThrow('Need File object')
  })

  it('addImageFromPath：成功时以 basename 与探测到的 mime 推送并回调', async () => {
    const onInsertChip = vi.fn()
    const { addImageFromPath, attachedImages } = useImageHandler()
    readFileAsBase64Mock.mockResolvedValue('QQ==')

    await addImageFromPath('C:\\pics\\cat.PNG', onInsertChip)

    expect(attachedImages.value).toHaveLength(1)
    const att = attachedImages.value[0]
    expect(att.name).toBe('cat.PNG')
    expect(att.mimeType).toBe('image/png') // 扩展名小写化后命中 png
    expect(att.data).toBe('data:image/png;base64,QQ==')
    expect(onInsertChip).toHaveBeenCalledWith(att)
  })

  it('addImageFromPath：读取失败时被捕获、列表不变、不回调', async () => {
    const onInsertChip = vi.fn()
    const { addImageFromPath, attachedImages } = useImageHandler()
    readFileAsBase64Mock.mockResolvedValue(null)

    await addImageFromPath('D:/pics/dog.jpg', onInsertChip)

    expect(attachedImages.value).toEqual([])
    expect(onInsertChip).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('clearImages 清空图片列表', async () => {
    const { addImageFromPath, clearImages, attachedImages } = useImageHandler()
    readFileAsBase64Mock.mockResolvedValue('QQ==')
    await addImageFromPath('D:/a.png', vi.fn())

    clearImages()

    expect(attachedImages.value).toEqual([])
  })
})
