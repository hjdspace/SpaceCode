/**
 * 宿主桥的握手与安全闸门（票 01 第 7、8 条）。
 *
 * 只断言外部可观察行为：注入给沙箱的消息里有什么、哪条回信被接受、哪条被忽略、
 * 超时与版本不匹配落到哪个状态。iframe、MessageChannel、window 与定时器全部注入，
 * 于是这条安全边界能脱离真实 Electron 进程钉住（见 ADR 0011：修缝而不是抄实现）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive } from 'vue'
import {
  GENUI_MSG_ACTION,
  GENUI_MSG_ERROR,
  GENUI_MSG_INIT,
  GENUI_MSG_READY,
  GENUI_MSG_SIZE,
  GENUI_MSG_THEME,
  GENUI_SANDBOX_PROTOCOL_VERSION,
} from '@/shared/genuiSandbox'
import { createCardBridge, GENUI_MAX_FRAME_HEIGHT, type CardBridgeState, type CardFrameLike, type HostMessageSource } from '../cardBridge'

const NONCE = 'host-nonce'

type Posted = { message: unknown; targetOrigin: string; transfer: unknown[] }

function createFakeFrame() {
  const posted: Posted[] = []
  const frameListeners = new Map<string, Set<(event: unknown) => void>>()
  const frame: CardFrameLike & { posted: Posted[]; emit: (type: 'load' | 'error') => void; listenerCount: (type: string) => number } = {
    contentWindow: {
      postMessage: (message, targetOrigin, transfer) => {
        posted.push({ message, targetOrigin, transfer: transfer ?? [] })
      },
    },
    addEventListener: (type, listener) => {
      if (!frameListeners.has(type)) frameListeners.set(type, new Set())
      frameListeners.get(type)!.add(listener as (event: unknown) => void)
    },
    removeEventListener: (type, listener) => {
      frameListeners.get(type)?.delete(listener as (event: unknown) => void)
    },
    posted,
    emit: (type) => {
      for (const listener of frameListeners.get(type) ?? []) listener({})
    },
    listenerCount: (type) => (frameListeners.get(type) ?? new Set()).size,
  }
  return frame
}

function createFakeHostWindow() {
  const listeners = new Set<(event: MessageEvent) => void>()
  return {
    addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => {
      listeners.delete(listener)
    },
    /** 模拟一次 message 事件抵达宿主窗口：只填桥真正读取的两个字段 */
    dispatch: (event: { source?: unknown; data?: unknown }) => {
      for (const listener of [...listeners]) listener(event as unknown as MessageEvent)
    },
    listenerCount: () => listeners.size,
  } satisfies HostMessageSource & { dispatch: (event: { source?: unknown; data?: unknown }) => void; listenerCount: () => number }
}

function createFakeChannel() {
  const toSandbox: unknown[] = []
  const port1 = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: vi.fn((message: unknown) => {
      toSandbox.push(message)
    }),
    close: vi.fn(),
  }
  const port2 = { onmessage: null, postMessage: vi.fn(), close: vi.fn() }
  return { channel: { port1, port2 } as unknown as MessageChannel, toSandbox, port1, port2 }
}

function createBridge(overrides: Partial<Parameters<typeof createCardBridge>[0]> = {}) {
  const iframe = createFakeFrame()
  const hostWindow = createFakeHostWindow()
  const { channel, toSandbox, port1, port2 } = createFakeChannel()
  const states: CardBridgeState[] = []
  const bridge = createCardBridge({
    iframe,
    hostWindow,
    createChannel: () => channel,
    nonce: NONCE,
    schema: { componentName: 'TinyForm' },
    theme: 'dark',
    locale: 'zh-CN',
    onStateChange: (state) => states.push(state),
    ...overrides,
  })
  return { bridge, iframe, hostWindow, states, toSandbox, port1, port2 }
}

