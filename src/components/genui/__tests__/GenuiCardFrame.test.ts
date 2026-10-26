import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, config, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import {
  GENUI_MSG_ACTION,
  GENUI_MSG_ERROR,
  GENUI_MSG_READY,
  GENUI_MSG_SIZE,
  GENUI_SANDBOX_DOC_PATH,
  GENUI_SANDBOX_PROTOCOL_VERSION,
} from '@/shared/genuiSandbox'
import GenuiCardFrame from '../GenuiCardFrame.vue'
import type { GenuiCardSubmissionResult } from '@/lib/genui/cardSubmission'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

const SOURCE = { baseUrl: 'http://localhost:5174', docUrl: `http://localhost:5174${GENUI_SANDBOX_DOC_PATH}`, kind: 'dev' as const }

const CARD = {
  id: 'm1:card:0',
  protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
  schema: { componentName: 'FixtureCard', title: 'fixture', rows: [] },
}

function mountFrame(props: Record<string, unknown> = {}) {
  return mount(GenuiCardFrame, {
    props: { card: CARD, source: SOURCE, theme: 'dark' as const, locale: 'zh-CN', ...props },
    // 必须挂进文档：脱离 document 的 iframe 在 jsdom 里 contentWindow 是 null，
    // 桥的 postInit 会直接跳过，测试就永远走不到「文档已就位、卡片不回话」这一段。
    attachTo: document.body,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * 让这张卡走满「起不来」的完整路径：文档就位（load）→ 交出 Schema → 5 秒不回 ready。
 *
 * 宿主会先静默重挂一次 iframe（冷启动的 5MB 物料文档不该让用户手点重试），所以要跑两轮
 * 才落到错误占位。返回后 wrapper 上的 iframe 已经换成第二次挂载的那一个。
 */
async function exhaustHandshakeAttempts(wrapper: ReturnType<typeof mountFrame>) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const frame = wrapper.find('iframe')
    // 上一轮已经把预算用尽：卡片已经换成错误占位，没有 frame 可以再喂了
    if (!frame.exists()) return
    frame.element.dispatchEvent(new Event('load'))
    await flushPromises()
    vi.advanceTimersByTime(5_000)
    await flushPromises()
  }
}

describe('卡片 iframe 的授权面', () => {
  it('只授予 allow-scripts，文档来自独立源的固定入口', () => {
    const wrapper = mountFrame()
    const frame = wrapper.find('iframe').element

    // 多一个 allow-same-origin 就等于把 app 的 origin 交给卡片；
    // allow-popups / allow-top-navigation / allow-forms 同理，一个都不给。
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('src')).toBe(SOURCE.docUrl)
    expect(frame.getAttribute('title')).toBe('生成式 UI 卡片')
    wrapper.unmount()
  })

  it('卡片外壳不撑破消息宽度（jsdom 量不了布局，钉住样式规则）', () => {
    const sfc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'GenuiCardFrame.vue'), 'utf-8')
    const style = sfc.slice(sfc.indexOf('<style'))
    expect(style).toContain('max-width: 100%')
    expect(style).toContain('min-width: 0')
  })
})

describe('握手失败收口到该卡的错误占位', () => {
  it('宿主先自己重挂一次，第二次仍起不来才换成占位并提供重试', async () => {
    const wrapper = mountFrame()

    // 第一次超时：静默重建，画面仍然是卡片而不是错误
    const firstFrame = wrapper.find('iframe').element
    firstFrame.dispatchEvent(new Event('load'))
    await flushPromises()
    vi.advanceTimersByTime(5_000)
    await flushPromises()

    expect(wrapper.attributes('data-state')).not.toBe('error')
    expect(wrapper.text()).not.toContain('卡片未能与宿主完成握手')
    // 换 key 重建：这已经是一个新的 iframe 元素
    expect(wrapper.find('iframe').element).not.toBe(firstFrame)

    await exhaustHandshakeAttempts(wrapper)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('卡片未能与宿主完成握手')
    expect(wrapper.find('button').text()).toBe('重试')
    wrapper.unmount()
  })

  it('冷启动的文档加载预算不吃掉交手机会', async () => {
    const wrapper = mountFrame()
    // 文档加载花了远超握手时限（5s）的时间：这期间不该被判失败
    vi.advanceTimersByTime(14_000)
    await flushPromises()
    expect(wrapper.attributes('data-state')).toBe('connecting')
    expect(wrapper.text()).not.toContain('卡片未能与宿主完成握手')

    // 文档就位后仍拿得到完整的交手预算
    const frame = wrapper.find('iframe').element
    frame.dispatchEvent(new Event('load'))
    await flushPromises()
    vi.advanceTimersByTime(4_999)
    await flushPromises()
    expect(wrapper.attributes('data-state')).toBe('connecting')
    wrapper.unmount()
  })

  it('伪造的回信不会把卡片骗成 ready', async () => {
    const wrapper = mountFrame()
    const frame = wrapper.find('iframe').element
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_READY, nonce: 'guessed', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION },
        source: frame.contentWindow,
      }),
    )
    await exhaustHandshakeAttempts(wrapper)

    expect(wrapper.text()).toContain('卡片未能与宿主完成握手')
    wrapper.unmount()
  })

  it('重试重建 iframe 重新握手，失败仍然只影响这一张卡', async () => {
    const wrapper = mountFrame()
    await exhaustHandshakeAttempts(wrapper)
    await wrapper.find('button').trigger('click')

    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.attributes('data-state')).toBe('connecting')

    await exhaustHandshakeAttempts(wrapper)
    expect(wrapper.attributes('data-state')).toBe('error')
    wrapper.unmount()
  })

  it('宿主没有沙箱源时直接给部署错误，不给重试', () => {
    const wrapper = mountFrame({ source: null })
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('当前宿主未接入卡片沙箱')
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
})

