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

/**
 * 握手时限：Schema 已经投进沙箱、它却迟迟不回 ready（PRD §3 默认 5 秒）。
 * 这一段只量「卡片拿到了内容却不开口」，不含下面那段冷启动预算。
 */
export const GENUI_HANDSHAKE_TIMEOUT_MS = 5_000

/**
 * 沙箱文档的加载预算：从挂上 iframe 到 `load` 事件为止。
 *
 * 这份文档是 5MB 级的物料 bundle，打包态还要经主进程的自定义协议处理器读盘 —— 而首张卡
 * 恰好赶在流式收口、主进程最忙的时候加载。把它算进 `GENUI_HANDSHAKE_TIMEOUT_MS` 就等于
 * 要求浏览器在 5 秒内完成取字节 + 解析 + 执行，冷启动必然被判握手失败，重试（此时已缓存）
 * 反而一次就过。所以加载单独计时，握手计时从 Schema 真正投递出去那刻才开始。
 */
export const GENUI_FRAME_BOOT_TIMEOUT_MS = 15_000

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
  /** 沙箱文档的加载预算；默认 `GENUI_FRAME_BOOT_TIMEOUT_MS`，测试压小它 */
  bootTimeoutMs?: number
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Schema 在 store 里通常是 Vue 的响应式代理。postMessage 走结构化克隆，
 * Proxy 一律抛 DataCloneError，握手就会永远停在 connecting 直到超时。
 * Schema 按协议本来就是 JSON，做一次 JSON 往返还原成普通对象；
 * 序列化不了时返回 null，由这张卡落到 render-failed，而不是让异常穿出 mounted hook。
 */
function toTransferableSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(schema))
    return isRecord(parsed) ? parsed : null
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
  const bootMs = options.bootTimeoutMs ?? GENUI_FRAME_BOOT_TIMEOUT_MS
  // 结构化克隆不接受 Proxy：先把响应式 Schema 归一成纯 JSON 对象，否则投递当场就抛
  const transferableSchema = toTransferableSchema(options.schema)

  let status: CardBridgeState = { status: 'connecting' }
  /** 沙箱文档加载计时；Schema 投出去就换成交手计时，两段共用同一个收口 */
  let bootTimer: ReturnType<typeof setTimeout> | null = null
  /** 交手指计时：只在 `postInit` 成功后武装，量的是卡片拿到内容后开不开口 */
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null
  let initPosted = false
  /** 沙箱文档是否已经就位 —— 没就位之前一次都不投，见 `postInit` */
  let frameLoaded = false
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
    if (bootTimer) {
      clearTimeout(bootTimer)
      bootTimer = null
    }
    if (handshakeTimer) {
      clearTimeout(handshakeTimer)
      handshakeTimer = null
    }
  }

  /** 两段超时都收口成 `handshake-timeout`：对用户而言都是「这张卡没起来」，处理方式也相同。 */
  function settleAsNotStarted(): void {
    if (isSettled()) return
    clearTimer()
    settle({ status: 'error', failure: 'handshake-timeout' })
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

  /**
   * 注入只由 frame 的 load 事件驱动。iframe 一插进 DOM，`contentWindow` 就指向那个还没被
   * 换掉的初始空文档 —— 往它 postMessage 不报错，消息却随那个文档一起丢掉，而端口已经转移走、
   * 补发不了，这张卡只能等到握手超时。load 才是沙箱文档就位、它的监听器已注册的时刻。
   */
  const onFrameLoad = (): void => {
    frameLoaded = true
    postInit()
  }

  function postInit(): void {
    const target = options.iframe.contentWindow
    if (disposed || initPosted || !frameLoaded || !transferableSchema || !target) return

    initPosted = true
    const init: GenuiInitMessage = {
      type: GENUI_MSG_INIT,
      nonce,
      protocolVersion: expectedVersion,
      theme: options.theme,
      locale: options.locale,
      schema: transferableSchema,
    }

    // 预算先武装，再投递：`postMessage` 一旦抛错（frame 已被换掉、克隆被拒），
    // 写在它后面的那一行就轮不到执行，这张卡会静默停在 connecting 而不是按时收口。
    if (bootTimer) {
      clearTimeout(bootTimer)
      bootTimer = null
    }
    handshakeTimer = setTimeout(settleAsNotStarted, timeoutMs)

    // opaque origin 的文档没法用 targetOrigin 精确匹配，只能 '*'；闸门是 nonce
    try {
      target.postMessage(init, '*', [channel.port2])
    } catch {
      settleAsNotStarted()
    }
  }

  const onPortMessage = (event: MessageEvent): void => {
    handleInbound(event.data, true)
  }

  return {
    start(): void {
      if (disposed) return
      settle({ status: 'connecting' })
      // Schema 归一成不成与 frame 加载到哪一步无关，当场收口，不必等 5 秒握手超时
      if (!transferableSchema) {
        settle({ status: 'error', failure: 'render-failed' })
        return
      }
      options.iframe.addEventListener('error', onFrameError)
      options.iframe.addEventListener('load', onFrameLoad)
      hostWindow.addEventListener('message', onWindowMessage)
      channel.port1.onmessage = onPortMessage
      // 只管到 `load`：文档没就位就什么都投不出去。交棒给 postInit 里的握手计时器
      bootTimer = setTimeout(settleAsNotStarted, bootMs)
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
      options.iframe.removeEventListener('load', onFrameLoad)
      hostWindow.removeEventListener('message', onWindowMessage)
      channel.port1.onmessage = null
      channel.port1.close()
    },
  }
}