function readyPayload(overrides: Record<string, unknown> = {}) {
  return { type: GENUI_MSG_READY, nonce: NONCE, protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION, ...overrides }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('注入方向', () => {
  it('start 只挂监听，等 frame 的 load 才把 nonce、协议版本、主题、语言与 Schema 交给沙箱', () => {
    const { bridge, iframe, port2 } = createBridge()
    bridge.start()
    // iframe 一插进 DOM，contentWindow 指的是还没被换掉的初始空文档：现在投等于投进黑洞，
    // 而端口已经转移走、补发不了，这张卡只能等到握手超时。
    expect(iframe.posted).toHaveLength(0)

    iframe.emit('load')
    expect(iframe.posted).toHaveLength(1)
    const [init] = iframe.posted
    expect(init?.message).toEqual({
      type: GENUI_MSG_INIT,
      nonce: NONCE,
      protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
      theme: 'dark',
      locale: 'zh-CN',
      schema: { componentName: 'TinyForm' },
    })
    // opaque origin 无法用 targetOrigin 精确匹配，只能 '*'；密钥本身才是闸门
    expect(init?.targetOrigin).toBe('*')
    expect(init?.transfer).toEqual([port2])
  })

  it('响应式 Schema 在投递前被归一成可结构化克隆的普通对象', () => {
    const schema = reactive({
      componentName: 'TinyForm',
      children: [{ componentName: 'TinyInput' }],
    })
    const { bridge, iframe } = createBridge({
      schema: schema as unknown as Record<string, unknown>,
    })
    bridge.start()
    iframe.emit('load')

    const [init] = iframe.posted
    expect(init).toBeDefined()
    // Proxy 直接进 postMessage 会抛 DataCloneError；这里用同一套结构化克隆验证
    expect(() => structuredClone(init!.message)).not.toThrow()
    const message = init!.message as { schema: Record<string, unknown> }
    expect(message.schema).not.toBe(schema)
    expect(message.schema.children).not.toBe(schema.children)
    expect(message.schema).toEqual({
      componentName: 'TinyForm',
      children: [{ componentName: 'TinyInput' }],
    })
  })

  it('start 之前不投递任何消息', () => {
    const { iframe, hostWindow } = createBridge()
    expect(iframe.posted).toHaveLength(0)
    expect(hostWindow.listenerCount()).toBe(0)
  })

  it('文档 load 事件不会重复注入 —— 密钥只发一次', () => {
    const { bridge, iframe } = createBridge()
    bridge.start()
    iframe.emit('load')
    iframe.emit('load')
    expect(iframe.posted).toHaveLength(1)
  })

  it('load 之后才回 ready 的完整握手路径', () => {
    const { bridge, iframe, hostWindow, states } = createBridge()
    bridge.start()
    iframe.emit('load')
    hostWindow.dispatch({ source: iframe.contentWindow, data: readyPayload() })
    expect(states[states.length - 1]).toEqual({ status: 'ready', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION })
  })
})

describe('握手回信', () => {
  it('来源与 nonce 都匹配的 ready 让卡片进入 ready 并带回协议版本', () => {
    const { bridge, iframe, hostWindow, states } = createBridge()
    bridge.start()
    hostWindow.dispatch({ source: iframe.contentWindow, data: readyPayload() })

    expect(states).toEqual([{ status: 'connecting' }, { status: 'ready', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION }])
  })

  it('通道上的 ready 同样被接受（沙箱用转移过去的端口回信）', () => {
    const { bridge, port1, states } = createBridge()
    bridge.start()
    port1.onmessage?.({ data: readyPayload() })

    expect(states[states.length - 1]).toEqual({ status: 'ready', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION })
  })

  it('nonce 不匹配的回信被忽略，卡片继续等待', () => {
    const { bridge, iframe, hostWindow, port1, states } = createBridge()
    bridge.start()
    hostWindow.dispatch({ source: iframe.contentWindow, data: readyPayload({ nonce: 'guessed-nonce' }) })
    port1.onmessage?.({ data: readyPayload({ nonce: '' }) })

    expect(states).toEqual([{ status: 'connecting' }])
  })

  it('来源不是这张卡片的回信即使 nonce 正确也被忽略', () => {
    const { bridge, hostWindow, states } = createBridge()
    bridge.start()
    hostWindow.dispatch({ source: { not: 'this-frame' }, data: readyPayload() })

    expect(states).toEqual([{ status: 'connecting' }])
  })

  it('不属于卡片协议的消息（例如设计预览桥）一律忽略', () => {
    const { bridge, iframe, hostWindow, states } = createBridge()
    bridge.start()
    hostWindow.dispatch({ source: iframe.contentWindow, data: { type: 'design-preview:resize', nonce: NONCE } })
    hostWindow.dispatch({ source: iframe.contentWindow, data: undefined })
    hostWindow.dispatch({ source: iframe.contentWindow, data: { type: GENUI_MSG_READY } })

    expect(states).toEqual([{ status: 'connecting' }])
  })

  it('协议版本不匹配落到可见错误而不是渲染半张卡', () => {
    const { bridge, iframe, hostWindow, states } = createBridge()
    bridge.start()
    hostWindow.dispatch({ source: iframe.contentWindow, data: readyPayload({ protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION + 1 }) })

    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'version-mismatch' })
  })
})

