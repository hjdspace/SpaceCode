/**
 * 角色受限的只读资源读取与评估窗口（#102、设计 §8.1/§8.3/§11.1）。
 *
 * 设计意图：
 *  - 模型输入一律「有界内联 + 可读引用」：Trigger 原文、Thread 时间线、Ticket
 *    详情及其 inputs/assignments/report 按页读取，截断处带总量与续读指针；
 *  - 预算只在 contextBudget.ts 定义，本文件不写死字符数；
 *  - 角色隔离在读取层做，不靠提示词：Worker 只能读自己的 Ticket、已到达的
 *    Trigger 与订阅 Thread；跨工单访问一律按「不存在」处理，避免泄露存在性；
 *    共享 Thread 上其他工单的订阅/授权不出现在 Worker 的视图里；
 *  - 只读：不提供 stop/abort/answer/建单/写入口（§8.3）。
 *
 * 暴露给模型的通路：当前引擎 allowedTools 尚未开放 Super Agent 工具面，因此
 * 先以「候选卡片注入 read 指针」的最小形态落地（见 evalDriver）；工具注册
 * 就绪后把同一 reader 挂成 `superagent_read(resource, offset, limit)` 即可，
 * 不重复实现分页与角色校验。
 */
import { SUPER_AGENT_CONTEXT_BUDGETS } from './contextBudget'
import type { SuperAgentDomain } from './domain'
import { superAgentError } from './errors'
import type {
  SuperAgentAssignment,
  SuperAgentDomainState,
  SuperAgentReport,
  SuperAgentThread,
  SuperAgentTicket,
  SuperAgentTrigger,
} from './model'

/** 读取角色：Router 读全局只读视图；Worker 带自己的工单边界。 */
export type SuperAgentReadRole =
  | { kind: 'router' }
  | { kind: 'worker'; ticketId: string; assignmentId?: string }

/** 文本页：按 UTF-16 code units 分页，分页结果可重组原文。 */
export interface SuperAgentReadTextPage {
  kind: 'text'
  resourceId: string
  /** 完整文本长度（UTF-16 code units）。 */
  totalChars: number
  offset: number
  /** 本页实际内联的字符数。 */
  read: number
  /** 续读指针；null 表示已到末尾。 */
  nextOffset: number | null
  text: string
}

/** 列表页：按条数分页。 */
export interface SuperAgentReadListPage<T = unknown> {
  kind: 'list'
  resourceId: string
  total: number
  offset: number
  limit: number
  nextOffset: number | null
  items: T[]
}

export type SuperAgentReadResult<T = unknown> =
  | SuperAgentReadTextPage
  | SuperAgentReadListPage<T>

export interface SuperAgentReadAssignmentItem {
  assignmentId: string
  generation: number
  state: SuperAgentAssignment['state']
  createdAt: string
  endedAt: string | null
  endedReason: SuperAgentAssignment['endedReason']
  reportKind: SuperAgentReport['kind'] | null
}

/** 评估窗口：把有界 Thread 片段作为评估卡的一部分交给 Router。 */
export interface SuperAgentEvalThreadWindow {
  threadId: string
  /** 已渲染的窗口正文。 */
  text: string
  /** 实际纳入窗口的 Trigger（按到达顺序）。 */
  includedTriggerIds: string[]
  /** 本批候选（用于审计/测试）。 */
  candidateTriggerIds: string[]
}

export interface SuperAgentContextReader {
  readResource(
    role: SuperAgentReadRole,
    resourceId: string,
    offset?: number,
    limit?: number,
  ): SuperAgentReadResult
  /** 评估候选的 Thread 窗口；Thread 不存在或候选都不在该 Thread 时返回 null。 */
  renderEvalThreadWindow(
    threadId: string,
    candidateTriggerIds: string[],
  ): SuperAgentEvalThreadWindow | null
}

export interface SuperAgentContextReaderOptions {
  domain: SuperAgentDomain
}

type TicketSubResource = 'inputs' | 'assignments' | 'report'

interface ParsedResource {
  kind: 'trigger' | 'thread' | 'ticket'
  id: string
  sub?: TicketSubResource
}

const TICKET_SUBRESOURCES = new Set<TicketSubResource>(['inputs', 'assignments', 'report'])

