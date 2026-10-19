import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import PreviewPanel from '../PreviewPanel.vue'
import { useAppStore } from '@/stores/app'

/**
 * Screenshot mode over officecli's stacked page sheet (issue #41 / ticket 14).
 *
 * One IPC call returns a single PNG holding several pages on top of each other,
 * so the panel has to slice it with CSS, keep counting pages across chunks, and
 * still show a plain image when a sheet only carries one page.
 */

interface Sheet {
  path: string
  pageCount: number
  start: number
  end: number
  width: number
  height: number
}

const apiMocks = vi.hoisted(() => ({
  viewScreenshot: vi.fn(),
  viewHtml: vi.fn(),
  readImageAsDataURL: vi.fn(),
  watchStart: vi.fn(),
  watchStop: vi.fn(),
  onDownloadProgress: vi.fn(),
  openInEditor: vi.fn(),
  terminalOnExit: vi.fn(),
  artifactsOpen: vi.fn(),
  artifactsReveal: vi.fn(),
  artifactsChanged: vi.fn(),
  loadGuiSettings: vi.fn(),
  getEnv: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    officecli: {
      viewScreenshot: apiMocks.viewScreenshot,
      viewHtml: apiMocks.viewHtml,
      readImageAsDataURL: apiMocks.readImageAsDataURL,
      watchStart: apiMocks.watchStart,
      watchStop: apiMocks.watchStop,
      onDownloadProgress: apiMocks.onDownloadProgress,
    },
    artifacts: {
      open: apiMocks.artifactsOpen,
      reveal: apiMocks.artifactsReveal,
      onChanged: apiMocks.artifactsChanged,
    },
    openInEditor: apiMocks.openInEditor,
    terminal: { onExit: apiMocks.terminalOnExit },
    // app/settings store 在 setup 里就会读这两项，缺了会让挂载过程抛出未处理拒绝
    loadGuiSettings: apiMocks.loadGuiSettings,
    getEnv: apiMocks.getEnv,
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
  globalInjection: true,
})

const FILE = 'D:/docs/deck.pptx'

/** A sheet of `count` pages, each `bandHeight` tall. */
function sheet(start: number, count: number, pageCount: number, bandHeight = 720): Sheet {
  return {
    path: `D:/docs/deck.pptx.screenshots/deck-pages-${start}-${start + count - 1}.png`,
    pageCount,
    start,
    end: start + count - 1,
    width: 1280,
    height: bandHeight * count,
  }
}

async function mountInScreenshotMode() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  store.officePreviewMode = 'screenshots'
  const wrapper = mount(PreviewPanel, {
    props: { filePath: FILE },
    global: { plugins: [pinia, i18n] },
  })
  await wrapper.vm.$nextTick()
  return wrapper
}

