/**
 * 外部 Source 接口与事件校验（T15 #85）。
 *
 * Source 是带游标的事件流：poll 从游标处读取一页事件，游标语义由 Source 自解释
 * （对 Ingestor 不透明）。断档（gap）表示 Source 无法保证从当前游标继续的连续性，
 * Ingestor 收到后必须丢弃该页并从头全量重拉，事件键幂等保证不重复建单。
 *
 * Source 自身负责：丢弃自身 bot 消息、监听范围外事件和平台去重；结构性坏消息
 * 原样上送（passthrough），由 Ingestor 统一校验并隔离报告。
 */
import type { SuperAgentTriggerAddress } from '../model'

/** 规范化后的外部事件；形状与 domain.TriggerDraft 对齐。 */
export interface SourceEvent {
  /** Source 事件键，也是幂等键；同一键重复投递只返回原 Trigger。 */
  key: string
  source: string
  /** `threadIds[0]` 是主 Thread。 */
  threadIds: string[]
  actor: string
  human: boolean
  addressed?: SuperAgentTriggerAddress | null
  channel?: string | null
  url?: string | null
  text: string
  at: string
  meta?: Record<string, unknown>
}

/** 一页事件读取结果；events 元素可能是坏事件，由 parseSourceEvent 校验。 */
export interface SourcePollPage {
  events: unknown[]
  /** 继续读取的游标；hasMore 为 true 时必须非空。 */
  nextCursor: string | null
  hasMore: boolean
  /** 断档：本页事件不可信，必须全量重拉。 */
  gap: boolean
}

export interface ExternalSource {
  readonly id: string
  poll(cursor: string | null, limit: number): Promise<SourcePollPage>
}

export type SourceEventParseResult =
  | { ok: true; event: SourceEvent }
  | { ok: false; reason: string }

/** 供各 Source 实现复用的字段校验。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalStringOrNull(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string'
}

/** 坏事件只能在这里被识别并给出原因码，Ingestor 负责隔离与报告。 */
export function parseSourceEvent(raw: unknown): SourceEventParseResult {
  if (!isRecord(raw)) return { ok: false, reason: 'not-an-object' }
  if (!isNonEmptyString(raw.key)) return { ok: false, reason: 'missing-key' }
  if (!isNonEmptyString(raw.source)) return { ok: false, reason: 'missing-source' }
  if (!Array.isArray(raw.threadIds) || raw.threadIds.length === 0) {
    return { ok: false, reason: 'invalid-thread-ids' }
  }
  if (!raw.threadIds.every((id) => isNonEmptyString(id))) {
    return { ok: false, reason: 'invalid-thread-ids' }
  }
  if (!isNonEmptyString(raw.actor)) return { ok: false, reason: 'invalid-actor' }
  if (typeof raw.human !== 'boolean') return { ok: false, reason: 'invalid-human' }
  if (typeof raw.text !== 'string') return { ok: false, reason: 'invalid-text' }
  if (
    raw.addressed !== undefined &&
    raw.addressed !== null &&
    raw.addressed !== 'mention' &&
    raw.addressed !== 'direct'
  ) {
    return { ok: false, reason: 'invalid-addressed' }
  }
  if (!optionalStringOrNull(raw.channel) || !optionalStringOrNull(raw.url)) {
    return { ok: false, reason: 'invalid-channel-or-url' }
  }
  if (raw.meta !== undefined && !isRecord(raw.meta)) {
    return { ok: false, reason: 'invalid-meta' }
  }
  if (typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) {
    return { ok: false, reason: 'invalid-at' }
  }
  return {
    ok: true,
    event: {
      key: raw.key,
      source: raw.source,
      threadIds: raw.threadIds as string[],
      actor: raw.actor,
      human: raw.human,
      addressed: (raw.addressed as SuperAgentTriggerAddress | null | undefined) ?? null,
      channel: (raw.channel as string | null | undefined) ?? null,
      url: (raw.url as string | null | undefined) ?? null,
      text: raw.text,
      at: raw.at,
      meta: isRecord(raw.meta) ? raw.meta : {},
    },
  }
}