describe('失败收口', () => {
  it('Schema 无法序列化时落到 render-failed，不让异常穿出 mounted hook', () => {
    const circular: Record<string, unknown> = { componentName: 'TinyForm' }
    circular.self = circular
    const { bridge, states } = createBridge({ schema: circular })

    expect(() => bridge.start()).not.toThrow()
    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'render-failed' })
  })

  it('文档 load 后不回 ready 才落到 handshake-timeout 错误态', () => {
    const { bridge, iframe, states } = createBridge()
    bridge.start()
    iframe.emit('load')
    vi.advanceTimersByTime(5_000)

    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'handshake-timeout' })
  })

  it('沙箱文档没加载完不算卡片慢：握手预算从 Schema 真正投递出去才开始计时', () => {
    const { bridge, states } = createBridge()
    bridge.start()
    // 一次都不 emit('load')：5 秒过去只是文档还没就位
    vi.advanceTimersByTime(5_000)
    expect(states[states.length - 1]?.status).toBe('connecting')

    // 文档终于就位，此时才给它 5 秒的交手机会
    bridge.dispose()
  })

  it('文档加载超预算才收口成握手失败，且用的是可注入的加载预算', () => {
    const { bridge, states } = createBridge({ bootTimeoutMs: 2_000 })
    bridge.start()
    vi.advanceTimersByTime(1_999)
    expect(states[states.length - 1]?.status).toBe('connecting')
    vi.advanceTimersByTime(1)
    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'handshake-timeout' })
  })

  it('加载耗时不吃掉握手预算：慢加载之后卡片仍有完整 5 秒', () => {
    const { bridge, iframe, hostWindow, states } = createBridge()
    bridge.start()
    vi.advanceTimersByTime(14_000)
    iframe.emit('load')
    hostWindow.dispatch({ source: iframe.contentWindow, data: readyPayload() })

    expect(states[states.length - 1]).toEqual({ status: 'ready', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION })
  })

  it('握手成功后撤掉超时，卡片不会因为读得慢而翻成错误', () => {
    const { bridge, iframe, hostWindow, states } = createBridge()
    bridge.start()
    hostWindow.dispatch({ source: iframe.contentWindow, data: readyPayload() })
    vi.advanceTimersByTime(60_000)

    expect(states.filter((s) => s.status === 'error')).toHaveLength(0)
  })

  it('iframe 加载失败落 frame-load-failed，且早于超时', () => {
    const { bridge, iframe, states } = createBridge()
    bridge.start()
    iframe.emit('error')

    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'frame-load-failed' })
    expect(iframe.listenerCount('error')).toBe(1)
  })

  it('错误之后不再接受任何回信，同一张卡只会被重试路径复活', () => {
    const { bridge, iframe, hostWindow, port1, states } = createBridge()
    bridge.start()
    iframe.emit('error')
    hostWindow.dispatch({ source: iframe.contentWindow, data: readyPayload() })
    port1.onmessage?.({ data: readyPayload() })

    expect(states.filter((s) => s.status === 'error')).toHaveLength(1)
    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'frame-load-failed' })
  })

  it('交手时限可注入，默认 5 秒', () => {
    const { bridge, iframe, states } = createBridge({ handshakeTimeoutMs: 1_000 })
    bridge.start()
    iframe.emit('load')
    vi.advanceTimersByTime(999)
    expect(states[states.length - 1]?.status).toBe('connecting')
    vi.advanceTimersByTime(1)
    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'handshake-timeout' })
  })
})

describe('主题与语言推送', () => {
  it('推送走已建立的通道并复用同一密钥', () => {
    const { bridge, iframe, hostWindow, toSandbox } = createBridge()
    bridge.start()
    hostWindow.dispatch({ source: iframe.contentWindow, data: readyPayload() })

    bridge.pushAppearance({ theme: 'light', locale: 'en-US' })
    expect(toSandbox).toContainEqual({ type: GENUI_MSG_THEME, nonce: NONCE, theme: 'light', locale: 'en-US' })
  })

  it('未握手时不推送 —— 沙箱还不认识这个端口', () => {
    const { bridge, toSandbox } = createBridge()
    bridge.start()
    bridge.pushAppearance({ theme: 'light', locale: 'en-US' })
    expect(toSandbox).toHaveLength(0)
  })
})