/** 手动 settle 的 promise，用来制造"上一轮还没跑完"的交错时序 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.onDownloadProgress.mockReturnValue(() => {})
  apiMocks.artifactsChanged.mockReturnValue(() => {})
  apiMocks.loadGuiSettings.mockResolvedValue({ success: false })
  apiMocks.getEnv.mockResolvedValue({})
  apiMocks.readImageAsDataURL.mockResolvedValue('data:image/png;base64,AAAA')
})

describe('截图模式的分页切片', () => {
  it('把一张多页长图切成每页一个缩略图', async () => {
    apiMocks.viewScreenshot.mockResolvedValue(sheet(1, 6, 6))

    const wrapper = await mountInScreenshotMode()
    await vi.waitFor(() => expect(wrapper.findAll('.screenshot-item')).toHaveLength(6))

    expect(wrapper.findAll('.page-num').map((el) => el.text())).toEqual(['1', '2', '3', '4', '5', '6'])
    // 只请求起始页，块大小归主进程决定
    expect(apiMocks.viewScreenshot).toHaveBeenCalledWith(FILE, `${FILE}.screenshots`, 1)

    const third = wrapper.findAll('.screenshot-item')[2]
    expect(third.find('.page-crop').attributes('style')).toMatch(/aspect-ratio:\s*1280\s*\/\s*720/)
    const style = third.find('.page-sheet').attributes('style') ?? ''
    expect(style).toContain('height: 600%')
    expect(style).toContain('top: -200%')
  })

  it('页数超过一块时继续请求后续块并累计页码', async () => {
    apiMocks.viewScreenshot
      .mockResolvedValueOnce(sheet(1, 8, 20))
      .mockResolvedValueOnce(sheet(9, 8, 20))
      .mockResolvedValueOnce(sheet(17, 4, 20))

    const wrapper = await mountInScreenshotMode()
    await vi.waitFor(() => expect(wrapper.findAll('.screenshot-item')).toHaveLength(20))

    const starts = apiMocks.viewScreenshot.mock.calls.map((call) => call[2])
    expect(starts).toEqual([1, 9, 17])
    expect(wrapper.findAll('.page-num').map((el) => el.text())).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1)),
    )

    const last = wrapper.findAll('.screenshot-item')[19]
    expect((last.find('.page-sheet').attributes('style') ?? '')).toContain('height: 400%')
    expect((last.find('.page-sheet').attributes('style') ?? '')).toContain('top: -300%')
  })

  it('单页文档直接显示整图，不做裁切', async () => {
    apiMocks.viewScreenshot.mockResolvedValue(sheet(1, 1, 1))

    const wrapper = await mountInScreenshotMode()
    await vi.waitFor(() => expect(wrapper.findAll('.screenshot-item')).toHaveLength(1))

    expect(wrapper.findAll('.page-crop')).toHaveLength(0)
    expect(wrapper.findAll('.screenshot-item img')).toHaveLength(1)
  })

  it('点缩略图打开该页所在的那张图', async () => {
    const first = sheet(1, 3, 6)
    const second = sheet(4, 3, 6)
    apiMocks.viewScreenshot.mockResolvedValueOnce(first).mockResolvedValueOnce(second)

    const wrapper = await mountInScreenshotMode()
    await vi.waitFor(() => expect(wrapper.findAll('.screenshot-item')).toHaveLength(6))

    wrapper.findAll('.screenshot-item')[4].trigger('click')
    expect(apiMocks.openInEditor).toHaveBeenCalledWith('fileExplorer', second.path)
  })

  it('读不出图尺寸时整张交出去，不重复裁成多页', async () => {
    const broken = { ...sheet(1, 6, 6), height: 0, width: 0 }
    apiMocks.viewScreenshot.mockResolvedValue(broken)

    const wrapper = await mountInScreenshotMode()
    await vi.waitFor(() => expect(apiMocks.viewScreenshot).toHaveBeenCalled())
    await vi.waitFor(() => expect(wrapper.findAll('.screenshot-item')).toHaveLength(1))

    expect(wrapper.findAll('.page-crop')).toHaveLength(0)
    expect(apiMocks.viewScreenshot).toHaveBeenCalledTimes(1)
  })

  it('切走再切回来时，旧一轮不再往列表里追加页', async () => {
    const stale = deferred<Sheet>()
    apiMocks.viewScreenshot.mockImplementationOnce(() => stale.promise)

    const wrapper = await mountInScreenshotMode()
    await vi.waitFor(() => expect(apiMocks.viewScreenshot).toHaveBeenCalledTimes(1))

    // 同一实例上重启一轮：迟到的上一轮必须闭嘴
    apiMocks.viewScreenshot.mockResolvedValueOnce(sheet(1, 3, 3))
    wrapper.findAll('.preview-mode-btn')[1].trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('.screenshot-item')).toHaveLength(3))

    stale.resolve(sheet(1, 6, 6))
    await vi.waitFor(() => expect(wrapper.findAll('.page-num')).toHaveLength(3))
    expect(wrapper.findAll('.screenshot-item')).toHaveLength(3)
    expect(wrapper.findAll('.page-num').map((el) => el.text())).toEqual(['1', '2', '3'])
  })

  it('渲染失败时显示错误而不是空列表', async () => {
    apiMocks.viewScreenshot.mockRejectedValue(new Error('Screenshot render failed: boom'))

    const wrapper = await mountInScreenshotMode()
    await vi.waitFor(() => expect(wrapper.find('.preview-error').exists()).toBe(true))

    expect(wrapper.find('.error-text').text()).toContain('boom')
    expect(wrapper.findAll('.screenshot-item')).toHaveLength(0)
  })
})
