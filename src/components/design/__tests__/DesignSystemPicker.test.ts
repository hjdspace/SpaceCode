import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DesignSystemPicker from '../DesignSystemPicker.vue'
import DesignSystemPreviewModal from '../DesignSystemPreviewModal.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: {
      getSystemShowcase: vi.fn().mockResolvedValue('<html>preview</html>'),
    },
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

const systems = [
  { id: 'agentic', name: 'Agentic', category: 'Themed & Unique', description: 'AI-first', previewPages: [{ path: 'preview/colors.html', role: 'colors', title: 'Colors' }] },
  { id: 'apple', name: 'Apple', category: 'Corporate', description: 'Apple iOS', previewPages: [] },
]

// 菜单 Teleport 到 body 后不在 wrapper 子树内，交互用例把 teleport stub 掉就地渲染
function mountPicker(stubs: Record<string, unknown> = {}) {
  return mount(DesignSystemPicker, {
    props: { systems, modelValue: null },
    global: { stubs: { teleport: true, ...stubs } },
  })
}

// jsdom 没有布局，clientWidth 恒为 0 → 缩放测量会直接跳过。伪造容器宽与
// ResizeObserver，才能穿过「量宽 → 算 scale」这条缝（漏绑 ref 时这里会红）。
let restoreLayout: (() => void) | null = null
function stubLayout(widthPx: number) {
  const g = globalThis as Record<string, unknown>
  const realObserver = g.ResizeObserver
  g.ResizeObserver = class {
    constructor(private readonly onResize: () => void) {}
    observe() { this.onResize() }
    disconnect() {}
  }
  const realDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => widthPx })
  restoreLayout = () => {
    g.ResizeObserver = realObserver
    if (realDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realDescriptor)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    restoreLayout = null
  }
}

describe('DesignSystemPicker', () => {
  beforeEach(() => {
    config.global.plugins = [i18n]
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreLayout?.()
  })

  it('打开后渲染系统列表（含不指定选项）', async () => {
    const w = mountPicker()
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    expect(w.findAll('[data-testid^="ds-option-"]')).toHaveLength(3)
  })

  it('选择系统触发 update:modelValue', async () => {
    const w = mountPicker()
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-option-agentic"]').trigger('mousedown')
    const events = w.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['agentic'])
  })

  it('悬停带预览的系统调用 getSystemShowcase', async () => {
    const { api } = await import('@/services/electronAPI')
    const w = mountPicker()
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-option-agentic"]').trigger('mouseenter')
    expect(api.design.getSystemShowcase).toHaveBeenCalledWith('agentic')
  })

  it('浮层 Teleport 到 body 并用视口坐标定位（躲开中心栏裁剪与右侧面板遮挡）', async () => {
    const w = mount(DesignSystemPicker, { props: { systems, modelValue: null } })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')

    const menu = document.querySelector<HTMLElement>('[data-testid="ds-picker-menu"]')
    expect(menu).toBeTruthy()
    expect(menu!.parentElement).toBe(document.body)
    expect(menu!.style.position).toBe('fixed')
    expect(menu!.style.left).toContain('px')
    w.unmount()
  })

  it('点击浮层内的搜索框不会关闭浮层', async () => {
    const w = mount(DesignSystemPicker, { props: { systems, modelValue: null } })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')

    const search = document.querySelector('[data-testid="ds-picker-search"]')
    expect(search).toBeTruthy()
    search!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await w.vm.$nextTick()

    expect(document.querySelector('[data-testid="ds-picker-menu"]')).toBeTruthy()
    w.unmount()
  })

  it('缩略图按桌面视口排版、按容器宽等比缩放，并禁掉内部滚动', async () => {
    stubLayout(320)
    const w = mountPicker()
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-option-agentic"]').trigger('mouseenter')
    await flushPromises()

    const frame = w.find('[data-testid="ds-preview-frame"]')
    expect(frame.exists()).toBe(true)
    // showcase 页有 1180px 容器与 220px 固定侧栏，1:1 塞进 ~275px 的右列必出双滚动条
    const frameStyle = (frame.element as HTMLIFrameElement).style
    expect(frameStyle.width).toBe('1280px')
    expect(frameStyle.height).toBe('720px')
    expect(frameStyle.transform).toBe('scale(0.25)')
    expect(frame.attributes('scrolling')).toBe('no')
    w.unmount()
  })

  it('点击缩略图打开预览弹窗', async () => {
    const w = mountPicker({ DesignSystemPreviewModal: true })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-option-agentic"]').trigger('mouseenter')
    await flushPromises()

    await w.find('[data-testid="ds-preview-frame-wrap"]').trigger('click')
    expect(w.findComponent(DesignSystemPreviewModal).exists()).toBe(true)
    w.unmount()
  })
})
