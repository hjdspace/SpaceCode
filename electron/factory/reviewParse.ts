/**
 * 审查输出的严格解析与意见合并。
 *
 * 只接受 `<review>` 包裹的 JSON；围栏与前后说明会被剥掉，schema 不合法时
 * 交给上层续跑同一会话重发一次。文件路径不合法、行号越界时降级为纯文本意见，
 * 保证渲染层永远不会因为模型乱写路径而崩溃。
 */
import type {
  FactoryReviewComment,
  FactoryReviewSeverity,
  FactoryReviewVerdict,
} from '@/shared/factory'
import { isSafeRelativePath } from './config'

const REVIEW_TAG = /<review>([\s\S]*?)<\/review>/i
const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i
const MAX_LINE = 100_000

export const REVIEW_RETRY_PROMPT =
  'The previous reply could not be parsed. Reply again with exactly one <review> block containing valid JSON ' +
  '(verdict, summary, comments) and nothing else.'

export interface ParsedReviewJson {
  verdict: FactoryReviewVerdict
  summary: string
  comments: FactoryReviewComment[]
}

export type ParseReviewResult =
  | { ok: true; review: ParsedReviewJson }
  | { ok: false; error: 'missing-tag' | 'invalid-json' | 'invalid-schema'; detail?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从整段回复里取出 `<review>` 内的 JSON 文本；不存在返回 null。 */
export function extractReviewJson(text: string): string | null {
  const match = REVIEW_TAG.exec(text)
  if (!match) return null
  let inner = match[1].trim()
  const fenced = FENCE.exec(inner)
  if (fenced) inner = fenced[1].trim()
  return inner
}

function severity(value: unknown): FactoryReviewSeverity {
  return value === 'blocker' ? 'blocker' : 'suggestion'
}

function normalizeComment(raw: Record<string, unknown>, id: string): FactoryReviewComment | null {
  const body = typeof raw.body === 'string' ? raw.body.trim() : ''
  if (!body) return null

  const comment: FactoryReviewComment = { id, body, severity: severity(raw.severity), status: 'open' }
  if (typeof raw.file === 'string' && isSafeRelativePath(raw.file)) {
    comment.file = raw.file
    if (
      typeof raw.line === 'number' &&
      Number.isInteger(raw.line) &&
      raw.line > 0 &&
      raw.line <= MAX_LINE
    ) {
      comment.line = raw.line
    }
  }
  return comment
}

function parseJson(raw: unknown): ParsedReviewJson | null {
  if (!isRecord(raw)) return null
  const verdict = raw.verdict
  if (verdict !== 'approved' && verdict !== 'needs_changes') return null
  const summary = typeof raw.summary === 'string' ? raw.summary : ''
  if (raw.comments !== undefined && !Array.isArray(raw.comments)) return null

  const comments: FactoryReviewComment[] = []
  for (const item of raw.comments ?? []) {
    if (!isRecord(item)) return null
    const comment = normalizeComment(item, `c${comments.length + 1}`)
    if (!comment) return null
    comments.push(comment)
  }
  return { verdict, summary, comments }
}

export function parseReviewOutput(text: string): ParseReviewResult {
  const json = extractReviewJson(text)
  if (json === null) return { ok: false, error: 'missing-tag' }

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (error) {
    return { ok: false, error: 'invalid-json', detail: String((error as Error)?.message ?? error) }
  }

  const parsed = parseJson(raw)
  if (!parsed) return { ok: false, error: 'invalid-schema' }
  return { ok: true, review: parsed }
}

function key(comment: Pick<FactoryReviewComment, 'file' | 'line' | 'body'>): string {
  return `${comment.file ?? ''}|${comment.line ?? ''}|${comment.body}`
}

/**
 * 新一轮审查的意见合并：命中同一文件/行/内容的意见保留原 id 与处理状态，
 * 旧意见不再出现时按结论标记为已解决（忽略的保持不变），新意见追加新 id。
 */
export function mergeReviewComments(
  previous: readonly FactoryReviewComment[],
  next: readonly FactoryReviewComment[],
  verdict: FactoryReviewVerdict,
): FactoryReviewComment[] {
  const used = new Set(previous.map((comment) => comment.id))
  let counter = 0
  const freshId = (): string => {
    let id = `c${++counter}`
    while (used.has(id)) id = `c${++counter}`
    used.add(id)
    return id
  }

  const matched = new Set<number>()
  const merged: FactoryReviewComment[] = []
  for (const comment of previous) {
    if (comment.status === 'resolved') continue
    const index = next.findIndex((item, itemIndex) => !matched.has(itemIndex) && key(item) === key(comment))
    if (index >= 0) {
      matched.add(index)
      const item = next[index]
      merged.push({ ...comment, file: item.file, line: item.line, body: item.body, severity: item.severity })
      continue
    }
    merged.push(
      verdict === 'approved' && comment.status !== 'ignored' ? { ...comment, status: 'resolved' } : comment,
    )
  }

  next.forEach((comment, index) => {
    if (matched.has(index)) return
    merged.push({ ...comment, id: freshId(), status: 'open' })
  })

  return merged
}
