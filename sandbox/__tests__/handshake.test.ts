/**
 * 沙箱文档侧的握手往返（票 01 第 7 条的另一半）。
 *
 * 宿主桥的测试只钉住"宿主发了什么、接受了什么"；这里钉住文档落地后的行为：
 * 端口消息必须真的被消费。曾经漏掉的正是这一点 —— 端口上的 message 不派发
 * 到 window，只监听 window 会让主题与语言推送静默丢失。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { h } from 'vue'
import {
  GENUI_MSG_INIT,
  GENUI_MSG_READY,
  GENUI_MSG_THEME,
  GENUI_SANDBOX_PROTOCOL_VERSION,
  type GenuiTheme,
} from '@/shared/genuiSandbox'

// 这条测试钉的是握手，不是物料。官方渲染器的依赖链有 2000 多个模块，真导进来会让
// 一个握手用例背上半分钟的构建时间；替身渲染同样走 mountGenuiCard 这条编排缝。
vi.mock('../cardMaterials', () => ({
  renderOfficialCard: (context: { schema: Record<string, unknown>; notifyFailure: () => void }) => {
    // 让用例能用组件名点名叫到失败路径，其余走正常渲染
    if (context.schema.componentName === 'FailCard') context.notifyFailure()
    return h('div', { class: 'stub-card' }, String(context.schema.componentName ?? ''))
  },
}))

type Envelope = { type: string; nonce?: string; protocolVersion?: number; theme?: GenuiTheme }

const NONCE = 'nonce-a'

function initMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: GENUI_MSG_INIT,
    nonce: NONCE,
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    theme: 'dark' as GenuiTheme,
    locale: 'zh-CN',
    schema: { componentName: 'FixtureCard', title: 'fixture title', rows: [{ label: 'k', value: 'v' }] },
    ...overrides,
  }
}

/** 端口消息由事件循环投递，等一拍再断言。 */
async function settle(): Promise<void> {
  await new Promise((resolveTick) => setTimeout(resolveTick, 0))
}

async function sendToSandbox(message: unknown, ports: MessagePort[] = []): Promise<void> {
  window.dispatchEvent(new MessageEvent('message', { data: message, ports }))
  await settle()
}

beforeAll(async () => {
  document.body.innerHTML = '<div id="card"></div>'
  document.documentElement.removeAttribute('data-theme')
  await import('../main')
})

describe('沙箱文档与宿主的握手', () => {
  it('没有随行端口的 init 不应答，带端口的 init 用端口回 ready 并声明协议版本', async () => {
    const silent = new MessageChannel()
    const silentReplies: Envelope[] = []
    silent.port1.onmessage = (event: MessageEvent) => silentReplies.push(event.data as Envelope)
    await sendToSandbox(initMessage(), [])
    expect(silentReplies).toEqual([])

    const channel = new MessageChannel()
    const replies: Envelope[] = []
    channel.port1.onmessage = (event: MessageEvent) => replies.push(event.data as Envelope)
    await sendToSandbox(initMessage(), [channel.port2])

    expect(replies).toEqual([{ type: GENUI_MSG_READY, nonce: NONCE, protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION }])
    expect(document.getElementById('card')?.textContent).toContain('fixture title')
    expect(document.documentElement.dataset.theme).toBe('dark')

    // 之后宿主经同一端口推送主题与语言：端口消息不经过 window，必须被消费
    channel.port1.postMessage({ type: GENUI_MSG_THEME, nonce: NONCE, theme: 'light', locale: 'en-US' })
    await settle()
    expect(document.documentElement.dataset.theme).toBe('light')

    // nonce 不对的推送忽略掉，不改主题
    channel.port1.postMessage({ type: GENUI_MSG_THEME, nonce: 'other-card', theme: 'dark', locale: 'zh-CN' })
    await settle()
    expect(document.documentElement.dataset.theme).toBe('light')

    // 第二张卡的 init 不能接管这张已握手的卡
    const hijack = new MessageChannel()
    const hijackReplies: Envelope[] = []
    hijack.port1.onmessage = (event: MessageEvent) => hijackReplies.push(event.data as Envelope)
    await sendToSandbox(initMessage({ nonce: 'nonce-b' }), [hijack.port2])
    expect(hijackReplies).toEqual([])

    channel.port1.close()
    silent.port1.close()
    hijack.port1.close()
  })
})