/**
 * H5 的第二个源（票 06 第 5 条）：握手超时既可能是卡片起不来，也可能是那个端口没人监听。
 * 后者要说清"去暴露第二个端口"，并且仍然给重试 —— 不能留一个永久空白的 iframe。
 */
describe('第二个源不可达时给出可诊断的部署错误', () => {
  const H5_SOURCE = {
    baseUrl: 'http://192.168.1.20:8081',
    docUrl: `http://192.168.1.20:8081${GENUI_SANDBOX_DOC_PATH}`,
    kind: 'h5' as const,
  }

  it('探不到沙箱源时换成部署错误说明，并保留重试', async () => {
    const fetchStub = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchStub)
    try {
      const wrapper = mountFrame({ source: H5_SOURCE })
      await exhaustHandshakeAttempts(wrapper)
      await flushPromises()

      // 静默重挂那一次不做可达性探测：源还没被判死，先给它一次自重机会
      expect(fetchStub).toHaveBeenCalledTimes(1)
      expect(fetchStub).toHaveBeenCalledWith(
        `http://192.168.1.20:8081${GENUI_SANDBOX_DOC_PATH}`,
        expect.objectContaining({ mode: 'no-cors', credentials: 'omit' }),
      )
      expect(wrapper.find('iframe').exists()).toBe(false)
      expect(wrapper.text()).toContain('卡片沙箱源无法访问')
      expect(wrapper.find('button').text()).toBe('重试')
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('源探得到时保留原来的握手说明，不跟着喊部署问题', async () => {
    const fetchStub = vi.fn().mockResolvedValue({ type: 'opaque' })
    vi.stubGlobal('fetch', fetchStub)
    try {
      const wrapper = mountFrame({ source: H5_SOURCE })
      await exhaustHandshakeAttempts(wrapper)
      await flushPromises()

      expect(fetchStub).toHaveBeenCalled()
      expect(wrapper.text()).toContain('卡片未能与宿主完成握手')
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('桌面的两个宿主不探测：那个源不是靠端口找得到的', async () => {
    const fetchStub = vi.fn().mockResolvedValue({})
    vi.stubGlobal('fetch', fetchStub)
    try {
      const wrapper = mountFrame()
      await exhaustHandshakeAttempts(wrapper)
      await flushPromises()

      expect(fetchStub).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('卡片未能与宿主完成握手')
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('重试后旧一次的探测结论不改写新一次的状态', async () => {
    let rejectProbe = true
    const fetchStub = vi.fn(async () => {
      if (rejectProbe) throw new TypeError('Failed to fetch')
      return { type: 'opaque' }
    })
    vi.stubGlobal('fetch', fetchStub)
    try {
      const wrapper = mountFrame({ source: H5_SOURCE })
      await exhaustHandshakeAttempts(wrapper)
      await flushPromises()
      expect(wrapper.text()).toContain('卡片沙箱源无法访问')

      // 运维把端口暴露上了之后再重试：这一次探测得到响应，卡片回到"握手没完成"的原始说明
      rejectProbe = false
      await wrapper.find('button').trigger('click')
      await flushPromises()
      await exhaustHandshakeAttempts(wrapper)
      await flushPromises()

      expect(wrapper.text()).toContain('卡片未能与宿主完成握手')
      expect(wrapper.text()).not.toContain('卡片沙箱源无法访问')
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('卡片高度跟随内容', () => {
  /**
   * 桥自己生成随机密钥，测试里要拿到同一个值才能伪装沙箱回信。
   * 直接在挂载前把 randomUUID 钉成固定串，比拦截注入消息可靠 —— jsdom 里
   * postMessage 投给 iframe 不会回到父窗口。形状必须是 UUID，桥的类型就长这样。
   */
  const NONCE = '11111111-2222-3333-4444-555555555555'

  function mountHandedOver() {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(NONCE)
    const wrapper = mountFrame()
    const frame = wrapper.find('iframe').element
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_READY, nonce: NONCE, protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION },
        source: frame.contentWindow,
      }),
    )
    return { wrapper, frame }
  }

  function report(overrides: Record<string, unknown>) {
    const { wrapper, frame } = mountHandedOver()

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_SIZE, nonce: NONCE, ...overrides },
        source: frame.contentWindow,
      }),
    )
    return wrapper
  }

  it('沙箱报来内容高度后 iframe 收放到位，不留空白也不裁切', async () => {
    const wrapper = report({ height: 512 })
    await nextTick()

    expect(wrapper.find('iframe').attributes('style')).toContain('height: 512px')
    wrapper.unmount()
  })

  it('沙箱上报渲染失败时换成该卡的错误占位并可重试', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(NONCE)
    const wrapper = mountFrame()
    const frame = wrapper.find('iframe').element
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_READY, nonce: NONCE, protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION },
        source: frame.contentWindow,
      }),
    )
    await nextTick()
    expect(wrapper.attributes('data-state')).toBe('ready')

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_ERROR, nonce: NONCE },
        source: frame.contentWindow,
      }),
    )
    await nextTick()

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('卡片内容渲染失败')
    expect(wrapper.find('button').text()).toBe('重试')
    wrapper.unmount()
  })
})

