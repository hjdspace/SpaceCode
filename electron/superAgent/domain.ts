/**
 * Super Agent 单写者领域状态机（T03 #73）。
 *
 * 一个 Domain 实例独占一份 `SuperAgentDomainState`，所有变更只能经公开命令进入；
 * 命令只追加领域事实，阶段由 ./stage.ts 派生。持久化与 IPC 由后续票接入，
 * 本模块不读写磁盘。
 *
 * 幂等：事件键 / UI requestId / Report 的 assignmentId+reportId / Outbox messageId。
 * 重复事实返回原结果；同一键但载荷不同属于冲突（除 Source 事件键，它由 Source
 * 负责重放语义，重复投递一律返回原 Trigger）。
 */
import { randomUUID } from 'crypto'
import { superAgentError } from './errors'
import { idempotencyKey } from './idempotency'
export { idempotencyKey } from './idempotency'
import {
  deriveTicketStage,
  latestAssignmentOf,
  waitsForPerson,
  type TicketStageFacts,
} from './stage'
import type {
  SuperAgentAssignment,
  SuperAgentAssignmentEndReason,
  SuperAgentAttention,
  SuperAgentDecision,
  SuperAgentDomainState,
  SuperAgentEndedBy,
  SuperAgentIdempotencyEntry,
  SuperAgentInput,
  SuperAgentInputKind,
  SuperAgentMandate,
  SuperAgentMandateBasis,
  SuperAgentMandateStrength,
  SuperAgentReport,
  SuperAgentReportKind,
  SuperAgentThread,
  SuperAgentTicket,
  SuperAgentTicketOutcome,
  SuperAgentTicketStage,
  SuperAgentTrigger,
  SuperAgentTriggerAddress,
} from './model'

export interface TriggerDraft {
  /** Source 事件键；同一键重复投递只返回原 Trigger。 */
  key: string
  source: string
  /** 空数组表示由 Ticket 创建自己的 Thread（Desktop 显式派工）。 */
  threadIds: string[]
  actor: string
  human: boolean
  addressed?: SuperAgentTriggerAddress | null
  channel?: string | null
  url?: string | null
  text: string
  at?: string
  meta?: Record<string, unknown>
}

export interface TriggerIntakeResult {
  trigger: SuperAgentTrigger
  duplicate: boolean
}

export interface CreateTicketInput {
  /** UI 幂等键。 */
  requestId: string
  title: string
  repoRoot: string
  trigger: TriggerDraft
  scopePaths?: string[]
  policyVersion?: number
  strength?: SuperAgentMandateStrength
  basis?: SuperAgentMandateBasis
  at?: string
}

export interface CreateTicketResult {
  ticket: SuperAgentTicket
  mandate: SuperAgentMandate
  thread: SuperAgentThread
  duplicate: boolean
}

export interface StartAssignmentInput {
  ticketId: string
  at?: string
}

/** 显式派工（T05 #75）：「新建工单」独立动作产生的 Decision/Mandate/pending Assignment。 */
export interface DispatchInput {
  /** UI 幂等键；同一键重复派工返回原结果，载荷不同视为冲突。 */
  requestId: string
  title: string
  repoRoot: string
  /** 工单目标描述；超预算部分由 Scheduler 落 Spill（见 context.ts）。 */
  text: string
  actor: string
  /** 派工时携带的 @ 上下文（相对路径），注入 Worker 首轮消息。 */
  contextPaths?: string[]
  attachments?: string[]
  policyVersion?: number
  at?: string
}

export interface DispatchResult {
  ticket: SuperAgentTicket
  decision: SuperAgentDecision
  mandate: SuperAgentMandate
  assignment: SuperAgentAssignment
  duplicate: boolean
}

export interface LaunchAssignmentInput {
  assignmentId: string
  at?: string
}

export interface EndAssignmentInput {
  assignmentId: string
  reason: SuperAgentAssignmentEndReason
  at?: string
}

export interface AddInputCommand {
  ticketId: string
  /** UI 幂等键。 */
  requestId: string
  kind: SuperAgentInputKind
  human: boolean
  context?: boolean
  note?: string | null
  text?: string | null
  triggerId?: string | null
  at?: string
}

export interface AddInputResult {
  input: SuperAgentInput
  /** 被 blocked/failed 闸门拦下：只落库，不投递。 */
  gated: boolean
  delivered: boolean
  duplicate: boolean
}

