/**
 * Report 严格 JSON 块解析（T06 #76）。
 *
 * Worker 消息中必须携带唯一的 ```super-agent:report 围栏块；块内是一份 JSON
 * 对象，必填 assignmentId/reportId/kind/summary，可选 details/artifacts/
 * question/askedBy/answers，progress 类专属 currentTool/toolCalls/elapsedMs。
 *
 * 严格校验：未知字段、非对象 JSON、恶意嵌套、类型不符、progress 专属字段
 * 出现在其他 kind 上一律按协议失败拒绝，抛稳定错误码（refused 类）：
 *   reportMissing    — 没有报告块（turn 结束协议失败的判定交给 Executor）
 *   reportNotUnique   — 报告块不唯一
 *   reportUnparsable  — JSON 无法解析
 *   reportInvalid     — 字段缺失/类型不符/越权字段
 * 解析成功时保留原文块（raw）供审计；assignmentId 归属/状态迁移由 Domain 校验。
 */
import type { SuperAgentReportKind } from './model'
import { superAgentError } from './errors'

/** 围栏 info string；Worker 提示词按此输出报告块。 */
export const SUPER_AGENT_REPORT_FENCE = 'super-agent:report'

const REPORT_BLOCK_PATTERN = new RegExp(
  `(^|\\n)[ \\t]*\\\`\\\`\\\`${SUPER_AGENT_REPORT_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?\\\`\\\`\\\``,
  'g',
)

const REPORT_KINDS: readonly SuperAgentReportKind[] = [
  'progress',
  'waiting',
  'ready',
  'blocked',
  'failed',
  'dropped',
]

const COMMON_FIELDS = new Set([
  'assignmentId',
  'reportId',
  'kind',
  'summary',
  'details',
  'artifacts',
  'question',
  'askedBy',
  'answers',
])

const PROGRESS_FIELDS = new Set(['currentTool', 'toolCalls', 'elapsedMs'])

/** kind='progress' 时可能携带的轻量进度事实；进入 ticket.progress 投影。 */
export interface SuperAgentReportProgress {
  currentTool: string | null
  toolCalls: number | null
  elapsedMs: number | null
}

/** 解析结果：ReportCommand（ticketId 由调用方按 assignmentId 归属补齐）。 */
export interface ParsedSuperAgentReport {
  assignmentId: string
  reportId: string
  kind: SuperAgentReportKind
  summary: string
  question: string | null
  askedBy: string | null
  answers: string[]
  details: string | null
  artifacts: string[]
  /** 仅 kind='progress' 时非 null。 */
  progress: SuperAgentReportProgress | null
  /** 原文块内容，审计保留；不进入任何 UI 投影。 */
  raw: string
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw superAgentError('reportInvalid', { field })
  }
  return value
}

function optionalNonEmptyString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  return requireNonEmptyString(value, field)
}

function optionalStringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw superAgentError('reportInvalid', { field })
  return value.map((item) => requireNonEmptyString(item, field))
}

function parseProgressFacts(
  record: Record<string, unknown>,
  kind: SuperAgentReportKind,
): SuperAgentReportProgress | null {
  const hasProgressField = [...PROGRESS_FIELDS].some((field) => record[field] !== undefined)
  if (kind !== 'progress') {
    if (hasProgressField) {
      throw superAgentError('reportInvalid', { field: 'currentTool' })
    }
    return null
  }

  const currentToolRaw = record.currentTool
  if (currentToolRaw !== undefined && currentToolRaw !== null) {
    requireNonEmptyString(currentToolRaw, 'currentTool')
  }
  const toolCallsRaw = record.toolCalls
  if (
    toolCallsRaw !== undefined &&
    toolCallsRaw !== null &&
    (!Number.isInteger(toolCallsRaw) || (toolCallsRaw as number) < 0)
  ) {
    throw superAgentError('reportInvalid', { field: 'toolCalls' })
  }
  const elapsedRaw = record.elapsedMs
  if (
    elapsedRaw !== undefined &&
    elapsedRaw !== null &&
    (typeof elapsedRaw !== 'number' || !Number.isFinite(elapsedRaw) || elapsedRaw < 0)
  ) {
    throw superAgentError('reportInvalid', { field: 'elapsedMs' })
  }

  if (!hasProgressField) return null
  return {
    currentTool: (currentToolRaw as string | null) ?? null,
    toolCalls: (toolCallsRaw as number | null) ?? null,
    elapsedMs: (elapsedRaw as number | null) ?? null,
  }
}

/** 解析单个报告块原文：JSON 严格校验，失败抛稳定错误码。 */
export function parseSuperAgentReportBlock(raw: string): ParsedSuperAgentReport {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw superAgentError('reportUnparsable')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw superAgentError('reportInvalid', { field: 'root' })
  }

  const record = value as Record<string, unknown>
  for (const field of Object.keys(record)) {
    if (!COMMON_FIELDS.has(field) && !PROGRESS_FIELDS.has(field)) {
      throw superAgentError('reportInvalid', { field })
    }
  }

  const assignmentId = requireNonEmptyString(record.assignmentId, 'assignmentId')
  const reportId = requireNonEmptyString(record.reportId, 'reportId')
  const kindRaw = requireNonEmptyString(record.kind, 'kind')
  if (!REPORT_KINDS.includes(kindRaw as SuperAgentReportKind)) {
    throw superAgentError('reportInvalid', { field: 'kind' })
  }
  const kind = kindRaw as SuperAgentReportKind
  const summary = requireNonEmptyString(record.summary, 'summary')

  const question = optionalNonEmptyString(record.question, 'question')
  const askedBy = optionalNonEmptyString(record.askedBy, 'askedBy')
  const answers = optionalStringList(record.answers, 'answers')
  const details = optionalNonEmptyString(record.details, 'details')
  const artifacts = optionalStringList(record.artifacts, 'artifacts')
  const progress = parseProgressFacts(record, kind)

  return {
    assignmentId,
    reportId,
    kind,
    summary,
    question,
    askedBy,
    answers,
    details,
    artifacts,
    progress,
    raw,
  }
}

/** 提取消息中的全部报告块原文（围栏 info string 必须精确匹配）。 */
export function findSuperAgentReportBlocks(text: string): string[] {
  const blocks: string[] = []
  for (const match of text.matchAll(REPORT_BLOCK_PATTERN)) {
    blocks.push((match[2] ?? '').trim())
  }
  return blocks
}

/**
 * 解析整条 Worker 消息：0 个报告块 → reportMissing；多于 1 个 →
 * reportNotUnique；恰好 1 个 → 严格校验后返回解析结果。
 */
export function parseSuperAgentReportText(text: string): ParsedSuperAgentReport {
  const blocks = findSuperAgentReportBlocks(text)
  if (blocks.length === 0) throw superAgentError('reportMissing')
  if (blocks.length > 1) throw superAgentError('reportNotUnique')
  return parseSuperAgentReportBlock(blocks[0])
}
