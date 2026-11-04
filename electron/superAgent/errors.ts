/**
 * Super Agent 稳定错误码（T03 #73）。
 *
 * Domain 抛 `SuperAgentDomainError`，IPC/Renderer 只做序列化与本地化，不重新发明
 * 错误文案。i18n 键统一为 `superAgent.errors.<code>`，参数只放 ID 等安全值。
 */

export type SuperAgentErrorCategory = 'missing' | 'refused' | 'conflict' | 'unavailable'

export type SuperAgentErrorCode =
  // missing：找不到领域对象
  | 'ticketNotFound'
  | 'assignmentNotFound'
  | 'inputNotFound'
  | 'threadNotFound'
  | 'triggerNotFound'
  // refused：越权或状态不允许
  | 'ticketEnded'
  | 'assignmentEnded'
  | 'notRetryable'
  | 'questionWithResult'
  | 'askerWithoutQuestion'
  | 'notAsker'
  | 'notAnswerable'
  | 'workerDecides'
  | 'handedBack'
  | 'notReady'
  | 'notAttention'
  | 'notQuestion'
  | 'ackEnded'
  | 'mandateRevoked'
  // conflict：重复或并发冲突
  | 'conflict'
  // unavailable：引擎或资源不可用
  | 'slotUnavailable'

export type SuperAgentErrorParams = Record<string, string | number>

const ERROR_CATEGORIES: Record<SuperAgentErrorCode, SuperAgentErrorCategory> = {
  ticketNotFound: 'missing',
  assignmentNotFound: 'missing',
  inputNotFound: 'missing',
  threadNotFound: 'missing',
  triggerNotFound: 'missing',
  ticketEnded: 'refused',
  assignmentEnded: 'refused',
  notRetryable: 'refused',
  questionWithResult: 'refused',
  askerWithoutQuestion: 'refused',
  notAsker: 'refused',
  notAnswerable: 'refused',
  workerDecides: 'refused',
  handedBack: 'refused',
  notReady: 'refused',
  notAttention: 'refused',
  notQuestion: 'refused',
  ackEnded: 'refused',
  mandateRevoked: 'refused',
  conflict: 'conflict',
  slotUnavailable: 'unavailable',
}

export const SUPER_AGENT_ERROR_CODES = Object.keys(ERROR_CATEGORIES) as SuperAgentErrorCode[]

const KNOWN_CODES = new Set<string>(SUPER_AGENT_ERROR_CODES)

/** 未知 code 的通用文案键；不得把 stack 或英文异常直接显示给用户。 */
export const SUPER_AGENT_UNKNOWN_ERROR_I18N_KEY = 'superAgent.errors.unknown'

export function superAgentErrorCategory(code: SuperAgentErrorCode): SuperAgentErrorCategory {
  return ERROR_CATEGORIES[code] ?? 'unavailable'
}

export function superAgentErrorI18nKey(code: string): string {
  return KNOWN_CODES.has(code) ? `superAgent.errors.${code}` : SUPER_AGENT_UNKNOWN_ERROR_I18N_KEY
}

/** 领域错误只带 code 与安全参数；message 仅供日志，不含用户原文。 */
export class SuperAgentDomainError extends Error {
  readonly category: SuperAgentErrorCategory
  readonly i18nKey: string

  constructor(
    readonly code: SuperAgentErrorCode,
    readonly params: SuperAgentErrorParams = {},
  ) {
    super(`Super Agent domain error: ${code}`)
    this.name = 'SuperAgentDomainError'
    this.category = superAgentErrorCategory(code)
    this.i18nKey = superAgentErrorI18nKey(code)
  }
}

export function superAgentError(
  code: SuperAgentErrorCode,
  params: SuperAgentErrorParams = {},
): SuperAgentDomainError {
  return new SuperAgentDomainError(code, params)
}

export function isSuperAgentDomainError(err: unknown): err is SuperAgentDomainError {
  return err instanceof SuperAgentDomainError
}
