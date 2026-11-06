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
  // refused：Router 路由协议失败（严格 JSON 块校验）
  | 'routeNotUnique'
  | 'routeUnparsable'
  | 'routeInvalid'
  // refused：Eval 协议失败（严格 JSON 块校验，#99）
  | 'evalMissing'
  | 'evalNotUnique'
  | 'evalUnparsable'
  | 'evalInvalid'
  // refused：attach 落在中继轮 —— 本轮没有人的原话可带给工单
  | 'attachWithoutSource'
  // refused：Router 对话入参非法（T21）
  | 'invalidRouterMessage'
  | 'workerDecides'
  | 'handedBack'
  | 'notReady'
  | 'notAttention'
  | 'notQuestion'
  | 'notPermission'
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
  // refused：T12 #82 执行策略 —— 并行上限越界 / 并行缺 worktree / 开启未确认
  | 'invalidWorkerLimit'
  | 'parallelRequiresWorktree'
  | 'policyConfirmRequired'
  // refused：T12 #82 有 Worker 活动时拒绝热切换策略
  | 'policyChangeBlocked'
  // unavailable：T12 #82 并行要求 git 仓库 / per-ticket worktree 创建失败
  | 'worktreeUnavailable'
  // missing/refused/unavailable：T12 #82 检查点 —— 无检查点 / 文件在检查点前已脏 / 路径越界 / 回退失败
  | 'checkpointUnavailable'
  | 'checkpointFileDirty'
  | 'checkpointInvalidFile'
  | 'checkpointRollbackFailed'
  // refused：T16 #86 Gate/Eval/Policy —— off 模式 / bot 越权 / Eval 状态不允许 / 策略非法
  | 'acceptModeOff'
  | 'botForbidden'
  | 'evalBusy'
  | 'evalEmpty'
  | 'evalNotDelivered'
  | 'invalidPolicy'
  // missing：T16 #86 找不到 Eval 记录
  | 'evalNotFound'
  // conflict：T16 #86 旧 Policy 版本的评估结果不得落地
  | 'evalPolicyStale'
  // refused：T20 #90 处置命令只对 unavailable 的 Eval 开放
  | 'evalNotUnavailable'
  // refused：T18 #88 受控 reply —— 未认领的人问题不得外发为回答
  | 'noAnswer'
  // refused：T18 #88 Outbox 载荷非法（通道为空 / reply 文本为空 / 引用不匹配）
  | 'invalidOutbound'
  // refused：T17 #87 handback —— 只有可裁决的人消息才能交回（非人消息/上下文/已认领/他人工单）
  | 'notHandbackable'
  // refused：T17 #87 mark_unrelated —— 来源 Thread 与 follows 不允许退订
  | 'subscriptionProtected'
  // missing：T17 #87 工单没有订阅该 Thread，无从退订
  | 'notSubscribed'
  // T24 #93 Source 接入：配置非法 / 凭据缺失 / 轮询读取失败
  | 'sourceConfigInvalid'
  | 'sourceCredentialsMissing'
  | 'sourceReadFailed'

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
  routeNotUnique: 'refused',
  routeUnparsable: 'refused',
  routeInvalid: 'refused',
  evalMissing: 'refused',
  evalNotUnique: 'refused',
  evalUnparsable: 'refused',
  evalInvalid: 'refused',
  attachWithoutSource: 'refused',
  invalidRouterMessage: 'refused',
  workerDecides: 'refused',
  handedBack: 'refused',
  notReady: 'refused',
  notAttention: 'refused',
  notQuestion: 'refused',
  notPermission: 'refused',
  ackEnded: 'refused',
  mandateRevoked: 'refused',
  conflict: 'conflict',
  takeoverConflict: 'conflict',
  engineLaunchFailed: 'unavailable',
  slotUnavailable: 'unavailable',
  projectStoreUnavailable: 'unavailable',
  shuttingDown: 'refused',
  invalidWorkerLimit: 'refused',
  parallelRequiresWorktree: 'refused',
  policyConfirmRequired: 'refused',
  policyChangeBlocked: 'refused',
  worktreeUnavailable: 'unavailable',
  checkpointUnavailable: 'missing',
  checkpointFileDirty: 'refused',
  checkpointInvalidFile: 'refused',
  checkpointRollbackFailed: 'unavailable',
  acceptModeOff: 'refused',
  botForbidden: 'refused',
  evalBusy: 'refused',
  evalEmpty: 'refused',
  evalNotDelivered: 'refused',
  invalidPolicy: 'refused',
  evalNotFound: 'missing',
  evalPolicyStale: 'conflict',
  evalNotUnavailable: 'refused',
  noAnswer: 'refused',
  invalidOutbound: 'refused',
  notHandbackable: 'refused',
  subscriptionProtected: 'refused',
  notSubscribed: 'missing',
  sourceConfigInvalid: 'refused',
  sourceCredentialsMissing: 'missing',
  sourceReadFailed: 'unavailable',
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
