/**
 * 卡片提交的宿主回环（票 04，PRD §4）。
 *
 * 沙箱只递来一个 payload，能不能提交、提交成什么样、提交完这张卡还剩什么，全在这里定：
 * 校验 → 生成确定性摘要 → 落一条 user 消息 → 回写卡片只读标记。
 * 摘要与完整 payload 写在**同一条**消息正文里（不引入「隐藏消息」概念）：引擎拿到的仍是
 * 完整正文，气泡按 metadata 只渲染摘要，重载与重新进入历史后据此继续折叠。
 *
 * 纯逻辑：store、i18n 与时间都从 deps 注入，因此「发送失败不写只读状态」「重复提交只发一次」
 * 这类顺序契约能脱离真实宿主单测（见 ADR 0011）。
 */
import { GENUI_MAX_SUBMIT_BYTES } from '@/shared/genuiSandbox'
import { utf8ByteLength } from './cardActions'
import type {
  GenuiCardRecord,
  GenuiCardSubmissionMeta,
  GenuiCardSubmittedMark,
  GenuiSubmissionUserMessageMetadata,
} from '@/types/genui'
import type { Message } from '@/types'

export { GENUI_MAX_SUBMIT_BYTES }

/** i18n 取词函数（组件侧传 `i18n.global.t` 的绑定）。 */
export type GenuiTranslate = (key: string, params?: Record<string, unknown>) => string

/** payload 层面的拒绝原因：与桥闸门共用同一批口径。 */
export type GenuiSubmissionRejectReason = 'invalid-payload' | 'unserializable' | 'oversized'

/** 整条回环的失败原因：payload 校验之外还包括送不出去。 */
export type GenuiSubmissionFailure = GenuiSubmissionRejectReason | 'send-failed' | 'session-unavailable'

export type GenuiCardSubmissionDraft = {
  /** 进模型上下文与会话正文的完整内容：摘要 + 围栏 JSON */
  content: string
  summary: string
  metadata: GenuiCardSubmissionMeta
}

export type GenuiCardSubmissionBuild =
  | { ok: true; draft: GenuiCardSubmissionDraft }
  | { ok: false; reason: GenuiSubmissionRejectReason }

export type GenuiCardSubmissionResult =
  | { status: 'submitted'; summary: string }
  | { status: 'ignored' }
  | { status: 'failed'; reason: GenuiSubmissionFailure }

export type GenuiSubmissionSendMessageOptions = {
  sessionId?: string
  /** 随用户消息一起落库的 metadata（折叠标记与 payload 在这里） */
  userMessageMetadata?: GenuiSubmissionUserMessageMetadata
  /** 引擎派发结果：无参即已送达，带错误即送达失败。摘要落库只等这一步，不等整轮回复。 */
  onDispatched?: (error?: unknown) => void
}

export type GenuiSubmissionTurnPort = {
  sendMessage: (
    content: string,
    displayContent?: string,
    attachments?: undefined,
    options?: GenuiSubmissionSendMessageOptions,
  ) => Promise<void>
}

export type GenuiCardSubmissionHostDeps = {
  sessionId: () => string | undefined
  messages: () => Message[]
  translate: GenuiTranslate
  updateMessage: (messageId: string, patch: Partial<Message>, sessionId: string) => void
  turn: GenuiSubmissionTurnPort
  now: () => number
  maxSubmitBytes?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 序列化体积；循环引用等结构返回 null，由调用方拒绝而不是让异常穿出提交口。 */
function compactJsonBytes(value: unknown): number | null {
  try {
    const json = JSON.stringify(value)
    return json === undefined ? null : utf8ByteLength(json)
  } catch {
    return null
  }
}

/** pretty JSON；不可序列化已由体积闸门拦在前面，这里只可能成功。 */
function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return ''
  }
}

/** 卡片标识：`props.title` 优先，其次根组件名，都没有就退回卡片 id。 */
function cardLabel(card: GenuiCardRecord): string {
  const schema = card.schema
  const title = isRecord(schema?.props) && typeof schema.props.title === 'string'
    ? schema.props.title.trim()
    : ''
  if (title) return title
  const componentName = typeof schema?.componentName === 'string' ? schema.componentName.trim() : ''
  return componentName || card.id
}

/**
 * 字段/条目数量：只有一个键且值是数组时按条目计（「勾选了 3 项」比「1 个字段」可读），
 * 其余按顶层键数计。键序不影响结果，因此同一份内容任何时候提交都拿到同一句摘要。
 */