export interface FailDeliveryInput {
  inputId: string
  error: string
  at?: string
}

export interface ReportCommand {
  ticketId: string
  assignmentId: string
  reportId: string
  kind: SuperAgentReportKind
  summary: string
  at?: string
  question?: string | null
  askedBy?: string | null
  answers?: string[]
  details?: string | null
  artifacts?: string[]
}

export interface ReportResult {
  report: SuperAgentReport
  duplicate: boolean
  /** 本次创建、回答或撤回的 Attention；没有则为 null。 */
  attentionId: string | null
}

export interface EndTicketCommand {
  ticketId: string
  outcome: SuperAgentTicketOutcome
  by: SuperAgentEndedBy
  reason: string
  at?: string
}

export interface EndTicketResult {
  ticket: SuperAgentTicket
  releasedInputIds: string[]
  withdrawnAttentionIds: string[]
}

export interface SuperAgentDomainOptions {
  now?: () => Date
  newId?: (kind: string) => string
}

export interface SuperAgentDomain {
  readonly state: SuperAgentDomainState
  intakeTrigger(draft: TriggerDraft): TriggerIntakeResult
  createTicket(input: CreateTicketInput): CreateTicketResult
  dispatch(input: DispatchInput): DispatchResult
  startAssignment(input: StartAssignmentInput): SuperAgentAssignment
  launchAssignment(input: LaunchAssignmentInput): SuperAgentAssignment
  endAssignment(input: EndAssignmentInput): SuperAgentAssignment
  addInput(command: AddInputCommand): AddInputResult
  failDelivery(input: FailDeliveryInput): SuperAgentTicket
  report(command: ReportCommand): ReportResult
  endTicket(command: EndTicketCommand): EndTicketResult
  stageOf(ticketId: string): SuperAgentTicketStage
}

