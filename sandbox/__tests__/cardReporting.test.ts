/**
 * 沙箱文档侧的失败与高度上报（票 02 第 8 条的另一半）。
 *
 * 宿主桥的测试只钉住「收到什么消息怎么处理」；这里钉住文档真的把渲染失败与内容高度
 * 经握手端口发回给宿主，并且带着本卡密钥 —— 否则宿主只会留一张空白 iframe。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { h } from 'vue'
import {
  GENUI_MSG_ACTION,
  GENUI_MSG_ERROR,
  GENUI_MSG_INIT,
  GENUI_MSG_READY,
  GENUI_MSG_SIZE,
  GENUI_SANDBOX_PROTOCOL_VERSION,
  type GenuiTheme,
} from '@/shared/genuiSandbox'

// 同握手用例：这条测试跑开发形态的文档源码，`__GENUI_DEBUG__` 由构建期的 esbuild define
// 注入，vitest 直接 import 时这里自己钉住（fixture 卡与自检件因此在渲染分支里）。
vi.stubGlobal('__GENUI_DEBUG__', true)

// 与握手用例同理：物料替身让这条测试只跑编排，不背上官方 SDK 的构建时间。
vi.mock('../cardMaterials', () => ({
  renderOfficialCard: (context: {
    schema: Record<string, unknown>
    notifyFailure: () => void
    requestAction: (action: string, payload?: unknown) => void
  }) => {
    if (context.schema.componentName === 'FailCard') context.notifyFailure()
    if (context.schema.componentName === 'ActionCard') {
      context.requestAction('copy', { text: '复制我' })
    }
    return h('div', { class: 'stub-card' }, String(context.schema.componentName ?? ''))
  },
}))

const NONCE = 'nonce-report'

type Reply = {
  type: string
  nonce?: string
  height?: number
  protocolVersion?: number
  action?: string
  payload?: unknown
}

function initMessage(componentName: string) {
  return {
    type: GENUI_MSG_INIT,
    nonce: NONCE,
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    theme: 'light' as GenuiTheme,
    locale: 'zh-CN',
    schema: { componentName, props: { text: '按钮' } },
  }
}

/**
 * 重新载入沙箱文档并投一次 init。模块级 session 只认第一次注入，所以每个用例都要
 * resetModules；端口消息由事件循环投递，等一拍再断言。
 */
async function openCard(componentName: string, height?: number): Promise<{ replies: Reply[] }> {
  vi.resetModules()
  document.body.innerHTML = '<div id="card" class="card"></div>'
  const container = document.getElementById('card')!
  if (height !== undefined) {
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: height })
  }
  await import('../main')

  const channel = new MessageChannel()
  const replies: Reply[] = []
  channel.port1.onmessage = (event: MessageEvent) => replies.push(event.data as Reply)
  window.dispatchEvent(
    new MessageEvent('message', { data: initMessage(componentName), ports: [channel.port2] }),
  )
  await new Promise((resolveTick) => setTimeout(resolveTick, 0))
  channel.port1.close()
  return { replies }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

/**
 * jsdom 没有 ResizeObserver。沙箱文档里它一定存在（真实浏览器/Electron 都有），
 * 所以产品代码不为它兜底；缺的是测试环境，就在这里补一个会在 observe 时回调一次的替身。
 */
beforeAll(() => {
  class StubResizeObserver {
    constructor(private readonly callback: () => void) {}

    observe(): void {
      this.callback()
    }

    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: StubResizeObserver, configurable: true })
})

describe('沙箱向宿主上报渲染结果', () => {
  it('渲染成功时把 ready 与内容高度经握手端口报给宿主', async () => {
    const { replies } = await openCard('TinyButton', 386)

    expect(replies).toContainEqual({
      type: GENUI_MSG_READY,
      nonce: NONCE,
      protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    })
    expect(replies).toContainEqual({ type: GENUI_MSG_SIZE, nonce: NONCE, height: 386 })
    expect(document.querySelector('.stub-card')?.textContent).toBe('TinyButton')
  })

  it('渲染失败时上报 genui:error，让宿主换成错误占位', async () => {
    const { replies } = await openCard('FailCard')

    const failure = replies.find(reply => reply.type === GENUI_MSG_ERROR)
    expect(failure).toBeDefined()
    expect(failure?.nonce).toBe(NONCE)
  })

  it('卡片的动作经握手端口发回宿主，并带本卡密钥', async () => {
    const { replies } = await openCard('ActionCard')

    expect(replies).toContainEqual({
      type: GENUI_MSG_ACTION,
      nonce: NONCE,
      action: 'copy',
      payload: { text: '复制我' },
    })
  })

  it('真实卡片不走 fixture 的自检渲染', async () => {
    await openCard('TinyButton')

    // 自检面板只属于票 01 的 fixture 卡，真实卡片下方不该多出一堆调试行
    expect(document.querySelector('.card-section-title')).toBeNull()
  })

  it('fixture 卡仍然带出自检面板与标题', async () => {
    const { replies } = await openCard('FixtureCard')

    expect(document.querySelector('.card-section-title')).not.toBeNull()
    expect(replies.some(reply => reply.type === GENUI_MSG_READY)).toBe(true)
    // fixture 没有真实内容高度可言，不该把宿主 iframe 收成一条线
    expect(replies.some(reply => reply.type === GENUI_MSG_SIZE)).toBe(false)
  })
})
