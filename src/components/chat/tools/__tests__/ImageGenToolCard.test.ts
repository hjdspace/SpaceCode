// @vitest-environment jsdom
/**
 * 生图工具卡片（#110）。
 *
 * 钉住外部可观察行为：给定工具返回的 JSON，卡片渲染了什么、点击调用了哪个宿主能力。
 * 本地图片必须内联成 data URL —— 渲染层 CSP 的 img-src 不含 file:，直接给路径必然裂图。
 */
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImageGenToolCard from '@/components/chat/tools/ImageGenToolCard.vue'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'
import type { ToolCall } from '@/types'

const H = vi.hoisted(() => ({
  readFileAsBase64: vi.fn<(path: string) => Promise<string | null>>(async () => 'QUJD'),
  showItemInFolder: vi.fn<(path: string) => Promise<void>>(async () => {}),
  canShowItemInFolder: true,
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    readFileAsBase64: H.readFileAsBase64,
    shell: {
      get canShowItemInFolder() {
        return H.canShowItemInFolder
      },
      showItemInFolder: H.showItemInFolder,
    },
  },
}))

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'en-US': enUS, 'zh-CN': zhCN } })

const PNG_PATH = 'C:/proj/outputs/imagegen/hero.png'

function makeToolCall(output: unknown, overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-imagegen',
    name: 'mcp__spacecode-imagegen__generate_image',
    input: { prompt: 'a red fox' },
    output: typeof output === 'string' ? output : JSON.stringify(output),
    status: 'completed',
    ...overrides,
  }
}

function setup(toolCall: ToolCall) {
  return mount(ImageGenToolCard, { props: { toolCall }, global: { plugins: [i18n] } })
}

/** 图片是异步读盘后回填的，等微任务队列排空。 */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  H.readFileAsBase64.mockClear().mockResolvedValue('QUJD')
  H.showItemInFolder.mockClear()
  H.canShowItemInFolder = true
  i18n.global.locale.value = 'zh-CN'
  document.body.innerHTML = ''
})

describe('缩略图', () => {
  it('把本地路径读成 data URL 内联，不把 file: 路径交给 img', async () => {
    const wrapper = setup(makeToolCall({ model: 'gpt-image-1', images: [{ path: PNG_PATH, size: '1024x1024' }] }))
    await flush()

    expect(H.readFileAsBase64).toHaveBeenCalledWith(PNG_PATH)
    const img = wrapper.find('img.ig-thumb')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('data:image/png;base64,QUJD')
    expect(img.attributes('src')).not.toContain('file:')
  })
})