function countEntries(payload: Record<string, unknown>): { count: number; asItems: boolean } {
  const keys = Object.keys(payload)
  const only = keys.length === 1 ? payload[keys[0]] : undefined
  if (keys.length === 1 && Array.isArray(only)) {
    return { count: only.length, asItems: true }
  }
  return { count: keys.length, asItems: false }
}

export function buildGenuiCardSubmission(
  card: GenuiCardRecord,
  payload: unknown,
  options: { translate: GenuiTranslate; maxBytes?: number },
): GenuiCardSubmissionBuild {
  if (!isRecord(payload)) return { ok: false, reason: 'invalid-payload' }

  const bytes = compactJsonBytes(payload)
  if (bytes === null) return { ok: false, reason: 'unserializable' }
  if (bytes > (options.maxBytes ?? GENUI_MAX_SUBMIT_BYTES)) return { ok: false, reason: 'oversized' }

  const { count, asItems } = countEntries(payload)
  const summary = options.translate(asItems ? 'genui.submission.summaryItems' : 'genui.submission.summaryFields', {
    name: cardLabel(card),
    count,
  })

  return {
    ok: true,
    draft: {
      content: `${summary}\n\n\`\`\`json\n${prettyJson(payload)}\n\`\`\``,
      summary,
      metadata: { cardId: card.id, summary, payload, collapsed: true },
    },
  }
}

type LocatedCard = { message: Message; record: GenuiCardRecord }

export function createGenuiCardSubmissionHost(deps: GenuiCardSubmissionHostDeps) {
  /** 在飞的卡片 id：提交是异步的，双击与并发都只该发出一次。 */
  const inFlight = new Set<string>()

  function locateCard(cardId: string): LocatedCard | null {
    for (const message of deps.messages()) {
      const cards = message.metadata?.genUiCards
      if (!cards?.length) continue
      const record = cards.find(card => card.id === cardId)
      if (record) return { message, record }
    }
    return null
  }

  /** 只等「派发确认」这一步：整轮回复要几十秒，卡片不该被它锁住。 */
  function dispatch(draft: GenuiCardSubmissionDraft, sessionId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      deps.turn
        .sendMessage(draft.content, undefined, undefined, {
          sessionId,
          userMessageMetadata: { genUiSubmission: draft.metadata },
          onDispatched: (error) => finish(!error),
        })
        .then(
          () => finish(false),
          () => finish(false),
        )
    })
  }

  function markSubmitted(cardId: string, submitted: GenuiCardSubmittedMark, sessionId: string): void {
    const located = locateCard(cardId)
    if (!located) return
    const cards = located.message.metadata?.genUiCards ?? []
    deps.updateMessage(
      located.message.id,
      {
        metadata: {
          ...located.message.metadata,
          genUiCards: cards.map(card => (card.id === cardId ? { ...card, submitted } : card)),
        },
      },
      sessionId,
    )
  }

  return {
    async submit(card: GenuiCardRecord, payload: unknown): Promise<GenuiCardSubmissionResult> {
      // 以落库里的记录为准：组件手上的副本可能已经落后一次提交。
      const located = locateCard(card.id)
      const current = located?.record ?? card
      if (current.submitted || inFlight.has(current.id)) return { status: 'ignored' }

      const built = buildGenuiCardSubmission(current, payload, {
        translate: deps.translate,
        maxBytes: deps.maxSubmitBytes,
      })
      if (!built.ok) return { status: 'failed', reason: built.reason }

      const sessionId = deps.sessionId()
      if (!sessionId) return { status: 'failed', reason: 'session-unavailable' }

      inFlight.add(current.id)
      try {
        const dispatched = await dispatch(built.draft, sessionId)
        // 送不出去就不写只读状态：卡片保持可编辑，用户看到可重试错误后还能再提交。
        if (!dispatched) return { status: 'failed', reason: 'send-failed' }
        markSubmitted(current.id, { summary: built.draft.summary, submittedAt: deps.now() }, sessionId)
        return { status: 'submitted', summary: built.draft.summary }
      } finally {
        inFlight.delete(current.id)
      }
    },
  }
}

export type GenuiCardSubmissionHost = ReturnType<typeof createGenuiCardSubmissionHost>

/**
 * 用户气泡的可显示文本：提交消息的正文带着完整围栏 JSON，只显示摘要；
 * metadata 缺失（被裁剪、旧数据）时退回原文，内容不会被吞掉。
 */
export function resolveUserMessageDisplay(message: Message): string {
  const submission = message.metadata?.genUiSubmission
  if (submission?.collapsed && typeof submission.summary === 'string' && submission.summary) {
    return submission.summary
  }
  return message.content
}