describe('沙箱上报：渲染失败与高度', () => {
  function withReady(overrides: Parameters<typeof createBridge>[0] = {}) {
    const ctx = createBridge(overrides)
    ctx.bridge.start()
    ctx.hostWindow.dispatch({ source: ctx.iframe.contentWindow, data: readyPayload() })
    return ctx
  }

  it('沙箱渲染抛错落到这张卡的 render-failed 错误态，其余卡不受影响', () => {
    const { iframe, hostWindow, states } = withReady()
    hostWindow.dispatch({ source: iframe.contentWindow, data: { type: GENUI_MSG_ERROR, nonce: NONCE } })

    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'render-failed' })
  })

  it('通道里的 error 上报同样被接受，nonce 对不上则忽略', () => {
    const { port1, states } = withReady()
    port1.onmessage?.({ data: { type: GENUI_MSG_ERROR, nonce: 'other-card-nonce' } })
    expect(states[states.length - 1]).toEqual({ status: 'ready', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION })

    port1.onmessage?.({ data: { type: GENUI_MSG_ERROR, nonce: NONCE } })
    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'render-failed' })
  })

  it('来源不是这张卡的 error 上报被忽略', () => {
    const { hostWindow, states } = withReady()
    hostWindow.dispatch({ source: { not: 'this-frame' }, data: { type: GENUI_MSG_ERROR, nonce: NONCE } })

    expect(states).toHaveLength(2)
    expect(states[states.length - 1]).toEqual({ status: 'ready', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION })
  })

  it('握手前就上报的错也算这张卡起不来', () => {
    const { bridge, iframe, hostWindow, states } = createBridge()
    bridge.start()
    hostWindow.dispatch({ source: iframe.contentWindow, data: { type: GENUI_MSG_ERROR, nonce: NONCE } })

    expect(states[states.length - 1]).toEqual({ status: 'error', failure: 'render-failed' })
    // 已经收口的卡片不再被超时翻第二次
    vi.advanceTimersByTime(60_000)
    expect(states.filter((s) => s.status === 'error')).toHaveLength(1)
  })

  it('尺寸上报转成宿主可用的高度，不改卡片状态', () => {
    const onResize = vi.fn()
    const { bridge, port1, states } = withReady({ onResize })
    port1.onmessage?.({ data: { type: GENUI_MSG_SIZE, nonce: NONCE, height: 421 } })

    expect(onResize).toHaveBeenCalledWith(421)
    expect(states[states.length - 1]).toEqual({ status: 'ready', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION })
    bridge.dispose()
  })

  it('非数字高度与缺字段都不转给宿主', () => {
    const onResize = vi.fn()
    const { port1 } = withReady({ onResize })
    port1.onmessage?.({ data: { type: GENUI_MSG_SIZE, nonce: NONCE, height: '420' } })
    port1.onmessage?.({ data: { type: GENUI_MSG_SIZE, nonce: NONCE } })
    port1.onmessage?.({ data: { type: GENUI_MSG_SIZE, nonce: NONCE, height: 0 } })
    port1.onmessage?.({ data: { type: GENUI_MSG_SIZE, nonce: NONCE, height: -50 } })

    expect(onResize).not.toHaveBeenCalled()
  })

  it('沙箱报来的离谱高度在桥口就被夹住', () => {
    const onResize = vi.fn()
    const { port1 } = withReady({ onResize })
    port1.onmessage?.({ data: { type: GENUI_MSG_SIZE, nonce: NONCE, height: 9_000_000 } })

    expect(onResize).toHaveBeenCalledWith(GENUI_MAX_FRAME_HEIGHT)
  })

  it('dispose 后停止接收上报', () => {
    const onResize = vi.fn()
    const { bridge, iframe, hostWindow } = withReady({ onResize })
    bridge.dispose()
    hostWindow.dispatch({ source: iframe.contentWindow, data: { type: GENUI_MSG_SIZE, nonce: NONCE, height: 20 } })

    expect(onResize).not.toHaveBeenCalled()
  })
})

describe('dispose', () => {
  it('摘掉窗口监听与 iframe 监听、关闭端口，之后的回信不再改变状态', () => {
    const { bridge, iframe, hostWindow, port1, states } = createBridge()
    bridge.start()
    bridge.dispose()

    expect(hostWindow.listenerCount()).toBe(0)
    expect(iframe.listenerCount('error')).toBe(0)
    expect(iframe.listenerCount('load')).toBe(0)
    expect(port1.close).toHaveBeenCalledTimes(1)

    hostWindow.dispatch({ source: iframe.contentWindow, data: readyPayload() })
    vi.advanceTimersByTime(60_000)
    expect(states).toEqual([{ status: 'connecting' }])
  })
})