function clampOffset(value: number | undefined, total: number): number {
  if (!Number.isFinite(value ?? 0)) return 0
  const normalized = Math.floor(value ?? 0)
  return Math.min(Math.max(normalized, 0), total)
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), 1), max)
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function pagesText(
  resourceId: string,
  fullText: string,
  offset: number | undefined,
  limit: number | undefined,
): SuperAgentReadTextPage {
  const totalChars = fullText.length
  const start = clampOffset(offset, totalChars)
  const readLimit = clampLimit(
    limit,
    SUPER_AGENT_CONTEXT_BUDGETS.textPageChars,
    SUPER_AGENT_CONTEXT_BUDGETS.textPageMaxChars,
  )
  const text = fullText.slice(start, start + readLimit)
  return {
    kind: 'text',
    resourceId,
    totalChars,
    offset: start,
    read: text.length,
    nextOffset: start + text.length < totalChars ? start + text.length : null,
    text,
  }
}

function pageList<T>(
  resourceId: string,
  items: T[],
  offset: number | undefined,
  limit: number | undefined,
): SuperAgentReadListPage<T> {
  const start = clampOffset(offset, items.length)
  const readLimit = clampLimit(
    limit,
    SUPER_AGENT_CONTEXT_BUDGETS.listDefault,
    SUPER_AGENT_CONTEXT_BUDGETS.listMax,
  )
  const page = items.slice(start, start + readLimit)
  return {
    kind: 'list',
    resourceId,
    total: items.length,
    offset: start,
    limit: readLimit,
    nextOffset: start + page.length < items.length ? start + page.length : null,
    items: page,
  }
}

function truncatePreview(text: string, limit: number): { text: string; read: number; total: number } {
  const normalized = normalizeText(text)
  return {
    text: normalized.slice(0, limit),
    read: Math.min(normalized.length, limit),
    total: normalized.length,
  }
}

function indentBlock(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n')
}

function parseResourceId(resourceId: string): ParsedResource {
  const parts = resourceId.split('/')
  if (parts.length === 2 && (parts[0] === 'trigger' || parts[0] === 'thread')) {
    return { kind: parts[0], id: parts[1]! }
  }
  if (parts.length === 2 && parts[0] === 'ticket') {
    return { kind: 'ticket', id: parts[1]! }
  }
  if (
    parts.length === 3 &&
    parts[0] === 'ticket' &&
    TICKET_SUBRESOURCES.has(parts[2] as TicketSubResource)
  ) {
    return { kind: 'ticket', id: parts[1]!, sub: parts[2] as TicketSubResource }
  }
  throw superAgentError('resourceInvalid', { resourceId })
}

function requireTicket(state: SuperAgentDomainState, ticketId: string): SuperAgentTicket {
  const ticket = state.tickets[ticketId]
  if (!ticket) throw superAgentError('ticketNotFound', { ticketId })
  return ticket
}

function requireThread(state: SuperAgentDomainState, threadId: string): SuperAgentThread {
  const thread = state.threads[threadId]
  if (!thread) throw superAgentError('threadNotFound', { threadId })
  return thread
}

function requireTrigger(state: SuperAgentDomainState, triggerId: string): SuperAgentTrigger {
  const trigger = state.triggers[triggerId]
  if (!trigger) throw superAgentError('triggerNotFound', { triggerId })
  return trigger
}

/** Worker 的可见 Thread：自身来源 Thread、follows、以及它订阅的 Thread。 */
function workerThreadIds(state: SuperAgentDomainState, ticketId: string): Set<string> {
  const ticket = requireTicket(state, ticketId)
  const ids = new Set<string>([ticket.threadId, ...ticket.follows])
  for (const thread of Object.values(state.threads)) {
    if (thread.subscriptions.some((subscription) => subscription.ticketId === ticketId)) {
      ids.add(thread.threadId)
    }
  }
  return ids
}

function assertTicketAccess(
  state: SuperAgentDomainState,
  role: SuperAgentReadRole,
  ticketId: string,
): SuperAgentTicket {
  if (role.kind === 'worker' && role.ticketId !== ticketId) {
    // 跨工单资源按不存在处理：既不泄露它存在，也符合「其他工单授权不可见」。
    throw superAgentError('ticketNotFound', { ticketId })
  }
  return requireTicket(state, ticketId)
}

function assertThreadAccess(
  state: SuperAgentDomainState,
  role: SuperAgentReadRole,
  threadId: string,
): SuperAgentThread {
  const thread = requireThread(state, threadId)
  if (
    role.kind === 'worker' &&
    !workerThreadIds(state, role.ticketId).has(thread.threadId)
  ) {
    throw superAgentError('threadNotFound', { threadId })
  }
  return thread
}

