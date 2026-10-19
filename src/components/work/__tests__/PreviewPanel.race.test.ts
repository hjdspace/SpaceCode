import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import PreviewPanel from '../PreviewPanel.vue'
import { useAppStore } from '@/stores/app'

/**
 * 预览的交错时序（issue #42 第 12、13 项）。
 *
 * 两条都是「同一实例上的后一次动作被前一次的迟到结果覆盖」：
 *  - A.xlsx 渲染在飞时切到 B.xlsx，B 先回来、A 后回来 → 标题是 B、画面是 A。
 *  - watchStart 的句柄在 await 之后才赋值，所以在飞期间切文件/关面板，
 *    清理逻辑只认得到旧 watchId（或什么都认不到），迟到的那个 officecli 常驻
 *    子进程就再没人 stop。
 * 用 deferred 手工制造这两种交错，不靠定时器猜。
 */

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

const FILE_A = 'D:/docs/report-a.xlsx'
const FILE_B = 'D:/docs/report-b.xlsx'

function htmlUrlOf(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('webview').attributes('src') ?? ''
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((r, j) => {
    resolve = r
    reject = j
  })
  return { promise, resolve, reject }
}

async function mountPreview(filePath: string, mode: 'html' | 'watch') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  store.officePreviewMode = mode
  const wrapper = mount(PreviewPanel, {
    props: { filePath },
    global: { plugins: [pinia, i18n] },
  })
  await wrapper.vm.$nextTick()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.onDownloadProgress.mockReturnValue(() => {})
  apiMocks.artifactsChanged.mockReturnValue(() => {})
  apiMocks.loadGuiSettings.mockResolvedValue({ success: false })
  apiMocks.getEnv.mockResolvedValue({})
  apiMocks.watchStop.mockResolvedValue(true)
})

describe('切文件时的迟到渲染', () => {
  it('B 先回来、A 后回来时，画面保持 B', async () => {
    const lateA = deferred<string>()
    apiMocks.viewHtml.mockImplementationOnce(() => lateA.promise)
    apiMocks.viewHtml.mockResolvedValueOnce(`${FILE_B}.html`)

    const wrapper = await mountPreview(FILE_A, 'html')
    await vi.waitFor(() => expect(apiMocks.viewHtml).toHaveBeenCalledWith(FILE_A))

    await wrapper.setProps({ filePath: FILE_B })
    await vi.waitFor(() => expect(htmlUrlOf(wrapper)).toContain('report-b'))

    lateA.resolve(`${FILE_A}.html`)
    await flushPromises()
    expect(htmlUrlOf(wrapper)).toContain('report-b')
    expect(wrapper.find('.file-name').text()).toBe('report-b.xlsx')
  })

  it('被作废的那一轮先回来时不提前摘 loading，旧文件画面也不顶上来', async () => {
    const aRound = deferred<string>()
    const bRound = deferred<string>()
    apiMocks.viewHtml.mockImplementationOnce(() => aRound.promise)
    apiMocks.viewHtml.mockImplementationOnce(() => bRound.promise)

    const wrapper = await mountPreview(FILE_A, 'html')
    await wrapper.setProps({ filePath: FILE_B })
    await vi.waitFor(() => expect(apiMocks.viewHtml).toHaveBeenCalledTimes(2))

    // 迟到的 A 先落地：它既不能把 B 的转圈收掉，也不能把 A 的画面摆上去
    aRound.resolve(`${FILE_A}.html`)
    await flushPromises()
    expect(wrapper.find('webview').exists()).toBe(false)
    expect(wrapper.find('.preview-loading').exists()).toBe(true)

    bRound.resolve(`${FILE_B}.html`)
    await vi.waitFor(() => expect(htmlUrlOf(wrapper)).toContain('report-b'))
    expect(wrapper.find('.preview-loading').exists()).toBe(false)
  })

  it('watch 模式下迟到的 A 句柄被 stop，且不顶掉 B 的预览地址', async () => {
    const staleA = deferred<{ id: string; filePath: string; port: number; url: string }>()
    apiMocks.watchStart.mockImplementationOnce(() => staleA.promise)
    apiMocks.watchStart.mockResolvedValueOnce({
      id: 'watch-b',
      filePath: FILE_B,
      port: 5122,
      url: 'http://127.0.0.1:5122',
    })

    const wrapper = await mountPreview(FILE_A, 'watch')
    await vi.waitFor(() => expect(apiMocks.watchStart).toHaveBeenCalledTimes(1))

    await wrapper.setProps({ filePath: FILE_B })
    await vi.waitFor(() => expect(apiMocks.watchStart).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(htmlUrlOf(wrapper)).toContain('5122'))

    staleA.resolve({ id: 'watch-a', filePath: FILE_A, port: 5121, url: 'http://127.0.0.1:5121' })
    // 那个句柄主进程已经真的起起来了，迟到方不 stop 就是常驻泄漏
    await vi.waitFor(() => expect(apiMocks.watchStop).toHaveBeenCalledWith('watch-a'))
    expect(htmlUrlOf(wrapper)).toContain('5122')
  })
})

describe('预览在飞时关闭面板', () => {
  it('watchStart 还没回来就卸载，迟到的句柄照样被 stop', async () => {
    const pending = deferred<{ id: string; filePath: string; port: number; url: string }>()
    apiMocks.watchStart.mockImplementationOnce(() => pending.promise)

    const wrapper = await mountPreview(FILE_A, 'watch')
    await vi.waitFor(() => expect(apiMocks.watchStart).toHaveBeenCalledTimes(1))

    wrapper.unmount()
    pending.resolve({ id: 'watch-late', filePath: FILE_A, port: 5131, url: 'http://127.0.0.1:5131' })

    await vi.waitFor(() => expect(apiMocks.watchStop).toHaveBeenCalledWith('watch-late'))
  })

  it('首轮渲染没跑完就卸载，产物变更订阅不会留在总线上', async () => {
    const pending = deferred<string>()
    apiMocks.viewHtml.mockImplementationOnce(() => pending.promise)
    const unsubscribe = vi.fn()
    apiMocks.artifactsChanged.mockReturnValue(unsubscribe)

    const wrapper = await mountPreview(FILE_A, 'html')
    await vi.waitFor(() => expect(apiMocks.viewHtml).toHaveBeenCalledTimes(1))

    wrapper.unmount()
    // 订阅排在首轮渲染之前才轮得到卸载去摘它
    expect(apiMocks.artifactsChanged).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    pending.resolve(`${FILE_A}.html`)
    await vi.waitFor(() => expect(apiMocks.viewHtml).toHaveBeenCalledTimes(1))
  })
})