/** 稳定序列化：同一载荷不同键序视为同一事实。 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`
}

function newThread(threadId: string, source: string): SuperAgentThread {
  return {
    threadId,
    source,
    title: null,
    triggerIds: [],
    subscriptions: [],
    contextTriggerIds: [],
    pendingTriggerIds: [],
    evaluating: false,
    expired: 0,
    correlatedThreadIds: [],
    meta: {},
  }
}

export function createSuperAgentDomain(options: SuperAgentDomainOptions = {}): SuperAgentDomain {
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? ((kind: string) => `${kind}-${randomUUID()}`)
  const state: SuperAgentDomainState = {
    seq: 0,
    triggers: {},
    threads: {},
    tickets: {},
    assignments: {},
    decisions: {},
    inputs: {},
    mandates: {},
    reports: {},
    attentions: {},
    idempotency: {},
    handbacks: [],
  }

  const atNow = (at?: string): string => at ?? now().toISOString()

  function nextOrdinal(): number {
    state.seq += 1
    return state.seq
  }

  function ensureThread(threadId: string, source: string): SuperAgentThread {
    let thread = state.threads[threadId]
    if (!thread) {
      thread = newThread(threadId, source)
      state.threads[threadId] = thread
    }
    return thread
  }

  function requireTicket(ticketId: string): SuperAgentTicket {
    const ticket = state.tickets[ticketId]
    if (!ticket) throw superAgentError('ticketNotFound', { ticketId })
    return ticket
  }

  function factsOf(ticket: SuperAgentTicket): TicketStageFacts {
    return {
      ticket,
      assignments: ticket.assignmentIds.map((id) => state.assignments[id]),
      inputs: ticket.inputIds.map((id) => state.inputs[id]),
      attentions: Object.values(state.attentions).filter(
        (attention) => attention.ticketId === ticket.ticketId,
      ),
    }
  }

  function stageOf(ticketId: string): SuperAgentTicketStage {
    return deriveTicketStage(factsOf(requireTicket(ticketId)))
  }

  function findByIdempotencyKey(key: string): SuperAgentIdempotencyEntry | undefined {
    return state.idempotency[key]
  }

  /** 已存在相同键时校验载荷；不同则冲突，相同则由调用方返回原结果。 */
  function assertSameFact(existing: SuperAgentIdempotencyEntry, fingerprint: string): void {
    if (existing.fingerprint !== fingerprint) throw superAgentError('conflict', { key: existing.kind })
  }

  function intakeTrigger(draft: TriggerDraft): TriggerIntakeResult {
    const key = idempotencyKey('event', draft.key)
    const fingerprint = canonical(draft)
    const existing = findByIdempotencyKey(key)
    if (existing) {
      // Source 负责事件去重：重复投递即使携带了不同快照文本，也返回原 Trigger。
      return { trigger: state.triggers[existing.id], duplicate: true }
    }

    const at = atNow(draft.at)
    const trigger: SuperAgentTrigger = {
      triggerId: newId('trigger'),
      key: draft.key,
      ordinal: nextOrdinal(),
      source: draft.source,
      threadIds: [...draft.threadIds],
      actor: draft.actor,
      human: draft.human,
      addressed: draft.addressed ?? null,
      channel: draft.channel ?? null,
      url: draft.url ?? null,
      text: draft.text,
      at,
      meta: draft.meta ?? {},
      disposition: {
        filtered: null,
        ticketIds: [],
        contextTicketIds: [],
        requeued: false,
        handedBack: false,
        ackedAt: null,
      },
    }

    for (const threadId of trigger.threadIds) {
      const thread = ensureThread(threadId, draft.source)
      thread.triggerIds.push(trigger.triggerId)
      thread.pendingTriggerIds.push(trigger.triggerId)
    }

    state.triggers[trigger.triggerId] = trigger
    state.idempotency[key] = { kind: 'trigger', id: trigger.triggerId, fingerprint }
    return { trigger, duplicate: false }
  }

  /** 建单核心（无幂等登记）：createTicket 与 dispatch 共用，幂等由各命令自己负责。 */
  function createTicketUnchecked(
    input: CreateTicketInput,
    key: string | null,
    fingerprint: string,
  ): CreateTicketResult {
    const at = atNow(input.at)
    const ticketId = newId('ticket')
    const threadId = input.trigger.threadIds[0] ?? newId('thread')
    const thread = ensureThread(threadId, input.trigger.source)
    thread.title = input.title

    const intake = intakeTrigger({
      ...input.trigger,
      threadIds: input.trigger.threadIds.length > 0 ? input.trigger.threadIds : [threadId],
      at,
    })
    const trigger = intake.trigger
    if (!trigger.disposition.ticketIds.includes(ticketId)) {
      trigger.disposition.ticketIds.push(ticketId)
    }
    const pendingIndex = thread.pendingTriggerIds.indexOf(trigger.triggerId)
    if (pendingIndex >= 0) thread.pendingTriggerIds.splice(pendingIndex, 1)

    const mandate: SuperAgentMandate = {
      mandateId: newId('mandate'),
      ticketId,
      policyVersion: input.policyVersion ?? 1,
      strength: input.strength ?? 'explicit',
      basis: input.basis ?? 'addressed',
      actor: input.trigger.actor,
      scope: { repoRoot: input.repoRoot, paths: input.scopePaths ?? [] },
      createdAt: at,
      revokedAt: null,
    }

    const ticket: SuperAgentTicket = {
      ticketId,
      title: input.title,
      state: 'open',
      createdAt: at,
      origin: { triggerId: trigger.triggerId, triggerIds: [trigger.triggerId] },
      mandateId: mandate.mandateId,
      threadId,
      assignmentIds: [],
      inputIds: [],
      answers: [],
      attentionId: null,
      execution: { name: 'main', directory: input.repoRoot, assignmentId: null },
      follows: [],
      delivery: null,
      undelivered: [],
      reviewRemindedAt: null,
      ended: null,
    }

    thread.subscriptions.push({ ticketId, attachedAt: at, contextOnly: false })

    state.mandates[mandate.mandateId] = mandate
    state.tickets[ticketId] = ticket
    if (key !== null) state.idempotency[key] = { kind: 'ticket', id: ticketId, fingerprint }

    return { ticket, mandate, thread, duplicate: false }
  }

  function createTicket(input: CreateTicketInput): CreateTicketResult {
    const key = idempotencyKey('request', input.requestId)
    const fingerprint = canonical({
      title: input.title,
      repoRoot: input.repoRoot,
      trigger: input.trigger,
      scopePaths: input.scopePaths ?? [],
      policyVersion: input.policyVersion ?? 1,
      strength: input.strength ?? 'explicit',
      basis: input.basis ?? 'addressed',
    })
    const existing = findByIdempotencyKey(key)
    if (existing) {
      assertSameFact(existing, fingerprint)
      const ticket = state.tickets[existing.id]
      return {
        ticket,
        mandate: state.mandates[ticket.mandateId],
        thread: state.threads[ticket.threadId],
        duplicate: true,
      }
    }

    return createTicketUnchecked(input, key, fingerprint)
  }

  function newAssignmentForTicket(
    ticket: SuperAgentTicket,
    at: string,
    initialState: 'pending' | 'running',
  ): SuperAgentAssignment {
    const latest = latestAssignmentOf(ticket.assignmentIds.map((id) => state.assignments[id]))
    const assignment: SuperAgentAssignment = {
      assignmentId: newId('assignment'),
      ticketId: ticket.ticketId,
      generation: latest ? latest.generation + 1 : 1,
      state: initialState,
      createdAt: at,
      startedAt: initialState === 'running' ? at : null,
      endedAt: null,
      endedReason: null,
      createdOrdinal: nextOrdinal(),
      endedOrdinal: null,
      report: null,
      deliveredAt: null,
      idleAt: null,
    }
    state.assignments[assignment.assignmentId] = assignment
    ticket.assignmentIds.push(assignment.assignmentId)
    ticket.execution.assignmentId = assignment.assignmentId
    return assignment
  }

  function dispatch(input: DispatchInput): DispatchResult {
    if (input.title.trim() === '' || input.text.trim() === '') {
      throw superAgentError('invalidDispatch', { requestId: input.requestId })
    }

    const key = idempotencyKey('request', input.requestId)
    const fingerprint = canonical({
      kind: 'dispatch',
      title: input.title,
      repoRoot: input.repoRoot,
      text: input.text,
      contextPaths: input.contextPaths ?? [],
      attachments: input.attachments ?? [],
      policyVersion: input.policyVersion ?? 1,
    })
    const existing = findByIdempotencyKey(key)
    if (existing) {
      assertSameFact(existing, fingerprint)
      const ticket = state.tickets[existing.id]
      const assignment = state.assignments[ticket.assignmentIds[0]]
      return {
        ticket,
        decision: state.decisions[ticket.ticketId],
        mandate: state.mandates[ticket.mandateId],
        assignment,
        duplicate: true,
      }
    }

    const at = atNow(input.at)
    // Desktop 显式派工：source='desktop'、strength='explicit'、basis='addressed'，
    // 产生 Decision → Mandate → pending Assignment 的审计链。
    const created = createTicketUnchecked(
      {
        requestId: input.requestId,
        title: input.title,
        repoRoot: input.repoRoot,
        trigger: {
          key: `desktop-dispatch:${input.requestId}`,
          source: 'desktop',
          threadIds: [],
          actor: input.actor,
          human: true,
          addressed: 'direct',
          text: input.text,
          at,
        },
        policyVersion: input.policyVersion,
      },
      key,
      fingerprint,
    )

    const decision: SuperAgentDecision = {
      decisionId: newId('decision'),
      ticketId: created.ticket.ticketId,
      triggerId: created.ticket.origin.triggerId,
      action: 'accept',
      source: 'desktop',
      actor: input.actor,
      human: true,
      policyVersion: created.mandate.policyVersion,
      strength: created.mandate.strength,
      basis: created.mandate.basis,
      at,
    }
    state.decisions[created.ticket.ticketId] = decision

    const assignment = newAssignmentForTicket(created.ticket, at, 'pending')

    return {
      ticket: created.ticket,
      decision,
      mandate: created.mandate,
      assignment,
      duplicate: false,
    }
  }

  function startAssignment(input: StartAssignmentInput): SuperAgentAssignment {
    const ticket = requireTicket(input.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    const latest = latestAssignmentOf(ticket.assignmentIds.map((id) => state.assignments[id]))
    if (latest && (latest.state === 'pending' || latest.state === 'running')) {
      throw superAgentError('notRetryable', { ticketId: ticket.ticketId })
    }

    return newAssignmentForTicket(ticket, atNow(input.at), 'running')
  }

  /** Scheduler 专用：把 pending Assignment 标记为 running 并落 startedAt。 */
  function launchAssignment(input: LaunchAssignmentInput): SuperAgentAssignment {
    const assignment = state.assignments[input.assignmentId]
    if (!assignment) {
      throw superAgentError('assignmentNotFound', { assignmentId: input.assignmentId })
    }
    if (assignment.state !== 'pending') {
      throw superAgentError('assignmentNotPending', { assignmentId: input.assignmentId })
    }

    assignment.state = 'running'
    assignment.startedAt = atNow(input.at)
    return assignment
  }

  function endAssignment(input: EndAssignmentInput): SuperAgentAssignment {
    const assignment = state.assignments[input.assignmentId]
    if (!assignment) {
      throw superAgentError('assignmentNotFound', { assignmentId: input.assignmentId })
    }
    if (assignment.state === 'ended' || assignment.state === 'interrupted') return assignment

    const at = atNow(input.at)
    assignment.state = input.reason === 'interrupted' ? 'interrupted' : 'ended'
    assignment.endedAt = at
    assignment.endedReason = input.reason
    assignment.endedOrdinal = nextOrdinal()
    if (assignment.idleAt === null) assignment.idleAt = at
    return assignment
  }

  function bindTriggerToTicket(
    ticket: SuperAgentTicket,
    triggerId: string,
    context: boolean,
    at: string,
  ): void {
    const trigger = state.triggers[triggerId]
    if (!trigger) return
    const target = context ? trigger.disposition.contextTicketIds : trigger.disposition.ticketIds
    if (!target.includes(ticket.ticketId)) target.push(ticket.ticketId)
    trigger.disposition.ackedAt = at
    const threadId = trigger.threadIds[0]
    const thread = threadId ? state.threads[threadId] : undefined
    if (thread) {
      const pendingIndex = thread.pendingTriggerIds.indexOf(triggerId)
      if (pendingIndex >= 0) thread.pendingTriggerIds.splice(pendingIndex, 1)
    }
  }

  function addInput(command: AddInputCommand): AddInputResult {
    const ticket = requireTicket(command.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    const key = idempotencyKey('request', command.requestId)
    const fingerprint = canonical({
      ticketId: command.ticketId,
      kind: command.kind,
      human: command.human,
      context: command.context ?? false,
      note: command.note ?? null,
      text: command.text ?? null,
      triggerId: command.triggerId ?? null,
    })
    const existing = findByIdempotencyKey(key)
    if (existing) {
      assertSameFact(existing, fingerprint)
      const input = state.inputs[existing.id]
      return {
        input,
        gated: input.status === 'pending',
        delivered: input.status === 'delivered' || input.status === 'read',
        duplicate: true,
      }
    }

    const facts = factsOf(ticket)
    const gateWasClosed = waitsForPerson(facts)
    // 仅上下文输入不投递、不唤醒，也不能替人解除 blocked/failed。
    const wakesTicket = command.human && !(command.context ?? false)
    const gated = gateWasClosed && !wakesTicket
    const latest = latestAssignmentOf(facts.assignments)
    const canDeliver = latest !== null && (latest.state === 'pending' || latest.state === 'running')
    const delivered = !gated && canDeliver
    const at = atNow(command.at)

    if (command.triggerId && !state.triggers[command.triggerId]) {
      throw superAgentError('triggerNotFound', { triggerId: command.triggerId })
    }

    const input: SuperAgentInput = {
      inputId: newId('input'),
      ticketId: ticket.ticketId,
      ordinal: nextOrdinal(),
      kind: command.kind,
      status: delivered ? 'delivered' : 'pending',
      human: command.human,
      context: command.context ?? false,
      note: command.note ?? null,
      text: command.text ?? null,
      triggerId: command.triggerId ?? null,
      requestId: command.requestId,
      at,
      readAt: null,
      deliveredTo: delivered ? latest?.assignmentId ?? null : null,
      deliveredAt: delivered ? at : null,
      releasedAt: null,
    }

    state.inputs[input.inputId] = input
    ticket.inputIds.push(input.inputId)
    if (input.triggerId) bindTriggerToTicket(ticket, input.triggerId, input.context, at)
    state.idempotency[key] = { kind: 'input', id: input.inputId, fingerprint }

    // 人工消息解除 blocked/failed 时复用原 Assignment：不新建、不递增 generation。
    if (gateWasClosed && command.human && delivered) {
      ticket.execution.assignmentId = latest?.assignmentId ?? ticket.execution.assignmentId
    }

    return { input, gated, delivered, duplicate: false }
  }

  function failDelivery(input: FailDeliveryInput): SuperAgentTicket {
    const failed = state.inputs[input.inputId]
    if (!failed) throw superAgentError('inputNotFound', { inputId: input.inputId })
    const ticket = requireTicket(failed.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    const at = atNow(input.at)
    failed.status = 'failed'
    ticket.delivery = { inputId: failed.inputId, error: input.error, at }
    if (!ticket.undelivered.includes(failed.inputId)) ticket.undelivered.push(failed.inputId)
    return ticket
  }

  function withdrawOpenAttentions(
    ticket: SuperAgentTicket,
  ): string[] {
    const withdrawn: string[] = []
    for (const attention of Object.values(state.attentions)) {
      if (attention.ticketId === ticket.ticketId && attention.status === 'open') {
        attention.status = 'withdrawn'
        withdrawn.push(attention.attentionId)
      }
    }
    ticket.attentionId = null
    return withdrawn
  }

  function endTicketInternal(
    ticket: SuperAgentTicket,
    command: { outcome: SuperAgentTicketOutcome; by: SuperAgentEndedBy; reason: string; at: string },
  ): EndTicketResult {
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    ticket.state = 'ended'
    ticket.ended = {
      at: command.at,
      by: command.by,
      outcome: command.outcome,
      reason: command.reason,
    }

    const withdrawnAttentionIds = withdrawOpenAttentions(ticket)
    ticket.delivery = null

    const releasedInputIds: string[] = []
    for (const inputId of ticket.inputIds) {
      const input = state.inputs[inputId]
      if (!input || !input.human) continue
      // 未读、未确认、未回答、未交回的人消息才回流；已 read 或已被 answers 认领的不动。
      if (input.readAt !== null) continue
      if (ticket.answers.includes(inputId)) continue
      if (input.releasedAt !== null) continue

      input.releasedAt = command.at
      releasedInputIds.push(inputId)

      // 非 Trigger 派生的人消息没有其他 owner，直接回流 Eval；Trigger 消息要等最后一个
      // 工单/上下文订阅释放后才回流，否则会重复触发 Eval。
      let handedBackToEval = input.triggerId === null
      if (input.triggerId) {
        const trigger = state.triggers[input.triggerId]
        if (trigger) {
          trigger.disposition.ticketIds = trigger.disposition.ticketIds.filter(
            (ticketId) => ticketId !== ticket.ticketId,
          )
          trigger.disposition.contextTicketIds = trigger.disposition.contextTicketIds.filter(
            (ticketId) => ticketId !== ticket.ticketId,
          )
          const hasOtherOwner =
            trigger.disposition.ticketIds.length > 0 ||
            trigger.disposition.contextTicketIds.length > 0
          if (!hasOtherOwner) {
            handedBackToEval = true
            trigger.disposition.handedBack = true
            const threadId = trigger.threadIds[0]
            const thread = threadId ? state.threads[threadId] : undefined
            if (thread && !thread.pendingTriggerIds.includes(trigger.triggerId)) {
              thread.pendingTriggerIds.push(trigger.triggerId)
            }
          }
        }
      }
      if (handedBackToEval && !state.handbacks.includes(inputId)) state.handbacks.push(inputId)
    }

    ticket.undelivered = []
    return { ticket, releasedInputIds, withdrawnAttentionIds }
  }

  function endTicket(command: EndTicketCommand): EndTicketResult {
    const ticket = requireTicket(command.ticketId)
    return endTicketInternal(ticket, {
      outcome: command.outcome,
      by: command.by,
      reason: command.reason,
      at: atNow(command.at),
    })
  }

  function report(command: ReportCommand): ReportResult {
    const ticket = requireTicket(command.ticketId)
    const assignment = state.assignments[command.assignmentId]
    if (!assignment || assignment.ticketId !== ticket.ticketId) {
      throw superAgentError('assignmentNotFound', { assignmentId: command.assignmentId })
    }

    const answers = [...new Set(command.answers ?? [])]
    const key = idempotencyKey('report', command.assignmentId, command.reportId)
    const fingerprint = canonical({
      ticketId: command.ticketId,
      assignmentId: command.assignmentId,
      reportId: command.reportId,
      kind: command.kind,
      summary: command.summary,
      question: command.question ?? null,
      askedBy: command.askedBy ?? null,
      answers,
      details: command.details ?? null,
      artifacts: command.artifacts ?? [],
    })
    const existing = findByIdempotencyKey(key)
    if (existing) {
      assertSameFact(existing, fingerprint)
      const original = state.reports[existing.id]
      return { report: original, duplicate: true, attentionId: original.attentionId ?? null }
    }

    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    if (assignment.state === 'ended' || assignment.state === 'interrupted') {
      throw superAgentError('assignmentEnded', { assignmentId: assignment.assignmentId })
    }

    const question = command.question ?? null
    const askedBy = command.askedBy ?? null

    if (question !== null && (command.kind === 'ready' || answers.length > 0)) {
      throw superAgentError('questionWithResult', { ticketId: ticket.ticketId })
    }

    if (question !== null && !askedBy) {
      throw superAgentError('askerWithoutQuestion', { ticketId: ticket.ticketId })
    }

    if (askedBy !== null) {
      const asker = state.inputs[askedBy]
      if (!asker || asker.ticketId !== ticket.ticketId || !asker.human) {
        throw superAgentError('notAsker', { ticketId: ticket.ticketId, inputId: askedBy })
      }
    }

    for (const inputId of answers) {
      const input = state.inputs[inputId]
      if (!input || input.ticketId !== ticket.ticketId || !input.human) {
        throw superAgentError('notAnswerable', { ticketId: ticket.ticketId, inputId })
      }
      if (ticket.answers.includes(inputId)) {
        throw superAgentError('notAnswerable', { ticketId: ticket.ticketId, inputId })
      }
      const attention = Object.values(state.attentions).find(
        (candidate) =>
          candidate.ticketId === ticket.ticketId &&
          candidate.status === 'open' &&
          candidate.askedBy === inputId,
      )
      if (!attention) {
        throw superAgentError('notAnswerable', { ticketId: ticket.ticketId, inputId })
      }
    }

    const at = atNow(command.at)
    const report: SuperAgentReport = {
      reportId: command.reportId,
      assignmentId: assignment.assignmentId,
      ticketId: ticket.ticketId,
      ordinal: nextOrdinal(),
      kind: command.kind,
      summary: command.summary,
      at,
      question,
      askedBy,
      answers,
      attentionId: null,
      details: command.details ?? null,
      artifacts: command.artifacts ?? [],
    }

    state.reports[key] = report
    state.idempotency[key] = { kind: 'report', id: key, fingerprint }
    assignment.report = report
    if (command.kind === 'waiting') assignment.idleAt = at

    let attentionId: string | null = null

    if (answers.length > 0) {
      for (const inputId of answers) {
        for (const attention of Object.values(state.attentions)) {
          if (
            attention.ticketId === ticket.ticketId &&
            attention.status === 'open' &&
            attention.askedBy === inputId
          ) {
            attention.status = 'answered'
            attention.answers = [inputId]
            attention.answeredAt = at
            attentionId = attention.attentionId
            if (ticket.attentionId === attention.attentionId) ticket.attentionId = null
          }
        }
        if (!ticket.answers.includes(inputId)) ticket.answers.push(inputId)
      }
    }

    if (question !== null) {
      // 新问题替换旧问题：旧的未发出问题必须撤回，不能出现两条矛盾气泡。
      withdrawOpenAttentions(ticket)
      const attention: SuperAgentAttention = {
        attentionId: newId('attention'),
        ticketId: ticket.ticketId,
        assignmentId: assignment.assignmentId,
        kind: 'question',
        question,
        askedBy: askedBy as string,
        askedAt: at,
        status: 'open',
        answers: [],
        answeredAt: null,
        sessionId: null,
        requestId: null,
      }
      state.attentions[attention.attentionId] = attention
      ticket.attentionId = attention.attentionId
      attentionId = attention.attentionId
    } else if (command.kind === 'ready') {
      withdrawOpenAttentions(ticket)
      attentionId = null
    }

    if (command.kind === 'dropped') {
      endTicketInternal(ticket, {
        outcome: 'dropped',
        by: 'worker',
        reason: command.summary,
        at,
      })
      attentionId = null
    }

    report.attentionId = attentionId
    return { report, duplicate: false, attentionId }
  }

  return {
    state,
    intakeTrigger,
    createTicket,
    dispatch,
    startAssignment,
    launchAssignment,
    endAssignment,
    addInput,
    failDelivery,
    report,
    endTicket,
    stageOf,
  }
}