function assertTriggerAccess(
  state: SuperAgentDomainState,
  role: SuperAgentReadRole,
  triggerId: string,
): SuperAgentTrigger {
  const trigger = requireTrigger(state, triggerId)
  if (role.kind === 'worker') {
    const reachedByTicket =
      trigger.disposition.ticketIds.includes(role.ticketId) ||
      trigger.disposition.contextTicketIds.includes(role.ticketId)
    const reachedByThread = trigger.threadIds.some((threadId) =>
      workerThreadIds(state, role.ticketId).has(threadId),
    )
    if (!reachedByTicket && !reachedByThread) {
      throw superAgentError('triggerNotFound', { triggerId })
    }
  }
  return trigger
}

function renderTrigger(trigger: SuperAgentTrigger): string {
  return [
    `# Trigger ${trigger.triggerId}`,
    `- source: ${trigger.source}`,
    `- threadIds: ${trigger.threadIds.join(', ') || '（无）'}`,
    `- actor: ${trigger.actor}`,
    `- human: ${trigger.human ? '是' : '否'}`,
    `- addressed: ${trigger.addressed ?? '（无）'}`,
    `- at: ${trigger.at}`,
    `- total_chars: ${trigger.text.length}`,
    '',
    '## 正文',
    '',
    normalizeText(trigger.text),
  ].join('\n')
}

/**
 * Thread 时间线：Trigger 只给 preview 与续读指针，完整原文走 trigger/<id>；
 * Worker 视图只列出自己的订阅，不暴露同一 Thread 上其他工单。
 */
function renderThread(
  state: SuperAgentDomainState,
  thread: SuperAgentThread,
  role: SuperAgentReadRole,
): string {
  const triggers = thread.triggerIds
    .map((triggerId) => state.triggers[triggerId])
    .filter((trigger): trigger is SuperAgentTrigger => trigger !== undefined)
  const subscriptions = thread.subscriptions.filter(
    (subscription) => role.kind === 'router' || subscription.ticketId === role.ticketId,
  )

  const lines: string[] = [
    `# Thread ${thread.threadId}`,
    `- source: ${thread.source}`,
    `- title: ${thread.title ?? '（无）'}`,
    `- triggerCount: ${triggers.length}`,
    `- subscriptionCount: ${subscriptions.length}`,
    '',
    '## 时间线（Trigger 预览；完整原文用 trigger/<id> 续读）',
  ]

  triggers.forEach((trigger, index) => {
    const preview = truncatePreview(trigger.text, SUPER_AGENT_CONTEXT_BUDGETS.triggerPreviewChars)
    lines.push('', `### ${index + 1}. trigger/${trigger.triggerId}`)
    lines.push(
      `- actor: ${trigger.actor} · human: ${trigger.human ? '是' : '否'} · at: ${trigger.at}`,
    )
    if (preview.total > preview.read) {
      lines.push(
        `- 已截断：total_chars=${preview.total} read=${preview.read}，` +
          `续读 trigger/${trigger.triggerId}（offset=${preview.read}）`,
      )
    } else {
      lines.push(`- total_chars=${preview.total} read=${preview.read}`)
    }
    lines.push(indentBlock(preview.text, '  '))
  })

  lines.push('', '## 订阅工单')
  if (subscriptions.length === 0) {
    lines.push('- 无')
  } else {
    for (const subscription of subscriptions) {
      const ticket = state.tickets[subscription.ticketId]
      const stateLabel = ticket?.state ?? 'unknown'
      const contextOnly = subscription.contextOnly ? '（仅上下文）' : ''
      lines.push(
        `- ticket/${subscription.ticketId}「${ticket?.title ?? '（缺失）'}」` +
          ` state=${stateLabel}${contextOnly}`,
      )
    }
  }

  return lines.join('\n')
}

