/**
 * 卡片动作的宿主侧闸门（票 03）。
 *
 * 沙箱是不可信代码，所以「动作名是否在白名单里」「payload 是否在限额内」
 * 「外链协议是否安全」全都在这里判定，判定通过后才交给平台适配器执行。
 * 这个模块保持纯函数：不碰 DOM、不调 IPC，因此拒绝路径能脱离真实宿主单测。
 */
import {
  GENUI_CARD_ACTIONS,
  GENUI_MAX_BRIDGE_MESSAGE_BYTES,
  GENUI_MAX_COPY_BYTES,
  GENUI_MAX_SUBMIT_BYTES,
  type GenuiCardActionName,
} from '@/shared/genuiSandbox'
import { isSafeExternalUrl } from '@/utils/safeUrl'

export type CardAction =
  | { action: 'submit'; payload: Record<string, unknown> }
  | { action: 'copy'; text: string }
  | { action: 'expand' }
  | { action: 'openLink'; url: string }

export type CardActionRejection =
  | 'not-an-object'
  | 'unserializable'
  | 'oversized'
  | 'unknown-action'
  | 'invalid-payload'

export type CardActionParseResult =
  | { ok: true; action: CardAction }
  | { ok: false; reason: CardActionRejection }

export type CardActionParseOptions = {
  maxBytes?: number
  maxCopyBytes?: number
  maxSubmitBytes?: number
}

const encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length
}

export function isCardActionName(value: string): value is GenuiCardActionName {
  return (GENUI_CARD_ACTIONS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 整条消息的 JSON 体积。循环引用等不可序列化结构返回 null ——
 * 调用方据此拒绝，而不是让 JSON.stringify 的异常穿出桥。
 */
function messageByteLength(value: unknown): number | null {
  try {
    const json = JSON.stringify(value)
    if (json === undefined) return null
    return utf8ByteLength(json)
  } catch {
    return null
  }
}

function reject(reason: CardActionRejection): CardActionParseResult {
  return { ok: false, reason }
}

/**
 * 把一条沙箱消息解析成宿主可执行的动作。
 * 非对象、非白名单、超限与非法 payload 都返回拒绝原因，永远不抛错。
 */
export function parseCardAction(
  value: unknown,
  options: CardActionParseOptions = {},
): CardActionParseResult {
  if (!isRecord(value)) return reject('not-an-object')

  const bytes = messageByteLength(value)
  if (bytes === null) return reject('unserializable')
  if (bytes > (options.maxBytes ?? GENUI_MAX_BRIDGE_MESSAGE_BYTES)) return reject('oversized')

  const name = (value as { action?: unknown }).action
  if (typeof name !== 'string' || !isCardActionName(name)) return reject('unknown-action')

  const payload = (value as { payload?: unknown }).payload

  if (name === 'expand') return { ok: true, action: { action: 'expand' } }

  if (name === 'copy') {
    if (!isRecord(payload) || typeof payload.text !== 'string') return reject('invalid-payload')
    if (utf8ByteLength(payload.text) > (options.maxCopyBytes ?? GENUI_MAX_COPY_BYTES)) {
      return reject('oversized')
    }
    return { ok: true, action: { action: 'copy', text: payload.text } }
  }

  if (name === 'openLink') {
    if (!isRecord(payload) || !isSafeExternalUrl(payload.url)) return reject('invalid-payload')
    return { ok: true, action: { action: 'openLink', url: payload.url } }
  }

  // submit：payload 要进模型上下文与会话存储，所以在桥口就按单条提交限额夹住；
  // 更深的语义（摘要、落库、只读）由 lib/genui/cardSubmission 负责。
  if (name === 'submit') {
    if (!isRecord(payload)) return reject('invalid-payload')
    const payloadBytes = messageByteLength(payload)
    if (payloadBytes === null) return reject('unserializable')
    if (payloadBytes > (options.maxSubmitBytes ?? GENUI_MAX_SUBMIT_BYTES)) return reject('oversized')
    return { ok: true, action: { action: 'submit', payload } }
  }

  return reject('unknown-action')
}
