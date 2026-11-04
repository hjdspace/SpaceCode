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
  | 'invalidDispatch'
  | 'assignmentNotPending'
  | 'questionWithResult'
  | 'askerWithoutQuestion'
  | 'notAsker'
  | 'notAnswerable'
  // refused：Attention 问答（T08 #78）
  | 'invalidAnswer'
  // refused：接管与交还（T09 #79）
  | 'takeoverRequired'
  | 'invalidWorkerMessage'
  // refused：验收、停止与继续追问（T10 #80）
  | 'invalidTicketMessage'
  // refused：Report 协议失败（严格 JSON 块校验，T06 #76）
  | 'reportMissing'
  | 'reportNotUnique'
  | 'reportUnparsable'
  | 'reportInvalid'
  | 'workerDecides'
  | 'handedBack'
  | 'notReady'
  | 'notAttention'
  | 'notQuestion'
  | 'ackEnded'
  | 'mandateRevoked'
  // conflict：重复或并发冲突
  | 'conflict'
  // conflict：同一项目已有其他接管（T09 #79）
  | 'takeoverConflict'
  // unavailable：引擎或资源不可用
  | 'engineLaunchFailed'
  | 'slotUnavailable'
  // unavailable：T11 #81 项目状态存储不可用（锁被占用/迁移失败/损坏）
  | 'projectStoreUnavailable'
  // refused：T11 #81 显式 shutdown 期间停止接受新命令
  | 'shuttingDown'

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
  invalidDispatch: 'refused',
  assignmentNotPending: 'refused',
  questionWithResult: 'refused',
  askerWithoutQuestion: 'refused',
  notAsker: 'refused',
  notAnswerable: 'refused',
  invalidAnswer: 'refused',
  takeoverRequired: 'refused',
  invalidWorkerMessage: 'refused',
  invalidTicketMessage: 'refused',
  reportMissing: 'refused',
  reportNotUnique: 'refused',
  reportUnparsable: 'refused',
  reportInvalid: 'refused',
  workerDecides: 'refused',
  handedBack: 'refused',
  notReady: 'refused',
  notAttention: 'refused',
  notQuestion: 'refused',
  ackEnded: 'refused',
  mandateRevoked: 'refused',
  conflict: 'conflict',
  takeoverConflict: 'conflict',
  engineLaunchFailed: 'unavailable',
  slotUnavailable: 'unavailable',
  projectStoreUnavailable: 'unavailable',
  shuttingDown: 'refused',
}

export const SUPER_AGENT_ERROR_CODES = Object.keys(ERROR_CATEGORIES) as SuperAgentErrorCode[]

const KNOWN_CODES = new Set<string>(SUPER_AGENT_ERROR_CODES)

function isKnownSuperAgentErrorCode(code: string): code is SuperAgentErrorCode {
  return KNOWN_CODES.has(code)
}

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

/** 未知 code 的兜底 code；payload 不携带原始异常信息。 */
export const SUPER_AGENT_UNKNOWN_ERROR_CODE = 'unknown'

/**
 * 稳定错误码的一等 DTO（T13 #83）。未知 code 时 known=false、i18nKey 回退
 * 通用文案；code 保留原值仅供审计，绝不把英文异常或 stack 直接显示给用户。
 */
export interface SuperAgentErrorPayload {
  code: string
  category: SuperAgentErrorCategory | 'unknown'
  i18nKey: string
  params: SuperAgentErrorParams
  known: boolean
}

function readStableCode(err: unknown): string | null {
  if (isSuperAgentDomainError(err)) return err.code
  const code = (err as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && code !== '' ? code : null
}

/** 把任意错误压成稳定 payload：已知 code 用其 i18n 键，未知/缺失一律回退通用文案。 */
export function serializeSuperAgentError(err: unknown): SuperAgentErrorPayload {
  if (isSuperAgentDomainError(err)) {
    return {
      code: err.code,
      category: err.category,
      i18nKey: err.i18nKey,
      params: err.params,
      known: true,
    }
  }

  const code = readStableCode(err)
  if (code !== null && isKnownSuperAgentErrorCode(code)) {
    return {
      code,
      category: superAgentErrorCategory(code),
      i18nKey: superAgentErrorI18nKey(code),
      params: {},
      known: true,
    }
  }

  return {
    code: code ?? SUPER_AGENT_UNKNOWN_ERROR_CODE,
    category: 'unknown',
    i18nKey: SUPER_AGENT_UNKNOWN_ERROR_I18N_KEY,
    params: {},
    known: false,
  }
}