function renderTicket(state: SuperAgentDomainState, ticket: SuperAgentTicket): string {
  const mandate = state.mandates[ticket.mandateId]
  const scopePaths = mandate?.scope.paths ?? []
  const assignments = ticket.assignmentIds
    .map((assignmentId) => state.assignments[assignmentId])
    .filter((assignment): assignment is SuperAgentAssignment => assignment !== undefined)
  const latestAssignment = assignments.length > 0 ? assignments[assignments.length - 1] : undefined
  const latestReport = latestAssignment?.report ?? null

  return [
    `# Ticket ${ticket.ticketId}「${ticket.title}」`,
    `- state: ${ticket.state}`,
    `- createdAt: ${ticket.createdAt}`,
    `- threadId: ${ticket.threadId}`,
    mandate
      ? `- mandate: ${mandate.mandateId}（policy v${mandate.policyVersion} · ` +
        `strength=${mandate.strength} · basis=${mandate.basis} · actor=${mandate.actor}）`
      : `- mandate: ${ticket.mandateId}（缺失）`,
    `- scope: ${mandate?.scope.repoRoot ?? '（无）'}（${scopePaths.length > 0 ? scopePaths.join(', ') : '整个仓库'}）`,
    `- assignments: ${ticket.assignmentIds.length}`,
    `- inputs: ${ticket.inputIds.length}`,
    latestReport
      ? `- latestReport: ${latestReport.kind} · ${latestReport.summary}`
      : '- latestReport: （无）',
  ].join('\n')
}

function renderTicketInputs(state: SuperAgentDomainState, ticket: SuperAgentTicket): string {
  const inputs = ticket.inputIds
    .map((inputId) => state.inputs[inputId])
    .filter((input): input is NonNullable<typeof input> => input !== undefined)

  const lines: string[] = [`# Ticket inputs ${ticket.ticketId}（${inputs.length} 条）`]
  for (const input of inputs) {
    lines.push(
      '',
      `## input/${input.inputId}`,
      `- kind: ${input.kind} · status: ${input.status} · human: ${input.human ? '是' : '否'}` +
        ` · context: ${input.context ? '是' : '否'} · at: ${input.at}`,
    )
    if (input.triggerId) lines.push(`- trigger: trigger/${input.triggerId}`)
    if (input.note) lines.push(`- note: ${input.note}`)
    lines.push('', '正文：', normalizeText(input.text ?? '（无正文）'))
  }
  return lines.join('\n')
}

function renderTicketReport(state: SuperAgentDomainState, ticket: SuperAgentTicket): string {
  const reports = Object.values(state.reports)
    .filter((report) => report.ticketId === ticket.ticketId)
    .sort((left, right) => left.ordinal - right.ordinal)

  const lines: string[] = [`# Ticket report ${ticket.ticketId}（${reports.length} 条）`]
  if (reports.length === 0) lines.push('', '（暂无 Report）')
  for (const report of reports) {
    lines.push(
      '',
      `## report/${report.reportId} · ${report.kind}`,
      `- assignmentId: ${report.assignmentId}`,
      `- at: ${report.at}`,
      '',
      'summary：',
      normalizeText(report.summary),
    )
    if (report.details) {
      lines.push('', 'details：', normalizeText(report.details))
    }
    if (report.artifacts.length > 0) {
      lines.push('', 'artifacts：', ...report.artifacts.map((artifact) => `- ${artifact}`))
    }
  }
  return lines.join('\n')
}

function assignmentItems(
  state: SuperAgentDomainState,
  ticket: SuperAgentTicket,
): SuperAgentReadAssignmentItem[] {
  return ticket.assignmentIds
    .map((assignmentId) => state.assignments[assignmentId])
    .filter((assignment): assignment is SuperAgentAssignment => assignment !== undefined)
    .map((assignment) => ({
      assignmentId: assignment.assignmentId,
      generation: assignment.generation,
      state: assignment.state,
      createdAt: assignment.createdAt,
      endedAt: assignment.endedAt,
      endedReason: assignment.endedReason,
      reportKind: assignment.report?.kind ?? null,
    }))
}

/**
 * 评估窗口：开头 evalWindowHead 条 + 每个候选前后各 evalWindowNeighbors 条。
 *
 * 普通消息按 evalMessageChars 截断，候选与其紧邻消息按 evalNeighborChars；
 * 任何截断都带 total_chars/read 与 `trigger/<id>` 续读指针。
 */