describe('外壳跟随应用主题', () => {
  it('主题变化写进 data-theme，占位文案也跟着明暗', async () => {
    const wrapper = mountFrame()
    expect(wrapper.attributes('data-theme')).toBe('dark')
    await wrapper.setProps({ theme: 'light' })
    expect(wrapper.attributes('data-theme')).toBe('light')
    wrapper.unmount()
  })
})

describe('卡片动作与展开', () => {
  const NONCE = '11111111-2222-3333-4444-555555555555'

  async function mountReady(overrides: Record<string, unknown> = {}) {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(NONCE)
    const copyText = vi.fn(async () => {})
    const openExternal = vi.fn(async () => {})
    const wrapper = mountFrame({ actionPort: { copyText, openExternal }, ...overrides })
    const frame = wrapper.find('iframe').element as HTMLIFrameElement
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_READY, nonce: NONCE, protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION },
        source: frame.contentWindow,
      }),
    )
    await nextTick()
    return { wrapper, frame, copyText, openExternal }
  }

  function dispatchAction(frame: HTMLIFrameElement, data: Record<string, unknown>) {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_ACTION, nonce: NONCE, ...data },
        source: frame.contentWindow,
      }),
    )
  }

  it('复制动作交给平台适配器，卡片保持可用', async () => {
    const { wrapper, frame, copyText } = await mountReady()

    dispatchAction(frame, { action: 'copy', payload: { text: '你好' } })
    await flushPromises()

    expect(copyText).toHaveBeenCalledWith('你好')
    expect(wrapper.find('iframe').exists()).toBe(true)
    wrapper.unmount()
  })

  it('复制失败时显示可见错误，卡片本身不消失', async () => {
    const { wrapper, frame, copyText } = await mountReady()
    copyText.mockRejectedValueOnce(new Error('no clipboard'))

    dispatchAction(frame, { action: 'copy', payload: { text: '你好' } })
    await flushPromises()

    expect(wrapper.text()).toContain('复制失败')
    expect(wrapper.find('iframe').exists()).toBe(true)
    wrapper.unmount()
  })

  it('外链只经平台适配器打开', async () => {
    const { wrapper, frame, openExternal } = await mountReady()

    dispatchAction(frame, { action: 'openLink', payload: { url: 'https://example.com/docs' } })
    await flushPromises()

    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    wrapper.unmount()
  })

  it('非法协议与未知动作都不会触达平台适配器', async () => {
    const { wrapper, frame, copyText, openExternal } = await mountReady()

    dispatchAction(frame, { action: 'openLink', payload: { url: 'javascript:alert(1)' } })
    dispatchAction(frame, { action: 'shell', payload: { cmd: 'rm -rf /' } })
    await flushPromises()

    expect(openExternal).not.toHaveBeenCalled()
    expect(copyText).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('失败')
    wrapper.unmount()
  })

  it('动作迟迟没有回执时换成错误占位并可重试', async () => {
    const { wrapper, frame, copyText } = await mountReady()
    copyText.mockImplementationOnce(() => new Promise<void>(() => {}))

    dispatchAction(frame, { action: 'copy', payload: { text: '慢' } })
    await nextTick()
    vi.advanceTimersByTime(5_000)
    await flushPromises()

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('卡片动作超时')
    expect(wrapper.find('.genui-card-retry').text()).toBe('重试')
    wrapper.unmount()
  })

  it('展开在弹窗内新起沙箱，原 iframe 原地不动', async () => {
    const { wrapper, frame } = await mountReady()

    const expandButton = wrapper.find('.genui-card-expand')
    expect(expandButton.exists()).toBe(true)
    expect(expandButton.element.tagName).toBe('BUTTON')

    await expandButton.trigger('click')
    const frames = wrapper.findAll('iframe')
    expect(frames.length).toBe(2)
    expect(frames[0].element).toBe(frame)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(frames[1].element.getAttribute('src')).toBe(SOURCE.docUrl)
    expect(frames[1].element.getAttribute('sandbox')).toBe('allow-scripts')

    await wrapper.find('.genui-card-expand-close').trigger('click')
    expect(wrapper.findAll('iframe').length).toBe(1)
    expect(wrapper.find('iframe').element).toBe(frame)
    wrapper.unmount()
  })

  it('弹窗里的卡片不再显示展开控件', async () => {
    const { wrapper } = await mountReady({ expandable: false })

    expect(wrapper.find('.genui-card-expand').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('卡片提交回环', () => {
  const NONCE = '11111111-2222-3333-4444-555555555555'

  async function mountReady(overrides: Record<string, unknown> = {}) {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(NONCE)
    // 返回类型钉成端口的联合：否则 mock 只认成功形状，失败/忽略的用例过不了类型检查
    const submitCard = vi.fn(
      async (): Promise<GenuiCardSubmissionResult> => ({ status: 'submitted', summary: '已提交' }),
    )
    const wrapper = mountFrame({ submitCard, ...overrides })
    const frame = wrapper.find('iframe').element as HTMLIFrameElement
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_READY, nonce: NONCE, protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION },
        source: frame.contentWindow,
      }),
    )
    await nextTick()
    return { wrapper, frame, submitCard }
  }

  function dispatchAction(frame: HTMLIFrameElement, data: Record<string, unknown>) {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GENUI_MSG_ACTION, nonce: NONCE, ...data },
        source: frame.contentWindow,
      }),
    )
  }

  it('submit 把 payload 交给宿主提交端口，卡片保持可用', async () => {
    const { wrapper, frame, submitCard } = await mountReady()

    dispatchAction(frame, { action: 'submit', payload: { name: '张三' } })
    await flushPromises()

    expect(submitCard).toHaveBeenCalledWith({ name: '张三' })
    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('失败')
    wrapper.unmount()
  })

  it('提交失败时卡片保持可编辑并显示可重试错误', async () => {
    const { wrapper, frame, submitCard } = await mountReady()
    submitCard.mockResolvedValueOnce({ status: 'failed', reason: 'oversized' })

    dispatchAction(frame, { action: 'submit', payload: { blob: 'x' } })
    await flushPromises()

    expect(wrapper.text()).toContain('超过 64KB')
    expect(wrapper.find('iframe').exists()).toBe(true)
    wrapper.unmount()
  })

  it('端口拒绝时显示发送失败，不把整张卡换成错误占位', async () => {
    const { wrapper, frame, submitCard } = await mountReady()
    submitCard.mockRejectedValueOnce(new Error('engine unavailable'))

    dispatchAction(frame, { action: 'submit', payload: { name: '张三' } })
    await flushPromises()

    expect(wrapper.text()).toContain('提交发送失败')
    expect(wrapper.find('iframe').exists()).toBe(true)
    wrapper.unmount()
  })

  it('桥在 64KB 闸门处拒绝的 submit 直接给出可见错误，不触达提交端口', async () => {
    const { wrapper, frame, submitCard } = await mountReady()

    dispatchAction(frame, { action: 'submit', payload: { blob: 'x'.repeat(64 * 1024) } })
    await flushPromises()

    expect(submitCard).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('超过 64KB')
    wrapper.unmount()
  })

  it('已提交的卡片只读：遮罩可见、iframe 不可交互、再次提交被忽略', async () => {
    const submittedCard = {
      ...CARD,
      submitted: { summary: '已提交卡片「报名表」，共 1 个字段', submittedAt: 1 },
    }
    const { wrapper, frame, submitCard } = await mountReady({ card: submittedCard })

    expect(wrapper.attributes('data-submitted')).toBe('true')
    expect(wrapper.find('.genui-card-submitted').text()).toContain('已提交')
    expect(wrapper.find('iframe').attributes('inert')).toBeDefined()

    dispatchAction(frame, { action: 'submit', payload: { name: '李四' } })
    await flushPromises()

    expect(submitCard).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

