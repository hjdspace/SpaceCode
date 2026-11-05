/**
 * 飞书 IM Source（T15 #85）。
 *
 * 把飞书消息转换为 Super Agent Trigger 事件：
 *   - 丢弃自身 bot 消息与非用户发送者（监听范围外）；
 *   - p2p 消息 → addressed='direct'，@bot 群消息 → addressed='mention'，
 *     普通群消息不 addressed（只作上下文订阅，由 Ingestor fan-out）；
 *   - 话题群按 thread_id 建 Thread，普通群按 chat 建 Thread；
 *   - 结构性坏消息（缺 message_id、content 非法、时间戳非法）标记为 bad
 *     原样上送，由 Ingestor 统一隔离报告；
 *   - 平台断档（gap）透传给 Ingestor 触发全量重拉。
 *
 * 生产环境用 createFeishuImHttpClient 拉取消息历史：游标为各 chat 的
 * create_time 水位 + 未读完的 page_token 续读位，翻页到完成；单 chat 单次
 * 翻页有上限，触限时保留续读位交由下一轮 poll 继续，不静默丢消息。
 * create_time 可能为秒或毫秒字符串，转换时自适应，比较时同单位原值比较。
 * 「显式引用」（引用/回复 bot 消息）的识别归 Phase 2 Router 的 attach 逻辑。
 */
import type { ExternalSource, SourceEvent, SourcePollPage } from './types'
import type { SuperAgentTriggerAddress } from '../model'
import { isNonEmptyString, isRecord } from './types'

export interface FeishuImMessage {
  message_id: string
  chat_id: string
  chat_type: 'p2p' | 'group'
  thread_id?: string | null
  sender: {
    sender_type: string
    sender_id: { open_id?: string }
  }
  message_type: string
  content: string
  create_time: string
  /** 事件回调里 id 是对象，列表接口里可能是纯字符串 open_id，两种都兼容。 */
  mentions?: Array<{
    key: string
    id?: { open_id?: string } | string
    open_id?: string
  }>
}

export interface FeishuImPage {
  messages: FeishuImMessage[]
  nextCursor: string | null
  hasMore: boolean
  gap: boolean
}

export interface FeishuImClient {
  listMessages(cursor: string | null, limit: number): Promise<FeishuImPage>
}

/** 单条消息的映射结果：event=正常事件，dropped=按职责丢弃，bad=坏事件待隔离。 */
export type FeishuMessageMapResult =
  | { kind: 'event'; event: SourceEvent }
  | { kind: 'dropped' }
  | { kind: 'bad' }

/** 飞书 create_time 可能是秒（≤10 位）或毫秒字符串；统一转为毫秒，非法返回 null。 */
function toEpochMillis(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const num = Number(value)
  return value.length <= 10 ? num * 1000 : num
}

function isTimestamp(value: string): boolean {
  return /^\d+$/.test(value)
}

function mentionOpenId(mention: NonNullable<FeishuImMessage['mentions']>[number]): string | null {
  if (typeof mention?.id === 'string') return mention.id
  if (mention?.id && typeof mention.id.open_id === 'string') return mention.id.open_id
  return typeof mention?.open_id === 'string' ? mention.open_id : null
}

function mentionsBot(msg: FeishuImMessage, botOpenId: string): boolean {
  return (msg.mentions ?? []).some(
    (mention) => mentionOpenId(mention) === botOpenId,
  )
}

function extractPostText(content: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof content.title === 'string' && content.title) parts.push(content.title)
  const paragraphs = Array.isArray(content.content) ? content.content : []
  for (const paragraph of paragraphs) {
    if (!Array.isArray(paragraph)) continue
    parts.push(
      paragraph
        .map((element) => {
          if (!isRecord(element)) return ''
          if (element.tag === 'text') return typeof element.text === 'string' ? element.text : ''
          if (element.tag === 'at') {
            const name = typeof element.user_name === 'string' ? element.user_name : element.user_id
            return `@${typeof name === 'string' ? name : ''}`
          }
          if (element.tag === 'a') return typeof element.text === 'string' ? element.text : ''
          return ''
        })
        .join(''),
    )
  }
  return parts.join('\n')
}

