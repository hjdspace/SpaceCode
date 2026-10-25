/**
 * GenUI 卡片沙箱的跨端契约：源、CSP、协议版本与消息形状。
 *
 * 一份定义同时被三处使用 — 主进程协议处理器与开发期静态服务（下发 CSP）、
 * 渲染端宿主桥（握手）、沙箱文档自身（校验 nonce 与协议版本）。
 * 口径见 `docs/adr/0015-genui-card-sandbox-origin.md`。
 *
 * 沙箱文档用**经典脚本**而不是 `<script type="module">`：`sandbox="allow-scripts"`
 * 不给 `allow-same-origin` 时文档是 opaque origin，module script 一律按 CORS 请求发起
 * （`Origin: null`），自定义协议不放行跨源请求，主窗口也不该为卡片放开 `corsEnabled`。
 * 经典脚本不受此限制，`script-src 'self'` 仍然放行同一 URL 源的自身资源（实测）。
 */

/** 打包环境提供沙箱资源的自定义协议名，须在 app ready 前注册为 standard + secure。 */
export const GENUI_SANDBOX_SCHEME = 'spacecode-genui'

/** standard scheme 的 host 参与 origin 计算，必须固定。 */
export const GENUI_SANDBOX_HOST = 'genui'

/**
 * 开发环境与主窗口（`http://127.0.0.1:5173`）同时换主机名与端口，
 * 只换端口不算换 site，拿不到 OOPIF 进程隔离。
 */
export const GENUI_SANDBOX_DEV_HOST = 'localhost'
export const GENUI_SANDBOX_DEV_PORT = 5174
export const GENUI_SANDBOX_DEV_BASE_URL = `http://${GENUI_SANDBOX_DEV_HOST}:${GENUI_SANDBOX_DEV_PORT}`

/** 生产环境的沙箱源，由自定义协议提供。 */
export const GENUI_SANDBOX_PROD_BASE_URL = `${GENUI_SANDBOX_SCHEME}://${GENUI_SANDBOX_HOST}`

/** 沙箱文档入口；卡片 iframe 只加载这一个文档。 */
export const GENUI_SANDBOX_DOC_PATH = '/index.html'

/** 渲染端与沙箱共同声明的协议版本；不一致时卡片降级为错误占位。 */
export const GENUI_SANDBOX_PROTOCOL_VERSION = 1

/**
 * 沙箱文档自带的 CSP，逐响应下发（协议处理器与开发期静态服务），不与主窗口共享。
 * `unsafe-eval` 只存在于这个源 — 卡片协议层允许执行表达式，主窗口永不放开。
 */
export const GENUI_SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ')

export type GenuiTheme = 'light' | 'dark'

export const GENUI_MSG_INIT = 'genui:init'
export const GENUI_MSG_THEME = 'genui:theme'
export const GENUI_MSG_READY = 'genui:ready'
export const GENUI_MSG_ERROR = 'genui:error'
export const GENUI_MSG_SIZE = 'genui:size'
export const GENUI_MSG_ACTION = 'genui:action'

/**
 * 卡片能请求的宿主动作，固定四项（ADR 0015 第 4 条）。
 * 白名单之外的消息在桥口就被丢弃，永远到不了任何 IPC。
 */
export const GENUI_CARD_ACTIONS = ['submit', 'copy', 'expand', 'openLink'] as const
export type GenuiCardActionName = (typeof GENUI_CARD_ACTIONS)[number]

/** 单条桥消息的体积上限。卡片是不可信代码，链路本身也要有配额。 */
export const GENUI_MAX_BRIDGE_MESSAGE_BYTES = 1024 * 1024

/** 卡片可请求复制/提交的文本上限（PRD §4）。 */
export const GENUI_MAX_COPY_BYTES = 64 * 1024

/** 宿主动作从发起到收口的最长等待；超时按这张卡失败处理，可重试。 */
export const GENUI_ACTION_TIMEOUT_MS = 5_000

/** 宿主 → 沙箱：经 MessageChannel 注入门卡密钥、主题、语言与卡片 Schema。 */
export type GenuiInitMessage = {
  type: typeof GENUI_MSG_INIT
  nonce: string
  protocolVersion: number
  theme: GenuiTheme
  locale: string
  schema: Record<string, unknown>
}

/** 宿主 → 沙箱：主题或语言变化时推送，卡片不读父窗口 CSS。 */
export type GenuiThemeMessage = {
  type: typeof GENUI_MSG_THEME
  nonce: string
  theme: GenuiTheme
  locale: string
}

/** 沙箱 → 宿主：握手应答，声明自身协议版本并回显密钥。 */
export type GenuiReadyMessage = {
  type: typeof GENUI_MSG_READY
  nonce: string
  protocolVersion: number
}

/** 沙箱 → 宿主：这张卡渲染不起来（物料报错、Schema 不合法），宿主据此换错误占位。 */
export type GenuiErrorMessage = {
  type: typeof GENUI_MSG_ERROR
  nonce: string
}

/** 沙箱 → 宿主：卡片内容变化，宿主据此收放 iframe，避免出现空白或裁切。 */
export type GenuiSizeMessage = {
  type: typeof GENUI_MSG_SIZE
  nonce: string
  height: number
}

/**
 * 沙箱 → 宿主：卡片请求一个宿主动作。
 * payload 形状由动作决定（copy: `{ text }`、openLink: `{ url }`、submit: 任意对象），
 * 宿主在路由前统一校验，不信任这里的任何字段。
 */
export type GenuiActionMessage = {
  type: typeof GENUI_MSG_ACTION
  nonce: string
  action: GenuiCardActionName
  payload?: unknown
}

/** 带信封字段的消息：nonce 是两侧共同的拒绝依据。 */
export type GenuiNonceEnvelope = { type: string; nonce: string }

/**
 * 消息是否带着指定 nonce 的信封。
 * 两侧都用它做第一道闸门：nonce 不匹配一律忽略，不抛错、不转成通用 IPC。
 */
export function hasGenuiNonce(value: unknown, nonce: string): value is GenuiNonceEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const envelope = value as { nonce?: unknown }
  return typeof envelope.nonce === 'string' && envelope.nonce === nonce
}

/**
 * 宿主 → 沙箱的主题/语言推送判定：类型与密钥两道闸门一起过。
 * 沙箱侧只认这一条，因此不把它和别的消息写成两处各自解读 `type`。
 */
export function isGenuiThemeMessage(value: unknown, nonce: string): value is GenuiThemeMessage {
  return hasGenuiNonce(value, nonce) && value.type === GENUI_MSG_THEME
}

/** 拼出某条来源下的沙箱文档 URL。 */
export function genuiSandboxDocUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}${GENUI_SANDBOX_DOC_PATH}`
}
