/**
 * 卡片宿主桥（ADR 0015 第 4 条：MessageChannel + 每卡 nonce）。
 *
 * 一条卡对应一个实例、一个密钥、一对端口。宿主只接受**同时**满足
 * 「来源是这张卡片的 frame」与「nonce 等于本卡密钥」的回信；其余消息忽略，
 * 不抛错也不转成通用 IPC。握手超时、iframe 加载失败、协议版本不匹配、沙箱自己上报的
 * 渲染失败都收口成该卡的错误态，由宿主渲染错误占位并提供重试；内容高度上报转给宿主收放 iframe。
 *
 * iframe / window / MessageChannel / 密钥全部可注入，这条安全边界因此能脱离
 * 真实 Electron 进程单测（见 ADR 0011）。
 */
import {
  GENUI_MAX_BRIDGE_MESSAGE_BYTES,
  GENUI_MSG_ACTION,
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
import { parseCardAction, type CardAction, type CardActionRejection } from './cardActions'
import { createUuid } from '@/utils/uuid'

/** 握手时限：超过即认为这张卡起不来（PRD §3 默认 5 秒）。 */
export const GENUI_HANDSHAKE_TIMEOUT_MS = 5_000

/**
 * 沙箱报来的内容高度上限。卡片是不可信代码，它想多高就多高，
 * 所以这个数在桥口（信任边界）就被夹住，而不是等到宿主拿它去写布局。
 */
export const GENUI_MAX_FRAME_HEIGHT = 4_000

/**
 * 卡片起不来的原因。`unsupported-origin` 由宿主自己判定（沙箱源还没接入），
 * 其余来自桥与 frame 的观测；`render-failed` 是沙箱握手成功后自己报上来的渲染失败；
 * `sandbox-unreachable` 也是宿主判定的 —— H5 上桥超时后做过可达性探测，
 * 确认第二个源没人应答（端口没暴露、被防火墙拦下或混合内容）才换成它（票 06 第 5 条）。
 */
export type CardBridgeFailure =
  | 'handshake-timeout'
  | 'frame-load-failed'
  | 'version-mismatch'
  | 'render-failed'
  | 'action-timeout'
  | 'unsupported-origin'
  | 'sandbox-unreachable'

/**
 * 被丢弃的卡片消息及原因。只记录「已经通过 nonce 与来源校验」的消息 ——
 * 别的 frame 或别的应用的消息不归这张卡管，记下来只会变成噪音。
 */
export type CardIgnoredReason =
  | CardActionRejection
  | 'too-large'
  | 'not-ready'
  | 'action-failed'

export type CardIgnoredMessage = {
  type: 'action' | 'message'
  reason: CardIgnoredReason
}

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
  /** 每卡一次性密钥；走 `createUuid` 而不是 `crypto.randomUUID`，H5 的 http 源不是安全上下文 */
  nonce?: string
  schema: Record<string, unknown>
  theme: GenuiTheme
  locale: string
  protocolVersion?: number
  handshakeTimeoutMs?: number
  /** 单条桥消息上限；默认 1MB，卡片是不可信代码，链路本身也要有配额 */
  maxMessageBytes?: number
  onStateChange: (state: CardBridgeState) => void
  /** 沙箱内容高度变化；宿主据此收放 iframe，既不裁掉卡片也不留空白 */
  onResize?: (height: number) => void
  /** 已通过白名单、nonce、来源与限额校验的卡片动作 */
  onAction?: (action: CardAction) => void
  /** 被丢弃的消息：只记本卡的消息，供宿主排查而不影响渲染 */
  onIgnoredMessage?: (ignored: CardIgnoredMessage) => void
}

export type CardBridge = {
  start: () => void
  pushAppearance: (appearance: { theme: GenuiTheme; locale: string }) => void
  dispose: () => void
}

/** 回信的类型闸门：先确认是本卡密钥，再按 type 分发。 */
function messageType(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' ? type : null
}

/**
 * 消息的 JSON 体积；不可序列化（循环引用、BigInt…）返回 null。
 * 尺寸闸门在解析 payload 之前，免得一张卡先把宿主的事件循环塞满。
 */
function messageByteLength(value: unknown): number | null {
  try {
    const json = JSON.stringify(value)
    if (json === undefined) return null
    return new TextEncoder().encode(json).length
  } catch {
    return null
  }
}

export function createCardBridge(options: CardBridgeOptions): CardBridge {
  const hostWindow: HostMessageSource = options.hostWindow ?? window
  const channel = (options.createChannel ?? (() => new MessageChannel()))()
  const nonce = options.nonce ?? createUuid()
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

  /** 动作消息：白名单、限额与 payload 校验全交给 parseCardAction，宿主回调抛错不外泄。 */
  function handleAction(data: unknown): void {
    if (status.status !== 'ready') {
      options.onIgnoredMessage?.({ type: 'action', reason: 'not-ready' })
      return
    }
    const parsed = parseCardAction(data, {
      maxBytes: options.maxMessageBytes ?? GENUI_MAX_BRIDGE_MESSAGE_BYTES,
    })
    if (!parsed.ok) {
      options.onIgnoredMessage?.({ type: 'action', reason: parsed.reason })
      return
    }
    try {
      options.onAction?.(parsed.action)
    } catch {
      options.onIgnoredMessage?.({ type: 'action', reason: 'action-failed' })
    }
  }

  function handleInbound(data: unknown, sourceMatches: boolean): void {
    if (disposed) return
    // nonce 是第一个闸门：对不上就与"不是卡片协议"同等处理
    if (!hasGenuiNonce(data, nonce)) return
    // 窗口通道还要证明来源就是这张卡；端口通道本身即来源证明
    if (!sourceMatches) return

    const type = messageType(data)
    if (type === GENUI_MSG_ACTION) {
      handleAction(data)
      return
    }

    // 非动作消息也过尺寸闸门；动作消息的限额由 parseCardAction 统一判（含 oversized）
    const bytes = messageByteLength(data)
    if (bytes === null || bytes > (options.maxMessageBytes ?? GENUI_MAX_BRIDGE_MESSAGE_BYTES)) {
      options.onIgnoredMessage?.({
        type: 'message',
        reason: bytes === null ? 'unserializable' : 'too-large',
      })
      return
    }

    // hasGenuiNonce 已把消息收敛成带 string type 的信封；type 对不上任何一条就当不是卡片协议
    switch (data.type) {
      case GENUI_MSG_READY: {
        // 握手收口后不再重复结算：重试由宿主换 iframe 与新建桥完成
        if (isSettled()) return
        clearTimer()
        const { protocolVersion } = data as GenuiReadyMessage
        if (protocolVersion !== expectedVersion) {
          settle({ status: 'error', failure: 'version-mismatch' })
          return
        }
        settle({ status: 'ready', protocolVersion })
        return
      }

      case GENUI_MSG_ERROR:
        // 沙箱里物料渲染抛错：只有这张卡翻错误占位，消息其余部分与其他卡不受影响
        if (status.status === 'error') return
        clearTimer()
        settle({ status: 'error', failure: 'render-failed' })
        return

      case GENUI_MSG_SIZE: {
        const { height } = data as GenuiSizeMessage
        // 只接受真实存在的高度：0 高会把 iframe 收成一条线，负数与非数字直接丢掉
        if (status.status !== 'error' && Number.isFinite(height) && height > 0) {
          options.onResize?.(Math.min(height, GENUI_MAX_FRAME_HEIGHT))
        }
        return
      }
    }
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
