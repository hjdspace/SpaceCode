/**
 * #103：飞书 Outbox 通道。
 *
 * 复用 `electron/im` 已有的 FeishuBot 传输与 `adapters.json` 凭据边界，
 * 不另造 HTTP/凭据路径。
 *
 * 地址格式：`feishu:chat:<chatId>[:reply:<messageId>]`。
 *  - `reply` 后缀是话题回复目标（由 `replyTarget.ts` 从领域 Trigger 解析）；
 *  - messageId 同时作为飞书回复接口的 `uuid` 幂等键，崩溃在「平台已发送、
 *    回执未写回」窗口重投时不会产生第二条回复；
 *  - 平台 message id 作为 receipt 回写领域。
 */
import { createHash } from 'crypto'
import { loadConfig } from '../im/adapters/common/config'
import { FeishuApiError, FeishuBot } from '../im/adapters/feishu/feishuBot'
import type { SuperAgentOutboxChannel, SuperAgentOutboxSendOutcome } from './outbox'

export const FEISHU_OUTBOX_CHANNEL_PREFIX = 'feishu:'

export interface FeishuOutboxAddress {
  chatId: string
  /** `null` 表示直接发到会话（没有可回复的消息）。 */
  replyToMessageId: string | null
}

const FEISHU_CHANNEL_PATTERN = /^feishu:(?:chat:)?([^:]+)(?::reply:([^:]+))?$/

export function parseFeishuOutboxChannel(channel: string): FeishuOutboxAddress | null {
  const match = FEISHU_CHANNEL_PATTERN.exec(channel)
  if (!match?.[1]) return null
  return {
    chatId: match[1],
    replyToMessageId: match[2] ?? null,
  }
}

export function feishuOutboxChannel(chatId: string, replyToMessageId: string | null): string {
  return replyToMessageId
    ? `feishu:chat:${chatId}:reply:${replyToMessageId}`
    : `feishu:chat:${chatId}`
}

export interface FeishuOutboxSendInput extends FeishuOutboxAddress {
  messageId: string
  text: string
}

export interface FeishuOutboxTransport {
  send(input: FeishuOutboxSendInput): Promise<{ messageId: string }>
}

export interface SuperAgentFeishuOutboxChannelOptions {
  send: FeishuOutboxTransport['send']
  /** messageId → 平台 message id；同进程重复投递短路。 */
  receipts?: Map<string, string>
}

/** 飞书回复接口的 uuid 最长 50 字符；超长时用稳定摘要即可。 */
function feishuIdempotencyKey(messageId: string): string {
  return messageId.length <= 50
    ? messageId
    : createHash('sha1').update(messageId).digest('hex').slice(0, 40)
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'feishuChannelError'
}

function errorCodeOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = Number((error as { code: unknown }).code)
    if (Number.isFinite(code)) return code
  }
  if (error instanceof Error) {
    const match = /\(code: (\d+)\)/.exec(error.message)
    if (match) return Number(match[1])
  }
  return null
}

/**
 * 只有平台明确表示「目标消息已撤回/不存在」才是永久失败；超时、鉴权失败、
 * 5xx 都按瞬时失败退避重试。
 */
export function isFeishuGoneError(error: unknown): boolean {
  const code = errorCodeOf(error)
  if (code === 230011) return true
  const message = errorMessageOf(error)
  if (/withdrawn/i.test(message)) return true
  return code !== null && Math.floor(code / 100) === 2300 && /not found/i.test(message)
}

export function createSuperAgentFeishuOutboxChannel(
  options: SuperAgentFeishuOutboxChannelOptions,
): SuperAgentOutboxChannel {
  const receipts = options.receipts ?? new Map<string, string>()
  return async (message): Promise<SuperAgentOutboxSendOutcome> => {
    if (message.payload.kind !== 'reply') return gone('feishuChannelReplyOnly')
    const address = parseFeishuOutboxChannel(message.channel)
    if (!address) return gone('feishuChannelInvalidAddress')

    const delivered = receipts.get(message.messageId)
    if (delivered !== undefined) return { outcome: 'sent', receipt: delivered }

    try {
      const result = await options.send({
        ...address,
        messageId: message.messageId,
        text: message.payload.text,
      })
      if (!result?.messageId) return { outcome: 'waiting', error: 'feishuChannelMissingReceipt' }
      receipts.set(message.messageId, result.messageId)
      return { outcome: 'sent', receipt: result.messageId }
    } catch (error) {
      return isFeishuGoneError(error)
        ? gone(errorMessageOf(error))
        : { outcome: 'waiting', error: errorMessageOf(error) }
    }
  }
}

function gone(error: string): SuperAgentOutboxSendOutcome {
  return { outcome: 'gone', error }
}

export interface FeishuBotLike {
  sendTextMessage(receiveIdType: string, receiveId: string, text: string): Promise<{ message_id: string }>
  replyTextMessage(
    messageId: string,
    text: string,
    opts?: { replyInThread?: boolean; idempotencyKey?: string },
  ): Promise<{ message_id: string }>
}

export interface FeishuBotOutboxTransportOptions {
  bot?: FeishuBotLike
  /** 缺省读取 `electron/im` 的 adapters.json（同一凭据边界）。 */
  loadCredentials?: () => { appId: string; appSecret: string }
  apiBase?: string
}

/** 用 FeishuBot 作为生产传输：话题回复 + 平台回执；不新增凭据读取路径。 */
export function createFeishuBotOutboxTransport(
  options: FeishuBotOutboxTransportOptions = {},
): FeishuOutboxTransport {
  let bot: FeishuBotLike | null = options.bot ?? null
  const botOf = (): FeishuBotLike => {
    if (bot) return bot
    const credentials = options.loadCredentials
      ? options.loadCredentials()
      : (() => {
          const config = loadConfig()
          return { appId: config.feishu.appId, appSecret: config.feishu.appSecret }
        })()
    if (!credentials.appId || !credentials.appSecret) {
      throw new FeishuApiError('feishuCredentialsMissing', 0)
    }
    bot = new FeishuBot(credentials.appId, credentials.appSecret, { apiBase: options.apiBase })
    return bot
  }

  return {
    async send(input) {
      if (input.replyToMessageId) {
        const result = await botOf().replyTextMessage(input.replyToMessageId, input.text, {
          replyInThread: true,
          idempotencyKey: feishuIdempotencyKey(input.messageId),
        })
        return { messageId: result.message_id }
      }
      const result = await botOf().sendTextMessage('chat_id', input.chatId, input.text)
      return { messageId: result.message_id }
    },
  }
}
