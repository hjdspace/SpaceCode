/**
 * 助手正文 → 「可见正文 + 卡片记录」的投影（票 02 的核心边界）。
 *
 * 唯一识别 ` ```schemaJson ` 闭合围栏：其他语言标记、缩进代码块、行内反引号都不动。
 * 纯函数、限额可注入，因此流式更新、消息收口、历史回放与持久化都复用同一条判定，
 * 不依赖 store 与 DOM（口径见 `docs/prd/genui-cards.md` §1）。组件白名单只有一个来源：
 * `@/shared/genuiMaterials`，宿主判定与沙箱注册共用它，不提供按次覆盖的入口。
 *
 * 两条不成卡的处理原则：
 * - 成不了卡就**不动正文**——围栏原样留下当代码块显示，内容不会被静默丢弃；
 * - 另外落一条 `fallbacks` 记录，由宿主渲染可见说明，用户知道这张卡为什么没出来。
 */
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import { isGenuiComponentAllowed } from '@/shared/genuiMaterials'
import { utf8ByteLength } from './cardActions'
import type { GenuiCardFallback, GenuiCardFallbackReason, GenuiCardRecord } from '@/types/genui'

/** 单卡 schema 原文上限（PRD §1：超限按后面的卡降级为文本处理）。 */
export const GENUI_MAX_CARD_SCHEMA_BYTES = 64 * 1024

/** 单条消息的卡片数上限。 */
export const GENUI_MAX_CARDS_PER_MESSAGE = 8

/**
 * 卡片 id 的分隔符与形状：`${messageId}${SEP}${围栏序号}`。
 * id 由正文里第几个围栏决定，与渲染时刻无关 —— 投影因此是幂等的，
 * 重投影、历史回放与落盘找回的都是同一张卡（票 05 第 2 条）。
 */
export const GENUI_CARD_ID_SEPARATOR = ':card:'

export type GenuiCardIdParts = { messageId: string; index: number }

/** 拼出确定性的卡片 id。 */
export function buildGenuiCardId(messageId: string, index: number): string {
  return `${messageId}${GENUI_CARD_ID_SEPARATOR}${index}`
}

/**
 * 反解卡片 id。序号取**最后**一段 `:card:` 之后的数字：消息 id 本身也可能带冒号
 * （引擎给的消息 id 就长这样），从前往后找会把它自己的片段当成序号。
 */
export function cardIdParts(id: unknown): GenuiCardIdParts | null {
  if (typeof id !== 'string') return null
  const at = id.lastIndexOf(GENUI_CARD_ID_SEPARATOR)
  if (at <= 0 || at + GENUI_CARD_ID_SEPARATOR.length >= id.length) return null
  const index = Number(id.slice(at + GENUI_CARD_ID_SEPARATOR.length))
  if (!Number.isInteger(index) || index < 0) return null
  return { messageId: id.slice(0, at), index }
}

/** 卡片围栏的语言标记，大小写敏感。 */
export const GENUI_CARD_FENCE_INFO = 'schemaJson'

const OPEN_RE = /^(`{3,})([A-Za-z0-9_-]*)[ \t]*$/
const CLOSE_RE = /^(`{3,})[ \t]*$/

export type GenuiProjectionOptions = {
  /** false = 流式期间：未闭合围栏只隐藏，不成卡也不记降级。默认 false。 */
  final?: boolean
  protocolVersion?: number
  maxSchemaBytes?: number
  maxCardsPerMessage?: number
}

export type GenuiCardProjection = {
  /** 去掉已成卡围栏后的可见正文 */
  text: string
  cards: GenuiCardRecord[]
  fallbacks: GenuiCardFallback[]
}

type FenceSlot = {
  /** 围栏序号，同时是卡片与降级记录的 id 序号 */
  index: number
  /** 开栏行下标 */
  from: number
  /** 闭栏行下标；未闭合为 null，此时围栏吞到文末 */
  to: number | null
  /** 围栏内的原文（已去掉行尾 `\r`） */
  body: string
}

const stripCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line)

const isBlank = (line: string | undefined): boolean => line === undefined || line.trim() === ''

/** 从尚未解析成功的围栏体里尽量取一个组件名，只为降级提示可读。 */
function peekComponentName(body: string): string {
  const match = /"componentName"\s*:\s*"([^"]*)"/.exec(body)
  return match?.[1]?.trim() ?? ''
}

/**
 * 扫描围栏槽位。未闭合的围栏吞到文末，因此最多只可能出现在最后一个槽位；
 * 它依然占一个序号，这样流式期间隐藏的围栏一旦闭合，卡片 id 不会漂移。
 */
function scanFences(lines: string[]): FenceSlot[] {
  const slots: FenceSlot[] = []
  let i = 0

  while (i < lines.length) {
    const open = OPEN_RE.exec(stripCr(lines[i]))
    if (!open || open[2] !== GENUI_CARD_FENCE_INFO) {
      i += 1
      continue
    }
    const markerLength = open[1].length
    let close = -1
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = CLOSE_RE.exec(stripCr(lines[j]))
      if (candidate && candidate[1].length >= markerLength) {
        close = j
        break
      }
    }
    const to = close < 0 ? null : close
    slots.push({
      index: slots.length,
      from: i,
      to,
      body: lines.slice(i + 1, to ?? lines.length).map(stripCr).join('\n'),
    })
    i = to === null ? lines.length : to + 1
  }

  return slots
}

