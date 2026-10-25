/**
 * 卡片的生命周期规则（票 05）：确定性 id、可渲染形状、会话预算与损坏 metadata 兜底。
 *
 * 一句话口径：**卡片会不在、在哪、还能不能渲染，全部由 metadata 里的记录决定**，
 * 正文投影只负责补充新出现的卡。三件事分别钉住：
 *
 * - 重投影去重：见 `mergeGenuiCardRecords`（在 cardProjection，已有记录优先）；
 * - 会话预算：512KB 是「保护持久化可用」的约束 —— 现有会话裁剪只裁正文不裁 metadata，
 *   不设上限就会把整条会话挤到存不下。顶穿时从最旧的卡开始丢 payload 留占位，
 *   驱逐结果写回记录本身，所以内存、落盘与下次读取看到的是同一份事实；
 * - 兜底：metadata 损坏（旧版本、手改、裁剪残留）不能让会话打不开，
 *   坏记录降级成可见占位而不是静默消失，占位仍然计入预算。
 *
 * 全部是纯函数：会话与消息的形状可注入，因此这些边界不依赖 store 与 DOM 就能单测。
 */
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import { utf8ByteLength } from './cardActions'
import { GENUI_MAX_CARD_SCHEMA_BYTES } from './cardProjection'
import type { GenuiCardFallback, GenuiCardRecord } from '@/types/genui'
import type { Message, MessageMetadata, Session } from '@/types'

/**
 * 单会话卡片记录的持久化预算，单位是 **localStorage 实际收费的字节数**（UTF-16，即字符数 ×2）——
 * 与 `sessionPersistence.estimateUtf16Bytes` 同口径（那边是服务层，这里不回 import 以免成环）。
 * PRD §5：超预算从最旧的卡开始丢 payload，改为可见的「卡片内容已过期」占位。
 *
 * 单卡限额按 UTF-8 计（那是桥消息的口径），所以两条限额天然不是同一个尺子：
 * 一张纯 ASCII 的 64KB schema 在存储侧值 128KB。满载 8 张的极端消息因此会顶穿预算并挤掉最旧的几张，
 * 这正是「先存得下」要的结果 —— 预算保的是会话可持久化，不是「一条消息必须装满」。
 */
export const GENUI_SESSION_CARD_BUDGET_BYTES = 512 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把一条 metadata 记录收敛成可渲染形状；不可信的形状返回 null（渲染侧给可见占位）。
 *
 * 只认三种形态：带 schema 的正常卡、被预算驱逐的过期卡（schema 为 null 且 expired），
 * 以及形状不对的坏记录。已提交标记坏了就丢掉标记、保住卡本身 —— 卡片内容还在，
 * 没必要因为一次 metadata 抖动把整张卡换成错误占位。
 */
export function toRenderableCard(value: unknown): GenuiCardRecord | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id) return null
  if (typeof value.protocolVersion !== 'number') return null

  const expired = value.expired === true
  const schema = isRecord(value.schema) ? (value.schema as Record<string, unknown>) : null
  if (schema === null && !expired) return null

  const card: GenuiCardRecord = { id: value.id, schema, protocolVersion: value.protocolVersion }
  if (expired) card.expired = true

  const submitted = value.submitted
  if (
    isRecord(submitted) &&
    typeof submitted.summary === 'string' &&
    typeof submitted.submittedAt === 'number'
  ) {
    card.submitted = { summary: submitted.summary, submittedAt: submitted.submittedAt }
  }
  return card
}

/**
 * schema 是否还能交给沙箱渲染：形状 + 单卡限额一起判。
 *
 * 限额判在这里而不是只判在投影，是为了让「渲染 / 桥消息 / 持久化」用同一个口径 ——
 * 否则一份被裁剪或来自旧版本的超大 schema 会画出一张存不下也发不出的卡。
 */
export function isCardSchemaRenderable(schema: unknown): schema is Record<string, unknown> {
  if (!isRecord(schema)) return false
  try {
    return utf8ByteLength(JSON.stringify(schema)) <= GENUI_MAX_CARD_SCHEMA_BYTES
  } catch {
    return false
  }
}

/**
 * 一条记录落盘占多少：localStorage 按 UTF-16 收费，而写出去的是整条 JSON，
 * 所以过期占位那层 id 与字段名也要算进来 —— 只算 schema 会低估驱逐后的体积，
 * 于是「驱逐了还是存不下」。导出给用例按同一把尺子摆预算，避免测试自己抄一套单位。
 */
export function genuiCardStorageBytes(card: GenuiCardRecord): number {
  try {
    return JSON.stringify(card).length * 2
  } catch {
    // 序列化不了的记录（循环引用等）按整份预算算：它一定是最先被请出去的那张
    return GENUI_SESSION_CARD_BUDGET_BYTES
  }
}

function eachCard(messages: Message[]): GenuiCardRecord[] {
  const cards: GenuiCardRecord[] = []
  for (const message of messages) {
    const stored = message.metadata?.genUiCards
    if (Array.isArray(stored)) cards.push(...stored)
  }
  return cards
}

