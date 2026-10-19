import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { useChatSessionStore } from '@/stores/chatSession'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import ArtifactsPanel from '../ArtifactsPanel.vue'

/**
 * 产物列表面板的交错时序与动作语义（issue #42 第 14、15 项）。
 *
 *  - 项目 A 的列表请求在飞时切到 B：B 先回来、A 后回来时，列表不能又被 A 盖掉。
 *    切项目同时会点着 watch(currentSessionId) 与 watch(workingDir) 两条 refresh，
 *    所以这个窗口本来就宽。
 *  - 「外部打开」按钮（ExternalLink 图标）以前和预览按钮共用一个处理函数，
 *    office 文件于是永远只打开应用内预览，系统关联程序那条 IPC 根本没被调用。
 *
 * 会话 store 只被当作「当前项目/会话在哪」的读数来源，这里用替身把它换成可控的
 * 响应式对象；竞态本身完全发生在组件的 refresh 里，不借用真实 store 的初始化。
 */

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  open: vi.fn(),
  reveal: vi.fn(),
  startWatch: vi.fn(),
  stopWatch: vi.fn(),
  onChanged: vi.fn(),
  openOfficePreview: vi.fn(),
  openFileInWebview: vi.fn(),
  showAlert: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: { artifacts: apiMocks },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    openOfficePreview: apiMocks.openOfficePreview,
    openFileInWebview: apiMocks.openFileInWebview,
  }),
}))

vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({ showAlert: apiMocks.showAlert }),
}))

interface FakeSessionStore {
  workingDirectory: string
  currentSessionId: string
  currentSession: { mode: string; createdAt: number } | null
  setProject: (dir: string, sessionId: string, createdAt: number) => void
}

vi.mock('@/stores/chatSession', async () => {
  const { reactive } = await import('vue')
  const state = reactive({
    workingDirectory: '',
    currentSessionId: '',
    currentSession: null as { mode: string; createdAt: number } | null,
    setProject(dir: string, sessionId: string, createdAt: number) {
      // 顺序照真实切项目：先落新会话，再让 workingDirectory 跟着变
      state.currentSessionId = sessionId
      state.currentSession = { mode: 'work', createdAt }
      state.workingDirectory = dir
    },
  })
  return { useChatSessionStore: () => state }
})

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
  globalInjection: true,
})

function entry(path: string, mtime = Date.now()) {
  const name = path.split('/').pop() ?? path
  return { name, path, ext: name.split('.').pop() ?? '', size: 1024, mtime }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function fileNames(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.file-name').map((el) => el.text())
}

async function mountPanel() {
  const wrapper = mount(ArtifactsPanel, { global: { plugins: [i18n] } })
  await wrapper.vm.$nextTick()
  return wrapper
}

function sessionStore(): FakeSessionStore {
  return useChatSessionStore() as unknown as FakeSessionStore
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.onChanged.mockReturnValue(() => {})
  apiMocks.stopWatch.mockResolvedValue(true)
  apiMocks.startWatch.mockResolvedValue({ watching: true, watchCount: 1 })
  apiMocks.open.mockResolvedValue({ success: true })
})

describe('切项目时迟到的列表结果', () => {
  beforeEach(() => {
    sessionStore().setProject('/proj/a', 's-a', Date.now() - 5000)
  })

  it('B 先回来、A 后回来时列表保持 B', async () => {
    const lateA = deferred<{ artifacts: ReturnType<typeof entry>[] }>()
    apiMocks.list.mockImplementationOnce(() => lateA.promise)
    apiMocks.list.mockResolvedValue({ artifacts: [entry('/proj/b/outputs/b.xlsx')] })

    const wrapper = await mountPanel()
    await vi.waitFor(() => expect(apiMocks.list).toHaveBeenCalledWith('/proj/a', { scanWorkspaceRoot: true }))

    sessionStore().setProject('/proj/b', 's-b', Date.now())
    await vi.waitFor(() => expect(fileNames(wrapper)).toEqual(['b.xlsx']))

    lateA.resolve({ artifacts: [entry('/proj/a/outputs/a.docx')] })
    await flushPromises()
    // 迟到的 A 既不能把 b.docx 换成 a.docx，也不能把自己的空列表写回来
    expect(fileNames(wrapper)).toEqual(['b.xlsx'])
  })

  it('迟到的 watcher 状态不决定当前项目是否退回轮询', async () => {
    vi.useFakeTimers()
    try {
      const lateA = deferred<{ watching: boolean; watchCount: number }>()
      apiMocks.startWatch.mockImplementationOnce(() => lateA.promise)
      apiMocks.startWatch.mockResolvedValue({ watching: true, watchCount: 1 })
      apiMocks.list.mockResolvedValue({ artifacts: [entry('/proj/b/outputs/b.xlsx')] })

      const wrapper = await mountPanel()
      await vi.waitFor(() => expect(apiMocks.startWatch).toHaveBeenCalledWith('/proj/a'))

      sessionStore().setProject('/proj/b', 's-b', Date.now())
      await vi.waitFor(() => expect(apiMocks.startWatch).toHaveBeenCalledWith('/proj/b'))
      const callsAfterB = apiMocks.list.mock.calls.length

      // B 已经确定有实时推送；A 那句"一个 watcher 都没建成"迟到也不能启动轮询
      lateA.resolve({ watching: false, watchCount: 0 })
      await vi.advanceTimersByTimeAsync(3500)

      expect(apiMocks.list.mock.calls.length).toBe(callsAfterB)
      expect(fileNames(wrapper)).toEqual(['b.xlsx'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('行内三个动作的分工', () => {
  async function mountWith(file: string) {
    sessionStore().setProject('/proj/a', 's-a', Date.now() - 1000)
    apiMocks.list.mockResolvedValue({ artifacts: [entry(file)] })
    const wrapper = mount(ArtifactsPanel, { global: { plugins: [i18n] } })
    await vi.waitFor(() => expect(wrapper.findAll('.artifact-item')).toHaveLength(1))
    return wrapper
  }

  it('外部打开按钮走系统关联程序，不碰应用内预览', async () => {
    const wrapper = await mountWith('/proj/a/outputs/sheet.xlsx')

    wrapper.find('button[title="在外部打开"]').trigger('click')
    await flushPromises()

    expect(apiMocks.open).toHaveBeenCalledWith('/proj/a/outputs/sheet.xlsx')
    expect(apiMocks.openOfficePreview).not.toHaveBeenCalled()
  })

  it('预览按钮与双击仍走应用内预览', async () => {
    const wrapper = await mountWith('/proj/a/outputs/sheet.xlsx')

    wrapper.find('button[title="预览"]').trigger('click')
    await flushPromises()
    expect(apiMocks.openOfficePreview).toHaveBeenCalledWith('/proj/a/outputs/sheet.xlsx')

    wrapper.findAll('.artifact-item')[0].trigger('dblclick')
    expect(apiMocks.openFileInWebview).not.toHaveBeenCalled()
    expect(apiMocks.openOfficePreview).toHaveBeenCalledTimes(2)
  })

  it('系统打开失败时给出提示，而不是静默', async () => {
    const wrapper = await mountWith('/proj/a/outputs/report.docx')
    apiMocks.open.mockResolvedValue({ success: false, error: 'no application is associated' })

    wrapper.find('button[title="在外部打开"]').trigger('click')
    await flushPromises()

    expect(apiMocks.showAlert).toHaveBeenCalledTimes(1)
    expect(apiMocks.showAlert.mock.calls[0][0]).toContain('no application is associated')
  })
})
