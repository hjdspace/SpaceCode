// @vitest-environment node
/**
 * 设计产物导出 PDF — 票 08：必须真实产出 .pdf，而不是打开文件夹假装成功。
 *
 * Chromium 打印本身不在单测覆盖范围（Electron 运行时行为），这里钉住的是
 * 可判定的那部分：取哪个 URL、产物落在哪、失败时隐藏窗口是否被回收。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => {
  const calls: { loaded: string[]; destroyed: number; printOptions: unknown[]; denied: unknown[] } = {
    loaded: [],
    destroyed: 0,
    printOptions: [],
    denied: [],
  }
  return {
    calls,
    pdf: Buffer.from('%PDF-1.4\n%%EOF\n'),
    failLoad: false,
    emptyPdf: false,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow {
    webContents = {
      setWindowOpenHandler: (handler: unknown) => {
        state.calls.denied.push(handler)
      },
      loadURL: async (url: string) => {
        if (state.failLoad) throw new Error('ERR_CONNECTION_REFUSED')
        state.calls.loaded.push(url)
      },
      executeJavaScript: async () => true,
      printToPDF: async (options: unknown) => {
        state.calls.printOptions.push(options)
        return state.emptyPdf ? Buffer.alloc(0) : state.pdf
      },
    }
    destroy() {
      state.calls.destroyed++
    }
  },
}))

const preview = vi.hoisted(() => ({ getPort: vi.fn(), start: vi.fn(), toPreviewUrl: vi.fn() }))
vi.mock('../../infra/previewServer', () => ({ previewServer: preview }))

import { exportPdf } from '../pdfExport'

let dir: string
let html: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'design-export-pdf-'))
  html = join(dir, 'index.html')
  writeFileSync(html, '<html><body>design</body></html>')
  state.calls.loaded.length = 0
  state.calls.destroyed = 0
  state.calls.printOptions.length = 0
  state.calls.denied.length = 0
  state.failLoad = false
  state.emptyPdf = false
  preview.getPort.mockReturnValue(4321)
  preview.start.mockResolvedValue(4321)
  preview.toPreviewUrl.mockReturnValue('http://127.0.0.1:4321/TOK/index.html')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('exportPdf', () => {
  it('在产物旁生成 .pdf，内容就是渲染结果', async () => {
    const output = await exportPdf(html)

    expect(output).toBe(join(dir, 'index.pdf'))
    expect(existsSync(output)).toBe(true)
    expect(readFileSync(output).equals(state.pdf)).toBe(true)
  })

  it('用预览服务器登记的工作区 URL 渲染，相对资源才命得中', async () => {
    await exportPdf(html)

    expect(preview.toPreviewUrl).toHaveBeenCalledWith(html)
    expect(state.calls.loaded).toEqual(['http://127.0.0.1:4321/TOK/index.html'])
  })

  it('预览服务器未启动时先启动它', async () => {
    preview.getPort.mockReturnValue(0)

    await exportPdf(html)

    expect(preview.start).toHaveBeenCalledOnce()
  })

  it('拿不到预览 URL 时退回 file:// 协议', async () => {
    preview.toPreviewUrl.mockReturnValue(null)

    await exportPdf(html)

    expect(state.calls.loaded).toEqual([expect.stringMatching(/^file:\/\//)])
  })

  it('保留背景色并按页面自身纸张设置排版', async () => {
    await exportPdf(html)

    expect(state.calls.printOptions[0]).toMatchObject({ printBackground: true, preferCSSPageSize: true })
  })

  it('渲染失败时报错并回收隐藏窗口', async () => {
    state.failLoad = true

    await expect(exportPdf(html)).rejects.toThrow('ERR_CONNECTION_REFUSED')
    expect(state.calls.destroyed).toBe(1)
  })

  it('产物不在盘上时直接报错，不去打印 404 页面', async () => {
    await expect(exportPdf(join(dir, 'gone.html'))).rejects.toThrow(/gone\.html/)
    expect(state.calls.loaded).toEqual([])
  })

  it('打印结果为空视为失败，不产出空文件', async () => {
    state.emptyPdf = true

    await expect(exportPdf(html)).rejects.toThrow(/empty document/)
    expect(existsSync(join(dir, 'index.pdf'))).toBe(false)
  })

  it('拒绝产物页面弹出的新窗口', async () => {
    await exportPdf(html)

    const handler = state.calls.denied[0] as () => unknown
    expect(typeof handler).toBe('function')
    expect(handler()).toEqual({ action: 'deny' })
  })

  it('成功后隐藏窗口被销毁', async () => {
    await exportPdf(html)

    expect(state.calls.destroyed).toBe(1)
  })
})