/**
 * 会话卡片预算：顶穿时按「从旧到新」丢 payload，只留可见占位。
 *
 * 顺序就是文档顺序（消息在先、围栏序号在小者为先），与用户看到的位置一致；
 * 已丢过的不再计入完整体积，因此重复调用收敛（幂等）。
 * 就地改写传入会话里的记录：调用方要么持有副本（持久化前），要么本来就在改 store
 * （投影出新卡时），两处都要求内存与落盘同份事实。
 */
export function applyGenuiCardBudget(
  session: Pick<Session, 'messages'>,
  options: { budgetBytes?: number } = {},
): { evicted: GenuiCardRecord[] } {
  const budget = options.budgetBytes ?? GENUI_SESSION_CARD_BUDGET_BYTES
  const cards = eachCard(session.messages)
  const sizes = cards.map(genuiCardStorageBytes)
  let total = sizes.reduce((sum, size) => sum + size, 0)

  const evicted: GenuiCardRecord[] = []
  for (let i = 0; i < cards.length && total > budget; i += 1) {
    const card = cards[i]
    if (card.expired || card.schema === null) continue
    card.schema = null
    card.expired = true
    // 驱逐后仍留下的 id / 字段名也占体积：按改写后的同一条记录重新结算
    total += genuiCardStorageBytes(card) - sizes[i]
    evicted.push(card)
  }

  return { evicted }
}

/**
 * 读取侧兜底：把 metadata 里不可信的卡片形状收敛成可渲染记录，坏的一律丢。
 *
 * 会话打开比卡片重要 —— 这里绝不抛错，也不动正文与其它 metadata 字段。
 * 返回丢掉的条数，调用方据此决定是否记一条诊断；用户侧的可见说明由渲染侧给。
 */
export function sanitizeGenuiSession(session: Session): {
  droppedCards: number
  droppedFallbacks: number
  droppedSubmissions: number
} {
  let droppedCards = 0
  let droppedFallbacks = 0
  let droppedSubmissions = 0

  for (const message of session.messages) {
    const metadata = message.metadata
    if (!isRecord(metadata)) continue
    const next: MessageMetadata = { ...metadata }

    if ('genUiCards' in next) {
      const stored = next.genUiCards
      const keep = Array.isArray(stored)
        ? stored.reduce<GenuiCardRecord[]>((acc, item) => {
            const renderable = toRenderableCard(item)
            if (renderable) acc.push(renderable)
            else droppedCards += 1
            return acc
          }, [])
        : []
      if (!keep.length) delete next.genUiCards
      else next.genUiCards = keep
    }

    if ('genUiCardFallbacks' in next) {
      const stored = next.genUiCardFallbacks
      const keep = Array.isArray(stored) ? stored.filter(isCardFallback) : []
      // 整条不是数组时也按「丢了一项」计：它确实是原样存着的一条说明，读不出来就是没了
      droppedFallbacks += (Array.isArray(stored) ? stored.length : stored ? 1 : 0) - keep.length
      if (!keep.length) delete next.genUiCardFallbacks
      else next.genUiCardFallbacks = keep
    }

    if ('genUiSubmission' in next) {
      const submission = next.genUiSubmission
      const valid = isRecord(submission) && typeof submission.summary === 'string'
      if (!valid) {
        delete next.genUiSubmission
        droppedSubmissions += 1
      }
    }

    if (next !== metadata) message.metadata = next
  }

  return { droppedCards, droppedFallbacks, droppedSubmissions }
}

function isCardFallback(value: unknown): value is GenuiCardFallback {
  return isRecord(value) && typeof value.id === 'string' && typeof value.reason === 'string'
}

/**
 * 渲染侧归一：坏记录不删也不隐藏，而是占住自己原来那一格给一句可见说明 ——
 * 位置与顺序仍与正文里的围栏一致，同组别的卡也不受牵连（票 05 第 1、6 条）。
 * 读不出 id 时用 `${messageId}:damaged:${index}` 顶上，它只当列表 key，不参与 id 合并；
 * 补上当前协议版本，免得一张坏记录被报成「版本不匹配」而遮掉真正的原因（形状坏了）。
 */
function toDisplayCard(value: unknown, messageId: string, index: number): GenuiCardRecord {
  const renderable = toRenderableCard(value)
  if (renderable) return renderable
  const knownId = isRecord(value) && typeof value.id === 'string' && value.id ? value.id : null
  return {
    id: knownId ?? `${messageId || 'unknown'}:damaged:${index}`,
    schema: null,
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
  }
}

/** 整条 genUiCards 的归一：不是数组（旧版本、裁剪残留）就当作没有，不把消息读断。 */
export function toDisplayCards(stored: unknown, messageId: string): GenuiCardRecord[] {
  if (!Array.isArray(stored)) return []
  return stored.map((value, index) => toDisplayCard(value, messageId, index))
}

/** 降级说明没有可归一的形状：认不出的条目不显示，也不能挡住同一条消息里别的说明。 */
export function toDisplayFallbacks(stored: unknown): GenuiCardFallback[] {
  if (!Array.isArray(stored)) return []
  return stored.filter(isCardFallback)
}
