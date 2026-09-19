import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import CodeViewer from '../CodeViewer.vue'
import { useAppStore, type FileInfo } from '@/stores/app'

const apiMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readFileAsBase64: vi.fn(),
  loadGuiSettings: vi.fn(),
  getEnv: vi.fn(),
  terminalOnExit: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    readFile: apiMocks.readFile,
    readFileAsBase64: apiMocks.readFileAsBase64,
    loadGuiSettings: apiMocks.loadGuiSettings,
    getEnv: apiMocks.getEnv,
    terminal: { onExit: apiMocks.terminalOnExit },
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
  globalInjection: true,
})

function makeFile(content: string): FileInfo {
  return { path: '/proj/src/demo.ts', name: 'demo.ts', content, language: 'typescript' }
}

/** 挂载前通过 store 就位 currentFile + 行号, 复现"点击链接 → 首开面板"的时序 */
async function mountWithLine(content: string, line: number, endLine = 0) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  store.setCurrentFile(makeFile(content))
  store.currentLine = line
  store.currentEndLine = endLine
  const scrollToSpy = vi.fn()
  Element.prototype.scrollTo = scrollToSpy as unknown as typeof Element.prototype.scrollTo
  const wrapper = mount(CodeViewer, { global: { plugins: [pinia, i18n] } })
  // scrollToLine / flashLines 内部经 nextTick 等 DOM patch 完成
  await wrapper.vm.$nextTick()
  await wrapper.vm.$nextTick()
  return { wrapper, store, scrollToSpy }
}

describe('CodeViewer 定位行号', () => {
  beforeEach(() => {
    apiMocks.readFile.mockResolvedValue('content')
    apiMocks.readFileAsBase64.mockResolvedValue(null)
    apiMocks.loadGuiSettings.mockResolvedValue({ success: false })
    apiMocks.getEnv.mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('首次挂载时 currentLine 已就位也应滚动到目标行(修复 watch 不触发)', async () => {
    const { wrapper, scrollToSpy } = await mountWithLine('a\nb\nc\nd', 3)
    expect(scrollToSpy).toHaveBeenCalled()
    const lines = wrapper.findAll('.line-number')
    expect(lines[2].classes()).toContain('current-line')
    wrapper.unmount()
  })

  it('目标行短暂闪烁高亮并自动清除', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountWithLine('a\nb\nc\nd', 2, 3)
    const lines = wrapper.findAll('.line-number')
    expect(lines[1].classes()).toContain('line-flash')
    expect(lines[2].classes()).toContain('line-flash')
    // 闪烁 1.6s 后清除
    await vi.advanceTimersByTimeAsync(1700)
    expect(lines[1].classes()).not.toContain('line-flash')
    expect(lines[2].classes()).not.toContain('line-flash')
    wrapper.unmount()
  })

  it('未指定行号(currentLine=0)时不触发滚动', async () => {
    const { wrapper, scrollToSpy } = await mountWithLine('a\nb\nc', 0)
    expect(scrollToSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('同文件行号变化时再次滚动', async () => {
    const { wrapper, store, scrollToSpy } = await mountWithLine('a\nb\nc\nd', 2)
    const callsAfterMount = scrollToSpy.mock.calls.length
    store.currentLine = 4
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(scrollToSpy.mock.calls.length).toBeGreaterThan(callsAfterMount)
    const lines = wrapper.findAll('.line-number')
    expect(lines[3].classes()).toContain('current-line')
    wrapper.unmount()
  })
})