/**
 * 拼可见正文。移除围栏时只做局部收拾：两侧都留空行就并成一个，两侧都是正文就补一个空行，
 * 保住 Markdown 的段落分隔；未动过任何一行就原样返回，普通消息因此零变化。
 */
function assembleText(lines: string[], hidden: Set<number>): string {
  if (hidden.size === 0) return lines.join('\n')

  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (!hidden.has(i)) {
      out.push(stripCr(lines[i]))
      i += 1
      continue
    }
    let end = i
    while (end < lines.length && hidden.has(end)) end += 1
    const prevBlank = isBlank(out[out.length - 1])
    const nextBlank = isBlank(lines[end])
    if (prevBlank && nextBlank && end < lines.length) {
      // 移除点两侧各有一个空行，只留一个
      i = end + 1
    } else {
      if (!prevBlank && !nextBlank) out.push('')
      i = end
    }
  }

  while (out.length > 0 && isBlank(out[0])) out.shift()
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop()
  return out.join('\n')
}

/** 校验一个闭合围栏的原文，返回卡片 schema 或降级原因。 */
function evaluateSlot(
  slot: FenceSlot,
  options: { protocolVersion: number; maxSchemaBytes: number },
): { schema: Record<string, unknown> } | { reason: GenuiCardFallbackReason } {
  if (utf8ByteLength(slot.body) > options.maxSchemaBytes) {
    return { reason: 'oversized-schema' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(slot.body)
  } catch {
    return { reason: 'malformed-json' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { reason: 'not-an-object' }
  }
  const schema = parsed as Record<string, unknown>

  const rootName = typeof schema.componentName === 'string' ? schema.componentName.trim() : ''
  if (!rootName) return { reason: 'missing-component-name' }
  if (!isGenuiComponentAllowed(rootName)) return { reason: 'unsupported-component' }

  // 技能输出的 schema 可以自带协议版本；与宿主不一致就按「无法渲染」降级，
  // 避免旧技能配新渲染器产出错位界面（PRD §1）。
  if ('protocolVersion' in schema && schema.protocolVersion !== options.protocolVersion) {
    return { reason: 'protocol-version' }
  }

  return { schema }
}

export function projectGenuiCards(
  raw: string,
  messageId: string,
  options: GenuiProjectionOptions = {},
): GenuiCardProjection {
  const final = options.final ?? false
  const protocolVersion = options.protocolVersion ?? GENUI_SANDBOX_PROTOCOL_VERSION
  const maxSchemaBytes = options.maxSchemaBytes ?? GENUI_MAX_CARD_SCHEMA_BYTES
  const maxCardsPerMessage = options.maxCardsPerMessage ?? GENUI_MAX_CARDS_PER_MESSAGE

  const lines = raw.split('\n')
  const slots = scanFences(lines)
  const cards: GenuiCardRecord[] = []
  const fallbacks: GenuiCardFallback[] = []
  const hidden = new Set<number>()

  for (const slot of slots) {
    if (slot.to === null) {
      // 收口时仍未闭合：按普通代码块显示；流式期间先藏起来
      if (!final) {
        for (let i = slot.from; i < lines.length; i += 1) hidden.add(i)
      }
      continue
    }

    const verdict = evaluateSlot(slot, { protocolVersion, maxSchemaBytes })
    const overCount = 'schema' in verdict && cards.length >= maxCardsPerMessage
    const reason: GenuiCardFallbackReason | null =
      'reason' in verdict ? verdict.reason : overCount ? 'too-many-cards' : null

    if (reason) {
      fallbacks.push({
        id: `${messageId}:fallback:${slot.index}`,
        reason,
        componentName: peekComponentName(slot.body),
      })
      continue
    }

    cards.push({
      id: buildGenuiCardId(messageId, slot.index),
      schema: (verdict as { schema: Record<string, unknown> }).schema,
      protocolVersion,
    })
    for (let i = slot.from; i <= slot.to; i += 1) hidden.add(i)
  }

  return { text: assembleText(lines, hidden), cards, fallbacks }
}

/**
 * 按确定性 id 合并卡片记录：既有记录优先（票 04/05 的提交状态挂在记录上，不能被重投影冲掉），
 * 新出现的按**围栏序号**补位。历史回放与流式收口都走这里，因此同一张卡不会被画两遍。
 *
 * 对齐用的是围栏序号而不是整条 id：引擎 JSONL 重放出来的消息 id 是引擎那套 UUID，
 * 与 SpaceCode 存的不是一套，只有「这条消息里的第几张卡」是同一件事。
 */
export function mergeGenuiCardRecords(
  existing: GenuiCardRecord[] | undefined,
  incoming: GenuiCardRecord[],
): GenuiCardRecord[] {
  const byIndex = new Map<number, GenuiCardRecord>()
  /** id 反解不出序号的记录不参与序号对齐，原序保留在最后。 */
  const unpinned: GenuiCardRecord[] = []

  const keep = (card: GenuiCardRecord): void => {
    const parts = cardIdParts(card.id)
    if (!parts) {
      if (!unpinned.some(known => known.id === card.id)) unpinned.push(card)
      return
    }
    // 已有记录优先：同一个序号只认第一次见到的那条
    if (!byIndex.has(parts.index)) byIndex.set(parts.index, card)
  }

  for (const card of existing ?? []) keep(card)
  for (const card of incoming) keep(card)

  const aligned = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, card]) => card)
  return [...aligned, ...unpinned]
}
