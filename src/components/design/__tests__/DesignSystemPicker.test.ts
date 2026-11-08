import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DesignSystemPicker from '../DesignSystemPicker.vue'
import DesignSystemPreviewModal from '../DesignSystemPreviewModal.vue'
import DesignSystemCreateModal from '../DesignSystemCreateModal.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: {
      getSystemShowcase: vi.fn().mockResolvedValue('<html>preview</html>'),
      createSystem: vi.fn(),
      deleteSystem: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

const confirmState = vi.hoisted(() => ({ result: true }))
vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({
    showConfirm: vi.fn(async () => confirmState.result),
    showAlert: vi.fn(),
  }),
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

const systems = [
  { id: 'my-warm', name: '我的暖调', category: 'Custom', description: '暖米底', previewPages: [], source: 'user' as const },
  { id: 'agentic', name: 'Agentic', category: 'Themed & Unique', description: 'AI-first', previewPages: [{ path: 'preview/colors.html', role: 'colors', title: 'Colors' }] },
  { id: 'apple', name: 'Apple', category: 'Corporate', description: 'Apple iOS', previewPages: [] },
]

// 菜单 Teleport 到 body 后不在 wrapper 子树内，交互用例把 teleport stub 掉就地渲染
function mountPicker(stubs: Record<string, unknown> = {}, extraProps: Record<string, unknown> = {}) {
  return mount(DesignSystemPicker, {
    props: { systems, modelValue: null, ...extraProps },
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
    confirmState.result = true
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreLayout?.()
  })

  it('打开后渲染系统列表（含不指定选项）', async () => {
    const w = mountPicker()
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    expect(w.findAll('[data-testid^="ds-option-"]')).toHaveLength(4)
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

  it('创建按钮可点击，点击后收起浮层并打开创建弹窗', async () => {
    const w = mountPicker({ DesignSystemCreateModal: true })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')

    const create = w.find('[data-testid="ds-picker-create"]')
    expect((create.element as HTMLButtonElement).disabled).toBe(false)

    await create.trigger('click')
    expect(w.find('[data-testid="ds-picker-menu"]').exists()).toBe(false)
    expect(w.findComponent(DesignSystemCreateModal).exists()).toBe(true)
    w.unmount()
  })

  it('创建成功后向上层抛出 created 并关闭弹窗', async () => {
    const created = {
      id: 'warm-editorial',
      name: 'Warm Editorial',
      category: 'Custom',
      previewPages: [],
      source: 'user' as const,
    }
    const w = mountPicker({ DesignSystemCreateModal: true })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-picker-create"]').trigger('click')

    w.findComponent(DesignSystemCreateModal).vm.$emit('created', created)
    await flushPromises()
    expect(w.emitted('created')?.[0]).toEqual([created])
    expect(w.findComponent(DesignSystemCreateModal).exists()).toBe(false)
    w.unmount()
  })

  it('自建项独立分组排在官方预设之前', async () => {
    const w = mountPicker()
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')

    expect(w.findAll('.ds-picker-group-label').map((n) => n.text())).toEqual(['我的设计系统', '官方预设'])
    // 「不指定」恒在首位，其后才是自建组
    const options = w.findAll('[data-testid^="ds-option-"]').map((n) => n.attributes('data-testid'))
    expect(options).toEqual(['ds-option-none', 'ds-option-my-warm', 'ds-option-agentic', 'ds-option-apple'])
    expect(w.find('[data-testid="ds-option-my-warm"]').text()).toContain('自建')
    w.unmount()
  })

  it('只有自建项给删除入口；确认后调 deleteSystem 并抛出 removed', async () => {
    const { api } = await import('@/services/electronAPI')
    const w = mountPicker()
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')

    await w.find('[data-testid="ds-option-agentic"]').trigger('mouseenter')
    await flushPromises()
    expect(w.find('[data-testid="ds-preview-delete"]').exists()).toBe(false)

    await w.find('[data-testid="ds-option-my-warm"]').trigger('mouseenter')
    await flushPromises()
    await w.find('[data-testid="ds-preview-delete"]').trigger('click')
    await flushPromises()

    expect(api.design.deleteSystem).toHaveBeenCalledWith('my-warm')
    expect(w.emitted('removed')?.[0]).toEqual(['my-warm'])
    w.unmount()
  })

  it('删除确认里取消就不动文件也不通知上层', async () => {
    confirmState.result = false
    const { api } = await import('@/services/electronAPI')
    const w = mountPicker()
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-option-my-warm"]').trigger('mouseenter')
    await flushPromises()

    await w.find('[data-testid="ds-preview-delete"]').trigger('click')
    await flushPromises()

    expect(api.design.deleteSystem).not.toHaveBeenCalled()
    expect(w.emitted('removed')).toBeFalsy()
    w.unmount()
  })
})
