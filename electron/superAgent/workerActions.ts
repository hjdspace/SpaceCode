/**
 * Worker 指令协议（#100，设计 §6.2/§6.6）。
 *
 * Worker 的最终回复除 Report 外还可以携带三种围栏动作：
 *  - `super-agent:handback`：把人消息交回，由 Eval 重新裁决；
 *  - `super-agent:thread-unrelated`：退订与本工单无关的 Thread；
 *  - `super-agent:thread-follow`：把相关 Issue/PR 的 Thread 登记为仅上下文订阅。
 *
 * 与 Report/Router 协议一样严格：字段白名单、块唯一性、非空字符串；任何一种
 * 不合规都抛稳定错误码，由 Executor 按协议失败收尾，不猜意图、不执行半截事实。
 */
import { superAgentError } from './errors'
import type { SuperAgentDomainState } from './model'

export const SUPER_AGENT_HANDBACK_FENCE = 'super-agent:handback'
export const SUPER_AGENT_THREAD_UNRELATED_FENCE = 'super-agent:thread-unrelated'
export const SUPER_AGENT_THREAD_FOLLOW_FENCE = 'super-agent:thread-follow'

export interface SuperAgentHandbackWorkerAction {
  kind: 'handback'
  /** 被交回的人消息 Trigger（宿主上下文里投递过该值）。 */
  triggerId: string
  reason: string
}

export interface SuperAgentThreadUnrelatedWorkerAction {
  kind: 'threadUnrelated'
  threadId: string
  reason: string
}

export interface SuperAgentThreadFollowWorkerAction {
  kind: 'threadFollow'
  threadId: string
}

export type SuperAgentWorkerAction =
  | SuperAgentHandbackWorkerAction
  | SuperAgentThreadUnrelatedWorkerAction
  | SuperAgentThreadFollowWorkerAction

export interface ParsedSuperAgentWorkerActions {
  /** 固定顺序：handback → threadUnrelated → threadFollow。 */
  actions: SuperAgentWorkerAction[]
}

interface FenceSpec {
  fence: string
  kind: SuperAgentWorkerAction['kind']
  fields: readonly string[]
  parse(payload: Record<string, unknown>): SuperAgentWorkerAction
}

function requireString(payload: Record<string, unknown>, field: string, fence: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw superAgentError('workerActionInvalid', { field: `${fence}.${field}` })
  }
  return value.trim()
}

function assertOnlyFields(
  payload: Record<string, unknown>,
  fence: string,
  fields: readonly string[],
): void {
  for (const key of Object.keys(payload)) {
    if (!fields.includes(key)) {
      throw superAgentError('workerActionInvalid', { field: `${fence}.${key}` })
    }
  }
}

function parsePayload(raw: string, fence: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw superAgentError('workerActionUnparsable', { fence })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw superAgentError('workerActionInvalid', { field: `${fence}.<root>` })
  }
  return parsed as Record<string, unknown>
}

function blocksOf(text: string, fence: string): string[] {
  const pattern = new RegExp(
    `(?:^|\\n)[ \\t]*\`\`\`${fence}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?\`\`\``,
    'g',
  )
  const blocks: string[] = []
  for (const match of text.matchAll(pattern)) {
    blocks.push(match[1] ?? '')
  }
  return blocks
}

const FENCE_SPECS: readonly FenceSpec[] = [
  {
    fence: SUPER_AGENT_HANDBACK_FENCE,
    kind: 'handback',
    fields: ['triggerId', 'reason'],
    parse: (payload) => ({
      kind: 'handback',
      triggerId: requireString(payload, 'triggerId', SUPER_AGENT_HANDBACK_FENCE),
      reason: requireString(payload, 'reason', SUPER_AGENT_HANDBACK_FENCE),
    }),
  },
  {
    fence: SUPER_AGENT_THREAD_UNRELATED_FENCE,
    kind: 'threadUnrelated',
    fields: ['threadId', 'reason'],
    parse: (payload) => ({
      kind: 'threadUnrelated',
      threadId: requireString(payload, 'threadId', SUPER_AGENT_THREAD_UNRELATED_FENCE),
      reason: requireString(payload, 'reason', SUPER_AGENT_THREAD_UNRELATED_FENCE),
    }),
  },
  {
    fence: SUPER_AGENT_THREAD_FOLLOW_FENCE,
    kind: 'threadFollow',
    fields: ['threadId'],
    parse: (payload) => ({
      kind: 'threadFollow',
      threadId: requireString(payload, 'threadId', SUPER_AGENT_THREAD_FOLLOW_FENCE),
    }),
  },
]

export function parseSuperAgentWorkerActions(text: string): ParsedSuperAgentWorkerActions {
  const actions: SuperAgentWorkerAction[] = []
  for (const spec of FENCE_SPECS) {
    const blocks = blocksOf(text, spec.fence)
    if (blocks.length > 1) {
      throw superAgentError('workerActionNotUnique', { fence: spec.fence })
    }
    if (blocks.length === 0) continue
    const payload = parsePayload(blocks[0]!, spec.fence)
    assertOnlyFields(payload, spec.fence, spec.fields)
    actions.push(spec.parse(payload))
  }
  return { actions }
}

/**
 * Worker 协议里的 triggerId → 本工单实际持有的 Input。Worker 只能在投递里
 * 见到 triggerId；找不到 / 不属于本工单时是越权或错位，稳定拒绝。
 *
 * 选择顺序：未交回的人消息 → 已交回的人消息（由领域给出 handedBack 稳定错误）
 * → 其余（领域会按 notHandbackable/context 拒绝）。不替 Worker 猜"它可能指哪条"。
 */
export function resolveSuperAgentHandbackInputId(
  state: Pick<SuperAgentDomainState, 'tickets' | 'inputs' | 'triggers'>,
  ticketId: string,
  triggerId: string,
): string {
  if (!state.triggers[triggerId]) {
    throw superAgentError('triggerNotFound', { triggerId })
  }
  const ticket = state.tickets[ticketId]
  const candidates = (ticket?.inputIds ?? [])
    .map((inputId) => state.inputs[inputId])
    .filter((input) => input !== undefined && input.triggerId === triggerId)
  if (candidates.length === 0) {
    throw superAgentError('notHandbackable', { ticketId, inputId: triggerId })
  }
  const preferred =
    candidates.find((input) => input.human && !input.context && input.releasedAt === null) ??
    candidates.find((input) => input.human && !input.context) ??
    candidates[0]!
  return preferred.inputId
}