/** 单条消息 → 事件；丢弃范围与坏事件的判定是 Source 的职责，隔离归 Ingestor。 */
export function feishuMessageToEvent(
  msg: FeishuImMessage,
  botOpenId: string,
): FeishuMessageMapResult {
  if (!isRecord(msg)) return { kind: 'bad' }
  if (msg.sender?.sender_type !== 'user') return { kind: 'dropped' }
  const openId = msg.sender.sender_id?.open_id
  if (!isNonEmptyString(openId)) return { kind: 'bad' }
  if (openId === botOpenId) return { kind: 'dropped' }
  if (!isNonEmptyString(msg.message_id) || !isNonEmptyString(msg.chat_id)) {
    return { kind: 'bad' }
  }
  const epochMillis = toEpochMillis(msg.create_time)
  if (epochMillis === null) return { kind: 'bad' }

  let text = ''
  if (msg.message_type === 'text' || msg.message_type === 'post') {
    let content: unknown
    try {
      content = JSON.parse(msg.content)
    } catch {
      return { kind: 'bad' }
    }
    if (!isRecord(content)) return { kind: 'bad' }
    if (msg.message_type === 'text') {
      if (typeof content.text !== 'string') return { kind: 'bad' }
      text = content.text
    } else {
      text = extractPostText(content)
    }
  }

  const chatId = msg.chat_id
  const isP2p = msg.chat_type === 'p2p'
  const threadId = isNonEmptyString(msg.thread_id)
    ? `feishu:group:${chatId}:thread:${msg.thread_id}`
    : isP2p
      ? `feishu:p2p:${chatId}`
      : `feishu:group:${chatId}`

  const addressed: SuperAgentTriggerAddress | null = isP2p
    ? 'direct'
    : mentionsBot(msg, botOpenId)
      ? 'mention'
      : null

  return {
    kind: 'event',
    event: {
      key: `feishu:message:${msg.message_id}`,
      source: 'feishu-im',
      threadIds: [threadId],
      actor: `feishu:user:${openId}`,
      human: true,
      addressed,
      channel: `feishu:chat:${chatId}`,
      url: null,
      text,
      at: new Date(epochMillis).toISOString(),
      meta: {
        chatType: msg.chat_type,
        messageType: msg.message_type,
        ...(isNonEmptyString(msg.thread_id) ? { threadId: msg.thread_id } : {}),
      },
    },
  }
}

export class FeishuImSource implements ExternalSource {
  readonly id = 'feishu-im'

  constructor(
    private readonly client: FeishuImClient,
    private readonly botOpenId: string,
  ) {}