describe('卡片动作路由', () => {
  function withReady(overrides: Parameters<typeof createBridge>[0] = {}) {
    const onAction = vi.fn()
    const onIgnoredMessage = vi.fn()
    const ctx = createBridge({ onAction, onIgnoredMessage, ...overrides })
    ctx.bridge.start()
    ctx.hostWindow.dispatch({ source: ctx.iframe.contentWindow, data: readyPayload() })
    return { ...ctx, onAction, onIgnoredMessage }
  }

  function actionPayload(overrides: Record<string, unknown> = {}) {
    return { type: GENUI_MSG_ACTION, nonce: NONCE, action: 'copy', payload: { text: 'hi' }, ...overrides }
  }

  it('白名单动作经已握手通道抵达宿主，卡片状态不变', () => {
    const { iframe, hostWindow, port1, onAction, states } = withReady()
    hostWindow.dispatch({ source: iframe.contentWindow, data: actionPayload() })

    expect(onAction).toHaveBeenCalledWith({ action: 'copy', text: 'hi' })
    expect(states[states.length - 1]).toEqual({ status: 'ready', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION })

    port1.onmessage?.({ data: actionPayload({ action: 'openLink', payload: { url: 'https://x.dev' } }) })
    expect(onAction).toHaveBeenLastCalledWith({ action: 'openLink', url: 'https://x.dev' })
  })

  it('白名单之外的动作被丢弃并记录，不转发', () => {
    const { iframe, hostWindow, onAction, onIgnoredMessage } = withReady()
    hostWindow.dispatch({ source: iframe.contentWindow, data: actionPayload({ action: 'shell', payload: { cmd: 'rm -rf /' } }) })

    expect(onAction).not.toHaveBeenCalled()
    expect(onIgnoredMessage).toHaveBeenCalledWith({ type: 'action', reason: 'unknown-action' })
  })

  it('非法外链协议被丢弃并记录', () => {
    const { iframe, hostWindow, onAction, onIgnoredMessage } = withReady()
    hostWindow.dispatch({
      source: iframe.contentWindow,
      data: actionPayload({ action: 'openLink', payload: { url: 'javascript:alert(1)' } }),
    })

    expect(onAction).not.toHaveBeenCalled()
    expect(onIgnoredMessage).toHaveBeenCalledWith({ type: 'action', reason: 'invalid-payload' })
  })

  it('超过桥消息上限的 payload 被丢弃并记录', () => {
    const { iframe, hostWindow, onAction, onIgnoredMessage } = withReady({ maxMessageBytes: 128 })
    hostWindow.dispatch({
      source: iframe.contentWindow,
      data: actionPayload({ action: 'submit', payload: { blob: 'x'.repeat(256) } }),
    })

    expect(onAction).not.toHaveBeenCalled()
    expect(onIgnoredMessage).toHaveBeenCalledWith({ type: 'action', reason: 'oversized' })
  })

  it('nonce 或来源不匹配的动作一律丢弃，也不产生记录噪音', () => {
    const { iframe, hostWindow, onAction, onIgnoredMessage } = withReady()
    hostWindow.dispatch({ source: { not: 'this-frame' }, data: actionPayload() })
    hostWindow.dispatch({ source: iframe.contentWindow, data: actionPayload({ nonce: 'guessed' }) })

    expect(onAction).not.toHaveBeenCalled()
    expect(onIgnoredMessage).not.toHaveBeenCalled()
  })

  it('握手完成前的动作不执行', () => {
    const onAction = vi.fn()
    const onIgnoredMessage = vi.fn()
    const { bridge, iframe, hostWindow } = createBridge({ onAction, onIgnoredMessage })
    bridge.start()
    hostWindow.dispatch({ source: iframe.contentWindow, data: actionPayload() })

    expect(onAction).not.toHaveBeenCalled()
    expect(onIgnoredMessage).toHaveBeenCalledWith({ type: 'action', reason: 'not-ready' })
  })

  it('宿主回调抛错不会穿出事件监听，该消息记为失败', () => {
    const onIgnoredMessage = vi.fn()
    const { iframe, hostWindow } = withReady({
      onAction: () => {
        throw new Error('host handler boom')
      },
      onIgnoredMessage,
    })

    expect(() =>
      hostWindow.dispatch({ source: iframe.contentWindow, data: actionPayload() }),
    ).not.toThrow()
    expect(onIgnoredMessage).toHaveBeenCalledWith({ type: 'action', reason: 'action-failed' })
  })

  it('错误态的卡片不再接受动作', () => {
    const onAction = vi.fn()
    const { bridge, iframe, hostWindow } = createBridge({ onAction })
    bridge.start()
    iframe.emit('error')
    hostWindow.dispatch({ source: iframe.contentWindow, data: actionPayload() })

    expect(onAction).not.toHaveBeenCalled()
  })
})
