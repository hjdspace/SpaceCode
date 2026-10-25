/**
 * 卡片宿主桥（ADR 0015 第 4 条：MessageChannel + 每卡 nonce）。
 *
 * 一条卡对应一个实例、一个密钥、一对端口。宿主只接受**同时**满足
 * 「来源是这张卡片的 frame」与「nonce 等于本卡密钥」的回信；其余消息忽略，
 * 不抛错也不转成通用 IPC。握手超时、iframe 加载失败、协议版本不匹配都收口成
 * 该卡的错误态，由宿主渲染错误占位并提供重试。
 *
 * iframe / window / MessageChannel / 密钥全部可注入，这条安全边界因此能脱离
 * 真实 Electron 进程单测（见 ADR 0011）。
 */
import {
  GENUI_MSG_ERROR,
  GENUI_MSG_INIT,
  GENUI_MSG_READY,
  GENUI_MSG_SIZE,
  GENUI_MSG_THEME,
  GENUI_SANDBOX_PROTOCOL_VERSION,
  hasGenuiNonce,
  type GenuiInitMessage,
  type GenuiReadyMessage,
  type GenuiSizeMessage,
  type GenuiTheme,
} from '@/shared/genuiSandbox'

/** 握手时限：超过即认为这张卡起不来（PRD §3 默认 5 秒）。 */
export const GENUI_HANDSHAKE_TIMEOUT_MS = 5_000

/**
 * 卡片起不来的原因。`unsupported-origin` 由宿主自己判定（沙箱源还没接入），
 * 其余来自桥与 frame 的观测；`render-failed` 是沙箱握手成功后自己报上来的渲染失败。
 */
export type CardBridgeFailure =
  | 'handshake-timeout'
  | 'frame-load-failed'
  | 'version-mismatch'
  | 'render-failed'
  | 'unsupported-origin'

export type CardBridgeState =
  | { status: 'connecting' }
  | { status: 'ready'; protocolVersion: number }
  | { status: 'error'; failure: CardBridgeFailure }

/**
 * 宿主窗口的 message 事件源。签名直接用 DOM 的 `MessageEvent`，
 * 否则真实 `window` 的重载签名接不进来（addEventListener 要求监听者能吃下整个事件联合类型）。
 */
export interface HostMessageSource {
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

/** 卡片 iframe 的极窄形状：投递要能落进 frame，加载成败要能听到。 */
export interface CardFrameLike {
  contentWindow: {
    postMessage: (message: unknown, targetOrigin: string, transfer?: Transferable[]) => void
  } | null
  addEventListener: (type: 'load' | 'error', listener: () => void) => void
  removeEventListener: (type: 'load' | 'error', listener: () => void) => void
}

export interface ChannelLike {
  port1: MessagePort
  port2: MessagePort
}

export type CardBridgeOptions = {
  iframe: CardFrameLike
  /** 默认当前窗口的 message 事件源；测试注入假窗口 */
  hostWindow?: HostMessageSource
  createChannel?: () => ChannelLike
  /** 每卡一次性密钥，默认走 crypto.randomUUID */
  nonce?: string
  schema: Record<string, unknown>
  theme: GenuiTheme
  locale: string
  protocolVersion?: number
  handshakeTimeoutMs?: number
  onStateChange: (state: CardBridgeState) => void
}

export type CardBridge = {
  start: () => void
  pushAppearance: (appearance: { theme: GenuiTheme; locale: string }) => void
  dispose: () => void
}

/** 握手回信必须同时是 ready 且带着本卡密钥。 */
function isReadyWithNonce(value: unknown, nonce: string): value is GenuiReadyMessage {
  if (typeof value !== 'object' || value === null) return false
  if ((value as { type?: unknown }).type !== GENUI_MSG_READY) return false
  return hasGenuiNonce(value, nonce)
}

export function createCardBridge(options: CardBridgeOptions): CardBridge {
  const hostWindow: HostMessageSource = options.hostWindow ?? window
  const channel = (options.createChannel ?? (() => new MessageChannel()))()
  const nonce = options.nonce ?? crypto.randomUUID()
  const expectedVersion = options.protocolVersion ?? GENUI_SANDBOX_PROTOCOL_VERSION
  const timeoutMs = options.handshakeTimeoutMs ?? GENUI_HANDSHAKE_TIMEOUT_MS

  let status: CardBridgeState = { status: 'connecting' }
  let timer: ReturnType<typeof setTimeout> | null = null
  let initPosted = false
  let disposed = false

  function settle(next: CardBridgeState): void {
    status = next
    options.onStateChange(next)
  }

  /** 握手一旦收口（ready 或 error）就不再变化：重试由宿主换 iframe 与新建桥完成。 */
  function isSettled(): boolean {
    return status.status !== 'connecting'
  }

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function handleInbound(data: unknown, sourceMatches: boolean): void {
    if (disposed || isSettled()) return
    // nonce 是第一个闸门：对不上就与"不是卡片协议"同等处理
    if (!isReadyWithNonce(data, nonce)) return
    // 窗口通道还要证明来源就是这张卡；端口通道本身即来源证明
    if (!sourceMatches) return

    clearTimer()
    if (data.protocolVersion !== expectedVersion) {
      settle({ status: 'error', failure: 'version-mismatch' })
      return
    }
    settle({ status: 'ready', protocolVersion: data.protocolVersion })
  }

  const onWindowMessage = (event: MessageEvent): void => {
    handleInbound(event.data, event.source === (options.iframe.contentWindow as unknown))
  }

  const onFrameError = (): void => {
    if (disposed || isSettled()) return
    clearTimer()
    settle({ status: 'error', failure: 'frame-load-failed' })
  }

  function postInit(): void {
    if (disposed || initPosted || !options.iframe.contentWindow) return
    initPosted = true
    const init: GenuiInitMessage = {
      type: GENUI_MSG_INIT,
      nonce,
      protocolVersion: expectedVersion,
      theme: options.theme,
      locale: options.locale,
      schema: options.schema,
    }
    // opaque origin 的文档没法用 targetOrigin 精确匹配，只能 '*'；闸门是 nonce
    options.iframe.contentWindow.postMessage(init, '*', [channel.port2])
  }

  const onPortMessage = (event: MessageEvent): void => {
    handleInbound(event.data, true)
  }

  return {
    start(): void {
      if (disposed) return
      options.iframe.addEventListener('error', onFrameError)
      // 文档没就位之前 postMessage 会落进一个还没注册监听的 window，消息直接丢掉
      options.iframe.addEventListener('load', postInit)
      hostWindow.addEventListener('message', onWindowMessage)
      channel.port1.onmessage = onPortMessage
      settle({ status: 'connecting' })

      postInit()
      timer = setTimeout(() => {
        if (!isSettled()) settle({ status: 'error', failure: 'handshake-timeout' })
      }, timeoutMs)
    },

    pushAppearance(appearance: { theme: GenuiTheme; locale: string }): void {
      if (disposed || status.status !== 'ready') return
      channel.port1.postMessage({ type: GENUI_MSG_THEME, nonce, ...appearance })
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      clearTimer()
      options.iframe.removeEventListener('error', onFrameError)
      options.iframe.removeEventListener('load', postInit)
      hostWindow.removeEventListener('message', onWindowMessage)
      channel.port1.onmessage = null
      channel.port1.close()
    },
  }
}