  async poll(cursor: string | null, limit: number): Promise<SourcePollPage> {
    const page = await this.client.listMessages(cursor, limit)
    if (page.gap) {
      // 断档页的事件不可信，丢弃后交由 Ingestor 全量重拉。
      return { events: [], nextCursor: page.nextCursor, hasMore: page.hasMore, gap: true }
    }
    const events: unknown[] = []
    for (const msg of page.messages) {
      const mapped = feishuMessageToEvent(msg, this.botOpenId)
      if (mapped.kind === 'dropped') continue
      // 坏消息原样上送：隔离记录里保留平台原始负载最好排查。
      events.push(mapped.kind === 'event' ? mapped.event : msg)
    }
    return { events, nextCursor: page.nextCursor, hasMore: page.hasMore, gap: false }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 生产 HTTP client：按 chat 水位拉取消息历史
// ──────────────────────────────────────────────────────────────────────────

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

/** 单个 chat 单次轮询的最大翻页数：防御异常 API 造成无限翻页；触限保留续读位。 */
const MAX_PAGES_PER_CHAT = 50

interface FeishuChatCursor {
  /** 该 chat 已消费到的 create_time 水位（与 API 同单位）；null 表示从头读取。 */
  startTime: string | null
  /** 未翻完的下一页 page_token；非空表示该 chat 仍有历史待续读。 */
  pageToken: string | null
}

interface FeishuHttpCursor {
  v: 1
  chats: Record<string, FeishuChatCursor>
}

export interface FeishuImHttpClientOptions {
  appId: string
  appSecret: string
  /** 监听的 chat_id 列表；范围外消息不会进入 Super Agent。 */
  chats: string[]
  apiBase?: string
  fetch?: typeof fetch
  timeoutMs?: number
  /**
   * 触发断档全量重拉的飞书 API 错误码（如分页/时间过滤参数失效）。
   * 出现这些错误码时返回 gap 页而不是抛错，由 Ingestor 从头重拉。
   */
  gapErrorCodes?: number[]
}

interface FeishuListResponse {
  code: number
  msg?: string
  data?: {
    items?: FeishuImMessage[]
    has_more?: boolean
    page_token?: string
  }
}

function decodeCursor(cursor: string | null): FeishuHttpCursor | null {
  if (cursor === null) return null
  try {
    const raw = JSON.parse(cursor) as unknown
    if (isRecord(raw) && raw.v === 1 && isRecord(raw.chats)) {
      return raw as unknown as FeishuHttpCursor
    }
  } catch {
    // 游标损坏：按从头重拉处理
  }
  return null
}

function chatCursorOf(cursor: FeishuHttpCursor | null, chatId: string): FeishuChatCursor {
  const entry = cursor?.chats[chatId]
  if (isRecord(entry)) {
    return {
      startTime: typeof entry.startTime === 'string' ? entry.startTime : null,
      pageToken: typeof entry.pageToken === 'string' ? entry.pageToken : null,
    }
  }
  return { startTime: null, pageToken: null }
}

export function createFeishuImHttpClient(options: FeishuImHttpClientOptions): FeishuImClient {
  const apiBase = options.apiBase ?? FEISHU_API_BASE
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const gapErrorCodes = new Set(options.gapErrorCodes ?? [])
  const chats = [...options.chats]

  let token = ''
  let tokenExpiresAt = 0

  async function ensureToken(): Promise<string> {
    if (token && Date.now() < tokenExpiresAt - 60_000) return token
    const res = await doFetch(`${apiBase}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: options.appId, app_secret: options.appSecret }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data = (await res.json()) as {
      code?: number
      msg?: string
      tenant_access_token?: string
      expire?: number
    }
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`feishu auth failed: ${data.code ?? res.status} ${data.msg ?? ''}`)
    }
    token = data.tenant_access_token
    tokenExpiresAt = Date.now() + (data.expire ?? 3600) * 1000
    return token
  }

  async function listChat(
    authToken: string,
    chatId: string,
    entry: FeishuChatCursor,
    limit: number,
  ): Promise<{
    messages: FeishuImMessage[]
    watermark: string | null
    outstandingToken: string | null
    gap: boolean
  }> {
    const messages: FeishuImMessage[] = []
    let latest = entry.startTime
    // 仅全新列举（无续读位）时按水位截断；续读页里的消息都是未读，全部收取。
    const applyWatermark = entry.pageToken === null
    let pageToken = entry.pageToken
    let capReached = false

    for (let pageCount = 0; ; pageCount += 1) {
      if (pageCount >= MAX_PAGES_PER_CHAT) {
        capReached = true
        break
      }
      const params = new URLSearchParams({
        container_id_type: 'chat',
        container_id: chatId,
        page_size: String(limit),
      })
      // start_time 取水位本身（闭区间）：同单位时间戳的消息会被重复取回，
      // 由事件键幂等去重；严格小于水位的才是已消费历史，遇到即停。
      if (applyWatermark && latest) params.set('start_time', latest)
      if (pageToken) params.set('page_token', pageToken)
      const res = await doFetch(`${apiBase}/im/v1/messages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(timeoutMs),
      })
      const body = (await res.json()) as FeishuListResponse
      if (body.code !== 0) {
        if (gapErrorCodes.has(body.code)) {
          // 水位/分页参数失效：报告断档，让 Ingestor 全量重拉。
          return { messages: [], watermark: null, outstandingToken: null, gap: true }
        }
        throw new Error(`feishu list messages failed: ${body.code} ${body.msg ?? ''}`)
      }
      const items = body.data?.items ?? []
      let reachedWatermark = false
      for (const item of items) {
        if (
          applyWatermark &&
          latest &&
          isTimestamp(item.create_time) &&
          Number(item.create_time) < Number(latest)
        ) {
          reachedWatermark = true
          break
        }
        messages.push(item)
        if (!latest || (isTimestamp(item.create_time) && Number(item.create_time) > Number(latest))) {
          latest = item.create_time
        }
      }
      const nextToken = body.data?.page_token ?? null
      if (!body.data?.has_more || !nextToken || reachedWatermark) {
        pageToken = null
        break
      }
      pageToken = nextToken
    }
    return {
      messages,
      watermark: latest,
      outstandingToken: capReached ? pageToken : null,
      gap: false,
    }
  }

  return {
    async listMessages(cursor, limit) {
      const decoded = decodeCursor(cursor)
      const authToken = await ensureToken()
      const collected: FeishuImMessage[] = []
      const chatCursors: Record<string, FeishuChatCursor> = {}
      let gap = false
      let hasMore = false
      for (const chatId of chats) {
        const entry = chatCursorOf(decoded, chatId)
        const result = await listChat(authToken, chatId, entry, limit)
        if (result.gap) {
          gap = true
          break
        }
        collected.push(...result.messages)
        if (result.watermark || result.outstandingToken) {
          chatCursors[chatId] = {
            startTime: result.watermark ?? entry.startTime,
            pageToken: result.outstandingToken,
          }
        }
        if (result.outstandingToken) hasMore = true
      }
      if (gap) {
        return { messages: [], nextCursor: null, hasMore: false, gap: true }
      }
      collected.sort((a, b) => Number(a.create_time) - Number(b.create_time))
      const nextCursor: FeishuHttpCursor = { v: 1, chats: chatCursors }
      return {
        messages: collected,
        nextCursor: JSON.stringify(nextCursor),
        hasMore,
        gap: false,
      }
    },
  }
}