export function renderSuperAgentEvalThreadWindow(
  state: SuperAgentDomainState,
  threadId: string,
  candidateTriggerIds: string[],
): SuperAgentEvalThreadWindow | null {
  const thread = state.threads[threadId]
  if (!thread) return null

  const triggerIds = thread.triggerIds.filter((triggerId) => state.triggers[triggerId] !== undefined)
  const candidateIds = new Set(candidateTriggerIds)
  const candidateIndexes = triggerIds
    .map((triggerId, index) => (candidateIds.has(triggerId) ? index : -1))
    .filter((index) => index >= 0)
  if (candidateIndexes.length === 0) return null

  const includedIndexes = new Set<number>()
  for (let index = 0; index < Math.min(SUPER_AGENT_CONTEXT_BUDGETS.evalWindowHead, triggerIds.length); index += 1) {
    includedIndexes.add(index)
  }
  for (const candidateIndex of candidateIndexes) {
    const from = Math.max(0, candidateIndex - SUPER_AGENT_CONTEXT_BUDGETS.evalWindowNeighbors)
    const to = Math.min(
      triggerIds.length - 1,
      candidateIndex + SUPER_AGENT_CONTEXT_BUDGETS.evalWindowNeighbors,
    )
    for (let index = from; index <= to; index += 1) includedIndexes.add(index)
  }

  const adjacentIndexes = new Set<number>()
  for (const candidateIndex of candidateIndexes) {
    adjacentIndexes.add(candidateIndex)
    adjacentIndexes.add(candidateIndex - 1)
    adjacentIndexes.add(candidateIndex + 1)
  }
  const orderedIndexes = [...includedIndexes].sort((left, right) => left - right)

  const lines: string[] = [
    `## Thread 窗口（开头 ${SUPER_AGENT_CONTEXT_BUDGETS.evalWindowHead} 条 + ` +
      `候选前后各 ${SUPER_AGENT_CONTEXT_BUDGETS.evalWindowNeighbors} 条）`,
    `- threadId: ${threadId}`,
    `- threadTitle: ${thread.title ?? '（无）'}`,
    '- 窗口有界；任何截断都标注 total_chars/read 与 trigger/<id> 续读指针，不要当成完整事实。',
  ]

  const includedTriggerIds: string[] = []
  for (const index of orderedIndexes) {
    const triggerId = triggerIds[index]!
    const trigger = state.triggers[triggerId]!
    const isCandidate = adjacentIndexes.has(index)
    const limit = isCandidate
      ? SUPER_AGENT_CONTEXT_BUDGETS.evalNeighborChars
      : SUPER_AGENT_CONTEXT_BUDGETS.evalMessageChars
    const normalized = normalizeText(trigger.text)
    const shown = normalized.slice(0, limit)

    includedTriggerIds.push(triggerId)
    lines.push('', `### ${candidateIndexes.includes(index) ? '[候选] ' : ''}trigger/${triggerId}`)
    lines.push(
      `- actor: ${trigger.actor} · human: ${trigger.human ? '是' : '否'} · at: ${trigger.at}`,
    )
    if (normalized.length > limit) {
      lines.push(
        `- 已截断：total_chars=${normalized.length} read=${limit}，` +
          `续读 trigger/${triggerId}（offset=${limit}）`,
      )
    } else {
      lines.push(`- total_chars=${normalized.length} read=${normalized.length}`)
    }
    lines.push(indentBlock(shown, '  '))
  }

  return {
    threadId,
    text: lines.join('\n'),
    includedTriggerIds,
    candidateTriggerIds: candidateIndexes.map((index) => triggerIds[index]!),
  }
}

export function createSuperAgentContextReader(
  options: SuperAgentContextReaderOptions,
): SuperAgentContextReader {
  const state = () => options.domain.state

  function readResource(
    role: SuperAgentReadRole,
    resourceId: string,
    offset?: number,
    limit?: number,
  ): SuperAgentReadResult {
    const parsed = parseResourceId(resourceId)
    const current = state()

    if (parsed.kind === 'trigger') {
      const trigger = assertTriggerAccess(current, role, parsed.id)
      return pagesText(resourceId, renderTrigger(trigger), offset, limit)
    }

    if (parsed.kind === 'thread') {
      const thread = assertThreadAccess(current, role, parsed.id)
      return pagesText(resourceId, renderThread(current, thread, role), offset, limit)
    }

    const ticket = assertTicketAccess(current, role, parsed.id)
    if (parsed.sub === 'assignments') {
      return pageList(resourceId, assignmentItems(current, ticket), offset, limit)
    }
    if (parsed.sub === 'inputs') {
      return pagesText(resourceId, renderTicketInputs(current, ticket), offset, limit)
    }
    if (parsed.sub === 'report') {
      return pagesText(resourceId, renderTicketReport(current, ticket), offset, limit)
    }
    return pagesText(resourceId, renderTicket(current, ticket), offset, limit)
  }

  return {
    readResource,
    renderEvalThreadWindow(threadId, candidateTriggerIds) {
      return renderSuperAgentEvalThreadWindow(state(), threadId, candidateTriggerIds)
    },
  }
}