describe('放大查看', () => {
  it('点击缩略图开灯箱展示同一张图，点击遮罩关闭', async () => {
    const wrapper = setup(makeToolCall({ model: 'gpt-image-1', images: [{ path: PNG_PATH }] }))
    await flush()

    expect(wrapper.find('.ig-lightbox').exists()).toBe(false)

    await wrapper.find('img.ig-thumb').trigger('click')
    const lightbox = wrapper.find('.ig-lightbox')
    expect(lightbox.exists()).toBe(true)
    expect(lightbox.find('img').attributes('src')).toBe('data:image/png;base64,QUJD')

    await lightbox.trigger('click')
    expect(wrapper.find('.ig-lightbox').exists()).toBe(false)
  })

  it('Esc 关闭灯箱', async () => {
    const wrapper = setup(makeToolCall({ model: 'm', images: [{ path: PNG_PATH }] }))
    await flush()

    await wrapper.find('img.ig-thumb').trigger('click')
    expect(wrapper.find('.ig-lightbox').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ig-lightbox').exists()).toBe(false)
  })
})

describe('打开所在文件夹', () => {
  it('点击把该图的绝对路径交给宿主 shell', async () => {
    const wrapper = setup(makeToolCall({ model: 'gpt-image-1', images: [{ path: PNG_PATH }] }))
    await flush()

    await wrapper.find('button.ig-open-folder').trigger('click')

    expect(H.showItemInFolder).toHaveBeenCalledWith(PNG_PATH)
  })

  it('宿主没有该能力时按钮置灰，点击不发起调用', async () => {
    H.canShowItemInFolder = false
    const wrapper = setup(makeToolCall({ model: 'gpt-image-1', images: [{ path: PNG_PATH }] }))
    await flush()

    const btn = wrapper.find('button.ig-open-folder')
    expect(btn.attributes('disabled')).toBeDefined()

    await btn.trigger('click')
    expect(H.showItemInFolder).not.toHaveBeenCalled()
  })
})

describe('部分成功', () => {
  const MIXED = {
    model: 'gpt-image-1',
    images: [
      { path: PNG_PATH, size: '1024x1024', status: 'succeeded' },
      { status: 'failed', error: 'content_policy: rejected by safety system' },
      { status: 'cancelled' },
    ],
  }

  it('三态各自可辨：成功出图、失败与取消不出图也不冒充成功', async () => {
    const wrapper = setup(makeToolCall(MIXED))
    await flush()

    const items = wrapper.findAll('.ig-item')
    expect(items).toHaveLength(3)
    expect(items[0].find('img.ig-thumb').exists()).toBe(true)
    expect(items[1].find('img.ig-thumb').exists()).toBe(false)
    expect(items[2].find('img.ig-thumb').exists()).toBe(false)

    expect(items[1].classes()).toContain('is-failed')
    expect(items[2].classes()).toContain('is-cancelled')
    expect(items[1].find('.ig-item-status').text()).toBe('失败')
    expect(items[2].find('.ig-item-status').text()).toBe('已取消')
  })

  it('汇总只报实际发生的计数', async () => {
    const wrapper = setup(makeToolCall(MIXED))
    await flush()

    const summary = wrapper.find('.ig-summary').text()
    expect(summary).toContain('1 张成功')
    expect(summary).toContain('1 张失败')
    expect(summary).toContain('1 张已取消')
  })

  it('全部成功时不报失败与取消', async () => {
    const wrapper = setup(makeToolCall({ model: 'm', images: [{ path: PNG_PATH }] }))
    await flush()

    const summary = wrapper.find('.ig-summary').text()
    expect(summary).toContain('1 张成功')
    expect(summary).not.toContain('失败')
    expect(summary).not.toContain('取消')
  })
})

describe('改图结果', () => {
  const EDIT = { model: 'gpt-image-1', referenceCount: 2, images: [{ path: PNG_PATH, size: '1024x1024' }] }
  const EDIT_CALL = { name: 'mcp__spacecode-imagegen__edit_image', input: { prompt: 'make it warm', imagePaths: ['a.png', 'b.png'] } }

  it('标题与徽标写明这是改图与参考图张数，结果图照常渲染', async () => {
    const wrapper = setup(makeToolCall(EDIT, EDIT_CALL))
    await flush()

    expect(wrapper.find('.ig-title').text()).toBe('改图')
    expect(wrapper.find('.ig-references').text()).toBe('参考图 2 张')
    expect(wrapper.find('img.ig-thumb').attributes('src')).toBe('data:image/png;base64,QUJD')
  })

  it('文生图不显示改图标题与参考图徽标', async () => {
    const wrapper = setup(makeToolCall({ model: 'm', images: [{ path: PNG_PATH }] }))
    await flush()

    expect(wrapper.find('.ig-title').text()).toBe('生图')
    expect(wrapper.find('.ig-references').exists()).toBe(false)
  })

  it('英文界面下改图文案跟随语言', async () => {
    i18n.global.locale.value = 'en-US'
    const wrapper = setup(makeToolCall(EDIT, EDIT_CALL))
    await flush()

    expect(wrapper.find('.ig-title').text()).toBe('Image edit')
    expect(wrapper.find('.ig-references').text()).toBe('References: 2')
  })

  it('改图整次失败时同样给失败态，不冒充成功', async () => {
    const wrapper = setup(makeToolCall('The "zhipu" dialect does not support image editing.', { ...EDIT_CALL, status: 'error' }))
    await flush()

    expect(wrapper.find('.ig-call-error').text()).toContain('does not support image editing')
    expect(wrapper.find('.ig-grid').exists()).toBe(false)
  })

  // 失败输出是纯文本、在途时压根没有输出：身份只能来自工具名，不能来自返回值。
  it('改图失败时标题仍是改图，张数取自入参', async () => {
    const wrapper = setup(makeToolCall('The "zhipu" dialect does not support image editing.', { ...EDIT_CALL, status: 'error' }))
    await flush()

    expect(wrapper.find('.ig-title').text()).toBe('改图')
    expect(wrapper.find('.ig-references').text()).toBe('参考图 2 张')
  })

  it('改图还没返回时标题就是改图', async () => {
    const wrapper = setup(makeToolCall('', { ...EDIT_CALL, status: 'running' }))
    await flush()

    expect(wrapper.find('.ig-title').text()).toBe('改图')
  })
})

describe('失败文案与凭证', () => {
  it('稳定错误码渲染成可读文案，不回显供应商原文里的 key', async () => {
    const wrapper = setup(makeToolCall({
      model: 'm',
      images: [{ status: 'failed', error: 'auth: Incorrect API key provided: sk-LEAKED12345678' }],
    }))
    await flush()

    const text = wrapper.find('.ig-item-error').text()
    expect(text).toBe('凭证无效或已过期，请到设置里更新 Key')
    expect(wrapper.text()).not.toContain('sk-LEAKED12345678')
  })

  it('未知错误码退到通用文案，同样不泄露 key', async () => {
    const wrapper = setup(makeToolCall({
      model: 'm',
      images: [{ status: 'failed', error: 'brand_new_code: boom sk-LEAKED12345678' }],
    }))
    await flush()

    expect(wrapper.find('.ig-item-error').text()).toBe('生成失败，请查看对话里的工具报错')
    expect(wrapper.text()).not.toContain('sk-LEAKED12345678')
  })

  it('整次调用失败时给出失败态，且抹掉凭证样式的串', async () => {
    const wrapper = setup(makeToolCall('Image request failed: 401 Bearer sk-LEAKED12345678', { status: 'error' }))
    await flush()

    expect(wrapper.find('.ig-call-error').exists()).toBe(true)
    expect(wrapper.find('.ig-grid').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('sk-LEAKED12345678')
  })

  it('抹掉凭证后留下的占位串跟随语言，不是写死的英文', async () => {
    const output = 'Image request failed: 401 sk-LEAKED12345678'
    const zh = setup(makeToolCall(output, { status: 'error' }))
    await flush()
    expect(zh.find('.ig-call-error').text()).toContain('已隐去')

    i18n.global.locale.value = 'en-US'
    const en = setup(makeToolCall(output, { status: 'error' }))
    await flush()
    expect(en.find('.ig-call-error').text()).toContain('[redacted]')
  })
})

describe('图片读不出来', () => {
  it('成功项读盘失败时说明原因，不留一个没有交代的空占位', async () => {
    H.readFileAsBase64.mockResolvedValue(null)
    const wrapper = setup(makeToolCall({ model: 'm', images: [{ path: PNG_PATH }] }))
    await flush()

    expect(wrapper.find('img.ig-thumb').exists()).toBe(false)
    expect(wrapper.find('.ig-placeholder').exists()).toBe(true)
    expect(wrapper.find('.ig-item-error').text()).toBe('图片读取失败')
  })

  it('读不出来的图点不开灯箱 —— 没有可显示的字节', async () => {
    H.readFileAsBase64.mockResolvedValue(null)
    const wrapper = setup(makeToolCall({ model: 'm', images: [{ path: PNG_PATH }] }))
    await flush()

    await wrapper.find('.ig-placeholder').trigger('click')
    expect(wrapper.find('.ig-lightbox').exists()).toBe(false)
  })

  it('灯箱开着时该项不再可读，灯箱随之关闭而不是显示空 src', async () => {
    const wrapper = setup(makeToolCall({ model: 'm', images: [{ path: PNG_PATH }] }))
    await flush()
    await wrapper.find('img.ig-thumb').trigger('click')
    expect(wrapper.find('.ig-lightbox').exists()).toBe(true)

    H.readFileAsBase64.mockResolvedValue(null)
    await wrapper.setProps({ toolCall: makeToolCall({ model: 'm', images: [{ path: PNG_PATH }] }) })
    await flush()

    expect(wrapper.find('.ig-lightbox').exists()).toBe(false)
  })
})

describe('流式回填', () => {
  it('先一批的慢响应不覆盖后一批已经显示的图', async () => {
    let resolveSlow: (value: string | null) => void = () => {}
    H.readFileAsBase64.mockImplementationOnce(() => new Promise(resolve => { resolveSlow = resolve }))

    const wrapper = setup(makeToolCall({ model: 'm', images: [{ path: 'C:/proj/outputs/imagegen/slow.png' }] }))
    await flush()

    await wrapper.setProps({ toolCall: makeToolCall({ model: 'm', images: [{ path: PNG_PATH }] }) })
    await flush()
    expect(wrapper.find('img.ig-thumb').attributes('src')).toBe('data:image/png;base64,QUJD')

    resolveSlow('T0xE')
    await flush()
    expect(wrapper.find('img.ig-thumb').attributes('src')).toBe('data:image/png;base64,QUJD')
  })
})